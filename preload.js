// 렌더러에 노출하는 최소 API
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('box', {
  pathFor: (file) => { try { return webUtils.getPathForFile(file); } catch { return ''; } },
  statFiles: (paths) => ipcRenderer.invoke('files:stat', paths),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  thumb: (p) => ipcRenderer.invoke('file:thumb', p),

  setIgnore: (v) => ipcRenderer.send('win:ignore', v),
  setHotRect: (r) => ipcRenderer.send('win:hot-rect', r),
  onIgnoreSync: (cb) => ipcRenderer.on('win:ignore-sync', (_e, v) => cb(v)),
  onVisible: (cb) => ipcRenderer.on('win:visible', (_e, v) => cb(v)),
  dragStart: () => ipcRenderer.send('win:drag-start'),
  dragEnd: () => ipcRenderer.send('win:drag-end'),
  menu: () => ipcRenderer.send('win:menu'),

  startJob: (payload) => ipcRenderer.invoke('job:start', payload),
  cancelJob: () => ipcRenderer.invoke('job:cancel'),
  onJobEvent: (cb) => ipcRenderer.on('job:event', (_e, ev) => cb(ev)),

  open: (p) => ipcRenderer.invoke('file:open', p),
  reveal: (p) => ipcRenderer.invoke('file:reveal', p),
  dragOut: (p) => ipcRenderer.send('file:drag-out', p),

  getConfig: () => ipcRenderer.invoke('config:get'),
  onConfig: (cb) => ipcRenderer.on('config', (_e, c) => cb(c)),
  onMenu: (cb) => ipcRenderer.on('menu', (_e, what) => cb(what)),
  // 스크린샷 모드(--shot)에서만 메인에 처리기가 있다
  savePng: (dataUrl, name) => ipcRenderer.invoke('debug:save-png', dataUrl, name),
});
