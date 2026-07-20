# Sprint90 — Telegram Logging Bot

A one-person Telegram bot that turns free-text messages into structured entries in
the 90-Day Sprint tracker files. Text it what you did during the day —

> did 45 min prayer this morning
> read 14 chapters, reached Exodus 12
> weighed in at 81.5
> skipped exercise, back's sore

— and it parses the message with Claude and writes it into the flat markdown
tracker files in [`data/`](./data), no template copy-pasting. It also fills the
weekly/monthly reviews on demand.

It uses **long polling** (no webhook, no public HTTPS endpoint, no domain), edits
the existing flat markdown files in place, and optionally commits + pushes them
after every write so nothing is lost if the host restarts.

---

## What's in `data/`

The flat 90-day project files, exactly as the tracker expects them (see
[`data/CLAUDE.md`](./data/CLAUDE.md) for the rules the bot follows):

```
data/
  CLAUDE.md  README.md  goals.md  schedule.md  food-notes.md
  bible.md  fitness.md  prayer.md  business.md  learning.md
  daily-log-template.md
  weekly-review-template.md  monthly-review-template.md
  daily-log-YYYY-MM-DD.md          <- created by the bot, one per day
  weekly-review-week-N-DATE.md     <- created by /review
  monthly-review-YYYY-MM.md        <- created by /month
```

Want the bot to log into your existing project folder instead of this copy? Point
`DATA_DIR` at it (see `.env`).

---

## Setup

### 1. Create the Telegram bot (~5 min, you do this)

1. In Telegram, message **@BotFather** → `/newbot` → pick a name and username.
2. BotFather returns a **bot token** — that's `TELEGRAM_BOT_TOKEN`.
3. Send your new bot any message once (Telegram requires you to start the chat
   before a bot can message you).

### 2. Configure

```sh
cp .env.example .env
# edit .env: paste TELEGRAM_BOT_TOKEN and ANTHROPIC_API_KEY
npm install
```

Get `ANTHROPIC_API_KEY` from <https://console.anthropic.com/> → Settings → API Keys.

**Lock it to yourself:** run the bot once, message it, and it prints your chat id
to the console. Put that in `ALLOWED_CHAT_ID` and restart, so only you can log.

### 3. Run

```sh
npm start
```

Message the bot "test" (or a real log entry) and you should get a confirmation
back. Run the tests any time with `npm test`.

---

## Commands

| Command | What it does |
|---|---|
| *(any text)* | Parse and log the update; replies with a one-line confirmation of exactly what was logged. If a number is missing, it asks instead of guessing. |
| `/status` | Snapshot: Bible % done, prayer avg (last 7d), exercise days, weight vs 75kg target. |
| `/review` | Fills this week's review from the last 7 daily logs, sends it, saves `weekly-review-week-N-DATE.md`. |
| `/month` | Same for the monthly review over the sprint so far. |
| `/help` | Usage. |

The bot updates the running trackers automatically from the same message:
`bible.md` (chapter count + book checkboxes), `fitness.md` (weekly weight row).

---

## Guardrails (carried from `data/CLAUDE.md`)

- **Never invents numbers.** If you mention a field but not its number
  ("did prayer this morning"), it asks for the number instead of guessing.
- **Advisory tone.** `/review` and `/status` surface the data and flag plainly
  anything slipping 3+ days running — they don't issue verdicts.
- **Secrets stay out of git.** `.env` is gitignored; both keys are read from it.

---

## Deploy (always-on)

The bot is a small long-running Node process — any always-on host works.

**Railway** (simple free/cheap tier):
1. This repo is already on GitHub (private) — connect it in Railway.
2. New Railway project → deploy from this repo.
3. Set `TELEGRAM_BOT_TOKEN` and `ANTHROPIC_API_KEY` in the Railway variables.
4. Start command `npm start`. Railway auto-restarts on crash.

Render and Fly.io work the same way. Because the container's disk is ephemeral,
set `GIT_AUTOCOMMIT=true` (and give the container git push access) so each write
is pushed back to the repo — or use a host with a persistent volume and leave git
off.

---

## Configuration reference (`.env`)

| Variable | Default | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | — (required) | From @BotFather. |
| `ANTHROPIC_API_KEY` | — (required) | Claude API key. |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` | Parsing/review model. `claude-haiku-4-5` or `claude-sonnet-5` are cheaper. |
| `DATA_DIR` | `./data` | Where the tracker files live. |
| `ALLOWED_CHAT_ID` | *(open)* | Restrict to one Telegram chat (yourself). |
| `GIT_AUTOCOMMIT` | `false` | Commit + push `DATA_DIR` after each write. |
| `DAILY_REMINDER_TIME` | *(off)* | e.g. `20:00` — a daily "did you log?" nudge (needs `ALLOWED_CHAT_ID`). |
| `TZ` | host TZ | IANA timezone for dates and the reminder. |

## Defaults chosen (the build spec's open questions)

- **Language:** Node.js (long polling, `node-telegram-bot-api` + `@anthropic-ai/sdk`).
- **Storage:** the existing flat markdown files, edited in place — no database.
- **Persistence:** optional git auto-commit (`GIT_AUTOCOMMIT`), off by default;
  turn it on for ephemeral hosts like Railway.
- **Daily reminder:** off by default, opt in with `DAILY_REMINDER_TIME`.

Change any of these in `.env` — nothing is hard-coded.

## Tests

`npm test` runs the file-transform unit tests (`node --test`) — the daily-log
fill/accumulate logic, Bible/fitness tracker updates, and the stats parsing. No
network or API key required.
