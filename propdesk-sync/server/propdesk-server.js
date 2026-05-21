const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const DATA_FILE = path.join(__dirname, 'accounts.json');
const HISTORY_FILE = path.join(__dirname, 'balance_history.json');

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({ accounts: [], synced_at: null, count: 0 }, null, 2));
if (!fs.existsSync(HISTORY_FILE)) fs.writeFileSync(HISTORY_FILE, JSON.stringify({}, null, 2));

function parseBal(raw) {
  if (typeof raw === 'number') return raw;
  if (!raw) return null;
  const n = parseFloat(String(raw).replace(/[$,]/g, ''));
  return isNaN(n) ? null : n;
}

function detectAccountSize(name, bal) {
  if (name) {
    const m = String(name).match(/(\d+)\s*k/i);
    if (m) {
      const k = parseInt(m[1]);
      if ([50,100,150,200,250,300].includes(k)) return k * 1000;
    }
  }
  if (bal) {
    if (bal < 60000) return 50000;
    if (bal < 120000) return 100000;
    if (bal < 180000) return 150000;
    if (bal < 260000) return 200000;
  }
  return 50000;
}

function processSnapshot(data) {
  const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  const now = new Date();
  const todayKey = now.getFullYear() + '-' + String(now.getMonth()+1).padStart(2,'0') + '-' + String(now.getDate()).padStart(2,'0');
  const tsISO = now.toISOString();
  const pnlEvents = [];

  const enriched = (data.accounts || []).map(a => {
    const key = a.id || a.name;
    const bal = parseBal(a.balance);
    if (!history[key]) history[key] = { snapshots: [], firstBal: null, peakBal: null, dayStartBal: null, dayStartDate: null };
    const h = history[key];

    const acctSize = detectAccountSize(a.name, bal);
    const profitTarget = Math.round(acctSize * 0.06);
    const lossLimit = Math.round(acctSize * 0.04);

    if (h.firstBal === null) h.firstBal = acctSize;
    if (bal !== null && (h.peakBal === null || bal > h.peakBal)) h.peakBal = bal;
    if (h.dayStartDate !== todayKey) {
      h.dayStartDate = todayKey;
      h.dayStartBal = bal; // reset to today's first balance reading
      // Also clear last snapshot so pnlEvents don't fire on day rollover
      if (h.snapshots.length) h.snapshots = [h.snapshots[h.snapshots.length - 1]];
    }

    const lastSnap = h.snapshots.length ? h.snapshots[h.snapshots.length - 1] : null;
    if (lastSnap && bal !== null) {
      const lastBal = parseBal(lastSnap.bal);
      const change = bal - lastBal;
      if (Math.abs(change) > 1 && Math.abs(change) < acctSize * 0.5) { // ignore changes >50% of account size (bad data)
        pnlEvents.push({
          acctKey: key, acctName: a.name, firm: a.firm || 'BOT',
          date: todayKey,
          time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
          pnl: Math.round(change * 100) / 100,
          prevBal: lastBal, newBal: bal
        });
      }
    }

    h.snapshots.push({ ts: tsISO, bal });
    if (h.snapshots.length > 500) h.snapshots = h.snapshots.slice(-500);

    const dayPnl = h.dayStartBal !== null && bal !== null ? Math.round((bal - h.dayStartBal) * 100) / 100 : null;
    const allTimePnl = h.firstBal !== null && bal !== null ? Math.round((bal - h.firstBal) * 100) / 100 : null;
    const drawdown = h.peakBal !== null && bal !== null ? Math.round((bal - h.peakBal) * 100) / 100 : null;
    const evalProgress = h.firstBal !== null && bal !== null ? Math.min(100, Math.max(0, Math.round(((bal - h.firstBal) / profitTarget) * 100))) : null;
    const ddDanger = h.firstBal !== null && bal !== null ? Math.min(100, Math.max(0, Math.round(((h.firstBal - bal) / lossLimit) * 100))) : null;

    return { ...a, dayPnl, allTimePnl, drawdown, evalProgress, ddDanger, firstBal: h.firstBal, peakBal: h.peakBal, acctSize, profitTarget, lossLimit };
  });

  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
  return { enriched, pnlEvents };
}

const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.method === 'POST' && req.url === '/sync') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const { enriched, pnlEvents } = processSnapshot(data);
        const out = { ...data, accounts: enriched, synced_at: new Date().toISOString(), pnlEvents };
        fs.writeFileSync(DATA_FILE, JSON.stringify(out, null, 2));
        console.log(`\n[PropDesk Server] ✓ Synced ${data.count} accounts at ${new Date().toLocaleTimeString()}`);
        enriched.forEach(a => {
          const d = a.dayPnl !== null ? (a.dayPnl >= 0 ? '+$' : '-$') + Math.abs(a.dayPnl).toFixed(2) : '?';
          console.log(`  ${(a.firm||'?').padEnd(10)} | ${(a.name||'?').padEnd(18)} | ${(a.balance||'?').padEnd(12)} | Today: ${d}`);
        });
        if (pnlEvents.length) console.log(`  [${pnlEvents.length} P&L event(s) detected]`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, received: data.count, pnlEvents }));
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/accounts') {
    try { const d = fs.readFileSync(DATA_FILE, 'utf8'); res.writeHead(200, {'Content-Type':'application/json'}); res.end(d); }
    catch(e) { res.writeHead(500); res.end(JSON.stringify({ error: 'Read error' })); }
    return;
  }

  if (req.method === 'GET' && req.url === '/status') {
    try {
      const d = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({ ok: true, count: d.count ?? d.accounts?.length ?? 0, synced_at: d.synced_at }));
    } catch(e) { res.writeHead(200); res.end(JSON.stringify({ ok: true, count: 0, synced_at: null })); }
    return;
  }

  res.writeHead(404); res.end('Not found');
});

server.listen(PORT, () => {
  console.log(`\n╔════════════════════════════════════╗`);
  console.log(`║   PropDesk Sync Server running     ║`);
  console.log(`║   http://localhost:${PORT}           ║`);
  console.log(`╚════════════════════════════════════╝`);
  console.log(`\n→ Waiting for extension sync...\n`);
});

process.on('SIGINT', () => { console.log('\n[PropDesk] Shutting down...'); process.exit(0); });
