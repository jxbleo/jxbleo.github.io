'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs');
// Every static consumer renders the same template; no copied per-page variant can drift.
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const {render,synchronize,assets}=require('./share-header');
const publicMaterials=require('../content/share-materials.json').items.map(item=>item.href);
for(const file of [...publicMaterials,'speaking-report.html']) {
 const html=fs.readFileSync(path.join(root,file),'utf8');
 const header=html.match(/<header\b[^>]*data-share-header="([^"]+)"[^>]*>[\s\S]*?<\/header>/);
 assert(header,`${file} must adopt the shared toolbar`);
 assert.equal(header[0],render(header[1]));
 assert(html.includes(assets));
 assert.equal(synchronize(html),html,`${file} must be synchronized`);
}
assert.throws(()=>render('__proto__'),/Unknown/);
assert.throws(()=>synchronize('<head></head>'+render()+render()),/one marked header/);
assert.throws(()=>synchronize('<head></head><header data-share-header="typo"></header>'),/Unknown/);
const seed='<html><head></head><body><header data-share-header="report"></header><div id="private-content">unchanged</div></body></html>';
const finalized=synchronize(seed);
assert.equal(synchronize(finalized),finalized);
assert(finalized.includes('<div id="private-content">unchanged</div>'));
assert.equal((finalized.match(/data-share-header-style/g)||[]).length,1);
assert(!/handout-topbar/.test(fs.readFileSync(path.join(root,'assets/css/speaking-report.css'),'utf8')),'Report CSS must not duplicate shared styling');
console.log('Shared reader integration passed: every consumer uses the canonical header/assets, synchronized output is stable, and invalid markers fail closed.');
