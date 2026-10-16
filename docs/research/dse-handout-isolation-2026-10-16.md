# DSE 阅读／写作讲义独立分发审查 — 2026-10-16

## 2026-10-16 — Cat brand and social toolbar published

Published all 23 existing handout pages at `2026-10-16T08:33:46.464Z`. All 23 COS readbacks and 46 apex/www public byte comparisons match the frozen stage. Existing source/reader assets and opaque addresses were preserved. Private backup, stage and receipt: `.cloudbase-private/handout-social-release-20261016/`. This supersedes the prior text-only header presentation.

Restored the cat icon beside 猫先生英语, adjusted typography and replaced the contact sentence with Xiaohongshu/Douyin search anchors, a native WeChat Channels search-instruction disclosure and mailto contact. The renderer and existing isolation test are the only implementation/test files changed. Updated product, architecture, UI, decisions, authoring, testing and change records. No model, backend, teacher directory or other site change.

Local Chrome verified desktop and 390px/320px layouts, visible cat/name, 44px contact targets, no horizontal overflow and a bounded Video Channels popup. Actual clicks opened the encoded keyword destinations; Xiaohongshu returned the expected keyword-search title. Reading third-party results timed out, so platform login/result availability is not certified. Desktop screenshot saved privately under `/Users/jxbleo/Research/dse-writing-course/handout-social-header-desktop-20261016.png`. Handout tests, static build, all 23 actual artifact checks and static boundary checks passed. Preserve the existing no-referrer/new-tab properties and no peer-handout addresses.

Publish source with `[skip ci]`; unrelated live/source drift still excludes full-site synchronization. Refresh existing links. No additional owner action is required.

## 2026-10-16 — Student handout headers published

At `2026-10-16T08:11:54.554Z`, published exactly 23 existing handout HTML objects and five dedicated reader scripts. All 28 COS readbacks and 66 apex/www public byte checks (including versioned scripts) matched the staged SHA-256 values. Backups and receipt: `.cloudbase-private/handout-header-release-20261016/`. Existing share identities, sealed teaching source and teacher directory remain unchanged; no backend or unrelated static object was deployed.

The common renderer replaces the cat image/English header with the requested Chinese brand and contact text, removes student print/copy/share actions and removes the related print prompts. Five readers initialize without those controls. Desktop full-course navigation, 390px standalone branding/wrapping and reading answer disclosure/navigation were checked in Chrome with no horizontal overflow or console errors. The inherited mobile brand-hide rule was corrected. The final production browser screenshot attempt timed out; production delivery was instead verified by exact public-byte comparison. Native browser print remains available, without page-provided buttons.

Validation passed `test:handouts`, static build, all 23 real-artifact checks and the static publication boundary, in both the working copy and isolated source worktree. Product, architecture, UI, authoring, test and change records were updated. Keep this release scoped and use `[skip ci]` for its source commit: unrelated production/source drift still prevents a full-site COS synchronization. Earlier copy-button QA below describes the superseded interface. Existing readers only need a refresh.

## 2026-10-16 — Independent DSE handouts published

Owner continued the prepared cutover. Published 23 independent pages plus 12 dedicated assets, then the three Teacher integration/catalog objects. All 38 COS readbacks and 76 public SHA-256 checks across apex/www matched the frozen release. Eight existing predictable handout/alias objects were backed up and removed; all nine retired policy paths return a non-content response on both domains (18 checks). No matching DSE plaintext source objects existed under the old study-guides prefix. No unrelated live object was synchronized or removed.

Deployed only `teacherHandoutLinks` (Node.js 18, 256 MB, 10 seconds). The function is Active, and its three packaged core files match the reviewed ZIP. Two live unauthenticated/spoofed-identity requests were denied without returning the directory. No collection, student record, other function, model, billing or permission setting changed. Configured both handout CI secrets without printing their values. Private stage, backups and receipts live in `.cloudbase-private/handout-cutover-20261016/`.

The source release uses an isolated worktree based on the verified remote main, removes four previously tracked plaintext/alias files, and includes only the handout implementation plus the necessary Teacher directory entry. It uses `[skip ci]` because current production also contains unrelated scoped releases not yet reconciled to main; do not run a full-site COS sync from this older source baseline. GitHub Pages uses legacy main/root publication; its settings and repository visibility stay unchanged. Previously public Git history and third-party saved copies remain outside URL retirement.

The isolated source passed `verify:release`, the full `test:release`, build and both real-artifact boundary checks. A dedicated Teacher UI contract test runs independently of unrelated classroom/RE fixtures. Existing local desktop/mobile and actual copy/paste checks remain valid. This production browser automation timed out while the Mac was locked; authenticated live Teacher UI interaction and native print pagination are not certified. Live file delivery and unauthorized access denial were verified independently.

The local owner share list now reads an ignored `publication.json` receipt, matching map/source digests before displaying a published status. It still never becomes a public index. The active Teacher directory is the regular place to copy individual share links.

以下为切换前的准备及验收记录，发布现状以上述记录为准。

本记录描述已完成的本地实现及待授权上线事项。当前未发布独立随机页面、未配置生产 secrets、未部署教师目录函数，也未撤回线上旧副本。早期课程记录中的根文件名、公开内容源和模块 hash 链接属于迁移前记录，不再是当前分享方式。本记录不保存真实随机地址或密钥。

## 交付范围与学生边界

共 23 个独立分享目标：

| 文档 | 数量 | 内容范围 |
| --- | ---: | --- |
| 写作技能与体裁完整版 | 1 | 模块 09–24 全部内容与官方资料索引 |
| 写作单讲 | 16 | 每页仅对应一个模块，附本讲必要情境与相关资料 |
| 阅读技能讲义 | 4 | Tones & Attitudes、Inference、TFNG、Language Features & Effects |
| 原有写作讲义 | 2 | 完整备考讲义、写作格式速查 |

每份使用独立稳定的 24 字节随机身份，生成根路径 `h-<48位十六进制>.html`。文件名不取自讲义标题、主题或模块号。单讲不包含其他模块的隐藏正文、全套目录、上下讲／全课入口、平台跳转或同系列推荐；阅读页也移除系列引流。有关联的原练习改为在本讲给足背景，不要求学生访问另一份讲义。

完整版仍能访问其中所有模块，因此复制按钮始终为“复制完整版链接”，不把选中模块的 hash 冒充独立分享权限。单讲复制的是自己的独立地址。页面均设置 `noindex,nofollow,noarchive`、`no-referrer` 及自身 canonical。学生持链接即可阅读该文档；此方案防止猜测与相互发现，不是账号级授权，也不阻止收到链接者保存或转发。

## 来源、构建与私有目录

明文作者源已移到忽略目录 `.cloudbase-private/handouts/source/`。写作 builder 和 tones builder 直接读写该目录；写作模块、元信息与来源索引位于其中的 `content/study-guides/dse-writing-course/`。完整课程沿用 132 组训练、136 处参考解析、11 篇完整范文和 24 项官方资料索引。单讲的额外情境修订记录在私有 `standalone-overrides.json`，不改变完整课程的原文安排。

公开仓库只保存 `scripts/handouts.sealed.json` 加密源包。实现使用 Node 内建 `crypto` 的 AES-256-GCM、每次封装新的 12 字节 IV、格式 AAD、认证标签及有大小上限的解压；没有引入新依赖。真实内容密钥与完整随机映射保存在忽略的私有文件中。CI 的 `MRCAT_HANDOUT_CONTENT_KEY` 和 `MRCAT_HANDOUT_LINKS_JSON` 仅注入构建及实际产物验证，不写入网页、JS、公共 JSON、日志或公开构建工件。

`handout-store.js` 先认证源、检查必需内容和映射完整性／唯一性；`render-handouts.js` 检查单页内容与链接边界；`build-static-site.js` 完成这些步骤后才替换 `dist`。缺少密钥、映射不完整或内容不能隔离时失败退出，不制作可能导致旧链接被删的半套产物。`dist` 及随机文件名不入 Git。静态清单排除整个 `content/study-guides/`，也不再包含九个旧根路径：四份阅读、三份写作（含新完整课程）及两个临时写作别名。旧明文仅保存在忽略的迁移备份中。

常规维护顺序：修改私有源 → 运行对应 builder 与内容检查 → `prepare-handouts.js --seal` → `--teacher-catalog` → 静态构建与边界测试。`--initialize` 仅为定义好的范围补足身份，保留已有地址；不能因内容改稿而轮换。`--restore-source` 从认证源恢复且拒绝覆盖已有作者源。维护者负责生成最终文件，不能要求教师手改映射 JSON。

教师“资料链接”新增 `teacherHandoutLinks` 私有来源，函数每次调用重新验证服务器取得的 UID 对应一个在用教师，再读取打包的 `handout-links.private.json`。无新集合或数据库写入。目录仅含安全显示信息与相应链接；公共 `content/share-materials.json` 移除原有六项，前端不回退旧可猜地址、不持久缓存私有目录。`--teacher-catalog` 同时生成本地 `share-links.html`；该清单不发布。专用函数打包检查私有目录并将其随包带入，缺失／无效时保留已有 ZIP。函数包已本地准备，尚未部署。

## 已核验与尚未核验

本地通过 `npm run test:handouts` 六组汇总、完整的 `npm run test:release` 及 `npm run verify:release`，并完成以下检查：

- `test-isolated-handouts.js`：23 个目标、单讲／完整稿范围、无同级链接／发现入口、robots/referrer、源与映射失败边界。
- `test-static-build.js` 的常规 fixture 与实际 artifact 检查。
- `test-teacher-material-links.js`、`test-teacher-handout-links.js`、`test-teacher-handout-package.js`：教师目录集成、授权与安全打包。
- `test-handout-log-redaction.js`：六个模拟 COS 场景，涵盖成功、普通／分片重试、列举／上传／删除失败；真实对象键不因日志脱敏改变，失败上传仍不删除旧对象。
- 单讲运行时的合成 VM 验证：复制自身 canonical；打印前／后及错误分支恢复原展开状态。
- 23 份真实产物的字节、ID、锚点和资源引用检查；每份单讲的练习数与原稿一致。
- 重复运行 `--initialize` 后，链接映射 SHA-256 不变；例行初始化不会轮换现有身份。
- 新 `loadRelease` 源位置防护：若旧根 HTML 或旧 `content/study-guides` 明文意外返回公开工作路径，直接失败退出。

复核修正了两处失败边界：阅读原稿缺 robots 标签时不能只做替换；构建文件写入失败不能在 CI 原生异常中打印随机路径。相应验证同时覆盖“原稿无标签”与失败日志，而不是只测正常输出。

本地浏览器在实际 1280px／390px 视口核验了单讲 21：没有页面横向溢出，DOM 只有本讲的 `section.lesson`，没有课程目录、上下讲或全课入口；将 hash 改为另一模块仍只有本讲内容。完整课保留 16 讲，选中模块后按钮仍为“复制完整版链接”。Inference 新阅读页没有同级讲义链接或同系列引流，robots/referrer 正确。

通过构建产物预览访问旧 Inference 根路径及原模块 09 的内容源路径，均返回 404。这证明本地产物不再提供相应旧副本，不证明线上 COS／Pages 已经撤回。

剪贴板工具读回最初保留旧会话值；随后通过真实 UI 复验：点击单讲复制按钮，打开完整版总览，在其搜索框使用原生粘贴，再通过 DOM 比较粘贴所得的 84 字符与该单讲 canonical 地址，结果完全一致。单讲复制已通过实际浏览器复制／粘贴验证；本记录不保存真实地址。原生打印／PDF 分页的视觉验收未做；打印事件恢复测试不能替代该验收。预览截图保存在本地研究目录，未作为公开讲义目录或分享链接清单发布。

匿名基础设施检查使用已知 COS 桶的公开端点，发送无凭据 `ListObjects max-keys=1` 请求，结果 **HTTP 403 / AccessDenied**。未输出对象名，也未修改桶权限。这说明该请求不能匿名列举对象，不代表所有历史公开路径已失效。

GitHub API 已确认当前仓库 `visibility: public`、`private: false`、`has_pages: true`。因此加密新源是必要边界；GitHub Pages 的实际旧副本还需正式切换时核验。先前已进入公开 Git 历史的旧写作内容，不能由删除现有文件、改 URL 或重新加密撤销。

## 授权上线前后的具体工作

需要一次审查过的生产切换：配置两个 CI secrets；部署 `teacherHandoutLinks`；先发布并回读 23 份讲义及依赖，再更新 Teacher 入口和公共目录；撤回九个旧根路径以及已发布的明文源副本。旧路径不能重定向到新的随机地址，否则仍可由猜测取得目标。校验 apex／www 域名、缓存与 GitHub Pages；保持无关线上内容不变，发布收据保存在私有目录。

COS 全量同步会在上传成功后删除不在本地产物中的对象，不能拿不完整 staging 或 fixture 执行全量同步。该共享工作区包含其他尚未对齐的改动，应按确认过的范围与线上基线操作。仓库可见性和 Pages 设置属于独立的生产／账号操作，未经明确授权不修改。即使新版本完成上线，也只应报告实际撤回与核验范围，不宣称已消除公开 Git 历史或他人保存的副本。
