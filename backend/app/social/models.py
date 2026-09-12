from __future__ import annotations

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


class FriendPublic(BaseModel):
    id: str
    username: str
    online: bool


class SendFriendRequestPayload(BaseModel):
    to_user_id: str


class ChallengeRequest(BaseModel):
    to_user_id: str
    white_back_rank: dict[str, str]
    white_evolved_squares: list[str] = []
