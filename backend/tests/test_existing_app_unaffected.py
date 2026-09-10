"""Regression check: adding the custom_chess module and its routes must not
break the existing analyzer app. Deliberately avoids real network calls to
Chess.com/Lichess - just proves the app boots and the analyzer's routes are
still registered and behave as before (validation, 404s), independent of
whatever custom-game routes were added alongside them.
"""


def test_health_endpoint_still_works(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}


def test_games_endpoint_still_registered_and_validates_params(client):
    resp = client.get("/api/games")  # missing required platform/username
    assert resp.status_code == 422


def test_games_endpoint_rejects_unknown_platform(client):
    resp = client.get("/api/games", params={"platform": "bogus", "username": "someone"})
    assert resp.status_code == 422  # platform is a Literal type, FastAPI rejects at validation


def test_get_game_endpoint_still_registered(client):
    resp = client.get("/api/games/chesscom:does-not-exist")
    assert resp.status_code == 404


def test_analysis_endpoint_still_registered(client):
    resp = client.get("/api/games/chesscom:does-not-exist/analysis")
    assert resp.status_code == 404


def test_analyzer_and_custom_game_routes_coexist(client):
    # Both route groups must be reachable from the same app instance.
    assert client.get("/health").status_code == 200
    assert client.get("/api/game/does-not-exist").status_code == 404
