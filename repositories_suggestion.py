import uuid
from datetime import datetime, timezone
from typing import List, Optional
from sqlalchemy import desc, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.models.suggestion import BrandSuggestionForm

_MAX_CASE_ID_ATTEMPTS = 5


def _next_case_id(db: Session) -> str:
    year = datetime.now(timezone.utc).year
    prefix = f"SUN-{year}-"
    last = (
        db.query(BrandSuggestionForm)
        .filter(BrandSuggestionForm.case_id.like(f"{prefix}%"))
        .order_by(desc(BrandSuggestionForm.case_id))
        .first()
    )
    seq = 1
    if last:
        try:
            seq = int(last.case_id[len(prefix):]) + 1
        except ValueError:
            pass
    return f"{prefix}{seq:04d}"


class SuggestionRepository:
    def __init__(self, db: Session):
        self.db = db

    def create(self, data: dict, user_id: Optional[uuid.UUID] = None) -> BrandSuggestionForm:
        fields = {k: v for k, v in data.items() if k not in ("case_id", "user_id", "id")}
        # Two concurrent saves can read the same "last case_id" before either
        # commits; retry with a freshly-computed case_id on the resulting
        # unique-constraint violation rather than letting one request 500 or
        # silently overwrite the other's sequence number.
        for attempt in range(_MAX_CASE_ID_ATTEMPTS):
            case_id = _next_case_id(self.db)
            form = BrandSuggestionForm(case_id=case_id, user_id=user_id, **fields)
            self.db.add(form)
            try:
                self.db.commit()
            except IntegrityError:
                self.db.rollback()
                if attempt == _MAX_CASE_ID_ATTEMPTS - 1:
                    raise
                continue
            self.db.refresh(form)
            return form
        raise RuntimeError("Unreachable")  # pragma: no cover

    def list_all(self, user_id: Optional[uuid.UUID] = None) -> List[BrandSuggestionForm]:
        query = self.db.query(BrandSuggestionForm)
        if user_id:
            query = query.filter(BrandSuggestionForm.user_id == user_id)
        return query.order_by(desc(BrandSuggestionForm.created_at)).all()

    def get_by_case_id(self, case_id: str) -> Optional[BrandSuggestionForm]:
        return (
            self.db.query(BrandSuggestionForm)
            .filter(BrandSuggestionForm.case_id == case_id)
            .first()
        )

    def find_duplicate(
        self, generic_name: str, division: Optional[str], dosage_form: str,
    ) -> Optional[BrandSuggestionForm]:
        """A case is considered the same underlying case — not just a
        similarly-named one — when its Molecule (generic_name), Division and
        Dosage Form all match an existing case case-insensitively. Blank
        division is normalized to '' on both sides so two cases that both
        left it empty still compare equal instead of NULL != NULL silently
        never matching."""
        return (
            self.db.query(BrandSuggestionForm)
            .filter(
                func.lower(func.trim(BrandSuggestionForm.generic_name)) == generic_name.strip().lower(),
                func.lower(func.trim(func.coalesce(BrandSuggestionForm.division, ''))) == (division or '').strip().lower(),
                func.lower(func.trim(BrandSuggestionForm.dosage_form)) == dosage_form.strip().lower(),
            )
            .order_by(desc(BrandSuggestionForm.created_at))
            .first()
        )

    def delete(self, case_id: str) -> bool:
        form = self.get_by_case_id(case_id)
        if not form:
            return False
        self.db.delete(form)
        self.db.commit()
        return True
