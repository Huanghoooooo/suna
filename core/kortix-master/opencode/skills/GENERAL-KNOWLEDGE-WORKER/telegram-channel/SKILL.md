---
name: telegram-channel
description: "Communicate via Telegram. Load this skill when you receive a Telegram message. Covers sending messages, files, reactions, voice transcription, and all Telegram Bot API capabilities via the ktelegram CLI."
---

# Telegram Channel

You are communicating with a user via Telegram. Messages arrive as prompts. You reply using the `ktelegram` CLI.

## CLI Reference: `ktelegram`

### Sending Messages

```bash
# Simple text
ktelegram send --chat <CHAT_ID> --text "your message"

# Complex text (code blocks, special chars) — write to file first
# 1. Use the Write tool to write your message to /tmp/reply.txt
# 2. Then send:
ktelegram send --chat <CHAT_ID> --text-file /tmp/reply.txt

# Quote-reply to a specific message
ktelegram send --chat <CHAT_ID> --reply-to <MSG_ID> --text "reply"

# Send a file (auto-detects: photo/video/audio/document by extension)
ktelegram send --chat <CHAT_ID> --file /tmp/example.py --text "caption"

# File + complex caption
ktelegram send --chat <CHAT_ID> --file /tmp/example.py --text-file /tmp/caption.txt
```

### Other Commands

```bash
ktelegram typing --chat <CHAT_ID>        # Send typing indicator
ktelegram edit --chat <ID> --message-id <ID> --text "new"  # Edit a sent message
ktelegram delete --chat <ID> --message-id <ID>              # Delete a message
ktelegram me                              # Bot info
ktelegram get-chat --chat <ID>            # Chat info
ktelegram file --file-id <ID>             # Get file download URL
```

## Rules

1. **Respond only when needed.** You get every message but don't have to reply to all of them. Use judgment — questions and requests get responses, casual "ok"/reactions/stickers can be ignored.

2. **Code and files: ALWAYS attach, NEVER paste.** When someone asks for code, data, documents:
   - Write the file to /tmp/ (e.g., /tmp/example.go)
   - Send as `--file` attachment
   - Never dump file contents into message text

3. **Use --text-file for anything with special characters.** Backticks, quotes, code blocks — write to /tmp/reply.txt first, then use --text-file. This avoids shell escaping issues.

4. **No web UI tools.** Do NOT use the `question` tool or `show` tool — they don't render in Telegram. Ask questions as plain text. Show results as files.

5. **No localhost URLs.** The user can't access localhost. If you build something, screenshot it and send via --file.

6. **Voice/video messages** arrive as downloaded files at /workspace/telegram-files/. Transcribe audio with: `kwhisper --file /path/to/audio.oga`

7. **Images** arrive as downloaded files. Use the Read tool to view them.

8. **Session commands** are handled by the bridge (not you): /new, /sessions, /session, /status, /help, /agent, /model, /reset.
