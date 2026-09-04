"""
Centralized Role-Based Access Control (RBAC) Definitions.

Only 6 authorized user roles exist across the system:
1. Super Admin       (super_admin)
2. Admin             (admin)
3. Brand Marketing Admin (brand_marketing_admin)
4. Brand Marketing User  (brand_marketing_user)
5. Trademark Admin   (trademark_admin)
6. Trademark User    (trademark_user)

No mock or hardcoded user credentials exist; all roles are enforced dynamically
via database records and authenticated JWT tokens.
"""

from enum import Enum
from typing import Set, Optional, Tuple


class UserRole(str, Enum):
    SUPER_ADMIN = "super_admin"
    ADMIN = "admin"
    BRAND_MARKETING_ADMIN = "brand_marketing_admin"
    BRAND_MARKETING_USER = "brand_marketing_user"
    TRADEMARK_ADMIN = "trademark_admin"
    TRADEMARK_USER = "trademark_user"


# Exact set of the 6 canonical system roles
ALL_ROLES: Set[str] = {
    UserRole.SUPER_ADMIN.value,
    UserRole.ADMIN.value,
    UserRole.BRAND_MARKETING_ADMIN.value,
    UserRole.BRAND_MARKETING_USER.value,
    UserRole.TRADEMARK_ADMIN.value,
    UserRole.TRADEMARK_USER.value,
}

# Role display names matching user specifications
ROLE_LABELS = {
    UserRole.SUPER_ADMIN.value: "Super Admin",
    UserRole.ADMIN.value: "Admin",
    UserRole.BRAND_MARKETING_ADMIN.value: "Brand Marketing Admin",
    UserRole.BRAND_MARKETING_USER.value: "Brand Marketing User",
    UserRole.TRADEMARK_ADMIN.value: "Trademark Admin",
    UserRole.TRADEMARK_USER.value: "Trademark User",
}

# Administrative roles (system oversight, reports, dashboards)
ADMIN_ROLES: Set[str] = {
    UserRole.SUPER_ADMIN.value,
    UserRole.ADMIN.value,
}

# Trademark review team roles (evaluation, approvals, rejections, notes)
TRADEMARK_ROLES: Set[str] = {
    UserRole.SUPER_ADMIN.value,
    UserRole.ADMIN.value,
    UserRole.TRADEMARK_ADMIN.value,
    UserRole.TRADEMARK_USER.value,
}

# Trademark decision authority (approve / reject / request revision)
TRADEMARK_DECISION_ROLES: Set[str] = {
    UserRole.SUPER_ADMIN.value,
    UserRole.ADMIN.value,
    UserRole.TRADEMARK_ADMIN.value,
    UserRole.TRADEMARK_USER.value,
}

# Brand Marketing roles (name generation, screening, comparison, case submission)
BRAND_MARKETING_ROLES: Set[str] = {
    UserRole.SUPER_ADMIN.value,
    UserRole.ADMIN.value,
    UserRole.BRAND_MARKETING_ADMIN.value,
    UserRole.BRAND_MARKETING_USER.value,
}

# Mapping aliases (e.g. legacy/UI variations) cleanly to the 6 canonical roles
ROLE_ALIASES = {
    "super_admin": UserRole.SUPER_ADMIN.value,
    "superadmin": UserRole.SUPER_ADMIN.value,
    "platform_admin": UserRole.SUPER_ADMIN.value,
    "admin": UserRole.ADMIN.value,
    "administrator": UserRole.ADMIN.value,
    "brand_marketing_admin": UserRole.BRAND_MARKETING_ADMIN.value,
    "brand_market_admin": UserRole.BRAND_MARKETING_ADMIN.value,
    "brand_marketing_user": UserRole.BRAND_MARKETING_USER.value,
    "brand_market_user": UserRole.BRAND_MARKETING_USER.value,
    "business_team": UserRole.BRAND_MARKETING_USER.value,
    "marketing_team": UserRole.BRAND_MARKETING_USER.value,
    "trademark_admin": UserRole.TRADEMARK_ADMIN.value,
    "trademark_user": UserRole.TRADEMARK_USER.value,
    "trademark_team": UserRole.TRADEMARK_USER.value,
    "legal_team": UserRole.TRADEMARK_USER.value,
}


def canonicalize_role(raw: Optional[str]) -> str:
    """Map any role string or alias to one of the 6 canonical system roles."""
    if not raw:
        return UserRole.BRAND_MARKETING_USER.value
    clean = raw.strip().lower()
    return ROLE_ALIASES.get(clean, UserRole.BRAND_MARKETING_USER.value)


def is_superuser_role(role: str) -> bool:
    """Return whether this role implies superuser access."""
    return canonicalize_role(role) == UserRole.SUPER_ADMIN.value
