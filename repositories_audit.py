from sqlalchemy.orm import Session, joinedload
from sqlalchemy import desc, or_
from typing import Optional, List, Tuple
from datetime import datetime, timezone
import uuid
import logging
from app.models.audit import AuditLog
from app.models.user import User

logger = logging.getLogger(__name__)


class AuditRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(
        self,
        action: str,
        user_id: Optional[uuid.UUID] = None,
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        details: Optional[str] = None,
        metadata: Optional[dict] = None,
        ip_address: Optional[str] = None,
        status: str = "success",
    ) -> Optional[AuditLog]:
        try:
            log = AuditLog(
                user_id=user_id,
                action=action,
                resource_type=resource_type,
                resource_id=str(resource_id) if resource_id else None,
                details=details,
                log_metadata=metadata,
                ip_address=ip_address or "127.0.0.1",
                status=status,
                created_at=datetime.now(timezone.utc),
            )
            self.db.add(log)
            self.db.commit()
            self.db.refresh(log)
            return log
        except Exception as exc:
            # M-23: Log structured error instead of failing or printing
            try:
                self.db.rollback()
            except Exception:
                pass
            logger.error("Failed to persist audit log entry for action '%s': %s", action, exc, exc_info=True)
            return None


    def get_logs(
        self,
        page: int = 1,
        page_size: int = 20,
        user_id: Optional[uuid.UUID] = None,
        action: Optional[str] = None,
        resource_type: Optional[str] = None,
        search: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
    ) -> Tuple[List[AuditLog], int]:
        q = self.db.query(AuditLog).outerjoin(User, AuditLog.user_id == User.id).options(joinedload(AuditLog.user))

        if user_id:
            q = q.filter(AuditLog.user_id == user_id)
        if action:
            q = q.filter(AuditLog.action.ilike(f"%{action}%"))
        if resource_type:
            q = q.filter(AuditLog.resource_type == resource_type)
        if date_from:
            q = q.filter(AuditLog.created_at >= date_from)
        if date_to:
            q = q.filter(AuditLog.created_at <= date_to)
        if search:
            s = f"%{search.strip()}%"
            q = q.filter(
                or_(
                    AuditLog.action.ilike(s),
                    AuditLog.details.ilike(s),
                    AuditLog.resource_id.ilike(s),
                    AuditLog.ip_address.ilike(s),
                    User.email.ilike(s),
                    User.full_name.ilike(s),
                )
            )

        total = q.count()
        items = q.order_by(desc(AuditLog.created_at)).offset((page - 1) * page_size).limit(page_size).all()
        return items, total

    def get_stats(self, user_id: Optional[uuid.UUID] = None) -> dict:
        q = self.db.query(AuditLog)
        if user_id:
            q = q.filter(AuditLog.user_id == user_id)

        total = q.count()
        logins = q.filter(AuditLog.action.in_(["LOGIN", "LOGOUT"])).count()
        exports = q.filter(AuditLog.action == "EXPORT").count()
        screenings = q.filter(AuditLog.action == "BRAND_SCREENING").count()
        generations = q.filter(AuditLog.action == "GENERATE_BRAND_NAMES").count()

        return {
            "total": total,
            "logins": logins,
            "exports": exports,
            "screenings": screenings,
            "generations": generations,
        }
