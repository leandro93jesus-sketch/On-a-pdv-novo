const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oncaDesktop', {
  platform: process.platform,
  isDesktop: true,
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  testPrint: (opts) => ipcRenderer.invoke('printers:test', opts || {}),
  listBluetoothDevices: () => ipcRenderer.invoke('bluetooth:list'),
  scanBluetooth: () => ipcRenderer.invoke('bluetooth:scan'),
  cancelBluetooth: () => ipcRenderer.invoke('bluetooth:cancel'),
});
