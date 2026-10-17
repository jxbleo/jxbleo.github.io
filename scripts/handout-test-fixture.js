// Synthetic teaching text and deterministic test identities only. Never publishes.
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
function topicBankFixture() {
  const topics=Array.from({length:20},(_,i)=>{
    const topic='topic-'+String(i+1).padStart(2,'0');
    return `<article class="topic" id="${topic}"><h2>Synthetic theme ${i+1}</h2>`+Array.from({length:5},(_,j)=>{
      const id=topic+'-sub-'+(j+1);
      return `<section class="subtopic" id="${id}" data-label="Synthetic"><a href="#${id}-development">Development</a><ol class="viewpoints">`+
        Array.from({length:8},()=>'<li><p class="claim">Synthetic viewpoint only.</p></li>').join('')+
        `</ol><section class="development" id="${id}-development"><span class="label">假设情境</span><div class="chain">Synthetic chain.</div><div class="chain">Synthetic chain.</div><article class="option">Synthetic option.</article><article class="option">Synthetic option.</article><ol class="transfer-tasks"><li>Task one.</li><li>Task two.</li><li>Task three.</li></ol></section></section>`;
    }).join('')+'</article>';
  }).join('');
  return '<!doctype html><html lang="zh-CN"><head><title>DSE英文核心话题库</title><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><link rel="canonical" href="https://www.mrcatenglish.com/dse-topic-bank.html"><link rel="stylesheet" href="assets/css/dse-topic-bank.css?v=test"><script src="assets/js/dse-topic-bank.js?v=test" defer></script></head><body data-topic-bank-version="content-development-v1" data-topic-bank-delivery="direct-static"><header data-share-header="handout"></header><main>'+topics+'</main></body></html>';
}
function fixture(root) {
  const policy=require('./handout-policy.json');
  fs.mkdirSync(path.join(root,'scripts'),{recursive:true});
  for (const file of ['handout-policy.json','handout-store.js','render-handouts.js','render-topic-bank.js','share-header.js']) fs.copyFileSync(path.join(__dirname,file),path.join(root,'scripts',file));
  const modules=Array.from({length:32},(_,i)=>({id:String(i+1).padStart(2,'0'),title:'Test module '+(i+1),summary:'Synthetic summary',sources:['S01']}));
  const course={modules};
  const files={};
  files['dse-core-topics/published.html']=topicBankFixture();
  const head='<head><meta name="robots" content="noindex,follow"><link rel="canonical" href="https://www.mrcatenglish.com/dse-writing-course.html"><meta property="og:url" content="https://www.mrcatenglish.com/dse-writing-course.html"><title>Test</title><script src="assets/js/dse-writing-course.js" defer></script></head>';
  const header='<header class="resource-topbar" data-resource-topbar><a class="resource-brand" href="index.html"><img src="cat.png" alt="">Mr. Cat Academy</a><button id="copy-lesson">复制链接</button><button id="print-lesson">打印</button></header>';
  files[policy.writingCourse.source]='<html>'+head+'<body>'+header+modules.map(m=>`<section class="course-panel lesson" id="module-${m.id}"><h2 id="title-${m.id}">${m.title}</h2><p>Only test-content-${m.id}.</p><nav class="lesson-pager"><a href="#overview">All</a></nav></section>`).join('')+'</body></html>';
  for (const guide of policy.guides) files[guide.source]='<html>'+head.replaceAll(policy.writingCourse.source,guide.source)+'<body>'+header+'<p>Synthetic guide only.</p></body></html>';
  files['content/study-guides/dse-writing-course/course.json']=JSON.stringify(course);
  files['content/study-guides/dse-writing-course/sources.json']=JSON.stringify([{id:'S01',kind:'Test',title:'Official fixture',url:'https://example.com/source',status:'Private research fixture',use:'Private scope fixture',readerDescription:'A reader-facing explanation of the reference.'}]);
  const key=Buffer.alloc(32,17),iv=Buffer.alloc(12,23),cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('mrcat-independent-handouts-v1'));
  const encrypted=Buffer.concat([cipher.update(zlib.gzipSync(Buffer.from(JSON.stringify(files)))),cipher.final()]);
  fs.writeFileSync(path.join(root,'scripts/handouts.sealed.json'),JSON.stringify({schemaVersion:1,algorithm:'aes-256-gcm',iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),ciphertext:encrypted.toString('base64')}));
  const privateDir=path.join(root,'.cloudbase-private/handouts');fs.mkdirSync(privateDir,{recursive:true});
  const items=require('./handout-store').itemsFor(policy,files);
  const map={schemaVersion:1,links:Object.fromEntries(items.map(i=>[i.id,'h-'+crypto.createHash('sha256').update('fixture-'+i.id).digest('hex').slice(0,48)+'.html']))};
  fs.writeFileSync(path.join(privateDir,'content-key.txt'),key.toString('hex'));
  fs.writeFileSync(path.join(privateDir,'links.json'),JSON.stringify(map));
  return {map,files,items,key,policy};
}
module.exports=fixture;
module.exports.topicBankFixture=topicBankFixture;
