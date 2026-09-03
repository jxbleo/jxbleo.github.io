# Mr. Cat Academy 技术变更与重复问题记录

> 这份文档是给人和 Agent 快速排障用的。
> 它不替代 `docs/01_PRODUCT_REQUIREMENTS.md`，也不替代 `AGENTS.md`。
> 它专门记录：做过什么技术变更、哪些问题反复出现、以后看到类似现象应先查哪里。

## 0. 怎么使用这份文档

当出现问题时，先按下面顺序查：

1. 先看“重复出现的问题速查”。
2. 再看“当前开放技术问题”。
3. 如果是历史功能，查“按日期整理的技术变更记录”。
4. 如果要改产品规则，再同步更新 `docs/01_PRODUCT_REQUIREMENTS.md` 和 `AGENTS.md`。

不要在本文档中记录密码、CloudBase 密钥、私有答案、accepted variants、完整 grading key 或长命令输出。

## 1. 重复出现的问题速查

### Speaking 百炼请求成功但报告提示 Schema Invalid

对于 DashScope、百炼 MaaS 等 Qwen 兼容接口，chat-completions 请求必须加入
`enable_thinking: false`。否则请求可能成功，但结构化 DSE JSON 不在纯粹的
`message.content` 中，最终得到 `SPEAKING_AI_SCHEMA_INVALID`。

同时使用百炼 OpenAI 兼容接口接受的 `max_tokens` 输出限制；若发送
`max_completion_tokens`，接口可能忽略它并使用较短默认值，造成四人报告 JSON
在结尾被截断，同样表现为 `SPEAKING_AI_SCHEMA_INVALID`。

### Speaking 声纹录音合格但腾讯仍提示无法保存

先查 `speakingLab` 的安全错误码。如果腾讯返回
`AuthFailure.UnauthorizedOperation`，原因不是录音，而是函数运行角色
`TCB_QcsRole` 缺少 ASR 声纹 CAM 权限。为该角色关联只包含
`VoicePrintEnroll`、`VoicePrintUpdate`、`VoicePrintDelete`、
`VoicePrintVerify`、`VoicePrintGroupVerify`、`VoicePrintCount` 和
`VoicePrintGroupList` 的自定义策略，等待权限传播后再测试。不要要求学生
反复重录，也不要给角色附加整个腾讯云的广泛权限。

### CloudBase 定时触发器快捷命令无法设置自定义入参

`tcb fn trigger create` 当前只接受触发器名称和 Cron 表达式。Learning Reports
还需要私有定时 token，而 SCF 会把定时器的 `CustomArgument` 放进
`event.Message`。应通过官方 SCF `CreateTrigger` API 创建触发器（包含
`CustomArgument`），并把同一个值存入函数专用环境变量
`LEARNING_REPORT_CRON_TOKEN`。不要创建缺少自定义入参的 Cron，否则函数会按预期
拒绝每一次调用。`CreateTrigger` 的响应可能原样回显 `CustomArgument`；配置时应抑制
或脱敏响应，一旦回显到终端或 Agent 记录中就立刻轮换 token。

Speaking Lab 不使用上述旧模式。`speakingAiWorker` 的函数级权限必须为
`{"invoke": false}`，只接受名称为 `speaking-ai-worker-minute` 的标准腾讯
`Timer` 事件。CloudBase 官方说明客户端安全规则不作用于定时触发器，因此无需
`CustomArgument`，也不要为这个 Worker 再设置 `SPEAKING_AI_WORKER_CRON_TOKEN`。

| 现象 | 最常见原因 | 先查哪里 |
| --- | --- | --- |
| 学生提交成功但教师邮箱没有新通知 | outbox 集合/索引未创建、`submitAttempt` 或 dispatcher 未部署、Cron/token/SMTP 未配置、教师个人中心没有启用邮箱，或事件正在 7 分钟 BBC 窗口内 | 先确认个人中心地址为 `Receiving notifications`，再查 `teacher_attempt_email_events` 是否有该 `attempt_id` 及其 `status`/`due_at`/`last_error`/`skip_reason`；用精确 event ID 查函数日志，不输出答案或 SMTP 值 |
| 邮件事件显示 `sent`，但 QQ 和 iCloud 都没有收到 | 旧 dispatcher 只保存本地生成的 Message-ID，无法证明 SMTP 是否接受收件人；CloudBase 实例或出网链路也可能出现瞬时异常 | 查 `smtp_accepted_count`、`smtp_rejected_count`、`smtp_response_code` 和 `smtp_response` 中的 provider queue ID。若没有这些字段，先部署带 SMTP 回执审计的 dispatcher；不要把本地生成的 `provider_message_id` 当成投递凭证 |
| Vocabulary 邮件重复或第二封没有第 1 次记录 | 同一 `event_id` 被重复插入、dispatcher 未事务认领、线程 key/cutoff 规则漂移，或线上仍是旧函数 | 确认事件文档 ID 等于 `attempt_id`、状态只走 pending/processing/sent、第二封 cutoff 为第二次 `submitted_at`，并部署同一源码打包的三个函数 |
| Vocabulary 第 3/4 次提交在铃铛可见但邮箱像是没收到 | 旧 dispatcher 为后续邮件写入 `In-Reply-To` / `References`，邮箱把多次提交折叠进同一会话；主题也可能过于相似 | 部署独立邮件版本的 `sendTeacherAttemptEmails`；确认 Vocabulary 主题带 `Quiz No. n` / `Practice No. n` 且原始邮件无 reply/reference 头。正文仍应累计同一线程此前 attempts |
| BBC 每次重试各发一封，或超过 7 分钟仍没有邮件 | dispatcher 没按第一条 due event 的固定 `window_ends_at` 合并，Cron 没有每分钟运行，或 SMTP 重试改写了原窗口 | 查同一 `thread_key` 的事件；`window_ends_at` 保持原值，只有失败时 `due_at` 可以后移 |
| 页面已经修了，本地正常，线上仍报旧错 | CloudBase 云函数没有重新部署，或静态站点缓存旧 JS | `deploy-packages/*.zip` 是否重建；CloudBase 控制台函数版本；HTML query string |
| Writing 草稿点 Discard 显示 `The AI writing request could not be completed` | 静态页面调用新版 `discardDraftComposition`，但线上 `writingTutor` 仍返回 `UNKNOWN_ACTION`；这是前后端版本不一致，不是作文损坏 | 查 `writingTutor` 日志的 exact code 与函数 Modification time；先部署同一提交的新版函数，再发布 cache-busted Tutor 静态文件。空白遗留稿可优先走 `discardEmptyComposition` |
| 初稿照片上传成功后仍停在原页面，刷新才出现等待游戏 | 前端只保存了排队状态却没有立即渲染 OCR waiting 或启动同一 Composition 的轮询 | 上传 handoff 成功后同步进入 waiting 并立即启动 serialized polling；确认 toolbar Back 可恢复且不要用假的百分比 |
| iPhone/iPad 点击相机或相册选择后没有弹出系统选择器 | `input.click()` 被放在 Promise、定时器或 `requestAnimationFrame` 后，Safari 已撤销用户手势授权 | 先同步渲染对应隐藏 input，再在同一个点击处理函数中直接调用 `input.click()`；保存草稿可并行后台执行 |
| 内页登录后回到错误页面、丢失练习 query/hash，或旧 user/visitor 参数继续传播 | login-navigation.js 未在页面脚本前加载、cache query 不一致，或调用没有传完整当前 URL | 检查页面脚本顺序与 loginHref(window.location.href, fallback)；验证同源根级 HTML、外部目标拒绝和旧身份参数清理；这是静态路由问题，不要先改 CloudBase 数据 |
| 精听进入后只显示空白输入区域，首句没有词位 | 线上 `intensiveListening` 仍是未返回 `practice_mode` 的旧版或函数更新状态为 `Update failed`；首段实际是零词槽的 Skip，旧前端协议把它当 Dictation | 先查函数状态和线上代码是否返回 `practice_mode` / `sequence_count`，再查材料首段模式与词槽数量；部署同一提交生成的最新函数包和静态文件，不要重做 JSON 或删除数据库词槽 |
| 登录 Teacher 显示 `The size of HTTP response body exceeds the upper limit (6MB)` | 旧版 `teacherAdmin.listAttempts` / `listProgress` 一次返回全部历史的逐题答案和 explanation，且 progress 重复嵌套 attempts | 部署轻量摘要与 `getAttemptDetail` 版本的 `teacherAdmin.zip`，并发布最新版 `teacher.html` / `teacher.js`；不需要删除 attempts |
| `tcb hosting deploy` 显示成功，但目标 CSS/JS 的 ETag 仍未改变 | 单文件上传只给目录型 `cloudPath` 时，CLI 可能没有覆盖预期对象键 | 单文件部署时把完整目标键写明，例如本地 `assets/js/dashboard.js` 对应云端 `assets/js/dashboard.js`；随后用 `tcb hosting list <完整键> --json` 对比本地 MD5 与 ETag |
| 练习页面能打开，但提交失败 `GRADING_KEY_NOT_FOUND` | `grading_keys` 没导入对应 `set_id` | CloudBase `grading_keys` 搜索 exact `set_id` |
| 首页或直接 URL 有内容，但学生 Explore / Library 看不到 | `sets` 没导入或 stale | CloudBase `sets` 搜索 exact `set_id`；`getResources` 返回 |
| 教师 Library / Assign 看不到刚新增的静态内容 | 静态站点未发布/缓存旧 `teacher.js`、CloudBase `sets` 未导入、Library/Assign fallback 没合并静态 catalog，或 CloudBase 重复导入后记录数超过云函数读取上限 | 先查 `data/home-catalog.json` 和 `teacher.html` cache version，再查 CloudBase `sets` / `grading_keys`。如果记录存在但 Assign 仍显示 import-required，查 `teacherAdmin.listSets` 读取 limit 和线上函数版本；部署最新 `teacherAdmin.zip` |
| CloudBase 导入显示成功但系统读不到 | 上传了数组 JSON，而不是 JSON Lines | 使用 `.cloudbase-private/import/*-cloudbase.json` |
| 学生账号在 Authentication 里有，但登录后 profile incomplete | Auth user 和 `students.auth_uid` 没正确链接，或写成嵌套 `data` | `students` 文档是否顶层字段；`auth_uid` 是否匹配 |
| 旧学生详情把中英混合姓名整串放在中文行，同时显示 `English name not set` | 旧 profile 只有 `name`，却被前端按中文字符启发式归类 | 部署统一姓名显示版本；显式回填 `chinese_name` / `english_name`，并让后端生成兼容 `name`；不要按空格或字符自动拆分 |
| 学生删除后用相同 Login ID 重建仍报 `STUDENT_ID_EXISTS` | 线上 `teacherAdmin` 仍是旧版，已删除 profile 的 `student_id` 尚未归档释放；或 Authentication 中同名 end user 仍存在 | 部署最新版 `teacherAdmin`；检查 deleted profile 的 `deleted_student_id_snapshot` 与归档 `student_id`；再查 Authentication username |
| CloudBase 文档长成 `{ data: { ... } }` | 错用了 `add({ data: record })` | 所有新增都应 `add(record)` |
| 学生完成后老师端进度仍旧 | `teacherAdmin.listProgress` 聚合逻辑或线上函数版本 stale | `teacherAdmin` 部署版本；assignments/attempts 是否同 assignment_id；是否部署了分页读取和 attempt 兜底版本 |
| 学生同一词汇题先做 96%、后从另一入口做到 100%，学生或教师仍显示 96% | 旧逻辑按 `assignment_id` 隔离 best，或只更新了本次绑定的 assignment | 检查同一 `student_uid + set_id` 的 countable attempts；部署使用共享 Exercise Progress 汇总的 `submitAttempt`、`getDashboard`、`teacherAdmin`，无需改写 attempt 历史 |
| 学生打开共享报告链接却能看到其他学生点评/明细 | 只在前端隐藏 `student_details`，或线上 `learningReports` 仍返回完整 report document | 直接检查学生身份下的函数响应；必须由 `learningReports.getReport` 服务端只投影该学生一条 detail。发布最新函数；不要用 CSS/JS 修补泄露 |
| 报告链接显示 `REPORT_NOT_AVAILABLE` 或空报告 | 报告集合/索引未创建、报告尚为 preview、学生不在 membership snapshot，或线上函数版本不匹配 | 先查 `learning_reports` 的 class/period/status，再查 `class_memberships` 覆盖期和函数部署；不要把 preview 直接公开 |
| 周/月报告少了周末或月末学习 | Timer/浏览器按本地时区计算，或 final snapshot 在 Shanghai cutoff 前写入 | 检查 `period_start`、`period_end`、`snapshot_cutoff_at` 和 timer Cron；必须使用 `Asia/Shanghai`，周日 23:59:59/月末最后一秒后才 final |
| 同一期出现两份报告、点评丢失、或 published 又变回 preview | Timer retry/并发未按 class+period 幂等 upsert，或 preview refresh 覆盖评论 | 查 `class_id + period_type + period_key` 逻辑唯一性、report status transition 和 comment merge；修复后用开发数据重试，不能删历史硬重来 |
| 新入班/转班学生被排在榜尾或不公平参与排名 | 报告只读取当前 `students.class_group`，没有用 membership history 判断完整周期 | 查 `class_memberships.started_at/ended_at` 和 report `membership_snapshot`；部分周期成员应保留个人详情但明确不参与排名 |
| 学生有大量历史记录，但 Calendar 和 Finished 同时为空 | `getDashboard` 超过 CloudBase 执行时限；旧前端又把失败响应吞成空 assignments | 先查 `getDashboard` 日志是否为 `调用失败(433)` / `Invoking task timed out`；部署批量 set 查询版本，将执行超时设为至少 10 秒（建议 15 秒），并发布带 Retry 状态的 Dashboard 静态文件 |
| Personal Center 星星数量正确，但点开来源清单为空 | 静态 Dashboard 已更新但云端 `getDashboard` 仍是未返回 `star_achievements` 的旧版 | 重建并部署 `getDashboard`，发布带最新 cache query 的 `dashboard.html` / `dashboard.js`；不需要迁移 `student_set_achievements` |
| 教师铃铛里第二/第三次 attempt 点不开矩阵弹窗 | 矩阵日期过滤只看 assignment 完成/最新摘要日期，没有把被点击 attempt 的提交日期纳入匹配 | 发布最新版静态 `teacher.js`；查 `matrixItemMatchesDate` 是否同时检查 `progressAttemptsForAssignment(item)` |
| 手机 Teacher View 姓名已缩短但首列仍很宽 | 桌面矩阵 density 存在同一个 localStorage 键中并优先于手机自动 Fit；旧 history 也可能跨断点恢复 density | 发布最新版 `teacher.js` 和 `app.css`；确认手机首次载入 `resolvedMatrixDensityStep()` 为 0，且移动端 Fit 网格使用 `--matrix-student-col-fit` |
| iPad 第一次打开学生 Calendar 时日期数字靠方格上方 | Safari 首次解析 `aspect-ratio` 时仍可能沿用原生 button 行盒/基线，单靠 Grid `place-items` 不稳定 | 发布最新版 `app.css`；确认 `.student-calendar-day` 重置 `appearance`，使用 Flex 双轴居中和 `line-height: 1` |
| iPhone Safari 的 Speaking 报告加载后工具栏像缩到约四分之三，卡片比工具栏宽，整页可左右拖动；Chrome 正常 | 横向 Turn Grid 的 max-content 宽度经 Safari 的 Grid intrinsic sizing 传给外层单列报告，页面缩放低于 100% 时又被 shrink-to-fit 掩盖 | 先把 Safari Page Zoom 还原到 100%确认真实横向溢出；报告 Grid 必须显式使用 `minmax(0,1fr)`，从 detail 到 card 的链路都设 `min-width:0; max-width:100%`，只让 Turn bar 自身 `overflow-x:auto`，并在真实 iPhone Safari 用至少六个 Turns 回归 |
| Teacher View 点击 `Wxx` 没反应，或任务详情的 Edit 不打开参数弹窗 | 先查浏览器控制台是否有 `assignmentMasteryEnabled is not defined`；旧实现会在创建 modal 前调用不存在的函数。其次检查重渲染后的临时 scope 是否丢失 | 发布最新版 `teacher.js`；确认编辑器使用已存在的 `assignmentCanEarnStar`，且按钮携带 `data-assignment-edit-ids` 并从当前 progress 恢复记录。不要用只检查源码字符串的测试代替真实点击测试 |
| 学生铃铛有红色数字但 `THIS WEEK` / `OVERDUE` 都为空 | 旧静态代码仍把所有 `to_do`（包括未来作业）计入红点，或旧 assignment 尚未补齐 `due_at` | 发布最新 Dashboard/Teacher 静态文件与 `getDashboard`/`teacherAdmin`；dry-run `backfillAssignmentDueWeeks`，确认未来任务只在 Upcoming 且不计红点 |
| 学生从 Library 完成已布置任务但老师 View matrix 不统计 | 旧版 `submitAttempt` 把无 `assignment_id` 的提交记为 self-study | 部署最新版 `submitAttempt`；检查 attempt 是否有 assignment_id |
| 学生从 BBC Library 打开已做过的题但 History 显示没有记录 | BBC 页只看 URL 的 `history`/`prefill` 参数，Library 卡片没有传历史 attempt | 部署最新版 `getDashboard` 和静态 `bbc.html`；确认 `getLatestAttemptForSet` 能返回当前学生自己的 attempt |
| My Words 可以普通查词，但 AI Lookup 提示未配置 | 两个云函数缺少一个或多个 `VOCAB_AI_*` 环境变量，或 URL 不是 HTTPS | 同时检查 `studentVocabulary` 与 `teacherAdmin` 的 `VOCAB_AI_API_URL`、`VOCAB_AI_API_KEY`、`VOCAB_AI_MODEL`；不要把密钥放进前端 |
| 学生已确认 AI 草稿，老师 Dictionary 看不到或无法发布 | 新集合未创建、仍非 `ADMINONLY`，或线上 `teacherAdmin` / `studentVocabulary` 版本不一致 | 创建 `vocabulary_lexicon_history`、`vocabulary_dictionary_reports`，部署同一提交打包出的两个 ZIP，并检查 normalized word 当前记录 |
| My Words 时间筛选看起来被后台查词改变 | 旧代码错误使用 `updated_at` 而不是学生活动时间 | 发布最新静态与 `studentVocabulary`；确认筛选优先读取 `activity_updated_at`，后台 enrich 不更新它 |
| My Words 顶部工具栏前有大块空白，Export 时间胶囊被挡住 | 外层 workspace 使用 `overflow: hidden` 成为 sticky 参照容器，工具栏的 `top` 偏移被重复计算 | workspace 使用不创建滚动容器的圆角裁剪；在已登录、feedback 为空时检查工具栏紧贴主导航，并展开 Export 验证全部时间胶囊 |
| My Words 只显示最近 18 个词且滚到底没有继续加载 | 新静态页已发布，但线上 `studentVocabulary` 仍是未返回 `next_cursor` / `has_more` 的旧版 | 从同一提交重建并部署 `studentVocabulary` ZIP；确认分页请求返回 cursor 字段并保持 `student_uid + status + updated_at` 查询索引 |
| BBC History 分数已按 Argue 修正但题目仍显示黄色/错误 | 历史渲染时旧的 `wrong`、blank lock、MC lock class 覆盖了服务器返回的 adjusted correct 状态 | 发布最新版静态 `bbc.html`；查 `markHistoryReview` 是否先清理相反状态再加 `correct/wrong` |
| 完成或 STAR 后无法再次布置 | 当前前后端仍有旧规则阻止 completed | `teacherAdmin.getAssignmentState`、`createAssignments`、`teacher.js candidateStatus` |
| 教师矩阵单格 Edit 或 Wxx 批量无法打开编辑器，或保存后参数不变并提示更新 0 条 | 动态矩阵/独立 modal root 中的按钮失去原容器监听；或旧 assignment 的 stable ID 是文档 `_id`，旧后端却只按 `assignment_id` 字段查询 | 发布使用 delegated edit handler 的静态 `teacher.js`，并部署兼容 stable ID 的最新版 `teacherAdmin`；无需迁移 assignments |
| 已通过作业后来低分后状态异常 | assignment 状态没有单调保护 | `submitAttempt.statusForPercentage` 和 assignment update |
| 学生重复点击提交后 attempts 有多条但 assignment summary 不准 | 旧版 `submitAttempt` 用旧 assignment 快照递增更新 | 部署最新版 `submitAttempt`，它会从 linked attempts 重算 summary |
| Argue 批准后历史匹配答案没有补分或 STAR 没出现 | 批量向上重算没有扫描到同 set/question/submitted answer，或改判流程没有调用 STAR 保护逻辑 | `teacherAdmin.applyAcceptedAnswerToHistoricalAttempts`、`teacherAdmin.improveAttemptForAcceptedAnswer` |
| 老师改过答案后再次导入被覆盖 | 本地 `prepare-cloudbase-data.js` 重新生成 `grading_version: "1"` | 需要 grading key reconcile 流程 |
| `tcb fn code update --dir ...` 对小函数仍报 ZIP 超过 1.5MB，或 COS 60 秒超时 | CloudBase CLI 3.7.0 仍可能按命令的当前工作目录打包；从仓库根目录传绝对 `--dir` 时，实测会把整个仓库和 `.git` 打进 ZIP | 先进入仅含 `index.js`、`package.json` 的函数 bundle 目录，再执行 `tcb fn code update <name> --dir . --deployMode zip`；若失败，检查系统临时目录中的 `.cloudbase_temp_<name>/<name>.zip` 内容，确认没有仓库文件 |
| `teacherAdmin` 更新状态为 `UpdateFailed`，错误为 `LimitExceeded.CodeUnzipSizeLimit`，而前端仍显示普通 Argue 三按钮 | `@cloudbase/manager-node` 顶层入口会把全部管理服务及其依赖打进 bundle；压缩 ZIP 可能小于 1.5 MB，但解压后的代码仍超过 CloudBase 限制，导致新 `dispute_type` 投影没有上线 | 运行 `npm run test:teacheradmin-package`；它会重建仅含 `index.js`/`package.json` 的 ZIP、检查解压体积不超过 1,500,000 bytes，并确认 `intensive_spelling_exemption`、`dispute_type`、`INTENSIVE_DECISION_REQUIRED` 业务标记都在产物中。仅上传该 ZIP；不要点击旧版三按钮，也不要改数据库记录 |
| `speakingLab` 的 COS 上传显示完成，但函数随后为 `UpdateFailed` / `LimitExceeded.CodeUnzip` | COS 上传成功只代表传输完成，不代表函数发布成功；把 `@cloudbase/node-sdk` 留给云端自动安装仍会把完整依赖树计入同一个解压体积上限 | 以函数详情的 `Status`、`AvailableStatus` 和 `StatusReasons` 为准。使用项目打包器保留所需 SDK 路径并只移除 Speaking 未使用的 AI/model 与 WeChat-client 分支；确认 ZIP 仅含 `index.js`/`package.json`、依赖为空、`InstallDependency=FALSE`。失败时旧版本通常仍可用，不要把传输成功误报为上线成功 |
| Speaking Lab 选择音频后按钮持续旋转，或出现红色 `Upload complete` / `Upload information is incomplete.` | 旧链路把临时 COS 凭据交给浏览器手工 `PUT`；传输失败时资产会停在 `uploading`，`file_id` 为空且 Storage 没有对应对象，页面也没有传输超时 | 发布配套的 `speakingLab` 与缓存更新后的静态资源。新链路只返回服务器保留的 `cloud_path`，使用已登录 CloudBase SDK 上传，再把 SDK 的 `fileID` 交给服务器做精确路径与实际大小校验；十分钟后必须退出忙碌态并允许重试。不要恢复或记录 URL/token/authorization |
| 已登录 Speaking Lab 一直停在 `Loading your Discussions…`，且 `speakingLab` 云日志没有任何对应调用 | 页面通过 `getSession()` 后仍并发发出 Voiceprint/Discussion 两个 SDK 请求；即使不再重复登录预检，并发初始化临时凭据仍可能让两个请求都悬空 | 发布最新版 `speaking-lab.js` 与缓存版本。页面只在启动时完成一次 `getSession()`，后续直接调用仍会在服务器验证 UID/角色的 `speakingLab`；首屏读取必须按 Voiceprint → Discussion 顺序执行并设置读取超时。刷新后确认状态收敛并有云日志，不要靠放宽函数或数据库权限绕过 |
| STAR migration apply 在 10 秒处报 `FUNCTIONS_TIME_LIMIT_EXCEEDED` | `teacherAdmin` 可能在超时前已经完成部分幂等 ledger/achievement 写入 | 不要假定整批回滚，也不要盲目连续 apply；先重新运行 `migrateStarRewards` dry-run，只有 pending count 非零时才再次 apply，最后确认两个 pending count 都为 0 |
| `tcb fn log` 报底层日志接口已下线 | CloudBase CLI 3.7.0 的旧函数日志命令仍调用已废弃接口 | 改用 `tcb logs search -e <env> -q 'function_name:"<name>"' -t 30m --json`；涉及学生数据时增加精确关键词并只输出必要汇总字段 |
| BBC 填空输入框后面多出下划线 | 数据里用了 6 个或更多 `_` | 扫描 `data/BBC-*.json` 的 `_{6,}` |
| Vocabulary Learn 模式 Check Answers 弹 `NO_GRADED_QUESTIONS` | `grading_keys.answers` 为空，或页面提交的 `questionKey` 和私有答案 key 不匹配 | 查 CloudBase / `.cloudbase-private/import/grading-keys-cloudbase.json` 中对应 `set_id` 的 `answers`；重新运行 `node scripts/prepare-cloudbase-data.js`，必要时用 `cloudbase:import:content -- --only grading_keys --ids <set_id> --overwrite-existing` 修复已存在的空 grading key |
| Vocabulary 本地直接打开加载失败 | `fetch` 被 file:// 限制，缺 JS fallback 或本地 server | `content/vocabulary/*.js` fallback；用本地 HTTP server |
| Vocabulary Test 做到一半弹 `Quiz interrupted` / `Network request error` | 旧前端把单次 CloudBase heartbeat 网络错误当成致命错误，或新前端已连续 60 秒无法恢复 | 发布最新版 `vocabulary.html` 与四个 session-aware 云函数；确认页面先显示 reconnecting 并按 2/5/10 秒节奏重试，服务器 timeout 为 60 秒；切换 App/页签仍会按规则立即中断 |
| Vocabulary Quiz 第一次提交报 `VOCABULARY_TEST_SESSION_MISMATCH`，关闭重做后成功 | 旧 `submitAttempt` 在开考与提交时分别自动选择开放 assignment；重复开放记录、相同 due week、Quiz 期间新增任务或旧草稿可能让两次选择不同 | 部署锁定 assignment 的最新版 `submitAttempt` 和 `vocabulary.html`；提交必须读取 session 的 `assignment_id` / `assignment_doc_id`，不要删除 attempts 或让学生反复刷新 |
| Vocabulary Quiz/Practice 提交提示 `null is not an object (evaluating 't.scope')` | CloudBase JS SDK 2.28.6 在临时凭据为空时先读取 `credentials.scope`，请求尚未到达 `submitAttempt`；网络切换、Safari 恢复页面、登录凭据刷新窗口都可能触发 | 发布统一使用 SDK 2.32.0 和最新版 `cloudbase-client.js` / `vocabulary.html` 的静态站点，并部署最新版 `submitAttempt`。只允许重试只读登录预检，不能自动重开 Quiz 或盲目重发写请求；用 `client_submission_id` 的稳定 attempt 文档 ID 处理响应丢失后的重放 |
| Git push 超时或失败 | 网络或 GitHub HTTPS 问题，不一定本地提交失败 | 先查 `git log`、`git status`、`rev-parse HEAD origin/main`；获 owner 明确授权后，在干净 release worktree 运行 `npm run publish:github`，只让验证过的 Git Data API fallback 处理网络失败 |
| 多个 Codex 窗口互相影响 | 同一工作树存在 unrelated dirty files | 每次先 `git status --short`；只 stage 当前任务文件 |

## 2. 当前开放技术问题

这些不是全部 bug，而是最值得下次优先处理的技术点。

### P0：assignment 状态必须单调（源码已修复，待部署验证）

已改动：

- `submitAttempt` 已把本次 attempt status 和 assignment status 分开。
- assignment status 使用 `to_do -> passed -> mastered` 单调更新。

仍需验证：

- 部署 `submitAttempt` 后，已 passed 作业低分重试仍留在 FINISHED。
- latest attempt 显示低分，best / completed status 不被撤销。

### P0：完成后允许重新布置（源码已修复，待部署验证）

已改动：

- `teacherAdmin.getAssignmentState` 只把 `not_done` / `failed` / `to_do` 视为开放作业。
- `teacherAdmin.createAssignments` 不再跳过 completed 历史。
- `teacher.js` completed / STAR candidate 改为可选。

仍需验证：

- 部署 `teacherAdmin` 和静态站点后，完成过同一 set 的学生可被再次布置。
- 新布置生成新的 `assignment_id`，旧 attempts 保留。

### P0：Argue 改判后补 STAR（源码已修复，待部署验证）

已改动：

- `teacherAdmin.improveDisputedAttempt` 在改判达到 mastery 时会调用 STAR 保护逻辑。
- assignment attempt 创建 / 修复 assignment STAR。
- self-study attempt 创建 / 修复 self-study STAR。

仍需验证：

- 部署 `teacherAdmin` 后，用开发 dispute 验证 grading key、attempt、assignment、STAR 一起更新。
- teacher-originated dispute 没有 `attempt_id` 时仍只改未来评分规则。

### P1：统一后端 shared 规则

当前风险：

- passing / mastery / status / STAR 逻辑分散在多个云函数里。

目标：

- 新增 `cloudfunctions/_shared/`，集中 `auth`、`grading`、`assignment-state`、`stars`、`disputes`。

### P1：grading key reconcile

当前风险：

- 本地内容导入可能覆盖 CloudBase 中老师已批准的答案修正。

目标：

- 后续导入前对比线上 `grading_keys` / `grading_key_history`。
- 不盲目覆盖高版本 grading key。

### P1：轻量 smoke tests

当前风险：

- 现在主要靠人工和线上测试发现后端规则回归。

目标：

- 加一个不依赖真实 CloudBase 的规则测试脚本。
- 至少覆盖状态单调、reassign、STAR、Argue、Vocabulary 计分边界。

### P1：Learning Reports V1 的定时、成员和泄露防护

当前风险：

- 班级迁移、自然周/月边界、定时器重试和同一链接的角色投影会同时影响公平性与学生隐私。
- 普通微信群的便利性容易误导实现为公开静态报告或非官方个人微信机器人。

目标：

- 以 `classes` / `class_memberships` 取代 report scope 对 `class_group` 的依赖，并只允许一个 active membership。
- 对 `class_id + period_type + period_key` 做幂等生成/发布，保存 preview 评论，保留 published 审计快照。
- 为 `learningReports` 添加响应级 redaction 测试、Shanghai 边界/部分成员测试和 CloudBase timer 失败监控。
- 保持普通微信群为人工复制发送；未获 owner 新授权前不接入个人微信 RPA。

## 3. 按日期整理的技术变更记录

### 2026-08-19：全站主屏幕图标统一

- 所有根级 HTML 统一声明同一套猫脸 favicon、Apple touch icon 和 `site.webmanifest`。
- manifest 不再按 `curriculum_track` 切换；DSE / IELTS 只作为课程字段显示，不再携带品牌图片。
- 同一原图导出 32 / 180 / 192 / 512 / 1024 尺寸是设备适配，不代表多套图标。
- 替换图标后需重新发布静态站点；已经添加到主屏幕的设备可能仍保留系统缓存，必要时删除旧快捷方式后重新添加。

### 2026-08-01：STAR 钱包、Cash 凭证与部署边界

- 黄色 STAR 成就与可兑换余额是两个概念：成就记录不减，available balance 由
  `star_reward_ledger` 的 append-only delta 投影。
- 蓝色 STAR 稳定但不可兑换；新黄色 STAR 每 student + set 唯一，旧的合法重复
  黄色 STAR 继续保留并产生 credit。
- Cash 创建必须在 transaction 中锁定具体 achievement IDs；不要只保存一个数字，
  否则并发请求会重复花同一颗 STAR。
- Evidence Photo 不能通过 Cloud Function JSON 传 10 MB base64。先由后端签发
  request-scoped upload metadata，浏览器直传私有 Storage，再由后端校验并登记。
- 图片查看只返回短期 URL；不要把 bucket 改成 public，也不要把临时 URL保存到
  数据库。
- 必须先建三个新 ADMINONLY collection 和 indexes，再部署函数，最后发布静态前端。
  少任一 collection 时 Cash 应显示不可用，而不能让整个学习 Dashboard 假空白。
- 老师确认、拒绝、学生取消、过期与 Refund 都必须幂等。重复点击或函数重试不能
  重复扣除、释放或返还余额。

### 2026-07-31：Teacher View 参数弹窗真实点击修复

已做：

- 修复 `openAssignmentEditDialog` 调用未定义
  `assignmentMasteryEnabled` 导致 modal 创建前抛出 `ReferenceError` 的问题，
  统一复用矩阵已有的 `assignmentCanEarnStar` 兼容规则。
- Wxx 与单任务 Edit 按钮写入稳定 assignment ID；点击时从最新
  `progressItems` / `assignments` 恢复编辑对象，不再只依赖渲染期间的
  `assignmentEditScopes`。
- 单元测试执行真实 delegated click handler，并断言 DOM 中实际新增
  `.assignment-edit-overlay`；同时模拟 scope 被清空和旧记录只有文档 ID。

重复问题：

- “监听器存在”和“源码包含某个函数名”不能证明弹窗可打开。此类 bug 必须让
  测试执行从点击到 modal 创建的完整同步路径，否则运行时 `ReferenceError`
  仍会被漏掉。
- 如果按钮要求多个 assignment ID，而当前数据只能恢复其中一部分，编辑器应
  明确提示刷新，不能静默对部分学生保存。

部署/数据：

- 仅需发布静态 `teacher.html` / `assets/js/teacher.js`；不需要部署 CloudBase
  函数或迁移数据。

### 2026-07-26：学生大量历史记录导致 Dashboard 假空白

现象：

- 数据库中 assignments、attempts 和 STAR 都存在，但学生 Calendar 与
  Finished 同时为空。
- CloudBase 日志间歇出现 `调用失败(433)`，详情为
  `Invoking task timed out after 3 seconds`。

原因：

- `getDashboard` 原来先串行读取学生集合，再对每个历史 `set_id` 单独查询
  `sets`。历史 set 较多时，冷启动或数据库延迟会越过三秒限制。
- `dashboard.js` 捕获调用失败后返回空 `assignments`，把后端错误伪装成
  “账号没有记录”。

修复：

- assignments、attempts、answer disputes 和 achievements 改为并行读取。
- visible set metadata 改为按最多 100 个 `set_id` 分块批量读取。
- 学生端失败时显示 `Unable to load the dashboard`、`UNAVAILABLE` 和 Retry。
- `npm run test:assignment-schedule` 用 60 个 distinct historical sets 验证
  全部记录返回且只执行一次批量 sets 读取。

部署：

- 发布 Dashboard 静态文件并部署新版 `getDashboard.zip`。
- CloudBase `getDashboard` 执行超时至少设为 10 秒，建议 15 秒。
- 不需要数据库迁移或内容导入。

### 2026-06-20：BBC Assign 显示 Import to CloudBase

已确认：

- `BBC-250529`、`BBC-250605`、`BBC-250612` 已经存在于 CloudBase
  `sets` 和 `grading_keys`。
- 控制台重复导入后，开发环境已有 395 条 visible `sets` 和 411 条
  `grading_keys`。
- 旧版 `teacherAdmin.listSets` 只读取前 200 条 visible `sets`，导致这三篇
  虽然已导入，但没有返回给教师 Assign。
- 前端因此只能从静态 catalog 兜底看到它们，并显示
  `Import to CloudBase`。

修复：

- `teacherAdmin` 的教师端内容读取上限提高到 1000。
- 已重建并部署 `deploy-packages/teacherAdmin.zip` 后，三篇 BBC 可正常布置。

以后遇到同类问题先查：

- Library 能看见但 Assign 显示 import-required 时，不要马上重复导入。
- 先查 CloudBase 是否已有顶层 `set_id` 和 `visible: true`。
- 如果记录存在，再查线上 `teacherAdmin` 是否是最新版，以及
  `listSets` / `grading_keys` 读取 limit 是否足够。
- 大量重复导入会让集合记录数快速超过旧读取上限，后续应规划安全去重。

### 2026-06-16：后端 P0 架构修复

已做：

- `submitAttempt` 增加 student role guard。
- `submitAttempt` 将本次 attempt status 和 assignment status 分离，避免低分重试降级已完成 assignment。
- `getDashboard` 增加 student role guard。
- `teacherAdmin` 允许 completed / passed / mastered 历史重新布置，只阻止开放中的同 set assignment。
- `teacherAdmin` 在 Argue 改判达到 mastery 时创建或修复 STAR。
- `teacher.js` 将 completed / STAR assignment candidates 改为可再次选择。

技术规则：

- assignment status 单调：`to_do -> passed -> mastered`。
- latest attempt 可以低于 passing，但 completed assignment 不能回到 `to_do`。
- completed / STAR 历史不阻止新 assignment。
- teacher-originated dispute 没有 `attempt_id` 时，`add`/`replace` 仍会触发匹配历史 attempt 的向上重算。
- 旧的已批准 grading key 变更不会在部署时自动重跑；如需修复历史分数，用教师登录态分页执行
  `teacherAdmin.backfillAcceptedAnswerRegrades`。

部署/数据：

- 需要部署 `deploy-packages/submitAttempt.zip`、`deploy-packages/getDashboard.zip`、`deploy-packages/teacherAdmin.zip`。
- 需要发布静态站点，让 `assets/js/teacher.js` 生效。
- 历史 Argue 成绩修复是 owner-gated 数据 backfill，不是部署自动迁移。

### 2026-06-16：人类可读产品需求文档

新增：

- `docs/01_PRODUCT_REQUIREMENTS.md`

目的：

- 把产品目标、数据流、后端架构、核心业务规则和待修后端问题整理成给人看的文档。

技术重点：

- 明确当前系统是轻量 LMS，不是单纯静态做题页。
- 明确后端最重要的是身份、评分、不可变 attempts、assignment 状态、STAR、Argue 和 grading key 私有化。
- 记录了 P0/P1 架构问题：状态单调、重新布置、Argue STAR、role guard、shared backend、grading key reconcile。

### 2026-06-16：学生图标、个人资料、移动端作业卡片、My Words 选择保护

已做：

- DSE / IELTS app icon assets。
- dashboard 根据 `curriculum_track` 切换 manifest / home-screen icon。
- teacher profile class/system 标签可编辑。
- Assignment/Library capsule 不再显示 `Go` 按钮；整张胶囊负责打开练习，内部独立按钮只保留 Teacher replies / Get Star 等例外动作。
- My Words 禁止从答案、解析、反馈、结果、teacher reply、review answer 等区域保存。

重复问题：

- 静态资源改动后必须 bump cache version，否则移动设备和 GitHub Pages 可能继续用旧 JS/icon。

### 2026-06-16：IELTS Listening teacher preview 音频启动

已做：

- `teacher=1` 不再跳过共享 `Start Audio` 确认流程。
- teacher Library practice link 带 public app version，避免打开旧缓存页面。

重复问题：

- 音频播放问题常常不是文件缺失，而是浏览器用户手势、touch/click 双触发或 teacher mode 分支导致状态机错乱。

### 2026-06-16：NAWL 静态验证

已做：

- 验证 NAWL units 的 JSON / JS fallback 可解析。
- 验证静态 home catalog 包含对应内容。
- 验证本地可渲染 NAWL 最后一组。

重复问题：

- 静态 catalog 有内容不代表 CloudBase `sets` / `grading_keys` 已导入。
- Authenticated Library / Explore 缺内容时，先查 CloudBase `sets`。

### 2026-06-15：Personal My Words 功能

已做：

- 新增 `studentVocabulary` 云函数。
- 新增 shared selection UI。
- Dashboard 新增 My Words panel。
- 部署包已生成。

技术规则：

- 个人词汇数据属于 `student_vocabulary_items`。
- 所有权来自 authenticated `auth_uid`。
- visitor 和 teacher preview 不能保存。
- 重复保存同一 normalized text 增加次数，不创建重复记录。

重复问题：

- 不要把个人词汇写进 attempts、assignments 或 grading_keys。

### 2026-06-15：开发环境端到端 QA

已验证：

- 老师给测试学生布置 BBC。
- 学生从 dashboard 打开并提交。
- 学生 dashboard 从 TO DO 移动到 FINISHED。
- teacher preview Show Answers 在有效老师会话下工作。

注意：

- 这类测试创建开发数据，但不要记录密码。

### 2026-06-15：Dashboard 状态模型确认

已确认：

- 学生端当前是两个分组：`TO DO` 和 `FINISHED`。
- 后端保留 `to_do`、`passed`、`mastered`。
- 前端合并 `passed` / `mastered` 为 FINISHED。

重复问题：

- 不要把学生 dashboard 改回 `PASSED` / `MASTERED` 三卡，除非 owner 明确要求。

### 2026-06-13：BBC 六七月内容导入经验

已做：

- 从老师 BBC Markdown 生成 5 个 BBC listening sets。
- 生成网站数据、metadata、音频引用、CloudBase import 数据。

重复问题：

- BBC review draft 要先给老师看，放仓库外，不能把答案草稿提交。
- Evidence 使用 Markdown 行号，例如 `L23-L25`。
- BBC blanks 必须使用正好五个下划线 `_____`。
- 新 BBC 上线需要三件事都完成：静态数据、CloudBase `sets`、CloudBase `grading_keys`。
- `GRADING_KEY_NOT_FOUND` 先查 `grading_keys`，不要先改页面。

### 2026-06-13：CloudBase 导入格式

确认规则：

- CloudBase console 导入 nested data 时用 JSON Lines。
- 使用 `.cloudbase-private/import/*-cloudbase.json`。
- 不要上传 array-form backup JSON。
- `grading_keys` 不适合 CSV，因为 answers / explanations 是嵌套结构。

重复问题：

- 控制台显示 records succeeded 但临时文件清理失败，通常导入已经成功。

### 2026-06-13：跨会话 Git 和部署经验

确认规则：

- 多个 Codex 窗口可能同时改同一 repo。
- 每次 staging 前必须 `git status --short --branch`。
- 只 stage 当前任务文件。
- `.DS_Store` 常常是无关修改，不要 stage。
- `deploy-packages/` ignored，但函数部署仍然需要重建 ZIP。

重复问题：

- GitHub push 失败或 timeout 不代表本地 commit 丢了。
- 先查本地 log 和远端 hash，确认是否已经推上去。
- 不要无限重试卡住的 HTTPS Push。owner 已授权发布时，运行
  `npm run publish:github`；它只在网络错误时走 API，并校验 Blob、
  Tree、远端父提交和非强制 ref update。

### 2026-06-13：Vocabulary 维护经验

确认规则：

- `vocabulary.html` 优先 fetch JSON，但 file:// 可能失败。
- 每个 vocabulary unit 需要 `.json` 和 `.js` fallback。
- `data/home-catalog.json` 和 `data/home-catalog.js` 要同步。
- NGSL 和 NAWL 是两套独立词库编号。NAWL 不接在 NGSL 的末尾继续按
  字母排，而是从 `NAWL-A` 开始，对应 NAWL `1-100`。
- Test mode 不显示原始组号或 Words 范围，避免学生对照 Learn mode 找答案。
- 是否计入完成由模式决定，不由 Practice 选择的组数决定：计时 Practice 无论选择
  多少组都只记录教师通知用 activity attempt，不计入学生完成或进度；只有 Quiz
  attempt 可计入成绩。当前 Quiz UI 从 5 组开始，Learn inline practice 完全不记录。

重复问题：

- 词汇 JSON/JS fallback 任一缺失，某些打开方式会加载失败。
- 词库字段含义不能乱映射，例如 word forms 不是 simple definition。

### 2026-06-13：CloudBase 函数 stale 问题

确认规则：

- GitHub Pages 更新不等于 CloudBase 函数更新。
- 如果浏览器报一个本地已修复的后端错误，先查 CloudBase 控制台函数是否仍是旧代码。
- 修改函数源码后要重建对应 `deploy-packages/*.zip` 并部署。

重复问题：

- “不可能还报这个错”时，优先怀疑线上函数版本 stale。

### 2026-06-18：NGSL/NAWL DOCX 词汇源 QA

确认规则：

- 同一批 NGSL/NAWL `.docx` 词汇源可能来自同一生成流程，问题会重复出现。
- 导入前先机械抽取词表、Quiz groups、答案解析；不要只靠肉眼翻 Word。
- 每份通常应是 100 个连续编号词、10 组、100 题、100 个答案。
- 检查同一单元内重复词。重复词会污染 `set_id` 下的稳定编号和复习记录，
  除非 owner 明确确认，否则不要直接导入。
- 检查题干是否泄露答案，例如题干其他位置已经出现目标词。
- 检查题干语法是否要求复数、过去式、三单形式或固定搭配。当前前端是从
  Word Bank 选答案，选项和 grading answer 必须与题干自然匹配。
- 如果要保持 base word 答案，优先改题干；如果题干必须保留变形答案，
  Word Bank 也要显示相同变形。
- 检查答案解析里是否出现错误搭配说明，例如把直接接宾语的动词写成错误
  介词搭配。
- Word Forms 列不要当作 `simpleDefinition`；可疑派生词要清理或省略。

重复问题：

- 有些文件没有单独的“答案解析”标题，而是题目 10 组结束后再次从“第一组”
  开始写解析。解析脚本应把第 11 个组标题视为答案区起点。
- D/E/F/I/J 批次里出现过：重复词、题干时态不合、三单/复数不合、答案词
  在题干里重复出现、Word Forms 里有不自然派生词。

### 2026-06-13：新增集合部署顺序

确认规则：

- 新代码读取新集合前，CloudBase 要先创建集合并设为 `ADMINONLY`。
- STAR / Argue 相关集合包括 `student_set_achievements`、`answer_disputes`、`grading_key_history`。
- Personal Vocabulary 需要 `student_vocabulary_items`。

重复问题：

- 静态前端先发布，而集合还没建，会让页面或函数看起来像 JS bug。

### 2026-06-13：直接数据库 add 规则

确认规则：

- `@cloudbase/node-sdk` 新增文档使用 `add(record)`。
- 不使用 `add({ data: record })`。

重复问题：

- 一旦出现 `{ data: { ... } }` 嵌套文档，profile lookup、assignment query、student rows 都可能异常。

### 2026-06-13：Auth 和 profile linking

确认规则：

- 一个可用学生账号必须同时有 CloudBase Authentication user 和 `students` profile。
- `students.auth_uid` 必须匹配 Auth user ID。
- `student_id` 是登录 ID，不是权限 ID。
- 创建学生必须同时检查 Auth username 和 `students.student_id`。

重复问题：

- Authentication 里看得到用户，不代表 app 能登录并加载 profile。

### 2026-06-13：Argue 和历史答案

确认规则：

- 历史 review 默认不能返回 correct answer / explanation。
- 老师批准 `add` / `replace` 要更新 private `grading_keys` 并写 `grading_key_history`。
- 老师批准 `add` / `replace` 后要扫描同 set 历史 attempts。
- 只向上重评同 question_id 且 submitted answer 匹配新 accepted answer 的历史 attempt。
- 不降低任何历史 attempt、assignment 状态或 STAR。
- 对早于自动重算功能的旧记录，使用 `backfillAcceptedAnswerRegrades`
  分批按当前 `grading_keys` 补算。

重复问题：

- 不要把老师修正后的答案写回 public runtime JSON。
- 未来导入必须考虑线上 grading key 已被老师修过。

### 2026-06-12：Teacher Argue Enhancement

已做：

- `teacherAdmin.listDisputes` 返回 explanation、assignment_id、updated_at、question_text_snapshot 等字段。
- `getDashboard.submitDispute` 支持存 `question_text_snapshot`。
- teacher UI 把争议请求按学生 assignment / attempt 分组成任务 capsule。

待注意：

- 新 dispute 要尽量从 practice runtime 传 durable `question_text`。
- teacher-originated dispute 可以没有 attempt，但 `add`/`replace` 仍应触发匹配历史 attempt 的向上重算。

### 2026-06-12：Assignment Mastery Model

已做：

- assignment status 改为 `to_do`、`passed`、`mastered`。
- 当前通用默认 passing 50%，mastery 90%；Vocabulary 默认 90% / 100%，BBC
  默认 80% / 95%（已取代本节最初记录的 Vocabulary 80% 规则）。
- assignment 和 set 均可覆盖阈值。
- reveal answers 可设置 `answer_revealed` / `mastery_locked`。
- STAR 改为后端记录。

重复问题：

- 文档和代码里仍可能残留 `done` / `failed` / `not_done` 老词。
- 改相关逻辑前必须先确认当前状态机。

### 2026-06-12：Teacher Library、Thresholds、Stars、Curriculum

已做：

- teacher Library 打开现有 practice pages 的 `teacher=1` 模式。
- teacher Show Answers 使用 `teacherAdmin.getAnswerKeyForSet`。
- 布置作业可设置 passing / mastery。
- 学生 profile 增加 `curriculum_track`。
- `changePassword` 改为真实云函数。

重复问题：

- teacher answer reveal 和 student answer reveal 是两条路径。
- teacher preview 不能调用 student reveal 或锁 mastery。

### 2026-07-15：Teacher View Back 与私人设备缓存

已做：

- Teacher View / Library 进入练习前把筛选、展开分组和嵌套滚动锚点写入
  `history.state`，并保留同标签页 fallback；返回不再新建一个空白 Teacher
  现场。
- IndexedDB 只缓存去除 attempts/答案后的教师工作区摘要，live CloudBase
  自动刷新后覆盖缓存，登出删除该账号缓存。

重复问题：

- 如果 Back 回到正确 View 但位置仍跳动，先区分 bfcache 命中与普通历史
  reload，再检查 `history.state.mrcatTeacherWorkspace`、矩阵列的稳定 anchor 和
  分组 anchor 是否仍存在。
- 普通 reload 会依次经历缓存渲染、分阶段 live 渲染和完整 live 渲染；不要在
  第一次缓存渲染后就清除待恢复的 viewport snapshot。应在完整 live 渲染恢复
  之后才 finalize，否则后续渲染可能把 fallback 的矩阵横向位置重置为 0。
- 如果缓存首屏有答案或解析，立即检查 `sanitizedProgressForTeacherCache`；
  IndexedDB 不得保存 nested attempts、submitted/correct answers 或 grading key。
- 如果静态发布后仍运行旧返回逻辑，先检查 `teacher.html` 的 `teacher.js`
  cache-version query。

部署/数据：

- 这是静态前端改动；不需要部署 CloudBase 函数或导入数据。

## 4. 技术规则最终版备忘

### 4.1 当前后端状态词

当前目标状态：

- `to_do`
- `passed`
- `mastered`

历史兼容词：

- `not_done`
- `failed`
- `done`

新代码应使用当前状态词。历史兼容只用于读取旧数据，不应继续扩散。

### 4.2 当前 Dashboard 展示词

学生端展示：

- `TO DO`
- `FINISHED`

后端 `passed` 和 `mastered` 都属于 FINISHED。

### 4.3 当前 STAR 模型

assignment STAR：

- keyed by `assignment_id`
- `source: "assignment_claim"`

self-study STAR：

- `assignment_id: null`
- `source: "self_study"` 或兼容 `"explore"`

STAR 不阻止未来重新布置同一个 set。

### 4.4 当前反馈策略

默认：

- 未 passing：不显示完整答案
- passing 后：学生可选择 reveal answers
- reveal answers 后：如果未 mastered，则 mastery locked
- mastered 后 reveal 不撤销 mastery

### 4.5 当前内容导入边界

公开：

- passage / transcript
- questions
- choices
- public metadata

私有：

- answers
- accepted variants
- explanations
- evidence
- scoring rules

## 5. 下次 Agent 看到这些现象时先别急着改页面

1. 练习能打开但不能评分：先查 CloudBase `grading_keys`。
2. Library 缺内容：先查 CloudBase `sets`。
3. 老师端行为和本地代码不一致：先查 CloudBase 函数是否部署。
4. 学生 profile 异常：先查 Auth user 和 `students.auth_uid`。
5. 完成/STAR 后不能重布置：这是已知规则冲突，查 `teacherAdmin` 和 `teacher.js`。
6. 低分重试影响已完成状态：查 assignment 状态单调逻辑。
7. Argue 批准后没有补历史分或 STAR：查批量向上重算和改判后 STAR 修复。
8. 新词汇打不开：查 JSON/JS fallback 和 local server。
9. BBC 输入框下划线异常：查 `_____` 数量。
10. 修改没生效：查 cache version、GitHub Pages 缓存、CloudBase 函数版本。
11. Library 出现两个重复胶囊：检查两个 set 是否共享完全相同的 `edition_family`，并重新构建目录。
12. 版本按钮没有成绩：检查 `getDashboard.library_progress` 与具体 `set_id` 是否一致。
13. 新版能看但不能提交：检查新版 `sets`、`grading_keys` 和可选 `content_version` 是否全部一致。
14. 旧报告显示新版答案：教师报告必须优先使用 Attempt 内的答案、解释和题目文字快照。
15. AI Tutor 拍照后一直显示云端处理中：先查 `writingTutor` 的函数详情而不只看部署命令输出。
    若状态是 `UpdateFailed`、`ResourceNotFound.Entryfile`，说明所谓部署成功并未成为活动版本；
    必须用 `scripts/package-cloudfunctions.js` 生成的 ZIP 更新，并再次确认最终状态是 `Active`。
    活动版本应立即创建 `writing_ai_jobs`，由 `writingAiWorker` 恢复队列/过期租约；浏览器只轮询
    Composition。若模型日志为 `$ must be an object`，检查国内模型的多页数组归一化，不要让学生
    更换写作评估模型名。
 16. AI Tutor OCR 成功但点击开始批改出现 Network error：检查线上 `writingTutor` 是否仍在请求内同步调用
    模型。正式评估必须创建 `job_type: review` 的持久任务并立即返回；浏览器应轮询 Composition，
    最终失败才释放配额。只提高网页超时时间不能解决关闭浏览器后的恢复问题。
    若错误为 `WRITING_AI_SENTENCE_ALIGNMENT_FAILED`，先确认是否只有模型回显的 original 空格或标点变化；
    服务器应按稳定 sentence ID 填回权威原句，只对缺失、重复或未知 ID 判定对齐失败。
 17. Sentence Revision 点击 `Check` 后出现 Network error：不要只提高 Web SDK 或函数超时。
    `submitRewrites` 必须把输入暂存到 Composition 的 `pending_rewrite_check`、创建元数据-only
    rewrite job 并立即返回；浏览器轮询 Composition，关闭或重新登录后恢复同一 operation/job。
    若千问已经完成但首次保存失败并出现 `PathNotViable`，检查是否在
    `rewrite_results: null` 上执行了普通嵌套 `update()`；必须以 `db.command.set(...)` 原子替换
    整个 `rewrite_results`，并在当前 lease/active-job 事务中清除 staged payload。相同 operation ID
    在 queued、processing 和 succeeded 状态都不能再次调用模型。
 18. Sentence Revision 刷新后丢失输入或正反面同时出现：先分别检查两层草稿和卡片状态，不要把
    它们当成同一个问题。输入时必须按 student/Composition/revision/sentence 保存浏览器本地草稿；
    `Check` 后必须同时保留本地草稿和 Composition 的 `pending_rewrite_check`，只有结果成功发布才
    清理。网络断开、provider 失败或页面刷新不得清空。双面卡片的 inactive face 必须真正 hidden/
    inert，而不是只靠视觉旋转；键盘切换和 reduced-motion 也必须走同一互斥状态。
 19. Language Review 把带引号的一句拆成两张卡片，且两张卡片都建议互相合并：先检查服务器
    `sentenceUnits`，不要归因于模型自由断句。模型收到的是已经分配好稳定 ID 的数组。确认引号内多个
    句末标点和 `?” and...` / `?” he asked...` 已被确定性合并，同时段落空行仍是硬边界；补测
    弯/直单双引号、所有格撇号和英寸符号。不要只改提示词隐藏“合并”建议。

## 6. 维护规则

以后每次完成比较重要的技术改动时，在这里加一条短记录：

```text
### YYYY-MM-DD：标题

已做：
- ...

技术规则：
- ...

重复问题：
- ...

部署/数据：
- ...
```

如果只是普通 UI 小修，不一定要写这里；如果涉及 CloudBase、数据结构、评分、作业、STAR、Argue、导入、缓存、部署，就应该记录。

### 2026-08-15：GitHub 到上海 COS 的首次全量上传反复超时

已做：
- 静态发布改为先列出 COS 现有对象，再只上传变化对象；失败重跑会保留并跳过已成功文件。
- 5 MB 及以上文件使用 1 MB 分片的显式 multipart 上传，降低海外 GitHub runner 到上海 COS 的单连接风险。
- 小文件继续用 ETag/MD5 判断变化；multipart 大文件改用对象字节数判断，避免 COS 列表 ETag 与本地 S3 风格 multipart ETag 不一致而重复上传。

技术规则：
- 只有全部上传成功后才删除 `dist/` 中已经不存在的远端对象。
- 正常增量发布使用 90 分钟上限；同一生产发布组只保留最新运行。

重复问题：
- 若日志出现 `UserNetworkTooSlow`，先直接重跑；不要清空存储桶。成功对象会成为下一次运行的断点。
- 若每次都重复上传全部大音频，检查比较逻辑是否误用 multipart ETag，而不是先增加并发或延长超时。

部署/数据：
- 2026-08-15 首次完整发布已核对 1224 个公开文件；最后一次补传后为 1 个上传、1223 个未变化、0 个删除。

### 2026-08-04：CloudBase 事务内并发查询导致 TransactionBusy

已做：
- 将 `teacherAdmin.promoteClassAssignmentBatch` 事务内的四个读取从 `Promise.all` 改为顺序 `await`。

技术规则：
- 同一个 CloudBase transaction 内只允许一个进行中的数据库操作；不要并发执行 transaction 查询或写入。
- 多个班级任务批次的迁移应串行执行，并检查每页返回的 `apply_failures`。

重复问题：
- 如果迁移返回 `ResourceUnavailable.TransactionBusy`，先检查事务回调内是否存在 `Promise.all` 或其他并发数据库操作，不要盲目高频重试。

部署/数据：
- 代码修复需要重新部署 `teacherAdmin`；失败的事务不会自动把该批次标记为班级任务，可通过 dry-run 的 `already_scoped` 复核。

### 2026-08-17：teacherAdmin 解压体积导致 Intensive Argue 前端回退

已做：
- 确认线上 `teacherAdmin` 的 `UpdateFailed` 根因是 `LimitExceeded.CodeUnzipSizeLimit`，不是数据库字段缺失或静态缓存；旧包解压后的 `index.js` 为 3,652,349 bytes。
- 将 `teacherAdmin` 的 `@cloudbase/manager-node` 顶层入口替换为只覆盖五个 end-user API 的本地 TCB 签名适配器，并移除该函数不再需要的依赖锁定。
- 新增 `npm run test:teacheradmin-package`，检查 ZIP 内容、解压体积、Intensive Argue 业务标记和本地签名请求。

技术规则：
- teacherAdmin 仍用官方 `@cloudbase/node-sdk` 做数据库和调用者身份；账号创建、启停、删除、重置仍调用同一套 `2018-06-08` `DescribeEndUsers` / `CreateEndUserAccount` / `ModifyEndUser` / `DeleteEndUser` / `ModifyEndUserAccount` API。
- 仅使用 CloudBase 运行时的 `TENCENTCLOUD_SECRETID`、`TENCENTCLOUD_SECRETKEY`、session token 和环境 ID；任何密钥不得进入源码、ZIP 检查输出或文档。
- 发布前包的总解压体积必须不超过项目 guardrail 1,500,000 bytes，且只含打包后的 `index.js` 与生成的 `package.json`。

部署/数据：
- 只需重新打包并上传最新版 `deploy-packages/teacherAdmin.zip`；不需要迁移 answer_disputes、grading_keys 或 intensive_listening_materials。
- 新版函数返回 `dispute_type: "intensive_spelling_exemption"` 后，已有精听 Argue 会进入 Reject/Approve 专用卡片；旧三按钮请求不要继续点击。

### 2026-08-21：AI Tutor 首次作文批改上线故障链

已做：
- 把照片上传确认、OCR、标化内容评估和通用语言批改从浏览器长请求迁移到 `writing_ai_jobs`。
- 把 Sentence Revision `Check` 也迁移到同一持久队列：学生改写正文只暂存在
  `writing_compositions.pending_rewrite_check`，job 与日志继续只保存安全元数据；网页轮询并可在
  网络断开、刷新、关闭浏览器或重新登录后恢复同一任务。
- 增加逐句改写双层草稿：输入即写入 ownership-scoped 浏览器本地层，`Check` 后再写入
  `pending_rewrite_check` 云端层；失败和不确定交付保留两层，成功发布才清理。
- Sentence Revision 的分析与改写改为同一卡片互斥正反面，并为键盘、屏幕阅读器和
  reduced-motion 提供同一状态机下的替代交互。
- 加入稳定 operation/job/usage ID、异步派发、每分钟恢复、租约；当前每个任务最多自动尝试五次，
  并保留 active-job 结果守卫和失败退额度。
- 兼容千问的 JSON 字符串包装、多页数组根，并在严格 Schema 之后执行服务器领域校正。
- 修复千问回显原句时调整空格或标点导致的 `WRITING_AI_SENTENCE_ALIGNMENT_FAILED`：完整唯一句子 ID 仍严格，原句由服务器填回。
- 修复模型结构已经合格、但首次写入 `language_review: null` 时 CloudBase 报
  `PathNotViable ... model_metadata`：嵌套 review/rewrite/active-job 对象必须用
  `db.command.set(...)` 原子替换，不能让 `update()` 展开为 dotted paths。
- 同一规则覆盖首次 `rewrite_results: null`：rewrite job 成功事务必须整字段替换结果、清除
  `pending_rewrite_check` 并完成当前 job，不能在模型成功后又因 dotted path 写入失败。

技术规则：
- 所有未来慢速 AI 功能默认使用持久任务；网页只发起和查看状态，不拥有模型执行生命周期。
- 结构化返回采用“Schema 验证 + 稳定领域 ID + 服务器 canonicalization”，不能要求模型逐字符回显权威数据。
- AI job 和运行日志只记录安全元数据，绝不记录密钥、内部 token、作文正文、OCR 文本、反馈或学生身份。
- 完整事故表、可观测字段和未来 AI 发布门槛见 `docs/adr/0003-durable-canonical-ai-boundaries.md`。

重复问题：
- 先按 safe error code 判断层次：网络等待、provider HTTP/timeout、Schema、领域 ID 对齐、active-job/lease、quota。
- 先读 `writing_ai_jobs` 和 `writing_ai_usage_events` 的安全投影，不要为了排错输出完整数据库行或函数环境变量。
- Token 成本排查应同时读取 `writing_model_usage_events`：按 `job_id` 核对每个 stage 和 job attempt。
  `NO_MODEL_USAGE_EVENT` 表示整项记录缺失，`USAGE_EVENT_GAP` 表示同一阶段只写入了部分调用，
  `PROVIDER_USAGE_MISSING` 表示供应商响应没有完整 usage，
  `USAGE_EVENT_PERSISTENCE_FAILED` 表示模型调用后账本写入失败。不要用作文字符数反推 Token，也不要
  为排错输出 prompt、作文、OCR、反馈、图片 URL 或环境变量。确认 collection/index 后，再核对
  `writingTutor`、`writingAiWorker`、`sendWritingTutorEmails` 是否来自同一提交。
- 不要用“更换模型”掩盖请求生命周期、幂等、canonicalization 或部署未生效的问题。

部署/数据：
- `writingTutor`、`writingAiWorker` 和一分钟 timer 已部署；`writing_ai_jobs` 为 `ADMINONLY`。
- 失败任务只保留安全错误代码并已事务化退回额度；未在文档中保存生产 job/Composition/usage ID。
- 相关生产修复提交为 `b2b5d72` 和 `e1dc73d`。

### 2026-08-22：Sentence Revision 拍照导入边界

技术规则：
- `Scan Revisions` 必须沿用私有上传加持久任务边界：`revision_ocr` job 只保存安全元数据、照片
  ID 和学生/Composition/revision/operation scope，不保存作文、OCR 正文或模型反馈。
- 排查顺序固定为 upload/job lifecycle、provider/schema、marker canonicalization、pending scan result、
  draft import boundary 和 stale revision；不要把模型返回的句子编号或原文当作最终事实。
- Review Scan 只显示红色原句选择框、OCR 编辑框和极小置信度符号；导入前不要自动触发 `Check`。
  学生按 Import 是覆盖对应未完成草稿的明确确认边界；返回而不导入不得改动草稿。

可观测字段：
- 只记录 `job_id`、`operation_id`、Composition ID/revision、job state、attempt/lease timestamps、
  safe error code、schema/prompt/model/protocol metadata，以及 photo cleanup state。
- 日志中禁止出现 marker 原文、OCR 文本、学生答案、私有图片 URL、token、密钥或学生身份。重复
  operation/revision 请求应能从安全投影确认是 replay，而不是新建 job 或再次调用模型。

重复问题：
- 若扫描结果卡在 queued/processing，先检查 durable job 是否 active、租约是否过期、timer 是否恢复，
  再检查前端轮询；不要让学生重复创建 Composition。
- 若结果映射到错误句子，检查服务器是否按当前 sentence list canonicalize，以及是否拒绝 duplicate、
  missing、out-of-range 或空 marker；不要只调整 OCR prompt。
- 若扫描导入后草稿内容异常，检查 Import 是否只提交了当前卡片的 sentence ID 与编辑文字，并检查
  pending scan result 到 confirmed scanned draft 的事务边界。
- 若第一张订正照片仍立即上传或无法继续拍第 2/3 张，先检查文件 change 事件是否只调用
  `addRevisionScanPhotos`，以及 `Start Scanning` 是否是唯一调用 `beginRevisionScanUpload` 的 UI 边界。
  本地队列最多 8 张；在确认前不应出现 `pending_upload`、photo row 或 `revision_ocr` job。
- 若重复 Submit 后只看到一轮点评或出现重复轮次，先检查 Composition 的
  `rewrite_results.feedback_history`、`check_round` 和各批次 `operation_id`。
  `rewrite_results.results` 只是每句当前合并状态，不能当作历史来源；相同 operation ID 的重放必须
  返回原轮次，不能追加重复批次。旧记录没有历史数组时，下一次成功发布只可把当时仍存在的最新
  点评恢复为第 1 轮，更早已被覆盖的点评无法追溯。

### 2026-08-22：`pending_upload: null` 阻断拍照请求

现象与根因：
- `Scan Revisions` 在选择图片后立即返回通用 AI 错误，CLS 显示 `Cannot create field
  'composition_revision' in element {pending_upload: null}`。这发生在模型调用之前，不是视觉模型、
  API Key、图片清晰度或结构化返回问题。
- CloudBase `update()` 会把普通嵌套对象展开为 dotted paths；当旧值明确为 `null` 时，不能直接创建
  `pending_upload.*` 子字段。普通作文重新上传也存在同一边界。

固定规则：
- 从 `null`、缺失值或旧对象写入新的 `pending_upload` 时，必须通过
  `replaceWholeFields(..., ["pending_upload"])` / `db.command.set(...)` 整字段替换。
- 上传确认转为 `revision_ocr` job 时，`pending_upload`、`pending_revision_scan` 和 `active_job`
  也按完整字段原子更新，避免清理状态与新 job 投影部分合并。
- 回归测试必须同时覆盖普通作文上传和 Sentence Revision 扫描，不能只检查模型调用或 Schema。

### 2026-08-24：AI Tutor 等待 Runner 排查顺序

现象与根因：
- 等待卡片的阶段文字必须来自 Composition/Job 的真实状态。若上传仍是
  `photo_uploading` 或存在未确认 `pending_upload`，这是交付未确认，不是可离开状态；不要把
  `Uploaded`、`Saved` 或 `Back` 当作本地上传完成的推断。
- Runner 只消磨等待时间。Score、collectibles、距离、踉跄次数和 Canvas 动画不是 AI 进度，也不应进入
  网络、日志、localStorage、IndexedDB、Attempt、STAR 或任何数据库字段。

固定规则：
- 先检查 `ai-tutor.js` 的共享串行 `getComposition` 控制器，再检查统一等待渲染器的状态映射；不要用
  定时器把服务器的 Queued 自动改成 Analysing，也不要让 Runner 的 RAF 驱动轮询。
- 结果到达必须先进入 Ready 并保留一次性结果按钮；不得自动调用结果 renderer 或停止 Runner。隐藏标签页、
  Reduced Motion、Runner 缺失或音频异常都不能阻断按钮。失败、返回 Home、切换 Composition 和 `pagehide`
  都必须调用幂等销毁和共享 timer 清理。
- “后台已经成功但页面必须刷新”的常见根因是旧轮询只在 Promise 内安排固定 5 秒 timer，且成功分支直接
  把结果交给 renderer；V2 用 Promise 完成后再安排 3/10 秒 timer，visibility/focus/online 唤醒，防止重叠
  请求，并把成功留在当前等待卡片直到学生点击。
- 若页面仍在失败卡片显示 Canvas，先查失败函数是否调用 `destroyAiWaitingExperience()`；若刷新后出现多个
  RAF，查旧 Canvas 被替换前是否销毁，以及 visibility/pagehide 是否清除了控制器。
- 若 Scan 后仍短暂出现 `Uploading your writing`、`AI is reading` 或没有游戏，先检查共享 renderer 是否把
  Runner 条件错误绑定到 `durable`，以及 CSS 是否残留 `.ai-waiting-uploading .runner-shell { display:none }`。
  上传是否可安全离开仍由 durable 状态决定，但游戏从上传交接开始就应显示。
- 若障碍物或星星只出现在开场，检查补充逻辑是否保存了一个不会随世界坐标回退的 `last…Right` 游标。
  每帧应从当前活动对象重新计算最右端，再补足前方地形；长期模拟测试必须覆盖至少 60 秒。
- Finished 的提示音必须由与 5.2 秒 Dock bounce 同周期的单一 timer 驱动，并在销毁等待页时清除；Reduced
  Motion 不重复动画或声音。不要从 CSS animation event、Runner RAF 或轮询响应各自创建多个音频 timer。
- 新 Runner 测试只允许使用最小 Canvas/RAF mock；不要为游戏引入框架、CloudBase API、声音、振动或新的
  持久化依赖。

验证：
- 运行 `npm run test:waiting-runner` 和 `npm run test:writing-tutor`，再运行计划第 9.3 节列出的语法、release
  verification 和 `git diff --check` 命令。静态页面发布不需要重新部署 `writingTutor` 或 `writingAiWorker`。

OCR can succeed with text highlights while image boxes are absent. Check `pending_ocr.location_status`
first: `not_needed` means there were no canonical uncertain spans, while `partial` or `unavailable` means
the optional locator returned fewer than one accepted region per span or failed safely. Do not retry the
locator during polling or reopen. `unavailable` is also expected when less than 100 seconds remains on the
OCR job lease after transcription; do not delay text publication for image decoration. If a candidate coordinate is outside the normalized page bounds, reject
it rather than clamp it; the transcription must still commit. Never diagnose this by printing image URLs,
uncertain strings, raw model output, or coordinates.

### 2026-08-24：AI Tutor 重绘后停在底部空白

现象与根因：
- iPhone/iPad Safari 在学生从较高的照片列表底部删除图片后，可能保留删除前的文档滚动坐标。
  `stage.innerHTML` 已经换成更短的新界面，但视口仍被限制在新文档底部，因此看起来像跳到一片空白，
  需要学生手动向上滚动；这不是图片删除或状态保存失败。

固定规则：
- 会替换完整 Stage 或明显缩短 Source 结构的渲染，必须在两次 `requestAnimationFrame` 后通过共享
  `scheduleStageViewportReset()` 重新计算主内容相对 sticky toolbar 的位置；不要沿用旧的绝对 scrollY，
  也不要只依赖 Safari scroll anchoring。
- 初稿照片添加/删除、最后一张删除、Type/Scan 与评估模式切换都必须归位。订正照片暂存也使用同一规则；
  移除最后一张或 Cancel 返回 Sentence Revision 时，由跨屏 renderer 归位。
- 同一 Sentence Revision 内的输入、翻面、Sample 展开和等待 Runner 的状态轮询不是跨屏导航，禁止反复
  归位。跨屏 renderer 必须比较前后 screen；只有实际进入新屏幕时才重置。

### 2026-08-29 — Speaking browser recorder loses or duplicates its controls

If a live Discussion recording appears to continue while Stop/Upload controls
disappear, first inspect whether `visibilitychange`, Discussion selection, or a
mutation called `openDiscussion()` during the in-memory recording. A second
Record tap can also create competing streams if the action is not state-locked.
Do not fix either symptom by retaining audio in browser storage or weakening the
private upload boundary.

The formal recorder must keep one explicit local state, suppress Discussion
re-rendering until it returns to Ready, deliver MediaRecorder chunks at a fixed
interval, and own one preview Audio/object URL. Upload failure returns to Review
with the same operation ID; page teardown stops tracks and revokes the URL.
Test background/foreground, repeated Record, stream-ended, recorder error,
Replace, browser leave, and upload retry on a real phone before release.

### 2026-08-27 — Speaking Lab safe diagnosis

If Speaking analysis returns `SPEAKING_PROVIDER_NOT_CONFIGURED`, this is the
intentional production fail-closed state, not evidence of a browser recording
failure. Check only safe job ID, Discussion ID, stage, attempt, and error code;
never print audio paths, upload metadata, transcript, names, prompts, provider
responses, or tokens. A pending/declined VIP or Guest must receive the same
server access denial regardless of a guessed Student ID.

After the Tencent adapter is enabled, one job should show one
`provider_task_id` and an increasing `provider_poll_count`. Repeated
`CreateRecTask` calls for the same job are a billing/idempotency fault; ordinary
`waiting`/`doing` results must requeue the same task without spending the five-
failure recovery budget. `SPEAKING_AUDIO_NOT_RELIABLY_SCORABLE` may still leave
a private processing report containing the usable canonical transcript. Never
copy the temporary audio URL or Tencent response into diagnosis notes.

If one Individual Response report succeeds but a later one ends at
`transcription` with `DATABASE_REQUEST_FAILED`, inspect the database platform
log before blaming ASR. An `InsertDocument` duplicate on
`uniq_discussion_version` with `{ discussion_id: null, report_version:
"response-r1" }` means the obsolete two-field unique index is blocking every
second IR report. Replace it with the unique
`discussion_id + response_session_id + report_version` index, preserving the
unique `report_id` index. The uploaded audio and completed Tencent task remain
usable; after the index migration, requeue the same failed job instead of
asking the student to record again or creating another ASR task.

If a share is unavailable, treat missing, expired, and revoked tokens as the
same `SHARE_NOT_AVAILABLE` outcome. Duplicate uploads/jobs should replay their
stable operation ID; a stale lease or mapping revision must never publish.

For a stuck formal recording upload, inspect only the safe asset status,
whether `file_id` is present, the expected/actual byte count, and whether the
reserved object exists. `status: uploading` plus a null `file_id` and no object
means the byte transfer never completed; it is not an ASR or scoring failure.
The current browser must call the authenticated CloudBase `uploadFile` method,
then pass `uploaded_file_id` to `finishAudioUpload`. The server must reject a
different object key even when the caller can otherwise access that file.

For Intensive Listening, a catalog card without a visible live material is
expected to be omitted. Check the visible set/material intersection and the
safe response fields before investigating the browser. A missing session
index must not be fixed by changing the timer; use the bounded fallback,
record the risk, and ask the owner to gate index creation. If duplicate
Started/final rows appear, inspect deterministic session event IDs and
transaction claims; never overwrite an existing outbox row.
### Scan Words symptoms

`Scan Words is not available` usually means the feature switch is off or the
function is not deployed. Upload verification failures indicate missing or
expired signed metadata. Queued pages require the worker and provider
configuration; stuck processing pages require lease recovery. Missing
ADMINONLY collections/indexes can look like an empty scan. Unsupported HEIC is
a browser decode limitation: convert or retake the photo. Quota is
Shanghai-calendar based. Never log image, OCR, Context, candidate, or provider
bodies. If deletion fails, keep `file_id`/`cloud_path` and
`cleanup_error: PHOTO_DELETE_RETRY_REQUIRED`; nulling the locator would prevent
the worker from retrying private-file cleanup. Diagnose a stale candidate
drawer through `candidate_revision` and serialized client sync, never by
trusting browser-provided text.

### Paper 4 audit corrections disappear after regenerating content

`scripts/import-dse-paper4-speaking-sets.js` produces a raw recall-based draft;
it is not the audited source of truth. It now refuses to overwrite the
canonical file unless the operator explicitly opts into the unsafe recovery
flag. Generate to a separate review path, update the relevant year audit under
`content/speaking/audits/dse-paper4/`, and run
`node scripts/apply-dse-paper4-audits.js --write`. If Part B looks reversed,
inspect each question's stable `question_id` and numeric `order` separately;
do not renumber IDs merely to make the suffix match display order. Existing
reports use frozen snapshots and must not be rewritten.
