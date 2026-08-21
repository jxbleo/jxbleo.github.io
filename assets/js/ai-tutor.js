(function(window, document) {
    'use strict';

    var state = {
        session: null,
        profile: null,
        writingProfile: [],
        quota: null,
        rubrics: [],
        compositions: [],
        filter: 'all',
        current: null,
        review: null,
        readOnly: false,
        screen: 'welcome',
        inputMethod: 'text',
        assessmentMode: 'language',
        rubricId: '',
        title: '',
        promptText: '',
        confirmedText: '',
        photoFiles: [],
        photoUrls: [],
        photoIds: [],
        ocr: null,
        activeSentence: 0,
        rewrites: {},
        rewriteResults: {},
        skipped: {},
        referenceOpen: {},
        rewriteFace: {},
        correctionRound: 0,
        busy: false,
        autosaveTimer: null,
        ocrPollGeneration: 0,
        ocrPollActive: false,
        reviewPollGeneration: 0,
        reviewPollActive: false,
        rewritePollGeneration: 0,
        rewritePollActive: false,
        sidebarOpen: false,
        editingTitleId: '',
        titleEditError: '',
        leaveDialogOpen: false,
        returnFocus: null
    };

    var app = document.getElementById('ai-tutor-app');
    var stage = document.getElementById('ai-tutor-stage');
    var statusBox = document.getElementById('global-status');
    var portfolioList = document.getElementById('portfolio-list');
    var portfolioSummary = document.getElementById('portfolio-summary');
    var writingProfileSummary = document.getElementById('writing-profile-summary');
    var portfolioSidebar = document.getElementById('portfolio-sidebar');
    var sidebarScrim = document.getElementById('sidebar-scrim');
    var portfolioToggle = document.getElementById('portfolio-toggle');
    var studentChip = document.getElementById('student-chip');
    var leaveConfirmation = document.getElementById('leave-confirmation');
    var sentenceCardResizeObserver = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function safeArray(value) { return Array.isArray(value) ? value : []; }
    function firstText() {
        for (var i = 0; i < arguments.length; i += 1) {
            if (arguments[i] != null && String(arguments[i]).trim()) return String(arguments[i]).trim();
        }
        return '';
    }

    function operationId(prefix) {
        var suffix = window.crypto && typeof window.crypto.randomUUID === 'function'
            ? window.crypto.randomUUID()
            : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        return prefix + '-' + suffix;
    }

    function logicalOperationId(prefix, fingerprint) {
        var key = 'mrcat-writing-operation:' + prefix + ':' + compositionId(state.current);
        try {
            var saved = JSON.parse(window.sessionStorage.getItem(key) || 'null');
            if (saved && saved.fingerprint === fingerprint && saved.operation_id) return saved.operation_id;
            var next = operationId(prefix);
            window.sessionStorage.setItem(key, JSON.stringify({ fingerprint: fingerprint, operation_id: next }));
            return next;
        } catch (error) {
            if (!state.logicalOperations) state.logicalOperations = {};
            if (state.logicalOperations[key] && state.logicalOperations[key].fingerprint === fingerprint) {
                return state.logicalOperations[key].operation_id;
            }
            var fallback = operationId(prefix);
            state.logicalOperations[key] = { fingerprint: fingerprint, operation_id: fallback };
            return fallback;
        }
    }

    function clearLogicalOperation(prefix) {
        var key = 'mrcat-writing-operation:' + prefix + ':' + compositionId(state.current);
        try { window.sessionStorage.removeItem(key); } catch (error) {}
        if (state.logicalOperations) delete state.logicalOperations[key];
    }

    function rewriteDraftStorageKey(composition) {
        var id = compositionId(composition);
        if (!id) return '';
        var owner = firstText(state.profile && state.profile.student_id, state.profile && state.profile._id, 'student');
        return 'mrcat-writing-rewrite-draft:v1:' + owner + ':' + id + ':' + Number(composition && composition.revision || 1);
    }

    function restoreRewriteDraftSnapshot(composition) {
        var key = rewriteDraftStorageKey(composition);
        if (!key) return {};
        try {
            var record = JSON.parse(window.localStorage.getItem(key) || 'null');
            if (!record || record.composition_id !== compositionId(composition)
                || Number(record.revision || 1) !== Number(composition && composition.revision || 1)
                || !record.rewrites || typeof record.rewrites !== 'object') return {};
            var restored = {};
            Object.keys(record.rewrites).slice(0, 100).forEach(function(id) {
                var value = String(record.rewrites[id] == null ? '' : record.rewrites[id]).slice(0, 3000);
                if (id && value) restored[id] = value;
            });
            Object.keys(restored).forEach(function(id) { state.rewrites[id] = restored[id]; });
            return restored;
        } catch (error) { return {}; }
    }

    function saveRewriteDraftSnapshot() {
        var key = rewriteDraftStorageKey(state.current);
        if (!key) return;
        var rewrites = {};
        Object.keys(state.rewrites || {}).slice(0, 100).forEach(function(id) {
            var value = String(state.rewrites[id] == null ? '' : state.rewrites[id]).slice(0, 3000);
            if (id && value) rewrites[id] = value;
        });
        try {
            if (!Object.keys(rewrites).length) {
                window.localStorage.removeItem(key);
                return;
            }
            window.localStorage.setItem(key, JSON.stringify({
                version: 1,
                composition_id: compositionId(state.current),
                revision: Number(state.current && state.current.revision || 1),
                rewrites: rewrites,
                updated_at: new Date().toISOString()
            }));
        } catch (error) {}
    }

    function clearAcceptedRewriteDrafts(results, passed) {
        if (passed === true) {
            var completedKey = rewriteDraftStorageKey(state.current);
            try { if (completedKey) window.localStorage.removeItem(completedKey); } catch (error) {}
            return;
        }
        safeArray(results).forEach(function(item) {
            var id = firstText(item && item.sentence_id, item && item.id);
            if (!id) return;
            if (item.accepted === true) delete state.rewrites[id];
            else if (firstText(item.student_rewrite)) state.rewrites[id] = item.student_rewrite;
        });
        saveRewriteDraftSnapshot();
    }

    function compositionId(composition) {
        return firstText(composition && composition.composition_id, composition && composition._id, composition && composition.id);
    }

    function compositionMode(composition) {
        var mode = firstText(composition && composition.assessment_mode, composition && composition.mode, 'language');
        if (mode === 'general_language') return 'language';
        if (mode === 'standardized_content') return 'standardized';
        return mode;
    }

    function apiMode(mode) { return mode === 'standardized' ? 'standardized_content' : 'general_language'; }

    function isPlaceholderTitle(value) {
        return /^untitled writing$/i.test(firstText(value));
    }

    function compositionTitle(composition) {
        var stored = firstText(composition && composition.title);
        if (stored && !isPlaceholderTitle(stored)) return stored;
        if (composition && composition.title_source === 'pending_ai') return '等待 AI 生成标题…';
        return '未命名作文';
    }

    function editableCompositionTitle(composition) {
        var stored = firstText(composition && composition.title);
        return isPlaceholderTitle(stored) ? '' : stored;
    }

    var sentencePalette = [
        { color: '#4169c1', soft: '#eaf1ff', active: '#dbe7ff', ring: 'rgba(65,105,193,.22)' },
        { color: '#b56a1f', soft: '#fff1dc', active: '#ffe3ba', ring: 'rgba(181,106,31,.22)' },
        { color: '#7652b8', soft: '#f0e9fd', active: '#e4d8fa', ring: 'rgba(118,82,184,.22)' },
        { color: '#b54868', soft: '#fce9ef', active: '#f7d8e1', ring: 'rgba(181,72,104,.22)' },
        { color: '#5060ad', soft: '#ebedff', active: '#dce0ff', ring: 'rgba(80,96,173,.22)' },
        { color: '#c45c3d', soft: '#ffeae4', active: '#ffd9cf', ring: 'rgba(196,92,61,.22)' },
        { color: '#856000', soft: '#fff6d8', active: '#ffedb0', ring: 'rgba(133,96,0,.22)' },
        { color: '#93306f', soft: '#fbeaf5', active: '#f5d5e9', ring: 'rgba(147,48,111,.22)' }
    ];

    function sentenceColorStyle(index) {
        var palette = sentencePalette[index % sentencePalette.length];
        return '--sentence-color:' + palette.color + ';--sentence-soft:' + palette.soft + ';--sentence-active:' + palette.active + ';--sentence-ring:' + palette.ring;
    }

    function highlightedManuscriptHtml(manuscript, sentences) {
        var source = String(manuscript || '');
        var cursor = 0;
        var html = '';
        sentences.forEach(function(sentence, index) {
            var original = String(sentence && sentence.original || '');
            if (!original) return;
            var matchAt = source.indexOf(original, cursor);
            if (matchAt < 0) return;
            var leadingWhitespace = (original.match(/^\s*/) || [''])[0];
            var withoutLeading = original.slice(leadingWhitespace.length);
            var trailingWhitespace = (withoutLeading.match(/\s*$/) || [''])[0];
            var visibleSentence = withoutLeading.slice(0, withoutLeading.length - trailingWhitespace.length);
            html += escapeHtml(source.slice(cursor, matchAt) + leadingWhitespace);
            html += '<span class="manuscript-sentence-highlight' + (index === state.activeSentence ? ' is-active' : '') + '" role="button" tabindex="0" data-sentence-index="' + index + '" data-manuscript-sentence="' + index + '" style="' + sentenceColorStyle(index) + '"' + (index === state.activeSentence ? ' aria-current="true"' : '') + ' aria-label="定位到第 ' + (index + 1) + ' 句的批改">' + escapeHtml(visibleSentence) + '</span>';
            html += escapeHtml(trailingWhitespace);
            cursor = matchAt + original.length;
        });
        return html + escapeHtml(source.slice(cursor));
    }

    function compositionStatus(composition) {
        return firstText(composition && composition.status, 'draft');
    }

    function profileName(profile) {
        return firstText(profile && profile.english_name, profile && profile.chinese_name, profile && profile.name, profile && profile.student_id, 'Student');
    }

    function formatDate(value) {
        var date = value ? new Date(value) : null;
        if (!date || Number.isNaN(date.getTime())) return '刚刚';
        try {
            return new Intl.DateTimeFormat('zh-CN', {
                timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric', year: 'numeric'
            }).format(date);
        } catch (error) { return date.toLocaleDateString(); }
    }

    function modeLabel(mode) { return mode === 'standardized' ? '标化考试' : '通用语言'; }

    function statusLabel(status) {
        var labels = {
            draft: '草稿', photo_uploading: '正在确认照片', ocr_queued: '等待识别', ocr_processing: '正在识别', ocr_failed: '识别失败', ocr_ready: '待确认', ocr_review: '待确认', ready: '等待批改', queued: '等待批改', evaluating: '正在批改',
            review_queued: '等待批改', review_processing: '正在批改', review_failed: '批改失败', standardized_ready: '评估完成', language_ready: '待逐句训练', review_ready: '待训练', reviewed: '评估完成', sentence_training: '待逐句训练', needs_revision: '需要再修改', completed: '已完成', failed: '稍后继续',
            rewrite_queued: '等待检查', rewrite_processing: '正在检查', rewrite_failed: '检查失败'
        };
        return labels[status] || status || '草稿';
    }

    function icon(name) {
        var paths = {
            plus: '<path d="M12 5v14M5 12h14"></path>',
            camera: '<rect x="3" y="6.5" width="18" height="13" rx="3"></rect><path d="m8 6.5 1.3-2h5.4l1.3 2"></path><circle cx="12" cy="13" r="3.2"></circle>',
            text: '<path d="M5 6h14M8 11h8M8 16h8"></path>',
            check: '<path d="m5 12 4.2 4.2L19 6.5"></path>',
            arrow: '<path d="M5 12h14M14 7l5 5-5 5"></path>',
            edit: '<path d="m4 16-.8 4.8L8 20l10.6-10.6a2.1 2.1 0 0 0-3-3L4 16Z"></path>',
            upload: '<path d="M12 16V4M7 9l5-5 5 5M5 16v3h14v-3"></path>',
            list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.1M4 12h.1M4 18h.1"></path>',
            focus: '<rect x="5" y="4" width="14" height="16" rx="3"></rect><path d="M9 9h6M9 13h6"></path>'
        };
        return '<svg aria-hidden="true" viewBox="0 0 24 24">' + (paths[name] || '') + '</svg>';
    }

    function setStatus(message) { statusBox.textContent = message || ''; }
    function setBusy(busy) {
        state.busy = Boolean(busy);
        app.setAttribute('aria-busy', busy ? 'true' : 'false');
        Array.prototype.forEach.call(document.querySelectorAll('[data-disable-when-busy]'), function(button) {
            button.disabled = Boolean(busy);
        });
    }

    function stopOcrPolling() {
        state.ocrPollActive = false;
        state.ocrPollGeneration += 1;
    }

    function stopReviewPolling() {
        state.reviewPollActive = false;
        state.reviewPollGeneration += 1;
    }

    function stopRewritePolling() {
        state.rewritePollActive = false;
        state.rewritePollGeneration += 1;
    }

    function writingCall(action, payload) {
        if (!window.MrCatCloud || typeof window.MrCatCloud.callFunction !== 'function') {
            return Promise.reject(new Error('AI Tutor 暂时无法连接 CloudBase。'));
        }
        return window.MrCatCloud.callFunction('writingTutor', Object.assign({ action: action }, payload || {})).then(function(result) {
            if (!result || result.success !== true) {
                var error = new Error(result && result.message || 'AI Tutor 暂时无法完成这个操作。');
                error.code = result && result.code;
                error.result = result;
                throw error;
            }
            return result;
        });
    }

    function normalizeCompositions(result) {
        return safeArray(result && (result.compositions || result.items || result.results)).filter(Boolean);
    }

    function renderPortfolio() {
        var items = state.compositions.filter(function(item) {
            return state.filter === 'all' || compositionMode(item) === state.filter;
        });
        var completed = state.compositions.filter(function(item) { return compositionStatus(item) === 'completed'; }).length;
        portfolioSummary.innerHTML = '<span class="summary-stat"><strong>' + state.compositions.length + '</strong>全部作品</span>' +
            '<span class="summary-stat"><strong>' + completed + '</strong>已经完成</span>';
        renderWritingProfile();
        if (!items.length) {
            portfolioList.innerHTML = '<div class="empty-sidebar">' + (state.compositions.length ? '这个筛选中还没有作文。' : '第一篇作文会出现在这里。') + '</div>';
            return;
        }
        portfolioList.innerHTML = items.map(function(item) {
            var id = compositionId(item);
            var mode = compositionMode(item);
            var active = state.current && compositionId(state.current) === id;
            var score = item.overall_score != null ? ' · ' + escapeHtml(item.overall_score) : '';
            if (state.editingTitleId === id) {
                return '<article class="portfolio-item is-editing' + (active ? ' is-active' : '') + '"><form class="portfolio-title-form" data-title-form="' + escapeHtml(id) + '">' +
                    '<label for="portfolio-title-' + escapeHtml(id) + '">修改作文标题<input id="portfolio-title-' + escapeHtml(id) + '" name="title" maxlength="80" autocomplete="off" value="' + escapeHtml(editableCompositionTitle(item)) + '" placeholder="输入一个短标题"></label>' +
                    (state.titleEditError ? '<p class="portfolio-title-error" role="alert">' + escapeHtml(state.titleEditError) + '</p>' : '') +
                    '<div class="portfolio-title-actions"><button class="quiet-button compact" type="button" data-cancel-title>取消</button><button class="primary-button compact" type="submit">保存</button></div></form></article>';
            }
            return '<article class="portfolio-item' + (active ? ' is-active' : '') + '"><button class="portfolio-open" type="button" data-open-composition="' + escapeHtml(id) + '">' +
                '<strong>' + escapeHtml(compositionTitle(item)) + '</strong>' +
                '<small>' + escapeHtml(formatDate(item.updated_at || item.created_at)) + score + '</small>' +
                '<span class="portfolio-item-meta"><span class="mini-badge ' + (mode === 'standardized' ? 'standardized' : '') + '">' + modeLabel(mode) + '</span>' +
                '<span class="mini-badge">' + escapeHtml(statusLabel(compositionStatus(item))) + '</span></span></button>' +
                '<button class="icon-button portfolio-title-edit" type="button" data-edit-title="' + escapeHtml(id) + '" aria-label="修改《' + escapeHtml(compositionTitle(item)) + '》的标题">' + icon('edit') + '</button></article>';
        }).join('');
    }

    function beginTitleEdit(id) {
        if (!id) return;
        state.editingTitleId = id;
        state.titleEditError = '';
        renderPortfolio();
        window.requestAnimationFrame(function() {
            var input = document.getElementById('portfolio-title-' + id);
            if (input) { input.focus(); input.select(); }
        });
    }

    function cancelTitleEdit() {
        state.editingTitleId = '';
        state.titleEditError = '';
        renderPortfolio();
    }

    function savePortfolioTitle(form) {
        var id = form.getAttribute('data-title-form');
        var input = form.querySelector('input[name="title"]');
        var title = firstText(input && input.value);
        if (!title) {
            state.titleEditError = '请输入作文标题。';
            renderPortfolio();
            return;
        }
        var submit = form.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        state.titleEditError = '';
        writingCall('updateCompositionTitle', { composition_id: id, title: title }).then(function(result) {
            var updated = result.composition || {};
            state.compositions = state.compositions.map(function(item) {
                return compositionId(item) === id ? Object.assign({}, item, updated) : item;
            });
            if (state.current && compositionId(state.current) === id) {
                state.current = Object.assign({}, state.current, updated);
                state.title = editableCompositionTitle(state.current);
            }
            state.editingTitleId = '';
            renderPortfolio();
        }).catch(function(error) {
            state.titleEditError = firstText(error && error.message, '标题没有保存，请重试。');
            renderPortfolio();
        });
    }

    function renderWritingProfile() {
        var patterns = safeArray(state.writingProfile).slice(0, 3);
        writingProfileSummary.innerHTML = patterns.length
            ? '<div class="writing-profile-list">' + patterns.map(function(item) {
                return '<span class="writing-profile-item"><span>' + escapeHtml(firstText(item.category, 'Other')) + '</span><b>' + escapeHtml(item.count || 1) + '</b></span>';
            }).join('') + '</div>'
            : '<p class="writing-profile-empty">完成语言批改后，这里会逐步积累值得反复练习的表达模式。</p>';
    }

    function refreshPortfolio() {
        return writingCall('listCompositions').then(function(result) {
            state.compositions = normalizeCompositions(result);
            if (safeArray(result.rubrics).length) state.rubrics = result.rubrics;
            renderPortfolio();
        });
    }

    function refreshWritingProfile() {
        return writingCall('getProfile').then(function(result) {
            state.writingProfile = safeArray(result.profile);
            if (result.quota) state.quota = result.quota;
            renderWritingProfile();
        });
    }

    function syncCurrentSummary() {
        if (!state.current) return;
        var id = compositionId(state.current);
        if (!id) return;
        var found = false;
        state.compositions = state.compositions.map(function(item) {
            if (compositionId(item) !== id) return item;
            found = true;
            return Object.assign({}, item, state.current);
        });
        if (!found) state.compositions.unshift(state.current);
        renderPortfolio();
    }

    function renderWelcome() {
        state.screen = 'welcome';
        stage.innerHTML = '<section class="surface">' +
            '<div class="hero"><p class="eyebrow">YOUR AI WRITING STUDIO</p><h2>把一篇作文，变成一次真正的训练。</h2>' +
            '<p>拍下手写作文或直接粘贴文字。你可以选择逐句改善英语，或按真实考试标准检查内容与结构。</p>' +
            (state.quota ? '<p><strong>今日还可批改 ' + escapeHtml(state.quota.words_remaining) + ' 词</strong> · 每日上限 ' + escapeHtml(state.quota.daily_word_limit) + ' 词</p>' : '') +
            '<div class="hero-actions"><button class="primary-button" type="button" data-start-new>' + icon('plus') + '开始新作文</button>' +
            (state.compositions.length ? '<button class="secondary-button" type="button" data-open-composition="' + escapeHtml(compositionId(state.compositions[0])) + '">继续最近作品</button>' : '') + '</div></div>' +
            '<div class="feature-grid"><article class="feature-card"><span class="feature-icon">' + icon('camera') + '</span><h3>拍照或输入</h3><p>OCR 后先由你确认文字，潦草笔迹也不会直接进入批改。</p></article>' +
            '<article class="feature-card"><span class="feature-icon">' + icon('text') + '</span><h3>两种批改</h3><p>通用语言批改不评分；标化考试内容批改忠实使用你选择的 Rubric。</p></article>' +
            '<article class="feature-card"><span class="feature-icon">' + icon('check') + '</span><h3>亲手重写</h3><p>读完建议后亲自改写，再一次性提交检查，让反馈变成能力。</p></article></div>' +
        '</section>';
    }

    function resetDraft(composition) {
        stopOcrPolling();
        stopReviewPolling();
        stopRewritePolling();
        state.photoUrls.forEach(function(url) { if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url); });
        state.current = composition || null;
        state.review = null;
        state.readOnly = false;
        state.inputMethod = 'text';
        state.assessmentMode = compositionMode(composition);
        state.rubricId = firstText(composition && composition.rubric_id);
        state.title = editableCompositionTitle(composition);
        state.promptText = firstText(composition && composition.prompt_text);
        state.confirmedText = firstText(composition && composition.confirmed_text, composition && composition.full_text);
        state.photoFiles = [];
        state.photoUrls = [];
        state.photoIds = [];
        state.ocr = null;
        state.activeSentence = 0;
        state.rewrites = {};
        state.rewriteResults = {};
        state.skipped = {};
        state.referenceOpen = {};
        state.rewriteFace = {};
        state.correctionRound = 0;
    }

    function createNewWriting() {
        if (state.busy) return;
        stopOcrPolling();
        stopReviewPolling();
        setStatus('');
        renderLoading('正在准备一张新的写作纸…', '你的输入会自动关联到这篇新作文。');
        setBusy(true);
        writingCall('createComposition', { assessment_mode: apiMode('language') }).then(function(result) {
            var composition = result.composition || result.item || {};
            if (safeArray(result.rubrics).length) state.rubrics = result.rubrics;
            if (!compositionId(composition) && result.composition_id) composition.composition_id = result.composition_id;
            if (!compositionId(composition)) throw new Error('新作文没有返回有效的编号。');
            resetDraft(composition);
            syncCurrentSummary();
            renderSource();
        }).catch(renderFatalAction).finally(function() { setBusy(false); });
    }

    function renderSource() {
        state.screen = 'source';
        var standardized = state.assessmentMode === 'standardized';
        var hasPhoto = state.photoUrls.length > 0;
        stage.innerHTML = '<section class="surface surface-pad"><div class="page-heading"><div><p class="eyebrow">NEW WRITING</p><h2>这一次想练什么？</h2>' +
            '<p>每次选择一种批改。标化考试内容批改会完全按照你选择的评分标准进行，不替你更换考试类型。</p></div><span class="step-indicator">第 1 步 · 输入作文</span></div>' +
            '<form class="form-stack" id="writing-source-form">' +
            '<section class="section-block"><p class="section-label">选择批改方式</p><div class="choice-grid">' +
            '<label class="choice-card"><input type="radio" name="assessment-mode" value="language" ' + (!standardized ? 'checked' : '') + '><span><strong>通用语言批改</strong><small>不评分。分析语法、用词、句式和不自然表达，再由你逐句重写。</small></span></label>' +
            '<label class="choice-card standardized"><input type="radio" name="assessment-mode" value="standardized" ' + (standardized ? 'checked' : '') + '><span><strong>标化考试内容批改</strong><small>按指定 Rubric 评估内容、结构和逻辑，并给出对应考试分数。</small></span></label></div></section>' +
            '<section class="section-block"><p class="section-label">输入方式</p><div class="input-switch" role="group" aria-label="输入作文的方式">' +
            '<button type="button" data-input-method="text" aria-pressed="' + (state.inputMethod === 'text') + '">' + icon('text') + '直接输入</button>' +
            '<button type="button" data-input-method="photo" aria-pressed="' + (state.inputMethod === 'photo') + '">' + icon('camera') + '拍照上传</button></div></section>' +
            '<section class="section-block"><label class="field"><span>作文名称 <small>（可选，留空由 AI 自动生成）</small></span><input id="writing-title" maxlength="80" autocomplete="off" placeholder="例如：My Ideal City" value="' + escapeHtml(state.title) + '"></label>' +
            '<label class="field"><span>作文题目' + (standardized ? ' <em>必填</em>' : ' <small>（语言批改可不填）</small>') + '</span><textarea id="writing-prompt" maxlength="6000" placeholder="粘贴或输入完整题目…">' + escapeHtml(state.promptText) + '</textarea></label>' +
            (standardized ? '<label class="field"><span>考试评分标准 <em>必选</em></span><select id="writing-rubric"><option value="">请选择 Rubric</option>' + rubricOptions(state.rubricId) + '</select></label>' : '') + '</section>' +
            '<section class="section-block" id="source-input-area">' + (state.inputMethod === 'photo' ? photoSourceHtml(hasPhoto) : textSourceHtml()) + '</section>' +
            '<div class="form-actions"><button class="secondary-button" type="button" data-return-home>稍后再写</button><button class="primary-button" type="submit" data-disable-when-busy>' + (state.inputMethod === 'photo' ? '上传并识别文字' : '保存并开始批改') + icon('arrow') + '</button></div>' +
            '</form></section>';
    }

    function rubricOptions(selected) {
        var options = state.rubrics.length ? state.rubrics : [
            { rubric_id: 'ielts_academic_task_1', label: 'IELTS Task 1' },
            { rubric_id: 'ielts_task_2', label: 'IELTS Task 2' },
            { rubric_id: 'hkdse_paper_2', label: 'DSE Paper 2' },
            { rubric_id: 'cambridge_9093_p2_shorter_writing', label: 'A Level 9093 · Shorter Writing' },
            { rubric_id: 'cambridge_9093_p2_reflective_commentary', label: 'A Level 9093 · Reflective Commentary' },
            { rubric_id: 'cambridge_9093_p2_extended_writing', label: 'A Level 9093 · Extended Writing' }
        ];
        return options.map(function(option) {
            var id = firstText(option.rubric_id, option.id);
            return '<option value="' + escapeHtml(id) + '" ' + (selected === id ? 'selected' : '') + (option.disabled ? ' disabled' : '') + '>' + escapeHtml(firstText(option.label, option.name, id)) + (option.disabled ? '（尚未开放）' : '') + '</option>';
        }).join('');
    }

    function textSourceHtml() {
        return '<label class="field"><span>英文作文正文 <em>必填</em></span><textarea class="manuscript" id="writing-text" maxlength="30000" placeholder="Type or paste your writing here…">' + escapeHtml(state.confirmedText) + '</textarea></label>';
    }

    function photoSourceHtml(hasPhoto) {
        if (hasPhoto) {
            return '<div class="photo-preview-grid">' + state.photoUrls.map(function(url, index) {
                return '<figure class="photo-preview-card"><span>第 ' + (index + 1) + ' 页</span><img src="' + escapeHtml(url) + '" alt="准备上传的作文第 ' + (index + 1) + ' 页"><div>' +
                    '<button class="quiet-button compact" type="button" data-move-photo="' + index + '" data-direction="up" ' + (index === 0 ? 'disabled' : '') + '>前移</button>' +
                    '<button class="quiet-button compact" type="button" data-move-photo="' + index + '" data-direction="down" ' + (index === state.photoUrls.length - 1 ? 'disabled' : '') + '>后移</button>' +
                    '<button class="danger-button compact" type="button" data-remove-photo="' + index + '">移除</button></div></figure>';
            }).join('') + '</div><label class="secondary-button compact add-photo-button">' + icon('plus') + '继续添加页面<input id="writing-photo" type="file" multiple accept="image/jpeg,image/png,image/webp"></label>';
        }
        return '<label class="photo-drop"><input id="writing-photo" type="file" multiple accept="image/jpeg,image/png,image/webp" capture="environment"><span><span class="photo-drop-icon">' + icon('camera') + '</span><strong>拍照或选择作文照片</strong><small>最多 8 页，可调整顺序。确认 OCR 后照片将被删除。</small></span></label>';
    }

    function sourcePayload() {
        return {
            composition_id: compositionId(state.current),
            title: state.title,
            prompt_text: state.promptText,
            confirmed_text: state.confirmedText,
            assessment_mode: apiMode(state.assessmentMode),
            rubric_id: state.assessmentMode === 'standardized' ? state.rubricId : null
        };
    }

    function scheduleAutosave() {
        window.clearTimeout(state.autosaveTimer);
        if (!compositionId(state.current) || state.busy) return;
        state.autosaveTimer = window.setTimeout(function() {
            writingCall('saveDraft', sourcePayload()).then(function(result) {
                if (result.composition) state.current = result.composition;
                syncCurrentSummary();
            }).catch(function() {});
        }, 900);
    }

    function validateSource() {
        if (state.assessmentMode === 'standardized' && !state.promptText) return '标化考试内容批改需要填写作文题目。';
        if (state.assessmentMode === 'standardized' && !state.rubricId) return '请选择这次使用的考试评分标准。';
        if (state.inputMethod === 'photo' && !state.photoFiles.length) return '请先拍照或选择至少一张作文照片。';
        if (state.inputMethod === 'text' && !state.confirmedText.trim()) return '请输入英文作文正文。';
        return '';
    }

    function submitSource() {
        var error = validateSource();
        if (error) { setStatus(error); return; }
        setStatus('');
        setBusy(true);
        if (state.inputMethod === 'photo') uploadAndExtract();
        else saveAndEvaluate();
    }

    function uploadAndExtract() {
        var ocrOperation = logicalOperationId('ocr', JSON.stringify({
            composition_id: compositionId(state.current),
            files: state.photoFiles.map(function(file) {
                return [file.name || '', file.size || 0, file.lastModified || 0, file.type || ''];
            })
        }));
        renderLoading('正在准备作文照片…', '照片上传后会先提取文字，再交给你确认。');
        Promise.all(state.photoFiles.map(function(file) {
            return window.MrCatCloud.prepareEvidenceImage(file);
        })).then(function(preparedPages) {
            return retryNetworkTask(function() { return writingCall('startPhotoUpload', {
                composition_id: compositionId(state.current),
                operation_id: ocrOperation,
                replace_current: Boolean(state.review || state.current && (state.current.standardized_review || state.current.language_review)),
                pages: preparedPages.map(function(prepared, index) {
                    return {
                        file_name: state.photoFiles[index].name || 'writing-' + (index + 1) + '.jpg',
                        mime_type: prepared.display.type || 'image/jpeg',
                        size_bytes: prepared.display.size
                    };
                })
            }).then(function(started) {
                if (started && started.job) return started;
                var uploads = safeArray(started.uploads);
                if (uploads.length !== preparedPages.length) throw new Error('照片上传信息不完整。');
                return Promise.all(uploads.map(function(upload, index) {
                    return window.MrCatCloud.uploadWithMetadata(upload, preparedPages[index].display);
                })).then(function() {
                    state.photoIds = uploads.map(function(upload) { return upload.photo_id; });
                    return writingCall('finishPhotoUpload', {
                        composition_id: compositionId(state.current),
                        photo_ids: state.photoIds,
                        operation_id: ocrOperation,
                        replace_current: Boolean(state.review || state.current && (state.current.standardized_review || state.current.language_review))
                    });
                });
            }); }, 2);
        }).then(function(finished) {
            if (finished && (finished.job || finished.composition && finished.composition.ocr_job)) return finished;
            return writingCall('extractOcr', {
                composition_id: compositionId(state.current),
                photo_ids: state.photoIds,
                operation_id: ocrOperation,
                replace_current: Boolean(state.review || state.current && (state.current.standardized_review || state.current.language_review))
            });
        }).then(function(result) {
            if (result.composition) state.current = result.composition;
            restoreOcrPhotoUrls(result);
            if (result.ocr || state.current && state.current.pending_ocr) {
                showOcrResult(result);
                return;
            }
            renderOcrWaiting(result.job || state.current && state.current.ocr_job, false);
            syncCurrentSummary();
        }).catch(function(error) {
            if (isNetworkDisconnect(error) && compositionId(state.current)) {
                renderOcrFailure({
                    code: 'PHOTO_UPLOAD_UNCONFIRMED',
                    message: '网络中断，暂时无法确认照片是否完整上传。请重新检查状态，或在同一篇作文里重新上传。'
                });
                return;
            }
            clearLogicalOperation('ocr');
            renderOcrFailure(error);
        }).finally(function() { setBusy(false); });
    }

    function isNetworkDisconnect(error) {
        return /network(?: request)? error|failed to fetch|networkerror|timeout/i.test(firstText(error && error.message));
    }

    function retryNetworkTask(task, retriesLeft) {
        return task().catch(function(error) {
            if (!isNetworkDisconnect(error) || retriesLeft < 1) throw error;
            return new Promise(function(resolve) { window.setTimeout(resolve, 1200); })
                .then(function() { return retryNetworkTask(task, retriesLeft - 1); });
        });
    }

    function restoreOcrPhotoUrls(result) {
        var raw = safeArray(result && result.ocr_photo_urls).length
            ? result.ocr_photo_urls
            : safeArray(result && result.composition && result.composition.ocr_photo_urls);
        if (!raw.length) return;
        state.photoUrls.forEach(function(url) { if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url); });
        state.photoUrls = raw.map(function(item) {
            return typeof item === 'string' ? item : firstText(item && item.url, item && item.temp_file_url, item && item.tempFileURL);
        }).filter(Boolean);
    }

    function ocrJobFrom(result) {
        return result && result.job || result && result.composition && result.composition.ocr_job || state.current && state.current.ocr_job || {};
    }

    function showOcrResult(result) {
        stopOcrPolling();
        if (result && result.composition) state.current = result.composition;
        restoreOcrPhotoUrls(result);
        state.ocr = result && result.ocr || state.current && state.current.pending_ocr || {};
        state.confirmedText = firstText(state.ocr.full_text, safeArray(state.ocr.paragraphs).join('\n\n'));
        clearLogicalOperation('ocr');
        renderOcr();
        syncCurrentSummary();
    }

    function renderOcrWaiting(job, autoPoll) {
        var status = firstText(job && job.status, state.current && state.current.status).toLowerCase();
        var uploadPending = status === 'photo_uploading';
        state.screen = 'ocr-waiting';
        stage.innerHTML = '<section class="surface loading-state"><span class="loading-orbit" aria-hidden="true"></span>' +
            '<strong>' + (uploadPending ? '正在确认照片上传状态' : '照片已安全上传，可以离开此页面') + '</strong>' +
            '<p>' + (uploadPending ? '照片尚未完整确认，暂时不能保证后台继续。如果长时间没有变化，请在同一篇作文里重新上传。' : (status === 'queued' || status === 'ocr_queued' ? 'OCR 已进入队列。' : 'OCR 正在云端识别。') + '离开或刷新不会中断，也不会创建新的作文。') + '</p>' +
            '<div class="form-actions"><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button>' +
            (uploadPending ? '<button class="primary-button" type="button" data-reupload>重新上传照片</button>' : '<button class="secondary-button" type="button" data-reupload>重新上传</button><button class="primary-button" type="button" data-stay-ocr>留在此页等待</button>') + '</div>' +
            '<p class="section-hint" id="ocr-poll-status" role="status" aria-live="polite">每 5 秒自动查询一次同一篇作文。</p></section>';
        if (autoPoll) startOcrPolling();
    }

    function startOcrPolling() {
        if (state.ocrPollActive || !compositionId(state.current)) return;
        state.ocrPollActive = true;
        state.ocrPollGeneration += 1;
        var generation = state.ocrPollGeneration;
        var status = document.getElementById('ocr-poll-status');
        var uploadPending = compositionStatus(state.current) === 'photo_uploading';
        if (status) status.textContent = uploadPending
            ? '正在确认照片是否完整上传；看到“照片已安全上传”后即可离开。'
            : '正在等待云端 OCR；每 5 秒查询一次。你随时可以离开。';
        function poll() {
            if (!state.ocrPollActive || generation !== state.ocrPollGeneration) return;
            writingCall('getComposition', { composition_id: compositionId(state.current) }).then(function(result) {
                if (!state.ocrPollActive || generation !== state.ocrPollGeneration) return;
                var composition = result.composition || {};
                state.current = composition;
                restoreOcrPhotoUrls(result);
                var job = ocrJobFrom(result);
                if (composition.pending_ocr) {
                    showOcrResult({ composition: composition, ocr: composition.pending_ocr, ocr_photo_urls: result.ocr_photo_urls });
                    return;
                }
                if (firstText(job.status).toLowerCase() === 'failed' || compositionStatus(composition) === 'ocr_failed') {
                    renderOcrFailure({ code: job.error_code || 'WRITING_AI_OCR_FAILED', message: 'OCR 识别没有完成。' });
                    return;
                }
                syncCurrentSummary();
                window.setTimeout(poll, 5000);
            }).catch(function(error) {
                if (!state.ocrPollActive || generation !== state.ocrPollGeneration) return;
                var pollStatus = document.getElementById('ocr-poll-status');
                var stillUploading = compositionStatus(state.current) === 'photo_uploading';
                if (pollStatus) pollStatus.textContent = stillUploading
                    ? '暂时无法确认上传，请保持此页面；网络恢复后会继续。'
                    : '暂时无法查询，网络恢复后会继续。作文和照片都已保存。';
                window.setTimeout(poll, 5000);
            });
        }
        poll();
    }

    function renderOcrFailure(error) {
        stopOcrPolling();
        var code = firstText(error && error.code, error && error.result && error.result.code, state.current && state.current.ocr_job && state.current.ocr_job.error_code);
        var messages = {
            LEGACY_OCR_JOB_NOT_RESUMABLE: '这次识别来自旧版流程，无法在后台恢复。请在同一篇作文中重新上传，不会新建作品。',
            PHOTO_UPLOAD_EXPIRED: '照片上传没有在 30 分钟内完整确认。请在同一篇作文中重新上传，不会新建作品。',
            WRITING_AI_OCR_EMPTY: '照片中没有识别到作文文字。请检查清晰度、方向和页面顺序，然后重新上传。',
            WRITING_AI_SCHEMA_RESPONSE_INVALID: 'AI 已读取照片，但没有返回完整的 OCR 格式。你可以重新检查状态，或重新上传更清晰的照片。',
            WRITING_AI_TIMEOUT: '云端 OCR 本次没有完成。原作文记录仍然保留。'
        };
        var message = messages[code] || firstText(error && error.message, 'OCR 本次没有完成。你可以重新检查云端状态，或重新上传照片。');
        state.screen = 'ocr-failed';
        stage.innerHTML = '<section class="surface error-state"><strong>OCR 识别没有完成</strong><p>' + escapeHtml(message) + '</p>' +
            '<div class="form-actions"><button class="secondary-button" type="button" data-retry-ocr>重新检查状态</button>' +
            '<button class="primary-button" type="button" data-reupload>重新上传照片</button></div>' +
            '<button class="quiet-button" type="button" data-return-home>返回 AI Tutor</button></section>';
    }

    function renderOcr() {
        state.screen = 'ocr';
        var uncertainCount = safeArray(state.ocr && state.ocr.uncertain_spans).length;
        stage.innerHTML = '<section class="surface surface-pad"><div class="page-heading"><div><p class="eyebrow">OCR REVIEW</p><h2>先确认识别文字</h2><p>请把文字和原图对照。你确认的电子文本才会进入 AI 批改。</p></div><span class="step-indicator">第 2 步 · 核对文字</span></div>' +
            (uncertainCount ? '<p class="notice">有 ' + uncertainCount + ' 处笔迹可能不够清楚，请重点检查后再继续。</p>' : '') +
            '<button class="secondary-button compact mobile-photo-toggle" type="button" data-toggle-ocr-photo aria-pressed="false">' + icon('camera') + '显示原图对照</button>' +
            '<div class="ocr-layout" id="ocr-layout"><section class="ocr-photo"><div class="panel-label"><span>原始照片（' + state.photoUrls.length + ' 页）</span></div>' + state.photoUrls.map(function(url, index) { return '<img src="' + escapeHtml(url) + '" alt="作文原始照片第 ' + (index + 1) + ' 页">'; }).join('') + '</section>' +
            '<section class="ocr-editor"><div class="panel-label"><span>可编辑 OCR 文本</span><small>请自行修正识别错误</small></div><textarea id="ocr-text" maxlength="30000" aria-label="OCR 识别文本">' + escapeHtml(state.confirmedText) + '</textarea></section></div>' +
            '<div class="form-actions"><button class="secondary-button" type="button" data-reupload>重新上传</button><button class="primary-button" type="button" data-confirm-ocr data-disable-when-busy>文字无误，开始批改' + icon('arrow') + '</button></div></section>';
    }

    function saveAndEvaluate() {
        renderLoading('AI 正在阅读你的作文…', state.assessmentMode === 'standardized' ? '将按照你选择的评分标准生成内容评估。' : '正在逐句整理语言建议和重写训练。');
        var evaluateOperation;
        return writingCall('saveDraft', sourcePayload()).then(function(result) {
            if (result.composition) state.current = result.composition;
            var fingerprint = JSON.stringify({
                composition_id: compositionId(state.current),
                revision: state.current && state.current.revision,
                mode: apiMode(state.assessmentMode),
                rubric_id: state.assessmentMode === 'standardized' ? state.rubricId : null,
                prompt_text: state.promptText,
                confirmed_text: state.confirmedText
            });
            evaluateOperation = logicalOperationId('evaluate', fingerprint);
            return writingCall('evaluate', {
                composition_id: compositionId(state.current),
                assessment_mode: apiMode(state.assessmentMode),
                rubric_id: state.assessmentMode === 'standardized' ? state.rubricId : null,
                operation_id: evaluateOperation
            });
        }).then(function(result) {
            if (result.composition) state.current = result.composition;
            if (result.review || reviewReady(state.current)) {
                showReviewResult(result);
                return;
            }
            renderReviewWaiting(reviewJobFrom(result), true, false);
            syncCurrentSummary();
        }).catch(function(error) {
            if (isNetworkDisconnect(error) && compositionId(state.current)) {
                renderReviewWaiting(state.current && state.current.active_job, true, true);
                setStatus('网络暂时中断。系统会查询同一篇作文；如请求未送达，可用同一个请求编号安全重试。');
                return;
            }
            if (reviewRequestMayBeRunning(error)) {
                renderReviewWaiting(state.current && state.current.active_job, true, true);
                return;
            }
            if (error && error.result) clearLogicalOperation('evaluate');
            renderReviewFailure(error);
        }).finally(function() { setBusy(false); });
    }

    function reviewJobFrom(result) {
        var job = result && result.job || result && result.composition && result.composition.active_job || state.current && state.current.active_job || {};
        return !job.job_type || job.job_type === 'review' ? job : {};
    }

    function reviewRequestMayBeRunning(error) {
        var code = firstText(error && error.code, error && error.result && error.result.code);
        return code === 'AI_OPERATION_IN_PROGRESS' || code === 'AI_JOB_ALREADY_QUEUED' || code === 'AI_JOB_PROCESSING';
    }

    function reviewReady(composition) {
        var status = compositionStatus(composition);
        if (status === 'standardized_ready') return Boolean(composition && composition.standardized_review);
        if (status === 'language_ready') return Boolean(composition && composition.language_review);
        var job = composition && composition.active_job || {};
        return job.job_type === 'review' && job.status === 'succeeded'
            && Boolean(composition.standardized_review || composition.language_review);
    }

    function showReviewResult(result) {
        stopReviewPolling();
        if (result && result.composition) state.current = result.composition;
        var mode = compositionMode(state.current);
        state.assessmentMode = mode;
        state.review = result && result.review || (mode === 'standardized'
            ? state.current && state.current.standardized_review
            : state.current && state.current.language_review) || {};
        state.readOnly = false;
        clearLogicalOperation('evaluate');
        syncCurrentSummary();
        if (mode === 'standardized') renderStandardized();
        else prepareLanguageReview();
        Promise.all([refreshPortfolio(), refreshWritingProfile()]).catch(function() {});
    }

    function renderReviewWaiting(job, autoPoll, allowRetry) {
        var jobStatus = firstText(job && job.status, state.current && state.current.status).toLowerCase();
        state.screen = 'review-waiting';
        stage.innerHTML = '<section class="surface loading-state"><span class="loading-orbit" aria-hidden="true"></span>' +
            '<strong>作文已经提交，可以离开此页面</strong>' +
            '<p>' + (jobStatus === 'queued' || jobStatus === 'review_queued' ? '批改已进入队列。' : 'AI 正在云端批改。') + '离开、刷新或重新登录都不会中断，也不会重复扣除字数额度。</p>' +
            '<div class="form-actions"><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button>' +
            (allowRetry ? '<button class="secondary-button" type="button" data-retry-review>用同一请求安全重试</button>' : '') +
            '<button class="primary-button" type="button" data-stay-review>留在此页等待</button></div>' +
            '<p class="section-hint" id="review-poll-status" role="status" aria-live="polite">每 5 秒查询一次同一篇作文。</p></section>';
        if (autoPoll) startReviewPolling();
    }

    function startReviewPolling() {
        if (state.reviewPollActive || !compositionId(state.current)) return;
        state.reviewPollActive = true;
        state.reviewPollGeneration += 1;
        var generation = state.reviewPollGeneration;
        var status = document.getElementById('review-poll-status');
        if (status) status.textContent = '正在等待云端批改；每 5 秒查询一次。你随时可以离开。';
        function poll() {
            if (!state.reviewPollActive || generation !== state.reviewPollGeneration) return;
            writingCall('getComposition', { composition_id: compositionId(state.current) }).then(function(result) {
                if (!state.reviewPollActive || generation !== state.reviewPollGeneration) return;
                var composition = result.composition || {};
                state.current = composition;
                var job = reviewJobFrom(result);
                if (reviewReady(composition)) {
                    showReviewResult({ composition: composition });
                    return;
                }
                if (firstText(job.status).toLowerCase() === 'failed' || compositionStatus(composition) === 'review_failed') {
                    renderReviewFailure({ code: job.error_code || 'WRITING_AI_REVIEW_FAILED', message: 'AI 批改没有完成。' });
                    return;
                }
                syncCurrentSummary();
                window.setTimeout(poll, 5000);
            }).catch(function() {
                if (!state.reviewPollActive || generation !== state.reviewPollGeneration) return;
                var pollStatus = document.getElementById('review-poll-status');
                if (pollStatus) pollStatus.textContent = '暂时无法查询，网络恢复后会继续。作文已经安全保存。';
                window.setTimeout(poll, 5000);
            });
        }
        poll();
    }

    function retryReviewRequest() {
        if (state.busy || !compositionId(state.current)) return;
        var fingerprint = JSON.stringify({
            composition_id: compositionId(state.current),
            revision: state.current && state.current.revision,
            mode: apiMode(state.assessmentMode),
            rubric_id: state.assessmentMode === 'standardized' ? state.rubricId : null,
            prompt_text: state.promptText,
            confirmed_text: state.confirmedText
        });
        var operation = logicalOperationId('evaluate', fingerprint);
        setBusy(true);
        renderReviewWaiting(state.current && state.current.active_job, true, false);
        writingCall('evaluate', {
            composition_id: compositionId(state.current),
            assessment_mode: apiMode(state.assessmentMode),
            rubric_id: state.assessmentMode === 'standardized' ? state.rubricId : null,
            operation_id: operation
        }).then(function(result) {
            if (result.composition) state.current = result.composition;
            if (result.review || reviewReady(state.current)) showReviewResult(result);
            else renderReviewWaiting(reviewJobFrom(result), true, false);
        }).catch(function(error) {
            if (isNetworkDisconnect(error)) {
                renderReviewWaiting(state.current && state.current.active_job, true, true);
                return;
            }
            if (reviewRequestMayBeRunning(error)) {
                renderReviewWaiting(state.current && state.current.active_job, true, true);
                return;
            }
            if (error && error.result) clearLogicalOperation('evaluate');
            renderReviewFailure(error);
        }).finally(function() { setBusy(false); });
    }

    function renderReviewFailure(error) {
        stopReviewPolling();
        var code = firstText(error && error.code, error && error.result && error.result.code, state.current && state.current.active_job && state.current.active_job.error_code);
        var messages = {
            WRITING_AI_TIMEOUT: '云端模型本次没有在时限内完成批改。作文仍然保留，可以使用同一请求安全重试。',
            WRITING_AI_SCHEMA_RESPONSE_INVALID: 'AI 返回的批改格式不完整。作文仍然保留，可以使用同一请求安全重试。',
            WRITING_AI_DAILY_LIMIT_REACHED: '今天的 AI 批改字数额度已经用完。请联系老师调整额度。'
        };
        var message = messages[code] || firstText(error && error.message, 'AI 批改本次没有完成。作文仍然安全保存。');
        clearLogicalOperation('evaluate');
        state.screen = 'review-failed';
        stage.innerHTML = '<section class="surface error-state"><strong>AI 批改没有完成</strong><p>' + escapeHtml(message) + '</p>' +
            '<div class="form-actions"><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button>' +
            (code === 'WRITING_AI_DAILY_LIMIT_REACHED' ? '' : '<button class="primary-button" type="button" data-retry-review>重新提交批改</button>') + '</div></section>';
    }

    function rewriteJobFrom(result) {
        var job = result && result.job || result && result.composition && result.composition.active_job || state.current && state.current.active_job || {};
        return job.job_type === 'rewrite' ? job : {};
    }

    function rewriteReady(composition) {
        var job = composition && composition.active_job || {};
        var record = composition && composition.rewrite_results || {};
        return job.job_type === 'rewrite' && job.status === 'succeeded'
            && Boolean(record.operation_id) && record.operation_id === job.operation_id;
    }

    function renderRewriteWaiting(job, autoPoll, allowRetry) {
        var jobStatus = firstText(job && job.status, state.current && state.current.status).toLowerCase();
        state.screen = 'rewrite-waiting';
        stage.innerHTML = '<section class="surface loading-state"><span class="loading-orbit" aria-hidden="true"></span>' +
            '<strong>改写已经提交，可以离开此页面</strong>' +
            '<p>' + (jobStatus === 'queued' || jobStatus === 'rewrite_queued' ? '检查已进入队列。' : 'AI 正在云端检查你的句子。') + '关闭浏览器、刷新或重新登录都不会中断，也不会重复调用 AI。</p>' +
            '<div class="form-actions"><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button>' +
            (allowRetry ? '<button class="secondary-button" type="button" data-retry-rewrite>用同一请求安全重试</button>' : '') +
            '<button class="primary-button" type="button" data-stay-rewrite>留在此页等待</button></div>' +
            '<p class="section-hint" id="rewrite-poll-status" role="status" aria-live="polite">每 5 秒查询一次同一篇作文。</p></section>';
        if (autoPoll) startRewritePolling();
    }

    function applyRewriteResult(result) {
        stopRewritePolling();
        if (result && result.composition) state.current = result.composition;
        var record = state.current && state.current.rewrite_results || {};
        var results = safeArray(record.results).length ? safeArray(record.results) : safeArray(result && result.results);
        results.forEach(function(item) {
            var id = firstText(item && item.sentence_id, item && item.id);
            if (!id) return;
            state.rewriteResults[id] = Object.assign({}, item, {
                student_rewrite: firstText(item.student_rewrite, state.rewrites[id])
            });
        });
        if (state.current && !state.current.rewrite_results && results.length) {
            state.current.rewrite_results = {
                operation_id: firstText(result && result.job && result.job.operation_id),
                results: results,
                passed: result && result.passed === true
            };
        }
        clearAcceptedRewriteDrafts(results,
            record.passed === true || result && result.passed === true || compositionStatus(state.current) === 'completed');
        state.review = state.current && state.current.language_review || state.review;
        clearLogicalOperation('rewrites');
        syncCurrentSummary();
        if (record.passed === true || result && result.passed === true || compositionStatus(state.current) === 'completed') {
            renderCompletion();
        } else {
            state.correctionRound += 1;
            prepareLanguageReview();
            var sentences = safeArray(state.review && state.review.sentences);
            state.activeSentence = Math.max(0, sentences.findIndex(function(sentence, index) {
                var answer = state.rewriteResults[sentenceId(sentence, index)];
                return answer && answer.accepted === false;
            }));
            renderLanguage();
            setStatus('统一检查完成：只需要再处理标记为“需要再修改”的句子。');
        }
        refreshPortfolio().catch(function() {});
    }

    function renderRewriteFailure(error) {
        stopRewritePolling();
        clearLogicalOperation('rewrites');
        var code = firstText(error && error.code, error && error.result && error.result.code);
        var messages = {
            WRITING_AI_SCHEMA_RESPONSE_INVALID: 'AI 返回的检查格式不完整。你的改写已经保存，可以直接重新检查。',
            WRITING_AI_TIMEOUT: 'AI 本次检查超时。你的改写已经保存，可以直接重新检查。',
            WRITING_AI_UNAVAILABLE: 'AI 服务暂时不可用。你的改写已经保存，可以稍后重新检查。',
            WRITING_AI_ATTEMPTS_EXHAUSTED: '多次自动重试仍未完成。你的改写已经保存，请稍后重新检查。'
        };
        var message = messages[code] || firstText(error && error.message, 'AI 本次没有完成检查。你的改写已经保存。');
        state.screen = 'rewrite-failed';
        stage.innerHTML = '<section class="surface error-state"><strong>改写检查没有完成</strong><p>' + escapeHtml(message) + '</p>' +
            '<div class="form-actions"><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button>' +
            '<button class="primary-button" type="button" data-return-rewrites>返回逐句修改</button></div></section>';
    }

    function startRewritePolling() {
        if (state.rewritePollActive || !compositionId(state.current)) return;
        state.rewritePollActive = true;
        state.rewritePollGeneration += 1;
        var generation = state.rewritePollGeneration;
        function poll() {
            if (!state.rewritePollActive || generation !== state.rewritePollGeneration) return;
            writingCall('getComposition', { composition_id: compositionId(state.current) }).then(function(result) {
                if (!state.rewritePollActive || generation !== state.rewritePollGeneration) return;
                var composition = result.composition || {};
                state.current = composition;
                state.review = composition.language_review || state.review;
                var job = rewriteJobFrom(result);
                if (rewriteReady(composition)) {
                    applyRewriteResult({ composition: composition });
                    return;
                }
                if (firstText(job.status).toLowerCase() === 'failed' || compositionStatus(composition) === 'rewrite_failed') {
                    renderRewriteFailure({ code: job.error_code || 'WRITING_AI_REWRITE_FAILED', message: 'AI 改写检查没有完成。' });
                    return;
                }
                syncCurrentSummary();
                window.setTimeout(poll, 5000);
            }).catch(function() {
                if (!state.rewritePollActive || generation !== state.rewritePollGeneration) return;
                var pollStatus = document.getElementById('rewrite-poll-status');
                if (pollStatus) pollStatus.textContent = '暂时无法查询，网络恢复后会继续。你的改写已经安全保存。';
                window.setTimeout(poll, 5000);
            });
        }
        poll();
    }

    function renderLoading(title, description) {
        state.screen = 'loading';
        stage.innerHTML = '<section class="surface loading-state"><span class="loading-orbit" aria-hidden="true"></span><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(description || '') + '</p></section>';
    }

    function renderStandardized() {
        state.screen = 'standardized';
        var review = state.review || {};
        var criteria = safeArray(review.criteria);
        var strengths = safeArray(review.strengths);
        var priorities = safeArray(review.priorities);
        var score = review.overall_score != null ? review.overall_score : '—';
        stage.innerHTML = (state.readOnly ? '<p class="readonly-banner">这是作品库中已保存的批改记录，只读显示。</p>' : '') +
            '<section class="surface"><div class="result-banner"><p class="eyebrow">STANDARDIZED ASSESSMENT · AI ESTIMATED</p><h2>' + escapeHtml(compositionTitle(state.current)) + '</h2><p>' + escapeHtml(firstText(review.summary, '本结果严格使用所选 Rubric，是 AI 学习建议，并非官方考试成绩。')) + '</p></div>' +
            '<div class="result-grid"><article class="score-card"><span class="score-value">' + escapeHtml(score) + '</span><span class="score-scale">' + escapeHtml(firstText(review.score_scale, state.rubricId, 'Selected rubric')) + '</span></article>' +
            '<article class="result-card"><h3>评分维度</h3><div class="criteria-list">' + (criteria.length ? criteria.map(function(item) {
                return '<div class="criterion-row"><strong>' + escapeHtml(firstText(item.name, item.criterion_id, 'Criterion')) + '</strong><b>' + escapeHtml(item.score) + (item.max_score != null ? ' / ' + escapeHtml(item.max_score) : '') + '</b><p>' + escapeHtml(item.rationale) + '</p></div>';
            }).join('') : '<p class="section-hint">这次评估没有返回分项成绩。</p>') + '</div></article></div>' +
            '<div class="feedback-grid"><article class="feedback-column"><h3>做得好的地方</h3>' + bulletList(strengths, '这次没有单独列出优点。') + '</article>' +
            '<article class="feedback-column priorities"><h3>优先改进</h3>' + bulletList(priorities, '这次没有单独列出优先改进项。') + '</article></div>' +
            (!state.readOnly ? '<div class="result-actions"><button class="secondary-button" type="button" data-edit-current>' + icon('edit') + '直接修改内容</button><button class="secondary-button" type="button" data-reupload>' + icon('upload') + '重新上传</button><button class="primary-button" type="button" data-enter-language>内容满意，进入语言批改' + icon('arrow') + '</button></div>' : '') +
            '</section>';
    }

    function bulletList(items, empty) {
        return items.length ? '<ul>' + items.map(function(item) {
            var copy = typeof item === 'string' ? item : [item.title, item.action, item.evidence].filter(Boolean).join(' — ');
            return '<li>' + escapeHtml(firstText(copy, item && item.text, item && item.feedback)) + '</li>';
        }).join('') + '</ul>' : '<p class="section-hint">' + escapeHtml(empty) + '</p>';
    }

    function prepareLanguageReview() {
        var sentences = safeArray(state.review && state.review.sentences);
        var storedResults = safeArray(state.current && state.current.rewrite_results && state.current.rewrite_results.results);
        var storedById = {};
        storedResults.forEach(function(item) { if (item && item.sentence_id) storedById[item.sentence_id] = item; });
        state.rewrites = {};
        state.rewriteResults = {};
        state.skipped = {};
        state.referenceOpen = {};
        state.rewriteFace = {};
        state.activeSentence = 0;
        sentences.forEach(function(sentence) {
            var id = sentenceId(sentence);
            var stored = storedById[id] || sentence.rewrite_result;
            state.rewrites[id] = firstText(sentence.student_rewrite, sentence.rewrite_text, stored && stored.student_rewrite);
            if (stored) {
                state.rewriteResults[id] = stored;
                if (stored.accepted === true) state.rewriteFace[id] = true;
            }
        });
        safeArray(state.current && state.current.pending_rewrite_items).forEach(function(item) {
            var id = firstText(item && item.sentence_id);
            if (id) state.rewrites[id] = firstText(item && item.text, state.rewrites[id]);
        });
        restoreRewriteDraftSnapshot(state.current);
        if (safeArray(state.current && state.current.pending_rewrite_items).length) saveRewriteDraftSnapshot();
        renderLanguage();
    }

    function sentenceId(sentence, index) { return firstText(sentence && sentence.sentence_id, sentence && sentence.id, 's' + ((index || 0) + 1)); }
    function rewriteRequired(sentence) {
        return Boolean(sentence) && sentence.rewrite_required !== false && ['effective', 'correct', 'no_change'].indexOf(sentence.status) === -1;
    }
    function coordinateReferenceAndRewrite(showRewrite, referenceOpen) {
        return {
            analysisHidden: Boolean(showRewrite),
            rewriteHidden: !showRewrite,
            referenceHidden: Boolean(showRewrite) || !referenceOpen
        };
    }

    function activeSentenceCardFace(inner) {
        if (!inner) return null;
        return inner.querySelector(inner.classList.contains('show-rewrite')
            ? '.sentence-rewrite-face'
            : '.sentence-analysis-face');
    }

    function syncSentenceCardHeight(inner) {
        if (!inner || inner.classList.contains('sentence-card-inner-static')) return;
        var face = activeSentenceCardFace(inner);
        if (!face) return;
        inner.style.height = Math.ceil(face.offsetHeight) + 'px';
        inner.classList.add('has-measured-height');
    }

    function observeSentenceCardHeights() {
        if (sentenceCardResizeObserver) sentenceCardResizeObserver.disconnect();
        if (!window.ResizeObserver) return;
        sentenceCardResizeObserver = sentenceCardResizeObserver || new window.ResizeObserver(function(entries) {
            entries.forEach(function(entry) {
                var inner = entry.target.closest('.sentence-card-inner');
                if (inner && activeSentenceCardFace(inner) === entry.target) syncSentenceCardHeight(inner);
            });
        });
        Array.prototype.forEach.call(document.querySelectorAll('.sentence-card-inner:not(.sentence-card-inner-static)'), function(inner) {
            syncSentenceCardHeight(inner);
            var face = activeSentenceCardFace(inner);
            if (face) sentenceCardResizeObserver.observe(face);
        });
    }

    function renderLanguage() {
        state.screen = 'language';
        var sentences = safeArray(state.review && state.review.sentences);
        if (!sentences.length) {
            stage.innerHTML = '<section class="surface empty-state"><strong>没有需要重写的句子</strong><p>这次批改没有返回逐句训练内容。</p><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button></section>';
            return;
        }
        if (state.activeSentence >= sentences.length) state.activeSentence = Math.max(0, sentences.length - 1);
        var cards = sentences.map(sentenceCardHtml).join('');
        var manuscript = firstText(state.current && state.current.confirmed_text, state.confirmedText, '暂无原文。');
        stage.innerHTML = '<div class="language-review-stack">' +
            '<section class="surface language-review-card language-overall-card"><h2>Language Review</h2>' + (state.readOnly ? '<p class="language-readonly-note">这是作品库中已保存的语言训练记录，只读显示。</p>' : '') + '<p>' + escapeHtml(firstText(state.review && state.review.overview, state.review && state.review.summary, '请阅读整体建议，再逐句完成需要修改的表达。')) + '</p></section>' +
            '<section class="surface language-review-card language-manuscript-card"><div class="language-section-heading"><h2>Draft</h2></div><div class="manuscript-text">' + highlightedManuscriptHtml(manuscript, sentences) + '</div></section>' +
            '<section class="surface language-review-card language-sentence-review-card">' +
            '<nav class="language-toolbar" aria-label="句子导航"><div class="capsule-row">' + sentences.map(sentenceCapsuleHtml).join('') + '</div></nav>' +
            '<div class="language-section-heading sentence-review-heading"><h2>Sentence Revision</h2></div>' +
            '<div class="sentence-stage"><div class="sentence-list">' + cards + '</div></div>' +
            (!state.readOnly ? '<div class="batch-actions"><button class="primary-button" type="button" data-submit-rewrites data-disable-when-busy>Check</button></div>' : '') +
            (state.readOnly ? '<div class="form-actions language-card-footer"><button class="secondary-button" type="button" data-return-home>返回作品库</button></div>' : '') +
            '</section></div>';
        window.requestAnimationFrame(observeSentenceCardHeights);
    }

    function sentenceCapsuleHtml(sentence, index) {
        var id = sentenceId(sentence, index);
        var result = state.rewriteResults[id];
        var done = !rewriteRequired(sentence) || result && result.accepted === true;
        var review = result && result.accepted === false;
        var missing = rewriteRequired(sentence) && !done && (!firstText(state.rewrites[id]) || state.skipped[id]);
        var capsuleStatus = done ? '，已完成' : review ? '，需要再修改' : missing ? '，尚未完成' : '';
        return '<button class="sentence-capsule' + (index === state.activeSentence ? ' is-active' : '') + (done ? ' is-done' : '') + (review ? ' is-review' : '') + (missing ? ' has-gap' : '') + '" type="button" data-sentence-index="' + index + '" style="' + sentenceColorStyle(index) + '" aria-pressed="' + (index === state.activeSentence) + '"' + (index === state.activeSentence ? ' aria-current="true"' : '') + ' aria-label="第 ' + (index + 1) + ' 句' + capsuleStatus + '">' + (index + 1) + '</button>';
    }

    function sentenceCardHtml(sentence, index) {
        var id = sentenceId(sentence, index);
        var required = rewriteRequired(sentence);
        var result = state.rewriteResults[id];
        var accepted = !required || result && result.accepted === true;
        var needsReview = result && result.accepted === false;
        var cardClass = 'sentence-card' + (!required ? ' is-effective' : '') + (index === state.activeSentence ? ' is-active' : '') + (accepted ? ' is-accepted' : '') + (needsReview ? ' needs-review' : '');
        var cardStart = '<article class="' + cardClass + '" id="sentence-card-' + escapeHtml(id) + '" data-sentence-card="' + escapeHtml(id) + '" style="' + sentenceColorStyle(index) + '">';
        var original = '<span class="sentence-original-highlight">' + escapeHtml(sentence.original) + '</span>';
        var sentenceNumber = '<span class="sentence-row-number" aria-hidden="true">' + (index + 1) + '</span>';
        var revisionState = !required ? 'correct' : accepted ? 'revised' : 'needs-revision';
        var revisionLabel = revisionState === 'correct' ? 'CORRECT' : revisionState === 'revised' ? 'REVISED' : 'NEEDS REVISION';
        var revisionMark = revisionState === 'needs-revision' ? '×' : '✓';
        var sentenceMeta = '<div class="sentence-card-meta">' + sentenceNumber +
            '<span class="sentence-state is-' + revisionState + '">' + revisionLabel +
            ' <span class="sentence-state-mark" aria-hidden="true">' + revisionMark + '</span></span></div>';
        if (!required) {
            return cardStart +
                '<div class="sentence-flip-card"><div class="sentence-card-inner sentence-card-inner-static">' +
                '<section class="sentence-card-face sentence-effective-face">' + sentenceMeta +
                '<p class="original-sentence">' + original + '</p></section>' +
                '</div></div></article>';
        }
        var showRewrite = Boolean(state.rewriteFace[id]);
        var referenceOpen = Boolean(state.referenceOpen[id]);
        var visibility = coordinateReferenceAndRewrite(showRewrite, referenceOpen);
        var issues = safeArray(sentence.issues);
        var rewriteFeedback = result ? firstText(result.feedback, result.accepted ? '这句话已经修复。' : '请根据反馈再修改一次。') : '';
        var analysisParts = [];
        function addAnalysisPart(value) {
            var copy = firstText(value);
            if (copy && analysisParts.indexOf(copy) === -1) analysisParts.push(copy);
        }
        addAnalysisPart(sentence.coaching_summary);
        issues.forEach(function(issue) {
            addAnalysisPart(issue && issue.explanation);
            addAnalysisPart(issue && issue.suggestion);
        });
        addAnalysisPart(rewriteFeedback);
        var analysisCopy = analysisParts.map(function(part) {
            return /[。！？!?；;.]$/.test(part) ? part : part + '。';
        }).join(' ') || '请根据建议调整这句话。';
        var analysisFaceId = 'sentence-analysis-' + id;
        var rewriteFaceId = 'sentence-rewrite-' + id;
        var reference = '<div class="reference-panel" aria-hidden="' + visibility.referenceHidden + '"' + (visibility.referenceHidden ? ' hidden' : '') + '><small>AI 参考修改</small><p>' + escapeHtml(sentence.reference_revision) + '</p></div>';
        var sampleButton = firstText(sentence.reference_revision)
            ? '<div class="sample-action"><button class="quiet-button compact sample-button" type="button" data-toggle-reference="' + escapeHtml(id) + '" aria-expanded="' + referenceOpen + '">Sample</button></div>'
            : '';
        var analysisFace = '<section class="sentence-card-face sentence-analysis-face" id="' + escapeHtml(analysisFaceId) + '" aria-hidden="' + visibility.analysisHidden + '"' + (visibility.analysisHidden ? ' inert' : '') + '>' +
            '<button class="sentence-face-flip-hit" type="button" data-flip-sentence="' + escapeHtml(id) + '" data-face="rewrite" aria-controls="' + escapeHtml(rewriteFaceId) + '" aria-pressed="' + showRewrite + '" aria-label="翻到句子改写面"></button>' +
            '<div class="sentence-face-content">' +
            sentenceMeta + '<p class="original-sentence">' + original + '</p>' +
            '<section class="grammar-analysis" aria-label="语法建议"><p class="grammar-analysis-copy">' + escapeHtml(analysisCopy) + '</p></section>' +
            sampleButton + reference + '</div></section>';
        var correctedSentence = firstText(result && result.student_rewrite, state.rewrites[id]);
        var correctedResponse = '<p class="corrected-sentence"><span class="sentence-corrected-highlight">' + escapeHtml(correctedSentence) + '</span></p>';
        var editableResponse = '<p class="original-sentence">' + original + '</p>' +
            '<div class="rewrite-area"><label for="rewrite-' + escapeHtml(id) + '">你的改写</label><textarea class="rewrite-input" id="rewrite-' + escapeHtml(id) + '" data-rewrite-id="' + escapeHtml(id) + '" placeholder="不要照抄，按自己的理解重写这句话…" ' + (state.readOnly ? 'disabled' : '') + '>' + escapeHtml(state.rewrites[id]) + '</textarea></div>';
        var rewriteFace = '<section class="sentence-card-face sentence-rewrite-face" id="' + escapeHtml(rewriteFaceId) + '" aria-hidden="' + visibility.rewriteHidden + '"' + (visibility.rewriteHidden ? ' inert' : '') + '>' +
            '<button class="sentence-face-flip-hit" type="button" data-flip-sentence="' + escapeHtml(id) + '" data-face="analysis" aria-controls="' + escapeHtml(analysisFaceId) + '" aria-pressed="' + (!showRewrite) + '" aria-label="翻到句子分析面"></button>' +
            '<div class="sentence-face-content">' + sentenceMeta + '<div class="sentence-response">' + (accepted ? correctedResponse : editableResponse) +
            '</div></div></section>';
        return cardStart + '<div class="sentence-flip-card"><div class="sentence-card-inner' + (showRewrite ? ' show-rewrite' : '') + '" data-face="' + (showRewrite ? 'rewrite' : 'analysis') + '">' + analysisFace + rewriteFace + '</div></div></article>';
    }

    function submitRewrites() {
        var sentences = safeArray(state.review && state.review.sentences);
        var required = sentences.filter(rewriteRequired);
        var missing = required.find(function(sentence, index) {
            var id = sentenceId(sentence, index);
            var result = state.rewriteResults[id];
            return !(result && result.accepted) && !firstText(state.rewrites[id]);
        });
        if (missing) {
            var missingId = sentenceId(missing, sentences.indexOf(missing));
            state.skipped[missingId] = true;
            state.activeSentence = sentences.indexOf(missing);
            setStatus('还有句子没有完成。已带你回到第一个未完成的位置。');
            renderLanguage();
            return;
        }
        var pending = required.filter(function(sentence, index) {
            var result = state.rewriteResults[sentenceId(sentence, index)];
            return !(result && result.accepted === true);
        });
        if (!pending.length) {
            clearAcceptedRewriteDrafts(Object.keys(state.rewriteResults).map(function(id) { return state.rewriteResults[id]; }), true);
            renderCompletion();
            return;
        }
        saveRewriteDraftSnapshot();
        setStatus('');
        renderLoading('正在统一检查你的改写…', '会检查是否保留原意、修复目标问题，以及有没有产生新的错误。');
        setBusy(true);
        var submittedItems = pending.map(function(sentence, index) {
            var id = sentenceId(sentence, index);
            return { sentence_id: id, text: firstText(state.rewrites[id]) };
        });
        var rewriteFingerprint = JSON.stringify({
            composition_id: compositionId(state.current),
            revision: state.current && state.current.revision,
            items: submittedItems
        });
        var rewriteOperation = logicalOperationId('rewrites', rewriteFingerprint);
        writingCall('submitRewrites', {
            composition_id: compositionId(state.current),
            operation_id: rewriteOperation,
            items: submittedItems
        }).then(function(result) {
            if (result.composition) state.current = result.composition;
            if (safeArray(result.results).length || rewriteReady(state.current)) {
                applyRewriteResult(result);
                return;
            }
            renderRewriteWaiting(rewriteJobFrom(result), true, false);
            syncCurrentSummary();
        }).catch(function(error) {
            if (isNetworkDisconnect(error) && compositionId(state.current)) {
                renderRewriteWaiting(state.current && state.current.active_job, true, true);
                setStatus('网络暂时中断。系统会继续查询同一次改写检查，不会重复调用 AI。');
                return;
            }
            if (error && error.result) clearLogicalOperation('rewrites');
            renderRewriteFailure(error);
        }).finally(function() { setBusy(false); });
    }

    function renderCompletion() {
        state.screen = 'completed';
        stage.innerHTML = '<section class="surface completion-card"><span class="completion-icon">' + icon('check') + '</span><p class="eyebrow">WRITING COMPLETE</p><h2>这次训练完成了。</h2>' +
            '<p>你的原文、语言观察和改写记录已经保存到 Writing Portfolio。查看过参考句同样算完成，它只是帮助方式的一部分。</p>' +
            '<div class="hero-actions" style="justify-content:center"><button class="secondary-button" type="button" data-open-current-readonly>查看本篇记录</button><button class="secondary-button" type="button" data-full-rewrite>整篇重写（可选）</button><button class="primary-button" type="button" data-start-new>' + icon('plus') + '开始新作文</button></div></section>';
    }

    function startOptionalFullRewrite() {
        var previous = state.current || {};
        setBusy(true);
        renderLoading('正在准备整篇重写…', '这是可选训练，会作为一篇新的作品保存。');
        writingCall('createComposition', {
            title: compositionTitle(previous) + ' · Full rewrite',
            prompt_text: firstText(previous.prompt_text, state.promptText),
            assessment_mode: apiMode('language'),
            source: 'student'
        }).then(function(result) {
            resetDraft(result.composition || {});
            state.assessmentMode = 'language';
            state.promptText = firstText(previous.prompt_text, state.promptText);
            state.inputMethod = 'text';
            setStatus('整篇重写是可选训练；逐句训练已经算完成。');
            syncCurrentSummary();
            renderSource();
        }).catch(renderFatalAction).finally(function() { setBusy(false); });
    }

    function enterLanguage() {
        state.assessmentMode = 'language';
        state.rubricId = '';
        setBusy(true);
        saveAndEvaluate();
    }

    function beginReplacement(method) {
        var current = state.current;
        if ((method || 'photo') === 'photo') clearLogicalOperation('ocr');
        var keptTitle = state.title || firstText(current && current.title);
        var keptPrompt = state.promptText || firstText(current && current.prompt_text);
        resetDraft(current);
        state.title = keptTitle;
        state.promptText = keptPrompt;
        state.inputMethod = method || 'photo';
        renderSource();
    }

    function loadComposition(id, forceReadOnly) {
        if (!id || state.busy) return;
        closeSidebar();
        setStatus('');
        renderLoading('正在打开这篇作文…', '正在读取已保存的批改和改写记录。');
        setBusy(true);
        writingCall('getComposition', { composition_id: id }).then(function(result) {
            var composition = result.composition || result.item || {};
            if (safeArray(result.rubrics).length) state.rubrics = result.rubrics;
            var savedMode = compositionMode(composition);
            var review = result.review || composition.review || (savedMode === 'standardized' ? composition.standardized_review : composition.language_review) || null;
            resetDraft(composition);
            restoreOcrPhotoUrls(result);
            state.review = review;
            state.assessmentMode = compositionMode(composition);
            state.readOnly = forceReadOnly !== false && compositionStatus(composition) === 'completed';
            if (state.readOnly) clearAcceptedRewriteDrafts([], true);
            state.confirmedText = firstText(composition.confirmed_text, composition.full_text);
            if (composition.pending_ocr) {
                showOcrResult({ composition: composition, ocr: composition.pending_ocr, ocr_photo_urls: result.ocr_photo_urls });
                return;
            }
            var ocrJob = composition.ocr_job || {};
            var ocrStatus = firstText(ocrJob.status, composition.status).toLowerCase();
            if (composition.pending_upload || ocrStatus === 'photo_uploading' || ocrStatus === 'queued' || ocrStatus === 'processing' || ocrStatus === 'ocr_queued' || ocrStatus === 'ocr_processing') {
                renderOcrWaiting(ocrJob, true);
                if (!state.ocrPollActive) startOcrPolling();
                syncCurrentSummary();
                return;
            }
            if (ocrStatus === 'failed' || composition.status === 'ocr_failed') {
                renderOcrFailure({ code: ocrJob.error_code || 'WRITING_AI_OCR_FAILED', message: 'OCR 识别没有完成。' });
                syncCurrentSummary();
                return;
            }
            var activeJob = composition.active_job || {};
            var reviewStatus = compositionStatus(composition);
            if ((activeJob.job_type === 'rewrite' && (activeJob.status === 'queued' || activeJob.status === 'processing'))
                || reviewStatus === 'rewrite_queued' || reviewStatus === 'rewrite_processing') {
                renderRewriteWaiting(activeJob, true, false);
                syncCurrentSummary();
                return;
            }
            if ((activeJob.job_type === 'rewrite' && activeJob.status === 'failed') || reviewStatus === 'rewrite_failed') {
                renderRewriteFailure({ code: activeJob.error_code || 'WRITING_AI_REWRITE_FAILED', message: 'AI 改写检查没有完成。' });
                syncCurrentSummary();
                return;
            }
            if (!state.readOnly && rewriteReady(composition)) {
                applyRewriteResult({ composition: composition });
                return;
            }
            if ((activeJob.job_type === 'review' && (activeJob.status === 'queued' || activeJob.status === 'processing'))
                || reviewStatus === 'review_queued' || reviewStatus === 'review_processing') {
                renderReviewWaiting(activeJob, true, false);
                syncCurrentSummary();
                return;
            }
            if ((activeJob.job_type === 'review' && activeJob.status === 'failed') || reviewStatus === 'review_failed') {
                renderReviewFailure({ code: activeJob.error_code || 'WRITING_AI_REVIEW_FAILED', message: 'AI 批改没有完成。' });
                syncCurrentSummary();
                return;
            }
            if (reviewReady(composition)) {
                showReviewResult({ composition: composition });
                return;
            }
            if (state.assessmentMode === 'standardized' && review) renderStandardized();
            else if (review) prepareLanguageReview();
            else renderSource();
            syncCurrentSummary();
        }).catch(renderFatalAction).finally(function() { setBusy(false); });
    }

    function renderFatalAction(error) {
        setStatus('');
        var code = error && (error.code || error.result && error.result.code) || '';
        var rawMessage = error && error.message || '';
        var message = rawMessage || '发生了一个暂时无法完成的错误。';
        if (code === 'WRITING_AI_SCHEMA_RESPONSE_INVALID') {
            message = 'AI 已读取照片，但返回格式不完整。请继续这篇作文后重试 OCR。';
        } else if (code === 'WRITING_AI_OCR_EMPTY') {
            message = 'AI 没有从照片中识别到作文文字。请检查照片是否清晰、方向是否正确，然后重新上传。';
        } else if (code === 'WRITING_AI_TIMEOUT' || /network error/i.test(rawMessage)) {
            message = 'OCR 仍在云端处理中。请稍后打开同一篇作文，页面会自动继续查询；不会新建作文记录。';
        }
        stage.innerHTML = '<section class="surface error-state"><strong>这一步没有完成</strong><p>' + escapeHtml(message) + '</p><div class="form-actions"><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button>' +
            (state.current ? '<button class="primary-button" type="button" data-resume-current>继续这篇作文</button>' : '') + '</div></section>';
    }

    function updateOverlayLock() {
        document.documentElement.classList.toggle('ai-overlay-open', state.sidebarOpen || state.leaveDialogOpen);
    }

    function openSidebar() {
        state.sidebarOpen = true;
        portfolioSidebar.classList.add('is-open');
        sidebarScrim.hidden = false;
        portfolioToggle.setAttribute('aria-expanded', 'true');
        portfolioToggle.setAttribute('aria-label', '关闭历史');
        updateOverlayLock();
    }

    function closeSidebar() {
        state.sidebarOpen = false;
        portfolioSidebar.classList.remove('is-open');
        sidebarScrim.hidden = true;
        portfolioToggle.setAttribute('aria-expanded', 'false');
        portfolioToggle.setAttribute('aria-label', '打开历史');
        updateOverlayLock();
    }

    function openLeaveConfirmation() {
        if (state.leaveDialogOpen) return;
        state.returnFocus = document.activeElement;
        state.leaveDialogOpen = true;
        leaveConfirmation.hidden = false;
        app.inert = true;
        updateOverlayLock();
        window.requestAnimationFrame(function() {
            var cancel = leaveConfirmation.querySelector('button[data-cancel-leave]');
            if (cancel) cancel.focus();
        });
    }

    function closeLeaveConfirmation() {
        if (!state.leaveDialogOpen) return;
        state.leaveDialogOpen = false;
        leaveConfirmation.hidden = true;
        app.inert = false;
        updateOverlayLock();
        if (state.returnFocus && typeof state.returnFocus.focus === 'function') state.returnFocus.focus();
        state.returnFocus = null;
    }

    function confirmLeave() {
        stopOcrPolling();
        stopReviewPolling();
        window.location.assign('dashboard.html');
    }

    function updateSourceState(target) {
        if (target.id === 'writing-title') state.title = target.value.trim();
        if (target.id === 'writing-prompt') state.promptText = target.value;
        if (target.id === 'writing-rubric') state.rubricId = target.value;
        if (target.id === 'writing-text') state.confirmedText = target.value;
        if (target.name === 'assessment-mode') {
            state.assessmentMode = target.value;
            renderSource();
            return;
        }
        scheduleAutosave();
    }

    document.addEventListener('input', function(event) {
        var target = event.target;
        if (target.matches('#writing-title,#writing-prompt,#writing-rubric,#writing-text,[name="assessment-mode"]')) updateSourceState(target);
        if (target.matches('[data-rewrite-id]')) {
            var id = target.getAttribute('data-rewrite-id');
            state.rewrites[id] = target.value;
            delete state.skipped[id];
            saveRewriteDraftSnapshot();
        }
        if (target.id === 'ocr-text') state.confirmedText = target.value;
    });

    document.addEventListener('change', function(event) {
        var target = event.target;
        if (target.matches('#writing-rubric,[name="assessment-mode"]')) updateSourceState(target);
        if (target.id === 'writing-photo' && target.files && target.files.length) {
            var additions = Array.prototype.slice.call(target.files);
            if (state.photoFiles.length + additions.length > 8) {
                setStatus('一篇作文最多上传 8 页照片。');
                additions = additions.slice(0, Math.max(0, 8 - state.photoFiles.length));
            }
            state.photoFiles = state.photoFiles.concat(additions);
            state.photoUrls = state.photoUrls.concat(additions.map(function(file) { return URL.createObjectURL(file); }));
            renderSource();
        }
    });

    document.addEventListener('submit', function(event) {
        if (event.target.matches('[data-title-form]')) {
            event.preventDefault();
            savePortfolioTitle(event.target);
            return;
        }
        if (event.target.id === 'writing-source-form') {
            event.preventDefault();
            submitSource();
        }
    });

    document.addEventListener('click', function(event) {
        var button = event.target.closest('button,[data-open-composition],[data-cancel-leave],[data-manuscript-sentence]');
        if (!button) return;
        if (button.matches('#header-back')) openLeaveConfirmation();
        else if (button.matches('[data-cancel-leave]')) closeLeaveConfirmation();
        else if (button.matches('[data-confirm-leave]')) confirmLeave();
        else if (button.matches('[data-edit-title]')) beginTitleEdit(button.getAttribute('data-edit-title'));
        else if (button.matches('[data-cancel-title]')) cancelTitleEdit();
        else if (button.matches('[data-start-new]')) createNewWriting();
        else if (button.matches('[data-return-home]')) { stopOcrPolling(); stopReviewPolling(); stopRewritePolling(); setStatus(''); state.current = null; state.review = null; renderPortfolio(); renderWelcome(); }
        else if (button.matches('[data-open-composition]')) loadComposition(button.getAttribute('data-open-composition'));
        else if (button.matches('[data-input-method]')) { state.inputMethod = button.getAttribute('data-input-method'); renderSource(); }
        else if (button.matches('[data-remove-photo]')) {
            var removeIndex = Number(button.getAttribute('data-remove-photo'));
            if (state.photoUrls[removeIndex] && state.photoUrls[removeIndex].indexOf('blob:') === 0) URL.revokeObjectURL(state.photoUrls[removeIndex]);
            state.photoFiles.splice(removeIndex, 1); state.photoUrls.splice(removeIndex, 1); renderSource();
        }
        else if (button.matches('[data-move-photo]')) {
            var from = Number(button.getAttribute('data-move-photo'));
            var to = button.getAttribute('data-direction') === 'up' ? from - 1 : from + 1;
            if (to >= 0 && to < state.photoFiles.length) {
                [state.photoFiles[from], state.photoFiles[to]] = [state.photoFiles[to], state.photoFiles[from]];
                [state.photoUrls[from], state.photoUrls[to]] = [state.photoUrls[to], state.photoUrls[from]];
                renderSource();
            }
        }
        else if (button.matches('[data-toggle-ocr-photo]')) {
            var layout = document.getElementById('ocr-layout');
            var visible = layout.classList.toggle('show-photo');
            button.setAttribute('aria-pressed', String(visible));
            button.innerHTML = icon('camera') + (visible ? '隐藏原图' : '显示原图对照');
        }
        else if (button.matches('[data-confirm-ocr]')) {
            state.confirmedText = firstText(document.getElementById('ocr-text').value);
            if (!state.confirmedText) { setStatus('请先确认或补全 OCR 文本。'); return; }
            setBusy(true); saveAndEvaluate();
        }
        else if (button.matches('[data-stay-ocr]')) {
            startOcrPolling();
            button.disabled = true;
            button.textContent = '正在等待 OCR…';
        }
        else if (button.matches('[data-stay-review]')) {
            startReviewPolling();
            button.disabled = true;
            button.textContent = '正在等待批改…';
        }
        else if (button.matches('[data-stay-rewrite]')) {
            startRewritePolling();
            button.disabled = true;
            button.textContent = '正在等待检查…';
        }
        else if (button.matches('[data-retry-rewrite]')) submitRewrites();
        else if (button.matches('[data-return-rewrites]')) {
            state.review = state.current && state.current.language_review || state.review;
            prepareLanguageReview();
        }
        else if (button.matches('[data-retry-review]')) retryReviewRequest();
        else if (button.matches('[data-retry-ocr]')) loadComposition(compositionId(state.current), false);
        else if (button.matches('[data-reupload]')) beginReplacement('photo');
        else if (button.matches('[data-edit-current]')) beginReplacement('text');
        else if (button.matches('[data-enter-language]')) enterLanguage();
        else if (button.matches('[data-flip-sentence]')) {
            var flipId = button.getAttribute('data-flip-sentence');
            var showRewriteFace = button.getAttribute('data-face') === 'rewrite';
            state.rewriteFace[flipId] = showRewriteFace;
            var flipCard = document.getElementById('sentence-card-' + flipId);
            var flipInner = flipCard && flipCard.querySelector('.sentence-card-inner');
            if (!flipInner) {
                renderLanguage();
                return;
            }
            flipInner.classList.toggle('show-rewrite', showRewriteFace);
            flipInner.setAttribute('data-face', showRewriteFace ? 'rewrite' : 'analysis');
            var analysisSide = flipCard.querySelector('.sentence-analysis-face');
            var rewriteSide = flipCard.querySelector('.sentence-rewrite-face');
            if (analysisSide) {
                analysisSide.setAttribute('aria-hidden', String(showRewriteFace));
                if (showRewriteFace) analysisSide.setAttribute('inert', '');
                else analysisSide.removeAttribute('inert');
            }
            if (rewriteSide) {
                rewriteSide.setAttribute('aria-hidden', String(!showRewriteFace));
                if (showRewriteFace) rewriteSide.removeAttribute('inert');
                else rewriteSide.setAttribute('inert', '');
            }
            var referencePanel = flipCard.querySelector('.reference-panel');
            if (referencePanel) {
                var hideReference = showRewriteFace || !state.referenceOpen[flipId];
                referencePanel.hidden = hideReference;
                referencePanel.setAttribute('aria-hidden', String(hideReference));
            }
            Array.prototype.forEach.call(flipCard.querySelectorAll('[data-flip-sentence]'), function(control) {
                var controlsRewrite = control.getAttribute('data-face') === 'rewrite';
                control.setAttribute('aria-pressed', String(controlsRewrite === showRewriteFace));
            });
            syncSentenceCardHeight(flipInner);
            observeSentenceCardHeights();
            window.requestAnimationFrame(function() {
                var focusTarget = showRewriteFace
                    ? flipCard.querySelector('[data-rewrite-id]:not([disabled])') || flipCard.querySelector('[data-face="analysis"]')
                    : flipCard.querySelector('[data-face="rewrite"]');
                if (focusTarget) focusTarget.focus();
            });
        }
        else if (button.matches('[data-sentence-index]')) {
            state.activeSentence = Number(button.getAttribute('data-sentence-index')) || 0;
            Array.prototype.forEach.call(document.querySelectorAll('.sentence-capsule'), function(item) {
                var active = Number(item.getAttribute('data-sentence-index')) === state.activeSentence;
                item.classList.toggle('is-active', active);
                item.setAttribute('aria-pressed', String(active));
                if (active) { item.setAttribute('aria-current', 'true'); item.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' }); }
                else item.removeAttribute('aria-current');
            });
            Array.prototype.forEach.call(document.querySelectorAll('[data-manuscript-sentence]'), function(item) {
                var active = Number(item.getAttribute('data-sentence-index')) === state.activeSentence;
                item.classList.toggle('is-active', active);
                if (active) item.setAttribute('aria-current', 'true');
                else item.removeAttribute('aria-current');
            });
            Array.prototype.forEach.call(document.querySelectorAll('[data-sentence-card]'), function(item, index) {
                item.classList.toggle('is-active', index === state.activeSentence);
            });
            var card = document.querySelectorAll('[data-sentence-card]')[state.activeSentence];
            if (card) card.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                block: 'start'
            });
        }
        else if (button.matches('[data-toggle-reference]')) {
            var referenceId = button.getAttribute('data-toggle-reference');
            state.referenceOpen[referenceId] = !state.referenceOpen[referenceId];
            renderLanguage();
        }
        else if (button.matches('[data-submit-rewrites]')) submitRewrites();
        else if (button.matches('[data-full-rewrite]')) startOptionalFullRewrite();
        else if (button.matches('[data-open-current-readonly]')) { state.readOnly = true; prepareLanguageReview(); }
        else if (button.matches('[data-resume-current]')) { if (state.review) state.assessmentMode === 'standardized' ? renderStandardized() : prepareLanguageReview(); else renderSource(); }
    });

    document.addEventListener('keydown', function(event) {
        var sentence = event.target.closest && event.target.closest('[data-manuscript-sentence]');
        if (!sentence || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        sentence.click();
    });

    document.getElementById('header-new-writing').addEventListener('click', createNewWriting);
    portfolioToggle.addEventListener('click', function() { state.sidebarOpen ? closeSidebar() : openSidebar(); });
    document.getElementById('sidebar-close').addEventListener('click', closeSidebar);
    sidebarScrim.addEventListener('click', closeSidebar);
    document.querySelector('.portfolio-filters').addEventListener('click', function(event) {
        var button = event.target.closest('[data-portfolio-filter]');
        if (!button) return;
        state.filter = button.getAttribute('data-portfolio-filter');
        Array.prototype.forEach.call(document.querySelectorAll('[data-portfolio-filter]'), function(item) {
            item.setAttribute('aria-pressed', String(item === button));
        });
        renderPortfolio();
    });
    window.addEventListener('keydown', function(event) {
        if (state.leaveDialogOpen && event.key === 'Tab') {
            var controls = leaveConfirmation.querySelectorAll('button:not(:disabled)');
            if (!controls.length) return;
            var first = controls[0];
            var last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
            return;
        }
        if (event.key === 'Escape') {
            if (state.leaveDialogOpen) closeLeaveConfirmation();
            else if (state.sidebarOpen) closeSidebar();
        }
    });
    window.addEventListener('pageshow', function() {
        if (state.leaveDialogOpen) closeLeaveConfirmation();
    });

    function init() {
        if (!window.MrCatAuth) { renderFatalAction(new Error('登录组件没有载入，请刷新页面。')); return; }
        Promise.all([
            window.MrCatAuth.getSession(),
            writingCall('getProfile').catch(function() { return { success: true, profile: null }; }),
            writingCall('listCompositions')
        ]).then(function(results) {
            state.session = results[0];
            if (!state.session || state.session.mode !== 'student') {
                throw new Error('请先使用学生账号登录，再打开 AI Tutor。');
            }
            state.profile = results[1].student || state.session.profile || {};
            state.writingProfile = safeArray(results[1].profile);
            state.quota = results[1].quota || null;
            state.rubrics = safeArray(results[1].rubrics).length ? results[1].rubrics : safeArray(results[2].rubrics);
            state.compositions = normalizeCompositions(results[2]);
            studentChip.textContent = profileName(state.profile);
            studentChip.hidden = false;
            app.setAttribute('aria-busy', 'false');
            renderPortfolio();
            renderWelcome();
        }).catch(function(error) {
            app.setAttribute('aria-busy', 'false');
            stage.innerHTML = '<section class="surface error-state"><strong>需要学生登录</strong><p>' + escapeHtml(error && error.message || '无法打开 AI Tutor。') + '</p><a class="primary-button" href="index.html">前往登录</a></section>';
        });
    }

    init();
})(window, document);
