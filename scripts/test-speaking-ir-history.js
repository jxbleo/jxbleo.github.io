#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');
const frontend = fs.readFileSync(path.join(root, 'assets/js/speaking-lab.js'), 'utf8');
const backend = fs.readFileSync(path.join(root, 'cloudfunctions/speakingLab/index.js'), 'utf8');
const helpers = frontend.slice(frontend.indexOf('    function individualResponseDateLabel('), frontend.indexOf('    function renderIndividualResponseDevelopment('));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function context(extra = {}) {
  const c = { Intl, Date, Promise, esc, responseReportHistory: null, window: { addEventListener() {} }, ...extra };
  vm.createContext(c); vm.runInContext(helpers, c); return c;
}
function deferred() { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; }
async function run() {
  const c = context();
  const current = new Date('2026-09-14T00:00:00Z');
  const recorded = {response_date:'2026-09-14',created_at:'2026-09-14T08:42:00Z'};
  assert.equal(c.individualResponseDateLabel(recorded,current),'14 Sep 16:42');
  assert.equal(c.individualResponseDateLabel({response_date:'2025-09-14',created_at:'2025-09-14T08:42:00Z'},current),'14 Sep 2025 16:42');
  assert.equal(c.individualResponseDateLabel(recorded,new Date('2027-01-01T00:00:00Z')),'14 Sep 2026 16:42');
  assert.equal(c.individualResponseDateLabel({created_at:'2025-12-31T16:05:00Z'},new Date('2025-12-31T16:00:00Z')),'1 Jan 00:05');
  assert.equal(c.individualResponseDateLabel({response_date:'2025-09-14',created_at:recorded.created_at},current),'14 Sep 2025');
  assert.equal(c.individualResponseDateLabel({created_at:'bad'},current),'Date unavailable');
  assert.equal(c.individualResponseDateLabel({},current),'Date unavailable');

  const old = {response_session_id:'old',report:{summary_zh:'old'},analysis_status:'ready'};
  const fresh = {response_session_id:'new',report:{summary_zh:'new'},analysis_status:'ready'};
  const picker = {value:'old',disabled:false,focus(){},style:{}};
  const notice = {hidden:true,innerHTML:''};
  let next = deferred(); let rendered = null; let url = '';
  const race = context({selectedResponse:old,selectedResponseId:'old',pollGeneration:1,responseReportSwitch:0,
    responseReportHistory:{items:[old,fresh]},
    document:{getElementById:id=>id==='response-history-date'?picker:id==='response-history-notice'?notice:null},
    window:{addEventListener(){},history:{replaceState(a,b,value){url=value;}}},
    call:()=>next.promise,friendlyError:e=>e.message,
    renderIndividualResponseWorkspace:r=>{rendered=r;}
  });
  let pending=race.switchIndividualResponseReport('new');
  assert.equal(picker.disabled,true); assert.equal(picker.value,'old'); assert.equal(rendered,null,'keep old report and old date together during loading');
  next.resolve({response:fresh}); await pending;
  assert.equal(rendered.response_session_id,'new'); assert.match(url,/response=new/);
  race.selectedResponseId='old'; race.selectedResponse=old; rendered=null;
  next=deferred(); pending=race.switchIndividualResponseReport('new'); race.pollGeneration++;
  next.resolve({response:fresh}); await pending; assert.equal(rendered,null,'navigation prevents a late report from replacing another screen');
  next=deferred(); pending=race.switchIndividualResponseReport('new'); next.reject(new Error('Offline')); await pending;
  assert.equal(picker.disabled,false); assert.equal(picker.value,'old'); assert.match(notice.innerHTML,/Offline/);

  // Native selector width follows the selected label, not the longest historic option.
  let measureText=''; const measure={set textContent(t){measureText=t;},getBoundingClientRect(){return {width:measureText.length*6};}};
  const sizing=context({document:{getElementById:id=>id==='response-history-date'?picker:measure}});
  picker.options=[{text:'14 Sep 16:42'},{text:'14 Sep 2025 16:42'}];picker.selectedIndex=0;sizing.sizeResponseHistoryPicker();const short=picker.style.width;
  picker.selectedIndex=1;sizing.sizeResponseHistoryPicker();assert(parseInt(picker.style.width)>parseInt(short));
  picker.selectedIndex=0;sizing.sizeResponseHistoryPicker();assert.equal(picker.style.width,short);

  // The initial dropdown loads all pages, selects newest once, and ignores stale reads.
  const first=deferred(),second=deferred();let pageCalls=0,autoSelected='';
  const loadingPicker={addEventListener(){},disabled:false,innerHTML:''};
  const loader=context({pollGeneration:1,selectedResponseId:'old',document:{getElementById:()=>loadingPicker},
    call:()=> (++pageCalls===1?first:second).promise});
  loader.sizeResponseHistoryPicker=()=>{};loader.responseHistoryNotice=()=>{};
  loader.switchIndividualResponseReport=id=>{autoSelected=id;return Promise.resolve();};
  loader.bindIndividualResponseHistory(old);
  assert(loadingPicker.disabled);first.resolve({responses:[fresh],next_cursor:{id:'new'}});
  await new Promise(setImmediate);assert.equal(pageCalls,2);assert.equal(autoSelected,'');
  second.resolve({responses:[old],next_cursor:null});await new Promise(setImmediate);
  assert.equal(autoSelected,'new');assert.equal(loadingPicker.disabled,false);
  assert.equal(loader.responseReportHistory.items.length,2);
  const stale=deferred();const staleLoader=context({pollGeneration:1,selectedResponseId:'old',document:{getElementById:()=>loadingPicker},call:()=>stale.promise});
  staleLoader.sizeResponseHistoryPicker=()=>{};staleLoader.responseHistoryNotice=()=>{};staleLoader.switchIndividualResponseReport=()=>{throw new Error('stale navigation');};
  staleLoader.bindIndividualResponseHistory(old);staleLoader.pollGeneration++;
  stale.resolve({responses:[fresh],next_cursor:null});await new Promise(setImmediate);
  assert.equal(staleLoader.responseReportHistory.items[0].response_session_id,'old');

  // Backend pagination over >500 attempts; timestamp ties and untrusted scope inputs.
  const rows=[];for(let i=0;i<605;i++)rows.push({_id:String(i).padStart(5,'0'),response_session_id:'r'+i,student_uid:'alice',set_id:'set',question_snapshot:{question_id:'q'},deleted_at:null,analysis_status:'ready',response_date:'2026-09-14',created_at:new Date(1789372800000+Math.floor(i/3)*1000),report:{private:'not in summary'}});
  rows.push({...rows[0],_id:'other',response_session_id:'other',student_uid:'bob'});
  rows.push({...rows[0],_id:'q2',response_session_id:'q2',question_snapshot:{question_id:'q2'}});
  rows.push({...rows[0],_id:'deleted',response_session_id:'deleted',deleted_at:new Date()});
  rows.push({...rows[0],_id:'pending',response_session_id:'pending',analysis_status:'processing'});
  function value(row,key){return key.split('.').reduce((x,k)=>x&&x[k],row);}
  function matches(row,where){if(where.and)return where.and.every(w=>matches(row,w));if(where.or)return where.or.some(w=>matches(row,w));return Object.entries(where).every(([k,v])=>{const actual=value(row,k);if(v&&v.op)return v.op==='lt'?actual<v.value:Number(actual)===Number(v.value);return actual===v;});}
  const db={command:{and:and=>({and}),or:or=>({or}),lt:value=>({op:'lt',value}),eq:value=>({op:'eq',value})},collection(){let where,sort=[],limit=0,fields;return {where(w){where=w;return this;},orderBy(k,d){sort.push([k,d]);return this;},field(f){fields=f;return this;},limit(n){limit=n;return this;},async get(){let data=rows.filter(r=>matches(r,where)).sort((a,b)=>{for(const [key,dir] of sort){if(a[key]<b[key])return dir==='desc'?1:-1;if(a[key]>b[key])return dir==='desc'?-1:1;}return 0;}).slice(0,limit);return {data:data.map(r=>Object.fromEntries(Object.keys(fields).map(k=>[k,r[k]])))};}};}};
  const b={db,Date,Number,MAX_TITLE:120,INDIVIDUAL_RESPONSES:'responses',lab:{text:s=>String(s||''),isTeacher:a=>a.role==='teacher'},getOne:async (collection,where)=>rows.find(r=>r.response_session_id===where.response_session_id)};
  vm.createContext(b);
  vm.runInContext(backend.slice(backend.indexOf('function responseView('),backend.indexOf('function individualResponseHasCommittedWork('))+backend.slice(backend.indexOf('async function listIndividualResponseHistory('),backend.indexOf('async function getIndividualResponse(')),b);
  await assert.rejects(()=>b.listIndividualResponseHistory({auth_uid:'bob'}, {response_session_id:'r0'}),/ACCESS_DENIED/);
  await assert.rejects(()=>b.listIndividualResponseHistory({auth_uid:'alice'}, {response_session_id:'deleted'}),/NOT_FOUND/);
  let cursor=null,all=[];do{const page=await b.listIndividualResponseHistory({auth_uid:'alice'}, {response_session_id:'r0',student_uid:'bob',question_id:'q2',page_size:50,cursor});all.push(...page.responses);cursor=page.next_cursor;}while(cursor);
  assert.equal(all.length,605);assert.equal(new Set(all.map(r=>r.response_session_id)).size,605);assert.equal(all[0].response_session_id,'r604');assert.equal(all.at(-1).response_session_id,'r0');assert.deepEqual(Object.keys(all[0]).sort(),['created_at','response_date','response_session_id']);
  const teacher=await b.listIndividualResponseHistory({auth_uid:'teacher',role:'teacher'},{response_session_id:'r0'});assert(teacher.responses.every(r=>r.response_session_id!=='other'));
  await assert.rejects(()=>b.listIndividualResponseHistory({auth_uid:'alice'},{response_session_id:'r0',cursor:{id:'x',created_at:'bad'}}),/CURSOR_INVALID/);
  console.log('IR history passed: year/time labels, adaptive width, report-switch races/errors, scoped 605-record pagination and access checks.');
}
run().catch(e=>{console.error(e);process.exitCode=1;});
