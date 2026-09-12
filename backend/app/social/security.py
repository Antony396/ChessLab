"""Password hashing - PBKDF2-HMAC-SHA256 via the standard library, so this
needs no extra dependency (bcrypt/passlib aren't already installed). Fine
for this app's threat model (a local chess lab, not a bank)."""

from __future__ import annotations

import hashlib
import hmac
import os

_ITERATIONS = 200_000


def hash_password(password: str) -> tuple[str, str]:
    """Returns (password_hash, salt), both hex-encoded."""
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, _ITERATIONS)
    return digest.hex(), salt.hex()


def verify_password(password: str, password_hash: str, salt: str) -> bool:
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt), _ITERATIONS)
    return hmac.compare_digest(digest.hex(), password_hash)
