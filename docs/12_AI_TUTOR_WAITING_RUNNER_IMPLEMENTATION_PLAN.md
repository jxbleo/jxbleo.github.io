# AI Tutor Waiting Experience / Mr. Cat Runner 工程实施计划

状态：历史实施计划，V1 已完成。后续改进必须改读
`docs/13_AI_TUTOR_WAITING_EXPERIENCE_V2_IMPLEMENTATION_PLAN.md`；本文件中“自动进入结果、无声音、Ink/Distance”等规则已被 V2 产品决定取代。
适用项目：Mr. Cat Academy `ai-tutor.html`
目标读者：需要直接执行任务的编码模型，包括能力较弱、上下文较短的模型
最后更新：2026-08-23（Asia/Shanghai）

## 0. 执行者必须先读

开始改代码前，必须依次阅读：

1. `AGENTS.md`
2. `README.md`
3. `docs/01_PRODUCT_REQUIREMENTS.md`
4. `docs/02_ARCHITECTURE.md` 中 `AI Tutor Writing Architecture`
5. `docs/03_UI_UX_SPEC.md` 中 `AI Tutor Writing`
6. `docs/04_DATA_MODEL.md` 中 `AI Tutor Writing Collections`
7. `docs/07_TESTING_CHECKLIST.md` 中 `AI Tutor Writing`
8. `docs/11_AGENT_TROUBLESHOOTING.md` 中 Writing Tutor 相关内容
9. `assets/js/ai-tutor.js`
10. `assets/css/ai-tutor.css`
11. `scripts/test-writing-tutor.js`

不要仅阅读本计划后盲目改动。现有后台任务已经支持断网、关闭浏览器、重新登录和幂等恢复；本任务的核心是改善等待界面，不能重写或削弱这些后台保证。

---

## 1. 一句话目标

把 AI Tutor 中四套“旋转圆圈 + 等待文字”界面统一为一个可信、可离开、可恢复的等待体验，并在安全的后台处理阶段提供原创的 `Mr. Cat Runner` 单键横向跑酷互动。

跑酷只负责消磨等待时间。真实 AI 状态仍来自服务器，游戏距离、收集物和动画绝不能伪装成 AI 进度。

---

## 2. 已确认的产品决定

以下决定视为冻结，执行者不要擅自重新选择：

### 2.1 等待体验覆盖范围

统一等待界面覆盖四类持久 AI 任务：

1. 作文照片 OCR：`ocr`
2. 作文正式批改：`review`
3. Sentence Revision 提交检查：`rewrite`
4. 订正稿照片识别与句子映射：`revision_ocr`

普通页面初始化（例如“正在打开这篇作文”）不是持久 AI 任务，继续使用轻量普通 Loading，不启动游戏。

### 2.2 游戏形式

- 游戏名称：`Mr. Cat Runner`
- 玩法参考：Chrome 断网小恐龙的单键无尽跑酷，不制作真正的马里奥关卡系统。
- 角色：原创 Mr. Cat，不使用 Mario、Chrome Dino 或其他受版权保护的角色、美术、音效。
- 手机操作：在游戏区域 `pointerdown` / 轻触立即跳跃。
- 电脑操作：空格、向上箭头、`W`；点击游戏区域也可跳跃。
- 游戏没有正式 Game Over。
- 撞到障碍后只短暂踉跄、减速并继续。
- 收集物为墨滴或字母卡，不使用金币、STAR 或任何可能被理解为正式奖励的图案。
- 临时显示 `Distance` 与 `Ink`，不写入数据库、不进入成绩、不进入 STAR、不跨页面保存。
- AI 完成后，游戏必须立即让位给真实结果。

### 2.3 状态与进度

等待界面只显示真实阶段：

- `Saved`
- `Queued`
- `Analysing`
- `Ready`

禁止显示无法准确计算的百分比、预计剩余秒数或伪造的逐步 AI 文案。

上传尚未完成、服务器尚未确认持久 Job 时，不得显示 `Saved`，也不得声称学生可以离开。

### 2.4 离开和恢复

- 持久 Job 建立后，显示 `Continue in Background`。
- 点击后回到 AI Tutor 作品区，不取消 Job。
- 刷新、关闭浏览器、重新登录或重新打开同一 Composition，必须恢复同一 Job。
- 游戏状态可以丢失；AI 任务状态绝对不能丢失。

### 2.5 完成与失败

- 成功：进入最长 500ms 的收尾动画，然后显示真实结果。
- `prefers-reduced-motion: reduce`、标签页隐藏或动画模块不可用时，直接显示结果，不等待动画。
- 失败：立即销毁游戏，显示现有错误卡片和重试操作。
- 游戏不能遮挡失败、断网或“上传仍未确认”的警告。

---

## 3. 非目标

本任务明确不做：

- 不修改 AI Prompt、JSON Schema、模型选择或模型 API。
- 不修改 Qwen / DeepSeek / Kimi 适配层。
- 不修改 `writingTutor`、`writingAiWorker` 或 CloudBase Job 数据模型。
- 不新增数据库集合。
- 不保存游戏分数、距离、失败次数或操作轨迹。
- 不添加排行榜、积分、STAR、成就或每日任务。
- 不播放声音，不调用振动 API。
- 不引入 Phaser、Pixi、Three.js、React、Vue 或其他游戏/UI 依赖。
- 不制作地图、平台层、敌人 AI、关卡、道具系统或角色成长。
- 不把游戏完成作为查看作文结果的前置条件。
- 不把 Job 轮询改成依赖游戏循环。

---

## 4. 当前代码基线

主要页面：

- `ai-tutor.html`
- `assets/js/ai-tutor.js`
- `assets/css/ai-tutor.css`

当前等待函数：

| 任务 | 渲染函数 | 轮询函数 | 成功出口 | 失败出口 |
|---|---|---|---|---|
| OCR | `renderOcrWaiting` | `startOcrPolling` | `showOcrResult` | `renderOcrFailure` |
| 正式批改 | `renderReviewWaiting` | `startReviewPolling` | `showReviewResult` | `renderReviewFailure` |
| 订正检查 | `renderRewriteWaiting` | `startRewritePolling` | `applyRewriteResult` | `renderRewriteFailure` |
| 订正稿 OCR | `renderRevisionScanWaiting` | `startRevisionScanPolling` | `renderRevisionScanReview` | `renderRevisionScanFailure` |

当前四个等待界面都使用 `.loading-state` 和 `.loading-orbit`。本任务应保留四套轮询和成功/失败判断，只统一可视外壳与游戏生命周期。

现有轮询约每 5 秒调用一次 `writingCall('getComposition', ...)`。不要改变轮询频率、Job ID、operation ID、Composition revision 或 active-job 发布保护。

---

## 5. 推荐文件结构

### 5.1 新增

```text
assets/js/ai-waiting-runner.js
assets/css/ai-waiting-runner.css
scripts/test-ai-waiting-runner.js
```

### 5.2 修改

```text
ai-tutor.html
assets/js/ai-tutor.js
scripts/test-writing-tutor.js
package.json
README.md
docs/01_PRODUCT_REQUIREMENTS.md
docs/02_ARCHITECTURE.md
docs/03_UI_UX_SPEC.md
docs/05_CHANGELOG.md
docs/06_DECISIONS.md
docs/07_TESTING_CHECKLIST.md
docs/11_AGENT_TROUBLESHOOTING.md
```

### 5.3 禁止修改

```text
cloudfunctions/writingTutor/
cloudfunctions/writingAiWorker/
cloudfunctions/sendWritingTutorEmails/
cloudfunctions/_shared/
```

如果实现过程中发现必须修改云函数才能完成等待游戏，先停止并重新检查方案；按当前架构不需要任何云函数改动。

---

## 6. 组件边界

### 6.1 游戏模块只负责 Canvas

`assets/js/ai-waiting-runner.js` 使用 IIFE 暴露一个小型全局接口：

```js
window.MrCatWaitingRunner = {
  mount: function(canvas, options) {},
  isSupported: function() {}
};
```

`mount` 返回控制器：

```js
{
  jump: function() {},
  setTaskState: function(state) {}, // queued | analysing | ready | failed
  finish: function(callback) {},
  pause: function() {},
  resume: function() {},
  destroy: function() {},
  snapshot: function() {}          // 仅测试用安全状态，不包含 DOM/定时器
}
```

规则：

- Canvas 模块不调用 CloudBase。
- Canvas 模块不知道 Composition、Job ID、学生 UID、作文内容或 AI 结果。
- Canvas 模块不负责轮询。
- Canvas 模块不导航页面。
- `finish(callback)` 的 callback 最多执行一次。
- `destroy()` 必须幂等；调用两次不得报错。
- 模块加载失败时，等待状态文字和后台轮询仍必须工作。

### 6.2 AI Tutor 负责等待外壳和真实状态

在 `assets/js/ai-tutor.js` 增加统一渲染器：

```js
function renderAiWaitingExperience(config) {}
function updateAiWaitingExperience(config) {}
function finishAiWaitingExperience(next) {}
function destroyAiWaitingExperience() {}
```

建议 `config`：

```js
{
  kind: 'ocr', // ocr | review | rewrite | revision_ocr
  jobStatus: 'queued',
  durable: true,
  title: 'Reading your handwriting',
  description: 'Your work has been safely submitted...',
  pollStatusId: 'ocr-poll-status',
  allowBackground: true,
  allowRetry: false,
  allowReupload: true
}
```

不要把四种任务的成功、失败、重试逻辑塞进游戏模块。统一渲染器只建立相同 DOM 和挂载游戏；原有四个函数继续决定具体按钮和轮询。

### 6.3 客户端状态

在 `state` 中新增：

```js
waitingRunner: null,
waitingKind: '',
waitingTaskState: ''
```

`waitingRunner` 只是运行时控制器，不得写入 localStorage、Composition 或网络请求。

所有会替换 `stage.innerHTML` 的非等待渲染入口，在必要时先调用 `destroyAiWaitingExperience()`。至少覆盖：

- 四类成功出口
- 四类失败出口
- `returnToTutorHome`
- `resetDraft`
- `loadComposition` 切换 Composition
- Fatal error
- 页面卸载

否则 Canvas 的 `requestAnimationFrame` 可能在 DOM 被移除后继续运行。

---

## 7. 等待页面 UI 规范

### 7.1 基本结构

```html
<section class="surface ai-waiting-experience" data-waiting-kind="review">
  <header class="ai-waiting-copy">
    <h2>Reviewing your writing</h2>
    <p>Your work has been safely submitted.</p>
    <p>You may leave while AI continues in the background.</p>
  </header>

  <ol class="ai-waiting-stages" aria-label="AI task status">
    <!-- Saved / Queued / Analysing / Ready -->
  </ol>

  <div class="runner-shell">
    <canvas class="runner-canvas"></canvas>
    <p class="runner-instruction">Tap or press Space to jump</p>
    <p class="runner-score" aria-hidden="true">Distance 0m · Ink 0</p>
  </div>

  <p class="section-hint" role="status" aria-live="polite"></p>
  <div class="form-actions"><!-- stage-specific buttons --></div>
</section>
```

允许根据现有字符串拼接风格实现，不要求引入模板库。

### 7.2 文案映射

| kind | 标题 | 安全描述 |
|---|---|---|
| `ocr` | `Reading your handwriting` | `Your photos are safely uploaded. You may leave while recognition continues.` |
| `review` | `Reviewing your writing` | `Your writing is safely submitted. You may leave while the review continues.` |
| `rewrite` | `Checking your attempts` | `Your attempts are safely saved. You may leave while checking continues.` |
| `revision_ocr` | `Matching your revisions` | `Your revision photos are safely uploaded. You may leave while recognition continues.` |

界面可保留必要的中文错误和恢复说明，但四个主要等待标题统一使用以上英文。

### 7.3 真实状态映射

```text
durable handoff confirmed        → Saved complete
job.status === queued            → Queued active
job.status === processing        → Analysing active
result durably present/succeeded → Ready complete
```

不要根据等待时间自动从 Queued 切到 Analysing。只有服务器状态变化才能切换。

`photo_uploading` 或其他尚未建立持久 Job 的状态：

- 显示 `Uploading`，不要显示 `Saved`。
- 不显示 `Continue in Background`。
- 不声称关闭浏览器后会继续。
- 默认不启动 Runner，以免分散学生对上传失败提示的注意。

### 7.4 操作按钮

- 持久任务的主离开操作文本：`Continue in Background`。
- 该按钮可继续复用 `data-return-home` 行为。
- 等待页面已经自动轮询，不再需要 `留在此页等待` 按钮。
- OCR 如产品规则仍允许同 Composition 重传，保留 `Upload Again` 次要操作。
- 只有网络交付不确定且原逻辑允许时，才显示安全重试按钮。
- 按钮顺序保持“次要操作在左，主要操作在右”；手机宽度可纵向堆叠。

### 7.5 响应式布局

- Runner 最大宽度：`640px`。
- 宽度：`min(100%, 640px)`。
- 建议比例：`16 / 7`。
- 手机不得产生横向页面滚动。
- iPad/桌面保持居中，不拉伸到整张大卡片宽度。
- 状态胶囊可换行，但不能横向溢出。
- 页面顶部原有工具栏保持不变。

---

## 8. Runner 游戏规则

### 8.1 世界和物理

使用固定逻辑坐标，例如：

```js
WORLD_WIDTH = 960
WORLD_HEIGHT = 420
GROUND_Y = 338
```

建议初始参数（允许小范围调试，不得发展为难度系统）：

```js
RUN_SPEED = 230          // world units / second
GRAVITY = 1700           // world units / second²
JUMP_VELOCITY = -650
STUMBLE_MS = 600
INVULNERABLE_MS = 1200
MIN_OBSTACLE_GAP = 330
MAX_OBSTACLE_GAP = 560
```

使用固定时间步或带上限的 delta：

- 正常逻辑目标 60fps。
- 单帧 delta 最大按 50ms 处理，避免切回标签页后角色穿透地面。
- 绘制使用 `requestAnimationFrame`。
- 标签页隐藏时暂停模拟；返回时重置上一帧时间。

### 8.2 跳跃

- 角色在地面或允许的宽限窗口内才可跳跃。
- `pointerdown` 立即设置跳跃速度，不能等 `click`。
- 键盘监听 Space、ArrowUp、`W`。
- 忽略 `event.repeat`。
- 当焦点位于 `input`、`textarea`、`select`、`button` 或可编辑元素时，不接管键盘。
- 只在 Runner 自己拥有焦点/等待页活跃时阻止默认空格滚动。
- 第一版不做二段跳、滑铲、长按高跳或攻击。

### 8.3 障碍物

第一版只需要 2–3 种原创、简单轮廓：

- 书本
- 竖立的铅笔
- 橡皮

生成时必须满足最小间距，不能产生理论上无法跳过的组合。

碰撞规则：

1. 角色进入 `stumble` 约 600ms。
2. 画面给出短促、克制的压缩/后仰反馈。
3. 临时降低地面滚动速度。
4. 进入约 1200ms 无敌时间，避免同一障碍连续触发。
5. 不显示 Game Over，不弹窗，不重置 AI 状态。

### 8.4 收集物

- 使用墨滴；以后可以增加字母卡，但第一版只实现一种。
- 每次收集增加 `Ink` 临时计数。
- 收集反馈只使用小幅 scale/opacity，不使用彩纸、音效或震动。
- 收集物不影响跳跃能力、速度或正式奖励。

### 8.5 距离

- `Distance` 根据游戏内滚动距离计算。
- 只用于本次视觉反馈。
- 不保存，不上传，不进入日志。
- 进入结果页或离开等待页后清零。

### 8.6 美术

- 禁止复制 Mario、Chrome Dino 或网上未知版权素材。
- MVP 可用 Canvas 原生图形绘制原创简化猫：圆角身体、耳朵、尾巴和两帧腿部变化。
- 跑步最多 2–4 帧；跳跃、踉跄各一个姿态即可。
- 障碍和墨滴同样用原创 Canvas 路径绘制。
- 色彩沿用 AI Tutor 的奶白、深墨绿和柔和强调色；游戏不使用高饱和大面积背景。

---

## 9. 成功收尾动画

当原有轮询发现结果已经持久化：

1. 调用 `finishAiWaitingExperience(next)`，不要直接长时间阻塞结果。
2. Runner 停止生成新障碍。
3. 右侧出现原创终点门或带勾标记。
4. 场景向左移动，让终点在约 300ms 内到达角色附近。
5. 显示 `Ready` 和一个状态勾。
6. 最迟 500ms 调用 `next()`，进入原有成功页面。

必须存在以下快速出口：

- Runner 未成功挂载：立即 `next()`。
- `document.hidden === true`：立即 `next()`。
- `prefers-reduced-motion: reduce`：立即或最多 150ms 淡化后 `next()`。
- 任何动画异常：catch 后立即 `next()`。

不要等角色完成一个长关卡，也不要让游戏延迟学生已经生成的结果。

四个成功出口的改动形式应类似：

```js
finishAiWaitingExperience(function() {
  showReviewResult({ composition: composition });
});
```

回调必须保证只执行一次。

---

## 10. 失败、断网和页面生命周期

### 10.1 失败

四个原有 `render*Failure` 继续作为唯一错误界面。进入失败界面前：

```js
destroyAiWaitingExperience();
```

失败界面不得保留 Canvas、Distance 或 Ink。

### 10.2 暂时无法轮询

如果 `getComposition` 临时失败但服务端任务可能仍在继续：

- Runner 可以继续运行。
- `aria-live` 状态改为网络恢复说明。
- 不把任务标记为失败。
- 不自动创建新请求。
- 不改变 operation ID。

### 10.3 页面隐藏

监听 `visibilitychange`：

- 隐藏：Runner `pause()`。
- 可见且等待页仍活跃：Runner `resume()`。
- 云端任务与普通轮询逻辑保持独立。

### 10.4 页面卸载

监听 `pagehide`，只销毁客户端 Runner。不得调用取消 Job 的 API。

---

## 11. Reduced Motion 和无障碍

### 11.1 Reduced Motion

`prefers-reduced-motion: reduce` 时：

- 不自动滚动地面。
- 不播放跑步、跳跃、踉跄或终点动画。
- 可以显示静态 Mr. Cat、地面和状态文字。
- AI 状态更新仍正常。
- 成功时直接进入结果或使用不超过 150ms 的 opacity 淡化。

### 11.2 键盘和屏幕阅读器

- Canvas 可获得焦点，必须有可理解的 `aria-label`。
- 提供一个语义 `Jump` 按钮作为键盘/辅助技术等价操作；可采用视觉克制但不能从辅助技术树中删除。
- 游戏分数默认 `aria-hidden="true"`，避免每帧朗读。
- AI Job 状态使用独立 `role="status" aria-live="polite"`。
- 任务完成和失败可以用一次礼貌播报，不能连续刷屏。
- 焦点不能被 Canvas 自动抢走；学生主动点击游戏后才将交互焦点留在游戏区域。

### 11.3 对比度

- 状态不能只靠颜色，必须同时有文字/勾。
- `Queued`、`Analysing` 和 `Ready` 的文字在浅色背景上满足可读性。
- `prefers-contrast: more` 时增加边框和背景不透明度。

---

## 12. CSS 约束

新文件 `assets/css/ai-waiting-runner.css` 只使用 `.ai-waiting-*` 和 `.runner-*` 命名空间，避免污染其他练习页。

必须包括：

- 卡片布局
- 状态阶段布局
- Runner 容器和 Canvas 尺寸
- 手机/iPad/桌面断点
- `:focus-visible`
- `prefers-reduced-motion`
- `prefers-contrast: more`
- `prefers-reduced-transparency`（浏览器支持时）

Canvas 内的游戏运动由 JS 绘制，不要用大量 DOM 节点或为每个障碍创建 HTML。

---

## 13. HTML 和缓存版本

在 `ai-tutor.html`：

1. 在 `ai-tutor.css` 后加载 `ai-waiting-runner.css`。
2. 在 `ai-tutor.js` 前加载 `ai-waiting-runner.js`。
3. 所有新增/修改静态资源使用新的 cache-busting 版本。

示例：

```html
<link rel="stylesheet" href="assets/css/ai-waiting-runner.css?v=YYYYMMDD-1">
<script src="assets/js/ai-waiting-runner.js?v=YYYYMMDD-1"></script>
<script src="assets/js/ai-tutor.js?v=YYYYMMDD-N"></script>
```

不要删除现有 auth、CloudBase 或 touch-behavior 资源。

---

## 14. 分阶段实施顺序

弱模型必须按顺序完成，每阶段先测试再进入下一阶段。

### Phase 1：建立测试和空组件

1. 新增 `scripts/test-ai-waiting-runner.js`。
2. 在 `package.json` 增加 `test:waiting-runner`。
3. 新增 Runner JS/CSS 空壳和公开接口。
4. 在 `ai-tutor.html` 加载资源。
5. 暂不替换现有等待界面。

验收：页面行为不变，所有旧测试通过，新组件接口测试通过。

### Phase 2：实现 Runner 引擎

1. Canvas DPR 和 ResizeObserver。
2. 固定时间步。
3. 原创猫绘制。
4. 跑步、跳跃、地面、障碍。
5. 柔性碰撞。
6. 墨滴和临时计数。
7. pause/resume/destroy。
8. Reduced Motion。

验收：可以在独立测试宿主中运行，不调用任何 AI/CloudBase API。

### Phase 3：统一等待外壳

1. 在 `ai-tutor.js` 增加统一等待渲染器。
2. 先迁移 `renderReviewWaiting`。
3. 验证断网、离开、恢复。
4. 再迁移 OCR、rewrite、revision OCR。
5. 移除四类持久等待中的 `.loading-orbit`，普通短 Loading 保留。

验收：四类任务都使用同一外壳，轮询逻辑未复制、未合并、未改变。

### Phase 4：完成/失败衔接

1. 实现最多 500ms 的 `finish`。
2. 四个成功出口接入。
3. 四个失败出口确保 destroy。
4. 页面隐藏、卸载、返回 Home、切换 Composition 全部清理。

验收：不存在残留 RAF、重复回调或结果被动画阻塞。

### Phase 5：可访问性和响应式 QA

1. 320/375/390/430px 手机。
2. iPad 768/834/1024px。
3. 桌面 1280px 以上。
4. 键盘。
5. VoiceOver/屏幕阅读器基本路径。
6. Reduced Motion、More Contrast。

### Phase 6：文档和发布

按 `AGENTS.md` 更新产品、架构、UI、决策、测试、变更日志和故障文档。只部署静态站点；不要部署云函数。

---

## 15. 自动测试要求

### 15.1 `test-ai-waiting-runner.js`

至少验证：

- `window.MrCatWaitingRunner.mount` 存在。
- `mount` 返回 `jump/setTaskState/finish/pause/resume/destroy`。
- `destroy()` 可重复调用。
- `finish` callback 最多执行一次。
- Reduced Motion 不启动连续动画。
- `pause` 后模拟位置不变化。
- 恢复时不会使用隐藏期间的巨大 delta。
- 碰撞进入 stumble，不进入 game-over。
- Ink 和 Distance 只存在于内存。
- 模块没有 `fetch`、CloudBase、localStorage、indexedDB 或 cookie 写入。
- 模块没有 Mario/Dino/coin/star 等受限素材或奖励命名。

测试可以使用最小 Canvas/RAF mock，不引入 jsdom 或新依赖。

### 15.2 扩展 `test-writing-tutor.js`

至少验证：

- 四个等待渲染函数调用统一等待外壳。
- 四个轮询函数仍存在并调用 `getComposition`。
- OCR/review/rewrite/revision OCR 的 ready 条件仍分别进入原成功出口。
- 四个失败出口仍存在。
- 持久等待界面不再使用 `.loading-orbit`。
- 普通 `renderLoading` 仍可使用轻量 indicator。
- `Continue in Background` 存在。
- 上传未确认状态不显示 safe-to-leave。
- Runner module missing 时等待页仍可渲染。
- success/failure/navigation 都销毁 Runner。

### 15.3 必跑命令

```bash
node --check assets/js/ai-waiting-runner.js
node --check assets/js/ai-tutor.js
node --check scripts/test-ai-waiting-runner.js
node --check scripts/test-writing-tutor.js
npm run test:waiting-runner
npm run test:writing-tutor
npm run verify:release
git diff --check
```

不要因为新增游戏而降低或删除现有 Writing Tutor 测试。

---

## 16. 手工验收清单

### 16.1 四类任务

分别实际触发：

- OCR
- General Language Review
- Standardized Content Review
- Sentence Revision Submit
- Revision Scan

确认每个安全等待阶段都显示正确标题、真实状态、Runner 和 `Continue in Background`。

### 16.2 后台恢复

对每类任务分别测试：

1. Queued 时刷新。
2. Processing 时刷新。
3. 关闭浏览器后重新登录。
4. 从 History 打开同一作文。
5. 暂时断网后恢复。

必须恢复同一个 Job，不得新建作文、重复扣额度或重复调用模型。

### 16.3 游戏

- 手机轻触立即跳跃。
- Space/ArrowUp/W 可跳跃。
- 输入框获得焦点时按 Space 不触发游戏。
- 碰撞不会 Game Over。
- Ink/Distance 不保存。
- Canvas 不导致页面横向溢出。
- 页面隐藏后 CPU 绘制暂停。
- 多次打开/关闭等待页无多个 Runner 同时运行。

### 16.4 结果衔接

- 结果到达后最多 500ms 进入结果。
- Reduced Motion 直接进入。
- 隐藏标签页不等待 RAF。
- 失败立即显示错误。
- 网络轮询暂时失败不误报 AI 失败。

---

## 17. 发布步骤

1. 检查工作树，只提交本任务文件。
2. 运行第 15.3 节全部命令。
3. 生成静态发布物并确认 Runner JS/CSS 被包含。
4. 提交到当前 `codex/` 分支。
5. 推送到 `main` 前重新确认没有云函数改动。
6. 等待腾讯 COS 和 GitHub Pages 工作流成功。
7. 在线检查 `ai-tutor.html` 的 cache version。
8. 下载线上 Runner JS/CSS，与本地做 SHA-256 对比。
9. 在真实手机至少完成一次 OCR 等待和一次 rewrite 等待。

本任务只需要静态站点发布，不需要重新部署 `writingTutor` 或 `writingAiWorker`。

---

## 18. 常见错误与禁止做法

- **错误：** 用 setTimeout 自动把 Queued 改成 Analysing。
  **正确：** 只响应服务器 Job 状态。

- **错误：** 游戏结束后才检查 AI。
  **正确：** 轮询独立运行，AI 一完成就中断游戏。

- **错误：** Canvas 被删掉但 RAF 继续运行。
  **正确：** 每个离开路径调用幂等 `destroy()`。

- **错误：** 上传尚未确认就告诉学生可以离开。
  **正确：** 只有持久 Job 建立后跨过 safe-to-leave 边界。

- **错误：** 为游戏新建数据库表或 analytics 日志。
  **正确：** 游戏完全临时、本地。

- **错误：** 使用金币、STAR、Mario、Dino 素材。
  **正确：** 原创 Mr. Cat、书本、铅笔、橡皮、墨滴。

- **错误：** 为 Runner 引入大型框架。
  **正确：** 原生 Canvas、Pointer Events、RAF。

- **错误：** 结果已返回仍播放数秒终点动画。
  **正确：** 最长 500ms，并提供即时 fallback。

- **错误：** 为了统一 UI 合并四套 Job 轮询。
  **正确：** 只统一渲染和 Runner 生命周期，保留任务特有判断。

---

## 19. Definition of Done

只有同时满足以下条件才算完成：

- 四类持久 AI 等待界面都使用统一体验。
- 只有真正安全的后台阶段才显示 `Saved` 和离开按钮。
- Mr. Cat Runner 在手机、iPad、电脑可使用。
- 游戏无正式失败、不保存、不影响 AI。
- AI 成功、失败、断网、刷新、重新登录都走正确路径。
- 结果到达后最多 500ms 显示。
- Reduced Motion 和键盘路径可用。
- 不存在残留 RAF、重复轮询或重复回调。
- 没有云函数、模型 Prompt、Schema、数据库或额度逻辑改动。
- 所有自动测试与 release verification 通过。
- 相关 canonical docs 已同步更新。
- 腾讯 COS 和 GitHub Pages 发布成功且线上资源校验一致。

---

## 20. 最终交接格式

执行模型完成后必须向 owner 报告：

```text
Files changed:
- ...

Behavior changed:
- ...

Docs updated:
- ...

Tests run:
- ...

Deployment:
- static only / not deployed

Remaining risks or owner actions:
- ...
```

不要只回复“已完成”。必须列出真实文件、测试结果、发布状态和未完成风险。
