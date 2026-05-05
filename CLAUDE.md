# Anton CoWork — build & dev notes

Electron + Vite + React + Tailwind desktop app with a FastAPI Python sidecar.

## Build the app

```sh
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run pack
```

- Output: `release/mac-arm64/Anton.app`
- Confirm with: `stat -f "%Sm" -t "%H:%M:%S" release/mac-arm64/Anton.app`
- Code-sign warnings ("0 valid identities found") are expected in dev — ignore.
- Build is the only way to verify Python server changes; the renderer is bundled into the same artifact.

## Dev mode (renderer only, faster iteration)

```sh
PATH="/opt/homebrew/opt/node@20/bin:$PATH" npm run dev
```

Hot-reloads the React renderer; the Python sidecar still needs the packaged binary OR a manual `python server/main.py` running on `127.0.0.1:26866`.

## Server

```sh
python server/main.py
```

Loopback-only FastAPI; CORS locked to the renderer origin. Default port `26866`.

## Sanity-check Python before building

Edits to `server/anton_api/*.py` aren't caught by `npm run pack` (it just bundles them as-is). Run a quick parse-check:

```sh
python3 -c "import ast; ast.parse(open('server/anton_api/<file>.py').read())"
```

## Docs

- `docs/index.html` — landing page
- `docs/server-api.html` — API reference
- `docs/data-vault.html` — vault architecture + flow diagram

Open with `open docs/index.html`.

## Misc

- DevTools no longer auto-open. Set `ANTON_DEVTOOLS=1` to flip back on, or use Cmd+Option+I.
- Anton core lives at `/Users/jorgestorres/Documents/GitHub/anton/anton/` — referenced by the bundled server, not vendored.
