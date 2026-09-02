const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('oncaDesktop', {
  platform: process.platform,
  isDesktop: true,
  listPrinters: () => ipcRenderer.invoke('printers:list'),
  testPrint: (opts) => ipcRenderer.invoke('printers:test', opts || {}),
  printCupom: (opts) => ipcRenderer.invoke('printers:print-cupom', opts || {}),
  listBluetoothDevices: () => ipcRenderer.invoke('bluetooth:list'),
  scanBluetooth: () => ipcRenderer.invoke('bluetooth:scan'),
  cancelBluetooth: () => ipcRenderer.invoke('bluetooth:cancel'),
  getLinuxPrintDiag: () => ipcRenderer.invoke('linux:print-diag'),
  savePdf: (opts) => ipcRenderer.invoke('files:save-pdf', opts || {}),
});
