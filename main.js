const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

autoUpdater.on('update-downloaded', () => {
  const choice = dialog.showMessageBoxSync({
    type: 'info',
    title: 'PropDesk Update Ready',
    message: 'A new version of PropDesk has been downloaded.',
    detail: 'Restart now to apply the update.',
    buttons: ['Restart & Update', 'Later'],
    defaultId: 0
  });
  if (choice === 0) autoUpdater.quitAndInstall();
});

let win;
let serverProcess = null;
const DATA_FILE = path.join(__dirname, 'propdesk-sync', 'server', 'accounts.json');
const SERVER_DIR = path.join(__dirname, 'propdesk-sync', 'server');
const ALLOWED_JSON = ['bj_trades.json', 'acct_cfg.json', 'payouts.json', 'fc_entries.json'];

function pushAccountsToRenderer() {
  if (!win || win.isDestroyed()) return;
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    win.webContents.send('accounts-update', data);
  } catch (e) {
    console.error('[PropDesk] Could not read accounts.json:', e.message);
  }
}

function killPort3001() {
  try {
    execSync('for /f "tokens=5" %a in (\'netstat -ano ^| findstr :3001\') do taskkill /PID %a /F', { shell: 'cmd.exe', stdio: 'ignore' });
  } catch {}
}

function startServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
  killPort3001();
  const serverPath = path.join(__dirname, 'propdesk-sync', 'server', 'propdesk-server.js');
  serverProcess = spawn('node', [serverPath], {
    stdio: 'inherit',
    windowsHide: true,
    shell: true
  });
  serverProcess.on('exit', () => { serverProcess = null; });
  serverProcess.on('error', (err) => { console.error('[PropDesk] Server error:', err.message); serverProcess = null; });
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  startServer();

  // Push accounts to renderer whenever the server writes a new sync
  let watchDebounce = null;
  fs.watch(DATA_FILE, () => {
    clearTimeout(watchDebounce);
    watchDebounce = setTimeout(pushAccountsToRenderer, 300);
  });

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'PropDesk',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('propdesk.html');
  if (app.isPackaged) autoUpdater.checkForUpdates();
});

ipcMain.handle('read-json', (event, filename) => {
  if (!ALLOWED_JSON.includes(filename)) return null;
  const file = path.join(SERVER_DIR, filename);
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
});

ipcMain.handle('write-json', (event, filename, data) => {
  if (!ALLOWED_JSON.includes(filename)) return;
  const file = path.join(SERVER_DIR, filename);
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
});


app.on('window-all-closed', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
  app.quit();
});

app.on('before-quit', () => {
  if (serverProcess) { serverProcess.kill(); serverProcess = null; }
});
