const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const {taskSucceeded} = require('../lib/taskCompletion')
for(const result of [undefined,{ok:true},{rows:[{status:'Imported'}]}]) assert.equal(taskSucceeded(result),true)
for(const result of [null,false,{cancelled:true},{ok:false},{failed:1},{errors:['bad']},{rows:[{status:'Error'}]},{results:[{ok:false}]}]) assert.equal(taskSucceeded(result),false)
for(const file of ['main_ui_lib','importjson_ui']) {
 const text=fs.readFileSync(`renderer/renderJS/${file}.js`,'utf8')
 const start=text.indexOf('class LoaderLib {')
 const end=text.indexOf('\nclass ',start+1)
 let sounds=0
 const overlay={clsHide(){},clsShow(){},hide(){},show(){}}
 const ctx={window:{taskCompletion:{play(){sounds++}}},MA:{byId:()=>overlay},bootstrap:{Modal:class {constructor(){return overlay}}}}
 vm.createContext(ctx)
 vm.runInContext(text.slice(start,end<0?undefined:end)+'\nglobalThis.loader=new LoaderLib()',ctx)
 ctx.loader.completionReady=true
 ctx.loader.hide();ctx.loader.hide()
 assert.equal(sounds,1)
 ctx.loader.completionReady=true;ctx.loader.completionCancelled=true;ctx.loader.hide()
 assert.equal(sounds,1)
}
console.log('PASS: success/error/cancellation gating; loader completion sounds once and stays quiet on cancellation')
