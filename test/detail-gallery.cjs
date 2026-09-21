const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
app.setPath('userData', path.join(require('node:os').tmpdir(), 'fsg-detail-gallery-test'))
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  const css = fs.readFileSync(path.join(__dirname, '../renderer/inc/detail_image_preview.css'), 'utf8')
  await win.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><style>${css}</style>`))
  await win.webContents.executeJavaScript('window.DATA = {iconMaker: x => x};' + fs.readFileSync(path.join(__dirname, '../renderer/renderJS/detail_image_preview.js'), 'utf8') + '\nvoid 0')
  await win.webContents.executeJavaScript(`(() => {
    const entries = [{icon: 'data:image/png;base64,AA==', name: 'Store item'}, {url: 'https://example.com/screenshot.jpg', name: 'Screenshot'}];
    window.DetailImagePreview.open(entries);
    const d = document.querySelector('dialog');
    if (!d.open || d.querySelector('h2').textContent !== 'Store item') throw Error('Open failed');
    d.querySelector('[data-next]').click();
    if (d.querySelector('h2').textContent !== 'Screenshot' || !d.querySelector('[data-next]').disabled) throw Error('Next failed');
    d.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowLeft'}));
    if (d.querySelector('h2').textContent !== 'Store item') throw Error('Keyboard failed');
    d.querySelector('[data-close]').click();
    if (d.open) throw Error('Close failed');
  })()`)
  // Allow the native close event to finish before reopening.
  await new Promise(resolve => setTimeout(resolve, 50))
  await win.webContents.executeJavaScript(`window.DetailImagePreview.open([{icon: 'data:image/png;base64,AA==', name: 'Reopened'}]); if (!document.querySelector('dialog').open) throw Error('Reopen failed');`)
  console.log('PASS: local gallery open, navigation, keyboard, close and reopen')
  win.destroy(); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
