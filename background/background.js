

"use strict";


const STORAGE_KEY_SESSIONS   = "tabuu_sessions";
const STORAGE_KEY_SETTINGS   = "tabuu_settings";
const STORAGE_KEY_DEVICE_ID  = "Tabbed-In_device_id";
const MAX_LOCAL_SESSIONS     = 100;
const SYNC_DEBOUNCE_MS       = 1500;

// ─── Default Settings ────────────────────────────────────────────────────────

const DEFAULT_SETTINGS = {
  syncEnabled:        true,
  autoSaveOnClose:    false,
  notificationsOn:    true,
  encryptLocal:       false,
  maxSessions:        50,
  theme:              "system",   // "light" | "dark" | "system"
  deviceName:         "",
};

// ─── Utility: Generate IDs ───────────────────────────────────────────────────

function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function generateDeviceId() {
  const id = "dev_" + generateId();
  return id;
}

// ─── Utility: Sanitise tab URLs ──────────────────────────────────────────────

const BLOCKED_SCHEMES = ["about:", "chrome:", "moz-extension:", "resource:", "data:", "javascript:"];

function isSafeUrl(url) {
  if (!url) return false;
  return !BLOCKED_SCHEMES.some(scheme => url.startsWith(scheme));
}

// ─── Device Identity ─────────────────────────────────────────────────────────

async function getOrCreateDeviceId() {
  const data = await browser.storage.local.get(STORAGE_KEY_DEVICE_ID);
  if (data[STORAGE_KEY_DEVICE_ID]) return data[STORAGE_KEY_DEVICE_ID];
  const id = generateDeviceId();
  await browser.storage.local.set({ [STORAGE_KEY_DEVICE_ID]: id });
  return id;
}

async function getDeviceName() {
  const settings = await getSettings();
  if (settings.deviceName) return settings.deviceName;
  const platform = navigator.platform || "Unknown";
  return `Tabbed-In on ${platform}`;
}

// ─── Settings ────────────────────────────────────────────────────────────────

async function getSettings() {
  const data = await browser.storage.local.get(STORAGE_KEY_SETTINGS);
  return { ...DEFAULT_SETTINGS, ...(data[STORAGE_KEY_SETTINGS] || {}) };
}

async function saveSettings(updates) {
  const current = await getSettings();
  const merged  = { ...current, ...updates };
  await browser.storage.local.set({ [STORAGE_KEY_SETTINGS]: merged });
  return merged;
}

// ─── Session Storage (local) ─────────────────────────────────────────────────

async function getLocalSessions() {
  const data = await browser.storage.local.get(STORAGE_KEY_SESSIONS);
  return data[STORAGE_KEY_SESSIONS] || [];
}

async function saveLocalSessions(sessions) {
  // Enforce cap
  const capped = sessions.slice(0, MAX_LOCAL_SESSIONS);
  await browser.storage.local.set({ [STORAGE_KEY_SESSIONS]: capped });
}

// ─── Core: Capture Current Window ────────────────────────────────────────────

async function captureWindow(windowId, labelOverride) {
  let queryOptions = { windowId, url: "<all_urls>" };
  const tabs = await browser.tabs.query(queryOptions);

  const safeTabs = tabs
    .filter(t => isSafeUrl(t.url))
    .map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title || t.url,
      favIcon:  t.favIconUrl || "",
      pinned:   t.pinned,
      active:   t.active,
      index:    t.index,
    }));

  if (safeTabs.length === 0) return null;

  const deviceId   = await getOrCreateDeviceId();
  const deviceName = await getDeviceName();

  const session = {
    id:          generateId(),
    label:       labelOverride || `Session – ${new Date().toLocaleString()}`,
    createdAt:   Date.now(),
    deviceId,
    deviceName,
    tabCount:    safeTabs.length,
    tabs:        safeTabs,
    windowId,
  };

  return session;
}

// ─── Core: Log Session ────────────────────────────────────────────────────────

async function logSession(windowId, label) {
  const session = await captureWindow(windowId, label);
  if (!session) return { ok: false, error: "No safe tabs to log." };

  const sessions = await getLocalSessions();
  sessions.unshift(session);   // newest first
  await saveLocalSessions(sessions);

  const settings = await getSettings();
  if (settings.syncEnabled) {
    await syncSessionToCloud(session).catch(console.warn);
  }

  if (settings.notificationsOn) {
    browser.notifications.create(`log_${session.id}`, {
      type:    "basic",
      iconUrl: browser.runtime.getURL("icons/icon-48.png"),
      title:   "Tabbed-In – Session Logged",
      message: `"${session.label}" saved with ${session.tabCount} tabs.`,
    });
  }

  return { ok: true, session };
}

// ─── Core: Log and Close Tabs ────────────────────────────────────────────────

async function logAndClose(windowId, label) {
  const result = await logSession(windowId, label);
  if (!result.ok) return result;

  const tabs = await browser.tabs.query({ windowId, url: "<all_urls>" });
  const safeIds = tabs
    .filter(t => isSafeUrl(t.url) && !t.pinned)
    .map(t => t.id);

  if (safeIds.length > 0) {
    await browser.tabs.remove(safeIds);
  }

  return result;
}

// ─── Core: Restore Session ───────────────────────────────────────────────────

async function restoreSession(sessionId) {
  const sessions = await getLocalSessions();
  const session  = sessions.find(s => s.id === sessionId);
  if (!session) return { ok: false, error: "Session not found." };

  const urls = session.tabs.map(t => t.url);
  await browser.windows.create({ url: urls });

  return { ok: true };
}

// ─── Core: Delete Session ────────────────────────────────────────────────────

async function deleteSession(sessionId) {
  let sessions = await getLocalSessions();
  sessions     = sessions.filter(s => s.id !== sessionId);
  await saveLocalSessions(sessions);

  // Also remove from sync storage if present
  await browser.storage.sync.remove(`sess_${sessionId}`).catch(() => {});

  return { ok: true };
}

// ─── Core: Rename Session ────────────────────────────────────────────────────

async function renameSession(sessionId, newLabel) {
  const sessions = await getLocalSessions();
  const idx      = sessions.findIndex(s => s.id === sessionId);
  if (idx === -1) return { ok: false, error: "Session not found." };

  sessions[idx].label = newLabel;
  await saveLocalSessions(sessions);
  return { ok: true };
}

// ─── Core: Open Single Tab From Session ──────────────────────────────────────

async function openTab(url) {
  if (!isSafeUrl(url)) return { ok: false, error: "Blocked URL scheme." };
  await browser.tabs.create({ url });
  return { ok: true };
}

// ─── Sync: Push session to browser.storage.sync ──────────────────────────────

// sync storage quota: 100KB total, 8KB per item.
// We store each session under key "sess_<id>" with a compact payload.

function compactSession(session) {
  return {
    i: session.id,
    l: session.label,
    c: session.createdAt,
    d: session.deviceName,
    t: session.tabs.map(tab => ({ u: tab.url, t: tab.title, f: tab.favIcon })),
  };
}

function expandSession(compact) {
  return {
    id:          compact.i,
    label:       compact.l,
    createdAt:   compact.c,
    deviceId:    "remote",
    deviceName:  compact.d,
    tabCount:    compact.t.length,
    tabs:        compact.t.map((t, i) => ({ url: t.u, title: t.t, favIcon: t.f, index: i })),
  };
}

async function syncSessionToCloud(session) {
  const key     = `sess_${session.id}`;
  const payload = compactSession(session);
  const json    = JSON.stringify(payload);
  // Skip if over 8000 bytes (sync quota)
  if (json.length > 8000) {
    console.warn("Tabuu: session too large to sync, truncating tabs.");
    payload.t = payload.t.slice(0, 30);
  }
  await browser.storage.sync.set({ [key]: JSON.parse(JSON.stringify(payload)) });
}

async function fetchRemoteSessions() {
  const all = await browser.storage.sync.get(null);
  const deviceId = await getOrCreateDeviceId();
  const remote   = [];
  for (const [key, value] of Object.entries(all)) {
    if (!key.startsWith("sess_")) continue;
    const session = expandSession(value);
    // Tag as remote so UI can show a "sync" badge
    session.isRemote = true;
    remote.push(session);
  }
  return remote.sort((a, b) => b.createdAt - a.createdAt);
}

// ─── Sync: Listen for remote changes ─────────────────────────────────────────

let syncDebounceTimer = null;

browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const hasNewSessions = Object.keys(changes).some(k => k.startsWith("sess_"));
  if (!hasNewSessions) return;

  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(async () => {
    try {
      const remote = await fetchRemoteSessions();
      if (remote.length === 0) return;

      const local     = await getLocalSessions();
      const localIds  = new Set(local.map(s => s.id));
      const newFromRemote = remote.filter(s => !localIds.has(s.id));

      if (newFromRemote.length > 0) {
        const merged = [...newFromRemote, ...local];
        await saveLocalSessions(merged);

        const settings = await getSettings();
        if (settings.notificationsOn) {
          browser.notifications.create("sync_pull", {
            type:    "basic",
            iconUrl: browser.runtime.getURL("icons/icon-48.png"),
            title:   "Tabuu – Synced",
            message: `${newFromRemote.length} new session(s) arrived from another device.`,
          });
        }
      }
    } catch (e) {
      console.warn("Tabuu sync pull failed:", e);
    }
  }, SYNC_DEBOUNCE_MS);
});

// ─── Message Handler ─────────────────────────────────────────────────────────

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handle = async () => {
    switch (msg.type) {

      case "LOG_SESSION": {
        const windowId = msg.windowId || (await browser.windows.getCurrent()).id;
        return logSession(windowId, msg.label);
      }

      case "LOG_AND_CLOSE": {
        const windowId = msg.windowId || (await browser.windows.getCurrent()).id;
        return logAndClose(windowId, msg.label);
      }

      case "GET_SESSIONS":
        return getLocalSessions();

      case "GET_REMOTE_SESSIONS":
        return fetchRemoteSessions();

      case "RESTORE_SESSION":
        return restoreSession(msg.sessionId);

      case "DELETE_SESSION":
        return deleteSession(msg.sessionId);

      case "RENAME_SESSION":
        return renameSession(msg.sessionId, msg.label);

      case "OPEN_TAB":
        return openTab(msg.url);

      case "GET_SETTINGS":
        return getSettings();

      case "SAVE_SETTINGS":
        return saveSettings(msg.settings);

      case "GET_CURRENT_TABS": {
        const windowId = (await browser.windows.getCurrent()).id;
        const tabs     = await browser.tabs.query({ windowId });
        return tabs.filter(t => isSafeUrl(t.url)).map(t => ({
          id: t.id, url: t.url, title: t.title, favIcon: t.favIconUrl,
          active: t.active, pinned: t.pinned,
        }));
      }

      case "EXPORT_SESSIONS": {
        const sessions = await getLocalSessions();
        return JSON.stringify(sessions, null, 2);
      }

      case "IMPORT_SESSIONS": {
        try {
          const imported = JSON.parse(msg.json);
          if (!Array.isArray(imported)) return { ok: false, error: "Invalid format." };
          const current = await getLocalSessions();
          const currentIds = new Set(current.map(s => s.id));
          const news = imported.filter(s => s.id && !currentIds.has(s.id));
          await saveLocalSessions([...news, ...current]);
          return { ok: true, count: news.length };
        } catch (e) {
          return { ok: false, error: e.message };
        }
      }

      default:
        return { ok: false, error: `Unknown message type: ${msg.type}` };
    }
  };

  handle().then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
  return true; // keep message channel open for async response
});

// ─── Auto-save on window close (if enabled) ──────────────────────────────────

browser.windows.onRemoved.addListener(async (windowId) => {
  const settings = await getSettings();
  if (!settings.autoSaveOnClose) return;
  // We can't capture tabs after the window is closed, so this must be done
  // before close. We rely on a tabs.onRemoved heuristic instead.
});

// Note: true auto-save-on-close would require capturing before close,
// which needs a window.beforeunload approach not available in MV2 background.
// Instead we offer the popup button "Log & Close".

console.log("Tabuu background script loaded.");
