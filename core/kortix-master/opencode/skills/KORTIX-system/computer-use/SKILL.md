---
name: computer-use
description: "Control desktop applications on the user's machine using agent-click. Use when you need to click buttons, type text, read screens, scroll, drag files, move/resize windows, open/quit apps, interact with UI elements, or automate desktop workflows. Triggers: 'click on', 'open app', 'type into', 'scroll down', 'drag file', 'take screenshot', 'read the screen', 'interact with UI', 'desktop automation', 'computer use', 'agent-click'. Built on agent-click (https://github.com/kortix-ai/agent-click, https://www.agent-click.dev/) — an open-source computer use CLI by Kortix. Right now only works on macOS."
---

# Computer Use — agent-click

Control desktop applications on the user's machine via `agent-click`, an open-source CLI tool by Kortix for macOS desktop automation. All commands run through Agent Tunnel on the user's local machine.

- GitHub: https://github.com/kortix-ai/agent-click
- Docs: https://www.agent-click.dev/

## Setup

Before using agent-click, verify it's installed on the user's machine. Run these via Agent Tunnel:

```bash
TUNNEL=$OPENCODE_CONFIG_DIR/skills/KORTIX-system/agent-tunnel/tunnel.ts

# 1. Check tunnel connection
bun run "$TUNNEL" status

# 2. Check if agent-click is installed
bun run "$TUNNEL" shell '{"command":"agent-click","args":["--version"]}'

# 3. If not installed, install it
bun run "$TUNNEL" shell '{"command":"npm","args":["install","-g","agent-click"],"timeout":60000}'

# 4. Verify installation
bun run "$TUNNEL" shell '{"command":"agent-click","args":["--version"]}'
```

Always check and install before first use in a session. Do not skip this step.

## Running agent-click Commands

All agent-click commands are executed via the tunnel's `shell` command:

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["<subcommand>","<arg1>","<arg2>"]}'
```

Example — take a snapshot of Safari:

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Safari","-i","-c"]}'
```

## Core Loop

Think like a human sitting at the computer:

```
snapshot → identify → act → verify
```

1. **Look** at the screen (snapshot)
2. **Find** what you need (identify refs from output)
3. **Do** one action (click, type, key)
4. **Check** what changed (re-snapshot)

Every action changes the UI. Previous refs become stale. Always re-snapshot after acting.

## Commands Reference

### Opening Apps

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["open","Safari","--wait"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Safari","-i","-c"]}'
```

Always wait for the app to be ready, then snapshot before interacting.

### Snapshots — See the Screen

```bash
# Standard snapshot (interactive + compact)
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Music","-i","-c"]}'

# Deeper snapshot if elements are missing
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Safari","-i","-c","-d","8"]}'
```

Always use `-i -c` flags. Interactive + compact reduces noise by 10x.

### Clicking

```bash
# Single click by ref
bun run "$TUNNEL" shell '{"command":"agent-click","args":["click","@e5"]}'

# Double-click (opens files, plays songs)
bun run "$TUNNEL" shell '{"command":"agent-click","args":["click","@e5","--count","2"]}'

# Click by stable ID
bun run "$TUNNEL" shell '{"command":"agent-click","args":["click","id=\"play\"","-a","Music"]}'
```

### Typing

```bash
# With target element (preferred — uses AXSetValue, headless)
bun run "$TUNNEL" shell '{"command":"agent-click","args":["type","hello world","-s","@e3"]}'

# Into focused field (keyboard simulation, needs app focus)
bun run "$TUNNEL" shell '{"command":"agent-click","args":["type","hello world","-a","Safari"]}'
```

Always prefer `-s @ref` when you have a ref. It's more reliable.

### Key Presses

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","Return","-a","Calculator"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","cmd+k","-a","Slack"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","cmd+a","-a","TextEdit"]}'
```

### Scrolling

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["scroll","down","-a","Music"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["scroll","down","--amount","10","-a","Music"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["scroll-to","@e42"]}'
```

Use `scroll-to` for headless operation (no focus needed).

### Reading Content

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["text","-a","Calculator"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["get-value","@e5"]}'
```

Use `get-value` on specific elements instead of `text` on large apps.

### Window Management

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["move-window","-a","Notes","--x","100","--y","100"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["resize-window","-a","Notes","--width","800","--height","600"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["windows","-a","Finder"]}'
```

### Drag and Drop

Drag needs the app focused and both source and destination visible.

```bash
# Set up windows side by side first
bun run "$TUNNEL" shell '{"command":"agent-click","args":["move-window","-a","Finder","--x","0","--y","25"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["resize-window","-a","Finder","--width","720","--height","475"]}'

# Snapshot to find elements
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Finder","-i","-c","-d","8"]}'

# Drag by refs
bun run "$TUNNEL" shell '{"command":"agent-click","args":["drag","@e32","@e50","-a","Finder"]}'

# Or by coordinates
bun run "$TUNNEL" shell '{"command":"agent-click","args":["drag","--from-x","300","--from-y","55","--to-x","1000","--to-y","200","-a","Finder"]}'
```

### Waiting

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["wait-for","name=\"Dashboard\""]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["wait-for","role=button","--timeout","15"]}'
```

### Verification

```bash
# After clicking — re-snapshot
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Safari","-i","-c"]}'

# After typing — check value
bun run "$TUNNEL" shell '{"command":"agent-click","args":["get-value","@e3"]}'

# Click with inline verification
bun run "$TUNNEL" shell '{"command":"agent-click","args":["click","@e5","--expect","name=\"Done\""]}'

# Idempotent typing
bun run "$TUNNEL" shell '{"command":"agent-click","args":["ensure-text","@e3","hello"]}'
```

## Selector Syntax

### Refs (always prefer these)

```
@e1, @e2, @e3    — from the most recent snapshot
```

### DSL Selectors

```
role=button name="Submit"     — role + exact name
id="AllClear"                 — exact id (most stable)
id~="track-123"               — id contains (case-insensitive)
name~="Clear"                 — name contains (case-insensitive)
button "Submit"               — shorthand: role name
"Login"                       — shorthand: just name
role=button index=2            — 3rd match (0-based)
```

### Chains

```
id=sidebar >> role=button index=0    — first button inside sidebar
name="Form" >> button "Submit"       — submit button inside form
```

## Electron Apps (CDP)

Electron apps (Slack, Cursor, VS Code, Discord) are auto-detected. Everything works headless:

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Slack","-i","-c"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["click","@e5"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["type","hello","-a","Slack"]}'
```

Typing in Electron goes to the focused element. To type into a specific input:

```bash
# Click to focus the input first
bun run "$TUNNEL" shell '{"command":"agent-click","args":["click","@e18"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","cmd+a","-a","Slack"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","backspace","-a","Slack"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["type","your text","-a","Slack"]}'
```

## Real-World Patterns

### Search and Play a Song

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["open","Music","--wait"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Music","-i","-c"]}'
# find search — click it
bun run "$TUNNEL" shell '{"command":"agent-click","args":["click","@e1"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Music","-i","-c"]}'
# type search query
bun run "$TUNNEL" shell '{"command":"agent-click","args":["type","Kiss of Life","-s","@e31"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","Return","-a","Music"]}'
sleep 3
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Music","-i","-c","-d","8"]}'
# double-click track to play
bun run "$TUNNEL" shell '{"command":"agent-click","args":["click","id~=\"604771089\"","-a","Music","--count","2"]}'
sleep 2
bun run "$TUNNEL" shell '{"command":"agent-click","args":["get-value","id=\"title\"","-a","Music"]}'
```

### Send a Slack DM

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","cmd+k","-a","Slack"]}'
sleep 1
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Slack","-i","-c"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["click","@e18"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","cmd+a","-a","Slack"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","backspace","-a","Slack"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["type","Vukasin","-a","Slack"]}'
sleep 1
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","Return","-a","Slack"]}'
sleep 2
bun run "$TUNNEL" shell '{"command":"agent-click","args":["type","hey, check this out","-a","Slack"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","Return","-a","Slack"]}'
```

### Fill a Web Form

```bash
bun run "$TUNNEL" shell '{"command":"agent-click","args":["open","Safari","--wait"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Safari","-i","-c"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["type","https://example.com/form","-s","@e34"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["key","Return","-a","Safari"]}'
sleep 3
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Safari","-i","-c","-d","8"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["type","John Doe","-s","@e5"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["type","john@example.com","-s","@e6"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["click","@e8"]}'
bun run "$TUNNEL" shell '{"command":"agent-click","args":["snapshot","-a","Safari","-i","-c"]}'
```

## Rules

1. **Always snapshot before acting.** You cannot interact with what you cannot see.
2. **Always re-snapshot after acting.** The UI changed. Your refs are stale.
3. **Use refs, not selectors.** Refs are fast and unambiguous.
4. **Use `-i -c` on snapshots.** Interactive + compact reduces noise by 10x.
5. **Use `id=` selectors when available.** IDs are the most stable across UI changes.
6. **Wait after navigation.** `sleep 2-3` after opening pages, switching tabs, submitting forms.
7. **Verify after typing.** Use `get-value` to confirm the text was set correctly.
8. **One action at a time.** Don't chain multiple actions without checking state between them.
9. **Use `type -s @ref`** over `type -a App`. Selector uses AXSetValue (reliable). App path uses keyboard simulation (fragile).
10. **Use `scroll-to @ref`** when you know the element. It's headless. `scroll down` needs focus.

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Element not found | Re-snapshot. Your refs are stale. |
| Ambiguous selector | Use refs, or add `index=` to the selector. |
| Click didn't work | Try `--count 2` (double-click). Or `scroll-to` first if offscreen. |
| Type didn't work | Use `-s @ref` instead of `-a App`. |
| Electron app not using CDP | First run auto-relaunches with CDP. Takes ~5s. |
| agent-click not found | Install: `npm install -g agent-click` via tunnel shell. |

## Output Format

All agent-click output is JSON:

```json
{"success": true, "message": "pressed \"7\" at (453, 354)"}
{"error": true, "type": "element_not_found", "message": "..."}
{"role": "button", "name": "Submit", "value": null, "position": {"x": 450, "y": 320}}
```
