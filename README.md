# PropDesk

A local desktop dashboard for tracking prop trading accounts across multiple firms. Syncs automatically via a Chrome extension.

---

## Setup (New Users)

**Step 1 — Download**

From the [Releases](https://github.com/Tychan22/PropDesk/releases) page, download:
- `PropDesk.exe` — the app
- `extension.zip` — the Chrome extension

**Step 2 — Install the Chrome Extension**

1. Unzip `extension.zip`
2. Open Chrome → go to `chrome://extensions`
3. Enable **Developer Mode** (top right toggle)
4. Click **Load unpacked** → select the unzipped `extension` folder

**Step 3 — Run PropDesk**

Double-click `PropDesk.exe` — that's it.

---

## How It Works

- PropDesk opens and starts a local sync server on port `3001`
- The Chrome extension detects your prop firm accounts and syncs data automatically
- Dashboard, P&L, and bot journal populate instantly on every sync

---

## Updates

PropDesk checks for updates automatically every time you open it. If an update is available, you'll be prompted to install it — click **Restart & Update** and it handles the rest.

---

## Data Storage

All your personal data is stored locally on your machine and never uploaded anywhere:

| File | Contents |
|---|---|
| `accounts.json` | Latest account snapshot |
| `balance_history.json` | Balance history over time |
| `bj_trades.json` | Bot journal trade log |
| `acct_cfg.json` | Strategy/type per account |
| `payouts.json` | Payout history |
| `fc_entries.json` | Monthly costs |
