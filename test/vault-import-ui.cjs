const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
app.setPath('userData', path.join(os.tmpdir(), 'fsg-vault-import-ui-test'))
app.whenReady().then(async () => {
  const win = new BrowserWindow({show:false, width:1200, height:900})
  const root = path.join(__dirname, '../renderer')
  const page = fs.readFileSync(path.join(root, 'vault.html'), 'utf8')
  const dialog = page.match(/<dialog id="vaultImportDialog"[\s\S]*?<\/dialog>/)[0]
  const css = fs.readFileSync(path.join(root,'inc/bootstrap.min.css'),'utf8') + fs.readFileSync(path.join(root,'inc/vault_import.css'),'utf8')
  await win.loadURL('data:text/html,'+encodeURIComponent(`<!doctype html><html data-bs-theme="dark"><head><style>${css}</style></head><body><button id="vaultImportOpen">Import mods</button>${dialog}</body></html>`))
  await win.webContents.executeJavaScript(`
    window.DATA = {escapeSpecial: value => { const el=document.createElement('span'); el.textContent=value; return el.innerHTML.replaceAll('"','&quot;'); }};
    window.calls = [];
    window.rows = Array.from({length:205}, (_,i)=>({id:String(i), name:i===0?'<script>unsafe</script>':'Mod '+i, source:'https://github.com/example/FS25_Mod', version:'1.2.3', status:i===0?'Choose ZIP':'Ready', assets:i===0?[{name:'FS25_A.zip'},{name:'FS25_B.zip'}]:[{name:'FS25_Mod.zip'}]}));
    window.vault_IPC = {
      importLinks: async text => ({rows:structuredClone(window.rows)}),
      importFolder: async options => {window.calls.push(options); return {rows:[{id:'folder',name:'FS25_Local.zip',source:'Downloads',version:'1.0',game:25,status:'Ready',assets:[]}]};},
      importRun: async items => {window.calls.push(items); return {rows:items.map(item=>({id:item.id,name:'Imported mod',source:'Downloads',status:'Imported',assets:[]}))};},
      importCancel: async()=>{}, receive:()=>{}
    }; void 0;
  `)
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(root,'renderJS/vault_import_ui.js'),'utf8')+'\nwindow.dispatchEvent(new Event("DOMContentLoaded")); void 0')
  for (const width of [1200,480]) {
    win.setSize(width,900)
    await win.webContents.executeJavaScript(`document.getElementById('vaultImportOpen').click(); document.querySelector('[data-import-mode="links"]').click(); document.getElementById('vaultImportResolve').click();`)
    await new Promise(resolve=>setTimeout(resolve,100))
    await win.webContents.executeJavaScript(`(() => {
      const d=document.getElementById('vaultImportDialog');
      if(!d.open || d.querySelectorAll('tbody tr').length!==100) throw Error('Pagination/open');
      if(d.querySelector('script')) throw Error('HTML escaping');
      document.getElementById('vaultImportNone').click();
      const asset=d.querySelector('tbody select'); asset.value='1'; asset.dispatchEvent(new Event('change'));
      if(document.getElementById('vaultImportRun').disabled) throw Error('Asset selection');
      document.getElementById('vaultImportNext').click();
      if(!d.querySelector('tbody').textContent.includes('Mod 100')) throw Error('Next page');
      if(d.scrollWidth>d.clientWidth+1) throw Error('Horizontal overflow');
    })()`)
    fs.writeFileSync(path.join(os.tmpdir(),`fsg-import-${width}.png`),(await win.webContents.capturePage()).toPNG())
    await win.webContents.executeJavaScript(`document.getElementById('vaultImportRun').click()`)
    await new Promise(resolve=>setTimeout(resolve,100))
    await win.webContents.executeJavaScript(`if(!document.getElementById('vaultImportStatus').textContent.includes('Imported: 1')) throw Error('Report'); document.querySelector('[data-import-mode="folder"]').click(); document.getElementById('vaultImportRecursive').checked=true; document.getElementById('vaultImportBrowse').click();`)
    await new Promise(resolve=>setTimeout(resolve,100))
    await win.webContents.executeJavaScript(`if(!document.getElementById('vaultImportRows').textContent.includes('FS25_Local')) throw Error('Folder review'); document.getElementById('vaultImportClose').click();`)
  }
  console.log('PASS: import review, pagination, asset selection, escaping, folder tab, report and 1200/480px layouts')
  win.destroy(); app.quit()
}).catch(error=>{console.error(error);app.exit(1)})
