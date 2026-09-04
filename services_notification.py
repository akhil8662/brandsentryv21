from sqlalchemy.orm import Session
import uuid
from app.models.notification import Notification
from app.models.user import User


def _create(db: Session, user_id, ntype: str, title: str, message: str, resource_id=None):
    db.add(Notification(
        id=uuid.uuid4(),
        user_id=user_id,
        type=ntype,
        title=title,
        message=message,
        resource_id=resource_id,
        is_read=False,
    ))


def notify_all_roles(db: Session, ntype: str, title: str, message: str, resource_id=None):
    """Notify all active users across all roles (Brand Marketing, Trademark, Admin, Super Admin)."""
    users = db.query(User).filter(User.is_active == True).all()
    for u in users:
        _create(db, u.id, ntype, title, message, resource_id)


def notify_reviewers_and_admins(db: Session, ntype: str, title: str, message: str, resource_id=None):
    """Notify all Trademark Team members and admins — used when Business Team submits a review."""
    recipients = db.query(User).filter(
        ((User.role.in_(["trademark_team", "trademark_admin", "trademark_user"])) | (User.is_superuser == True) | (User.role == "admin")) & (User.is_active == True)
    ).all()
    for u in recipients:
        _create(db, u.id, ntype, title, message, resource_id)


def notify_user_and_admins(db: Session, user_id, ntype: str, title: str, message: str, resource_id=None):
    """Notify a specific user + all admins + all relevant roles (deduped)."""
    _create(db, user_id, ntype, title, message, resource_id)
    admins = db.query(User).filter(
        ((User.is_superuser == True) | (User.role.in_(["admin", "super_admin", "brand_market_admin", "trademark_admin"]))) & (User.is_active == True)
    ).all()
    for admin in admins:
        if admin.id != user_id:
            _create(db, admin.id, ntype, title, message, resource_id)


def notify_admins(db: Session, ntype: str, title: str, message: str, resource_id=None):
    """Notify all admins."""
    admins = db.query(User).filter(
        ((User.is_superuser == True) | (User.role.in_(["admin", "super_admin"]))) & (User.is_active == True)
    ).all()
    for admin in admins:
        _create(db, admin.id, ntype, title, message, resource_id)
