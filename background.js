const originMap = new Map(); // origin -> Set of tabIds

async function getOfflineTabs() {
  const result = await chrome.storage.session.get('offlineTabs');
  return result.offlineTabs || [];
}

async function setOfflineTabs(tabs) {
  await chrome.storage.session.set({ offlineTabs: tabs });
}

// Ensure the map is initialized from storage on SW boot
async function init() {
  const tabs = await getOfflineTabs();
  for (const tabId of tabs) {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (tab.url) {
        const origin = new URL(tab.url).origin;
        if (!originMap.has(origin)) originMap.set(origin, new Set());
        originMap.get(origin).add(tabId);
      }
    } catch (e) {
      // Tab might no longer exist
    }
  }
}
init();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'TOGGLE_OFFLINE') {
    handleToggleOffline(request.tabId, request.makeOffline)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true; // async response
  }
  
  if (request.type === 'GET_OFFLINE_TABS') {
    getOfflineTabs().then(tabs => sendResponse({ tabs }));
    return true;
  }
});

async function handleToggleOffline(tabId, makeOffline) {
  const tab = await chrome.tabs.get(tabId);
  const origin = new URL(tab.url).origin;
  const originKey = origin.replace(/[^a-zA-Z0-9]/g, '_');

  let offlineTabs = await getOfflineTabs();

  if (makeOffline) {
    // 1. Add DNR Session Rule
    await chrome.declarativeNetRequest.updateSessionRules({
      addRules: [{
        id: tabId,
        priority: 1,
        action: { type: "block" },
        condition: {
          tabIds: [tabId],
          resourceTypes: [
            "main_frame", "sub_frame", "stylesheet", "script",
            "image", "font", "object", "xmlhttprequest", "ping",
            "csp_report", "media", "websocket", "webtransport",
            "webbundle", "other"
          ]
        }
      }]
    });

    // 2. Register Cosmetic Shim (if not already registered for this origin)
    if (!originMap.has(origin)) originMap.set(origin, new Set());
    const originTabs = originMap.get(origin);
    
    if (originTabs.size === 0) {
      await chrome.scripting.registerContentScripts([{
        id: `flowstop-shim-${originKey}`,
        matches: [`*://${new URL(origin).hostname}/*`],
        js: ["page-offline-shim.js"],
        runAt: "document_start",
        world: "MAIN",
        persistAcrossSessions: false
      }]);
    }
    originTabs.add(tabId);

    // 3. Save State & Badge
    if (!offlineTabs.includes(tabId)) {
      offlineTabs.push(tabId);
      await setOfflineTabs(offlineTabs);
    }
    await chrome.action.setBadgeText({ text: "OFF", tabId });
    await chrome.action.setBadgeBackgroundColor({ color: "#ef4444", tabId });

    // 4. FORCED RELOAD (Kill switch)
    await chrome.tabs.reload(tabId);

  } else {
    // 1. Remove DNR Session Rule
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [tabId]
    });

    // 2. Unregister Shim (if no other tabs offline for same origin)
    if (originMap.has(origin)) {
      const originTabs = originMap.get(origin);
      originTabs.delete(tabId);
      
      if (originTabs.size === 0) {
        try {
          await chrome.scripting.unregisterContentScripts({
            ids: [`flowstop-shim-${originKey}`]
          });
        } catch(e) {
          console.warn("Could not unregister script", e);
        }
        originMap.delete(origin);
      }
    }

    // 3. Clear State & Badge
    offlineTabs = offlineTabs.filter(id => id !== tabId);
    await setOfflineTabs(offlineTabs);
    await chrome.action.setBadgeText({ text: "", tabId });

    // (Optional) Try injecting restore courtesy script before reload, ignoring errors
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: () => {
          if (!window.__flowstop) return;
          const o = window.__flowstop.originals;
          window.fetch = o.fetch;
          XMLHttpRequest.prototype.open = o.xhrOpen;
          XMLHttpRequest.prototype.send = o.xhrSend;
          window.EventSource = o.EventSource;
          window.WebSocket = o.WebSocket;
          navigator.sendBeacon = o.sendBeacon;
          window.RTCPeerConnection = o.RTCPeerConnection;
          Object.defineProperty(navigator, 'onLine', { get: () => true, configurable: true });
          window.dispatchEvent(new Event('online'));
          delete window.__flowstop;
        }
      });
    } catch (e) {
      // Harmless, e.g. tab is on a chrome-error:// page
    }

    // 4. Reload to Restore
    await chrome.tabs.reload(tabId);
  }
}

// Clean up when tabs are closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  let offlineTabs = await getOfflineTabs();
  if (offlineTabs.includes(tabId)) {
    // Clean up DNR
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [tabId] });
    
    // Clean up map
    for (const [origin, tabs] of originMap.entries()) {
      if (tabs.has(tabId)) {
        tabs.delete(tabId);
        if (tabs.size === 0) {
          const originKey = origin.replace(/[^a-zA-Z0-9]/g, '_');
          try {
            await chrome.scripting.unregisterContentScripts({ ids: [`flowstop-shim-${originKey}`] });
          } catch(e) {}
          originMap.delete(origin);
        }
      }
    }
    
    // Clean up storage
    offlineTabs = offlineTabs.filter(id => id !== tabId);
    await setOfflineTabs(offlineTabs);
  }
});
