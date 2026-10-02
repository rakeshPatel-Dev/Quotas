import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import type { TokenManager } from './auth/tokenManager.js'
import type { Scheduler } from './scheduler/scheduler.js'
import type { AccountStore } from './store/accountStore.js'
import { IPC_CHANNELS, toPublicAccount } from '../shared/types.js'

export type IpcDeps = {
  store: AccountStore
  scheduler: Scheduler
  tokens: TokenManager
  getWindow: () => BrowserWindow
  openExternal: (url: string) => Promise<void>
  addAccount: () => Promise<void>
}

/**
 * Wraps a handler so a thrown error reaches the renderer as a real rejection
 * instead of an opaque "Error invoking remote method" string.
 */
function handle<A extends unknown[], R>(
  channel: string,
  fn: (event: IpcMainInvokeEvent, ...args: A) => Promise<R> | R,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    try {
      return await fn(event, ...(args as A))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[ipc] ${channel} failed: ${message}`)
      throw new Error(message)
    }
  })
}

export function registerIpcHandlers(deps: IpcDeps): void {
  const { store, scheduler, tokens, getWindow } = deps

  handle(IPC_CHANNELS.listAccounts, () => store.list().map(toPublicAccount))

  handle(IPC_CHANNELS.addAccount, async () => {
    // Sign-in happens in the system browser, so hand focus back to the window
    // once it completes.
    const window = getWindow()
    await deps.addAccount()
    if (!window.isDestroyed()) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
  })

  handle(IPC_CHANNELS.removeAccount, async (event, id: string) => {
    assertSender(event)
    store.remove(id)
    // A queued refresh would otherwise recreate the entry mid-request.
    scheduler.stop()
    scheduler.start()
  })

  handle(IPC_CHANNELS.refresh, async (event, id: string | 'all') => {
    assertSender(event)
    if (id === 'all') {
      await scheduler.refreshNow('all')
      return
    }
    if (!store.get(id)) throw new Error('Account not found')
    await scheduler.refreshNow(id)
  })

  handle(IPC_CHANNELS.setPaused, async (event, id: string, paused: boolean) => {
    assertSender(event)
    scheduler.setPaused(id, paused)
    if (paused) {
      // Drop the cached access token so a later unpause re-reads the account
      // rather than reusing a token minted before the pause.
      tokens.forget(id)
    } else {
      scheduler.refreshNow(id)
    }
  })
}

/**
 * Defence in depth against a renderer that somehow got navigated elsewhere:
 * only the top-level window we created may invoke account mutations.
 */
function assertSender(event: IpcMainInvokeEvent): void {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (!window || event.sender !== getSafeTopLevelWindow()) {
    throw new Error('Rejected IPC from an untrusted frame')
  }
}

function getSafeTopLevelWindow(): Electron.WebContents | null {
  const [first] = BrowserWindow.getAllWindows()
  return first?.webContents ?? null
}

export function unregisterIpcHandlers(): void {
  for (const channel of Object.values(IPC_CHANNELS)) ipcMain.removeHandler(channel)
}
