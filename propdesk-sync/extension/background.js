// PropDesk Sync — background.js

chrome.runtime.onInstalled.addListener(function() {
  chrome.alarms.create('propdesk-sync', { periodInMinutes: 5 });
  // Poll every 30s to detect when the one-shot server starts up
  chrome.alarms.create('propdesk-server-check', { periodInMinutes: 0.5 });
});

function triggerContentSync() {
  chrome.tabs.query({ url: 'https://app.traderspost.io/*' }, function(tabs) {
    tabs.forEach(function(tab) {
      chrome.tabs.sendMessage(tab.id, { action: 'sync' });
    });
  });
}

chrome.alarms.onAlarm.addListener(function(alarm) {
  if (alarm.name === 'propdesk-sync') {
    triggerContentSync();
    return;
  }

  // Check if the one-shot server just started up (no recent sync)
  if (alarm.name === 'propdesk-server-check') {
    fetch('http://localhost:3001/status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.ok) return;
        var synced_at = data.synced_at;
        var isStale = !synced_at || (Date.now() - new Date(synced_at).getTime()) > 90000;
        if (isStale) triggerContentSync();
      })
      .catch(function() {}); // server not running — ignore
    return;
  }
});

chrome.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
  // Manual sync trigger from popup
  if (msg.action === 'manual_sync') {
    chrome.tabs.query({ url: 'https://app.traderspost.io/*' }, function(tabs) {
      if (tabs.length === 0) {
        sendResponse({ error: 'No TraderPost tab open' });
        return;
      }
      tabs.forEach(function(tab) {
        chrome.tabs.sendMessage(tab.id, { action: 'sync' });
      });
      sendResponse({ ok: true });
    });
    return true;
  }

  // Popup asking background to fetch server status
  if (msg.action === 'get_status') {
    fetch('http://localhost:3001/status')
      .then(function(r) { return r.json(); })
      .then(function(data) { sendResponse({ ok: true, data: data }); })
      .catch(function(e) { sendResponse({ ok: false, error: e.message }); });
    return true; // async
  }
});
