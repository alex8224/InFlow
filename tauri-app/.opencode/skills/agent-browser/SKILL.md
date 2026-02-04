---
name: agent-browser
description: Browser automation CLI for AI agents
license: Apache-2.0
compatibility: opencode
metadata:
  audience: all
  workflow: web-automation
---

## What I do
I provide browser automation capabilities through agent-browser, a headless browser automation CLI optimized for AI agents. I can:

- Navigate to URLs and interact with web pages
- Click elements, fill forms, type text, press keys
- Take screenshots and capture accessibility trees
- Handle navigation, waiting, and page state
- Support sessions, profiles, and multiple browser instances
- Use system browsers like Chrome via --executable-path

## When to use me
Use me when you need to:
- Test web applications and user flows
- Scrape or extract data from websites
- Automate form submissions and interactions
- Verify web functionality or layouts
- Debug browser-based issues
- Interact with web APIs that require authentication

## How I work

### Basic workflow
1. Open a URL: `agent-browser open <url>`
2. Get snapshot: `agent-browser snapshot -i` (interactive elements with refs)
3. Interact using refs: `agent-browser click @e1` or `agent-browser fill @e2 "text"`
4. Re-snapshot after page changes
5. Close: `agent-browser close`

### Using system Chrome
The system Chrome browser is pre-configured. Commands work directly:

```bash
agent-browser open example.com
agent-browser snapshot
agent-browser click @e1
agent-browser close
```

### Key commands
- `agent-browser open <url>` - Navigate to URL
- `agent-browser click <sel>` - Click element (use @e1, @e2 refs)
- `agent-browser fill <sel> <text>` - Clear and fill input
- `agent-browser type <sel> <text>` - Type into element
- `agent-browser press <key>` - Press key (Enter, Tab, etc.)
- `agent-browser snapshot -i` - Get accessibility tree with refs
- `agent-browser screenshot [path]` - Take screenshot
- `agent-browser get text <sel>` - Get element text
- `agent-browser get url` - Get current URL
- `agent-browser wait <sel>` - Wait for element
- `agent-browser close` - Close browser

### Refs vs selectors
Always use refs from snapshots for AI-optimized workflows:
- Snapshot provides deterministic refs like @e1, @e2
- Refs are faster and more reliable than CSS selectors
- Traditional CSS selectors work too: `click "#button"`

### Sessions and profiles
- `agent-browser --session <name> open <url>` - Isolated sessions
- `agent-browser --profile <path> open <url>` - Persistent state across runs

## Notes
- Browser state is ephemeral by default
- Use --profile for persistent sessions (cookies, localStorage)
- Screenshots saved to temporary directory if no path specified
- All commands work with both headless and system browsers
