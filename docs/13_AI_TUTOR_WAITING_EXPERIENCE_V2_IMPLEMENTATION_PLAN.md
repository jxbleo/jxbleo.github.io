# AI Tutor Waiting Experience V2 工程实施计划

状态：产品决定已确认，等待编码实现
适用页面：`ai-tutor.html`
当前基线：线上 `main` 提交 `f587ad8`（2026-08-24，Asia/Shanghai）
目标执行者：Luna Extra High 或其他上下文较短、需要明确步骤的编码模型

> 本计划是 V2 的唯一执行说明。`docs/12_AI_TUTOR_WAITING_RUNNER_IMPLEMENTATION_PLAN.md`
> 是已经完成的 V1 历史计划，其中“成功后自动进入结果”“不播放声音”“显示
> Distance / Ink”“Saved / Queued / Analysing / Ready 固定文案”等决定已经失效。

---

## 0. 执行者开始前必须做什么

不要立刻改代码。必须依次完整阅读：

1. `AGENTS.md`
2. `README.md`
3. `docs/01_PRODUCT_REQUIREMENTS.md` 中 AI Tutor Writing 部分
4. `docs/02_ARCHITECTURE.md` 中 AI Tutor Writing Architecture 部分
5. `docs/03_UI_UX_SPEC.md` 中 AI Tutor Writing 部分
6. `docs/04_DATA_MODEL.md` 中 Writing Collections 部分
7. `docs/07_TESTING_CHECKLIST.md` 中 Writing Tutor 部分
8. `docs/11_AGENT_TROUBLESHOOTING.md` 中 Writing Tutor / durable job 部分
9. `docs/12_AI_TUTOR_WAITING_RUNNER_IMPLEMENTATION_PLAN.md`，只用于理解 V1 架构，不得照搬其失效规则
10. `ai-tutor.html`
11. `assets/js/ai-tutor.js`
12. `assets/js/ai-waiting-runner.js`
13. `assets/css/ai-tutor.css`
14. `assets/css/ai-waiting-runner.css`
15. `scripts/test-writing-tutor.js`
16. `scripts/test-ai-waiting-runner.js`

然后运行基线测试：

```bash
node --check assets/js/ai-tutor.js
node --check assets/js/ai-waiting-runner.js
npm run test:writing-tutor
npm run test:waiting-runner
npm run verify:release
git diff --check
```

如果基线测试失败，先记录失败，不要把原有失败误当成自己要修的 V2 问题。

### 0.1 工作区规则

- 必须从最新 `origin/main` 建立或使用干净的 `codex/` 分支。
- 不得在所有者的脏主工作区里清理、reset、覆盖或提交无关文件。
- 只修改本计划第 7 节列出的文件。
- 不得部署，除非所有者在实现完成后明确说“上线”或“部署”。

---

## 1. 一句话目标

把现有 AI 等待卡片改成：真实、任务相关的四阶段进度轨道；可持续游玩的原创 Mr. Cat Runner；本地临时积分；后台任务完成后自动更新为明显的 Ready 状态、播放一次柔和提示音，但不自动跳转，学生自己点击下方结果按钮进入。

---

## 2. 不得破坏的后台事实

这些是硬性架构边界，不是建议：

1. AI 任务的真实状态只来自 CloudBase 持久 Job 和 Composition。
2. Runner 不得调用 CloudBase，不得读取作文，不得创建 Job，不得决定任务成功。
3. 刷新、关闭浏览器、重新登录或从 History 打开，必须恢复同一个 Job。
4. 不得因为前端重试创建第二个模型调用、重复扣每日字数或覆盖新 operation。
5. 上传尚未被服务器确认时，不得告诉学生可以安全离开。
6. 所有 ready 判断继续使用现有函数和持久结果：
   - OCR：`composition.pending_ocr`
   - Review：`reviewReady(composition)`
   - Rewrite：`rewriteReady(composition)`
   - Revision Scan：`revisionScanReady(composition)`
7. 每个成功结果仍进入原有结果渲染函数；V2 只改变“何时由学生进入”，不改变结果内容。
8. 不修改 Cloud Function、数据库集合、权限、Prompt、模型、Schema、邮件或额度逻辑。

---

## 3. 已冻结的产品决定

以下决定已经得到产品所有者确认。执行者不得重新命名、重新选择或擅自简化。

### 3.1 顶部内容

- 等待卡片顶部只保留一个动态英文标题。
- 删除标题下方现有解释段落。
- 删除所有类似以下内容的可见字段：
  - `Waiting for the same saved OCR task...`
  - `The page checks every 5 seconds...`
  - `You may leave while AI continues...`
  - 其他持久轮询说明。
- 网络错误或“上传尚未确认”仍可显示必要、短促的警告；普通等待状态不显示解释段落。

### 3.2 四阶段进度轨道

固定的 `Saved / Queued / Analysing / Ready` 方框必须被任务相关的水平轨道取代。

| 等待任务 `kind` | 第 1 阶段 | 第 2 阶段 | 第 3 阶段 | 第 4 阶段 |
|---|---|---|---|---|
| `ocr` | `Uploaded` | `Reading` | `Organising` | `Ready` |
| `review` | `Saved` | `Preparing` | `Reviewing` | `Ready` |
| `rewrite` | `Saved` | `Comparing` | `Checking` | `Ready` |
| `revision_ocr` | `Uploaded` | `Reading` | `Matching` | `Ready` |

轨道视觉规则：

- 四个圆形节点由一条细线连接，不再是四个独立胶囊方框。
- 已完成：绿色节点、勾、绿色连接线。
- 当前阶段：稍大节点、柔和呼吸反馈，并使用 `aria-current="step"`。
- 未开始：浅灰节点和浅灰连接线。
- 不能显示百分比、剩余秒数或根据等待时间伪造进度。

### 3.3 后台状态到视觉阶段的唯一映射

保留 `waitingTaskState()` 对服务器状态的判断。视觉映射如下：

| 客户端真实状态 | 轨道表现 |
|---|---|
| 非持久 `uploading` | 第 1 节点显示 `Uploading` 并 active；后续 upcoming；隐藏 `Back` |
| 持久 `queued` | 第 1 节点 complete；第 2 节点 active |
| 持久 `analysing` / processing | 前两节点 complete；第 3 节点 active |
| 持久 `ready` / succeeded 且结果存在 | 四节点 complete |
| `failed` | 不伪造 Ready；立即进入原有失败卡片 |

Reading / Preparing / Comparing 是任务的用户语言，不是额外服务器子状态。不得用定时器在没有服务器变化时推进轨道。

### 3.4 Runner 操作和积分

- 学生可以反复跳跃，不得只有第一次有效。
- 每次落地后都可以立即再次跳跃。
- 空中允许一次二段跳。
- 如果学生在落地前约 120ms 再次触发跳跃，使用 jump buffer，在落地时立即起跳。
- 手机：游戏区域 `pointerdown` 立即触发；电脑：Space、ArrowUp、W；保留辅助技术 `Jump` 按钮。
- 不出现 Game Over。
- 障碍碰撞：本地积分 `-1`，短暂踉跄后继续。
- 同一个障碍最多扣一次，不能按碰撞帧数持续扣分。
- 绿色收集物：每个 `+1`。
- 积分从 `0` 开始，允许显示负数，例如 `Score −3`。
- 删除可见的 `Distance` 和 `Ink`。
- 积分只存在当前 Runner 内存；不写数据库、localStorage、sessionStorage、cookie、日志、成绩、STAR 或 Composition。
- 离开等待页或刷新后积分清零。

### 3.5 绿色收集物

- 视觉是原创的小型绿色闪光点/四角星点，不使用官方 Yellow STAR 样式。
- 代码内部命名 `collectible` / `collectibles`，避免与正式 STAR 奖励混淆。
- 世界中保持随机 3–7 个可到达的绿色收集物，包含即将进入画面的缓冲区域。
- 收集物不能生成在障碍物内部，也不能全部出现在物理上无法达到的位置。
- 收集后立即消失，并在后续安全位置补充，使数量继续落在 3–7。
- 收集反馈只用一次小幅 scale/opacity，不播放单独声音。

### 3.6 底部操作

- 原 `Continue in Background` 改为 `Back`。
- `Back` 继续复用 `data-return-home`：离开当前等待卡片，但不取消云端 Job。
- OCR 等允许重传的等待页面保留 `Upload Again`。
- `Upload Again` 改为绿色样式。
- 上传尚未持久确认时隐藏 `Back`，避免学生误以为可以安全离开。

### 3.7 成功后不自动进入

- Job 成功且持久结果存在时，当前页面自动变成 Ready；学生不刷新页面。
- 不得自动进入 OCR Review、Language Review、标准化结果或订正结果。
- Runner 继续运行，学生可以继续玩和累积分数。
- Runner 下方显示一个全宽绿色结果按钮。
- 学生不点击就留在完成状态继续游戏。

结果按钮文案：

| kind | 按钮 |
|---|---|
| `ocr` | `Review Text` |
| `review` | `View Review` |
| `rewrite` | `View Feedback` |
| `revision_ocr` | `Review Scan` |

点击后才调用原成功回调，并销毁 Runner。

### 3.8 Ready 完成动画

任务从 pending 变为 ready 的瞬间：

1. 当前节点到 Ready 的连接线在约 400ms 内填充绿色。
2. Ready 节点从约 `scale(.82)` 弹到约 `1.10`，再稳定到 `1`。
3. Ready 圆点内部用可控描边画出勾。
4. Ready 外围只扩散一次浅绿色光环，然后停止。
5. 所有四个节点保持绿色。
6. Runner 不暂停、不显示终点门、不调用旧的 500ms 自动跳转。
7. 同一任务重复轮询不得重复播放完成动画。

Ready 标题：

| kind | Ready 标题 |
|---|---|
| `ocr` | `Your Draft Is Ready` |
| `review` | `Your Review Is Ready` |
| `rewrite` | `Your Feedback Is Ready` |
| `revision_ocr` | `Your Revision Scan Is Ready` |

### 3.9 完成提示音

采用已经确认的“柔和双音上升玻璃提示音”：

- 只使用 Web Audio API 合成，不下载、不复制 Apple 音效、不新增第三方音频文件。
- 总时长约 400–500ms。
- 两个短音由低到高；建议 E5（约 659Hz）后接 B5（约 988Hz）。
- 正弦波为主，可加入很轻的高频泛音；总增益克制，峰值建议不超过 `0.08`。
- 使用 gain ramp，禁止突然开始/停止产生爆音。
- 音效与 Ready 勾出现的同一时刻触发。
- 每个本次页面观察到的 operation 只播放一次。
- 页面不可见、浏览器禁止自动音频、AudioContext 未解锁或播放报错时，静默失败；动画和结果按钮仍正常。
- 如果任务在学生离开期间完成，学生之后重新进入时直接显示 Ready，但不补播延迟提示音。
- 不为收集、跳跃或碰撞增加声音。

### 3.10 Reduced Motion 和可访问性

`prefers-reduced-motion: reduce` 时：

- 不播放节点弹跳、光环、连续呼吸或勾描边运动。
- 直接切换为绿色轨道并淡入勾和结果按钮。
- Runner 保持当前静态降级。
- 不因为 reduced motion 自动进入结果。

其他要求：

- Ready 变化使用一次 `aria-live="polite"` 播报，例如 `Your review is ready.`。
- 积分不要每帧进入 live region。
- 结果按钮可键盘聚焦，但完成时不要强抢焦点。
- 轨道不能只靠颜色：完成节点有勾，当前节点有 `aria-current`。

---

## 4. 自动更新与轮询修复

用户真实遇到“后台成功，但页面必须刷新才显示结果”。V2 必须修复，不可只做 UI。

### 4.1 轮询节奏

- 进入等待页立即查询一次。
- 页面可见：每 3 秒查询一次。
- 页面隐藏：每 10 秒最多查询一次。
- `visibilitychange` 变为 visible、窗口 `focus`、浏览器 `online` 时立即查询。
- 同一时刻最多一个 `getComposition` 请求，禁止重叠。
- 每次 Promise 结束后再安排下一次，不使用永久 `setInterval`。
- 临时失败退避：3s → 6s → 12s → 20s，上限 20s；成功后重置。
- 网络错误不创建新 operation，不调用 evaluate/OCR/rewrite start API。

### 4.2 推荐共享控制状态

在 `assets/js/ai-tutor.js` 的 `state` 中增加或等价实现：

```js
waitingPollTimer: null,
waitingPollInFlight: false,
waitingPollWakePending: false,
waitingPollFailures: 0,
waitingPollNow: null,
waitingResultAction: null,
waitingReadyAnnounced: false
```

名字可小幅调整，行为不能改变。

### 4.3 轮询唤醒规则

建立共享辅助函数，避免四套轮询各自重复监听：

```js
scheduleWaitingPoll(run, hadError)
wakeWaitingPoll()
clearWaitingPollSchedule()
waitingPollDelay(hadError)
```

要求：

- `wakeWaitingPoll()` 如果当前请求正在进行，只设置 `waitingPollWakePending = true`。
- 请求完成后如果 wake pending，立即再查；否则按前台/后台间隔安排。
- 四个 `stop*Polling()` 清理轮询、共享 timer 和 wake handler。
- 切换 Composition、Back、失败、进入结果和 `pagehide` 全部清理。

### 4.4 防止旧结果覆盖新页面

每次启动某类轮询时捕获：

- `composition_id`
- polling generation
- 当前 `kind`
- 如果存在，当前 Job `operation_id`

每次 Promise 返回后先检查：

- active flag 仍为 true
- generation 未变化
- 当前 Composition 仍是原 composition
- 当前 waiting kind 未切换
- 返回 Job 与当前 operation 不矛盾

任一不符就丢弃返回，不更新 DOM，不进入结果。

### 4.5 成功后的页面更新

现有四个成功出口保留结果准备逻辑，但改变最后一步：

- `showOcrResult`
- `showReviewResult`
- `applyRewriteResult`
- `renderRevisionScanReview` 的 waiting 分支

V2 行为：

1. 保存/同步返回的 Composition 和结果。
2. 停止该任务轮询。
3. 调用改造后的 `finishAiWaitingExperience(next)`。
4. 它只把 `next` 保存为一次性 `state.waitingResultAction`，显示 Ready 动画、声音和按钮。
5. 它绝对不能自动调用 `next`。
6. 点击 `[data-view-waiting-result]` 才原子地取出并清空 action、销毁等待体验、调用 action。
7. 连点结果按钮最多执行一次。

### 4.6 页面重新进入时已经完成

如果 `loadComposition` 发现 Job 已成功且持久结果存在：

- 显示 Ready 等待卡片和结果按钮。
- 不自动进入结果。
- 不播放补发提示音。
- 不重新启动已完成 Job。
- 不重复扣额度。

用“首次渲染即 ready”与“本页从 pending 过渡到 ready”区分是否播放声音和动画。

---

## 5. 推荐 DOM 结构

不要求逐字相同，但职责必须相同：

```html
<section class="surface ai-waiting-experience" data-waiting-kind="ocr">
  <header class="ai-waiting-copy">
    <h2 data-waiting-title>Reading Handwriting</h2>
  </header>

  <ol class="ai-waiting-progress" aria-label="Writing task progress">
    <li class="ai-waiting-step is-complete">...</li>
    <li class="ai-waiting-step is-active" aria-current="step">...</li>
    <li class="ai-waiting-step is-upcoming">...</li>
    <li class="ai-waiting-step is-upcoming">...</li>
  </ol>

  <div class="runner-shell">
    <canvas class="runner-canvas"></canvas>
    <p class="runner-instruction">Tap or press Space to jump</p>
    <p class="runner-score" aria-hidden="true">Score 0</p>
    <button class="runner-jump-button" type="button">Jump</button>
  </div>

  <p class="sr-only" data-waiting-live role="status" aria-live="polite"></p>

  <div class="ai-waiting-ready-action" hidden>
    <button class="primary-button" data-view-waiting-result>Review Text</button>
  </div>

  <div class="form-actions ai-waiting-actions">
    <button class="ai-waiting-reupload-action" data-reupload>Upload Again</button>
    <button class="quiet-button" data-return-home>Back</button>
  </div>
</section>
```

注意：

- 不渲染普通说明段落。
- durable 等待页不渲染可见 polling status。
- 非持久上传阶段可显示一条短警告，并隐藏 Back。
- Ready 结果按钮在 Runner 下方、Upload Again / Back 上方。

---

## 6. 文件级修改说明

### 6.1 `assets/js/ai-tutor.js`

必须修改：

- `state`：加入共享轮询和 Ready action 状态。
- `waitingStageLabel`：改为按 `kind` 返回阶段标签。
- `waitingStageMarkup` / `updateWaitingStageDom`：改成轨道节点、连接线状态和 `aria-current`。
- `mountWaitingRunner`：显示 `Score`，不再显示 Distance / Ink。
- `renderAiWaitingExperience`：删除解释和 durable polling 文案；渲染 Back、绿色 Upload Again、隐藏 Ready action。
- `updateAiWaitingExperience`：只响应真实 Job 状态。
- `finishAiWaitingExperience`：不再自动调用成功回调；进入 Ready。
- 新增一次性结果按钮 handler。
- 新增 Ready 标题/按钮映射。
- 新增 Web Audio 完成音辅助函数。
- 改造四套 `start*Polling`，加入 3s/10s、唤醒、退避和无重叠保证。
- `loadComposition`：已完成任务显示 Ready 卡片而不是直接跳结果。
- failure/navigation/reset/pagehide：清理 timer、音频引用和结果 action。

不要修改：

- `writingCall` 请求协议。
- Job ready predicate 的业务含义。
- operation ID 生成和复用。
- Composition revision 保护。
- 四类结果的数据结构。

### 6.2 `assets/js/ai-waiting-runner.js`

必须修改：

- 把 `ink` 改为本地 `score`。
- 障碍对象增加一次性扣分标记。
- 收集物改成绿色 collectible，并维持随机 3–7 个。
- 支持负分。
- 实现落地重复跳、一次二段跳和 jump buffer。
- `onScore` 返回 `{ score }`；可保留内部 distance 供世界运动，但 UI 不显示。
- `snapshot()` 暴露测试所需 score、air-jump、jump-buffer 和 collectible 数量。
- `setTaskState('ready')` 不停止 Runner。
- 旧 `finish()` 可保留兼容接口，但 V2 Tutor 成功路径不得依赖终点门或自动 callback。

不得新增网络、存储、数据库或第三方依赖。

### 6.3 `assets/css/ai-waiting-runner.css`

必须修改：

- 把四方框改成水平轨道。
- 实现连接线 complete/active/upcoming。
- 实现当前节点克制呼吸。
- 实现 Ready 连接线填充、节点弹跳、勾描边和一次光环。
- 添加 Runner 下方全宽绿色结果按钮。
- Upload Again 使用绿色；Back 使用次要文字样式。
- 手机 320px 起不得横向溢出；标签可换行但节点位置清楚。
- iPad/桌面轨道保持一行。
- 补全 reduced motion、more contrast、reduced transparency。

### 6.4 `ai-tutor.html`

- 更新 waiting CSS、Runner JS、Tutor JS cache-busting 版本。
- 不改变加载顺序：Runner 必须在 Tutor 前。

### 6.5 测试文件

- 扩展 `scripts/test-ai-waiting-runner.js`。
- 扩展 `scripts/test-writing-tutor.js`。
- 不删除旧的持久 Job、幂等、轮询、失败恢复测试。

### 6.6 文档

实现完成后更新：

- `docs/01_PRODUCT_REQUIREMENTS.md`
- `docs/02_ARCHITECTURE.md`（共享轮询控制发生结构变化时）
- `docs/03_UI_UX_SPEC.md`
- `docs/05_CHANGELOG.md`
- `docs/06_DECISIONS.md`（Web Audio 合成音；不使用数据库实时监听）
- `docs/07_TESTING_CHECKLIST.md`
- `docs/11_AGENT_TROUBLESHOOTING.md`（“成功但必须刷新”的根因）
- `README.md`（用户可见功能描述需要调整时）

---

## 7. 允许修改与禁止修改

### 7.1 允许修改

```text
ai-tutor.html
assets/js/ai-tutor.js
assets/js/ai-waiting-runner.js
assets/css/ai-waiting-runner.css
scripts/test-writing-tutor.js
scripts/test-ai-waiting-runner.js
docs/01_PRODUCT_REQUIREMENTS.md
docs/02_ARCHITECTURE.md
docs/03_UI_UX_SPEC.md
docs/05_CHANGELOG.md
docs/06_DECISIONS.md
docs/07_TESTING_CHECKLIST.md
docs/11_AGENT_TROUBLESHOOTING.md
README.md
```

### 7.2 禁止修改

```text
cloudfunctions/writingTutor/
cloudfunctions/writingAiWorker/
cloudfunctions/sendWritingTutorEmails/
cloudfunctions/_shared/
deploy-packages/
数据库集合和权限
Prompt / JSON Schema / 模型适配器
```

如果必须修改禁止区域，停止实施并向主 Agent 报告，不要自行扩大范围。

---

## 8. 分阶段执行顺序

能力较弱的执行者必须严格按顺序完成，每阶段先测试。

### Phase 1：先修改测试合同

1. 更新 Runner 测试：score、负分、一次扣分、3–7 collectibles、重复跳、二段跳、jump buffer。
2. 更新 Tutor 测试：任务阶段、无解释、Back、绿色 Upload Again、Ready 不自动跳转、结果按钮和声音保护。
3. 确认新测试因功能未实现而失败。

不要写宽松正则让错误代码通过。

### Phase 2：Runner 游戏改造

1. 改 score 数据。
2. 改碰撞一次扣分。
3. 改 collectibles 生成和绘制。
4. 改重复跳、二段跳、jump buffer。
5. 确保 pause/resume/destroy/reduced motion 不回归。
6. 只运行 Runner 测试，直到通过。

### Phase 3：进度轨道和文案

1. 建立 `waitingStageDefinitions(kind)`。
2. 改轨道 DOM 和 CSS。
3. 删除标题解释和 polling 可见文案。
4. `Continue in Background` 改 `Back`。
5. Upload Again 改绿色。
6. 运行 Tutor contract 测试。

### Phase 4：可靠轮询

1. 增加共享 timer/in-flight/wake/退避状态。
2. 依次改 OCR、review、rewrite、revision OCR。
3. 每改一类都验证 ready、failed、network error、stop generation。
4. 加 visible/focus/online 唤醒。
5. 验证没有重叠请求。

不要在这一阶段改结果 UI。

### Phase 5：Ready 保留页面、按钮、动画和声音

1. 改 `finishAiWaitingExperience` 为“保存一次性回调并进入 Ready”。
2. 加 `[data-view-waiting-result]` handler。
3. 加四种标题/按钮映射。
4. 加完成动画。
5. 加一次双音 Web Audio。
6. 改 `loadComposition` 的已完成恢复。
7. 验证 Ready 后游戏继续。

### Phase 6：全路径清理和回归

逐一验证：

1. failure
2. Back
3. Upload Again
4. 切换 Composition
5. pagehide
6. 刷新/重新登录/History reopen
7. 连续点击结果按钮
8. 网络断开和恢复

### Phase 7：文档、视觉 QA 和交付

1. 更新第 6.6 节文档。
2. 构建 `dist/`。
3. 本地 HTTP 服务测试。
4. 用手机、iPad、桌面尺寸截图检查。
5. 只提交允许范围。
6. 向主 Agent 报告，不自行部署。

---

## 9. 自动测试的最低要求

### 9.1 Runner 测试

`scripts/test-ai-waiting-runner.js` 至少验证：

- 第一次跳跃有效。
- 落地后第二次跳跃仍有效。
- 空中只允许一次额外跳跃。
- jump buffer 在落地时执行。
- 一个障碍只让 score 减 1。
- 不同障碍可以继续扣分。
- collectible 让 score 加 1。
- score 可以为负数。
- collectibles 数量保持 3–7。
- Ready 后 RAF 和游戏仍继续，直到用户进入结果或离开。
- pause 后停止更新；resume 不使用隐藏期间的大 delta。
- destroy 幂等。
- 无 fetch/CloudBase/storage/cookie。

测试需要随机稳定性时必须 stub `Math.random`，禁止概率性 flaky 测试。

### 9.2 Tutor 测试

`scripts/test-writing-tutor.js` 至少验证：

- 四套阶段文案按 kind 映射。
- 固定 `Queued` / `Analysing` 用户文案不再出现。
- 普通等待页不显示 explanation 和 polling copy。
- `Back` 存在，`Continue in Background` 不存在。
- `Upload Again` 使用绿色 class。
- 页面可见 3s、隐藏 10s、错误退避上限 20s。
- focus/online/visible 唤醒查询。
- 存在 in-flight guard。
- 四种 ready predicate 仍存在。
- success 只保存 result action，不自动执行。
- 四种结果按钮文案正确。
- Ready 后 Runner 没有 finish/stop。
- 结果按钮 action 最多一次。
- 页面隐藏或重新进入不补播声音。
- 音频失败不会阻断结果按钮。
- reduced motion 不自动导航。
- failure、Back、reupload、pagehide 清理 timer 和 Runner。

### 9.3 必跑命令

```bash
node --check assets/js/ai-tutor.js
node --check assets/js/ai-waiting-runner.js
node --check scripts/test-writing-tutor.js
node --check scripts/test-ai-waiting-runner.js
npm run test:writing-tutor
npm run test:waiting-runner
npm run verify:release
npm run build:static
git diff --check
```

不得为了通过测试删除旧断言。

---

## 10. 手工验收矩阵

### 10.1 每种任务

| 场景 | 正在等待 | Ready 按钮 | 实际进入 |
|---|---|---|---|
| OCR | Reading/Organising | Review Text | OCR Review |
| 通用语言批改 | Preparing/Reviewing | View Review | Language Review |
| 标化考试批改 | Preparing/Reviewing | View Review | Standardized Review |
| Rewrite Check | Comparing/Checking | View Feedback | Sentence Revision feedback/completion |
| Revision Scan | Reading/Matching | Review Scan | Review Scan cards |

### 10.2 自动更新

每类至少验证：

1. 页面保持打开，不刷新，结果出现。
2. 切到后台再回来，立即更新。
3. 断网 10 秒再恢复，自动继续。
4. ready 后继续玩 30 秒，结果按钮始终存在。
5. 快速双击结果按钮不会执行两次。
6. 从 History 重开已完成任务：显示 Ready，无补发声音。

### 10.3 游戏

- 连续完成至少 10 次跳跃。
- 测试一次二段跳。
- 碰一个障碍只减 1。
- score 从 0 进入负数。
- 吃 collectibles 回升。
- 随机多个绿色点不会长期只出现一个。
- Ready 后仍能跳、碰撞、加减分。

### 10.4 设备尺寸

- 320×568
- 375×812
- 390×844
- 430×932
- iPad 768×1024
- iPad 834×1194
- Desktop 1280×800 以上

所有尺寸不得横向溢出。结果按钮和 Back/Upload Again 不得遮挡 Canvas。

### 10.5 声音

- 当前可见页面从 pending 到 ready：播放一次。
- 重复 polling succeeded：不重复播放。
- 页面隐藏期间完成：不播放。
- 返回页面：不补播。
- 浏览器拒绝声音：无报错、动画与按钮正常。
- 双音总长度不超过约 500ms，音量柔和。

---

## 11. 完成定义

只有同时满足以下条件才可以报告完成：

- 四类等待页使用任务相关四阶段轨道。
- 普通解释和 `Waiting for the same...` 文案已删除。
- Runner 可持续跳跃，有二段跳和 jump buffer。
- 随机绿色 collectibles 保持 3–7。
- Score 可正可负，障碍一次扣 1，collectible 加 1。
- Upload Again 绿色，Background 按钮改成 Back。
- 页面无需刷新即可进入 Ready。
- Ready 不自动导航，Runner 继续。
- 下方正确结果按钮可随时进入。
- 完成动画和双音只触发一次。
- 重新进入已完成任务不补播声音。
- 所有自动测试和本地视觉检查通过。
- 没有云函数、数据库、Prompt、Schema 或模型改动。
- 文档同步完成。

---

## 12. 常见错误和禁止事项

- **错误：** 用时间推进 Reading → Organising。
  **正确：** 只根据 queued / processing / succeeded 映射。

- **错误：** 查询到 succeeded 后立即调用结果 renderer。
  **正确：** 保存一次性 action，显示 Ready，等学生点击。

- **错误：** Ready 后调用 Runner `finish()` 并停止游戏。
  **正确：** Runner 继续，进入结果或离开时才 destroy。

- **错误：** 每次 polling 都播放声音。
  **正确：** 只在本页观察到 pending → ready 的一次过渡播放。

- **错误：** 在后台完成，返回时补播声音。
  **正确：** 返回只显示 Ready，静默。

- **错误：** 使用数据库 realtime watch。
  **正确：** ADMINONLY 数据继续通过 `getComposition` 轮询。

- **错误：** 使用 `setInterval` 导致请求重叠。
  **正确：** Promise 完成后再 `setTimeout`，并有 in-flight guard。

- **错误：** 把 score 保存进学生档案。
  **正确：** score 纯内存，刷新清零。

- **错误：** 使用正式 Yellow STAR 美术。
  **正确：** 绿色小闪光 collectible，不与学校奖励混淆。

- **错误：** 为音效增加 mp3、远程 CDN 或第三方库。
  **正确：** Web Audio 合成，失败静默降级。

- **错误：** 为自动更新重写 Job backend。
  **正确：** 保留 durable backend，只修浏览器轮询和成功 UI handoff。

---

## 13. 向主 Agent 的最终交付格式

完成后必须报告：

1. 修改文件清单。
2. 每项冻结决定对应到哪个函数/class。
3. “必须刷新”的实际根因。
4. 轮询如何避免重叠和旧结果覆盖。
5. Ready 为什么不会自动导航。
6. 声音限制和降级行为。
7. 每条测试命令及结果。
8. 未测试的真实设备/真实账号路径。
9. 是否有任何云函数或数据改动；正确答案应为“没有”。
10. commit hash。

不要只写“已完成”或“测试通过”。主 Agent会独立 code review 和真实流程测试。
