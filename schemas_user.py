import uuid
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, EmailStr


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class UserResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: str
    department: Optional[str] = None
    is_active: bool
    is_superuser: bool
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class UserAdminResponse(BaseModel):
    id: uuid.UUID
    email: EmailStr
    full_name: str
    role: str
    department: Optional[str] = None
    is_active: bool
    is_superuser: bool
    created_at: datetime
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


from app.core.roles import UserRole, canonicalize_role


class CreateUserAdminRequest(BaseModel):
    email: EmailStr
    full_name: str
    password: str
    role: str = UserRole.BRAND_MARKETING_USER.value
    department: Optional[str] = None
    is_superuser: bool = False

    def get_canonical_role(self) -> str:
        return canonicalize_role(self.role)


class UpdateUserAdminRequest(BaseModel):
    full_name: Optional[str] = None
    role: Optional[str] = None
    department: Optional[str] = None
    is_active: Optional[bool] = None
    is_superuser: Optional[bool] = None

    def get_canonical_role(self) -> Optional[str]:
        return canonicalize_role(self.role) if self.role else None



class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    department: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str
