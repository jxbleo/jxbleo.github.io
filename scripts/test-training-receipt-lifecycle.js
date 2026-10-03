'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const root=process.env.CHECKIN_STATIC_ROOT || path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'assets/js/training-checkin.js'),'utf8');
const flush=async()=>{for(let i=0;i<15;i++)await Promise.resolve();};
function fixture(request){
 const dialogs=[],timers=new Map(),listeners=new Map();let serial=0,identity={auth_uid:'student-a'},calls=0;
 const doc={activeElement:null,body:{style:{},getAttribute(){return null;},removeAttribute(){this.style={};},appendChild(d){d.isConnected=true;}},createElement(){
  const title={style:{},scrollWidth:10,clientWidth:10},button={focus(){doc.activeElement=button;}};
  const d={innerHTML:'',isConnected:false,open:false,setAttribute(){},addEventListener(){},querySelector(s){return s==='.task-title'?title:s==='.close-button'?button:null;},contains(e){return e===button;},showModal(){this.open=true;},close(){this.open=false;},remove(){this.isConnected=false;}};dialogs.push(d);return d;
 }};
 const win={scrollY:0,scrollTo(){},setTimeout(f){timers.set(++serial,f);return serial;},clearTimeout(id){timers.delete(id);},addEventListener(n,f){listeners.set(n,f);},removeEventListener(n){listeners.delete(n);},MrCatAuth:{getCachedProfile:()=>identity},MrCatCloud:{callAuthenticatedFunction(){calls++;return request();}}};
 vm.runInNewContext(source,{window:win,document:doc,Promise,Intl,Date});
 return {win,doc,dialogs,timers,listeners,api:win.MrCatTrainingCheckin,calls:()=>calls,switchAccount(){identity={auth_uid:'student-b'};if(listeners.has('storage'))listeners.get('storage')();}};
}
(async()=>{
 for(const kind of ['score','listening','speaking','writing']){
  let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;}));
  let handle;
  if(kind==='score')handle=await f.api.score({percentage:90,passed:true},{family:'BBC',title:'Synthetic'});
  if(kind==='listening')handle=await f.api.listening({title:'Synthetic',units:[]},{percentage:100},{},{setId:'IL-BBC-260924'});
  if(kind==='speaking')handle=await f.api.speaking({question_snapshot:{text:'Synthetic'}},30);
  if(kind==='writing')handle=await f.api.writing({title:'Synthetic'},{completed:false});
  assert(handle && f.dialogs[0].open,kind+' must open before profile lookup completes');await flush();assert.equal(f.calls(),1);
  for(const fn of f.timers.values())fn();assert(f.dialogs[0].innerHTML.includes('姓名暂未加载'));
  resolve({success:true,student:{auth_uid:'student-a',name:'Fresh name',role:'student'}});await flush();assert(f.dialogs[0].innerHTML.includes('Fresh name'));
  handle.close();assert.equal(f.doc.body.style.position,undefined);assert.equal(f.listeners.size,0);
 }
 const failed=fixture(()=>Promise.reject(Error('offline')));await failed.api.show({title:'Saved result'});await flush();assert(failed.dialogs[0].open);assert(failed.dialogs[0].innerHTML.includes('姓名暂未加载'));
 const known=fixture(()=>{throw Error('unnecessary profile request');});known.win.MrCatPractice={profile:{auth_uid:'student-a',name:'Current student',role:'student'}};await known.api.show({title:'Saved result'});await flush();assert.equal(known.calls(),0);assert(known.dialogs[0].innerHTML.includes('Current student'));
 const teacher=fixture(()=>Promise.resolve(null));await teacher.api.show({profile:{role:'teacher',name:'Teacher'}});assert.equal(teacher.dialogs.length,0);
 let resolveOld;const switched=fixture(()=>new Promise(r=>{resolveOld=r;}));await switched.api.show({title:'A'});await flush();switched.switchAccount();resolveOld({success:true,student:{name:'Old private name'}});await flush();assert.equal(switched.dialogs[0].isConnected,false);assert(!switched.dialogs[0].innerHTML.includes('Old private name'));
 const stale=fixture(()=>new Promise(()=>{}));stale.win.MrCatPractice={profile:{auth_uid:'wrong-account',name:'Wrong name',role:'student'}};await stale.api.show({});assert(!stale.dialogs[0].innerHTML.includes('Wrong name'));
 let done;const closed=fixture(()=>new Promise(r=>{done=r;}));let closes=0;const h=await closed.api.show({onClose(){closes++;}});await flush();h.close();h.close();done({success:true,student:{name:'Late name'}});await flush();assert.equal(closes,1);assert.equal(closed.dialogs[0].isConnected,false);assert(!closed.dialogs[0].innerHTML.includes('Late name'));
 const html=fs.readFileSync(path.join(root,'intensive-listening.html'),'utf8'),js=fs.readFileSync(path.join(root,'assets/js/intensive-listening.js'),'utf8'),css=fs.readFileSync(path.join(root,'assets/css/intensive-listening.css'),'utf8');
 assert(!/completion-screen|completion-percent|completion-summary|Listening finished\./.test(html+js));assert(!css.includes('.il-completion-'));
 for(const id of ['completed-actions','completion-finish','restart-button','show-receipt-button','replay-status'])assert(html.includes('id="'+id+'"'),id);
 assert(js.slice(js.indexOf('function showTrainingCheckin'),js.indexOf('function finishSession')).includes("$('#replay-button').disabled = false"),'completed review must unlock playback');
 assert(js.includes("$('#show-receipt-button').addEventListener('click', showTrainingCheckin)"));
 console.log('Receipt lifecycle: four receipt families open before identity lookup; timeout/error/late identity, page profile, teacher suppression, account switch, stale identity, single close callback and legacy Listening removal passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
