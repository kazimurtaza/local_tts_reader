# Local TTS Reader

## Overview
Chrome Extension (Manifest V3) that converts webpage text to speech using a local OpenAI-compatible TTS server. Users select text on any page (or read the entire page), and the extension sends it to a self-hosted TTS endpoint, returning audio for in-browser playback with full transport controls. Supports text pre-processing (strips markdown, URLs, HTML), chunked streaming for long text, and audio download.

## Stack
- **Platform:** Chrome Extension (Manifest V3)
- **Language:** Vanilla JavaScript (no build step, no bundler, no npm)
- **UI:** Inline HTML/CSS in `popup.html` (dark theme, 320px popup, Font Awesome icons via CDN)
- **Storage:** `chrome.storage.local` for user settings
- **Audio:** Offscreen Document API (`offscreen.html` + `offscreen.js`) for background audio playback; HTML5 `<audio>` element
- **Networking:** `fetch()` to an OpenAI-compatible `/v1/audio/speech` endpoint; optional Bearer token auth
- **Dependencies:** None (no package.json, no node_modules). Font Awesome loaded from CDN in popup.html only.

## Commands
No build system. Development workflow is edit-and-reload:
1. Edit source files directly.
2. Go to `chrome://extensions/`, find the extension card, click the refresh icon.
3. Reopen the popup to test changes.

There is no `npm install`, no test runner, no linting, and no build script.

## Architecture
```
popup.html          -- Extension popup UI (HTML + CSS + loads JS)
  |
  +-- constants.js      -- DEFAULT_SETTINGS object (exported to `self` or `module.exports`)
  +-- textProcessor.js  -- TextProcessor class (static `process()` strips markdown/URLs/HTML)
  +-- audioPlayer.js    -- AudioPlayer class (thin facade; sends chrome.runtime messages)
  +-- popup.js          -- DOM event wiring, settings load/save, seek bar, state sync

background.js        -- Service worker (message hub, TTS fetch, text chunking, offscreen lifecycle)
  |
  +-- Manages offscreen document creation/recreation (Chrome auto-closes after 30s inactivity)
  +-- Handles chrome.commands (Alt+S = read selection, Alt+X = stop)
  +-- Handles context menu ("Read Aloud" on selection/page)
  +-- fetchAudioData() -- POSTs to TTS server, returns raw audio bytes
  +-- chunkText()      -- Splits text at sentence boundaries (~500 char chunks)
  +-- Prefetches next chunk while current chunk plays
  +-- Forwards messages between popup and offscreen document

offscreen.html       -- Minimal page hosting offscreen.js
offscreen.js         -- HTML5 <audio> element lifecycle (play/pause/stop/seek)
                       Sends state/timeUpdate/streamComplete messages back to background.js
                       Keepalive ping every 25s to prevent Chrome's 30s offscreen timeout
```

**Message flow:** `popup.js` -> `chrome.runtime.sendMessage` -> `background.js` -> `chrome.runtime.sendMessage` -> `offscreen.js`. Background.js acts as the central message router. State updates flow back the same way.

**Audio pipeline:** Text is optionally pre-processed, chunked at sentence boundaries (~500 chars), sent as POST requests to the TTS server, received as raw bytes, passed to the offscreen document as a Blob URL, and played via HTML5 audio. Next chunks are pre-fetched during playback.

**Dynamic voice loading:** On popup open, `background.js` fetches available voices from `{serverUrl base}/v1/audio/voices` and populates the voice dropdown. Falls back to hardcoded voices in popup.html if the fetch fails.

## Conventions
- **No build tools:** All JS is loaded via `<script>` tags in HTML files. No modules, no import/export in practice (except the `module.exports` guard in constants.js for hypothetical test use).
- **Global constructors:** `AudioPlayer` and `TextProcessor` are assigned to `window` / `self` for use across scripts.
- **Message passing:** All inter-script communication uses `chrome.runtime.sendMessage` / `chrome.runtime.onMessage` with a `type` field discriminating the message kind.
- **Settings:** Stored as flat key-value pairs in `chrome.storage.local`. Default values are duplicated in `constants.js` (DEFAULT_SETTINGS) and inline in `background.js` fallbacks. When adding a new setting, update both `constants.js`, the `getSettings()` function in `popup.js`, the `chrome.storage.local.get` defaults in `popup.js` and `background.js`, and the settings UI in `popup.html`.
- **Error handling:** Errors are sent as `{ type: 'streamError', error: message }` messages. The popup displays them in the `#status` element.
- **CSS:** Dark theme with specific hex colors (#1a1a2e background, #16213e panels, #e94560 accent). All styles are inline in `popup.html` in a `<style>` block.
- **File naming:** camelCase for JS files (audioPlayer.js, textProcessor.js, offscreen.js). Lowercase for HTML.

## Environment
- **TTS Server:** Must be OpenAI API-compatible, accepting POST to `/v1/audio/speech` with `{ model, voice, input, speed, response_format }` JSON body, returning raw audio bytes. Default endpoint is a configurable user setting.
- **Chrome permissions:** `activeTab`, `storage`, `scripting`, `offscreen`, `contextMenus`. Host permissions for `http://*/*` and `https://*/*`.
- **Keyboard shortcuts:** `Alt+S` reads selected text (or full page), `Alt+X` stops playback.
- **No environment variables or config files** -- all configuration is via the popup UI and persisted in chrome.storage.local.

## Git Workflow
- Repository: `git@github.com:kazimurtaza/local_tts_reader.git` (public)
- No branching convention specified; standard fork-and-PR model described in README.
- No CI/CD configuration present.
- `.gitignore` contains only `local.md`.
