'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke(channel, ...args) {
    return ipcRenderer.invoke(channel, ...args);
  },
  send(channel, ...args) {
    ipcRenderer.send(channel, ...args);
  },
  on(channel, listener) {
    ipcRenderer.on(channel, (_event, ...args) => listener(...args));
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
