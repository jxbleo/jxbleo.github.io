'use strict';
const assert=require('assert/strict'),fs=require('fs'),vm=require('vm'),path=require('path');
const root=process.env.WRITING_COMPLETION_STATIC_ROOT || path.resolve(__dirname,'..');
const client=fs.readFileSync(path.join(root,'assets/js/ai-tutor.js'),'utf8');
const receiptSource=fs.readFileSync(path.join(root,'assets/js/training-checkin.js'),'utf8');
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
function fixture(summary){
 const dialogs=[],timers=new Map();let timerId=0,failOpen=false;
 const doc={activeElement:null,createElement(){
  const title={style:{},scrollWidth:100,clientWidth:100},button={focus(){doc.activeElement=button;}};
  const d={isConnected:false,open:false,innerHTML:'',setAttribute(){},addEventListener(){},contains(el){return el===button;},querySelector(s){return s==='.task-title'?title:s==='.close-button'?button:null;},showModal(){if(failOpen)throw Error('synthetic render failure');this.open=true;},close(){this.open=false;},remove(){this.isConnected=false;}};
  dialogs.push(d);return d;
 },body:{style:{},getAttribute(){return null;},removeAttribute(){this.style={};},setAttribute(){},appendChild(d){d.isConnected=true;}}};
 const win={scrollY:0,scrollTo(){},setTimeout(fn){timers.set(++timerId,fn);return timerId;},clearTimeout(id){timers.delete(id);},MrCatCloud:{callAuthenticatedFunction:summary}};
 const context={window:win,document:doc,Promise,Intl,Date,console};vm.createContext(context);vm.runInContext(receiptSource,context);
 const state={current:{composition_id:'fixture',revision:1,status:'completed',title:'Synthetic Writing',word_count:12},profile:{name:'Synthetic Student',role:'student'}};
 Object.assign(context,{state,compositionId:c=>c.composition_id,compositionStatus:c=>c.status,destroyAiWaitingExperience(){},prepareLanguageReview(){assert.equal(state.readOnly,true);context.reportVisible=true;},scheduleStageViewportReset(){}});
 const a=client.indexOf('    var shownCompletionCheckins'),b=client.indexOf('    function enterLanguage()',a);assert(a>=0&&b>a);
 vm.runInContext(client.slice(a,b),context);
 return {context,win,doc,dialogs,timers,state,open(){context.openCompletedWritingReport();},fail(value){failOpen=value;}};
}
(async()=>{
 let resolveSummary;
 const pending=fixture(()=>new Promise(resolve=>{resolveSummary=resolve;}));
 pending.open();pending.open();await tick();
 assert.equal(pending.dialogs.length,1);assert.equal(pending.dialogs[0].open,true,'receipt must show before summary resolves');assert(pending.context.reportVisible);
 for(const timer of pending.timers.values())timer();
 assert(pending.dialogs[0].innerHTML.includes('成就篇数暂未加载'));
 resolveSummary({success:true,completed_count:13,word_count:220});await tick();
 assert(pending.dialogs[0].innerHTML.includes('achievement-count">13'));assert(pending.dialogs[0].innerHTML.includes('220 词'));
 pending.open();await tick();assert.equal(pending.dialogs.length,1,'deduplicate after actual display');
 const failed=fixture(()=>Promise.reject(Error('offline')));failed.open();await tick();assert(failed.dialogs[0].open);assert(failed.dialogs[0].innerHTML.includes('成就篇数暂未加载'));
 const retry=fixture(()=>Promise.resolve({success:true,completed_count:2}));retry.fail(true);retry.open();await tick();assert.equal(retry.dialogs[0].isConnected,false);assert.equal(retry.context.shownCompletionCheckins['fixture:1'],undefined);retry.fail(false);retry.open();await tick();assert(retry.dialogs[1].open,'failed display must remain retryable');
 const close=fixture(()=>new Promise(()=>{}));const handle=await close.win.MrCatTrainingCheckin.writing(close.state.current,{completed:true,profile:close.state.profile});handle.close();assert.equal(close.dialogs[0].isConnected,false);handle.update({writingCount:99});assert.equal(close.dialogs.length,1,'late data must not reopen a closed receipt');
 assert(client.includes("else if (compositionStatus(state.current) === 'completed') openCompletedWritingReport()"),'already complete first reviews must show receipt');
 assert(client.includes("else if (review && compositionStatus(composition) === 'completed') openCompletedWritingReport()"),'completed report reopen must use receipt handoff');
 console.log('Writing completion: immediate modal, delayed/failed summary, late enrichment, deduplication, retry after render failure, closed-dialog safety and completed-entry routing passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
