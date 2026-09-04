from sqlalchemy.orm import Session
from app.core.config import settings as app_settings
from app.models.settings import PlatformSettings

DEFAULT_RISK_WEIGHTS = {
    "trademark": 0.40,
    "phonetic": 0.25,
    "semantic": 0.20,
    "market": 0.15,
}

RISK_WEIGHTS_KEY = "risk_weights"
DATA_SOURCE_TOGGLES_KEY = "data_source_toggles"


class SettingsRepository:
    def __init__(self, db: Session):
        self.db = db

    def get_risk_weights(self) -> dict:
        row = self.db.query(PlatformSettings).filter_by(key=RISK_WEIGHTS_KEY).first()
        if row:
            return row.value
        return DEFAULT_RISK_WEIGHTS.copy()

    def update_risk_weights(self, weights: dict) -> dict:
        row = self.db.query(PlatformSettings).filter_by(key=RISK_WEIGHTS_KEY).first()
        if row:
            row.value = weights
        else:
            row = PlatformSettings(key=RISK_WEIGHTS_KEY, value=weights)
            self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row.value

    def get_data_source_toggles(self) -> dict:
        """Live on/off state for each Brand Analysis data source. Seeded
        (but not yet persisted) from the WHO_INN_ENABLED/IQVIA_ENABLED/
        EPHARMACY_SCRAPE_ENABLED/GOOGLE_SEARCH_ENABLED env vars the first
        time this is called — an admin toggle afterward writes a real DB
        row here, which then takes over from the env default."""
        row = self.db.query(PlatformSettings).filter_by(key=DATA_SOURCE_TOGGLES_KEY).first()
        if row:
            return row.value
        return {
            "who_inn_enabled": app_settings.WHO_INN_ENABLED,
            "iqvia_enabled": app_settings.IQVIA_ENABLED,
            "epharmacy_enabled": app_settings.EPHARMACY_SCRAPE_ENABLED,
            "google_search_enabled": app_settings.GOOGLE_SEARCH_ENABLED,
        }

    def set_data_source_toggle(self, source_id: str, enabled: bool) -> dict:
        toggles = self.get_data_source_toggles().copy()
        toggles[source_id] = enabled
        row = self.db.query(PlatformSettings).filter_by(key=DATA_SOURCE_TOGGLES_KEY).first()
        if row:
            row.value = toggles
        else:
            row = PlatformSettings(key=DATA_SOURCE_TOGGLES_KEY, value=toggles)
            self.db.add(row)
        self.db.commit()
        self.db.refresh(row)
        return row.value
