# Tabbed-In – Advanced Cross-Device Session Manager

A Firefox browser extension that logs, syncs, and restores complete browser sessions across devices.

---

## Features

- **Log Session** – Capture all open tabs in the current window with one click
- **Log & Close** – Save your tabs and close them to free up memory
- **Cross-device sync** – Push sessions to Firefox Sync so they appear on other devices automatically
- **Session drawer** – Expand any session to see all its tabs, open individual ones, or restore all
- **Live tab view** – Browse your currently open tabs from the popup
- **Import / Export** – Backup sessions as JSON or restore from a file
- **Custom device names** – Tag sessions with a friendly device name
- **Dark / Light / System theme** – Follows your OS preference or can be forced

---

## Installation (Developer / Temporary Load)

1. Open Firefox and navigate to `about:debugging`
2. Click **This Firefox**
3. Click **Load Temporary Add-on...**
4. Browse to this folder and select `manifest.json`
5. The Tabbed-In icon will appear in your toolbar

For permanent installation, the extension must be signed by Mozilla via [addons.mozilla.org](https://addons.mozilla.org).

---

## File Structure

```
Tabbed-In-extension/
├── manifest.json           # Extension manifest (MV2)
├── background/
│   └── background.js       # Service worker: session capture, storage, sync
├── popup/
│   ├── popup.html          # Main popup UI
│   ├── popup.css           # Styles (light + dark mode)
│   └── popup.js            # Popup controller
├── icons/
│   ├── icon-16.png
│   ├── icon-32.png
│   ├── icon-48.png
│   ├── icon-96.png
│   └── icon-128.png
└── README.md
```

---

## How It Works

### Session Capture
The background script queries `browser.tabs.query()` for the current window, filters out privileged URLs (`about:`, `chrome:`, etc.), and serialises the result into a session object containing:

- Session ID, label, creation timestamp
- Device ID and name
- Array of tab objects: URL, title, favicon, pinned state, active state

### Storage
- **Local sessions** are stored in `browser.storage.local` under `Tabbed-In_sessions`
- **Sync sessions** are stored in `browser.storage.sync` under keys like `sess_<id>`, compressed to fit Firefox Sync's 8KB-per-item quota

### Sync
When sync is enabled:
1. On save, the session is pushed to `browser.storage.sync`
2. On other devices, `browser.storage.onChanged` fires and new sessions are pulled into local storage
3. Notifications alert you when synced sessions arrive

### Conflict Resolution
Last-write-wins per session ID. Sessions are identified by unique IDs so merging always preserves both sides.

---

## Permissions Explained

| Permission | Reason |
|---|---|
| `tabs` | Read tab URLs, titles, and favicons |
| `storage` | Save sessions locally and to Firefox Sync |
| `sessions` | Access recently closed sessions (future feature) |
| `notifications` | Alert when sessions are logged or synced |
| `identity` | Firefox Account identity for sync (optional) |

---

## Privacy

- All session data stays in your browser's local storage or Firefox Sync (if enabled)
- No data is ever sent to third-party servers
- Sync uses Firefox's end-to-end encrypted Mozilla Sync infrastructure
- Privileged URLs (`about:config`, extension pages, etc.) are never captured
