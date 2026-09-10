FROM python:3.12-slim

# Debian's stockfish package puts the binary in /usr/games, which isn't on
# PATH for a non-interactive container process - STOCKFISH_PATH below points
# straight at it instead of relying on shutil.which() to find it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends stockfish \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

ENV STOCKFISH_PATH=/usr/games/stockfish
EXPOSE 8000

# Render injects PORT and routes traffic to whatever the container actually
# listens on - the shell form here lets $PORT override the 8000 default
# instead of hardcoding it.
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
