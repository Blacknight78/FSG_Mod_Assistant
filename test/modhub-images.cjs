const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.join(__dirname, '../modAssist_main.js'), 'utf8')
const start = source.indexOf('function configureModHubImageRequests(')
const end = source.indexOf('\napp.whenReady()', start)
const configure = vm.runInNewContext(source.slice(start, end) + '\nconfigureModHubImageRequests', { URL })
let handler
configure({ webRequest: { onBeforeSendHeaders(filter, listener) {
  assert.equal(filter.urls[0], 'https://*.giants-software.com/modHub/storage/*')
  handler = listener
} } })
const imageURL = 'https://cdn40.giants-software.com/modHub/storage/00358701/screenshot0.jpg'
for (const [url, resourceType, changed] of [
  [imageURL, 'image', true],
  [imageURL, 'xhr', false],
  ['https://other.giants-software.com/modHub/storage/a.jpg', 'image', false],
]) {
  const original = { referer: 'file:///local', Accept: 'image/*' }
  handler({ url, resourceType, requestHeaders: original }, result => {
    assert.equal(result.requestHeaders.Referer, changed ? 'https://www.farming-simulator.com/' : undefined)
    assert.equal(result.requestHeaders.referer, changed ? undefined : original.referer)
    assert.equal(result.requestHeaders.Accept, original.Accept)
  })
  assert.equal(original.referer, 'file:///local')
}
console.log('PASS: official screenshot headers; unrelated requests and original headers unchanged')

if (process.versions.electron) {
  const { app, BrowserWindow, session } = require('electron')
  app.setPath('userData', path.join(require('node:os').tmpdir(), 'fsg-modhub-image-test'))
  app.whenReady().then(async () => {
    configure(session.defaultSession)
    const win = new BrowserWindow({ show: false })
    await win.loadURL('data:text/html,<!doctype html><html><body></body></html>')
    const dimensions = await win.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const image = new Image();
      const timeout = setTimeout(() => reject(Error('Screenshot timed out')), 20000);
      image.onload = () => { clearTimeout(timeout); resolve([image.naturalWidth, image.naturalHeight]); };
      image.onerror = () => { clearTimeout(timeout); reject(Error('Screenshot failed to load')); };
      document.body.append(image);
      image.src = ${JSON.stringify(imageURL)};
    })`)
    assert.ok(dimensions[0] > 0 && dimensions[1] > 0)
    console.log('PASS: actual affected screenshot decoded in Electron', dimensions)
    win.destroy()
    app.quit()
  }).catch(error => { console.error(error); app.exit(1) })
}
