'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const path = require('path');
const source = fs.readFileSync(path.join(__dirname, '../assets/js/speaking-waiting.js'), 'utf8');
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
function node() {
    const events = new Map(), classes = new Set();
    return { hidden:false, innerHTML:'', textContent:'', parentElement:{hidden:true}, attributes:{},
        classList:{toggle(c,on){if(on) classes.add(c);else classes.delete(c);},contains:c=>classes.has(c)},
        setAttribute(k,v){this.attributes[k]=v;},addEventListener(e,f){if(!events.has(e))events.set(e,new Set());events.get(e).add(f);},
        removeEventListener(e,f){if(events.has(e))events.get(e).delete(f);},emit(e){for(const f of [...(events.get(e)||[])])f({});},events };
}
function setup(options={}) {
    let now=0, serial=0, active=true, opened=0, requests=0, mounts=0, destroyed=0;
    const timers=new Map(), nodes=new Map(), card=node(), window=node(), document=node();
    card.querySelector=s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);};
    window.setTimeout=(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:now+delay});return id;};
    window.clearTimeout=id=>timers.delete(id);
    window.matchMedia=()=>({matches:!!options.reduced});
    const runner={state:'',paused:false,setTaskState(s){this.state=s;},pause(){this.paused=true;},resume(){this.paused=false;},destroy(){destroyed++;},snapshot(){return {supported:true};}};
    if(!options.noRunner)window.MrCatWaitingRunner={mount(){mounts++;return runner;}};
    const initial={analysis_status:'queued',recording_status:'uploaded',...options.initial};
    let impl=options.request||(()=>Promise.resolve(initial));
    vm.runInNewContext(source,{window,document,Promise,Date:{now:()=>now}});
    const controller=window.MrCatSpeakingWaiting.mount({querySelector:()=>card},{initial,isActive:()=>active,request:()=>{requests++;return impl();},retry:options.retry||(()=>Promise.resolve()),onReady:()=>{opened++;}});
    async function advance(ms){const end=now+ms;while(true){const entry=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!entry)break;now=entry[1].at;timers.delete(entry[0]);entry[1].fn();await flush();}now=end;await flush();}
    return {controller,card,nodes,window,document,runner,timers,advance,setRequest:f=>{impl=f;},leave:()=>{active=false;controller.destroy();},get requests(){return requests;},get opened(){return opened;},get mounts(){return mounts;},get destroyed(){return destroyed;}};
}
(async()=>{
    const h=setup();await flush();assert.equal(h.requests,1);
    await h.advance(3000);assert.equal(h.requests,2);assert.equal(h.mounts,1,'polling must not reset the game');
    h.setRequest(()=>Promise.resolve({analysis_status:'ready',report:{summary:'saved'}}));
    await h.advance(3000);assert(h.runner.paused);assert(h.card.classList.contains('is-ready'));assert.equal(h.opened,0);
    await h.advance(1800);assert.equal(h.opened,1);assert.equal(h.destroyed,1);assert.equal(h.timers.size,0);
    h.window.emit('focus');await flush();assert.equal(h.opened,1);

    let resolve;const pending=setup({request:()=>new Promise(r=>{resolve=r;})});await flush();
    pending.window.emit('focus');pending.window.emit('online');await flush();assert.equal(pending.requests,1,'no overlapping status reads');
    pending.leave();resolve({analysis_status:'ready',report:{}});await flush();await pending.advance(5000);assert.equal(pending.opened,0,'late old task cannot navigate');
    assert.equal([...pending.document.events.values()].reduce((n,s)=>n+s.size,0),0);

    const recover=setup({request:()=>Promise.reject(new Error('offline'))});await flush();
    assert.match(recover.nodes.get('[data-speaking-wait-status]').textContent,/retry automatically/);
    recover.setRequest(()=>Promise.resolve({analysis_status:'ready',report:{}}));recover.window.emit('online');await flush();await recover.advance(1800);assert.equal(recover.opened,1);

    let retryCount=0;const failed=setup({initial:{analysis_status:'failed'},retry:()=>{retryCount++;return Promise.resolve();}});await flush();assert.equal(failed.requests,0);
    failed.setRequest(()=>Promise.resolve({analysis_status:'ready',report:{}}));failed.nodes.get('[data-retry-waiting]').emit('click');failed.nodes.get('[data-retry-waiting]').emit('click');await flush();assert.equal(retryCount,1);await failed.advance(1800);assert.equal(failed.opened,1);

    const hung=setup({request:()=>new Promise(()=>{})});await flush();await hung.advance(25000);assert.match(hung.nodes.get('[data-speaking-wait-status]').textContent,/retry automatically/);hung.setRequest(()=>Promise.resolve({analysis_status:'ready',report:{}}));await hung.advance(6000);await hung.advance(1800);assert.equal(hung.opened,1);
    const missing=setup({request:()=>Promise.resolve({analysis_status:'ready'})});await flush();assert.equal(missing.opened,0);assert(!missing.runner.paused);missing.leave();
    const unstarted=setup({initial:{analysis_status:'not_ready'}});await flush();assert.equal(unstarted.requests,0);assert.equal(unstarted.nodes.get('[data-retry-waiting]').textContent,'Start analysis');unstarted.leave();
    const fallback=setup({noRunner:true,reduced:true,request:()=>Promise.resolve({analysis_status:'ready',report:{}})});await flush();await fallback.advance(0);assert.equal(fallback.opened,1,'game support cannot block reports');
    const hidden=setup();await flush();hidden.document.hidden=true;await hidden.advance(3000);assert.equal(hidden.requests,2);await hidden.advance(9000);assert.equal(hidden.requests,2);hidden.document.hidden=false;hidden.document.emit('visibilitychange');await flush();assert.equal(hidden.requests,3);hidden.leave();
    const denied=setup({request:()=>Promise.reject(Object.assign(new Error('denied'),{code:'FORBIDDEN'}))});await flush();assert(denied.nodes.get('[data-retry-waiting]').parentElement.hidden);await denied.advance(30000);assert.equal(denied.requests,1);denied.leave();
    console.log('Speaking waiting: both task adapters use one stable game, bounded non-overlapping reads, foreground/network recovery, failed retry, stale disposal, timeout recovery, ready freeze and exactly-once automatic result opening.');
})().catch(error=>{console.error(error);process.exitCode=1;});
