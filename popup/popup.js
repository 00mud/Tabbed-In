

"use strict";

// ─── Messaging ───────────────────────────────────────────────────────────────

function msg(type, extra = {}) {
  return browser.runtime.sendMessage({ type, ...extra });
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);

// Navigation
const navBtns     = $$(".nav-btn");
const views       = $$(".view");
const actionBar   = $("action-bar");

// Action bar
const btnLog      = $("btn-log");
const btnLogClose = $("btn-log-close");

// Label row
const labelRow    = $("label-row");
const labelInput  = $("session-label");
const btnConfirm  = $("btn-confirm");
const btnCancel   = $("btn-cancel");

// Sessions
const sessionList   = $("session-list");
const emptyState    = $("empty-sessions");
const searchInput   = $("search-sessions");

// Remote
const remoteList    = $("remote-list");
const emptyRemote   = $("empty-remote");
const btnRefRemote  = $("btn-refresh-remote");

// Live tabs
const liveTabList   = $("live-tab-list");

// Drawer
const drawer        = $("drawer");
const drawerOverlay = $("drawer-overlay");
const drawerTitle   = $("drawer-title");
const drawerTabs    = $("drawer-tab-list");
const drawerRestore = $("drawer-restore");
const drawerCopy    = $("drawer-copy-urls");
const drawerDelete  = $("drawer-delete");
const drawerClose   = $("drawer-close");

// Settings
const settingDeviceName  = $("setting-device-name");
const settingSync        = $("setting-sync");
const settingNotif       = $("setting-notifications");
const settingMax         = $("setting-max-sessions");
const settingTheme       = $("setting-theme");
const btnSaveSettings    = $("btn-save-settings");
const btnExport          = $("btn-export");
const btnImport          = $("btn-import");
const importFile         = $("import-file");
const btnClearAll        = $("btn-clear-all");

// Toast
const toastEl = $("toast");

// ─── State ────────────────────────────────────────────────────────────────────

let allSessions   = [];
let pendingAction = null; // "log" | "log-close"
let openSessionId = null;

// ─── Toast ────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(text, isError = false) {
  toastEl.textContent = text;
  toastEl.classList.toggle("toast-error", isError);
  toastEl.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add("hidden"), 2400);
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function switchView(viewId) {
  views.forEach(v => v.classList.toggle("active", v.id === "view-" + viewId));
  navBtns.forEach(b => b.classList.toggle("active", b.dataset.view === viewId));
  actionBar.classList.toggle("hidden", viewId === "settings");

  if (viewId === "sessions")  loadSessions();
  if (viewId === "live")      loadLiveTabs();
  if (viewId === "remote")    loadRemoteSessions();
  if (viewId === "settings")  loadSettings();
}

navBtns.forEach(btn => {
  btn.addEventListener("click", () => switchView(btn.dataset.view));
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now - d;
  const diffH  = diffMs / 3600000;

  if (diffH < 1)  return "Just now";
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffH < 48) return "Yesterday";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
}

function faviconImg(url, fallback = "") {
  if (!url) return null;
  const img = document.createElement("img");
  img.className = "tab-favicon";
  img.src = url;
  img.onerror = () => {
    const fb = document.createElement("div");
    fb.className = "tab-favicon-fallback";
    fb.textContent = (fallback || "?")[0].toUpperCase();
    img.replaceWith(fb);
  };
  return img;
}

// ─── Action Bar ───────────────────────────────────────────────────────────────

btnLog.addEventListener("click", () => {
  pendingAction = "log";
  labelRow.classList.remove("hidden");
  labelInput.value = "";
  labelInput.focus();
});

btnLogClose.addEventListener("click", () => {
  pendingAction = "log-close";
  labelRow.classList.remove("hidden");
  labelInput.value = "";
  labelInput.focus();
});

btnConfirm.addEventListener("click", executeAction);
labelInput.addEventListener("keydown", e => {
  if (e.key === "Enter")  executeAction();
  if (e.key === "Escape") cancelAction();
});

btnCancel.addEventListener("click", cancelAction);

function cancelAction() {
  pendingAction = null;
  labelRow.classList.add("hidden");
}

async function executeAction() {
  const label = labelInput.value.trim();
  labelRow.classList.add("hidden");

  if (pendingAction === "log") {
    btnLog.disabled = true;
    try {
      const res = await msg("LOG_SESSION", { label: label || undefined });
      if (res && res.ok) {
        showToast(`✓ Session saved (${res.session.tabCount} tabs)`);
        loadSessions();
      } else {
        showToast(res?.error || "Failed to log session", true);
      }
    } finally {
      btnLog.disabled = false;
    }
  }

  if (pendingAction === "log-close") {
    btnLogClose.disabled = true;
    try {
      const res = await msg("LOG_AND_CLOSE", { label: label || undefined });
      if (res && res.ok) {
        showToast(`✓ Session saved & tabs closed`);
        loadSessions();
      } else {
        showToast(res?.error || "Failed", true);
      }
    } finally {
      btnLogClose.disabled = false;
    }
  }

  pendingAction = null;
}

// ─── Sessions List ────────────────────────────────────────────────────────────

async function loadSessions() {
  allSessions = await msg("GET_SESSIONS") || [];
  renderSessions(allSessions);
}

function renderSessions(sessions) {
  const query = searchInput.value.toLowerCase().trim();
  const filtered = query
    ? sessions.filter(s =>
        s.label.toLowerCase().includes(query) ||
        s.tabs.some(t => t.title.toLowerCase().includes(query) || t.url.toLowerCase().includes(query))
      )
    : sessions;

  emptyState.classList.toggle("hidden", filtered.length > 0);

  const existing = sessionList.querySelectorAll(".session-card");
  existing.forEach(el => el.remove());

  filtered.forEach(session => {
    const card = buildSessionCard(session, false);
    sessionList.appendChild(card);
  });
}

function buildSessionCard(session, isRemote) {
  const card = document.createElement("div");
  card.className = "session-card";
  card.dataset.id = session.id;

  const icon = document.createElement("div");
  icon.className = "session-card-icon";
  icon.textContent = session.tabCount;

  const body = document.createElement("div");
  body.className = "session-card-body";

  const label = document.createElement("div");
  label.className = "session-card-label";
  label.textContent = session.label;

  const meta = document.createElement("div");
  meta.className = "session-card-meta";

  const when = document.createElement("span");
  when.textContent = formatDate(session.createdAt);
  meta.appendChild(when);

  if (session.deviceName) {
    const dot = document.createElement("span");
    dot.textContent = "·";
    meta.appendChild(dot);
    const dev = document.createElement("span");
    dev.textContent = session.deviceName;
    meta.appendChild(dev);
  }

  if (isRemote || session.isRemote) {
    const badge = document.createElement("span");
    badge.className = "session-badge remote";
    badge.textContent = "synced";
    meta.appendChild(badge);
  }

  body.appendChild(label);
  body.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "session-card-actions";

  const restoreBtn = document.createElement("button");
  restoreBtn.className = "icon-btn";
  restoreBtn.title = "Restore in new window";
  restoreBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  restoreBtn.addEventListener("click", async e => {
    e.stopPropagation();
    const res = await msg("RESTORE_SESSION", { sessionId: session.id });
    if (!res.ok) showToast(res.error, true);
    else showToast("✓ Session restored");
  });

  const deleteBtn = document.createElement("button");
  deleteBtn.className = "icon-btn";
  deleteBtn.title = "Delete";
  deleteBtn.innerHTML = `<svg viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  deleteBtn.addEventListener("click", async e => {
    e.stopPropagation();
    await msg("DELETE_SESSION", { sessionId: session.id });
    loadSessions();
    showToast("Session deleted");
  });

  actions.appendChild(restoreBtn);
  actions.appendChild(deleteBtn);

  card.appendChild(icon);
  card.appendChild(body);
  card.appendChild(actions);

  // Click opens drawer
  card.addEventListener("click", () => openDrawer(session));

  return card;
}

searchInput.addEventListener("input", () => renderSessions(allSessions));

// ─── Remote Sessions ──────────────────────────────────────────────────────────

async function loadRemoteSessions() {
  remoteList.innerHTML = "";
  remoteList.appendChild(emptyRemote);
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  remoteList.appendChild(spinner);

  try {
    const sessions = await msg("GET_REMOTE_SESSIONS") || [];
    spinner.remove();
    emptyRemote.classList.toggle("hidden", sessions.length > 0);
    sessions.forEach(s => {
      const card = buildSessionCard(s, true);
      remoteList.appendChild(card);
    });
  } catch {
    spinner.remove();
    showToast("Could not load remote sessions", true);
  }
}

btnRefRemote.addEventListener("click", loadRemoteSessions);

// ─── Live Tabs ────────────────────────────────────────────────────────────────

async function loadLiveTabs() {
  liveTabList.innerHTML = "";
  const spinner = document.createElement("div");
  spinner.className = "spinner";
  liveTabList.appendChild(spinner);

  const tabs = await msg("GET_CURRENT_TABS") || [];
  spinner.remove();

  tabs.forEach(tab => {
    const item = document.createElement("div");
    item.className = "tab-item";

    const fav = faviconImg(tab.favIcon, tab.title);
    if (fav) item.appendChild(fav);
    else {
      const fb = document.createElement("div");
      fb.className = "tab-favicon-fallback";
      fb.textContent = (tab.title || "?")[0];
      item.appendChild(fb);
    }

    const info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0;";

    const title = document.createElement("div");
    title.className = "tab-title";
    title.textContent = tab.title || tab.url;

    const url = document.createElement("div");
    url.className = "tab-url";
    url.textContent = tab.url;

    info.appendChild(title);
    info.appendChild(url);
    item.appendChild(info);

    if (tab.active) {
      const dot = document.createElement("div");
      dot.className = "tab-active-dot";
      dot.title = "Active tab";
      item.appendChild(dot);
    }

    item.addEventListener("click", () => msg("OPEN_TAB", { url: tab.url }));
    liveTabList.appendChild(item);
  });
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

function openDrawer(session) {
  openSessionId = session.id;
  drawerTitle.textContent = session.label;
  drawerTabs.innerHTML = "";

  session.tabs.forEach(tab => {
    const item = document.createElement("div");
    item.className = "drawer-tab-item";

    const fav = document.createElement("img");
    fav.className = "drawer-tab-favicon";
    fav.src = tab.favIcon || "";
    fav.onerror = () => {
      const fb = document.createElement("div");
      fb.className = "tab-favicon-fallback";
      fb.textContent = (tab.title || "?")[0];
      fav.replaceWith(fb);
    };

    const info = document.createElement("div");
    info.style.cssText = "flex:1;min-width:0;";

    const title = document.createElement("div");
    title.className = "drawer-tab-title";
    title.textContent = tab.title || tab.url;

    const url = document.createElement("div");
    url.className = "drawer-tab-url";
    url.textContent = tab.url;

    info.appendChild(title);
    info.appendChild(url);

    item.appendChild(fav);
    item.appendChild(info);
    item.addEventListener("click", () => msg("OPEN_TAB", { url: tab.url }));

    drawerTabs.appendChild(item);
  });

  drawer.setAttribute("aria-hidden", "false");
  drawerOverlay.classList.remove("hidden");
}

function closeDrawer() {
  drawer.setAttribute("aria-hidden", "true");
  drawerOverlay.classList.add("hidden");
  openSessionId = null;
}

drawerClose.addEventListener("click", closeDrawer);
drawerOverlay.addEventListener("click", closeDrawer);

drawerRestore.addEventListener("click", async () => {
  if (!openSessionId) return;
  const res = await msg("RESTORE_SESSION", { sessionId: openSessionId });
  if (!res.ok) showToast(res.error, true);
  else { closeDrawer(); showToast("✓ Session restored in new window"); }
});

drawerCopy.addEventListener("click", async () => {
  if (!openSessionId) return;
  const sessions = await msg("GET_SESSIONS");
  const session  = sessions.find(s => s.id === openSessionId);
  if (!session) return;
  const text = session.tabs.map(t => t.url).join("\n");
  await navigator.clipboard.writeText(text);
  showToast("URLs copied to clipboard");
});

drawerDelete.addEventListener("click", async () => {
  if (!openSessionId) return;
  await msg("DELETE_SESSION", { sessionId: openSessionId });
  closeDrawer();
  loadSessions();
  showToast("Session deleted");
});

// ─── Settings ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  const s = await msg("GET_SETTINGS");
  settingDeviceName.value   = s.deviceName || "";
  settingSync.checked       = s.syncEnabled;
  settingNotif.checked      = s.notificationsOn;
  settingMax.value          = String(s.maxSessions);
  settingTheme.value        = s.theme || "system";
}

btnSaveSettings.addEventListener("click", async () => {
  const settings = {
    deviceName:      settingDeviceName.value.trim(),
    syncEnabled:     settingSync.checked,
    notificationsOn: settingNotif.checked,
    maxSessions:     parseInt(settingMax.value, 10),
    theme:           settingTheme.value,
  };
  await msg("SAVE_SETTINGS", { settings });
  applyTheme(settings.theme);
  showToast("Settings saved");
});

settingTheme.addEventListener("change", () => applyTheme(settingTheme.value));

function applyTheme(theme) {
  document.body.classList.remove("theme-light", "theme-dark");
  if (theme === "light") document.body.classList.add("theme-light");
  if (theme === "dark")  document.body.classList.add("theme-dark");
}

// ─── Export ───────────────────────────────────────────────────────────────────

btnExport.addEventListener("click", async () => {
  const json = await msg("EXPORT_SESSIONS");
  const blob = new Blob([json], { type: "application/json" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url;
  a.download = `tabuu-sessions-${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  showToast("Sessions exported");
});

btnImport.addEventListener("click", () => importFile.click());

importFile.addEventListener("change", async () => {
  const file = importFile.files[0];
  if (!file) return;
  const text = await file.text();
  const res  = await msg("IMPORT_SESSIONS", { json: text });
  if (res.ok) {
    showToast(`✓ Imported ${res.count} new sessions`);
    loadSessions();
  } else {
    showToast(res.error || "Import failed", true);
  }
  importFile.value = "";
});

btnClearAll.addEventListener("click", async () => {
  if (!confirm("Delete ALL saved sessions? This cannot be undone.")) return;
  const sessions = await msg("GET_SESSIONS");
  for (const s of sessions) await msg("DELETE_SESSION", { sessionId: s.id });
  loadSessions();
  showToast("All sessions cleared");
});

// ─── Init ─────────────────────────────────────────────────────────────────────

(async () => {
  const settings = await msg("GET_SETTINGS");
  applyTheme(settings.theme || "system");
  loadSessions();
})();
