const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oncaSplash', {
  retry: () => ipcRenderer.send('splash:retry'),
  openDiagnostics: () => ipcRenderer.send('splash:open-diagnostics'),
});
