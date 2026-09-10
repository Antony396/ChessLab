"""In-process pub/sub for online-multiplayer game state, one topic per
game_id. Deliberately as simple as the in-memory game store itself - this
only needs to work within a single running server process (see store.py's
own docstring on that same tradeoff).
"""

from __future__ import annotations

from fastapi import WebSocket


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = {}

    async def connect(self, game_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections.setdefault(game_id, []).append(websocket)

    def disconnect(self, game_id: str, websocket: WebSocket) -> None:
        connections = self._connections.get(game_id)
        if not connections:
            return
        if websocket in connections:
            connections.remove(websocket)
        if not connections:
            del self._connections[game_id]

    async def broadcast(self, game_id: str, message: dict) -> None:
        dead: list[WebSocket] = []
        for websocket in self._connections.get(game_id, []):
            try:
                await websocket.send_json(message)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self.disconnect(game_id, websocket)


manager = ConnectionManager()
