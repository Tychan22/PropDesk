# PropDesk

A local Electron dashboard for tracking prop trading accounts across multiple firms. Syncs automatically via a Chrome extension.

---

## Requirements

- [Node.js](https://nodejs.org/) (v18 or higher)
- Google Chrome
- Git

---

## Setup

**1. Clone the repo**
```bash
git clone <repo-url>
cd BESTBEST
```

**2. Install dependencies**
```bash
npm install
```

**3. Install the Chrome extension**

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `propdesk-sync/extension` folder

**4. Launch PropDesk**
```bash
npm start
```

---

## How It Works

- PropDesk opens and starts a local sync server on port `3001`
- The Chrome extension detects your prop firm accounts and POSTs data to the server
- The dashboard updates instantly — accounts, P&L, and bot journal all populate automatically

---

## Getting Updates

When an update is pushed:

```bash
git pull
npm install
npm start
```

`npm install` only needs to run if dependencies changed — harmless to run every time.

---

## Data Storage

All your personal data lives locally in `propdesk-sync/server/` and is never pushed to Git:

| File | Contents |
|---|---|
| `accounts.json` | Latest account snapshot |
| `balance_history.json` | Balance snapshots over time |
| `bj_trades.json` | Bot journal trade log |
| `acct_cfg.json` | Strategy/type per account |
| `payouts.json` | Payout history |
| `fc_entries.json` | Monthly costs |
