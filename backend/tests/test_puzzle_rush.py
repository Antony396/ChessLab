"""Regression coverage for Puzzle Rush - previously entirely untested,
which is exactly how "no moves lead to a success" shipped: the frontend
always sends promotion="q" as a plain drag-and-drop default (even for a
non-promoting move), and chess.Move.uci() unconditionally appends that
promotion letter whenever one is set - so comparing full UCI strings meant
a correct non-promotion move ("e2e4") never matched because the
reconstructed move had become "e2e4q". See puzzle_rush_routes.py's
submit_move for the fix (compare by from/to squares only, trust the
puzzle's own solution string for the actual push).
"""

import random
import string

import chess

from app.puzzle_rush import store


def _register(client) -> str:
    username = "rushtest_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
    resp = client.post("/api/social/register", json={"username": username, "password": "password123"})
    assert resp.status_code == 200
    return resp.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def _start_rush(client, token, monkeypatch, puzzle_index):
    monkeypatch.setattr(store, "pick_start_index", lambda: puzzle_index)
    resp = client.post("/api/puzzle-rush/start", json={"duration_seconds": 180}, headers=_auth(token))
    assert resp.status_code == 200
    return resp.json()


def test_correct_non_promotion_move_is_accepted_even_with_promotion_q_sent(client, monkeypatch):
    # Puzzle 0's first solver move is a5a2 - not a promotion at all, but
    # the real frontend always sends promotion="q" anyway (see
    # PuzzleRush.jsx's handlePieceDrop). This is the exact bug: before the
    # fix, this always registered as wrong.
    puzzle = store.puzzle_at(0)
    assert puzzle.solution_moves[0] == "a5a2"

    token = _register(client)
    started = _start_rush(client, token, monkeypatch, 0)

    resp = client.post(
        "/api/puzzle-rush/move",
        json={"session_id": started["session_id"], "from_square": "a5", "to_square": "a2", "promotion": "q"},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["correct"] is True
    assert body["puzzle_solved"] is False

    # The opponent's forced reply (solution_moves[1] = b1a2) should have
    # been auto-played too.
    board = chess.Board(body["fen"])
    assert board.piece_at(chess.A2) is not None


def test_wrong_move_does_not_advance_and_is_reported_incorrect(client, monkeypatch):
    puzzle = store.puzzle_at(0)
    token = _register(client)
    started = _start_rush(client, token, monkeypatch, 0)

    resp = client.post(
        "/api/puzzle-rush/move",
        json={"session_id": started["session_id"], "from_square": "a5", "to_square": "a4", "promotion": "q"},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["correct"] is False
    assert body["fen"] == started["fen"]  # position unchanged
    assert body["fen"] == puzzle.start_fen


def test_solving_the_full_puzzle_scores_a_point_and_serves_the_next_one(client, monkeypatch):
    puzzle = store.puzzle_at(0)
    assert puzzle.solution_moves == ["a5a2", "b1a2", "d6a6", "a2b1", "a6a1"]

    token = _register(client)
    started = _start_rush(client, token, monkeypatch, 0)
    session_id = started["session_id"]

    # Solver moves are indices 0, 2, 4 - the opponent's replies (1, 3) are
    # auto-played by the server.
    solver_moves = [puzzle.solution_moves[0], puzzle.solution_moves[2], puzzle.solution_moves[4]]
    last_body = None
    for uci in solver_moves:
        move = chess.Move.from_uci(uci)
        resp = client.post(
            "/api/puzzle-rush/move",
            json={
                "session_id": session_id,
                "from_square": chess.square_name(move.from_square),
                "to_square": chess.square_name(move.to_square),
                "promotion": "q",
            },
            headers=_auth(token),
        )
        assert resp.status_code == 200
        last_body = resp.json()
        assert last_body["correct"] is True

    assert last_body["puzzle_solved"] is True
    assert last_body["next_puzzle"] is True
    assert last_body["score"] == 1
    assert last_body["fen"] == store.puzzle_at(1).start_fen


def test_underpromotion_puzzle_is_accepted_regardless_of_client_promotion_choice(client, monkeypatch):
    # Puzzle 812's first solver move is e7e8n - a Knight underpromotion.
    # The client always guesses "q" (see PuzzleRush.jsx) - correctness must
    # not depend on that guess matching the puzzle's actual intended piece,
    # since there's no promotion-choice UI at all. The move actually
    # applied still comes from the puzzle's own trusted solution string, so
    # the board ends up with the correct Knight regardless.
    puzzle = store.puzzle_at(812)
    assert puzzle.solution_moves[0] == "e7e8n"

    token = _register(client)
    started = _start_rush(client, token, monkeypatch, 812)

    resp = client.post(
        "/api/puzzle-rush/move",
        json={"session_id": started["session_id"], "from_square": "e7", "to_square": "e8", "promotion": "q"},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["correct"] is True
    board = chess.Board(body["fen"])
    promoted = board.piece_at(chess.E8)
    assert promoted is not None
    assert promoted.piece_type == chess.KNIGHT  # the puzzle's real intended piece, not the client's "q" guess


def test_move_after_time_runs_out_reports_game_over(client, monkeypatch):
    token = _register(client)
    started = _start_rush(client, token, monkeypatch, 0)
    monkeypatch.setattr(store, "time_remaining", lambda session: 0.0)

    resp = client.post(
        "/api/puzzle-rush/move",
        json={"session_id": started["session_id"], "from_square": "a5", "to_square": "a2", "promotion": "q"},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["game_over"] is True
    assert body["correct"] is False
