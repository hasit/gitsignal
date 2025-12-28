# GitSignal — GitHub Notifications for macOS

A macOS menubar app for GitHub notifications built with Electron and React.

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Get a GitHub Personal Access Token

GitHub’s Notifications API currently only supports **Personal access tokens (classic)**.

1. Go to GitHub → Settings → Developer settings → Personal access tokens → Tokens (classic) → **Generate new token (classic)**
   - Direct link: [github.com/settings/tokens/new](https://github.com/settings/tokens/new)
2. Name it `GitSignal` and pick an expiration
3. Select scope: ✅ `notifications`
4. Click **Generate token** and copy it (starts with `ghp_`)

### 3. Run the App

#### Two terminals (recommended for development)

```bash
# Terminal 1: Start Vite dev server
npm run dev

# Terminal 2: Start Electron
npm run start
```

#### Or one command

```bash
npm run dev:electron
```

### 4. Add Your Token

1. Paste your GitHub token in the app
2. Click "Save Token"
3. That's it! Your notifications will start appearing 🎉

Your token is securely stored in macOS Keychain.

## Features

- ✅ Secure token storage (macOS Keychain via keytar)
- ✅ Real-time notification polling with ETag caching
- ✅ Native macOS notifications
- ✅ System tray integration
- ✅ Mark notifications as read
- ✅ No OAuth setup required - just paste your token!

## For Distribution

This app uses **Personal Access Tokens** instead of OAuth, which is better for distribution because:

- ✅ No OAuth app registration needed
- ✅ Users have full control over their tokens
- ✅ More transparent and secure
- ✅ Works offline (no callback server needed)
- ✅ Simpler for end users

## Building for Production

```bash
# Build the renderer (web assets)
npm run build:web

# Build the macOS app (.dmg)
npm run build:electron
```

This creates a `.dmg` file in the `dist/` folder that you can distribute.

## CI/CD (GitHub Actions)

This repo includes:

- `ci.yml`: runs a build on PRs and pushes to `main`
- `pages.yml`: deploys the website to GitHub Pages (custom domain: `gitsignal.dev`) on pushes to `main`
- `release.yml`: builds a macOS `.dmg` and publishes a GitHub Release when you push a `v*` tag

### GitHub Pages setup

1. In GitHub repo settings → **Pages**, set **Source** to **GitHub Actions**
2. Set the custom domain to `gitsignal.dev` (the workflow publishes `public/CNAME`)

### Creating a release

```bash
git tag v0.1.0
git push origin v0.1.0
```
