const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onAccountsUpdate: (cb) => ipcRenderer.on('accounts-update', (_event, data) => cb(data)),
  readJson: (filename) => ipcRenderer.invoke('read-json', filename),
  writeJson: (filename, data) => ipcRenderer.invoke('write-json', filename, data)
});
