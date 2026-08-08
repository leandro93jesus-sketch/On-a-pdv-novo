const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('oncaDesktop', {
  platform: process.platform,
  isDesktop: true,
});
