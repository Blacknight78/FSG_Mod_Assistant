// Live smoke test uses temporary storage only, never the user's Vault/settings.
const fs = require('node:fs')
const fsPromise = require('node:fs/promises')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { parseModLastPass } = require('fs_mod_parser_neon')
const { VaultImportService, parseImportURL } = require('../lib/vaultImportService')
const source = fs.readFileSync(path.join(__dirname, '../modAssist_main.js'), 'utf8')
const ast = require('@babel/parser').parse(source, {sourceType:'script'})
const declarations = new Map(ast.program.body.filter(n=>n.type==='FunctionDeclaration').map(n=>[n.id.name,source.slice(n.start,n.end)]))
const context = vm.createContext({
  fs, fsPromise, path, crypto, require, URL, AbortSignal, fetch, parseModLastPass,
  directImportRecordSnapshot: null,
  fetchWithTimeout: async (url,options,consume)=>{
    const response=await fetch(url,{...options,signal:AbortSignal.timeout(30000)});
    return consume?consume(response):response;
  },
})
for(const name of ['inspectDirectVaultImport','resolveDirectVaultImport','downloadDirectVaultImport','validateModZipContents','hashDirectImportFile','registerDirectVaultImport','decodeHTMLEntities','uniqueCleanArray','safeModArray','safePreviewImage','safeRemoteImageURL','mergeModHubScreenshots','extractModHubScreenshots','addStoreItemPreview','storeItemPreviewsFromIncludeDetail','finiteNumber','numbersFromValue','mergeNumericRange','cleanStoreItemTypeLabel','storeItemsFromIncludeDetail','equipmentSpecsFromIncludeDetail','detectVaultModTypes','modHubTextLines','extractModHubDetail','extractModHubDownloadURL']) {
  if(!declarations.has(name)) throw Error('Missing function '+name)
  vm.runInContext(declarations.get(name),context)
}
for (const name of ['directImportGameVersion','itemTypeLabel','itemHorsepowerValues','itemPriceValues','uniqueCleanNumberArray']) vm.runInContext(declarations.get(name),context)
context.getModHubLatestUpdate = async id => {
  const response=await fetch(`https://www.farming-simulator.com/mod.php?mod_id=${id}&lang=en&country=ie`,{signal:AbortSignal.timeout(30000)})
  assert.equal(response.status,200)
  const html=await response.text()
  const assetName=context.extractModHubDetail(context.modHubTextLines(html),'filename')
  const downloadURL=context.extractModHubDownloadURL(html)
  return {ok:true,hasDownload:!!downloadURL,assetName,downloadURL,version:context.extractModHubDetail(context.modHubTextLines(html),'version'),screenshots:context.mergeModHubScreenshots([context.extractModHubScreenshots(html)]),released:context.extractModHubDetail(context.modHubTextLines(html),'released')}
}
async function main(){
  const root=await fsPromise.mkdtemp(path.join(os.tmpdir(),'fsg-import-live-'))
  try {
    const records=new Map()
    context.modLibraryFilePath=hash=>path.join(root,'vault',hash+'.zip')
    context.registerModLibraryFile=async (file,meta)=>{
      const hash=await context.hashDirectImportFile(file)
      records.set(hash,meta)
      return {hash,libraryPath:context.modLibraryFilePath(hash),size:(await fsPromise.stat(file)).size}
    }
    const github=await context.resolveDirectVaultImport(parseImportURL('https://github.com/id577/fs25_advanceddamagesystem'))
    assert.ok(github.assets.length>0)
    console.log('GitHub published ZIPs:',github.assets.map(a=>a.name).join(', '))
    const service=new VaultImportService({root:()=>root,temp:()=>root,inspect:context.inspectDirectVaultImport,hash:context.hashDirectImportFile,exists:async hash=>records.has(hash),register:context.registerDirectVaultImport,resolve:context.resolveDirectVaultImport,download:context.downloadDirectVaultImport})
    const review=await service.resolve(1,'https://www.farming-simulator.com/mod.php?mod_id=358701',()=>{})
    assert.equal(review.rows[0].status,'Ready',JSON.stringify(review))
    const result=await service.run(1,[{id:review.rows[0].id,asset:0}],()=>{})
    assert.equal(result.rows[0].status,'Imported',JSON.stringify(result))
    const [hash,meta]=[...records][0]
    assert.equal(meta.gameVersion,25)
    assert.ok(meta.storeItemPreviews.length>0)
    assert.ok(meta.modHubScreenshots.length>0)
    assert.equal(await context.hashDirectImportFile(context.modLibraryFilePath(hash)),hash)
    assert.equal((await fsPromise.readdir(root)).filter(n=>n.startsWith('fsg-vault-import-')).length,0)
    console.log('PASS: actual ModHub download, native ZIP validation, game/preview metadata, verified Vault copy and staging cleanup:',meta.fileName,meta.version)
  } finally {await fsPromise.rm(root,{recursive:true,force:true})}
}
main().catch(error=>{console.error(error);process.exitCode=1})
