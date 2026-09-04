import secrets
import uuid
from typing import Optional, List, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import desc
from app.core.security import get_password_hash, verify_password
from app.models.user import User

# Constant-time-ish stand-in used when the email doesn't exist, so authenticate()
# always pays the bcrypt cost and can't be used to enumerate valid emails by timing.
_DUMMY_HASH = get_password_hash("no-such-user-placeholder")


from app.core.roles import UserRole, canonicalize_role


class UserRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_by_id(self, user_id: uuid.UUID) -> Optional[User]:
        return self.db.query(User).filter(User.id == user_id).first()

    def get_by_email(self, email: str) -> Optional[User]:
        return self.db.query(User).filter(User.email == email).first()

    def authenticate(self, email: str, password: str) -> Optional[User]:
        user = self.get_by_email(email)
        # Hash against a dummy value when the email is unknown so response time
        # doesn't reveal whether an account exists (timing side-channel).
        hashed = user.hashed_password if user else _DUMMY_HASH
        password_ok = verify_password(password, hashed)
        if not user or not password_ok:
            return None
        return user

    def get_or_create_from_sso(
        self,
        *,
        email: str,
        full_name: Optional[str],
        role_hint: Optional[Tuple[str, bool]] = None,
    ) -> User:
        """Just-in-time provisioning for SAML logins."""
        user = self.get_by_email(email)
        if user is None:
            raw_role, is_super = role_hint or (UserRole.BRAND_MARKETING_USER.value, False)
            canon_role = canonicalize_role(raw_role)
            is_super = is_super or (canon_role == UserRole.SUPER_ADMIN.value)
            user = User(
                email=email,
                full_name=full_name or email,
                hashed_password=get_password_hash(secrets.token_urlsafe(32)),
                role=canon_role,
                is_superuser=is_super,
                is_active=True,
            )
            self.db.add(user)
        else:
            user.full_name = full_name or user.full_name
            if role_hint:
                raw_role, is_super = role_hint
                canon_role = canonicalize_role(raw_role)
                user.role = canon_role
                user.is_superuser = is_super or (canon_role == UserRole.SUPER_ADMIN.value)
        self.db.commit()
        self.db.refresh(user)
        return user

    def get_all_users(self) -> List[User]:
        return self.db.query(User).order_by(desc(User.created_at)).all()

    def create(
        self,
        email: str,
        full_name: str,
        password: str,
        role: str = UserRole.BRAND_MARKETING_USER.value,
        department: Optional[str] = None,
        is_superuser: bool = False,
    ) -> User:
        canon_role = canonicalize_role(role)
        effective_superuser = is_superuser or (canon_role == UserRole.SUPER_ADMIN.value)
        user = User(
            email=email.strip().lower(),
            full_name=full_name.strip(),
            hashed_password=get_password_hash(password),
            role=canon_role,
            department=department.strip() if department else None,
            is_active=True,
            is_superuser=effective_superuser,
        )
        self.db.add(user)
        self.db.commit()
        self.db.refresh(user)

        return user

    def update_user(self, user_id: uuid.UUID, **kwargs) -> Optional[User]:
        user = self.get_by_id(user_id)
        if not user:
            return None
        for key, value in kwargs.items():
            if hasattr(user, key) and value is not None:
                setattr(user, key, value)
        self.db.commit()
        self.db.refresh(user)
        return user

    def change_password(self, user_id: uuid.UUID, current_password: str, new_password: str) -> bool:
        user = self.get_by_id(user_id)
        if not user or not verify_password(current_password, user.hashed_password):
            return False
        user.hashed_password = get_password_hash(new_password)
        self.db.commit()
        return True

    def delete_user(self, user_id: uuid.UUID) -> bool:
        user = self.get_by_id(user_id)
        if not user:
            return False
        self.db.delete(user)
        self.db.commit()
        return True
