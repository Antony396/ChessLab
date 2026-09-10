"""Shared HTTP fetch helper: one request at a time, ETag-aware, 429-tolerant.

Chess.com's API 429s on concurrent requests, so every provider funnels through
this single global lock rather than each running its own client.
"""

from __future__ import annotations

import threading
import time

import requests

from app import db

_lock = threading.Lock()
_last_request_at = 0.0


def serial_get(
    url: str,
    headers: dict | None = None,
    cache_key: str | None = None,
    min_interval: float = 1.0,
    max_retries: int = 5,
) -> tuple[str, str | None]:
    """GET a URL, serialised against every other serial_get call.

    If cache_key is given and we have a cached ETag, sends If-None-Match and
    reuses the cached body on a 304. Retries 429s with exponential backoff.
    Returns (body, etag).
    """
    global _last_request_at

    req_headers = dict(headers or {})
    cached = db.get_cached_response(cache_key) if cache_key else None
    if cached and cached.get("etag"):
        req_headers["If-None-Match"] = cached["etag"]

    with _lock:
        wait = min_interval - (time.time() - _last_request_at)
        if wait > 0:
            time.sleep(wait)

        attempt = 0
        while True:
            resp = requests.get(url, headers=req_headers, timeout=20)
            _last_request_at = time.time()

            if resp.status_code == 304 and cached:
                return cached["body"], cached.get("etag")

            if resp.status_code == 429:
                attempt += 1
                if attempt > max_retries:
                    resp.raise_for_status()
                time.sleep(min(2**attempt, 60))
                continue

            resp.raise_for_status()
            body = resp.text
            etag = resp.headers.get("ETag")
            if cache_key and etag:
                db.set_cached_response(cache_key, etag, body)
            return body, etag
