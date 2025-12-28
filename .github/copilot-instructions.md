# GitSignal — AI Agent Instructions

## Project Overview
GitSignal is an Electron-based macOS menubar app for GitHub notifications with React (Vite) frontend. The app lives in the system tray, polls GitHub's notifications API with ETag caching, and sends native macOS notifications.

## Architecture

### Three-Layer Design
1. **Electron Main Process** (`electron/main.js`) — manages app lifecycle, system tray, native notifications, IPC handlers, OAuth flow
2. **Preload Bridge** (`electron/preload.js`) — secure contextBridge exposure for renderer ↔ main communication
3. **React Renderer** (`src/`) — Vite-powered UI displaying notifications, handling user interactions

### Key Communication Patterns
- **Main → Renderer**: `mainWindow.webContents.send('channel', data)` for tray menu actions (`mark-all-read`, `open-preferences`)
- **Renderer → Main**: `ipcRenderer.send()` for one-way (e.g., `notify`), `ipcRenderer.invoke()` for async requests (e.g., `open-external`)
- **Security**: All IPC channels must be explicitly whitelisted in `preload.js` — never expose raw `ipcRenderer` to renderer

### Data Flow for Notifications
1. `github.js` polls GitHub API every 60s with ETag-based conditional requests
2. New notifications trigger `window.electron.notify()` → main process creates native `Notification`
3. State managed in React (`App.jsx`) with naive ID-based deduplication
4. Clicking notification opens URL via `shell.openExternal()`

## Development Workflow

```bash
# Install dependencies (keytar requires native compilation)
npm install

# Development (two terminals)
npm run dev           # Starts Vite dev server on :5173
npm run start         # Launches Electron pointing to dev server

# OR use concurrent mode
npm run dev:electron  # Runs both with wait-on

# Production build
npm run build         # Vite build → dist/ + electron-builder packaging
```

### Environment Detection
`isDev` flag in `main.js` checks `NODE_ENV === 'development'` or `DEBUG_PROD === 'true'`:
- Dev: loads `http://localhost:5173` + opens DevTools
- Prod: loads `dist/index.html` (Vite build output)

## Critical Implementation TODOs

### 1. OAuth + PKCE Flow (Priority)
**Current State**: `github.js` has a placeholder `token` variable set via `setToken(t)`.

**Implementation Pattern**:
- In `main.js`, add IPC handlers for:
  - `auth:start` → generate PKCE code_verifier/challenge, open browser to `https://github.com/login/oauth/authorize`
  - `auth:callback` → handle redirect via custom protocol (`gitsignal://callback`) or local server
  - Exchange code for token at `https://github.com/login/oauth/access_token`
- Store token via `keytar.setPassword('gitsignal', 'github-token', token)` in main process
- On app start, retrieve token via `keytar.getPassword()` and send to renderer via IPC

**Security**: Never pass token directly to renderer—keep in main process, proxy GitHub API calls if needed.

### 2. Token Storage (macOS Keychain)
Use `keytar` package (already in dependencies) exclusively in main process:
```js
const keytar = require('keytar')
await keytar.setPassword('gitsignal', 'github-token', accessToken)
const token = await keytar.getPassword('gitsignal', 'github-token')
```

### 3. Notification Deduplication
Current logic in `App.jsx` uses naive ID-based Set — consider timestamp-based windowing to avoid duplicate desktop notifications on app restart.

## Project Conventions

### File Organization
- `electron/` — all main process code (no React/JSX)
- `src/` — renderer process (React components, API logic, styles)
- `public/` — static assets (icon, etc.)
- `dist/` — Vite build output (gitignored)

### Styling
Minimal vanilla CSS in `styles.css`. If adding Tailwind, update `vite.config.js` and `src/index.html` with CDN or PostCSS setup.

### IPC Channel Naming
- Prefix channels by feature: `auth:*`, `notifications:*`, `preferences:*`
- Whitelist all channels in `preload.js` `valid` array

### Error Handling
GitHub API errors logged to console (`github.js`). For production, consider:
- Exponential backoff for rate limiting (HTTP 429)
- User-facing error messages for auth failures
- Sentry/logging integration in main process

## GitHub API Integration

### Rate Limiting
- Authenticated: 5000 req/hr
- Polling endpoint supports `If-None-Match` (ETag) to avoid consuming quota on no-change responses (HTTP 304)
- Current interval: 60s (conservative)

### Notification Object Shape
```js
{
  id: string,
  repo: { full_name: string },
  subject: { title: string, url: string },
  reason: 'subscribed' | 'mention' | 'team_mention' | ...
}
```

## macOS-Specific Considerations

### Tray Icon
- Use Template Images for proper dark mode support (name icon `iconTemplate.png`)
- 16x16@2x or 22x22@2x recommended for Retina displays

### Notifications
- Require `NSUserNotificationCenter` (handled by Electron automatically)
- Clicking notification fires `click` event → use `shell.openExternal()` for URLs

### Packaging & Distribution
- `electron-builder` configured in `package.json` `build` section (to be added)
- Notarization required for macOS Catalina+ (add Apple ID credentials)
- Code signing certificate from Apple Developer account

## Shell-Specific Notes (fish)
When generating terminal commands:
- No heredocs (use `printf` or `echo` instead)
- Command substitution: `(command)` not `$(command)`
- Environment vars: `set -x VAR value` not `export VAR=value`

## Dependencies of Note

- **keytar** — native module for Keychain access (requires Xcode Command Line Tools)
- **electron-store** — listed but unused in scaffold; remove or use for app preferences
- **axios** — GitHub API client; consider migrating to `fetch` to reduce bundle size
- **concurrently** + **wait-on** — dev workflow helpers for running Vite + Electron together

## Next Steps for AI Agents

When asked to implement features:
1. **OAuth flow** → Start with `electron/main.js`, add IPC handlers, integrate keytar
2. **UI improvements** → Work in `src/App.jsx`, consider component extraction for notification list
3. **Settings/Preferences** → Create new renderer view, add IPC for preferences persistence
4. **Provider support beyond GitHub** → Abstract `github.js` into `providers/github.js`, create interface pattern
5. **Build/packaging** → Add `build` config to `package.json`, create entitlements for keychain access
