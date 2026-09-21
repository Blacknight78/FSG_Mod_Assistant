const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
app.setPath('userData', path.join(require('node:os').tmpdir(), 'fsg-image-selection-test'))
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false })
  for (const page of ['vault', 'detail19', 'detail22', 'detail25']) {
    const html = fs.readFileSync(path.join(__dirname, '../renderer', page + '.html'), 'utf8')
    const css = html.match(/<style>([\s\S]*?)<\/style>/)[1]
    await win.loadURL('data:text/html,' + encodeURIComponent(`<!doctype html><style>${css}</style><h2>Selectable title</h2><img id="preview" draggable="false"><button>Next</button>`))
    const result = await win.webContents.executeJavaScript(`(() => {
      const image = document.querySelector('img');
      const title = document.querySelector('h2');
      const range = document.createRange(); range.selectNodeContents(title);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      return { imageSelect: getComputedStyle(image).userSelect, imageDrag: getComputedStyle(image).webkitUserDrag,
        textSelect: getComputedStyle(title).userSelect, selectedText: getSelection().toString() };
    })()`)
    assert.equal(result.imageSelect, 'none')
    assert.equal(result.imageDrag, 'none')
    assert.notEqual(result.textSelect, 'none')
    assert.equal(result.selectedText, 'Selectable title')
  }
  console.log('PASS: image selection/drag disabled; text selection preserved on all four screens')
  win.destroy(); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
