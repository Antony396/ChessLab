"""Accounts, friends, live dorm-visiting presence, and code-free PvP
challenges.

Accounts and friendships are persisted in SQLite (see db.py); sessions and
live presence (who's online, whose dorm each connection is currently
looking at) are in-memory only (see social/store.py) - restarting the
server logs everyone out, same tradeoff the rest of this app already makes
for anything that doesn't need to survive one.

A "challenge" reuses the existing online-multiplayer room machinery
(custom_chess/store.py's PendingRoom + online_game_routes.py's join/move/ws
endpoints) almost entirely as-is - the only new part is delivering the
room_id straight to a specific friend's presence connection instead of
making the challenger copy/paste a shareable link.
"""

from __future__ import annotations

import re
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, WebSocket, WebSocketDisconnect

from app import db
from app.api.custom_game_routes import _build_game_from_two_decks, _to_state, _validate_deck_points
from app.custom_chess import store as game_store
from app.custom_chess.ws_manager import manager
from app.social import store
from app.social.auth import get_current_user_id
from app.social.models import (
    AuthResponse,
    BattlePassClaimRequest,
    BattlePassStateResponse,
    ChallengeRequest,
    ChallengeResponse,
    FriendPublic,
    FriendRequestPublic,
    LeaderboardEntry,
    LeaderboardResponse,
    LoginRequest,
    RegisterRequest,
    SendFriendRequestPayload,
    SetSkinRequest,
    ShopPurchaseRequest,
    ShopStateResponse,
    SimulRespondRequest,
    SimulSubmitRequest,
    UserPublic,
    UserSearchResult,
)
from app.social.security import hash_password, verify_password

router = APIRouter()

_USERNAME_RE = re.compile(r"^[A-Za-z0-9_]{3,20}$")


def _user_public(row) -> UserPublic:
    xp = row.get("xp", 0)
    return UserPublic(
        id=row["id"],
        username=row["username"],
        elo=row.get("elo", db.DEFAULT_ELO),
        currency=row.get("currency", 0),
        equipped_skin=row.get("equipped_skin") or db.DEFAULT_EQUIPPED_SKIN,
        xp=xp,
        level=db.level_for_xp(xp),
    )


# --- Registration / login ---------------------------------------------------


@router.post("/register", response_model=AuthResponse)
def register(payload: RegisterRequest):
    username = payload.username.strip()
    if not _USERNAME_RE.match(username):
        raise HTTPException(400, "Username must be 3-20 characters: letters, numbers, or underscores")
    if len(payload.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters")

    password_hash, salt = hash_password(payload.password)
    try:
        user = db.create_user(username, password_hash, salt)
    except db.UsernameTakenError:
        raise HTTPException(409, "That username is already taken")

    token = store.create_session(user["id"])
    return AuthResponse(token=token, user=UserPublic(id=user["id"], username=user["username"], elo=db.DEFAULT_ELO))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest):
    row = db.get_user_by_username(payload.username.strip())
    if row is None or not verify_password(payload.password, row["password_hash"], row["password_salt"]):
        raise HTTPException(401, "Incorrect username or password")
    token = store.create_session(row["id"])
    return AuthResponse(token=token, user=_user_public(row))


@router.get("/leaderboard", response_model=LeaderboardResponse)
def leaderboard(limit: int = 20, user_id: str = Depends(get_current_user_id)):
    """Top `limit` accounts by ELO (see db.py's apply_elo_result for how it
    actually changes - only real online-game results move it). Always
    includes the caller's own rank/elo alongside the top-N list, even if
    they're well outside it, so "where do I stand" doesn't need a second
    request."""
    rows = db.get_leaderboard(limit)
    entries = [
        LeaderboardEntry(
            rank=i + 1,
            id=row["id"],
            username=row["username"],
            elo=row["elo"],
            equipped_skin=row.get("equipped_skin") or db.DEFAULT_EQUIPPED_SKIN,
        )
        for i, row in enumerate(rows)
    ]
    return LeaderboardResponse(
        entries=entries,
        my_rank=db.get_leaderboard_rank(user_id),
        my_elo=db.get_elo(user_id),
    )


@router.post("/logout")
def logout(authorization: str | None = Header(default=None)):
    if authorization and authorization.startswith("Bearer "):
        store.destroy_session(authorization[len("Bearer ") :].strip())
    return {"ok": True}


@router.get("/me", response_model=UserPublic)
def me(user_id: str = Depends(get_current_user_id)):
    row = db.get_user_by_id(user_id)
    if row is None:
        raise HTTPException(404, "User not found")
    return _user_public(row)


@router.post("/me/skin", response_model=UserPublic)
def set_my_skin(payload: SetSkinRequest, user_id: str = Depends(get_current_user_id)):
    """Persists the equipped King skin server-side (see db.py's
    equipped_skin column) - localStorage alone (skinStore.js) only ever
    answers "what does the skin picker show ME", not "what does everyone
    else see this account wearing" (the leaderboard, a dorm/Commons visit).
    No validation against the frontend's KING_SKINS registry - an
    unrecognized key just renders as the classic skin wherever it's shown,
    same fallback every other skin lookup in this app already uses."""
    db.set_equipped_skin(user_id, payload.skin)
    row = db.get_user_by_id(user_id)
    return _user_public(row)


# --- Shop --------------------------------------------------------------------


@router.get("/shop/state", response_model=ShopStateResponse)
def shop_state(user_id: str = Depends(get_current_user_id)):
    return ShopStateResponse(currency=db.get_currency(user_id), owned_skins=db.get_owned_skins(user_id))


@router.post("/shop/purchase", response_model=ShopStateResponse)
def shop_purchase(payload: ShopPurchaseRequest, user_id: str = Depends(get_current_user_id)):
    try:
        db.purchase_skin(user_id, payload.skin)
    except db.ShopPurchaseError as exc:
        detail = {
            db.SHOP_SKIN_NOT_FOR_SALE: "That skin isn't sold in the shop",
            db.SHOP_SKIN_ALREADY_OWNED: "You already own that skin",
            db.SHOP_SKIN_INSUFFICIENT_FUNDS: "Not enough currency for that skin",
        }.get(exc.reason, "Purchase failed")
        raise HTTPException(409, detail)
    return ShopStateResponse(currency=db.get_currency(user_id), owned_skins=db.get_owned_skins(user_id))


# --- Battle pass ---------------------------------------------------------------


def _battle_pass_state(user_id: str) -> BattlePassStateResponse:
    xp = db.get_xp(user_id)
    level = db.level_for_xp(xp)
    claimed = db.get_claimed_battle_pass_levels(user_id)
    claimable = [lvl for lvl in range(1, level + 1) if lvl not in claimed]
    return BattlePassStateResponse(
        level=level,
        xp=xp,
        xp_into_level=xp - db.xp_for_level(level),
        xp_for_next_level=db.xp_for_level(level + 1) - db.xp_for_level(level),
        claimed_levels=claimed,
        claimable_levels=claimable,
    )


@router.get("/battle-pass/state", response_model=BattlePassStateResponse)
def battle_pass_state(user_id: str = Depends(get_current_user_id)):
    return _battle_pass_state(user_id)


@router.post("/battle-pass/claim", response_model=BattlePassStateResponse)
def battle_pass_claim(payload: BattlePassClaimRequest, user_id: str = Depends(get_current_user_id)):
    try:
        db.claim_battle_pass_level(user_id, payload.level)
    except db.BattlePassClaimError as exc:
        detail = "That level hasn't been reached yet" if exc.reason == "not_reached" else "Already claimed"
        raise HTTPException(409, detail)
    return _battle_pass_state(user_id)


# --- Friends -----------------------------------------------------------------


@router.get("/users/search", response_model=list[UserSearchResult])
def search_users(q: str, user_id: str = Depends(get_current_user_id)):
    q = q.strip()
    if len(q) < 2:
        return []
    rows = db.search_users(q, exclude_user_id=user_id)
    results = []
    for row in rows:
        existing = db.get_friend_request_between(user_id, row["id"])
        if existing is None:
            relationship = "none"
        elif existing["status"] == "accepted":
            relationship = "friends"
        elif existing["from_user_id"] == user_id:
            relationship = "request_sent"
        else:
            relationship = "request_received"
        results.append(UserSearchResult(id=row["id"], username=row["username"], relationship=relationship))
    return results


@router.post("/friends/request")
async def send_friend_request(payload: SendFriendRequestPayload, user_id: str = Depends(get_current_user_id)):
    if payload.to_user_id == user_id:
        raise HTTPException(400, "You can't friend yourself")
    target = db.get_user_by_id(payload.to_user_id)
    if target is None:
        raise HTTPException(404, "User not found")

    existing = db.get_friend_request_between(user_id, payload.to_user_id)
    if existing is not None:
        if existing["status"] == "accepted":
            raise HTTPException(400, "Already friends")
        raise HTTPException(400, "A friend request already exists between you two")

    request_id = db.create_friend_request(user_id, payload.to_user_id)

    requester = db.get_user_by_id(user_id)
    for conn in store.connections_for_user(payload.to_user_id):
        try:
            await conn.websocket.send_json(
                {
                    "type": "friend_request",
                    "request": {"id": request_id, "from_user": {"id": user_id, "username": requester["username"]}},
                }
            )
        except Exception:
            pass
    return {"id": request_id}


@router.get("/friends/requests", response_model=list[FriendRequestPublic])
def list_requests(user_id: str = Depends(get_current_user_id)):
    rows = db.list_incoming_requests(user_id)
    return [
        FriendRequestPublic(id=r["id"], from_user=UserPublic(id=r["from_user_id"], username=r["from_username"]))
        for r in rows
    ]


@router.post("/friends/requests/{request_id}/accept")
def accept_request(request_id: str, user_id: str = Depends(get_current_user_id)):
    req = db.get_friend_request(request_id)
    if req is None or req["to_user_id"] != user_id or req["status"] != "pending":
        raise HTTPException(404, "Friend request not found")
    db.set_friend_request_status(request_id, "accepted")
    return {"ok": True}


@router.post("/friends/requests/{request_id}/decline")
def decline_request(request_id: str, user_id: str = Depends(get_current_user_id)):
    req = db.get_friend_request(request_id)
    if req is None or req["to_user_id"] != user_id or req["status"] != "pending":
        raise HTTPException(404, "Friend request not found")
    db.delete_friend_request(request_id)
    return {"ok": True}


@router.get("/friends", response_model=list[FriendPublic])
def list_friends(user_id: str = Depends(get_current_user_id)):
    rows = db.list_friends(user_id)
    return [
        FriendPublic(
            id=r["id"],
            username=r["username"],
            online=store.is_user_online(r["id"]),
            level=db.level_for_xp(r["xp"]),
            equipped_skin=r["equipped_skin"],
        )
        for r in rows
    ]


# --- Code-free PvP challenges --------------------------------------------
#
# Unlike the shareable-link online-room flow (custom_chess/store.py's
# PendingRoom, always seeded with white's already-drafted deck), a
# friend-to-friend challenge starts empty on both sides. The recipient must
# explicitly accept before either side sees a deck builder - the challenger
# sits on a "waiting for accept" screen (pushed forward by the
# "challenge_accepted" WS message below) rather than drafting alone in the
# meantime, so drafting genuinely starts for both sides together, right
# after acceptance, same as before this gate was added. A decline instead
# sends "challenge_declined" and tears the room down. Whoever finishes
# drafting first just waits (see /simul-room/{id}/ws) for the other.


@router.post("/challenge", response_model=ChallengeResponse)
async def challenge_friend(payload: ChallengeRequest, user_id: str = Depends(get_current_user_id)):
    if not db.are_friends(user_id, payload.to_user_id):
        raise HTTPException(403, "You can only challenge a friend")

    white_token = uuid.uuid4().hex
    black_token = uuid.uuid4().hex
    room = game_store.create_simul_room(white_token, black_token, challenger_id=user_id, black_user_id=payload.to_user_id)

    challenger = db.get_user_by_id(user_id)
    delivered = False
    for conn in store.connections_for_user(payload.to_user_id):
        try:
            await conn.websocket.send_json(
                {
                    "type": "challenge",
                    "room_id": room.id,
                    "black_token": black_token,
                    "from": {"id": user_id, "username": challenger["username"]},
                }
            )
            delivered = True
        except Exception:
            pass

    return ChallengeResponse(room_id=room.id, white_token=white_token, delivered=delivered)


@router.post("/simul-room/{room_id}/accept")
async def accept_simul_challenge(room_id: str, payload: SimulRespondRequest):
    room = game_store.get_simul_room(room_id)
    if room is None:
        raise HTTPException(404, "Room not found")
    if payload.token != room.black_token:
        raise HTTPException(403, "Invalid token")

    room.accepted = True
    for conn in store.connections_for_user(room.challenger_id):
        try:
            await conn.websocket.send_json({"type": "challenge_accepted", "room_id": room.id})
        except Exception:
            pass

    return {"accepted": True}


@router.post("/simul-room/{room_id}/decline")
async def decline_simul_challenge(room_id: str, payload: SimulRespondRequest):
    room = game_store.get_simul_room(room_id)
    if room is None:
        raise HTTPException(404, "Room not found")
    if payload.token != room.black_token:
        raise HTTPException(403, "Invalid token")

    game_store.remove_simul_room(room_id)
    for conn in store.connections_for_user(room.challenger_id):
        try:
            await conn.websocket.send_json({"type": "challenge_declined", "room_id": room.id})
        except Exception:
            pass

    return {"declined": True}


@router.post("/simul-room/{room_id}/submit")
async def submit_simul_deck(room_id: str, payload: SimulSubmitRequest):
    room = game_store.get_simul_room(room_id)
    if room is None:
        raise HTTPException(404, "Room not found")
    if room.game_id is not None:
        raise HTTPException(400, "This game has already started")
    if not room.accepted:
        raise HTTPException(400, "This challenge hasn't been accepted yet")

    if payload.token == room.white_token:
        if room.white_back_rank is not None:
            raise HTTPException(400, "You've already submitted your deck")
        _validate_deck_points(payload.back_rank, payload.evolved_squares)
        room.white_back_rank = payload.back_rank
        room.white_evolved_squares = payload.evolved_squares
    elif payload.token == room.black_token:
        if room.black_back_rank is not None:
            raise HTTPException(400, "You've already submitted your deck")
        _validate_deck_points(payload.back_rank, payload.evolved_squares)
        room.black_back_rank = payload.back_rank
        room.black_evolved_squares = payload.evolved_squares
    else:
        raise HTTPException(403, "Invalid token")

    if room.white_back_rank is None or room.black_back_rank is None:
        return {"waiting": True, "game": None}

    game = _build_game_from_two_decks(
        room.white_back_rank, room.white_evolved_squares, room.black_back_rank, room.black_evolved_squares
    )
    game.white_token = room.white_token
    game.black_token = room.black_token
    game.white_user_id = room.challenger_id
    game.black_user_id = room.black_user_id
    room.game_id = game.id

    state = _to_state(game)
    # Whoever's still waiting (connected since right after they submitted -
    # see the ws endpoint below) gets the finished game pushed to them;
    # whoever submits second (here) gets it straight back in this response.
    await manager.broadcast(room_id, {**state.model_dump(), "ready": True})
    return {"waiting": False, "game": state.model_dump()}


@router.websocket("/simul-room/{room_id}/ws")
async def simul_room_ws(websocket: WebSocket, room_id: str):
    """Whoever finishes drafting first connects here and just waits - see
    online_game_routes.py's online_room_ws for the identical idea on the
    shareable-link flow this mirrors."""
    room = game_store.get_simul_room(room_id)
    if room is None:
        await websocket.close(code=4404)
        return

    await manager.connect(room_id, websocket)
    try:
        if room.game_id is not None:
            game = game_store.get_game(room.game_id)
            if game is not None:
                await websocket.send_json({**_to_state(game).model_dump(), "ready": True})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        manager.disconnect(room_id, websocket)


# --- Live presence: sessions, dorm-visiting, movement relay ----------------

CHAT_MAX_LENGTH = 200
# COMMONS_DORM_ID (see store.py for what it actually is) - imported rather
# than defined here now that bots.py also needs the same value.
# connections_in_dorm/_broadcast_to_dorm below don't need to know it's
# special at all: viewing_dorm_of is just a string key, so routing
# "everyone standing in the Commons right now" works identically to routing
# "everyone standing in Alice's dorm right now" - the only place that DOES
# need to know is the "visit" handler's friends-only check, which this
# bypasses.


def _sanitize_chat_text(raw: Optional[str]) -> Optional[str]:
    """Trims a dorm-chat message and caps its length; returns None for
    anything blank so callers can just skip broadcasting it. A pure
    function on purpose - lets this get unit-tested directly without
    spinning up any WebSocket at all."""
    if not raw:
        return None
    text = raw.strip()
    if not text:
        return None
    return text[:CHAT_MAX_LENGTH]


@router.websocket("/presence/ws")
async def presence_ws(websocket: WebSocket, token: str):
    user_id = store.get_user_id_for_token(token)
    if user_id is None:
        await websocket.close(code=4401)
        return
    user_row = db.get_user_by_id(user_id)
    if user_row is None:
        await websocket.close(code=4401)
        return

    await websocket.accept()
    conn = store.add_connection(user_id, user_row["username"], websocket)

    async def _send_dorm_snapshot(owner_id: str) -> None:
        occupants = [
            {"user_id": c.user_id, "username": c.username, "x": c.x, "y": c.y, "facing": c.facing, "skin": c.skin}
            for c in store.connections_in_dorm(owner_id, exclude_connection_id=conn.id)
        ]
        await websocket.send_json({"type": "dorm_snapshot", "owner_id": owner_id, "occupants": occupants})

    async def _broadcast_to_dorm(owner_id: str, message: dict) -> None:
        for peer in store.connections_in_dorm(owner_id, exclude_connection_id=conn.id):
            if peer.websocket is None:
                continue  # a bot (see social/bots.py) - nowhere real to send to
            try:
                await peer.websocket.send_json(message)
            except Exception:
                pass

    try:
        await _send_dorm_snapshot(user_id)
        while True:
            msg = await websocket.receive_json()
            msg_type = msg.get("type")

            if msg_type == "move":
                conn.x = msg.get("x", conn.x)
                conn.y = msg.get("y", conn.y)
                conn.facing = msg.get("facing", conn.facing)
                conn.skin = msg.get("skin", conn.skin)
                await _broadcast_to_dorm(
                    conn.viewing_dorm_of,
                    {
                        "type": "peer_move",
                        "user_id": conn.user_id,
                        "x": conn.x,
                        "y": conn.y,
                        "facing": conn.facing,
                        "skin": conn.skin,
                    },
                )

            elif msg_type == "visit":
                target_id = msg.get("user_id")
                if target_id != store.COMMONS_DORM_ID and target_id != user_id and not db.are_friends(user_id, target_id):
                    await websocket.send_json({"type": "error", "message": "You can only visit a friend's dorm"})
                    continue
                old_dorm = conn.viewing_dorm_of
                await _broadcast_to_dorm(old_dorm, {"type": "peer_left", "user_id": conn.user_id})
                conn.viewing_dorm_of = target_id
                await _send_dorm_snapshot(target_id)
                await _broadcast_to_dorm(
                    target_id,
                    {
                        "type": "peer_joined",
                        "user_id": conn.user_id,
                        "username": conn.username,
                        "x": conn.x,
                        "y": conn.y,
                        "facing": conn.facing,
                        "skin": conn.skin,
                    },
                )

            elif msg_type == "chat":
                # A speech-bubble message, scoped to whoever's currently in
                # the same dorm (naturally follows a visit, same as
                # movement/dorm-snapshot above - no special-casing needed).
                # The sender shows their own message locally the instant
                # they send it (see the frontend), same pattern as their
                # own avatar's movement, so this only relays to everyone
                # ELSE.
                text = _sanitize_chat_text(msg.get("text"))
                if text:
                    await _broadcast_to_dorm(
                        conn.viewing_dorm_of,
                        {"type": "chat", "user_id": conn.user_id, "username": conn.username, "text": text},
                    )

            elif msg_type == "leave":
                old_dorm = conn.viewing_dorm_of
                if old_dorm != user_id:
                    await _broadcast_to_dorm(old_dorm, {"type": "peer_left", "user_id": conn.user_id})
                    conn.viewing_dorm_of = user_id
                    await _send_dorm_snapshot(user_id)

    except WebSocketDisconnect:
        pass
    finally:
        store.remove_connection(conn.id)
        await _broadcast_to_dorm(conn.viewing_dorm_of, {"type": "peer_left", "user_id": conn.user_id})
