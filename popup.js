document.addEventListener("DOMContentLoaded", () => {
  const listElement = document.getElementById("session-list");
  const btnLogKeep = document.getElementById("btn-log-keep");
  const btnLogClose = document.getElementById("btn-log-close");
  const statusMsg = document.getElementById("status-msg");


  renderSessions();

  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.sessions) {
      renderSessions();
    }
  });



  btnLogKeep.addEventListener("click", async () => {
    setLoading(true);
    await browser.runtime.sendMessage({ action: "log_session", shouldClose: false });
    setLoading(false);
    showStatus("Session Saved!");
  });

  btnLogClose.addEventListener("click", async () => {
    setLoading(true);
    await browser.runtime.sendMessage({ action: "log_session", shouldClose: true });
    setLoading(false);
    
  });



  async function renderSessions() {
    const storage = await browser.storage.local.get("sessions");
    const sessions = storage.sessions || [];

    listElement.innerHTML = "";

    if (sessions.length === 0) {
      listElement.innerHTML = '<li class="empty-state">No saved sessions found.</li>';
      return;
    }

    sessions.forEach(session => {
      const li = document.createElement("li");
      li.className = "session-item";
      
      // Safe Title Truncation
      const firstTabTitle = session.tabs[0]?.title || "Unknown Tab";
      const safeTitle = firstTabTitle.length > 40 ? firstTabTitle.substring(0, 40) + "..." : firstTabTitle;

      li.innerHTML = `
        <div class="session-header">
          <span class="date-label">${session.timestamp}</span>
          <span class="tab-count">${session.tabs.length} Tabs</span>
        </div>
        <div class="session-preview">
           <small>${safeTitle}</small>
        </div>
        <div class="session-actions">
          <button class="btn-small restore-btn" data-id="${session.id}">Restore</button>
          <button class="btn-small delete-btn danger" data-id="${session.id}">Delete</button>
        </div>
      `;

      listElement.appendChild(li);
    });

    // Attach Listeners to dynamic buttons
    document.querySelectorAll(".restore-btn").forEach(btn => {
      btn.addEventListener("click", (e) => handleRestore(e.target.dataset.id));
    });

    document.querySelectorAll(".delete-btn").forEach(btn => {
      btn.addEventListener("click", (e) => handleDelete(e.target.dataset.id));
    });
  }

  async function handleRestore(id) {
    await browser.runtime.sendMessage({ action: "restore_session", id: id });
    showStatus("Session Restored");
  }

  async function handleDelete(id) {
    await browser.runtime.sendMessage({ action: "delete_session", id: id });
    showStatus("Session Deleted");
  }

  function setLoading(isLoading) {
    btnLogKeep.disabled = isLoading;
    btnLogClose.disabled = isLoading;
    btnLogKeep.innerText = isLoading ? "Saving..." : "Log Session";
  }

  function showStatus(msg) {
    statusMsg.innerText = msg;
    statusMsg.classList.remove("hidden");
    setTimeout(() => {
      statusMsg.classList.add("hidden");
    }, 2000);
  }
});