import { app, BrowserWindow, session, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { addAccount } from './addAccount.js'
import { TokenManager } from './auth/tokenManager.js'
import { QuotaClient } from './quota/cloudcode.js'
import { QuotaService } from './quota/service.js'
import { Scheduler } from './scheduler/scheduler.js'
import { AccountStore } from './store/accountStore.js'
import { createSecretBox } from './store/secretBox.js'
import { registerIpcHandlers } from './ipc.js'
import { IPC_CHANNELS, toPublicAccount } from '../shared/types.js'

// The dev server is opt-in, not inferred from `app.isPackaged`: running from
// source should still load the built renderer, otherwise `npm run app` only
// works when a Vite server happens to be running.
const useDevServer = process.env.ANTIGRAVITY_TRACKER_DEV === '1'
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5273'

/** One set of long-lived services for the whole app lifetime. */
export function createServices() {
  const box = createSecretBox()
  const store = new AccountStore(box)
  const tokens = new TokenManager(store)
  const client = new QuotaClient(tokens, store)
  const service = new QuotaService(store, tokens, client)
  const scheduler = new Scheduler(store, service)
  return { box, store, tokens, client, service, scheduler }
}

export type Services = ReturnType<typeof createServices>

async function createWindow(services: Services): Promise<BrowserWindow> {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 720,
    minHeight: 560,
    // Matches `bg-base` in the renderer so there is no colour flash between
    // the native window and the first painted frame.
    backgroundColor: '#0C0C0E',
    show: false,
    // Icon shown in the OS taskbar / dock. The PNG is written by `npm run icon`
    // from public/quotas.svg and packed into the asar under resources/icons/.
    icon: fileURLToPath(new URL('../../resources/icons/icon-512.png', import.meta.url)),
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      // .cjs: Electron only runs sandboxed preload scripts as CommonJS, so this
      // one is bundled to CJS by esbuild rather than emitted by tsc.
      preload: fileURLToPath(new URL('../preload/index.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })

  // Never let the renderer navigate somewhere or spawn a window; external links
  // go to the system browser instead.
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = useDevServer && url.startsWith(DEV_SERVER_URL)
    if (!allowed) {
      event.preventDefault()
      void shell.openExternal(url)
    }
  })

  window.once('ready-to-show', () => window.show())

  if (useDevServer) {
    await window.loadURL(DEV_SERVER_URL)
  } else {
    await window.loadFile(fileURLToPath(new URL('../../dist/renderer/index.html', import.meta.url)))
  }

  return window
}

/**
 * Strict CSP in production. In dev the Vite client needs an inline preamble and
 * a websocket for HMR, so the policy is relaxed only when actually serving dev.
 */
function applyCsp(): void {
  const policy = useDevServer
    ? [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        "connect-src 'self'",
      ].join('; ')
    : [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self'",
        // The renderer never opens its own sockets; it asks the main process
        // over IPC, which fetches with Node. 'self' covers the file:// bundle.
        "connect-src 'self'",
      ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [policy],
      },
    })
  })

  // The renderer talks to the network only through the main process.
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
}

// Imported late so the module graph stays testable outside Electron.
/**
 * Verification hook: `ANTIGRAVITY_TRACKER_SCREENSHOT=<file> electron .` boots the
 * real app, waits for cards to render, writes a PNG and exits. Never set in a
 * packaged build, so this is inert in production.
 */
async function captureIfRequested(window: BrowserWindow): Promise<void> {
  const target = process.env.ANTIGRAVITY_TRACKER_SCREENSHOT
  if (!target) return

  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const cards = await window.webContents.executeJavaScript(
      "document.querySelectorAll('article').length",
    )
    if (typeof cards === 'number' && cards > 0) break
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  // Let the first live countdown tick so the capture shows real formatted data.
  await new Promise((resolve) => setTimeout(resolve, 1500))

  const image = await window.webContents.capturePage()
  await writeFile(target, image.toPNG())
  console.log(`[screenshot] wrote ${target}`)
  app.exit(0)
}

async function bootstrap(): Promise<void> {
  const services = createServices()
  applyCsp()

  services.store.on('error', (err) => console.error('[store]', err.message))
  services.store.load()

  const window = await createWindow(services)

  registerIpcHandlers({
    store: services.store,
    scheduler: services.scheduler,
    tokens: services.tokens,
    getWindow: () => window,
    openExternal: (url) => shell.openExternal(url),
    addAccount: async () => {
      await addAccount(services, { openUrl: (url) => shell.openExternal(url) })
    },
  })

  // Push each account to the renderer as it settles, so cards update one at a
  // time instead of waiting for the slowest fetch in the batch.
  services.scheduler.on('account:updated', (account) => {
    if (window.isDestroyed()) return
    window.webContents.send(IPC_CHANNELS.accountUpdated, toPublicAccount(account))
  })

  services.scheduler.start()
  void captureIfRequested(window)

  window.on('closed', () => {
    services.scheduler.stop()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    services.scheduler.stop()
    void services.store.flush()
  })
}

// Do NOT call app.disableHardwareAcceleration() here: this machine's software
// fallback (SwiftShader) is unusable, so turning acceleration off makes the GPU
// process die at startup with "GPU process isn't usable. Goodbye." The
// cosmetic "--ozone-platform=wayland is not compatible with Vulkan" warning on
// mixed Wayland/X11 sessions is the lesser evil.

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    for (const existing of BrowserWindow.getAllWindows()) {
      if (existing.isMinimized()) existing.restore()
      existing.focus()
    }
  })

  void app.whenReady().then(bootstrap)
}
