// ── State ──
let currentTabId = null;
let isOffline = false;

// ── Helpers ──

function getDomain(url) {
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url || 'Unknown';
  }
}

function showError(msg) {
  const toast = document.getElementById('errorToast');
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 3000);
}

// ── Render current tab ──

function renderCurrentTab(tab) {
  const domain = getDomain(tab.url);
  document.getElementById('currentDomain').textContent = domain;
  document.getElementById('currentTitle').textContent = tab.title || '';

  const favicon = document.getElementById('currentFavicon');
  if (tab.favIconUrl) {
    favicon.src = tab.favIconUrl;
    favicon.classList.remove('placeholder');
  } else {
    favicon.src = '';
    favicon.classList.add('placeholder');
    favicon.alt = '🌐';
  }
}

function updateToggleState() {
  const card = document.getElementById('currentTabCard');
  const pill = document.getElementById('statusPill');
  const toggle = document.getElementById('offlineToggle');

  toggle.checked = isOffline;

  if (isOffline) {
    card.classList.add('offline');
    pill.textContent = 'Offline';
    pill.className = 'status-pill offline';
  } else {
    card.classList.remove('offline');
    pill.textContent = 'Online';
    pill.className = 'status-pill online';
  }
}

// ── Render managed tabs list ──

async function renderManagedTabs(tabIds) {
  const list = document.getElementById('managedList');
  const count = document.getElementById('offlineCount');

  // Filter out the current tab from the list (it's shown in the card above)
  const otherTabIds = tabIds.filter(id => id !== currentTabId);
  const totalOffline = tabIds.length;

  count.textContent = totalOffline;
  count.className = totalOffline > 0 ? 'section-count' : 'section-count zero';

  if (otherTabIds.length === 0) {
    list.innerHTML = '<div class="managed-empty">No other tabs offline</div>';
    return;
  }

  list.innerHTML = ''; // Clear list

  for (const id of otherTabIds) {
    let tab;
    try {
      tab = await chrome.tabs.get(id);
    } catch (e) {
      continue; // Tab might have been closed
    }

    const el = document.createElement('div');
    el.className = 'managed-tab';

    const domain = getDomain(tab.url);

    if (tab.favIconUrl) {
      const img = document.createElement('img');
      img.className = 'tab-favicon';
      img.src = tab.favIconUrl;
      img.alt = '';
      el.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'tab-favicon placeholder';
      placeholder.textContent = '🌐';
      el.appendChild(placeholder);
    }

    const tabInfo = document.createElement('div');
    tabInfo.className = 'tab-info';

    const tabDomain = document.createElement('div');
    tabDomain.className = 'tab-domain';
    tabDomain.textContent = domain;
    tabInfo.appendChild(tabDomain);

    const tabTitle = document.createElement('div');
    tabTitle.className = 'tab-title';
    tabTitle.textContent = tab.title || '';
    tabInfo.appendChild(tabTitle);

    el.appendChild(tabInfo);

    const restoreBtn = document.createElement('button');
    restoreBtn.className = 'restore-btn';
    restoreBtn.title = 'Restore online';
    restoreBtn.textContent = '↩';
    
    restoreBtn.addEventListener('click', async () => {
      restoreBtn.disabled = true;
      chrome.runtime.sendMessage({
        type: 'TOGGLE_OFFLINE',
        tabId: tab.id,
        makeOffline: false
      }, (response) => {
        if (response && response.success) {
          refreshState();
        } else {
          showError('Failed to restore tab');
          restoreBtn.disabled = false;
        }
      });
    });

    el.appendChild(restoreBtn);
    list.appendChild(el);
  }
}

function refreshState() {
  chrome.runtime.sendMessage({ type: 'GET_OFFLINE_TABS' }, (response) => {
    if (response && response.tabs) {
      isOffline = response.tabs.includes(currentTabId);
      updateToggleState();
      renderManagedTabs(response.tabs);
    }
  });
}

// ── Toggle handler ──

document.getElementById('offlineToggle').addEventListener('change', async (e) => {
  const makeOffline = e.target.checked;
  e.target.disabled = true;

  // Gate: ensure optional host permission is granted for cosmetic shim injection
  if (makeOffline) {
    const hasPerm = await chrome.permissions.contains({
      origins: ['https://*/*', 'http://*/*']
    });
    if (!hasPerm) {
      const granted = await chrome.permissions.request({
        origins: ['https://*/*', 'http://*/*']
      });
      if (!granted) {
        e.target.checked = false;
        e.target.disabled = false;
        showError('Permission needed to disconnect tabs');
        return;
      }
    }
  }

  chrome.runtime.sendMessage({
    type: 'TOGGLE_OFFLINE',
    tabId: currentTabId,
    makeOffline: makeOffline
  }, (response) => {
    e.target.disabled = false;

    if (response && response.success) {
      isOffline = makeOffline;
      updateToggleState();
      refreshState();
    } else {
      e.target.checked = !makeOffline;
      showError(response ? response.error : 'Unknown error');
    }
  });
});

// ── Init ──

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTabId = tab.id;

  renderCurrentTab(tab);
  refreshState();
}

init();
