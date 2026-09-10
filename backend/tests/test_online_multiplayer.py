from tests.conftest import STANDARD_BLACK_BACK_RANK, STANDARD_WHITE_BACK_RANK


def _create_room(client, white_back_rank=None):
    resp = client.post(
        "/api/game/online/create",
        json={"white_back_rank": white_back_rank or STANDARD_WHITE_BACK_RANK},
    )
    assert resp.status_code == 200
    return resp.json()


def _join_room(client, room_id, black_back_rank=None):
    resp = client.post(
        f"/api/game/online/room/{room_id}/join",
        json={"black_back_rank": black_back_rank or STANDARD_BLACK_BACK_RANK},
    )
    assert resp.status_code == 200
    return resp.json()


def test_online_create_returns_a_room_and_white_token_with_no_game_yet(client):
    room = _create_room(client)
    assert room["room_id"]
    assert room["white_token"]


def test_online_create_enforces_the_points_budget(client):
    over_budget = {"a1": "R", "b1": "R", "c1": "R", "e1": "K", "d1": "Q", "f1": "R", "g1": "R"}
    resp = client.post("/api/game/online/create", json={"white_back_rank": over_budget})
    assert resp.status_code == 400
    assert "points" in resp.json()["detail"].lower()


def test_online_join_builds_the_game_and_returns_a_black_token(client):
    room = _create_room(client)
    joined = _join_room(client, room["room_id"])
    assert joined["black_token"]
    assert joined["black_token"] != room["white_token"]
    assert joined["turn"] == "white"
    assert joined["action_log"] == []


def test_online_join_lets_black_draft_a_real_deck_too(client):
    room = _create_room(client, white_back_rank={"e1": "K", "b1": "N"})
    joined = _join_room(
        client,
        room["room_id"],
        black_back_rank={"e8": "K", "b8": "A", "g8": "A"},
    )
    assert joined["black_archer_squares"] == ["b8", "g8"]
    import chess

    board = chess.Board(joined["fen"])
    assert board.piece_at(chess.B8) == chess.Piece(chess.KNIGHT, chess.BLACK)  # Archer stored as Knight
    assert board.piece_at(chess.G8) == chess.Piece(chess.KNIGHT, chess.BLACK)


def test_online_join_enforces_the_points_budget_on_black_too(client):
    room = _create_room(client)
    over_budget = {"a8": "R", "b8": "R", "c8": "R", "e8": "K", "d8": "Q", "f8": "R", "g8": "R"}
    resp = client.post(f"/api/game/online/room/{room['room_id']}/join", json={"black_back_rank": over_budget})
    assert resp.status_code == 400
    assert "points" in resp.json()["detail"].lower()


def test_online_join_rejects_a_second_join(client):
    room = _create_room(client)
    _join_room(client, room["room_id"])
    resp = client.post(f"/api/game/online/room/{room['room_id']}/join", json={"black_back_rank": STANDARD_BLACK_BACK_RANK})
    assert resp.status_code == 400
    assert "already has two players" in resp.json()["detail"].lower()


def test_online_join_rejects_unknown_room(client):
    resp = client.post("/api/game/online/room/does-not-exist/join", json={"black_back_rank": STANDARD_BLACK_BACK_RANK})
    assert resp.status_code == 404


def test_online_move_requires_the_correct_token(client):
    room = _create_room(client)
    joined = _join_room(client, room["room_id"])

    # Black's token trying to move on white's turn.
    resp = client.post(
        "/api/game/online/move",
        json={
            "game_id": joined["id"],
            "player_token": joined["black_token"],
            "from_square": "e2",
            "to_square": "e4",
        },
    )
    assert resp.status_code == 403

    resp = client.post(
        "/api/game/online/move",
        json={"game_id": joined["id"], "player_token": "not-a-real-token", "from_square": "e2", "to_square": "e4"},
    )
    assert resp.status_code == 403


def test_online_move_flow_alternates_turns_with_correct_tokens(client):
    room = _create_room(client)
    joined = _join_room(client, room["room_id"])

    resp = client.post(
        "/api/game/online/move",
        json={"game_id": joined["id"], "player_token": room["white_token"], "from_square": "e2", "to_square": "e4"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["turn"] == "black"
    assert body["action_log"] == ["e2-e4"]

    resp = client.post(
        "/api/game/online/move",
        json={"game_id": joined["id"], "player_token": joined["black_token"], "from_square": "e7", "to_square": "e5"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["turn"] == "white"
    assert body["action_log"] == ["e2-e4", "e7-e5"]


def test_online_move_rejects_on_a_non_online_game(client):
    # A regular /custom-setup game has no tokens at all.
    resp = client.post("/api/game/custom-setup", json={"white_back_rank": STANDARD_WHITE_BACK_RANK, "vs_ai": False})
    game_id = resp.json()["id"]
    resp = client.post(
        "/api/game/online/move",
        json={"game_id": game_id, "player_token": "whatever", "from_square": "e2", "to_square": "e4"},
    )
    assert resp.status_code == 400
    assert "online multiplayer game" in resp.json()["detail"].lower()


def test_online_room_websocket_receives_the_game_once_black_joins(client):
    room = _create_room(client)

    with client.websocket_connect(f"/api/game/online/room/{room['room_id']}/ws") as ws:
        joined = _join_room(client, room["room_id"])
        update = ws.receive_json()
        assert update["id"] == joined["id"]
        assert update["turn"] == "white"


def test_online_room_websocket_closes_for_unknown_room(client):
    from starlette.websockets import WebSocketDisconnect

    try:
        with client.websocket_connect("/api/game/online/room/does-not-exist/ws"):
            pass
        raised = False
    except WebSocketDisconnect:
        raised = True
    assert raised


def test_online_game_websocket_receives_the_current_state_on_connect_and_move_broadcasts(client):
    room = _create_room(client)
    joined = _join_room(client, room["room_id"])

    with client.websocket_connect(f"/api/game/online/{joined['id']}/ws") as ws:
        initial = ws.receive_json()
        assert initial["turn"] == "white"
        assert initial["action_log"] == []

        resp = client.post(
            "/api/game/online/move",
            json={
                "game_id": joined["id"],
                "player_token": room["white_token"],
                "from_square": "e2",
                "to_square": "e4",
            },
        )
        assert resp.status_code == 200

        update = ws.receive_json()
        assert update["turn"] == "black"
        assert update["action_log"] == ["e2-e4"]


def test_online_game_websocket_closes_for_unknown_game(client):
    from starlette.websockets import WebSocketDisconnect

    try:
        with client.websocket_connect("/api/game/online/does-not-exist/ws"):
            pass
        raised = False
    except WebSocketDisconnect:
        raised = True
    assert raised
