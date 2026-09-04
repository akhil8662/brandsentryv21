import uuid
from typing import Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.core.security import decode_token
from app.core.roles import (
    UserRole, ALL_ROLES, ADMIN_ROLES, TRADEMARK_ROLES, BRAND_MARKETING_ROLES,
    canonicalize_role, is_superuser_role,
)
from app.models.user import User
from app.repositories.user import UserRepository

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    token: Optional[str] = None

    # 1. Check Authorization Bearer header
    if credentials and credentials.credentials:
        token = credentials.credentials
    # 2. Fallback to HttpOnly cookie
    elif "access_token" in request.cookies:
        token = request.cookies.get("access_token")

    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")

    payload = decode_token(token)
    if not payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user_id = payload.get("sub")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    try:
        parsed_id = uuid.UUID(user_id)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")

    user = UserRepository(db).get_by_id(parsed_id)
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")

    return user


def require_super_admin(current_user: User = Depends(get_current_user)) -> User:
    """Super Admin privileges required (User management, system data sync)."""
    if not current_user.is_superuser and canonicalize_role(current_user.role) != UserRole.SUPER_ADMIN.value:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super Admin privileges required",
        )
    return current_user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Super Admin or Admin privileges required."""
    if not current_user.is_superuser and canonicalize_role(current_user.role) not in ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin privileges required",
        )
    return current_user


# Alias for backward compatibility
require_superuser = require_admin


def require_trademark_role(current_user: User = Depends(get_current_user)) -> User:
    """Ensure user holds a Trademark role or Admin privileges (H-04)."""
    if not current_user.is_superuser and canonicalize_role(current_user.role) not in TRADEMARK_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Trademark review privileges required",
        )
    return current_user


def require_brand_marketing_role(current_user: User = Depends(get_current_user)) -> User:
    """Ensure user holds Brand Marketing or Admin privileges."""
    if not current_user.is_superuser and canonicalize_role(current_user.role) not in BRAND_MARKETING_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Brand Marketing privileges required",
        )
    return current_user


