const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const assert = require('node:assert/strict')
const {AsyncLocalStorage} = require('node:async_hooks')
const source=fs.readFileSync(path.join(__dirname,'../modAssist_main.js'),'utf8')
const ast=require('@babel/parser').parse(source,{sourceType:'script'})
const context=vm.createContext({AsyncLocalStorage})
vm.runInContext('const vaultMutationContext=new AsyncLocalStorage(); let activeVaultMutations=0; let exclusiveVaultImport=false;',context)
for(const name of ['withVaultMutation','directImportGameVersion']) {
  const node=ast.program.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name)
  vm.runInContext(source.slice(node.start,node.end),context)
}
async function main(){
  let release
  const active=context.withVaultMutation(()=>new Promise(resolve=>{release=resolve}))
  await assert.rejects(context.withVaultMutation(async()=>{},true),/Another Vault/)
  release(); await active
  const exclusive=context.withVaultMutation(()=>new Promise(resolve=>{release=resolve}),true)
  await assert.rejects(context.withVaultMutation(async()=>{}),/Another Vault/)
  release(); await exclusive
  await context.withVaultMutation(()=>context.withVaultMutation(async()=>{}),true)
  await assert.rejects(context.withVaultMutation(async()=>{throw Error('failed')},true),/failed/)
  await context.withVaultMutation(async()=>{},true)
  for(const [descriptor,version] of [[4,11],[16,13],[20,15],[39,17],[53,19],[85,22],[90,25],[105,25],[7,null],[0,null]]) assert.equal(context.directImportGameVersion(descriptor),version)
  console.log('PASS: import/move exclusion, nested registration, error unlock, descriptor game mappings')
}
main().catch(error=>{console.error(error);process.exitCode=1})
