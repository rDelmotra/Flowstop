// ── State management ──

async function getOfflineTabs() {
  const data = await chrome.storage.session.get('offlineTabs');
  return data.offlineTabs || [];
}

async function setOfflineTabs(tabs) {
  await chrome.storage.session.set({ offlineTabs: tabs });
}

// ── Core: true offline via Chrome DevTools Protocol ──

async function toggleOffline(tabId, makeOffline) {
  let offlineTabs = await getOfflineTabs();

  if (makeOffline) {
    // Step 1: Attach debugger to this tab
    try {
      await chrome.debugger.attach({ tabId }, '1.3');
    } catch (err) {
      // Already attached (maybe DevTools is open, or double-click)
      if (!err.message.includes('Already attached')) {
        throw new Error(`Cannot attach debugger: ${err.message}`);
      }
    }

    // Step 2: Enable the Network domain
    await chrome.debugger.sendCommand({ tabId }, 'Network.enable');

    // Step 3: Set true offline — exactly what DevTools "Offline" checkbox does
    await chrome.debugger.sendCommand({ tabId }, 'Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    });

    // Step 4: Save state + badge
    if (!offlineTabs.includes(tabId)) offlineTabs.push(tabId);
    await setOfflineTabs(offlineTabs);
    await chrome.action.setBadgeText({ text: 'OFF', tabId });
    await chrome.action.setBadgeBackgroundColor({ color: '#FF0000', tabId });

  } else {
    // Restore online
    try {
      await chrome.debugger.sendCommand({ tabId }, 'Network.emulateNetworkConditions', {
        offline: false,
        latency: 0,
        downloadThroughput: -1,
        uploadThroughput: -1
      });
    } catch (e) {
      // Debugger may already be detached
    }

    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {
      // Already detached
    }

    // Save state + clear badge
    offlineTabs = offlineTabs.filter(id => id !== tabId);
    await setOfflineTabs(offlineTabs);
    await chrome.action.setBadgeText({ text: '', tabId });
  }
}

// ── Handle external detach ──
// Fires when user clicks X on the yellow debugging bar, or DevTools takes over
chrome.debugger.onDetach.addListener(async (source, reason) => {
  if (!source.tabId) return;
  const offlineTabs = await getOfflineTabs();
  if (offlineTabs.includes(source.tabId)) {
    await setOfflineTabs(offlineTabs.filter(id => id !== source.tabId));
    try {
      await chrome.action.setBadgeText({ text: '', tabId: source.tabId });
    } catch (e) {
      // Tab may be gone
    }
  }
});

// ── Clean up when tabs close ──
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const offlineTabs = await getOfflineTabs();
  if (offlineTabs.includes(tabId)) {
    try { await chrome.debugger.detach({ tabId }); } catch (e) {}
    await setOfflineTabs(offlineTabs.filter(id => id !== tabId));
  }
});

// ── Messages from popup ──
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TOGGLE_OFFLINE') {
    toggleOffline(message.tabId, message.makeOffline)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  } else if (message.type === 'GET_STATUS') {
    getOfflineTabs().then(tabs => {
      sendResponse({ isOffline: tabs.includes(message.tabId) });
    });
    return true;
  } else if (message.type === 'GET_OFFLINE_TABS') {
    getOfflineTabs().then(tabs => {
      sendResponse({ tabs });
    });
    return true;
  }
});
