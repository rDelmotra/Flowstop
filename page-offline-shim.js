(function() {
  'use strict';
  if (window.__flowstop) return; // idempotency guard

  // Save originals for restoration (in case the page is restored without reload)
  const originals = {
    fetch: window.fetch,
    xhrOpen: XMLHttpRequest.prototype.open,
    xhrSend: XMLHttpRequest.prototype.send,
    EventSource: window.EventSource,
    WebSocket: window.WebSocket,
    sendBeacon: navigator.sendBeacon,
    RTCPeerConnection: window.RTCPeerConnection,
  };

  window.__flowstop = { originals };

  // 1. navigator.onLine spoofing
  Object.defineProperty(navigator, 'onLine', {
    get: () => false,
    configurable: true  // CRITICAL: without this, restore throws TypeError
  });

  // 2. Offline event dispatch
  window.dispatchEvent(new Event('offline'));

  // 3. fetch() — reject immediately
  window.fetch = function() {
    return Promise.reject(new TypeError('Failed to fetch'));
  };

  // 4. XMLHttpRequest — fire error on send
  XMLHttpRequest.prototype.open = function(...args) {
    this.__flowstopArgs = args;
    return originals.xhrOpen.apply(this, args);
  };
  XMLHttpRequest.prototype.send = function() {
    const xhr = this;
    setTimeout(() => {
      Object.defineProperty(xhr, 'status', { value: 0, writable: false });
      Object.defineProperty(xhr, 'readyState', { value: 4, writable: false });
      xhr.dispatchEvent(new ProgressEvent('error'));
      xhr.dispatchEvent(new ProgressEvent('loadend'));
      if (typeof xhr.onerror === 'function') xhr.onerror(new ProgressEvent('error'));
    }, 0);
  };

  // 5. EventSource — throw on construct
  window.EventSource = function() {
    throw new DOMException("Failed to construct 'EventSource': network error", 'NetworkError');
  };

  // 6. WebSocket — throw on construct
  window.WebSocket = function() {
    throw new DOMException("Failed to construct 'WebSocket': network error", 'NetworkError');
  };

  // 7. sendBeacon — return false
  navigator.sendBeacon = function() { return false; };

  // 8. RTCPeerConnection — throw on construct (best-effort for WebRTC)
  window.RTCPeerConnection = function() {
    throw new DOMException("Failed to construct 'RTCPeerConnection': network error", 'NetworkError');
  };
  if (window.webkitRTCPeerConnection) {
    window.webkitRTCPeerConnection = window.RTCPeerConnection;
  }

})();
