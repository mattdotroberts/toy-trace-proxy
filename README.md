# Toy Trace companion proxy

A tiny zero-dependency Node server that gives the Toy Trace web app its AI
photo scanning. The app sends a toy photo here, this server asks the Thaura
model to identify the toy, and the answer goes back to the app, which matches
it against the researched database.

The AI key lives only on this server, never in the page or the repo.

## Configuration

The key is read in this order:

1. `THAURA_API_KEY` environment variable (if your host sets env vars), then
2. `/data/thaura_api_key`, a file written once through the `/setup` page.
   `/data` (the `DATA_DIR` environment variable) survives redeploys.

Optional: `SCAN_TOKEN` env var or a `/data/scan_token` file, in which case
scan requests must send it in an `X-Scan-Token` header.

## Deploy on build.happyoperators.com (or any Coolify-like host)

1. The repo is public: `https://github.com/mattdotroberts/toy-trace-proxy`.
   The deploy platform detects the Node app and sets `PORT` for you.
2. After it is live, open `https://<your-url>/setup` **once** and paste your
   Thaura API key. Create one at thaura.ai, account menu > API.
   Pay-as-you-go: $0.50 per million input tokens, $2.00 per million output.
   One scan is a few hundred tokens, so costs are pennies even with heavy use.
   The setup page closes itself after the key is saved (first save wins).
3. `GET /health` returns `{"ok":true,"configured":true}` when ready.

## What else this server serves

- `GET /db` — the researched database as JSON (`db.json` in this repo). Every copy
  of the Toy Trace page pulls this at load and merges it over its built-in
  entries, so new research reaches the app without reinstalling anything.
- `GET /app` (and `/`) — a copy of the Toy Trace page itself (`app.html`),
  handy if the static site is unreachable.

Updating the database: add or change an entry in `db.json`, commit, push,
redeploy. Entries are dated and sourced; the page renders whatever it gets.

## Point the app at it

The hosted copy of the Toy Trace page ships with this endpoint baked in.
If you run your own copy of the page, expand "Method, limits and how to
extend this" and paste the proxy URL under "Companion service endpoint".

## Testing

curl -s https://<your-url>/health
curl -X POST https://<your-url>/identify \
  -H 'Content-Type: application/json' \
  -d '{"image":"data:image/jpeg;base64,..."}'
