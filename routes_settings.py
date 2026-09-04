from app.core.rate_limit import get_client_ip
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.orm import Session
from pydantic import BaseModel, field_validator

from app.core.database import get_db
from app.repositories.settings import SettingsRepository
from app.repositories.audit import AuditRepository
from app.api.deps import get_current_user
from app.models.user import User

router = APIRouter(prefix="/settings", tags=["Settings"])


class RiskWeightsSchema(BaseModel):
    trademark: float
    phonetic: float
    semantic: float
    market: float

    @field_validator("trademark", "phonetic", "semantic", "market")
    @classmethod
    def must_be_fraction(cls, v: float) -> float:
        if not (0.0 <= v <= 1.0):
            raise ValueError("Each weight must be between 0.0 and 1.0")
        return round(v, 4)

    def validate_sum(self):
        total = self.trademark + self.phonetic + self.semantic + self.market
        if abs(total - 1.0) > 0.01:
            raise ValueError(f"Weights must sum to 1.0, got {total:.4f}")


@router.get("/risk-weights", response_model=RiskWeightsSchema)
def get_risk_weights(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    repo = SettingsRepository(db)
    weights = repo.get_risk_weights()
    return RiskWeightsSchema(**weights)


@router.put("/risk-weights", response_model=RiskWeightsSchema)
def update_risk_weights(
    payload: RiskWeightsSchema,
    http_request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client_ip = get_client_ip(http_request)
    if not current_user.is_superuser and current_user.role not in ("admin", "super_admin"):
        raise HTTPException(status_code=403, detail="Admin access required")

    payload.validate_sum()
    repo = SettingsRepository(db)
    saved = repo.update_risk_weights(payload.model_dump())
    AuditRepository(db).create(
        action="SETTINGS_UPDATE",
        user_id=current_user.id,
        resource_type="settings",
        resource_id="risk_weights",
        details="Updated platform risk assessment weights",
        metadata=saved,
        ip_address=client_ip,
        status="success",
    )
    return RiskWeightsSchema(**saved)
