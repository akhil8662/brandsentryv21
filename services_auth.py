from datetime import timedelta
from typing import Any, Optional, Tuple
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.security import create_access_token
from app.models.user import User
from app.repositories.user import UserRepository

# Entra ID emits these well-known claim URIs in the SAML assertion attributes
EMAIL_ATTR_CANDIDATES = (
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    "email",
    "mail",
)
NAME_ATTR_CANDIDATES = (
    "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    "http://schemas.microsoft.com/identity/claims/displayname",
    "name",
)
ROLE_ATTR_CANDIDATES = (
    "group_level",
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/role",
    "http://schemas.microsoft.com/ws/2008/06/identity/claims/groups",
    "roles",
    "role",
    "groups",
)


def _first_attr(attributes: dict, candidates: tuple) -> Optional[str]:
    for key in candidates:
        values = attributes.get(key)
        if values:
            return values[0]
    return None


from app.core.roles import UserRole


def _map_sso_role(raw_value: Optional[str]) -> Optional[Tuple[str, bool]]:
    """Map SSO groups via exact match allowlist to the 6 canonical system roles (H-11)."""
    if not raw_value:
        return None
    value = raw_value.strip().lower()
    if value in {"super_admin", "superadmin", "platform_admin"}:
        return UserRole.SUPER_ADMIN.value, True
    if value in {"admin", "administrator"}:
        return UserRole.ADMIN.value, False
    if value in {"brand_marketing_admin", "brand_market_admin"}:
        return UserRole.BRAND_MARKETING_ADMIN.value, False
    if value in {"brand_marketing_user", "brand_market_user", "business_team", "marketing"}:
        return UserRole.BRAND_MARKETING_USER.value, False
    if value in {"trademark_admin", "legal_admin"}:
        return UserRole.TRADEMARK_ADMIN.value, False
    if value in {"trademark_user", "trademark_team", "legal_team", "legal"}:
        return UserRole.TRADEMARK_USER.value, False
    return None




class AuthService:
    def __init__(self, db: Session):
        self.repo = UserRepository(db)

    def login(self, email: str, password: str) -> Optional[dict]:
        user = self.repo.authenticate(email, password)
        if not user or not user.is_active:
            return None

        access_token = create_access_token(
            data={"sub": str(user.id), "email": user.email},
            expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        return {"access_token": access_token, "token_type": "bearer", "user": user}

    def login_from_saml(self, auth: Any) -> dict:
        """Process SAML response and authenticate or JIT provision user."""
        attributes = auth.get_attributes() or {}
        name_id = auth.get_nameid()
        email = _first_attr(attributes, EMAIL_ATTR_CANDIDATES) or name_id
        full_name = _first_attr(attributes, NAME_ATTR_CANDIDATES)

        role_candidates = ROLE_ATTR_CANDIDATES
        if settings.SAML_ROLE_ATTRIBUTE:
            role_candidates = (settings.SAML_ROLE_ATTRIBUTE, *ROLE_ATTR_CANDIDATES)
        role_hint = _map_sso_role(_first_attr(attributes, role_candidates))

        if not email:
            raise ValueError("SAML assertion did not contain an email/NameID claim")

        user = self.repo.get_or_create_from_sso(
            email=email,
            full_name=full_name,
            role_hint=role_hint,
        )
        if not user.is_active:
            raise ValueError("User account is deactivated")

        access_token = create_access_token(
            data={"sub": str(user.id), "email": user.email},
            expires_delta=timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        return {"access_token": access_token, "token_type": "bearer", "user": user}

    def get_user_by_id(self, user_id) -> Optional[User]:
        return self.repo.get_by_id(user_id)

