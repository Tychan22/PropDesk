const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 3001;
const DATA_DIR = process.env.USER_DATA_PATH || __dirname;
const DATA_FILE = path.join(DATA_DIR, 'accounts.json');
const HISTORY_FILE = path.join(DATA_DIR, 'balance_history.json');

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
      if ([25,50,100,150,200,250,300].includes(k)) return k * 1000;
    }
  }
  if (bal) {
    if (bal < 30000) return 25000;
    if (bal < 60000) return 50000;
    if (bal < 120000) return 100000;
    if (bal < 180000) return 150000;
    if (bal < 260000) return 200000;
  }
  return 50000;
}

// Per-firm, per-size MLL lookup (verified from each firm's help docs).
// Tradeify initial MLL unconfirmed — using 4% fallback until verified.
function detectLossLimit(firm, acctSize) {
  const f = (firm || '').toUpperCase();
  const tables = {
    TOPSTEP:    { 25000: 1000, 50000: 2000, 100000: 3000, 150000: 4500 },
    LUCID:      { 25000: 1000, 50000: 2000, 100000: 3000, 150000: 4500 },
    APEX:       { 25000: 1000, 50000: 2000, 100000: 3000, 150000: 4000 },
    ALPHA:      { 25000: 1000, 50000: 2000, 100000: 3000, 150000: 4500 },
    MFF:        { 25000: 1000, 50000: 2000, 100000: 3000, 150000: 4500 },
    FUNDEDNEXT: { 25000: 1000, 50000: 2000, 100000: 3000, 150000: 4000 },
    TRADEIFY:   { 25000: 1000, 50000: 2000, 100000: 3000, 150000: 4500 },
  };
  const t = tables[f];
  if (t && t[acctSize] !== undefined) return t[acctSize];
  return Math.round(acctSize * 0.04);
}

function getTradingDayKey(now) {
  // Trading day resets at 6 PM ET — hardcoded so it works on any system timezone
  const etStr = now.toLocaleString('en-US', { timeZone: 'America/New_York' });
  const et = new Date(etStr);
  // After 6 PM ET it's already the next trading day
  if (et.getHours() >= 18) et.setDate(et.getDate() + 1);
  return et.getFullYear() + '-' + String(et.getMonth()+1).padStart(2,'0') + '-' + String(et.getDate()).padStart(2,'0');
}

function processSnapshot(data) {
  const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  const now = new Date();
  const todayKey = getTradingDayKey(now);
  const tsISO = now.toISOString();
  const pnlEvents = [];

  const enriched = (data.accounts || []).map(a => {
    const key = a.id || a.name;
    let bal = parseBal(a.balance);
    if (!history[key]) history[key] = { snapshots: [], firstBal: null, peakBal: null, dayStartBal: null, dayStartDate: null, lastReportedDayPnl: null };
    const h = history[key];

    // If the extension scraped a null balance (TraderPost still loading), fall back to the
    // last known good balance so the dashboard never goes blank mid-session.
    let isFallbackBal = false;
    let displayBalance = a.balance;
    if (bal === null && h.snapshots.length > 0) {
      const fallbackSnap = h.snapshots.slice().reverse().find(s => parseBal(s.bal) !== null);
      if (fallbackSnap) {
        bal = parseBal(fallbackSnap.bal);
        isFallbackBal = true;
        displayBalance = '$' + bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        console.log(`[PropDesk] Null balance for ${key} — using last known $${bal}`);
      }
    }

    // Use the historical peak balance (if known) for size detection — Topstep shows profit-only
    // which can be a small number like $1,333, causing detectAccountSize to guess 25K instead of 50K.
    // peakBal always reflects the highest full corrected balance ever seen, so it's reliable.
    const acctSize = detectAccountSize(a.name, h.peakBal || bal);
    const profitTarget = Math.round(acctSize * 0.06);
    const lossLimit = detectLossLimit(a.firm, acctSize);

    // Topstep shows profit-above-starting-balance on TraderPost, not the full balance.
    // e.g. a $52k account shows "$2,000". Correct by adding the account size.
    if ((a.firm || '').toUpperCase() === 'TOPSTEP' && bal !== null && bal < acctSize) {
      bal = acctSize + bal;
      // Also update displayBalance to show the corrected full balance, not the raw profit-only number
      if (!isFallbackBal) displayBalance = '$' + bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    // Fix any stored history values that were written before the Topstep correction was in place.
    // If dayStartBal or peakBal are < acctSize, they're in profit-only form and need the same correction.
    if ((a.firm || '').toUpperCase() === 'TOPSTEP') {
      if (h.dayStartBal !== null && h.dayStartBal < acctSize) h.dayStartBal = acctSize + h.dayStartBal;
      if (h.peakBal !== null && h.peakBal < acctSize) h.peakBal = acctSize + h.peakBal;
    }

    // Payout was logged — reset all baselines to current post-payout balance
    if (h.payoutPending && bal !== null) {
      h.firstBal = bal;
      h.peakBal = bal;
      h.dayStartBal = bal;
      h.dayStartDate = todayKey;
      h.snapshots = []; // clear so no pnlEvent fires from the balance drop
      delete h.payoutPending;
      console.log(`[PropDesk] Payout baseline reset for ${key} → $${bal}`);
    }

    if (h.firstBal === null) h.firstBal = acctSize;
    if (bal !== null && (h.peakBal === null || bal > h.peakBal)) h.peakBal = bal;
    if (h.dayStartDate !== todayKey) {
      h.dayStartDate = todayKey;
      // Use yesterday's last snapshot balance as day start — more reliable than current scrape
      // (extension may run before TraderPost loads the balance, giving $0 or stale value)
      const lastSnapBal = h.snapshots.length ? parseBal(h.snapshots[h.snapshots.length - 1].bal) : null;
      h.dayStartBal = (lastSnapBal !== null && lastSnapBal > 0) ? lastSnapBal : bal;
      // Also clear last snapshot so pnlEvents don't fire on day rollover
      if (h.snapshots.length) h.snapshots = [h.snapshots[h.snapshots.length - 1]];
      h.lastReportedDayPnl = null; // reset so first trade of new day gets logged
    }

    // Auto-correct: if dayStartBal is exactly acctSize but we have prior balance history,
    // the day rollover fired when the page showed $0 — use snapshots[0] which is the
    // preserved yesterday-final balance (day rollover always trims snapshots to keep only last)
    if (h.dayStartBal === acctSize && h.snapshots.length > 1) {
      const refBal = parseBal(h.snapshots[0].bal);
      if (refBal !== null && refBal > acctSize) {
        h.dayStartBal = refBal;
        console.log(`[PropDesk] Auto-corrected dayStartBal for ${key}: $${acctSize} → $${refBal}`);
      }
    }

    const dayPnl = h.dayStartBal !== null && bal !== null ? Math.round((bal - h.dayStartBal) * 100) / 100 : null;

    // Fire pnlEvent whenever dayPnl differs from what was last logged — catches trades even if
    // PropDesk was opened after the trade closed (no snapshot delta to detect).
    if (dayPnl !== null && !isFallbackBal && Math.abs(dayPnl) > 1 && dayPnl !== h.lastReportedDayPnl) {
      pnlEvents.push({
        acctKey: key, acctName: a.name, firm: a.firm || 'BOT',
        date: todayKey,
        time: now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }),
        pnl: dayPnl,
        dayPnl,
      });
      h.lastReportedDayPnl = dayPnl;
    }

    // Only store real (non-null, non-fallback) balances — null or fallback entries skew pnlEvent detection
    if (bal !== null && !isFallbackBal) {
      h.snapshots.push({ ts: tsISO, bal });
      if (h.snapshots.length > 500) h.snapshots = h.snapshots.slice(-500);
    }
    const allTimePnl = h.firstBal !== null && bal !== null ? Math.round((bal - h.firstBal) * 100) / 100 : null;
    const drawdown = h.peakBal !== null && bal !== null ? Math.round((bal - h.peakBal) * 100) / 100 : null;
    const evalProgress = h.firstBal !== null && bal !== null ? Math.min(100, Math.max(0, Math.round(((bal - h.firstBal) / profitTarget) * 100))) : null;
    const ddDanger = h.firstBal !== null && bal !== null ? Math.min(100, Math.max(0, Math.round(((h.firstBal - bal) / lossLimit) * 100))) : null;

    return { ...a, balance: displayBalance, dayPnl, allTimePnl, drawdown, evalProgress, ddDanger, firstBal: h.firstBal, peakBal: h.peakBal, acctSize, profitTarget, lossLimit };
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
    try {
      const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      if (parsed.synced_at && parsed.accounts) {
        const syncDay = getTradingDayKey(new Date(parsed.synced_at));
        const today = getTradingDayKey(new Date());
        if (syncDay !== today) parsed.accounts.forEach(a => { a.dayPnl = 0; });
      }
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify(parsed));
    }
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

  if (req.method === 'POST' && req.url === '/set-day-start') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { accountKey, dayStartBal } = JSON.parse(body);
        const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        if (accountKey && history[accountKey] && dayStartBal !== undefined) {
          history[accountKey].dayStartBal = dayStartBal;
          fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
          console.log(`[PropDesk] Day start corrected for ${accountKey} → $${dayStartBal}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404); res.end(JSON.stringify({ error: 'Account not found in history' }));
        }
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/payout') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { accountKey } = JSON.parse(body);
        const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        if (accountKey && history[accountKey]) {
          history[accountKey].payoutPending = true;
          fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
          console.log(`[PropDesk] Payout flagged for ${accountKey} — baselines reset on next sync`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404); res.end(JSON.stringify({ error: 'Account not found in history' }));
        }
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/set-peak') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { accountKey, peakBal } = JSON.parse(body);
        const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
        if (accountKey && history[accountKey] && peakBal !== undefined) {
          history[accountKey].peakBal = peakBal;
          fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
          console.log(`[PropDesk] Peak balance corrected for ${accountKey} → $${peakBal}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(404); res.end(JSON.stringify({ error: 'Account not found in history' }));
        }
      } catch(e) {
        res.writeHead(400); res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
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
