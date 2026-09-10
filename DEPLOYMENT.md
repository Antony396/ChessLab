# Deploying Hero Chess (frontend on Vercel, backend on Render)

This covers getting the app live on the web with real-time multiplayer
working. I can't create accounts or authenticate to Vercel/Render on your
behalf, so the account-linking steps below are yours to click through — the
repo is already set up so there's nothing to figure out once you're there.

## Why the backend can't live on Vercel too

Vercel's serverless functions are stateless (each request can hit a fresh,
short-lived instance) and don't reliably support long-lived native
subprocesses. This backend keeps games in memory and shells out to a real
Stockfish binary for the AI, so it needs a normal always-on host instead.
Render (or Railway/Fly.io) works fine for that; Vercel is genuinely the
right choice for the React frontend.

## 1. Push this repo to GitHub

Both Render and Vercel deploy from a git repo. From the repo root:

```bash
git init
git add .
git commit -m "Initial commit"
```

Then create a repo on GitHub and push to it (`git remote add origin ...`,
`git push -u origin main`). Take a look at what `git add .` picked up first —
there are a few large reference PNGs at the repo root
(`Realchessassets.png`, `allChesspeices.png`, `better2d peices and board.png`)
that aren't used by the running app; drop them from the commit (or add them
to `.gitignore`) if you'd rather not push ~5MB of unused images.

## 2. Backend on Render

1. On Render: **New +** → **Blueprint**, point it at your GitHub repo. It
   should pick up `render.yaml` at the repo root automatically and configure
   a Docker web service from `backend/Dockerfile`.
   - If you'd rather set it up by hand instead: **New +** → **Web Service**,
     select the repo, set **Root Directory** to `backend`, **Runtime** to
     **Docker** (Dockerfile at `Dockerfile`), plan **Free** is fine to start.
2. Leave `CORS_ALLOWED_ORIGINS` blank for now - you'll fill it in after step 3.
3. Deploy. Once live, note the service URL, e.g. `https://chess-eval-backend.onrender.com`.
4. Sanity check: `https://<that-url>/health` should return `{"status":"ok"}`.

**Free-tier note:** Render's free web services spin down after 15 minutes of
inactivity and take 30-60s to cold-start on the next request. That cold
start will also drop any open multiplayer WebSocket connections - the
frontend already auto-reconnects, but the first move after a quiet period
may feel slow. Fine for testing; consider a paid instance if that matters
for real use.

## 3. Frontend on Vercel

1. On Vercel: **Add New** → **Project**, import the same GitHub repo. The
   root-level `vercel.json` tells it to build from `frontend/` - you
   shouldn't need to change the framework preset or root directory manually.
2. Add an environment variable: `VITE_API_BASE_URL` = the Render URL from
   step 2 (e.g. `https://chess-eval-backend.onrender.com`, no trailing slash).
3. Deploy. Note the resulting URL, e.g. `https://your-app.vercel.app`.

## 4. Close the loop: CORS

Back on Render, set `CORS_ALLOWED_ORIGINS` to the Vercel URL from step 3
(comma-separate more than one, e.g. if you also test from a preview-deploy
URL) and redeploy the backend. Without this, the browser will block every
request from the deployed frontend with a CORS error even though the
backend is up.

## 5. Try it

Open the Vercel URL, go to Hero Chess, build a deck, click **Play Online**,
and share the link it gives you (it'll already point at your deployed
frontend) with someone else - they land on their own deck builder, draft
their own army for black, and once they hit **Join Game** both players are
dropped into the same live match with moves syncing over WebSocket.

## What's still local-only / simplified

- **Game state lives in memory** on the Render instance - a redeploy or
  restart loses in-progress games and pending rooms. Fine for casual use;
  would need a real database (Postgres/Redis) to survive restarts or to
  scale beyond one instance.
- **No reconnection to a game after closing the tab** - the join link only
  works once (claims the one black slot, and the room stops accepting a
  second join once a game exists for it); refreshing mid-game (or while
  waiting for an opponent) works fine - the session is kept in
  `sessionStorage` and the socket reconnects - but there's no "resume as the
  player you already were" flow after fully closing the tab.
