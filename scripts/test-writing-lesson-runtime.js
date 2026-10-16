'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const script=fs.readFileSync(require('node:path').join(__dirname,'../assets/js/dse-writing-lesson.js'),'utf8');
async function scenario(printThrows) {
  const listeners={},buttons={},media={},copied=[],details=[{open:false},{open:true}];
  const canonical='https://www.mrcatenglish.com/h-'+'a'.repeat(48)+'.html';
  const toast={textContent:'',classList:{add(){},remove(){}}};
  for(const id of ['copy-lesson','print-lesson']) buttons[id]={hidden:true,addEventListener:(type,fn)=>{listeners[id+':'+type]=fn;}};
  const document={
    getElementById:id=>buttons[id]||null,
    addEventListener:(event,fn)=>{listeners['document:'+event]=fn;},
    querySelector:selector=>selector==='link[rel="canonical"]'?{href:canonical}:selector==='[data-resource-toast]'?toast:null,
    querySelectorAll:selector=>selector==='details'?details:[],
  };
  const context={document,URL,Element:class {},location:{href:'http://127.0.0.1/fixture.html#module-21',hash:''},history:{pushState(){throw Error('Unexpected navigation');}},navigator:{clipboard:{writeText:async text=>copied.push(text)}},window:{
    isSecureContext:true,matchMedia:query=>({matches:false,addEventListener:(name,fn)=>{media[query]=fn;}}),
    addEventListener:(name,fn)=>{listeners[name]=fn;},clearTimeout(){},setTimeout(){return 1;},
    print(){assert(details.every(d=>d.open));if(printThrows) throw Error('Unavailable print');}
  }};
  vm.runInNewContext(script,context);
  assert(!buttons['copy-lesson'].hidden && !buttons['print-lesson'].hidden);
  await listeners['copy-lesson:click']();
  assert.deepEqual(copied,[canonical],'Copy must use this isolated page, not the local URL or a full-course hash');
  listeners['print-lesson:click']();
  if(!printThrows) {listeners.beforeprint();media.print({matches:true});assert(details.every(d=>d.open));listeners.afterprint();media.print({matches:false});}
  assert.deepEqual(details.map(d=>d.open),[false,true],'Print cancellation/completion/error must restore each original disclosure state');
}
(async()=>{await scenario(false);await scenario(true);console.log('Single-lesson runtime passed: canonical copying and print-state restoration, including repeated browser events and print failure.');})().catch(error=>{console.error(error);process.exitCode=1;});
