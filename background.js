// Initialize Storage and Menu on Install
browser.runtime.onInstalled.addListener(() => {
  browser.storage.local.get("sessions").then((data) => {
    if (!data.sessions) {
      browser.storage.local.set({ sessions: [] });
    }
  });

  browser.menus.create({
    id: "quick-save",
    title: "Tabuu: Quick Save Session",
    contexts: ["all"]
  });
});

// Handle Right-Click Menu
browser.menus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "quick-save") {
    handleSessionLog(false); 
  }
});

// Handle Messages from Popup (The Router)
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "log_session") {
    return handleSessionLog(message.shouldClose);
  }
  if (message.action === "delete_session") {
    return handleDeleteSession(message.id);
  }
  if (message.action === "restore_session") {
    return handleRestoreSession(message.id);
  }
});

// --- Core Logic Functions ---

async function handleSessionLog(shouldClose) {
  try {
    const tabs = await browser.tabs.query({ currentWindow: true });

    const sessionData = {
      id: Date.now(),
      timestamp: new Date().toLocaleString(),
      tabs: tabs.map(t => ({
        title: t.title,
        url: t.url,
        favIconUrl: t.favIconUrl || ""
      }))
    };

    const storage = await browser.storage.local.get("sessions");
    let sessions = storage.sessions || [];
    sessions.unshift(sessionData);
    
    await browser.storage.local.set({ sessions });

    if (shouldClose) {
      // Open a blank tab first so the window doesn't close
      await browser.tabs.create({});
      const tabIds = tabs.map(t => t.id);
      await browser.tabs.remove(tabIds);
    }
    return { status: "success" };
  } catch (error) {
    console.error("Log Error:", error);
    return { status: "error", message: error.message };
  }
}

async function handleDeleteSession(id) {
  try {
    const storage = await browser.storage.local.get("sessions");
    let sessions = storage.sessions || [];
    sessions = sessions.filter(s => s.id != id);
    await browser.storage.local.set({ sessions });
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}

async function handleRestoreSession(id) {
  try {
    const storage = await browser.storage.local.get("sessions");
    const session = storage.sessions.find(s => s.id == id);
    
    if (session && session.tabs) {
      
      session.tabs.forEach(tab => {
        browser.tabs.create({ url: tab.url, active: false });
      });
    }
    return { status: "success" };
  } catch (error) {
    return { status: "error", message: error.message };
  }
}