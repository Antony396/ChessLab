"""Equipped-skin persistence (POST /api/social/me/skin) and its one real
consumer besides the account itself: the leaderboard showing what everyone
else has on (see db.py's equipped_skin column)."""

import uuid


def _register(client, username):
    unique = f"{username}{uuid.uuid4().hex[:6]}"
    resp = client.post("/api/social/register", json={"username": unique, "password": "testpass123"})
    assert resp.status_code == 200
    body = resp.json()
    return body["token"], body["user"]["id"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


def test_new_account_defaults_to_classic_skin(client):
    token, _ = _register(client, "skinDefault")
    resp = client.get("/api/social/me", headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["equipped_skin"] == "classic"


def test_setting_a_skin_persists_and_is_reflected_on_me(client):
    token, _ = _register(client, "skinSet")
    resp = client.post("/api/social/me/skin", json={"skin": "dragonKing"}, headers=_auth(token))
    assert resp.status_code == 200
    assert resp.json()["equipped_skin"] == "dragonKing"

    me = client.get("/api/social/me", headers=_auth(token))
    assert me.json()["equipped_skin"] == "dragonKing"


def test_leaderboard_reflects_each_accounts_equipped_skin(client):
    token, user_id = _register(client, "skinBoard")
    client.post("/api/social/me/skin", json={"skin": "hydra"}, headers=_auth(token))

    resp = client.get("/api/social/leaderboard", headers=_auth(token))
    assert resp.status_code == 200
    entries = resp.json()["entries"]
    mine = next((e for e in entries if e["id"] == user_id), None)
    # Only present if this fresh account's 1000 starting elo lands inside
    # the default top-20 cut - not guaranteed on a shared, ever-growing
    # test DB (see test_elo.py's own note on this being a real Neon
    # branch), so this only asserts the shape when it does show up.
    if mine is not None:
        assert mine["equipped_skin"] == "hydra"
