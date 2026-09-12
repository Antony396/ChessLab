import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.custom_game_routes import router as custom_game_router
from app.api.online_game_routes import router as online_game_router
from app.api.routes import router
from app.api.social_routes import router as social_router
from app.db import init_db

app = FastAPI(title="Chess Game Analyzer")

# In production (Render), set CORS_ALLOWED_ORIGINS to the deployed frontend's
# origin(s), comma-separated (e.g. "https://your-app.vercel.app"). Local dev
# origins are always allowed on top of whatever that adds.
_extra_origins = [o.strip() for o in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", *_extra_origins],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    init_db()


@app.get("/health")
def health():
    return {"status": "ok"}


app.include_router(router, prefix="/api")
app.include_router(custom_game_router, prefix="/api/game")
app.include_router(online_game_router, prefix="/api/game")
app.include_router(social_router, prefix="/api/social")
