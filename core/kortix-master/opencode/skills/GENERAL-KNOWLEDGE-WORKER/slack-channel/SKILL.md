---
name: slack-channel
description: "Communicate via Slack. Load this skill when you receive a Slack message. Covers sending messages, files, reactions, threads, channel history, user lookup, and all Slack Web API capabilities via the kslack CLI."
---

# Slack Channel

You are communicating with users via Slack. Messages arrive as prompts. You reply using the `kslack` CLI.

## CLI Reference: `kslack`

### Sending Messages

```bash
# Simple text
kslack send --channel <CH> --thread <TS> --text "your message"

# Complex text (code blocks, special chars) — write to file first
# 1. Use the Write tool to write your message to /tmp/reply.txt
# 2. Then send:
kslack send --channel <CH> --thread <TS> --text-file /tmp/reply.txt

# Send a file attachment
kslack send --channel <CH> --thread <TS> --file /tmp/example.go --text "caption"

# File + complex caption
kslack send --channel <CH> --thread <TS> --file /tmp/example.go --text-file /tmp/caption.txt
```

### Reactions

```bash
kslack react --channel <CH> --ts <MSG_TS> --emoji thumbsup
kslack react --channel <CH> --ts <MSG_TS> --emoji eyes
kslack react --channel <CH> --ts <MSG_TS> --emoji white_check_mark
```

### Reading

```bash
kslack history --channel <CH> --limit 20          # Channel history
kslack thread --channel <CH> --ts <TS> --limit 20 # Thread replies
kslack channels                                    # List channels
kslack channel-info --channel <CH>                 # Channel details
```

### Users

```bash
kslack users                    # List workspace users
kslack user --id <USER_ID>     # User details
kslack me                       # Bot identity
```

### Other

```bash
kslack edit --channel <CH> --ts <TS> --text "updated"
kslack delete --channel <CH> --ts <TS>
kslack join --channel <CH>
kslack search --query "keyword"
kslack file-info --file <FILE_ID>
kslack download --url <URL> --out /tmp/file.ext
```

## Tagging Users

Mention users as `<@USER_ID>`. Look up IDs with `kslack users` or `kslack user --id <ID>`.

## Slack Formatting (mrkdwn)

Slack uses mrkdwn, NOT standard Markdown:

| What | Slack mrkdwn | NOT this (Markdown) |
|------|-------------|-------------------|
| Bold | `*bold*` | ~~**bold**~~ |
| Italic | `_italic_` | same |
| Strike | `~strike~` | ~~strike~~ |
| Code | backtick | same |
| Code block | triple backticks | same |
| Link | `<https://url\|text>` | ~~[text](url)~~ |
| Header | `*Bold line*` | ~~# Header~~ |

**Never use `**double asterisks**`, `# headers`, or `[text](url)` — they render as raw text in Slack.**

## Rules

1. **Respond only when needed.** You get every message in threads you're part of, plus @mentions and DMs. Don't reply to everything — use judgment.

2. **Always reply in the thread.** Never post top-level in a channel. Always include `--thread <TS>`.

3. **Code and files: ALWAYS attach, NEVER paste.** Write to /tmp/, send as --file. Never dump content into text.

4. **Use --text-file for anything complex.** Backticks, code, special chars — write to /tmp/reply.txt first.

5. **No web UI tools.** Don't use `question` or `show` tools — they don't render in Slack.

6. **No localhost URLs.** Send screenshots/files via --file instead.

7. **Files from users** arrive downloaded at /workspace/slack-files/. Use Read tool to view images. Transcribe audio with: `kwhisper --file /path/to/audio.oga`

8. **Session commands** are handled by the bridge: !new, !sessions, !session, !status, !help, !agent, !model, !reset.
