# Telegram Topics vs. Bot DMs

Memo on how Telegram "Topics" work, why `TELEGRAM_HOME_CHANNEL_THREAD_ID` is blank
in every Hermes profile today, and what's needed to actually use topics.

## What Topics are

Telegram "Topics" (forum mode) lets a **supergroup** be subdivided into named
threads (e.g. "General," "Bugs," "Announcements"), each with its own message
feed inside that one group chat. Every topic has a numeric `thread_id`
(`message_thread_id` in the Bot API) used to route a message into that
specific sub-feed instead of the group's general lobby.

Topics do **not** apply to:
- Regular (non-forum) groups — a single flat feed, no sub-threads.
- Private 1-on-1 DMs (including bot DMs) — same thing, a flat conversation.
  Telegram never lets a DM grow topics; it's a permanently different chat type.

## Why the bot DM has no topic today

Creating a bot via BotFather (`/newbot`) only registers a bot identity
(token, username) — the bot doesn't know any user yet. A DM only comes into
existence once a human sends the bot a first message (e.g. `/start`);
Telegram then allocates a `chat_id` for that 1:1 chat, which for a bot DM is
simply the user's own Telegram user ID.

Hermes doesn't trust an inbound DM as the "home channel" automatically,
either — `hermes pairing` (`list` / `approve` / `revoke` / `clear-pending`)
gates it. A new DM shows up as a pending pairing code; an already-authorized
session has to run `hermes pairing approve <code>` before it's written into
`channel_directory.json` and becomes eligible as the resolved home channel.

Confirmed shape in `~/.hermes/channel_directory.json`:
```json
{
  "id": "7590425417",
  "name": "Luiz Carlos Kazuyuki Fukaya",
  "type": "dm",
  "thread_id": null
}
```

`type: "dm"` is why `thread_id` is `null` — and why `TELEGRAM_HOME_CHANNEL_THREAD_ID`
is empty in every profile's `.env` (dev, prod, hermes-agent, hermes-dashboard).
The code (`gateway/config.py`) treats an empty value as intentional:
```python
thread_id=getenv("TELEGRAM_HOME_CHANNEL_THREAD_ID") or None,
```
This is expected, not a misconfiguration.

## Setting up a real topic (if ever needed)

The DM you already have can't grow topics — you'd set up a separate group:

1. Create (or pick) a Telegram **group** — not the bot DM.
2. Convert it to a **supergroup** if needed (Telegram does this automatically
   past a small member threshold, or you can do it manually in settings).
3. Enable **"Topics"** in that supergroup's settings (admin-only toggle).
4. **Add the bot** to the group as a member with whatever permissions it needs.
5. **Create a topic** in the group UI — Telegram assigns it a `message_thread_id`.
6. Point Hermes at it:
   - `TELEGRAM_HOME_CHANNEL` = the **group's** chat_id (not your personal DM's).
   - `TELEGRAM_HOME_CHANNEL_THREAD_ID` = that topic's `message_thread_id`.
   - Optionally `TELEGRAM_CRON_THREAD_ID` — takes precedence over
     `TELEGRAM_HOME_CHANNEL_THREAD_ID` specifically for cron-delivered
     messages (`cron/scheduler.py`), useful for routing scheduled
     notifications into a dedicated topic separate from the general home
     channel.

This is additive, not a continuation of the existing DM setup — the DM stays
a DM forever; topics only exist on the group side.
