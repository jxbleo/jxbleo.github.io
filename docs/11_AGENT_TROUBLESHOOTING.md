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

| 现象 | 最常见原因 | 先查哪里 |
| --- | --- | --- |
| 页面已经修了，本地正常，线上仍报旧错 | CloudBase 云函数没有重新部署，或静态站点缓存旧 JS | `deploy-packages/*.zip` 是否重建；CloudBase 控制台函数版本；HTML query string |
| 练习页面能打开，但提交失败 `GRADING_KEY_NOT_FOUND` | `grading_keys` 没导入对应 `set_id` | CloudBase `grading_keys` 搜索 exact `set_id` |
| 首页或直接 URL 有内容，但学生 Explore / Library 看不到 | `sets` 没导入或 stale | CloudBase `sets` 搜索 exact `set_id`；`getResources` 返回 |
| 教师 Library / Assign 看不到刚新增的静态内容 | 静态站点未发布/缓存旧 `teacher.js`、CloudBase `sets` 未导入、Library/Assign fallback 没合并静态 catalog，或 CloudBase 重复导入后记录数超过云函数读取上限 | 先查 `data/home-catalog.json` 和 `teacher.html` cache version，再查 CloudBase `sets` / `grading_keys`。如果记录存在但 Assign 仍显示 import-required，查 `teacherAdmin.listSets` 读取 limit 和线上函数版本；部署最新 `teacherAdmin.zip` |
| CloudBase 导入显示成功但系统读不到 | 上传了数组 JSON，而不是 JSON Lines | 使用 `.cloudbase-private/import/*-cloudbase.json` |
| 学生账号在 Authentication 里有，但登录后 profile incomplete | Auth user 和 `students.auth_uid` 没正确链接，或写成嵌套 `data` | `students` 文档是否顶层字段；`auth_uid` 是否匹配 |
| 学生删除后用相同 Login ID 重建仍报 `STUDENT_ID_EXISTS` | 线上 `teacherAdmin` 仍是旧版，已删除 profile 的 `student_id` 尚未归档释放；或 Authentication 中同名 end user 仍存在 | 部署最新版 `teacherAdmin`；检查 deleted profile 的 `deleted_student_id_snapshot` 与归档 `student_id`；再查 Authentication username |
| CloudBase 文档长成 `{ data: { ... } }` | 错用了 `add({ data: record })` | 所有新增都应 `add(record)` |
| 学生完成后老师端进度仍旧 | `teacherAdmin.listProgress` 聚合逻辑或线上函数版本 stale | `teacherAdmin` 部署版本；assignments/attempts 是否同 assignment_id；是否部署了分页读取和 attempt 兜底版本 |
| 学生有大量历史记录，但 Calendar 和 Finished 同时为空 | `getDashboard` 超过 CloudBase 执行时限；旧前端又把失败响应吞成空 assignments | 先查 `getDashboard` 日志是否为 `调用失败(433)` / `Invoking task timed out`；部署批量 set 查询版本，将执行超时设为至少 10 秒（建议 15 秒），并发布带 Retry 状态的 Dashboard 静态文件 |
| Personal Center 星星数量正确，但点开来源清单为空 | 静态 Dashboard 已更新但云端 `getDashboard` 仍是未返回 `star_achievements` 的旧版 | 重建并部署 `getDashboard`，发布带最新 cache query 的 `dashboard.html` / `dashboard.js`；不需要迁移 `student_set_achievements` |
| 教师铃铛里第二/第三次 attempt 点不开矩阵弹窗 | 矩阵日期过滤只看 assignment 完成/最新摘要日期，没有把被点击 attempt 的提交日期纳入匹配 | 发布最新版静态 `teacher.js`；查 `matrixItemMatchesDate` 是否同时检查 `progressAttemptsForAssignment(item)` |
| 手机 Teacher View 姓名已缩短但首列仍很宽 | 桌面矩阵 density 存在同一个 localStorage 键中并优先于手机自动 Fit；旧 history 也可能跨断点恢复 density | 发布最新版 `teacher.js` 和 `app.css`；确认手机首次载入 `resolvedMatrixDensityStep()` 为 0，且移动端 Fit 网格使用 `--matrix-student-col-fit` |
| iPad 第一次打开学生 Calendar 时日期数字靠方格上方 | Safari 首次解析 `aspect-ratio` 时仍可能沿用原生 button 行盒/基线，单靠 Grid `place-items` 不稳定 | 发布最新版 `app.css`；确认 `.student-calendar-day` 重置 `appearance`，使用 Flex 双轴居中和 `line-height: 1` |
| Teacher View 点击 `Wxx` 没反应，或任务详情的 Edit 不打开参数弹窗 | 先查浏览器控制台是否有 `assignmentMasteryEnabled is not defined`；旧实现会在创建 modal 前调用不存在的函数。其次检查重渲染后的临时 scope 是否丢失 | 发布最新版 `teacher.js`；确认编辑器使用已存在的 `assignmentCanEarnStar`，且按钮携带 `data-assignment-edit-ids` 并从当前 progress 恢复记录。不要用只检查源码字符串的测试代替真实点击测试 |
| 学生铃铛有红色数字但 `THIS WEEK` / `OVERDUE` 都为空 | 旧静态代码仍把所有 `to_do`（包括未来作业）计入红点，或旧 assignment 尚未补齐 `due_at` | 发布最新 Dashboard/Teacher 静态文件与 `getDashboard`/`teacherAdmin`；dry-run `backfillAssignmentDueWeeks`，确认未来任务只在 Upcoming 且不计红点 |
| 学生从 Library 完成已布置任务但老师 View matrix 不统计 | 旧版 `submitAttempt` 把无 `assignment_id` 的提交记为 self-study | 部署最新版 `submitAttempt`；检查 attempt 是否有 assignment_id |
| 学生从 BBC Library 打开已做过的题但 History 显示没有记录 | BBC 页只看 URL 的 `history`/`prefill` 参数，Library 卡片没有传历史 attempt | 部署最新版 `getDashboard` 和静态 `bbc.html`；确认 `getLatestAttemptForSet` 能返回当前学生自己的 attempt |
| My Words 可以普通查词，但 AI Lookup 提示未配置 | 两个云函数缺少一个或多个 `VOCAB_AI_*` 环境变量，或 URL 不是 HTTPS | 同时检查 `studentVocabulary` 与 `teacherAdmin` 的 `VOCAB_AI_API_URL`、`VOCAB_AI_API_KEY`、`VOCAB_AI_MODEL`；不要把密钥放进前端 |
| 学生已确认 AI 草稿，老师 Dictionary 看不到或无法发布 | 新集合未创建、仍非 `ADMINONLY`，或线上 `teacherAdmin` / `studentVocabulary` 版本不一致 | 创建 `vocabulary_lexicon_history`、`vocabulary_dictionary_reports`，部署同一提交打包出的两个 ZIP，并检查 normalized word 当前记录 |
| My Words 时间筛选看起来被后台查词改变 | 旧代码错误使用 `updated_at` 而不是学生活动时间 | 发布最新静态与 `studentVocabulary`；确认筛选优先读取 `activity_updated_at`，后台 enrich 不更新它 |
| BBC History 分数已按 Argue 修正但题目仍显示黄色/错误 | 历史渲染时旧的 `wrong`、blank lock、MC lock class 覆盖了服务器返回的 adjusted correct 状态 | 发布最新版静态 `bbc.html`；查 `markHistoryReview` 是否先清理相反状态再加 `correct/wrong` |
| 完成或 STAR 后无法再次布置 | 当前前后端仍有旧规则阻止 completed | `teacherAdmin.getAssignmentState`、`createAssignments`、`teacher.js candidateStatus` |
| 教师矩阵单格 Edit 或 Wxx 批量无法打开编辑器，或保存后参数不变并提示更新 0 条 | 动态矩阵/独立 modal root 中的按钮失去原容器监听；或旧 assignment 的 stable ID 是文档 `_id`，旧后端却只按 `assignment_id` 字段查询 | 发布使用 delegated edit handler 的静态 `teacher.js`，并部署兼容 stable ID 的最新版 `teacherAdmin`；无需迁移 assignments |
| 已通过作业后来低分后状态异常 | assignment 状态没有单调保护 | `submitAttempt.statusForPercentage` 和 assignment update |
| 学生重复点击提交后 attempts 有多条但 assignment summary 不准 | 旧版 `submitAttempt` 用旧 assignment 快照递增更新 | 部署最新版 `submitAttempt`，它会从 linked attempts 重算 summary |
| Argue 批准后历史匹配答案没有补分或 STAR 没出现 | 批量向上重算没有扫描到同 set/question/submitted answer，或改判流程没有调用 STAR 保护逻辑 | `teacherAdmin.applyAcceptedAnswerToHistoricalAttempts`、`teacherAdmin.improveAttemptForAcceptedAnswer` |
| 老师改过答案后再次导入被覆盖 | 本地 `prepare-cloudbase-data.js` 重新生成 `grading_version: "1"` | 需要 grading key reconcile 流程 |
| `tcb fn code update --dir ...` 对小函数仍报 ZIP 超过 1.5MB，或 COS 60 秒超时 | CloudBase CLI 3.5.7 可能从项目根目录错误打包整个仓库 | 先进入仅含 `index.js`、`package.json` 的函数 bundle 目录，再不带 `--dir` 执行 `tcb fn code update <name> --deployMode zip` |
| BBC 填空输入框后面多出下划线 | 数据里用了 6 个或更多 `_` | 扫描 `data/BBC-*.json` 的 `_{6,}` |
| Vocabulary Learn 模式 Check Answers 弹 `NO_GRADED_QUESTIONS` | `grading_keys.answers` 为空，或页面提交的 `questionKey` 和私有答案 key 不匹配 | 查 CloudBase / `.cloudbase-private/import/grading-keys-cloudbase.json` 中对应 `set_id` 的 `answers`；重新运行 `node scripts/prepare-cloudbase-data.js`，必要时用 `cloudbase:import:content -- --only grading_keys --ids <set_id> --overwrite-existing` 修复已存在的空 grading key |
| Vocabulary 本地直接打开加载失败 | `fetch` 被 file:// 限制，缺 JS fallback 或本地 server | `content/vocabulary/*.js` fallback；用本地 HTTP server |
| Git push 超时或失败 | 网络或 GitHub HTTPS 问题，不一定本地提交失败 | `git log`、`git status`、`rev-parse HEAD origin/main` |
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

## 3. 按日期整理的技术变更记录

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

### 2026-06-13：Vocabulary 维护经验

确认规则：

- `vocabulary.html` 优先 fetch JSON，但 file:// 可能失败。
- 每个 vocabulary unit 需要 `.json` 和 `.js` fallback。
- `data/home-catalog.json` 和 `data/home-catalog.js` 要同步。
- NGSL 和 NAWL 是两套独立词库编号。NAWL 不接在 NGSL 的末尾继续按
  字母排，而是从 `NAWL-A` 开始，对应 NAWL `1-100`。
- Test mode 不显示原始组号或 Words 范围，避免学生对照 Learn mode 找答案。
- 1-4 groups 是 self-test，不记录 attempt；5+ groups 才 countable。

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
