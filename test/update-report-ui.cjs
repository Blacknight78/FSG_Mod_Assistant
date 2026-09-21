const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
app.setPath('userData', path.join(os.tmpdir(), 'fsg-report-ui-test'))
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1400, height: 900 })
  const css = fs.readFileSync(path.join(__dirname, '../renderer/inc/bootstrap.min.css'), 'utf8')
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(`<!DOCTYPE html><html data-bs-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body class="p-3"><div id="status">Update complete</div></body></html>`))
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(__dirname, '../renderer/renderJS/update_report.js'), 'utf8') + '\nvoid 0')
  for (const width of [1400, 480]) {
    win.setSize(width, 900)
    const result = await win.webContents.executeJavaScript(`(() => {
      const rows = Array.from({length: 251}, (_, i) => ({name: 'Mod ' + i, source: 'GitHub / Gameplay', status: i === 250 ? 'Failed' : 'Updated', detail: i === 250 ? '<script>unsafe text</script>' : 'Version 1.2.3'}));
      window.UpdateRunReport.show('status', 'Collection update report', rows);
      const root = document.getElementById('updateRunReport');
      if (!root.open || root.querySelectorAll('tbody tr').length !== 100) throw Error('Pagination failed');
      root.querySelectorAll('button')[1].click();
      if (root.querySelector('tbody td').textContent !== 'Mod 100') throw Error('Next page failed');
      const input = root.querySelector('input'); input.value = 'Failed'; input.dispatchEvent(new Event('input'));
      if (root.querySelectorAll('tbody tr').length !== 1 || root.querySelector('script')) throw Error('Search or escaping failed');
      return document.documentElement.scrollWidth <= window.innerWidth;
    })()`)
    const image = await win.webContents.capturePage()
    fs.writeFileSync(path.join(os.tmpdir(), `fsg-update-report-${width}.png`), image.toPNG())
    if (!result) throw new Error('Page overflow at ' + width)
  }
  console.log('PASS: report rendering, pagination, search, escaping and desktop/mobile widths')
  win.destroy(); app.quit()
}).catch(error => { console.error(error); app.exit(1) })
