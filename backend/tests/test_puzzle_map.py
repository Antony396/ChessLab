"""Puzzle Map: the 50-node progression that replaced Puzzle Rush - node 1 is
always unlocked, each later node unlocks only once the one before it is
solved, and solving node 50 (the hand-authored Hydra mate) flips
unlocked_regal_skin. See puzzle_map/store.py for what each node actually is
and daily_puzzle_routes.py's _build_puzzle_game for the shared position
builder this reuses.
"""

import uuid

import chess

from app.puzzle_map import store as map_store


def _register(client, base):
    resp = client.post(
        "/api/social/register", json={"username": f"{base}{uuid.uuid4().hex[:6]}", "password": "testpass123"}
    )
    assert resp.status_code == 200
    return resp.json()["token"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_initial_state_has_only_node_one_unlocked(client):
    token = _register(client, "mapFresh")
    resp = client.get("/api/puzzle-map/state", headers=_auth(token))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["nodes"]) == map_store.MAP_LENGTH
    assert body["solved_count"] == 0
    assert body["unlocked_regal_skin"] is False
    assert body["nodes"][0]["unlocked"] is True
    assert body["nodes"][1]["unlocked"] is False
    assert body["nodes"][-1]["is_finale"] is True


def test_cannot_start_a_locked_node(client):
    token = _register(client, "mapLocked")
    resp = client.post("/api/puzzle-map/start", json={"index": 2}, headers=_auth(token))
    assert resp.status_code == 400


def test_solving_node_one_unlocks_node_two(client):
    token = _register(client, "mapSolve")
    node = map_store.node_at(1)
    # Solution alternates solver/opponent moves (indices 0, 2, 4, ...) - the
    # opponent's replies (1, 3, ...) are auto-played by the server, same as
    # the Daily Puzzle and the old Puzzle Rush before it.
    solver_moves = node["solution"][0::2]

    start = client.post("/api/puzzle-map/start", json={"index": 1}, headers=_auth(token))
    assert start.status_code == 200, start.text

    last_body = None
    for step in solver_moves:
        move = client.post(
            "/api/puzzle-map/move",
            json={"from_square": step["from_square"], "to_square": step["to_square"], "shoot": False},
            headers=_auth(token),
        )
        assert move.status_code == 200, move.text
        last_body = move.json()
        assert last_body["correct"] is True
    assert last_body["puzzle_solved"] is True

    state = client.get("/api/puzzle-map/state", headers=_auth(token)).json()
    assert state["nodes"][0]["solved"] is True
    assert state["nodes"][1]["unlocked"] is True
    assert state["nodes"][2]["unlocked"] is False


def test_wrong_move_does_not_advance_or_unlock(client):
    token = _register(client, "mapWrong")
    client.post("/api/puzzle-map/start", json={"index": 1}, headers=_auth(token))

    move = client.post(
        "/api/puzzle-map/move",
        json={"from_square": "a1", "to_square": "a1", "shoot": False},
        headers=_auth(token),
    )
    assert move.status_code == 200
    assert move.json()["correct"] is False

    state = client.get("/api/puzzle-map/state", headers=_auth(token)).json()
    assert state["nodes"][1]["unlocked"] is False


def test_solving_the_finale_hydra_node_unlocks_the_regal_skin(client):
    token = _register(client, "mapFinale")
    from app import db

    # Fast-forward to node 50 unlocked via the store directly rather than
    # playing all 49 earlier puzzles out through the API.
    user_id = client.get("/api/social/me", headers=_auth(token)).json()["id"]
    for i in range(1, map_store.MAP_LENGTH):
        db.record_map_solve(user_id, i)

    start = client.post("/api/puzzle-map/start", json={"index": map_store.MAP_LENGTH}, headers=_auth(token))
    assert start.status_code == 200, start.text
    assert start.json()["game"]["white_hydra_squares"] == ["a4"]

    move = client.post(
        "/api/puzzle-map/move", json={"from_square": "a4", "to_square": "a6", "shoot": False}, headers=_auth(token)
    )
    assert move.status_code == 200, move.text
    body = move.json()
    assert body["correct"] is True
    assert body["puzzle_solved"] is True
    assert body["game"]["status"] == "checkmate"
    assert body["unlocked_regal_skin"] is True


def test_node_forty_underpromotion_puzzle_solves_cleanly(client):
    # Node 40's first move promotes to a Knight (Lichess puzzle ZrgCo,
    # e7e8n) - auto-queening it instead (the old bug: _plain_node dropped
    # the promotion letter entirely) opens an extra diagonal that makes the
    # puzzle's own next move illegal, since a Queen on e8 covers c6 but a
    # Knight never would. Drives the full three-move solution through the
    # real API rather than just the store/engine layer, so this fails the
    # same way a player actually hit it (a 400 mid-solve) if it regresses.
    token = _register(client, "mapPromo")
    user_id = client.get("/api/social/me", headers=_auth(token)).json()["id"]
    for i in range(1, 40):
        from app import db

        db.record_map_solve(user_id, i)

    start = client.post("/api/puzzle-map/start", json={"index": 40}, headers=_auth(token))
    assert start.status_code == 200, start.text

    move1 = client.post(
        "/api/puzzle-map/move", json={"from_square": "e7", "to_square": "e8", "shoot": False}, headers=_auth(token)
    )
    assert move1.status_code == 200, move1.text
    assert move1.json()["correct"] is True

    move2 = client.post(
        "/api/puzzle-map/move", json={"from_square": "h7", "to_square": "c7", "shoot": False}, headers=_auth(token)
    )
    assert move2.status_code == 200, move2.text
    body = move2.json()
    assert body["correct"] is True
    assert body["puzzle_solved"] is True
    assert body["game"]["status"] == "checkmate"
