import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS, type PublicAccount, type QuotaIpc } from '../shared/types.js'

/**
 * The entire surface the renderer gets. No Node primitives, no fs, no raw
 * ipcRenderer, and no refresh-token field ever crosses this boundary.
 */
const api: QuotaIpc = {
  listAccounts: () => ipcRenderer.invoke(IPC_CHANNELS.listAccounts),
  addAccount: () => ipcRenderer.invoke(IPC_CHANNELS.addAccount),
  removeAccount: (id) => ipcRenderer.invoke(IPC_CHANNELS.removeAccount, id),
  refresh: (id) => ipcRenderer.invoke(IPC_CHANNELS.refresh, id),
  setPaused: (id, paused) => ipcRenderer.invoke(IPC_CHANNELS.setPaused, id, paused),
  onAccountUpdated: (cb) => {
    const listener = (_event: Electron.IpcRendererEvent, account: PublicAccount): void => {
      cb(account)
    }
    ipcRenderer.on(IPC_CHANNELS.accountUpdated, listener)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.accountUpdated, listener)
    }
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('quota', api)
} else {
  // Only reachable if isolation was disabled, which it never is.
  ;(globalThis as unknown as { quota: QuotaIpc }).quota = api
}
