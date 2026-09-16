'use strict';
const assert=require('assert'),fs=require('fs'),vm=require('vm');
const refresh=require('../cloudfunctions/_shared/speaking-ir-refresh');
const code=fs.readFileSync(require.resolve('../cloudfunctions/speakingLab/index.js'),'utf8');
function fixture(){
const old={report_id:'same-report',report_version:'response-r1',job_id:'old-job',session_type:'individual_response',response_session_id:'response',response_revision:1,status:'ready',created_at:'original-date',transcript:{segments:[{segment_id:'s1',text:'A supported idea'}]},dse_analysis:{domains:{communication_strategies:{score:2},ideas_organisation:{score:2}}}};
const response={response_session_id:'response',report_id:old.report_id,active_report_version:old.report_version,active_audio_revision:1,formal_audio_asset_id:'audio',active_analysis_job_id:'new-job',analysis_status:'ready',report:old.dse_analysis};
const job={job_id:'new-job',response_session_id:'response',response_revision:1,formal_audio_asset_id:'audio',source_report_id:old.report_id,source_report_version:old.report_version,source_job_id:old.job_id,expected_report_id:old.report_id,expected_report_version:old.report_version,refresh_kind:refresh.OVERWRITE_KIND,stage:'analysis',status:'processing',lease_token:'lease'};
return {old,response,job};
}
(async()=>{
const {old,response,job}=fixture();refresh.assertSource(job,response,old);
for(const change of [{report_id:'other'},{active_audio_revision:2},{formal_audio_asset_id:'other'}])assert.throws(()=>refresh.assertSource(job,{...response,...change},old),/SUPERSEDED/);
assert.throws(()=>refresh.assertSource(job,response,{...old,job_id:'changed'}),/SUPERSEDED/);
refresh.assertSource({...job,expected_report_id:null,expected_report_version:null},{...response,report_id:null,active_report_version:null},{...old,status:'processing',dse_analysis:undefined});
assert.equal(refresh.failureStatus(job,response),'ready');
assert.equal(refresh.failureStatus(job,{...response,report:null}),'failed');
async function run({changedInTransaction=false,invalid=false}={}){
 const f=fixture(),writes=[],generated={report_version:'dse-individual-response-v4',domains:{ideas_organisation:{score:6},vocabulary_language_patterns:{score:5}}};
 const context={speakingNotifications:{enqueueSafely:async()=>{}},irRefresh:refresh,INDIVIDUAL_RESPONSES:'sessions',REPORTS:'reports',JOBS:'jobs',ASSETS:'assets',INDIVIDUAL_RESPONSE_PROMPT_VERSION:'new-prompt',now:()=> 'finished-date',secretMatches:(a,b)=>a===b,individualResponseAnalysisPrompt:()=>'',individualResponseUserPrompt:()=>'',lab:{INDIVIDUAL_RESPONSE_REPORT_SCHEMA_VERSION:'dse-individual-response-v4',canonicalizeIndividualResponseReport:x=>{if(invalid)throw Error('INVALID_MODEL_OUTPUT');return x;}},createAuditedModelProvider:()=>({callStructuredModel:async()=>({output:generated}),name:'existing'}),replaceFields:(row,fields)=>{assert(fields.includes('dse_analysis')||fields.includes('report'));return row;},getOne:async(table,filter)=> table==='sessions'?f.response:table==='jobs'?f.job:table==='assets'?{}:filter.status==='processing'?null:f.old};
 context.db={command:{remove:()=>({remove:true})},runTransaction:async fn=>fn({collection:table=>({where:()=>({limit:()=>({get:async()=>({data:[table==='sessions'?f.response:table==='jobs'?f.job:changedInTransaction?{...f.old,job_id:'raced'}:f.old]})})}),doc:id=>({update:async values=>writes.push({table,id,values}),create:async()=>{throw Error('MUST_NOT_CREATE_A_REPORT_VERSION');}})})})};
 vm.createContext(context);vm.runInContext(code.slice(code.indexOf('function individualResponseReportIdentity('),code.indexOf('async function processQueuedJob(')),context);
 assert.deepStrictEqual(JSON.parse(JSON.stringify(context.individualResponseReportIdentity(f.job))),{report_id:f.old.report_id,report_version:f.old.report_version});
 if(changedInTransaction||invalid){await assert.rejects(context.processIndividualResponseQueuedJob(f.job),/SUPERSEDED|INVALID_MODEL_OUTPUT/);assert.equal(writes.length,0);return;}
 await context.processIndividualResponseQueuedJob(f.job);
 const report=writes.find(x=>x.table==='reports').values,session=writes.find(x=>x.table==='sessions').values;
 assert.equal(report.report_id,f.old.report_id);assert.equal(report.created_at,f.old.created_at);assert.equal(report.assessment_preserved,false);
 assert.deepStrictEqual(report.dse_analysis,generated);assert.deepStrictEqual(session.report,generated);
 assert.equal(report.dse_analysis.domains.communication_strategies,undefined);assert.equal(report.dse_analysis.domains.ideas_organisation.score,6);
}
await run();await run({changedInTransaction:true});await run({invalid:true});
console.log('IR overwrite: same report ID, full reassessment, cache replacement, source races, invalid output and legacy refresh boundaries passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
