# Re-export canonical models from app.models.brand
from app.models.brand import TrademarkRegistry, MarketBrand

__all__ = ["TrademarkRegistry", "MarketBrand"]
