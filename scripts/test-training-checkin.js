'use strict';
const assert=require('assert/strict');
const fs=require('fs'),vm=require('vm'),path=require('path');
const ui=require('../assets/js/training-checkin');
const {getCheckinSummary}=require('../cloudfunctions/writingTutor/checkin-summary');
const score={correct_count:46,question_count:50,percentage:92,passed:true,mastered:false};
assert.equal(ui.scoreModel(score,{family:'词汇'}).status,'词汇已过关');
assert.equal(ui.scoreModel({...score,passed:false},{family:'词汇'}).tone,'muted');
assert.equal(ui.scoreModel({...score,correct_count:50,percentage:100},{family:'词汇'}).status,'词汇已满分');
assert.equal(ui.scoreModel({...score,correct_count:999,question_count:1000,percentage:100},{family:'词汇'}).status,'词汇已过关');
const mastered={...score,mastered:true,mastery_enabled:true,mastery_eligible:true,assignment_id:'teacher-task'};
assert.equal(ui.scoreModel(mastered,{family:'词汇'}).decoration,'star');
assert.equal(ui.scoreModel({...mastered,assignment_id:null},{family:'词汇'}).decoration,'popper');
assert.equal(ui.scoreModel({...mastered,mastery_enabled:false},{family:'词汇'}).decoration,'popper');
assert.equal(ui.scoreModel(mastered,{family:'词汇',practice:true}).decoration,'popper');
const practice=ui.scoreModel(score,{family:'词汇',practice:true,groupCount:10,selectedGroups:[1,2,3,4,5,6,7,8,9,10]});
assert.deepEqual(practice.metrics.map(x=>x[0]),['练习类型','答对题目']);
assert.equal((ui.renderHtml(practice,{chinese_name:'测试',english_name:'Example'},'test').match(/class="group-cell"/g)||[]).length,10);
assert.deepEqual(ui.sourceInfo('BBC-260924','BBC'),['节目期数','26-09-24']);
assert.deepEqual(ui.sourceInfo('IL-BBC-260924','BBC'),['节目期数','26-09-24']);
assert.deepEqual(ui.sourceInfo('IL-C7-T1-S1','雅思'),['题目编号','C7-T1-S1']);
const material={units:[{unit_id:'a',practice_mode:'dictation',slots:[{}, {spelling_requirement:'provided'}, {}, {}]}, {unit_id:'skip',practice_mode:'skip',slots:[{}]}, {unit_id:'listen',practice_mode:'listen_only',slots:[{}]}, {unit_id:'legacy',practice_mode:'dictation',slots:[{}]}]};
const progress={percentage:100,unit_progress:{a:{correct_positions:[false,true,true,false]},legacy:{correct_positions:[true],correct_positions_reliable:false}}};
assert.deepEqual(ui.wordProgress(material,progress,{a:{entries:['typed','given','',''],answers:['a','b','c','d']}}),{filled:2,required:4});
assert.equal(ui.listeningModel(material,progress,{},{}).status,'精听已过关');
for(const [count,kind,roman] of [[1,'bronze','I'],[10,'bronze','X'],[11,'blue','I'],[20,'blue','X'],[21,'gold','I'],[31,'purple','I'],[41,'black','I'],[50,'black','X'],[51,'black','X']]){const b=ui.writingBadge(count);assert.equal(b.kind,kind);assert.equal(b.roman,roman);assert(!b.svg('test').includes('undefined'));}
assert(ui.beijingTime('2026-09-28T00:00:00Z').endsWith('08:00'));
const escaped=ui.renderHtml({title:'<img src=x onerror=alert(1)>',value:'80%',metrics:[]},{name:'<svg onload=alert(2)>'},'safe');
assert(!escaped.includes('<img src=x'));assert(!escaped.includes('<svg onload'));
const stars=ui.renderHtml(ui.scoreModel(mastered,{family:'词汇'}),{},'star-test');
assert(stars.includes('class="star-sheen"'));assert(stars.includes('id="star-test-star-gold"'));assert(stars.includes('url(#star-test-star-gold)'));
const baseline=process.env.CHECKIN_STATIC_ROOT || path.resolve(__dirname,'..');
// Vocabulary's login badge is fixed to the viewport. Receipts must never reuse
// that class: a preview without the host page's CSS would hide this regression.
const receiptCss=fs.readFileSync(path.join(baseline,'assets/css/training-checkin.css'),'utf8');
assert(receiptCss.includes('.mrcat-checkin .checkin-status{'));
assert(!receiptCss.includes('.identity-status'));
assert(stars.includes('class="checkin-status"'));
assert(!stars.includes('class="identity-status"'));
for(const page of ['vocabulary','bbc','ielts-listening','ai-tutor','speaking-lab','intensive-listening']){
 const file=fs.readFileSync(path.join(baseline,page+'.html'),'utf8');assert.match(file,/assets\/js\/training-checkin\.js\?v=[^\"\s]+/);assert.match(file,/assets\/css\/training-checkin\.css\?v=[^\"\s]+/);
 for(const inlineStyle of file.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) assert(!/\.checkin-status\b/.test(inlineStyle[1]),page+' must not restyle the receipt status');
 for(const script of file.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(script[1]);
}
// Exercise the actual scored-page adapters: selected groups and BBC continuation.
function functionBody(source, name, indent) {
 const start=source.indexOf(' '.repeat(indent)+'function '+name+'(');
 const end=source.indexOf('\n'+' '.repeat(indent)+'}',start)+'\n'.length+indent+1;
 assert(start>=0 && end>start);return source.slice(start,end);
}
const vocabPage=fs.readFileSync(path.join(baseline,'vocabulary.html'),'utf8');
let passedOptions, callbackRuns=0;
const fakeWindow={MrCatTrainingCheckin:{score(result,options){passedOptions=options;}}};
const vocabAdapter=new Function('window','activeTestGroups','unitData','activeTestMode','activeTestAssignmentId','setId','playResultSound', functionBody(vocabPage,'showResultOverlay',8)+';return showResultOverlay;');
vocabAdapter(fakeWindow,[{id:'g3'},{id:'g1'}],{title:'NGSL-A',quizGroups:[{id:'g1'},{id:'g2'},{id:'g3'}]},'practice','','NGSL-A',()=>{})(score);
assert.deepEqual(passedOptions.selectedGroups,[1,3]);assert.equal(passedOptions.practice,true);
const bbcPage=fs.readFileSync(path.join(baseline,'bbc.html'),'utf8');
const bbcAdapter=new Function('window','lessonData','setId','assignmentId', functionBody(bbcPage,'showResultOverlay',4)+';return showResultOverlay;');
bbcAdapter(fakeWindow,{title:'Example'},'BBC-260924','assignment')(score,()=>callbackRuns++);
assert.equal(callbackRuns,0);passedOptions.onClose();assert.equal(callbackRuns,1);
// An exact server aggregate includes records beyond the 200-row portfolio.
function database(comp,totals){const queries=[];return {queries,command:{lt:v=>({lt:v}),lte:v=>({lte:v})},collection(name){assert.equal(name,'writing_compositions');return{where(query){queries.push(query);return{limit(){return{get:async()=>({data:comp?[comp]:[]})}},count:async()=>({total:totals.shift()})}}}}};}
(async()=>{
 const student={auth_uid:'owner'},comp={composition_id:'own',status:'completed',completed_at:'2026-09-28',word_count:302};
 const db=database(comp,[207,1]);const result=await getCheckinSummary(db,student,{composition_id:'own',student_uid:'spoof'});assert.equal(result.completed_count,208);assert.equal(result.word_count,302);assert(db.queries.every(q=>q.student_uid==='owner'));
 await assert.rejects(getCheckinSummary(database(null,[]),student,{composition_id:'other'}),/COMPOSITION_NOT_FOUND/);
 await assert.rejects(getCheckinSummary(database({...comp,status:'language_ready'},[]),student,{composition_id:'own'}),/COMPOSITION_NOT_COMPLETED/);
 await assert.rejects(getCheckinSummary(database(comp,[10,0]),student,{composition_id:'own'}),/CHECKIN_COUNT_UNAVAILABLE/);
 console.log('Training check-in: scoring, STAR eligibility, required-word counting, tiers, escaping, page wiring and owner-scoped server aggregates passed.');
})().catch(e=>{console.error(e);process.exitCode=1});
