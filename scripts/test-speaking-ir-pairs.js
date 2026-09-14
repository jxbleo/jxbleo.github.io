'use strict';
const assert = require('assert'), fs = require('fs'), vm = require('vm');
const lab = require('../cloudfunctions/_shared/speaking-lab');
const schemas = require('../cloudfunctions/speakingLab/schemas');
const prompts = require('../cloudfunctions/speakingLab/prompts');
const segments = [{segment_id:'s1',text:'I support school gardens because caring for plants teaches responsibility.',start_ms:0,end_ms:12000}];
const sample = 'I would support a school garden because responsibility becomes more meaningful when students can see the consequences of their choices. For example, a class could take turns caring for a small vegetable patch. If nobody waters it, the plants suffer, so students learn that being responsible involves consistent action rather than simply making promises. The project should start small, however, because a large garden could become an extra burden during examinations. A shared weekly rota would make the workload manageable. In this way, a modest garden could offer a practical lesson that students remember long after a classroom discussion about responsibility has ended.';
function fixture() {
 return { summary_zh:'觀點清晰。', basis_status:'grounded', student_viewpoint_zh:'學生支持校園花園。',
  domains:Object.fromEntries(['ideas_organisation','vocabulary_language_patterns'].map(k=>[k,{score:4,commentary_zh:'支持立場清楚。',evidence_segment_ids:['s1'],strengths:[],weaknesses:[]} ])),
  sample_responses:['你提到照顧植物能培養責任感；假設全班輪流澆水，忘記一次會發生甚麼？這個結果如何幫你說明責任感？','你支持校園花園；假設遇到考試週，照顧植物會帶來甚麼困難？你的建議可以如何兼顧學業？','你認為花園能培養責任感；這種經驗可以怎樣影響課堂以外的生活？甚麼情境能幫助聽者理解這個連結？'].map((thinking,i)=>({student_idea_zh:'學生支持花園；情境是假設。',evidence_segment_ids:['s1'],thinking_prompt_zh:thinking,response_en:['For me, ','On balance, ','In principle, '][i]+sample})) };
}
const input=fixture(), result=lab.canonicalizeIndividualResponseReport(input,segments);
assert.equal(result.report_version,'dse-individual-response-v4');
assert.equal(result.report_version,schemas.INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION);
assert.equal(result.sample_responses.length,3);
assert.equal(result.socratic_questions,undefined);
assert.deepStrictEqual(Object.keys(result.sample_responses[0]).sort(),['evidence_segment_ids','response_en','student_idea_zh','thinking_prompt_zh']);
assert.deepStrictEqual(result.domains,input.domains);
assert.deepStrictEqual(lab.canonicalizeIndividualResponseReport(result,segments),result);
for(const change of [
 r=>{delete r.sample_responses[0].thinking_prompt_zh;},
 r=>{r.sample_responses.pop();},
 r=>{r.sample_responses[0].thinking_prompt_zh='直接替你給出答案。';},
 r=>{r.sample_responses[1].thinking_prompt_zh=r.sample_responses[0].thinking_prompt_zh;},
 r=>{r.sample_responses[0].evidence_segment_ids=['foreign'];},
 r=>{r.sample_responses[0].evidence_segment_ids=[];},
 r=>{r.sample_responses[0].response_en='Too short.';},
 r=>{r.sample_responses[1].response_en=r.sample_responses[0].response_en;},
 r=>{r.sample_responses[0].thinking_prompt_zh='你怎麼想？'.repeat(500);},
]) {const r=fixture();change(r);assert.throws(()=>lab.canonicalizeIndividualResponseReport(r,segments),/COACHING_INVALID/);}
const nested=fixture();for(const k of ['basis_status','student_viewpoint_zh','sample_responses']) {nested.domains[k]=nested[k];delete nested[k];}
assert.deepStrictEqual(lab.canonicalizeIndividualResponseReport(nested,segments),result);
nested.basis_status='grounded';assert.throws(()=>lab.canonicalizeIndividualResponseReport(nested,segments),/COACHING_INVALID/);
const uncertain=fixture();uncertain.basis_status='insufficient';uncertain.student_viewpoint_zh='錄音未能確定立場。';uncertain.sample_responses.forEach(x=>{x.evidence_segment_ids=[];x.thinking_prompt_zh='錄音未能確定你的立場，以下是假設情境。'+x.thinking_prompt_zh;});
assert.equal(lab.canonicalizeIndividualResponseReport(uncertain,segments).basis_status,'insufficient');
const named=fixture();named.sample_responses[0].thinking_prompt_zh='Alex，你會如何展開這個原因？';assert.doesNotMatch(JSON.stringify(lab.canonicalizeIndividualResponseReport(named,segments,{redactNames:['Alex']})),/Alex/);
const sys=prompts.individualResponseAnalysisPrompt(),user=prompts.individualResponseUserPrompt({questionText:'Should schools have gardens?',segments,schemaVersion:result.report_version});
assert.match(sys,/PAIRED EXEMPLARS/);assert.match(sys,/do not supply the answer/);assert.match(sys,/OWN thinking paragraph/);assert.match(sys,/visible thinking_prompt_zh/);
assert.doesNotMatch(sys,/exactly four|four Socratic/);
const skeleton=JSON.parse(user.split('\n').find(x=>x.startsWith('{"summary_zh"')));
assert.equal(skeleton.socratic_questions,undefined);assert.equal(skeleton.sample_responses.length,3);assert(skeleton.sample_responses.every(x=>x.thinking_prompt_zh&&!x.explanation_zh));
const source=fs.readFileSync(require.resolve('../assets/js/speaking-lab.js'),'utf8');
const context={esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),formatDate:String,reportList:()=>'',responseReportHistory:null,window:{addEventListener(){}}};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('    function individualResponseDateLabel('),source.indexOf('    function renderIndividualResponseWorkspace(')),context);
const html=context.renderIndividualResponseReport({report:result});
assert.match(html,/<option value="io">Ideas &amp; Organisation<\/option>/);
assert.match(html,/<option value="vl">Vocabulary &amp; Language Patterns<\/option>/);
assert.doesNotMatch(html,/<option[^>]*>(?:IO|VL)<\/option>|思考提示|DEVELOP YOUR IDEAS|內容與語言提升|speaking-ir-questions/);
const articles=[...html.matchAll(/<article class="speaking-ir-sample"([^>]*)>([\s\S]*?)<\/article>/g)];
assert.equal(articles.length,3);
articles.forEach(([,attrs,body],i)=>{assert.equal((body.match(/<details /g)||[]).length,2);assert(body.indexOf('Take it further')<body.indexOf('Sample answer'));assert.match(body, /speaking-ir-thinking" open>/);assert.match(body, /speaking-ir-example">/);assert(body.includes(input.sample_responses[i].thinking_prompt_zh));assert.equal(/ hidden/.test(attrs),i!==0);});
const hostile=fixture();hostile.sample_responses[0].thinking_prompt_zh='<img src=x onerror=alert(1)>?';assert.doesNotMatch(context.renderIndividualResponseDevelopment(hostile),/<img/);
// A selector change must switch the entire paired article, never just its Sample.
const panels=[0,1,2].map(i=>({hidden:i!==0,getAttribute:()=>String(i),querySelectorAll:()=>[{open:true,classList:{contains:()=>false}},{open:false,classList:{contains:()=>true}}]}));
let change;const picker={value:'2',options:[{text:'Exemplar 3'}],selectedIndex:0,style:{},parentElement:{querySelector:()=>({textContent:'',getBoundingClientRect:()=>({width:70})})},getAttribute:()=> 'exemplar',addEventListener:(name,cb)=>{change=cb;}};
context.detail={querySelectorAll:selector=>selector==='[data-ir-select]'?[picker]:panels};context.document={};context.bindIndividualResponseCardPickers();change();assert.deepStrictEqual(panels.map(x=>x.hidden),[true,true,false]);
// Report-bound copy is stable across independent renders/devices and metadata refreshes.
const response = { response_session_id: 'stable-ir-report-7', active_report_version: 1 };
const labels = context.individualResponseExemplarLabels(response);
const fresh = { ...context }; vm.createContext(fresh);
vm.runInContext(source.slice(source.indexOf('    function individualResponseDateLabel('),source.indexOf('    function renderIndividualResponseWorkspace(')),fresh);
assert.equal(JSON.stringify(labels),JSON.stringify(fresh.individualResponseExemplarLabels({...response,updated_at:'2099-01-01'})));
const variations = Array.from({length:100},(_,i)=>context.individualResponseExemplarLabels({response_session_id:'ir-'+i,active_report_version:1}));
assert.equal(new Set(variations.map(x=>x.thinking)).size,12);
assert.equal(new Set(variations.map(x=>x.sample)).size,12);
// Pin the v1 choice so later pool/order edits cannot silently relabel locked reports.
assert.deepStrictEqual(JSON.parse(JSON.stringify(labels)), {"thinking":"Let’s think deeper","sample":"One way to respond"});
const titleMarkup = context.renderIndividualResponseReport({...response,report:result});
assert.equal((titleMarkup.match(new RegExp(context.esc(labels.thinking),'g'))||[]).length,3);
assert.equal((titleMarkup.match(new RegExp(context.esc(labels.sample),'g'))||[]).length,3);
// Changing exemplars resets only the newly selected pair, never the transcript/Analysis.
const firstBlocks = [{open:false,classList:{contains:()=>true}},{open:true,classList:{contains:()=>false}}];
panels[2].querySelectorAll=()=>firstBlocks;change();
assert.deepStrictEqual(firstBlocks.map(x=>x.open),[true,false]);
console.log('IR v4 paired thinking prompts, strict validation, legacy boundaries, selectors and safe rendering passed.');
