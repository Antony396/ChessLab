"""Save/load for a player's own drafted decks - two named slots per account,
persisted in SQLite (see db.py's saved_decks table) so they survive a
session/browser change, unlike everything in custom_chess/store.py.

A "deck" here is exactly DeckBuilder.jsx's own in-memory shape: an 8-entry
array of piece letters (or null), file-indexed, plus which of those indices
are evolved - not tied to a rank, so a deck saved while playing White loads
back in identically the next time regardless of which color the player ends
up drafting for.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app import db
from app.social.auth import get_current_user_id

router = APIRouter()

MAX_SLOT = 2


class SavedDeckPayload(BaseModel):
    name: str = Field(min_length=1, max_length=40)
    deck: list[Optional[str]] = Field(min_length=8, max_length=8)
    evolved_indices: list[int] = []


class SavedDeckPublic(BaseModel):
    slot: int
    name: str
    deck: list[Optional[str]]
    evolved_indices: list[int]


@router.get("", response_model=list[SavedDeckPublic])
def list_decks(user_id: str = Depends(get_current_user_id)):
    return db.list_saved_decks(user_id)


@router.put("/{slot}", response_model=SavedDeckPublic)
def save_deck(slot: int, payload: SavedDeckPayload, user_id: str = Depends(get_current_user_id)):
    if slot < 1 or slot > MAX_SLOT:
        raise HTTPException(400, f"Slot must be between 1 and {MAX_SLOT}")
    db.save_deck(user_id, slot, payload.name, payload.deck, payload.evolved_indices)
    return SavedDeckPublic(slot=slot, name=payload.name, deck=payload.deck, evolved_indices=payload.evolved_indices)


@router.delete("/{slot}")
def delete_deck(slot: int, user_id: str = Depends(get_current_user_id)):
    if slot < 1 or slot > MAX_SLOT:
        raise HTTPException(400, f"Slot must be between 1 and {MAX_SLOT}")
    db.delete_saved_deck(user_id, slot)
    return {"deleted": True}
