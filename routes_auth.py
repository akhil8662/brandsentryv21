import logging
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session
from app.api.deps import get_current_user
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import rate_limit, get_client_ip
from app.core.saml import get_sp_metadata, init_saml_auth
from app.models.user import User
from app.schemas.user import (
    LoginRequest,
    TokenResponse,
    UserResponse,
    UpdateProfileRequest,
    ChangePasswordRequest,
)
from app.services.auth import AuthService
from app.repositories.user import UserRepository
from app.repositories.audit import AuditRepository

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["Authentication"])

def _is_request_secure(request: Request) -> bool:
    """Only mark cookies as Secure when connection is actually HTTPS or behind HTTPS proxy.
    Setting Secure=True over plain HTTP causes browsers to silently discard the cookie."""
    proto = request.headers.get("x-forwarded-proto", "").lower()
    return proto == "https" or request.url.scheme == "https"



@router.post(
    "/login",
    response_model=TokenResponse,
    dependencies=[Depends(rate_limit(max_requests=10, window_seconds=60, by_ip=True))],
)
def login(request: LoginRequest, http_request: Request, response: Response, db: Session = Depends(get_db)):
    client_ip = get_client_ip(http_request)
    result = AuthService(db).login(request.email, request.password)
    if not result:
        logger.warning("Failed login attempt for %s from IP %s", request.email, client_ip)
        AuditRepository(db).create(
            action="LOGIN_FAILED",
            details=f"Failed login attempt for {request.email}",
            ip_address=client_ip,
            status="failure",
        )
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
        )


    # Set secure HttpOnly cookie alongside returning JWT payload
    response.set_cookie(
        key="access_token",
        value=result["access_token"],
        httponly=True,
        secure=_is_request_secure(http_request),
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
    )
    user_id = result["user"].id if hasattr(result["user"], "id") else None
    if user_id:
        from app.core.security import create_refresh_token
        refresh_token = create_refresh_token(data={"sub": str(user_id), "email": request.email})
        response.set_cookie(
            key="refresh_token",
            value=refresh_token,
            httponly=True,
            secure=_is_request_secure(http_request),
            max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
            samesite="lax",
        )

    logger.info("Login: %s from IP %s", request.email, client_ip)
    AuditRepository(db).create(
        action="LOGIN",
        user_id=user_id,
        details=f"User {request.email} logged in successfully",
        ip_address=client_ip,
        status="success",
    )
    return result



@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from app.core.security import decode_token, revoke_token
    token = request.cookies.get("access_token")
    if not token:
        auth_h = request.headers.get("Authorization", "")
        if auth_h.startswith("Bearer "):
            token = auth_h[7:]
    if token:
        payload = decode_token(token)
        if payload and payload.get("jti"):
            revoke_token(payload["jti"])

    response.delete_cookie(key="access_token")
    response.delete_cookie(key="refresh_token")
    logger.info("Logout: %s", current_user.email)
    client_ip = get_client_ip(request)
    AuditRepository(db).create(
        action="LOGOUT",
        user_id=current_user.id,
        details=f"User {current_user.email} logged out",
        ip_address=client_ip,
        status="success",
    )
    return {"message": "Logged out successfully"}


@router.post("/refresh")
def refresh_token_endpoint(request: Request, response: Response, db: Session = Depends(get_db)):
    """Issues a new access token using a valid HttpOnly refresh token (L-08)."""
    import uuid
    from app.core.security import decode_token, revoke_token, create_access_token, create_refresh_token
    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token missing")

    payload = decode_token(refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired refresh token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    try:
        parsed_id = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid user ID in token")

    user = UserRepository(db).get_by_id(parsed_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    # Rotate refresh token: revoke old JTI
    if payload.get("jti"):
        revoke_token(payload["jti"], ttl_seconds=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400)

    new_access = create_access_token(data={"sub": str(user.id), "email": user.email})
    new_refresh = create_refresh_token(data={"sub": str(user.id), "email": user.email})

    response.set_cookie(
        key="access_token",
        value=new_access,
        httponly=True,
        secure=_is_request_secure(request),
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
    )
    response.set_cookie(
        key="refresh_token",
        value=new_refresh,
        httponly=True,
        secure=_is_request_secure(request),
        max_age=settings.REFRESH_TOKEN_EXPIRE_DAYS * 86400,
        samesite="lax",
    )
    return {"access_token": new_access, "token_type": "bearer", "user": user}


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.patch(
    "/profile",
    response_model=UserResponse,
    dependencies=[Depends(rate_limit(max_requests=30, window_seconds=60))],
)
def update_profile(
    request: UpdateProfileRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_ip = get_client_ip(http_request)
    repo = UserRepository(db)
    data = {k: v for k, v in request.model_dump().items() if v is not None}
    updated = repo.update_user(current_user.id, **data)
    if not updated:
        raise HTTPException(status_code=404, detail="User not found")
    AuditRepository(db).create(
        action="PROFILE_UPDATE",
        user_id=current_user.id,
        details=f"Updated profile for {current_user.email}",
        metadata=data,
        ip_address=client_ip,
        status="success",
    )
    return updated


@router.post(
    "/change-password",
    dependencies=[Depends(rate_limit(max_requests=10, window_seconds=60, by_ip=True))],
)
def change_password(
    request: ChangePasswordRequest,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_ip = get_client_ip(http_request)
    # L-07: NIST SP 800-63B minimum length 12 characters
    if len(request.new_password) < 12:
        raise HTTPException(status_code=400, detail="New password must be at least 12 characters")
    repo = UserRepository(db)
    ok = repo.change_password(current_user.id, request.current_password, request.new_password)
    if not ok:
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    AuditRepository(db).create(
        action="PASSWORD_CHANGE",
        user_id=current_user.id,
        details=f"Changed password for {current_user.email}",
        ip_address=client_ip,
        status="success",
    )
    return {"message": "Password updated successfully"}


# ── SAML SSO (Microsoft Entra ID) ───────────────────────────────────────────

@router.get("/sso/status")
def sso_status():
    """Returns whether SAML SSO is fully configured in settings."""
    return {"enabled": settings.sso_enabled}


@router.get("/sso/login")
async def sso_login(request: Request):
    if not settings.sso_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SSO is not configured")
    auth = await init_saml_auth(request)
    return RedirectResponse(auth.login())


@router.post("/sso/acs")
async def sso_acs(request: Request, db: Session = Depends(get_db)):
    """Assertion Consumer Service: the IdP POSTs the SAML response here after login."""
    if not settings.sso_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="SSO is not configured")

    auth = await init_saml_auth(request)
    auth.process_response()

    errors = auth.get_errors()
    if errors:
        # H-10: Log detailed error internally and return generic error message
        logger.error("SAML authentication failed: %s - %s", errors, auth.get_last_error_reason())
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SAML authentication failed",
        )
    if not auth.is_authenticated():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="SAML authentication failed")

    try:
        result = AuthService(db).login_from_saml(auth)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(exc))

    logger.info("SSO login: %s", result["user"].email)
    user_id = result["user"].id if hasattr(result["user"], "id") else None
    client_ip = get_client_ip(request)
    AuditRepository(db).create(
        action="SSO_LOGIN",
        user_id=user_id,
        details=f"SSO login successful for {result['user'].email}",
        ip_address=client_ip,
        status="success",
    )

    frontend_base = settings.FRONTEND_URL.split(",")[0].strip() if settings.FRONTEND_URL else ""
    if not frontend_base:
        # M-09: Fail loudly if FRONTEND_URL is not configured
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="FRONTEND_URL must be configured for SSO callback")

    redirect_url = f"{frontend_base}/sso/callback"
    response = RedirectResponse(redirect_url, status_code=status.HTTP_302_FOUND)
    response.set_cookie(
        key="access_token",
        value=result["access_token"],
        httponly=True,
        secure=_is_request_secure(request),
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        samesite="lax",
    )
    return response


@router.get("/sso/metadata")
def sso_metadata():
    """SP metadata XML — upload this to Microsoft Entra ID Enterprise App."""
    return Response(content=get_sp_metadata(), media_type="application/xml")

