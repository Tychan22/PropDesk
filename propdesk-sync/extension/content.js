// PropDesk Sync — content.js
function scrapeAccounts() {
  var cards = document.querySelectorAll('a[href*="/app/trading/broker/"]');
  var accounts = [];
  cards.forEach(function(card) {
    var href = card.getAttribute('href') || '';
    var lines = card.innerText.split('\n').map(function(l){ return l.trim(); }).filter(function(l){ return l; });
    var name = lines[0] || 'Unknown';
    var balance = lines[1] || null;
    var balanceRaw = balance ? parseFloat(balance.replace(/[$,]/g, '')) : 0;
    var firm = 'UNKNOWN';
    var n = name.toLowerCase();
    if(n.includes('lucid')) firm = 'LUCID';
    else if(n.includes('topstep')) firm = 'TOPSTEP';
    else if(n.includes('tradeify')) firm = 'TRADEIFY';
    else if(n.includes('apex')) firm = 'APEX';
    else if(n.includes('mff')||n.includes('funded futures')) firm = 'MFF';
    else if(n.includes('alpha')) firm = 'ALPHA';
    accounts.push({ id: href.split('/')[4], name: name, firm: firm, balance: balance, balanceRaw: balanceRaw, type: 'Paper', acctNum: lines[2]||'1/1', href: href });
  });
  return accounts;
}

function sendToServer(accounts) {
  if(!accounts.length) return;
  var payload = { accounts: accounts, synced_at: new Date().toISOString(), count: accounts.length };
  // Save to chrome.storage so popup can read it
  chrome.storage.local.set({ propdesk_sync: payload });
  // Also post to local server
  fetch('http://localhost:3001/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }).catch(function(){});
}

function runSync() {
  var accounts = scrapeAccounts();
  console.log('[PropDesk Sync] Found ' + accounts.length + ' accounts');
  accounts.forEach(function(a){ console.log('[PropDesk Sync] ' + a.name + ' | ' + a.balance); });
  sendToServer(accounts);
}

setTimeout(runSync, 2000);
setInterval(runSync, 300000);
chrome.runtime.onMessage.addListener(function(msg) { if(msg.action === 'sync') runSync(); });
