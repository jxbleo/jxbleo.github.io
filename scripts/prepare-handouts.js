'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const {ROOT, SEALED, privatePath, contentKey, itemsFor, validateLinks, loadRelease} = require('./handout-store');
const args = new Set(process.argv.slice(2));
if ([...args].some(a=>!['--initialize','--seal','--restore-source','--teacher-catalog'].includes(a)) || args.size !== 1) {
  throw new Error('Choose exactly one: --initialize, --seal, --restore-source, --teacher-catalog. No command publishes.');
}
fs.mkdirSync(privatePath(ROOT,''),{recursive:true,mode:0o700});
function writePrivate(file, data) { fs.writeFileSync(file,data,{mode:0o600}); }
function sourceFiles() {
  const dir = privatePath(ROOT,'source');
  const files = {};
  function visit(folder) {
    for (const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))) {
      const full=path.join(folder,entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.(html|json)$/.test(entry.name)) files[path.relative(dir,full).split(path.sep).join('/')]=fs.readFileSync(full,'utf8');
    }
  }
  if (!fs.existsSync(dir)) throw new Error('Private authoring sources are missing. Restore the sealed source with its key first.');
  visit(dir); return files;
}
if (args.has('--restore-source')) {
  const {files}=loadRelease();
  if (fs.existsSync(privatePath(ROOT,'source'))) throw new Error('Private source already exists; refusing to overwrite edits.');
  for (const [name,value] of Object.entries(files)) {
    const out=privatePath(ROOT,'source/'+name); fs.mkdirSync(path.dirname(out),{recursive:true,mode:0o700}); writePrivate(out,value);
  }
  console.log('Private authoring source restored.');
} else if (args.has('--teacher-catalog')) {
  const {items,map}=loadRelease();
  const catalog={schemaVersion:1,items:items.map(({id,title,topic,description})=>({id,title,topic,description,category:'study',access:'链接持有人可阅读',href:map.links[id]}))};
  const output=path.join(ROOT,'cloudfunctions/teacherHandoutLinks/handout-links.private.json');
  fs.mkdirSync(path.dirname(output),{recursive:true}); writePrivate(output,JSON.stringify(catalog,null,2)+'\n');
  writePrivate(privatePath(ROOT,'teacher-links.json'),JSON.stringify(catalog,null,2)+'\n');
  const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const sorted=catalog.items.slice().sort((a,b)=>{
    const order=i=>i.id==='dse-writing-course'?0:i.id.startsWith('dse-writing-module-')?1:i.id.startsWith('dse-reading-')?2:3;
    return order(a)-order(b) || a.id.localeCompare(b.id);
  });
  let publicationNotice='本批链接尚未正式发布；上线后再分享。';
  try {
    const published=JSON.parse(fs.readFileSync(privatePath(ROOT,'publication.json'),'utf8'));
    const digest=value=>crypto.createHash('sha256').update(value).digest('hex');
    if (published.mapDigest===digest(JSON.stringify(map)) && Number.isFinite(Date.parse(published.publishedAt))) {
      publicationNotice=published.sourceDigest===digest(fs.readFileSync(path.join(ROOT,SEALED)))
        ? '本批独立链接已上线，可按学生需要分享完整版或单讲。'
        : '链接已上线；本地内容另有更新，尚待发布。';
    }
  } catch (_) { /* No verified local release record: keep the unpublished label. */ }
  const cards=sorted.map(i=>`<article><h2>${escape(i.title)}</h2><p>${escape(i.description)}</p><input aria-label="${escape(i.title)}的链接" readonly value="https://www.mrcatenglish.com/${i.href}"><button type="button">复制链接</button></article>`).join('');
  writePrivate(privatePath(ROOT,'share-links.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>教师用 · 独立讲义分享链接</title><style>body{max-width:880px;margin:40px auto;padding:0 20px;background:#f3f7f6;color:#254249;font:16px/1.7 system-ui}article{background:white;padding:22px;margin:18px 0;border:1px solid #d7e4e0;border-radius:16px}h2{font-size:19px}input{width:calc(100% - 20px);padding:10px;font-size:14px;border:1px solid #b4c9c2;border-radius:7px}button{margin-top:12px;padding:9px 18px;border:0;border-radius:9px;background:#245d5b;color:white;font:inherit}.notice{padding:20px;border:1px solid #b4c9c2;border-radius:12px}</style><h1>独立讲义分享链接</h1><p class="notice">教师私用清单，请勿整份转发或上传。${publicationNotice}完整版包含全部 16 讲；单讲链接只提供相应一讲。链接持有人可阅读和转发。</p>${cards}<p role="status" id="status"></p><script>document.querySelectorAll('button').forEach(b=>b.onclick=async()=>{const input=b.previousElementSibling;try{await navigator.clipboard.writeText(input.value);b.textContent='已复制';}catch(_){input.focus();input.select();document.getElementById('status').textContent='请复制已选中的链接';}});</script></html>`);
  console.log('Private teacher catalog prepared; '+items.length+' entries. No deployment performed.');
} else {
  const files=sourceFiles(), policy=JSON.parse(fs.readFileSync(path.join(ROOT,'scripts/handout-policy.json'),'utf8'));
  const items=itemsFor(policy,files);
  if (args.has('--initialize')) {
    const keyFile=privatePath(ROOT,'content-key.txt'), mapFile=privatePath(ROOT,'links.json');
    if (!fs.existsSync(keyFile)) writePrivate(keyFile,crypto.randomBytes(32).toString('hex')+'\n');
    let map=fs.existsSync(mapFile)?JSON.parse(fs.readFileSync(mapFile,'utf8')):{schemaVersion:1,links:{}};
    for (const item of items) if (!Object.hasOwn(map.links,item.id)) map.links[item.id]='h-'+crypto.randomBytes(24).toString('hex')+'.html';
    validateLinks(map,items); writePrivate(mapFile,JSON.stringify(map,null,2)+'\n');
    console.log('Private link identities prepared without rotating existing links.');
  } else {
    const plain=Buffer.from(JSON.stringify(files));
    const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',contentKey(),iv);
    cipher.setAAD(Buffer.from('mrcat-independent-handouts-v1'));
    const encrypted=Buffer.concat([cipher.update(zlib.gzipSync(plain)),cipher.final()]);
    const sealed={schemaVersion:1,algorithm:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')};
    fs.writeFileSync(path.join(ROOT,SEALED),JSON.stringify(sealed)+'\n');
    // Authenticate the completed artifact before reporting success.
    loadRelease();
    console.log('Encrypted handout source prepared and verified; '+items.length+' independent share targets.');
  }
}
