import uuid
import logging
from typing import Optional
from sqlalchemy.orm import Session
from app.repositories.trademark import TrademarkRepository
from app.repositories.brand import BrandRepository
from app.services.ai import ai_service
from app.services.screening import phonetic_similarity, fuzzy_similarity, levenshtein_similarity

logger = logging.getLogger(__name__)

# H-12: Upper bound on reference rows fetched for in-memory scoring to prevent OOM
MAX_REFERENCE_ROWS = 2500


class IntelligenceService:
    def __init__(self, db: Session):
        self.db = db
        self.trademark_repo = TrademarkRepository(db)
        self.brand_repo = BrandRepository(db)

    async def get_brand_intelligence(self, brand_name: str, user_id: Optional[uuid.UUID] = None) -> dict:
        # H-12: Bounded table queries instead of unbounded full table loads
        # H-12: Indexed SQL candidate queries (limit=100) instead of unbounded/heavy full-table scans
        all_trademarks = self.trademark_repo.find_candidate_trademarks(brand_name, limit=100)
        all_market = self.trademark_repo.find_candidate_market_brands(brand_name, limit=100)
        all_epharmacy = self.trademark_repo.find_candidate_market_brands(brand_name, limit=100)


        # Compute similarity with all entries
        def score(candidate: str) -> float:
            lev = levenshtein_similarity(brand_name, candidate)
            fuz = fuzzy_similarity(brand_name, candidate)
            phon = phonetic_similarity(brand_name, candidate)
            return (lev * 0.35 + fuz * 0.35 + phon * 0.30)

        tm_matches = [(t, score(t.brand_name)) for t in all_trademarks if score(t.brand_name) >= 0.40]
        mkt_matches = [(m, score(m.brand_name)) for m in all_market if score(m.brand_name) >= 0.40]
        ep_matches = [(e, score(e.brand_name)) for e in all_epharmacy if score(e.brand_name) >= 0.40]

        trademark_presence = len(tm_matches)
        market_presence = len(mkt_matches)
        epharmacy_presence = len(ep_matches)

        # Geographic reach
        countries = set()
        for t, _ in tm_matches:
            if t.country:
                countries.add(t.country)
        for m, _ in mkt_matches:
            if m.country:
                countries.add(m.country)
        geographic_reach = len(countries)

        competitor_count = len(set(
            [t.brand_name for t, _ in tm_matches] +
            [m.brand_name for m, _ in mkt_matches]
        ))

        market_saturation = min((trademark_presence + market_presence * 0.5) / 20.0, 1.0)
        brand_uniqueness_score = max(0.0, 1.0 - market_saturation) * 100

        # Competitive landscape
        competitive_landscape = []
        seen = set()
        for m, sim in sorted(mkt_matches, key=lambda x: x[1], reverse=True)[:10]:
            if m.brand_name.lower() not in seen:
                seen.add(m.brand_name.lower())
                competitive_landscape.append({
                    "brand": m.brand_name,
                    "similarity_score": round(sim * 100, 1),
                    "market_presence": m.market_share or 0.0,
                    "trademark_status": "Registered",
                    "manufacturer": m.manufacturer or "Unknown",
                    "therapeutic_area": m.therapeutic_area or "Unknown",
                })

        # Similar brands for display
        similar_brands = []
        for t, sim in sorted(tm_matches + mkt_matches, key=lambda x: x[1], reverse=True)[:15]:
            similar_brands.append({
                "id": str(t.id),
                "name": t.brand_name,
                "similarity_type": "Phonetic" if phonetic_similarity(brand_name, t.brand_name) >= 0.6 else "Spelling",
                "similarity_score": round(sim, 4),
                "source": "Trademark Registry" if hasattr(t, "registration_number") else "Market Database",
                "risk_level": "HIGH" if sim >= 0.7 else "MEDIUM" if sim >= 0.45 else "LOW",
                "therapeutic_area": getattr(t, "therapeutic_area", None),
                "manufacturer": getattr(t, "owner", None) or getattr(t, "manufacturer", None),
                "country": getattr(t, "country", None),
            })

        # Trend data (simulated monthly presence)
        import random
        base_tm = trademark_presence
        trend_data = []
        months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
        for i, month in enumerate(months[-6:]):
            trend_data.append({
                "month": month,
                "trademark": max(0, base_tm - (5 - i) + random.randint(-1, 1)),  # NOSONAR - display-only jitter for a trend chart, not security-sensitive
                "market": max(0, market_presence - (5 - i) * 2 + random.randint(-2, 2)),  # NOSONAR - display-only jitter for a trend chart, not security-sensitive
                "epharmacy": max(0, epharmacy_presence - (5 - i) + random.randint(-1, 1)),  # NOSONAR - display-only jitter for a trend chart, not security-sensitive
            })

        # Similarity breakdown
        similarity_breakdown = [
            {"type": "Phonetic", "count": sum(1 for _, s in tm_matches + mkt_matches if phonetic_similarity(brand_name, _.brand_name) >= 0.6), "color": "#3B82F6"},
            {"type": "Spelling", "count": sum(1 for _, s in tm_matches + mkt_matches if levenshtein_similarity(brand_name, _.brand_name) >= 0.6), "color": "#8B5CF6"},
            {"type": "Semantic", "count": max(0, competitor_count // 3), "color": "#10B981"},
            {"type": "Exact", "count": sum(1 for _, s in tm_matches + mkt_matches if s >= 0.98), "color": "#EF4444"},
        ]

        # Risk distribution
        all_scores = [s for _, s in tm_matches + mkt_matches + ep_matches]
        risk_distribution = [
            {"level": "Low", "count": sum(1 for s in all_scores if s < 0.45), "color": "#22C55E"},
            {"level": "Medium", "count": sum(1 for s in all_scores if 0.45 <= s < 0.70), "color": "#F97316"},
            {"level": "High", "count": sum(1 for s in all_scores if s >= 0.70), "color": "#EF4444"},
        ]

        # AI Summary
        ai_summary = await ai_service.generate_intelligence_summary(
            brand_name, trademark_presence, market_presence,
            epharmacy_presence, competitor_count, market_saturation
        )

        result = {
            "brand_name": brand_name,
            "trademark_presence": trademark_presence,
            "market_presence": market_presence,
            "epharmacy_presence": epharmacy_presence,
            "geographic_reach": geographic_reach,
            "competitor_count": competitor_count,
            "market_saturation": round(market_saturation, 4),
            "brand_uniqueness_score": round(brand_uniqueness_score, 1),
            "ai_summary": ai_summary,
            "similar_brands": similar_brands,
            "competitive_landscape": competitive_landscape,
            "trend_data": trend_data,
            "similarity_breakdown": similarity_breakdown,
            "risk_distribution": risk_distribution,
        }

        # Persist the computed intelligence. Best-effort: a storage failure must
        # not break the user-facing response.
        try:
            self.brand_repo.save_intelligence_result({
                **result,
                "normalized_name": brand_name.lower().strip(),
                "user_id": user_id,
            })
        except Exception as exc:
            self.db.rollback()
            # L-05, L-13: Log persistence failure with error level and stack trace
            logger.error("Failed to persist intelligence result for '%s': %s", brand_name, exc, exc_info=True)

        return result

