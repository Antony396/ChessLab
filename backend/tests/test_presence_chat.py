"""Regression coverage for the dorm-room chat feature's sanitization logic
(see social_routes.py's _sanitize_chat_text, used by presence_ws's "chat"
message handler). Deliberately not a multi-socket relay test: two
concurrent WebSocket TestClient connections in this environment have
previously hung rather than failed cleanly (see this project's Puppeteer
multi-page notes for the same class of issue) - the actual relay behavior
is instead verified live against a running dev server."""

from app.api.social_routes import CHAT_MAX_LENGTH, _sanitize_chat_text


def test_blank_or_missing_text_is_rejected():
    assert _sanitize_chat_text(None) is None
    assert _sanitize_chat_text("") is None
    assert _sanitize_chat_text("   ") is None
    assert _sanitize_chat_text("\t\n") is None


def test_leading_and_trailing_whitespace_is_trimmed():
    assert _sanitize_chat_text("  hello there  ") == "hello there"


def test_message_is_capped_at_the_max_length():
    text = _sanitize_chat_text("x" * 500)
    assert text is not None
    assert len(text) == CHAT_MAX_LENGTH
    assert text == "x" * CHAT_MAX_LENGTH


def test_normal_message_passes_through_unchanged():
    assert _sanitize_chat_text("hey, good game!") == "hey, good game!"
