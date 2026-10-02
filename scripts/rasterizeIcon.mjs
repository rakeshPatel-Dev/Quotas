/**
 * Rasterises public/quotas.svg into the PNG sizes the app needs:
 *
 *   build/icons/<n>.png          multi-size set for desktop/toolbar use
 *   build/icon.png               512px, what electron-builder uses as the icon
 *   resources/icons/icon-512.png runtime window icon, packed into the asar
 */
import { app, BrowserWindow } from 'electron'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const svgPath = join(root, 'public', 'quotas.svg')
const SIZES = [16, 24, 32, 48, 64, 128, 256, 512, 1024]

async function main() {
  mkdirSync(join(root, 'build', 'icons'), { recursive: true })
  mkdirSync(join(root, 'resources', 'icons'), { recursive: true })

  const svgBase64 = readFileSync(svgPath).toString('base64')
  const svgDataUrl = `data:image/svg+xml;base64,${svgBase64}`

  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    webPreferences: {
      webSecurity: false,
      offscreen: false,
    },
  })

  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:transparent;">
  <img id="img" src="${svgDataUrl}" />
</body>
</html>`

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)

  const results = await win.webContents.executeJavaScript(`
    new Promise((resolve, reject) => {
      const img = document.getElementById('img');
      const process = async () => {
        try {
          if (img.decode) await img.decode();
          const sizes = ${JSON.stringify(SIZES)};
          const images = {};
          for (const size of sizes) {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, size, size);
            images[size] = canvas.toDataURL('image/png');
          }
          resolve(images);
        } catch (e) {
          reject(e.toString());
        }
      };
      if (img.complete) {
        process();
      } else {
        img.onload = process;
        img.onerror = (e) => reject('Failed to load SVG: ' + e);
      }
    })
  `)

  for (const size of SIZES) {
    const dataUrl = results[size]
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '')
    const buffer = Buffer.from(base64Data, 'base64')
    writeFileSync(join(root, 'build', 'icons', `${size}.png`), buffer)
    console.log(`  ${String(size).padStart(4)}px  ${(buffer.length / 1024).toFixed(1)} KiB`)
  }

  win.destroy()

  // electron-builder reads a single square image for the Linux icon.
  copyFileSync(join(root, 'build', 'icons', '512.png'), join(root, 'build', 'icon.png'))
  // Window icon has to exist at runtime, inside the packaged app.
  copyFileSync(
    join(root, 'build', 'icons', '512.png'),
    join(root, 'resources', 'icons', 'icon-512.png'),
  )

  console.log('wrote build/icons/*, build/icon.png, resources/icons/icon-512.png')
}

app.whenReady()
  .then(main)
  .then(() => app.exit(0))
  .catch((err) => {
    console.error(err)
    app.exit(1)
  })