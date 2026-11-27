# Deploying Prickle on your own server

One Node process serves the page and the API on one port; Caddy in front gives it your domain
with HTTPS. About 15 minutes on a fresh Ubuntu server.

**Use replay mode for a public URL.** In live mode every visitor's session spends your Gemini
quota (~30 requests each; the free tier allows 15 a minute), and only one session runs at a time.
Replay mode streams the committed recording, calls no model, needs no key, and labels itself a
replay on the page. Live mode is below for a private demo.

## What you need

- A small Linux server (1 vCPU, 1 GB RAM is plenty), Ubuntu 22.04 or 24.04, with a public IP.
- Your domain, with a DNS **A record** pointing a name (e.g. `prickle.example.com`) at that IP.
- Ports 80 and 443 open (Caddy needs both for the certificate).

## 1. Node.js, pnpm and the code

```bash
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
sudo corepack enable                      # gives the pnpm version the repo pins

sudo mkdir -p /opt/prickle && sudo chown "$USER" /opt/prickle
git clone https://github.com/maksimprivalov/black-friday-shopping-agent.git /opt/prickle
cd /opt/prickle
pnpm install --frozen-lockfile
pnpm build                                # builds the page into frontend/dist
```

The repository must be public for this clone, or add a deploy key.

## 2. Try it by hand

```bash
cd /opt/prickle/backend
STATIC_DIR=../frontend/dist REPLAY_RUN_LOG=runs/sample-run.jsonl pnpm start
# Replay mode: runs/sample-run.jsonl (130 lines) at 4x; no model is called.
# Serving the page from ../frontend/dist
# Prickle session server on http://127.0.0.1:8787 (replay). Not financial advice.
curl -s http://127.0.0.1:8787/api/health   # {"ok":true,"mode":"replay"}
```

Stop it with Ctrl+C.

## 3. Run it as a service

`/etc/systemd/system/prickle.service`:

```ini
[Unit]
Description=Prickle (replay)
After=network.target

[Service]
User=www-data
WorkingDirectory=/opt/prickle/backend
Environment=HOST=127.0.0.1
Environment=PORT=8787
Environment=STATIC_DIR=../frontend/dist
Environment=REPLAY_RUN_LOG=runs/sample-run.jsonl
Environment=REPLAY_SPEED=4
ExecStart=/opt/prickle/backend/node_modules/.bin/tsx src/app/server/main.ts
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo chown -R www-data /opt/prickle/backend/runs
sudo systemctl daemon-reload
sudo systemctl enable --now prickle
systemctl status prickle --no-pager
```

## 4. Your domain with HTTPS (Caddy)

```bash
sudo apt-get install -y caddy
```

`/etc/caddy/Caddyfile` (replace the name with yours):

```caddyfile
prickle.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8787 {
        # The run streams over Server-Sent Events: pass every event on at once.
        flush_interval -1
    }
}
```

```bash
sudo systemctl reload caddy
```

Caddy gets the certificate on its own. Open `https://prickle.example.com`: the page loads, and
**Shop for me** replays the run with the replay banner on top.

## Live mode instead (a private demo)

Put the key on the server, outside git, readable only by the service:

```bash
sudo install -m 600 -o www-data /dev/null /opt/prickle/backend/.env
sudoedit /opt/prickle/backend/.env       # GEMINI_API_KEY=...
```

In the unit, remove the `REPLAY_RUN_LOG` line, then `sudo systemctl daemon-reload && sudo
systemctl restart prickle`. Every session's run log is written to `backend/runs/`. To keep
strangers from spending the quota, put a password in front with Caddy's `basic_auth` directive
(`caddy hash-password` makes the hash).

## Updating

```bash
cd /opt/prickle && git pull && pnpm install --frozen-lockfile && pnpm build
sudo systemctl restart prickle
```

## Settings

| Variable | Default | What |
| --- | --- | --- |
| `PORT` / `HOST` | `8787` / `127.0.0.1` | where the server listens; keep `127.0.0.1` behind Caddy |
| `STATIC_DIR` | unset | serve the built page from this folder (`../frontend/dist`) |
| `REPLAY_RUN_LOG` | unset | replay this run log instead of running agents (or `--replay <file>`) |
| `REPLAY_SPEED` | `4` | replay speed; gaps over 8 s are shortened |
| `ALLOWED_ORIGINS` | unset | extra CORS origins, comma-separated (not needed when the page is served by the same server) |
| `GEMINI_API_KEY`, `MODEL_FAST`, `MODEL_STRONG`, `GEMINI_REQUESTS_PER_MINUTE`, `LOOP_TIMEOUT_SECONDS`, `PAYMENTS` | see `backend/.env.example` | live mode only |
