'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawnSync}=require('node:child_process');
const fixture=require('./handout-test-fixture');
const {loadRelease,privatePath}=require('./handout-store');
const {renderRelease,independentPage}=require('./render-handouts');
function checkStudentHeader(html) {
  const header=html.match(/<header\b[^>]*\bdata-resource-topbar\b[^>]*>[\s\S]*?<\/header>/);
  assert(header,'Each student handout must have a header');
  assert(header[0].includes('猫先生英语') && header[0].includes('assets/icons/mrcat-icon-192.png'));
  assert(!/Mr\. Cat Academy|class="handout-contact"/.test(header[0]),'Keep a compact Chinese brand and social controls');
  const buttons=[...header[0].matchAll(/<button\b[^>]*>/g)];
  assert.equal(buttons.length,1,'The only header button copies the owner WeChat ID');
  assert(buttons[0][0].includes('type="button"') && buttons[0][0].includes('data-handout-wechat="jxbleo_"') && buttons[0][0].includes('aria-label="复制微信号 jxbleo_"'));
  assert(header[0].includes('<code>jxbleo_</code>') && header[0].includes('role="status"'));
  assert(header[0].includes('请打开微信，搜索该微信号添加好友即可。'));
  assert(!/data-handout-douyin|handout-douyin-help|其他打开方式/.test(header[0]),'Douyin opens the official share link without copying or a local popup');
  assert(html.includes('assets/js/dse-handout-header.js?v=20261016-douyin-direct-1'));
  const links=[...header[0].matchAll(/<a\b([^>]*?)href="([^"]+)"([^>]*)>/g)];
  assert.equal(links.length,3,'Only the owner profiles and owner email are linked');
  const xhs=new URL(links[0][2]),douyin=new URL(links[1][2]);
  assert.equal(xhs.href,'https://xhslink.cn/o/aYLtaYWoBd');
  assert.equal(douyin.href,'https://v.douyin.com/rjLsjpFg0as/');
  assert.equal(links[2][2],'mailto:jxbleo@foxmail.com');
  for(const link of links.slice(0,2)) assert(link[0].includes('target="_blank"') && link[0].includes('rel="noopener noreferrer"') && link[0].includes('referrerpolicy="no-referrer"'));
  assert(!/视频号|handout-video/.test(header[0]),'Video Channels has been removed');
  assert(!/<span>(?:小红书|抖音|微信|邮箱)<\/span>/.test(header[0]),'Contact controls show icons only');
  assert(links[0][0].includes('data-handout-app="xiaohongshu"') && !links[1][0].includes('data-handout-app'));
  assert(links[1][0].includes('aria-label="查看猫先生英语的抖音主页"'));
  for(const link of links.filter(link=>link[0].includes('class="handout-social"'))) assert(link[0].includes('aria-label=') && link[0].includes('title='),'Icon-only contacts retain accessible names and tooltips');
  assert(!/data-resource-share|id="(?:copy-lesson|print-lesson|print-guide|print-current|print-all)"/.test(html),'Student handouts must not provide print or link-copy controls');
}
if (process.argv.includes('--artifact')) {
  const root=path.resolve(__dirname,'..'),release=loadRelease(root),expected=renderRelease(release);
  const course=JSON.parse(release.files['content/study-guides/dse-writing-course/course.json']);
  for(const item of release.items) {
    const href=release.map.links[item.id],actual=fs.readFileSync(path.join(root,'dist',href),'utf8');
    assert(actual===expected.get(href),'Published handout bytes must match the authenticated source and current isolation rules');
    checkStudentHeader(actual);
    assert(actual.includes('权威资料参考'),'Every handout includes student-facing references');
    const body=actual.replace(/<header\b[^>]*\bdata-resource-topbar\b[^>]*>[\s\S]*?<\/header>/g,'');
    assert(!/<a\b[^>]*href="(?:https?:|#source-)/.test(body),'Reference titles and citations are plain text');
    assert(!/读取情况：|用途与边界：|官方资料与读取说明|RESEARCH NOTES|给老师：怎样追问学生的推理/.test(body),'Private research logs and teacher instructions stay out of reader references');
    const ids=[...actual.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert(new Set(ids).size===ids.length,'Handout IDs must be unique');
    for(const match of actual.matchAll(/href="#([^"]+)"/g)) assert(ids.includes(match[1]),'Every local handout anchor must resolve');
    for(const match of actual.matchAll(/(?:src|href)="(assets\/[^"?#]+)(?:\?[^"#]*)?"/g)) assert(fs.existsSync(path.join(root,'dist',match[1])),'Handout asset must be in the artifact');
    if(item.module) {
      const original=release.files['content/study-guides/dse-writing-course/'+item.module+'.html'];
      assert.equal((actual.match(/class="exercise"/g)||[]).length,(original.match(/class="exercise"/g)||[]).length,'Splitting must preserve every exercise');
      for(const m of course.modules) if(m.id!==item.module) assert(!actual.includes('id="module-'+m.id+'"'),'Only granted module content may be present');
    }
  }
  assert(!fs.existsSync(path.join(root,'dist/content/study-guides')));
  const publicCatalog=fs.readFileSync(path.join(root,'dist/content/share-materials.json'),'utf8');
  for(const href of Object.values(release.map.links)) assert(!publicCatalog.includes(href),'Public catalogs must not expose handout URLs');
  assert(release.policy.retiredPaths.every(file=>!fs.existsSync(path.join(root,'dist',file))));
  console.log('Real handout artifact passed: all 23 byte matches, unique IDs, working local anchors/assets, complete single-lesson exercises, no retired routes or public source/catalog leaks.');
  process.exit(0);
}
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mrcat-isolated-handouts-'));
const env={...process.env,MRCAT_HANDOUT_LINKS_JSON:'',MRCAT_HANDOUT_CONTENT_KEY:''};
try {
  const {map,policy}=fixture(dir);
  const release=loadRelease(dir,env),pages=renderRelease(release);
  assert.equal(pages.size,23);
  const full=pages.get(map.links['dse-writing-course']);
  for(let n=9;n<=24;n++) {
    const id=String(n).padStart(2,'0'),html=pages.get(map.links['dse-writing-module-'+id]);
    assert(html.includes('test-content-'+id));
    assert(full.includes('test-content-'+id));
    for(let other=9;other<=24;other++) if(other!==n) assert(!html.includes('test-content-'+String(other).padStart(2,'0')),'Single lesson must not preload other lesson text');
    assert(!/module-picker|course-sidebar|lesson-pager|print-all|#overview/.test(html));
    assert(html.includes('dse-writing-lesson.js') && !html.includes('dse-writing-course.js'));
  }
  for(const [href,html] of pages) {
    checkStudentHeader(html);
    assert.deepEqual([...new Set(html.match(/h-[a-f0-9]{48}\.html/g))],[href]);
    assert(html.includes('noindex,nofollow,noarchive') && html.includes('no-referrer'));
    assert(policy.retiredPaths.every(p=>!html.includes(p)));
  }
  const missingMeta=independentPage('<html><head><link rel="canonical" href="dse-reading-tones.html"></head><body>Content</body></html>',map.links['dse-reading-tones'],policy);
  assert(missingMeta.includes('noindex,nofollow,noarchive'));
  const looseMeta=independentPage('<html><head><meta name="referrer" content="unsafe-url"><meta name="robots" content="index,follow"><link rel="canonical" href="dse-reading-tones.html"></head><body>Content</body></html>',map.links['dse-reading-tones'],policy);
  assert(!looseMeta.includes('unsafe-url'));
  assert.equal((looseMeta.match(/name="robots"/g)||[]).length,1);
  assert.throws(()=>independentPage('<html><head></head><body><a href="dse-reading-tfng.html">More</a></body></html>',map.links['dse-reading-tones'],policy),/retired address/);

  // A bad private configuration must fail before deleting the previous artifact.
  const manifest=require('./static-site-manifest.json');
  fs.copyFileSync(path.join(__dirname,'build-static-site.js'),path.join(dir,'scripts/build-static-site.js'));
  fs.copyFileSync(path.join(__dirname,'static-site-manifest.json'),path.join(dir,'scripts/static-site-manifest.json'));
  for(const directory of manifest.directories) fs.mkdirSync(path.join(dir,directory));
  for(const file of manifest.rootFiles) fs.writeFileSync(path.join(dir,file),'Fixture');
  fs.mkdirSync(path.join(dir,'dist'));fs.writeFileSync(path.join(dir,'dist/previous.txt'),'preserve');
  const run=()=>spawnSync(process.execPath,['scripts/build-static-site.js'],{cwd:dir,env,encoding:'utf8'});
  const rejected=()=>{const result=run();assert.notEqual(result.status,0);assert.equal(fs.readFileSync(path.join(dir,'dist/previous.txt'),'utf8'),'preserve');for(const url of Object.values(map.links)) assert(!result.stderr.includes(url),'Failed build must not log private links');};
  const mapFile=privatePath(dir,'links.json'),keyFile=privatePath(dir,'content-key.txt');
  const goodMap=fs.readFileSync(mapFile),goodKey=fs.readFileSync(keyFile);
  fs.unlinkSync(mapFile);rejected();
  fs.writeFileSync(mapFile,JSON.stringify({schemaVersion:1,links:{}}));rejected();
  const bad={schemaVersion:1,links:{...map.links}};bad.links['dse-reading-tones']=bad.links['dse-reading-inference'];fs.writeFileSync(mapFile,JSON.stringify(bad));rejected();
  bad.links['dse-reading-tones']='../teacher.html';fs.writeFileSync(mapFile,JSON.stringify(bad));rejected();
  fs.writeFileSync(mapFile,goodMap);fs.unlinkSync(keyFile);rejected();
  fs.writeFileSync(keyFile,'0'.repeat(64));rejected();
  fs.writeFileSync(keyFile,goodKey);
  fs.writeFileSync(path.join(dir,policy.retiredPaths[0]),'Accidental public plaintext');rejected();fs.unlinkSync(path.join(dir,policy.retiredPaths[0]));
  const sealedFile=path.join(dir,'scripts/handouts.sealed.json'),sealed=JSON.parse(fs.readFileSync(sealedFile,'utf8'));
  sealed.tag=Buffer.alloc(16,9).toString('base64');fs.writeFileSync(sealedFile,JSON.stringify(sealed));rejected();
  console.log('Isolated handouts passed: 23 independent targets, complete/single content scopes, no discovery controls or peer URLs, robots/referrer, and fail-closed source/map handling.');
} finally {fs.rmSync(dir,{recursive:true,force:true});}
