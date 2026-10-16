'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'../assets/js',name+'.js'),'utf8');

// All student print/copy buttons are absent. Reader startup must still finish.
function scenario(name,kind) {
  const listeners={},media={},details=[{open:false},{open:true}];
  const toolbar={hidden:true};
  const panel={id:kind==='course'?'overview':'foundation',hidden:true,querySelector:()=>({textContent:'Lesson'}),classList:{contains:()=>true}};
  const picker={value:'',addEventListener(){}};
  const document={
    title:'Test handout',body:{dataset:{}},
    getElementById:id=>id===panel.id?panel:['module-picker','course-search'].includes(id)?picker:null,
    addEventListener:(event,fn)=>{listeners['document:'+event]=fn;},
    querySelector:selector=>selector==='.course-toolbar'?toolbar:null,
    querySelectorAll:selector=>selector==='details'?details:selector==='details[open]'?details.filter(d=>d.open):['.course-panel','.study-panel'].includes(selector)?[panel]:[],
  };
  const context={document,Element:class {},location:{hash:''},history:{pushState(){throw Error('Unexpected navigation');}},window:{
    matchMedia:query=>({matches:false,addEventListener:(event,fn)=>{media[query]=fn;}}),
    addEventListener:(event,fn)=>{listeners[event]=fn;},
    print(){throw Error('Reader must not invoke printing');}
  }};
  vm.runInNewContext(read(name),context);
  if(kind==='course') assert(!toolbar.hidden && !panel.hidden && picker.value==='overview','Course navigation must initialize without action buttons');
  if(kind==='reading') assert(!panel.hidden,'Reading panel must initialize without a print button');
  listeners.beforeprint();
  if(kind==='lesson') {listeners.beforeprint();media.print({matches:true});}
  assert(details.every(d=>d.open));
  listeners.afterprint();
  if(kind==='lesson') media.print({matches:false});
  assert.deepEqual(details.map(d=>d.open),[false,true],'Native browser print must restore original disclosure state');
}
scenario('dse-writing-lesson','lesson');
scenario('dse-writing-course','course');
for(const type of ['inference','tfng','language-effects']) scenario('dse-reading-'+type,'reading');
console.log('Five handout runtimes passed: startup/navigation without print or copy buttons and native print-state restoration.');
