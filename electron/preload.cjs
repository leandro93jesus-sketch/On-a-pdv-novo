const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oncaDesktop', {
  platform: process.platform,
  isDesktop: true,
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  testPrint: (opts) => ipcRenderer.invoke('printers:test', opts || {}),
});
