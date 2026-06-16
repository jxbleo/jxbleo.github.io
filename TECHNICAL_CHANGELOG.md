# Mr. Cat Academy 技术变更与重复问题记录

> 这份文档是给人和 Agent 快速排障用的。
> 它不替代 `PRODUCT_REQUIREMENTS.md`，也不替代 `AGENTS.md`。
> 它专门记录：做过什么技术变更、哪些问题反复出现、以后看到类似现象应先查哪里。

## 0. 怎么使用这份文档

当出现问题时，先按下面顺序查：

1. 先看“重复出现的问题速查”。
2. 再看“当前开放技术问题”。
3. 如果是历史功能，查“按日期整理的技术变更记录”。
4. 如果要改产品规则，再同步更新 `PRODUCT_REQUIREMENTS.md` 和 `AGENTS.md`。

不要在本文档中记录密码、CloudBase 密钥、私有答案、accepted variants、完整 grading key 或长命令输出。

## 1. 重复出现的问题速查

| 现象 | 最常见原因 | 先查哪里 |
| --- | --- | --- |
| 页面已经修了，本地正常，线上仍报旧错 | CloudBase 云函数没有重新部署，或静态站点缓存旧 JS | `deploy-packages/*.zip` 是否重建；CloudBase 控制台函数版本；HTML query string |
| 练习页面能打开，但提交失败 `GRADING_KEY_NOT_FOUND` | `grading_keys` 没导入对应 `set_id` | CloudBase `grading_keys` 搜索 exact `set_id` |
| 首页或直接 URL 有内容，但学生 Explore / Library 看不到 | `sets` 没导入或 stale | CloudBase `sets` 搜索 exact `set_id`；`getResources` 返回 |
| CloudBase 导入显示成功但系统读不到 | 上传了数组 JSON，而不是 JSON Lines | 使用 `.cloudbase-private/import/*-cloudbase.json` |
| 学生账号在 Authentication 里有，但登录后 profile incomplete | Auth user 和 `students.auth_uid` 没正确链接，或写成嵌套 `data` | `students` 文档是否顶层字段；`auth_uid` 是否匹配 |
| CloudBase 文档长成 `{ data: { ... } }` | 错用了 `add({ data: record })` | 所有新增都应 `add(record)` |
| 学生完成后老师端进度仍旧 | `teacherAdmin.listProgress` 聚合逻辑或线上函数版本 stale | `teacherAdmin` 部署版本；assignments/attempts 是否同 assignment_id |
| 完成或 STAR 后无法再次布置 | 当前前后端仍有旧规则阻止 completed | `teacherAdmin.getAssignmentState`、`createAssignments`、`teacher.js candidateStatus` |
| 已通过作业后来低分后状态异常 | assignment 状态没有单调保护 | `submitAttempt.statusForPercentage` 和 assignment update |
| Argue 批准后分数提高但 STAR 没出现 | 改判流程没有调用当前 STAR 保护逻辑 | `teacherAdmin.improveDisputedAttempt` |
| 老师改过答案后再次导入被覆盖 | 本地 `prepare-cloudbase-data.js` 重新生成 `grading_version: "1"` | 需要 grading key reconcile 流程 |
| BBC 填空输入框后面多出下划线 | 数据里用了 6 个或更多 `_` | 扫描 `data/BBC-*.json` 的 `_{6,}` |
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
- teacher-originated dispute 没有 `attempt_id` 时仍不能触发 regrade。

部署/数据：

- 需要部署 `deploy-packages/submitAttempt.zip`、`deploy-packages/getDashboard.zip`、`deploy-packages/teacherAdmin.zip`。
- 需要发布静态站点，让 `assets/js/teacher.js` 生效。
- 不需要 CloudBase 数据迁移。

### 2026-06-16：人类可读产品需求文档

新增：

- `PRODUCT_REQUIREMENTS.md`

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
- 移动端 assignment capsule 的 `Go` 按钮固定在右侧列。
- My Words 禁止从答案、解析、反馈、结果、teacher reply、review answer 等区域保存。

重复问题：

- 静态资源改动后必须 bump cache version，否则移动设备和 GitHub Pages 可能继续用旧 JS/icon。

### 2026-06-16：IELTS Listening teacher preview 音频启动

已做：

- `teacher=1` 不再跳过共享 `Start Audio` 确认流程。
- teacher Library practice link 带 public app version，避免打开旧缓存页面。

重复问题：

- 音频播放问题常常不是文件缺失，而是浏览器用户手势、touch/click 双触发或 teacher mode 分支导致状态机错乱。

### 2026-06-16：NAWL-X 到 NAWL-Z2 静态验证

已做：

- 验证 NAWL-X 到 NAWL-Z2 的 JSON / JS fallback 可解析。
- 验证静态 home catalog 包含对应内容。
- 验证本地可渲染 NAWL-Z2。

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
- 只向上重评 disputed attempt。
- 不自动重评其他学生历史 attempt。

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
- teacher-originated dispute 可以没有 attempt，不得触发学生 regrade。

### 2026-06-12：Assignment Mastery Model

已做：

- assignment status 改为 `to_do`、`passed`、`mastered`。
- 默认 passing 50%，mastery 90%。
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
7. Argue 批准后没有 STAR：查改判后 STAR 修复。
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
