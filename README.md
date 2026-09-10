# Chess Game Analyzer (v1)

Enter a Chess.com or Lichess username, pick a recent game, and step through it
with Stockfish's evaluation, best-move suggestions, and Inaccuracy/Mistake/
Blunder classification (Lichess's win%-drop convention: 10/20/30 points).

No LLM, no accounts — v1 is honest engine data only. See `backend/app` for
the architecture notes (`GameProvider`, `Analyzer`, `GameAnalysis`) that keep
v2 (LLM explanations) and a future mobile client additive, not a rewrite.

## Prerequisites (already installed on this machine)

- Python 3.12 — installed via `winget install Python.Python.3.12`
- Stockfish 18 — installed via `winget install Stockfish.Stockfish`
  (also added a `stockfish` command-line alias; open a **new** terminal for
  it to be on PATH)
- Node.js — already present

## Run it

**Backend** (FastAPI on port 8000):

```powershell
cd backend
python -m venv venv          # first time only
./venv/Scripts/pip install -r requirements.txt   # first time only
./venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

**Frontend** (Vite dev server on port 5173), in a second terminal:

```powershell
cd frontend
npm install     # first time only
npm run dev
```

Then open http://localhost:5173, pick a platform, enter a username, fetch
games, click one, and let Stockfish analyse it (the first analysis of a game
can take anywhere from ~10s to a couple of minutes depending on game length
and the configured depth — it's cached after that, so re-opening the same
game is instant).

## Configuration

Environment variables (all optional, sane defaults):

| Variable | Default | Meaning |
|---|---|---|
| `STOCKFISH_PATH` | auto-detected | path to the Stockfish binary |
| `STOCKFISH_DEPTH` | `16` | search depth per position |
| `STOCKFISH_THREADS` | `2` | engine threads |
| `CHESS_EVAL_CONTACT_EMAIL` | `antony@hitti.com.au` | used in the Chess.com User-Agent header, per their API's requirement |
| `CHESS_EVAL_DB_PATH` | `backend/data/chess_eval.db` | SQLite cache location |

## Architecture

```
backend/app/
  models/game.py, analysis.py   # Game, MoveAnalysis, GameAnalysis (pydantic; the JSON contract)
  providers/                    # GameProvider ABC + ChessComProvider, LichessProvider
  analyzer/                     # Analyzer ABC + StockfishAnalyzer (all UCI/engine code lives here)
  api/routes.py                 # /api/games, /api/games/{id}, /api/games/{id}/analysis
  db.py                         # SQLite: HTTP ETag cache, fetched games, analysis cache
  http_client.py                # serial, rate-limited, ETag-aware GET (shared by both providers)
frontend/src/
  api.js                        # talks only to the backend's JSON API
  components/                   # SearchForm, GameList, BoardViewer, EvalGraph, MistakeList
```

- **Swapping the engine** (e.g. to WASM Stockfish for a hosted build) means
  writing a new `Analyzer` — nothing else changes.
- **A mobile client** talks to the same `/api/*` endpoints; the frontend has
  no chess logic of its own beyond replaying PGN moves with `chess.js` to
  render the board.
- **v2's LLM layer** consumes the `GameAnalysis` JSON (`GET
  /api/games/{id}/analysis`) unchanged — every fact (evals, best moves,
  classifications) already lives there; the LLM would only ever translate it
  to prose.

## Known issue: Lichess's game-export endpoint

As of testing (2026-09-04), Lichess's own `GET /api/games/user/{username}`
endpoint — which `LichessProvider` implements exactly per their published
OpenAPI spec — is returning `404` in production for every account tried,
including their own canonical example account from the docs. This was
confirmed from two independent networks, so it isn't a firewall/proxy issue
on this machine. **Chess.com works end-to-end and was fully verified** (see
below). If Lichess fetching still fails when you try it, it's very likely
still an outage/endpoint change on Lichess's side, not a bug here — worth a
quick check against `https://lichess.org/api/games/user/<any-active-username>`
directly before assuming otherwise.

## What's been verified

- Chess.com fetch → cache → Stockfish analysis → classification, run
  end-to-end against a real account (`hikaru`), including the full frontend
  flow (search → game list → board/eval graph/mistake list) driven in an
  actual browser with zero console errors.
- The mate-score edge case (the move that delivers checkmate itself) is
  correctly classified as `OK`, not a blunder — python-chess collapses
  "just delivered mate" and "just got mated" to the same `mate() == 0`,
  which needed explicit handling in `analyzer/classification.py`.
- Lichess provider code matches the current official spec but the live
  endpoint itself is down — see above.
