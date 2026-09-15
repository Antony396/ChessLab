import os
from pathlib import Path

from dotenv import load_dotenv

# Point the DB layer at the dedicated "testing" Neon branch (a copy-on-write
# branch of production, isolated from it) BEFORE app.config's module-level
# DATABASE_URL read happens via the app.main import below - tests writing
# real accounts into the actual production database, discovered the hard way
# when a pytest run littered it with rushtest_* rows, is exactly what this
# prevents. Overrides any DATABASE_URL already in the environment, unlike
# config.py's own load_dotenv call, since a test run must never silently fall
# through to the real one.
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env.test", override=True)

import pytest
from fastapi.testclient import TestClient

from app.db import init_db
from app.main import app

# A plain TestClient(app) (no `with`) never fires FastAPI's startup event,
# so init_db() - which is what actually adds any newly-introduced column
# (see db.py's own note on why the elo column is a separate ALTER rather
# than folding into the users table's CREATE) - would otherwise never run
# against this test branch at all. Idempotent, so safe to call once here
# rather than relying on lifespan firing.
init_db()


@pytest.fixture()
def client():
    return TestClient(app)


STANDARD_WHITE_BACK_RANK = {
    "a1": "R", "b1": "N", "c1": "B", "d1": "Q", "e1": "K", "f1": "B", "g1": "N", "h1": "R",
}
STANDARD_BLACK_BACK_RANK = {
    "a8": "R", "b8": "N", "c8": "B", "d8": "Q", "e8": "K", "f8": "B", "g8": "N", "h8": "R",
}
