from __future__ import annotations

from typing import Optional

from pydantic import BaseModel


class RegisterRequest(BaseModel):
    username: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class UserPublic(BaseModel):
    id: str
    username: str
    elo: int = 1000
    currency: int = 0
    equipped_skin: str = "classic"
    xp: int = 0
    level: int = 1


class AuthResponse(BaseModel):
    token: str
    user: UserPublic


class UserSearchResult(BaseModel):
    id: str
    username: str
    # Already a friend, or a request already pending either direction - the
    # frontend uses this to grey out / relabel the "Add friend" button
    # instead of letting a duplicate request 400.
    relationship: str  # "none" | "friends" | "request_sent" | "request_received"


class FriendRequestPublic(BaseModel):
    id: str
    from_user: UserPublic


class LeaderboardEntry(BaseModel):
    rank: int
    id: str
    username: str
    elo: int
    equipped_skin: str = "classic"


class SetSkinRequest(BaseModel):
    skin: str


class LeaderboardResponse(BaseModel):
    entries: list[LeaderboardEntry]
    # My own standing, even if I fall outside `entries` (a short top-N list)
    # - None only if I'm somehow not a real account, which shouldn't happen
    # for an authenticated caller.
    my_rank: Optional[int] = None
    my_elo: Optional[int] = None


class FriendPublic(BaseModel):
    id: str
    username: str
    online: bool
    level: int


class SendFriendRequestPayload(BaseModel):
    to_user_id: str


class ChallengeRequest(BaseModel):
    to_user_id: str


class ChallengeResponse(BaseModel):
    room_id: str
    white_token: str
    delivered: bool


# Either side submits their own drafted deck independently, identified by
# whichever token the /challenge (or the "challenge" WS push) handed them -
# not by re-authenticating, since a challenge's two tokens already play the
# same "proves which color you are" role a shareable online-room link's do.
class SimulSubmitRequest(BaseModel):
    token: str
    back_rank: dict[str, str]
    evolved_squares: list[str] = []


# The recipient accepts/declines with just their own black_token - same
# "token proves who you are" idea as SimulSubmitRequest, no re-auth needed.
class SimulRespondRequest(BaseModel):
    token: str


# --- Shop / Battle pass -----------------------------------------------------


class ShopPurchaseRequest(BaseModel):
    skin: str


class ShopStateResponse(BaseModel):
    currency: int
    owned_skins: list[str]


class BattlePassStateResponse(BaseModel):
    level: int
    xp: int
    xp_into_level: int
    xp_for_next_level: int
    claimed_levels: list[int]
    claimable_levels: list[int]


class BattlePassClaimRequest(BaseModel):
    level: int
