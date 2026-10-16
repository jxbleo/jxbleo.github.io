'use strict';
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../assets/js/share-header.js'),'utf8');
class E {
 constructor(tag,attrs={}){this.tag=tag;this.attrs=attrs;this.children=[];this.events={};this.style={};this.hidden=false;this.textContent='';}
 appendChild(e){this.children.push(e);e.parent=this;return e;}
 setAttribute(k,v){this.attrs[k]=v;}
 hasAttribute(k){return k in this.attrs;}
 getAttribute(k){return this.attrs[k];}
 removeAttribute(k){delete this.attrs[k];}
 addEventListener(k,f){(this.events[k]??=[]).push(f);}
 matches(s){return s.startsWith('[')?this.hasAttribute(s.slice(1,-1)):s.startsWith('.')?(this.className||'').split(' ').includes(s.slice(1)):this.tag===s;}
 querySelectorAll(s){return this.children.flatMap(c=>[...(c.matches(s)?[c]:[]),...c.querySelectorAll(s)]);}
 querySelector(s){for(const c of this.children){if(c.matches(s))return c;const f=c.querySelector(s);if(f)return f;}return null;}
 closest(s){return this.matches(s)?this:this.parent?.closest(s);}
 contains(e){return e===this||this.children.some(c=>c.contains(e));}
 focus(){this.doc.activeElement=this;}
 select(){}
 setSelectionRange(){}
 remove(){this.parent.children=this.parent.children.filter(e=>e!==this);}
}
function setup({ua='Macintosh',touch=0,clipboard='ok',legacy=false,secure=true,denyNav=false}={}){
 const events={},winEvents={},writes=[],oldWrites=[],navigations=[],timers=new Map();let resolve;
 const doc={hidden:false,addEventListener(k,f){(events[k]??=[]).push(f);},createElement(tag){const e=new E(tag);e.doc=doc;return e;},execCommand(c){assert.equal(c,'copy');oldWrites.push(doc.body.children.at(-1).value);return legacy;}};
 doc.body=doc.createElement('body');const header=doc.body.appendChild(new E('header',{'data-share-header':'report'}));const nav=header.appendChild(doc.createElement('nav'));nav.className='handout-socials';
 const xhs=nav.appendChild(new E('a',{'data-handout-app':'xiaohongshu','data-handout-app-url':'xhsdiscover://user/5fbbbaf800000000010081af'}));xhs.href='https://xhslink.cn/o/aYLtaYWoBd';xhs.doc=doc;
 function copy(name){const c=nav.appendChild(new E('div'));c.className='handout-copy-help';const b=c.appendChild(new E(name==='douyin'?'a':'button',{['data-handout-'+name]:name==='wechat'?'jxbleo_':'','aria-expanded':'false'}));b.doc=doc;const s=c.appendChild(new E('div',{['data-handout-'+name+'-status']:''}));s.hidden=true;
 for(const suffix of name==='douyin'?['message','next','text','alternative','guide']:['message'])s.appendChild(new E(suffix==='text'?'textarea':suffix==='alternative'?'details':'span',{['data-handout-'+name+'-'+suffix]:''}));return {container:c,trigger:b,status:s,get:suffix=>c.querySelector('[data-handout-'+name+'-'+suffix+']')};}
 const dy={trigger:nav.appendChild(new E('a'))};dy.trigger.href='https://v.douyin.com/rjLsjpFg0as/';dy.trigger.doc=doc;const wx=copy('wechat');doc.querySelector=s=>doc.body.querySelector(s);doc.querySelectorAll=s=>doc.body.querySelectorAll(s);
 const emit=(target,key,e={})=>(target[key]||[]).forEach(f=>f(e));
 const win={isSecureContext:secure,location:{assign(url){navigations.push(url);if(denyNav)throw Error('Unavailable');}},addEventListener(k,f){(winEvents[k]??=[]).push(f);},clearTimeout(id){timers.delete(id);},setTimeout(f,ms){const id=timers.size+1;timers.set(id,{f,ms});return id;}};
 const navigator={userAgent:ua,maxTouchPoints:touch,clipboard:clipboard==='absent'?undefined:{writeText(value){writes.push(value);return clipboard==='reject'?Promise.reject(Error('Denied')):clipboard==='pending'?new Promise(r=>resolve=r):Promise.resolve();}}};
 vm.runInNewContext(source,{document:doc,window:win,navigator});
 function click(el,extra={}){doc.activeElement=el;const e={button:0,target:el,preventDefault(){this.defaultPrevented=true;},...extra};const pending=el.events.click?.[0](e);emit(events,'click',e);return {e,pending};}
 return {init:()=>win.MrCatShareHeader.init(),doc,nav,xhs,dy,wx,writes,oldWrites,navigations,timers,click,emit:(key,e)=>emit(events,key,e),resolve:()=>resolve(),pagehide:()=>emit(winEvents,'pagehide')};
}
// Every static consumer renders the same template; no copied per-page variant can drift.
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {render,synchronize,assets}=require('./share-header');
assert.throws(()=>render('__proto__'),/Unknown/);
assert.throws(()=>synchronize('<head></head>'+render()+render()),/one marked header/);
assert.throws(()=>synchronize('<head></head><header data-share-header="typo"></header>'),/Unknown/);
const seed='<html><head></head><body><header data-share-header="report"></header><div id="private-content">unchanged</div></body></html>';
const finalized=synchronize(seed);
assert.equal(synchronize(finalized),finalized);
assert(finalized.includes('<div id="private-content">unchanged</div>'));
assert.equal((finalized.match(/data-share-header-style/g)||[]).length,1);
(async()=>{
 const once=setup();once.init();once.init();assert.equal(once.wx.trigger.events.click.length,1);assert.equal(once.xhs.events.click.length,1);
 await once.click(once.wx.trigger).pending;assert.deepEqual(once.writes,['jxbleo_']);
 for(const ua of ['Macintosh','Windows','iPhone','Android','HarmonyOS','iPhone MicroMessenger']){
  const r=setup({ua});assert.equal(r.writes.length,0);assert.equal(r.navigations.length,0);const {e,pending}=r.click(r.dy.trigger);await pending;
  assert(!e.defaultPrevented);assert.equal(r.writes.length,0);assert.equal(r.navigations.length,0);assert.equal(r.dy.trigger.events.click,undefined);assert.equal(r.nav.children.length,3,'Douyin must not add a popup');
  await r.click(r.wx.trigger).pending;assert.equal(r.writes.at(-1),'jxbleo_');assert.equal(r.wx.get('message').textContent,'微信号已复制');assert(!r.wx.status.hidden);assert.equal([...r.timers.values()][0].ms,6000);
  r.click(r.dy.trigger);assert(r.wx.status.hidden);
 }
 for(const options of [{clipboard:'reject',legacy:true},{clipboard:'absent',legacy:true},{secure:false,legacy:true}]){const r=setup(options);await r.click(r.wx.trigger).pending;assert.deepEqual(r.oldWrites,['jxbleo_']);assert.equal(r.wx.get('message').textContent,'微信号已复制');assert.equal(r.doc.body.children.length,1);assert.equal(r.doc.activeElement,r.wx.trigger);}
 const fail=setup({clipboard:'reject'});await fail.click(fail.wx.trigger).pending;assert.equal(fail.wx.get('message').textContent,'请长按或选中微信号复制：');assert(!fail.wx.status.hidden);assert.equal(fail.timers.size,0);
 for(const dismiss of ['escape','outside','visibility','pagehide']){const r=setup({clipboard:'pending'});const p=r.click(r.wx.trigger).pending;if(dismiss==='escape')r.emit('keydown',{key:'Escape'});if(dismiss==='outside')r.emit('click',{target:r.doc.body});if(dismiss==='visibility'){r.doc.hidden=true;r.emit('visibilitychange');}if(dismiss==='pagehide')r.pagehide();r.resolve();await p;assert(r.wx.status.hidden);assert.equal(r.oldWrites.length,0);}
 for(const extra of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1}]){const r=setup();assert(!r.click(r.dy.trigger,extra).e.defaultPrevented);assert.equal(r.writes.length,0);}
 const wx=setup({ua:'iPhone MicroMessenger'});assert(!wx.click(wx.xhs).e.defaultPrevented);assert.equal(wx.navigations.length,0);assert.equal(wx.nav.children.length,3);
 for(const [ua,touch] of [['iPhone',0],['Android',0],['HarmonyOS',0],['Macintosh',5]]){const r=setup({ua,touch,denyNav:true});assert(r.click(r.xhs).e.defaultPrevented);assert.deepEqual(r.navigations,['xhsdiscover://user/5fbbbaf800000000010081af']);const h=r.nav.children.at(-1);assert(!h.hidden);assert.equal(h.querySelector('a').href,r.xhs.href);assert.equal(h.querySelector('a').referrerPolicy,'no-referrer');r.doc.hidden=true;r.emit('visibilitychange');assert(h.hidden);}
 console.log('Shared template and runtime passed: direct unmodified Douyin navigation with no copy/popup/interception, preserved WeChat copying/fallback/dismissal and unchanged Xiaohongshu routing.');
})().catch(e=>{console.error(e);process.exitCode=1;});
