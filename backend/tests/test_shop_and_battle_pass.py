"""Shop purchases and battle pass claims - both spend currency in opposite
directions (shop takes it, battle pass pays it out) and both need their own
account, so each test registers fresh rather than sharing state."""

import uuid

from app import db


def _register(client, username):
    unique = f"{username}{uuid.uuid4().hex[:6]}"
    resp = client.post("/api/social/register", json={"username": unique, "password": "testpass123"})
    assert resp.status_code == 200
    body = resp.json()
    return body["token"], body["user"]["id"]


def _auth(token):
    return {"Authorization": f"Bearer {token}"}


# --- Shop --------------------------------------------------------------------


def test_shop_state_starts_empty(client):
    token, user_id = _register(client, "shopEmpty")
    resp = client.get("/api/social/shop/state", headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["currency"] == 0
    assert body["owned_skins"] == []


def test_purchase_fails_without_enough_currency(client):
    token, user_id = _register(client, "shopPoor")
    resp = client.post("/api/social/shop/purchase", json={"skin": "dragonKing"}, headers=_auth(token))
    assert resp.status_code == 409
    assert "currency" in resp.json()["detail"].lower()


def test_purchase_succeeds_and_deducts_the_real_server_side_price(client):
    token, user_id = _register(client, "shopRich")
    db.add_currency(user_id, 1000)
    cost = db.SHOP_CATALOG["dragonKing"]

    resp = client.post("/api/social/shop/purchase", json={"skin": "dragonKing"}, headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["currency"] == 1000 - cost
    assert "dragonKing" in body["owned_skins"]


def test_purchase_ignores_any_client_supplied_price(client):
    # The request model has no cost field at all - a client can only ever
    # name the skin, never what it should be charged. This just confirms
    # the server's own SHOP_CATALOG price is what actually gets deducted
    # even if the request body tries to smuggle a different number in.
    token, user_id = _register(client, "shopTamper")
    db.add_currency(user_id, 1000)
    resp = client.post(
        "/api/social/shop/purchase",
        json={"skin": "dragonKing", "cost": 1},
        headers=_auth(token),
    )
    assert resp.status_code == 200
    assert resp.json()["currency"] == 1000 - db.SHOP_CATALOG["dragonKing"]


def test_purchase_rejects_buying_the_same_skin_twice(client):
    token, user_id = _register(client, "shopTwice")
    db.add_currency(user_id, 1000)
    assert client.post("/api/social/shop/purchase", json={"skin": "dragonKing"}, headers=_auth(token)).status_code == 200
    resp = client.post("/api/social/shop/purchase", json={"skin": "dragonKing"}, headers=_auth(token))
    assert resp.status_code == 409
    assert "already own" in resp.json()["detail"].lower()


def test_purchase_rejects_a_skin_thats_not_for_sale(client):
    token, user_id = _register(client, "shopFree")
    db.add_currency(user_id, 1000)
    resp = client.post("/api/social/shop/purchase", json={"skin": "classic"}, headers=_auth(token))
    assert resp.status_code == 409
    assert "shop" in resp.json()["detail"].lower()


# --- Battle pass ---------------------------------------------------------------


def test_battle_pass_state_at_level_one_can_claim_just_that_level(client):
    token, user_id = _register(client, "bpFresh")
    resp = client.get("/api/social/battle-pass/state", headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["level"] == 1
    assert body["claimable_levels"] == [1]  # level 1's own reward, claimable from 0 XP
    assert body["claimed_levels"] == []


def test_battle_pass_claim_rejects_a_level_not_yet_reached(client):
    token, user_id = _register(client, "bpTooSoon")
    resp = client.post("/api/social/battle-pass/claim", json={"level": 2}, headers=_auth(token))
    assert resp.status_code == 409
    assert "reached" in resp.json()["detail"].lower()


def test_battle_pass_claim_pays_out_and_cant_be_claimed_twice(client):
    token, user_id = _register(client, "bpClaim")
    db.add_xp(user_id, db.xp_for_level(3))  # reach level 3 exactly
    assert db.get_currency(user_id) == 0

    resp = client.post("/api/social/battle-pass/claim", json={"level": 2}, headers=_auth(token))
    assert resp.status_code == 200
    body = resp.json()
    assert db.get_currency(user_id) == db.battle_pass_reward_for_level(2)
    assert body["claimed_levels"] == [2]
    assert body["claimable_levels"] == [1, 3]  # 2 is now claimed, 1 and 3 still aren't

    resp = client.post("/api/social/battle-pass/claim", json={"level": 2}, headers=_auth(token))
    assert resp.status_code == 409
    assert "claimed" in resp.json()["detail"].lower()
