"""Motor determinista de Cero One City.

Python puro: sin FastAPI, sin Redis, sin SQLAlchemy, sin floats, sin random global.
Firma central (Fase 1): advance(state, orders_by_player) -> (new_state, events, order_errors)
"""

ENGINE_VERSION = "0.1.0"
