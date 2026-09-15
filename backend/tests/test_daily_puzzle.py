"""Daily Puzzle: posting a puzzle, fetching today's, solving it move by
move (including the auto-played opponent reply), and the resulting streak
- see db.py's record_daily_solve for the actual streak math and
daily_puzzle_routes.py for the endpoints this drives end to end."""

import uuid
from datetime import date, timedelta

from app import db


def _register(client, base):
    resp = client.post(
        "/api/social/register", json={"username": f"{base}{uuid.uuid4().hex[:6]}", "password": "testpass123"}
    )
    assert resp.status_code == 200
    body = resp.json()
    return body["token"], body["user"]["id"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_post_and_fetch_todays_puzzle(client):
    token, user_id = _register(client, "dpPost")
    puzzle_date = db.today_string()

    resp = client.post(
        "/api/daily-puzzle",
        json={
            "puzzle_date": puzzle_date,
            "white_back_rank": {"e1": "K", "b1": "N"},
            "black_back_rank": {"a8": "K"},
            "solution": [{"from_square": "b1", "to_square": "c3", "shoot": False}],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["puzzle_date"] == puzzle_date

    today = client.get("/api/daily-puzzle/today", headers=_auth(token))
    assert today.status_code == 200, today.text
    body = today.json()
    assert body["puzzle_date"] == puzzle_date
    assert body["already_solved_today"] is False
    assert body["current_streak"] == 0
    assert body["my_side"] == "white"


def test_post_rejects_an_illegal_first_move(client):
    token, _ = _register(client, "dpBad")
    resp = client.post(
        "/api/daily-puzzle",
        json={
            "puzzle_date": db.today_string(),
            "white_back_rank": {"e1": "K", "b1": "N"},
            "black_back_rank": {"a8": "K"},
            # h8 is nowhere near a legal Knight move from b1.
            "solution": [{"from_square": "b1", "to_square": "h8", "shoot": False}],
        },
        headers=_auth(token),
    )
    assert resp.status_code == 400
    assert "not legal" in resp.json()["detail"].lower()


def test_solving_todays_puzzle_starts_a_streak_at_one(client):
    token, user_id = _register(client, "dpSolve")
    puzzle_date = db.today_string()
    client.post(
        "/api/daily-puzzle",
        json={
            "puzzle_date": puzzle_date,
            "white_back_rank": {"e1": "K", "b1": "N"},
            "black_back_rank": {"a8": "K"},
            "solution": [{"from_square": "b1", "to_square": "c3", "shoot": False}],
        },
        headers=_auth(token),
    )
    client.get("/api/daily-puzzle/today", headers=_auth(token))  # starts the attempt

    wrong = client.post(
        "/api/daily-puzzle/move", json={"from_square": "e1", "to_square": "e2", "shoot": False}, headers=_auth(token)
    )
    assert wrong.status_code == 200
    assert wrong.json()["correct"] is False
    assert wrong.json()["puzzle_solved"] is False

    right = client.post(
        "/api/daily-puzzle/move", json={"from_square": "b1", "to_square": "c3", "shoot": False}, headers=_auth(token)
    )
    assert right.status_code == 200, right.text
    body = right.json()
    assert body["correct"] is True
    assert body["puzzle_solved"] is True
    assert body["current_streak"] == 1
    assert body["longest_streak"] == 1
    assert db.get_streak(user_id)["last_solved_date"] == puzzle_date


def test_streak_resumes_from_yesterday_and_resets_on_a_gap(client):
    token, user_id = _register(client, "dpStreak")
    today = date.today()
    yesterday = (today - timedelta(days=1)).isoformat()
    three_days_ago = (today - timedelta(days=3)).isoformat()

    # A gap before today (last solve was 3 days ago, not yesterday) resets
    # to 1 rather than continuing a stale streak.
    db.record_daily_solve(user_id, three_days_ago)
    result = db.record_daily_solve(user_id, today.isoformat())
    assert result["current_streak"] == 1

    # Solving on consecutive days keeps incrementing.
    db.record_daily_solve(user_id, yesterday)
    result = db.record_daily_solve(user_id, today.isoformat())
    assert result["current_streak"] == 2
    assert result["longest_streak"] == 2

    # Re-recording the same day again is a no-op, not a double-count.
    result_again = db.record_daily_solve(user_id, today.isoformat())
    assert result_again["current_streak"] == 2


def test_streak_of_ten_unlocks_the_skin_flag(client):
    token, user_id = _register(client, "dpUnlock")
    day = date.today() - timedelta(days=20)
    for i in range(10):
        db.record_daily_solve(user_id, (day + timedelta(days=i)).isoformat())
    streak = db.get_streak(user_id)
    assert streak["current_streak"] == 10
    assert streak["current_streak"] >= db.STREAK_UNLOCK_SKIN_DAYS
