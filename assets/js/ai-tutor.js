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
        revisionScan: null,
        correctionRound: 0,
        busy: false,
        autosaveTimer: null,
        ocrPollGeneration: 0,
        ocrPollActive: false,
        reviewPollGeneration: 0,
        reviewPollActive: false,
        rewritePollGeneration: 0,
        rewritePollActive: false,
        revisionScanPollGeneration: 0,
        revisionScanPollActive: false,
        waitingRunner: null,
        waitingKind: '',
        waitingTaskState: '',
        waitingFinishPending: false,
        sidebarOpen: false,
        editingTitleId: '',
        titleEditError: '',
        leaveDialogOpen: false,
        leaveDialogAction: 'dashboard',
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
    var revisionProgress = document.getElementById('revision-progress');
    var currentWritingTitleWindow = document.getElementById('current-writing-title-window');
    var currentWritingTitleTrack = document.getElementById('current-writing-title-track');
    var leaveConfirmation = document.getElementById('leave-confirmation');
    var sentenceCardResizeObserver = null;
    var currentWritingTitleResizeObserver = null;

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

    function normalizedOcrText(value) {
        return String(value == null ? '' : value).replace(/\r\n?/g, '\n');
    }

    function ocrUncertainRanges(text, spans) {
        var source = normalizedOcrText(text);
        var lowerSource = source.toLowerCase();
        var nextStart = {};
        var ranges = [];
        safeArray(spans).forEach(function(span) {
            var needle = firstText(span && span.text);
            if (!needle) return;
            var key = needle.toLowerCase();
            var searchFrom = nextStart[key] || 0;
            var start = source.indexOf(needle, searchFrom);
            if (start < 0) start = lowerSource.indexOf(key, searchFrom);
            while (start >= 0 && ranges.some(function(range) {
                return start < range.end && start + needle.length > range.start;
            })) {
                start = lowerSource.indexOf(key, start + Math.max(1, needle.length));
            }
            if (start < 0) return;
            ranges.push({ start: start, end: start + needle.length, text: source.slice(start, start + needle.length) });
            nextStart[key] = start + needle.length;
        });
        return ranges.sort(function(a, b) { return a.start - b.start; });
    }

    function ocrEditorHtml(text, spans) {
        var source = normalizedOcrText(text);
        var ranges = ocrUncertainRanges(source, spans);
        function renderSegment(start, end) {
            var cursor = start;
            var html = '';
            ranges.forEach(function(range) {
                if (range.start < start || range.end > end) return;
                html += escapeHtml(source.slice(cursor, range.start)).replace(/\n/g, '<br>');
                html += '<mark class="ocr-uncertain" data-ocr-uncertain data-original="' + escapeHtml(range.text) +
                    '" aria-label="OCR may be unclear: ' + escapeHtml(range.text) + '">' + escapeHtml(range.text) + '</mark>';
                cursor = range.end;
            });
            html += escapeHtml(source.slice(cursor, end)).replace(/\n/g, '<br>');
            return html || '<br>';
        }
        var paragraphs = [];
        var paragraphStart = 0;
        var boundary = /\n{2,}/g;
        var match;
        while ((match = boundary.exec(source))) {
            paragraphs.push(renderSegment(paragraphStart, match.index));
            paragraphStart = boundary.lastIndex;
        }
        paragraphs.push(renderSegment(paragraphStart, source.length));
        return paragraphs.map(function(paragraph) { return '<p>' + paragraph + '</p>'; }).join('');
    }

    function ocrEditorText(editor) {
        if (!editor) return '';
        var blocks = Array.prototype.slice.call(editor.children).filter(function(child) {
            return child.nodeType === 1 && child.tagName !== 'BR';
        });
        if (!blocks.length) return normalizedOcrText(editor.innerText || editor.textContent || '');
        return blocks.map(function(block) {
            return normalizedOcrText(block.innerText || block.textContent || '').replace(/\n+$/g, '');
        }).join('\n\n');
    }

    function unwrapOcrMark(mark, preserveCaret) {
        if (!mark || !mark.parentNode) return;
        var markText = mark.textContent || '';
        var caretOffset = markText.length;
        var selection = window.getSelection && window.getSelection();
        if (preserveCaret && selection && selection.rangeCount && mark.contains(selection.focusNode)) {
            try {
                var beforeCaret = document.createRange();
                beforeCaret.selectNodeContents(mark);
                beforeCaret.setEnd(selection.focusNode, selection.focusOffset);
                caretOffset = beforeCaret.toString().length;
            } catch (error) {}
        }
        var textNode = document.createTextNode(markText);
        mark.parentNode.replaceChild(textNode, mark);
        if (preserveCaret && selection) {
            var nextRange = document.createRange();
            nextRange.setStart(textNode, Math.min(caretOffset, markText.length));
            nextRange.collapse(true);
            selection.removeAllRanges();
            selection.addRange(nextRange);
        }
    }

    function clearChangedOcrMarks(editor) {
        if (!editor) return;
        Array.prototype.slice.call(editor.querySelectorAll('[data-ocr-uncertain]')).forEach(function(mark) {
            if ((mark.textContent || '') !== (mark.getAttribute('data-original') || '')) unwrapOcrMark(mark, false);
        });
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

    function requestedCompositionId() {
        try { return firstText(new URLSearchParams(window.location.search).get('composition')); }
        catch (error) { return ''; }
    }

    function syncCompositionLocator(id) {
        if (!window.history || !window.history.replaceState) return;
        try {
            var url = new URL(window.location.href);
            if (id) url.searchParams.set('composition', id);
            else url.searchParams.delete('composition');
            window.history.replaceState({}, '', url.pathname + url.search + url.hash);
        } catch (error) {}
    }

    function updateCurrentWritingTitleOverflow() {
        if (!currentWritingTitleWindow || !currentWritingTitleTrack || currentWritingTitleWindow.hidden) return;
        var overflow = Math.ceil(currentWritingTitleTrack.scrollWidth - currentWritingTitleWindow.clientWidth);
        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var shouldScroll = !reduceMotion && currentWritingTitleWindow.clientWidth > 0 && overflow > 2;
        currentWritingTitleWindow.classList.toggle('is-overflowing', shouldScroll || (reduceMotion && overflow > 2));
        if (!shouldScroll) {
            currentWritingTitleWindow.style.removeProperty('--current-writing-title-shift');
            currentWritingTitleWindow.style.removeProperty('--current-writing-title-duration');
            return;
        }
        currentWritingTitleWindow.style.setProperty('--current-writing-title-shift', (-overflow) + 'px');
        currentWritingTitleWindow.style.setProperty('--current-writing-title-duration', Math.max(7, Math.min(14, 6 + (overflow / 28))) + 's');
    }

    function scheduleCurrentWritingTitleOverflow() {
        window.requestAnimationFrame(updateCurrentWritingTitleOverflow);
    }

    function updateCurrentWritingTitle() {
        updateRevisionProgress();
        if (!currentWritingTitleWindow || !currentWritingTitleTrack) return;
        var title = editableCompositionTitle(state.current);
        currentWritingTitleTrack.textContent = title;
        currentWritingTitleWindow.hidden = !title;
        currentWritingTitleWindow.setAttribute('aria-label', title ? '当前作文：' + title : '当前没有打开作文');
        document.title = title ? title + ' | AI Tutor' : 'AI Tutor | Mr. Cat Academy';
        scheduleCurrentWritingTitleOverflow();
    }

    function revisionProgressSummary() {
        var sentences = safeArray(state.review && state.review.sentences);
        if (!state.current || !sentences.length) return null;
        var total = 0;
        var completed = 0;
        sentences.forEach(function(sentence, index) {
            if (!rewriteRequired(sentence)) return;
            total += 1;
            var result = state.rewriteResults[sentenceId(sentence, index)];
            if (result && result.accepted === true) completed += 1;
        });
        return {
            total: total,
            completed: completed,
            remaining: Math.max(0, total - completed),
            percentage: total ? Math.round((completed / total) * 100) : 100
        };
    }

    function updateRevisionProgress() {
        if (!revisionProgress) return;
        var progress = revisionProgressSummary();
        revisionProgress.hidden = !progress;
        if (!progress) {
            revisionProgress.textContent = '';
            revisionProgress.removeAttribute('aria-label');
            revisionProgress.removeAttribute('title');
            return;
        }
        var label = '句子订正进度：' + progress.completed + ' / ' + progress.total + ' 已完成，剩余 ' + progress.remaining + ' 句';
        revisionProgress.textContent = progress.percentage + '%';
        revisionProgress.setAttribute('aria-label', label);
        revisionProgress.setAttribute('title', label);
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

    function stopRevisionScanPolling() {
        state.revisionScanPollActive = false;
        state.revisionScanPollGeneration += 1;
    }

    function waitingTaskState(jobStatus, durable) {
        var status = firstText(jobStatus).toLowerCase();
        if (!durable || status === 'photo_uploading' || status === 'uploading') return 'uploading';
        if (status === 'succeeded' || status === 'ready' || status === 'completed') return 'ready';
        if (status === 'failed') return 'failed';
        if (status === 'processing' || /_processing$/.test(status) || status === 'evaluating') return 'analysing';
        return 'queued';
    }

    function waitingStageClass(stageName, taskState) {
        var order = ['saved', 'queued', 'analysing', 'ready'];
        var currentIndex = order.indexOf(taskState);
        var stageIndex = order.indexOf(stageName);
        if (taskState === 'uploading') return stageName === 'saved' ? 'is-active' : 'is-upcoming';
        if (taskState === 'failed') return stageName === 'analysing' ? 'is-active' : 'is-upcoming';
        if (taskState === 'ready') return 'is-complete';
        if (stageIndex < currentIndex) return 'is-complete';
        if (stageIndex === currentIndex) return 'is-active';
        return 'is-upcoming';
    }

    function waitingStageLabel(stageName, taskState) {
        if (taskState === 'uploading' && stageName === 'saved') return 'Uploading';
        return { saved: 'Saved', queued: 'Queued', analysing: 'Analysing', ready: 'Ready' }[stageName];
    }

    function waitingStageMarkup(taskState) {
        return ['saved', 'queued', 'analysing', 'ready'].map(function(stageName) {
            var stageClass = waitingStageClass(stageName, taskState);
            var symbol = stageClass === 'is-complete' ? '✓' : stageClass === 'is-active' ? '•' : '·';
            return '<li class="ai-waiting-stage ' + stageClass + '" data-waiting-stage="' + stageName + '"><span class="ai-waiting-stage-mark" aria-hidden="true">' + symbol + '</span><span>' + waitingStageLabel(stageName, taskState) + '</span></li>';
        }).join('');
    }

    function updateWaitingStageDom(taskState) {
        if (!stage) return;
        var stages = stage.querySelectorAll('[data-waiting-stage]');
        Array.prototype.forEach.call(stages, function(item) {
            var name = item.getAttribute('data-waiting-stage');
            var nextClass = 'ai-waiting-stage ' + waitingStageClass(name, taskState);
            item.className = nextClass;
            var mark = item.querySelector('.ai-waiting-stage-mark');
            if (mark) mark.textContent = nextClass.indexOf('is-complete') >= 0 ? '✓' : nextClass.indexOf('is-active') >= 0 ? '•' : '·';
            var label = item.querySelector('span:last-child');
            if (label) label.textContent = waitingStageLabel(name, taskState);
        });
    }

    function mountWaitingRunner() {
        if (state.waitingRunner || !stage) return;
        var canvas = stage.querySelector('.runner-canvas');
        if (!canvas) return;
        if (!window.MrCatWaitingRunner || typeof window.MrCatWaitingRunner.mount !== 'function') {
            var missingShell = canvas.closest('.runner-shell');
            if (missingShell) missingShell.hidden = true;
            return;
        }
        try {
            var runner = window.MrCatWaitingRunner.mount(canvas, {
                onScore: function(score) {
                    var scoreNode = stage.querySelector('.runner-score');
                    if (scoreNode) scoreNode.textContent = 'Distance ' + Number(score.distance || 0) + 'm · Ink ' + Number(score.ink || 0);
                }
            });
            if (!runner || typeof runner.destroy !== 'function') return;
            if (typeof runner.snapshot === 'function' && runner.snapshot().supported === false) {
                var unsupportedShell = canvas.closest('.runner-shell');
                if (unsupportedShell) unsupportedShell.hidden = true;
                return;
            }
            state.waitingRunner = runner;
            runner.setTaskState(state.waitingTaskState || 'queued');
            var jumpButton = stage.querySelector('.runner-jump-button');
            if (jumpButton && typeof runner.jump === 'function') jumpButton.addEventListener('click', function() { runner.jump(); });
        } catch (error) {
            state.waitingRunner = null;
        }
    }

    function renderAiWaitingExperience(config) {
        config = config || {};
        destroyAiWaitingExperience();
        var durable = config.durable !== false;
        var taskState = waitingTaskState(config.jobStatus, durable);
        state.waitingKind = firstText(config.kind);
        state.waitingTaskState = taskState;
        state.waitingFinishPending = false;
        state.screen = firstText(config.screen, {
            ocr: 'ocr-waiting',
            review: 'review-waiting',
            rewrite: 'rewrite-waiting',
            revision_ocr: 'revision-scan-waiting'
        }[state.waitingKind] || state.waitingKind + '-waiting');
        var uploadPending = !durable || taskState === 'uploading';
        var runnerMarkup = durable && taskState !== 'failed'
            ? '<div class="runner-shell" aria-label="Mr. Cat Runner waiting activity"><canvas class="runner-canvas" tabindex="0" role="img" aria-label="Mr. Cat Runner. Tap, click, or press Space to jump."></canvas><p class="runner-instruction">Tap or press Space to jump</p><p class="runner-score" aria-hidden="true">Distance 0m · Ink 0</p><button class="runner-jump-button" type="button" aria-label="Jump">Jump</button></div>'
            : '';
        var extraActions = firstText(config.extraActions);
        var backgroundAction = durable && config.allowBackground !== false
            ? '<button class="primary-button ai-waiting-background-action" type="button" data-return-home>Continue in Background</button>'
            : '';
        var statusCopy = uploadPending
            ? 'Uploading is not yet confirmed. Keep this page open until the server confirms the handoff.'
            : firstText(config.statusCopy, 'The page checks the same saved task every 5 seconds.');
        stage.innerHTML = '<section class="surface ai-waiting-experience' + (uploadPending ? ' ai-waiting-uploading' : '') + '" data-waiting-kind="' + escapeHtml(state.waitingKind) + '">' +
            '<header class="ai-waiting-copy"><h2>' + escapeHtml(firstText(config.title, 'Working on your writing')) + '</h2><p>' + escapeHtml(firstText(config.description, 'Your work is safely saved.')) + '</p>' +
            (durable && !/you may leave/i.test(firstText(config.description)) ? '<p>You may leave while AI continues in the background.</p>' : '') + '</header>' +
            '<ol class="ai-waiting-stages" aria-label="AI task status">' + waitingStageMarkup(taskState === 'uploading' ? 'uploading' : taskState) + '</ol>' +
            runnerMarkup +
            '<p class="ai-waiting-status section-hint" id="' + escapeHtml(firstText(config.pollStatusId, 'ai-waiting-status')) + '" role="status" aria-live="polite">' + escapeHtml(statusCopy) + '</p>' +
            '<div class="form-actions ai-waiting-actions">' + extraActions + backgroundAction + '</div></section>';
        mountWaitingRunner();
        updateWaitingStageDom(taskState);
    }

    function updateAiWaitingExperience(config) {
        config = config || {};
        if (!state.waitingKind || (config.kind && config.kind !== state.waitingKind)) return;
        var durable = config.durable !== false;
        var nextState = waitingTaskState(config.jobStatus, durable);
        state.waitingTaskState = nextState;
        updateWaitingStageDom(nextState === 'uploading' ? 'uploading' : nextState);
        if (state.waitingRunner && typeof state.waitingRunner.setTaskState === 'function') state.waitingRunner.setTaskState(nextState === 'uploading' ? 'queued' : nextState);
        var pollStatusId = firstText(config.pollStatusId);
        var statusNode = stage && pollStatusId ? stage.querySelector('#' + pollStatusId) : null;
        if (statusNode && config.statusCopy) statusNode.textContent = config.statusCopy;
    }

    function finishAiWaitingExperience(next) {
        if (state.waitingFinishPending) return;
        state.waitingFinishPending = true;
        var called = false;
        var fallbackTimer = null;
        function complete() {
            if (called) return;
            called = true;
            if (fallbackTimer != null) window.clearTimeout(fallbackTimer);
            destroyAiWaitingExperience();
            if (typeof next === 'function') next();
        }
        if (!state.waitingRunner || (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || document.hidden) {
            complete();
            return;
        }
        state.waitingTaskState = 'ready';
        updateWaitingStageDom('ready');
        if (state.waitingRunner && typeof state.waitingRunner.setTaskState === 'function') state.waitingRunner.setTaskState('ready');
        fallbackTimer = window.setTimeout(complete, 500);
        try {
            state.waitingRunner.finish(complete);
        } catch (error) {
            complete();
        }
    }

    function destroyAiWaitingExperience() {
        if (state.waitingRunner && typeof state.waitingRunner.destroy === 'function') {
            try { state.waitingRunner.destroy(); } catch (error) {}
        }
        state.waitingRunner = null;
        state.waitingKind = '';
        state.waitingTaskState = '';
        state.waitingFinishPending = false;
    }

    function releaseRevisionScanPreviewUrls(scan) {
        safeArray(scan && scan.previewUrls).forEach(function(url) {
            if (firstText(url).indexOf('blob:') === 0) URL.revokeObjectURL(url);
        });
        if (scan) scan.previewUrls = [];
    }

    function resetRevisionScanState() {
        stopRevisionScanPolling();
        releaseRevisionScanPreviewUrls(state.revisionScan);
        state.revisionScan = null;
    }

    function revisionScanState() {
        if (!state.revisionScan) {
            state.revisionScan = {
                files: [],
                previewUrls: [],
                photoIds: [],
                operationId: '',
                status: 'idle',
                job: null,
                pending: null,
                candidates: [],
                message: ''
            };
        }
        return state.revisionScan;
    }

    function revisionScanJobFrom(composition) {
        var job = composition && (composition.active_job || composition.revision_scan_job) || {};
        return job.job_type === 'revision_ocr' ? job : {};
    }

    function revisionScanPendingFrom(composition) {
        return composition && composition.pending_revision_scan || null;
    }

    function revisionScanReady(composition) {
        var pending = revisionScanPendingFrom(composition);
        return Boolean(pending && Array.isArray(pending.items));
    }

    function revisionScanCandidateId(item, index) {
        return firstText(item && item.candidate_id, 'candidate-' + ((index || 0) + 1));
    }

    function revisionScanCandidates(pending) {
        return safeArray(pending && pending.items).map(function(item, index) {
            var candidate = Object.assign({}, item || {});
            candidate.candidate_id = revisionScanCandidateId(candidate, index);
            candidate.sentence_id = firstText(candidate.sentence_id) || null;
            candidate.recognized_text = normalizedOcrText(firstText(candidate.recognized_text, candidate.text));
            candidate.written_number = candidate.written_number == null ? null : String(candidate.written_number);
            candidate.status = ['mapped', 'check', 'unresolved'].indexOf(candidate.status) >= 0 ? candidate.status : (candidate.sentence_id ? 'check' : 'unresolved');
            candidate.warnings = safeArray(candidate.warnings);
            return candidate;
        });
    }

    function revisionScanSentences() {
        return safeArray(state.review && state.review.sentences).filter(function(sentence, index) {
            var result = state.rewriteResults[sentenceId(sentence, index)];
            return rewriteRequired(sentence) && !(result && result.accepted === true);
        });
    }

    function revisionScanSentenceLabel(id) {
        var sentences = safeArray(state.review && state.review.sentences);
        var index = sentences.findIndex(function(sentence, sentenceIndex) { return sentenceId(sentence, sentenceIndex) === id; });
        return index >= 0 ? '第 ' + (index + 1) + ' 句' : id;
    }

    function revisionScanSentenceDetails(id) {
        var sentences = safeArray(state.review && state.review.sentences);
        var index = sentences.findIndex(function(sentence, sentenceIndex) { return sentenceId(sentence, sentenceIndex) === id; });
        return index >= 0 ? { sentence: sentences[index], number: index + 1 } : null;
    }

    function syncRevisionScanFromComposition(composition) {
        var scan = revisionScanState();
        var pending = revisionScanPendingFrom(composition);
        scan.pending = pending;
        scan.job = revisionScanJobFrom(composition);
        if (pending && Array.isArray(pending.items)) {
            scan.candidates = revisionScanCandidates(pending);
            scan.status = 'ready';
        } else if (scan.job && scan.job.status) {
            scan.status = firstText(scan.job.status).toLowerCase();
        }
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

    function isEmptyCompositionDraft(item) {
        if (!item || compositionStatus(item) !== 'draft') return false;
        return !firstText(item.title)
            && !firstText(item.prompt_text)
            && !firstText(item.confirmed_text, item.full_text)
            && Number(item.word_count || 0) === 0
            && !item.has_standardized_review
            && !item.has_language_review
            && !item.standardized_review
            && !item.language_review
            && !item.active_job
            && !item.pending_revision_scan
            && !(item.active_job && item.active_job.job_type === 'revision_ocr')
            && !item.scanned_rewrite_drafts
            && !item.pending_upload
            && !item.pending_ocr
            && !item.replacement_pending
            && !item.rewrite_check_pending;
    }

    function portfolioCompositions() {
        return state.compositions.filter(function(item) { return !isEmptyCompositionDraft(item); });
    }

    function renderPortfolio() {
        var portfolioItems = portfolioCompositions();
        var items = portfolioItems.filter(function(item) {
            return state.filter === 'all' || compositionMode(item) === state.filter;
        });
        var completed = portfolioItems.filter(function(item) { return compositionStatus(item) === 'completed'; }).length;
        portfolioSummary.innerHTML = '<span class="summary-stat"><strong>' + portfolioItems.length + '</strong>全部作品</span>' +
            '<span class="summary-stat"><strong>' + completed + '</strong>已经完成</span>';
        renderWritingProfile();
        if (!items.length) {
            portfolioList.innerHTML = '<div class="empty-sidebar">' + (portfolioItems.length ? '这个筛选中还没有作文。' : '第一篇作文会出现在这里。') + '</div>';
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
                updateCurrentWritingTitle();
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
        updateCurrentWritingTitle();
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
        destroyAiWaitingExperience();
        state.screen = 'welcome';
        var recentCompositions = portfolioCompositions();
        stage.innerHTML = '<section class="surface">' +
            '<div class="hero"><p class="eyebrow">YOUR AI WRITING STUDIO</p><h2>把一篇作文，变成一次真正的训练。</h2>' +
            '<p>拍下手写作文或直接粘贴文字。你可以选择逐句改善英语，或按真实考试标准检查内容与结构。</p>' +
            (state.quota ? '<p><strong>今日还可批改 ' + escapeHtml(state.quota.words_remaining) + ' 词</strong> · 每日上限 ' + escapeHtml(state.quota.daily_word_limit) + ' 词</p>' : '') +
            '<div class="hero-actions"><button class="primary-button" type="button" data-start-new>' + icon('plus') + '开始新作文</button>' +
            (recentCompositions.length ? '<button class="secondary-button" type="button" data-open-composition="' + escapeHtml(compositionId(recentCompositions[0])) + '">继续最近作品</button>' : '') + '</div></div>' +
            '<div class="feature-grid"><article class="feature-card"><span class="feature-icon">' + icon('camera') + '</span><h3>拍照或输入</h3><p>OCR 后先由你确认文字，潦草笔迹也不会直接进入批改。</p></article>' +
            '<article class="feature-card"><span class="feature-icon">' + icon('text') + '</span><h3>两种批改</h3><p>通用语言批改不评分；标化考试内容批改忠实使用你选择的 Rubric。</p></article>' +
            '<article class="feature-card"><span class="feature-icon">' + icon('check') + '</span><h3>亲手重写</h3><p>读完建议后亲自改写，再一次性提交检查，让反馈变成能力。</p></article></div>' +
        '</section>';
    }

    function resetDraft(composition) {
        destroyAiWaitingExperience();
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
        resetRevisionScanState();
        state.correctionRound = 0;
        syncCompositionLocator(compositionId(state.current));
        updateCurrentWritingTitle();
    }

    function discardCurrentEmptyComposition() {
        var current = state.current;
        var id = compositionId(current);
        var draftSnapshot = Object.assign({}, current || {}, {
            title: state.title,
            prompt_text: state.promptText,
            confirmed_text: state.confirmedText
        });
        if (!id || !isEmptyCompositionDraft(draftSnapshot) || state.photoFiles.length || state.photoIds.length) {
            return Promise.resolve({ discarded: false });
        }
        window.clearTimeout(state.autosaveTimer);
        state.compositions = state.compositions.filter(function(item) { return compositionId(item) !== id; });
        return writingCall('discardEmptyComposition', { composition_id: id }).catch(function() {
            return { success: false, discarded: false };
        });
    }

    function returnToTutorHome() {
        destroyAiWaitingExperience();
        stopOcrPolling();
        stopReviewPolling();
        stopRewritePolling();
        resetRevisionScanState();
        discardCurrentEmptyComposition();
        setStatus('');
        state.current = null;
        state.review = null;
        syncCompositionLocator('');
        updateCurrentWritingTitle();
        renderPortfolio();
        renderWelcome();
    }

    function createNewWriting() {
        if (state.busy) return;
        stopOcrPolling();
        stopReviewPolling();
        setStatus('');
        renderLoading('正在准备一张新的写作纸…', '你的输入会自动关联到这篇新作文。');
        setBusy(true);
        discardCurrentEmptyComposition().then(function() {
            return writingCall('createComposition', { assessment_mode: apiMode('language') });
        }).then(function(result) {
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
        destroyAiWaitingExperience();
        state.screen = 'source';
        var standardized = state.assessmentMode === 'standardized';
        var hasPhoto = state.photoUrls.length > 0;
        stage.innerHTML = '<section class="surface surface-pad source-entry-surface">' +
            '<form class="form-stack source-entry-form" id="writing-source-form">' +
            '<div class="source-mode-switch" role="radiogroup" aria-label="作文训练模式">' +
            '<label class="source-mode-option"><input type="radio" name="assessment-mode" value="language" ' + (!standardized ? 'checked' : '') + '><span>语言语法提升</span></label>' +
            '<label class="source-mode-option"><input type="radio" name="assessment-mode" value="standardized" ' + (standardized ? 'checked' : '') + '><span>标化考试脑暴</span></label></div>' +
            '<div class="input-switch" role="group" aria-label="输入作文的方式">' +
            '<button type="button" data-input-method="text" aria-pressed="' + (state.inputMethod === 'text') + '">' + icon('text') + '直接输入</button>' +
            '<button type="button" data-input-method="photo" aria-pressed="' + (state.inputMethod === 'photo') + '">' + icon('camera') + '拍照上传</button></div>' +
            '<section class="section-block source-fields"><label class="field"><span>作文名称</span><input id="writing-title" maxlength="80" autocomplete="off" placeholder="例如：My Ideal City" value="' + escapeHtml(state.title) + '"></label>' +
            (standardized ? '<label class="field"><span>作文题目 <em>必填</em></span><textarea id="writing-prompt" maxlength="6000" placeholder="粘贴或输入完整题目…">' + escapeHtml(state.promptText) + '</textarea></label>' : '') +
            (standardized ? '<label class="field"><span>考试评分标准 <em>必选</em></span><select id="writing-rubric"><option value="">请选择 Rubric</option>' + rubricOptions(state.rubricId) + '</select></label>' : '') + '</section>' +
            '<section class="section-block" id="source-input-area">' + (state.inputMethod === 'photo' ? photoSourceHtml(hasPhoto) : textSourceHtml()) + '</section>' +
            '<div class="form-actions source-form-actions"><button class="source-discard-button" type="button" data-discard-source>Discard</button><button class="primary-button source-submit-button" type="submit" data-disable-when-busy>' + (state.inputMethod === 'photo' ? 'Scan' : 'Submit') + '</button></div>' +
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
        return '<label class="field"><span>你的作文</span><textarea class="manuscript" id="writing-text" maxlength="30000" placeholder="Type or paste your writing here…">' + escapeHtml(state.confirmedText) + '</textarea></label>';
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
        state.confirmedText = safeArray(state.ocr.paragraphs).length
            ? state.ocr.paragraphs.join('\n\n')
            : firstText(state.ocr.full_text);
        clearLogicalOperation('ocr');
        finishAiWaitingExperience(function() {
            renderOcr();
            syncCurrentSummary();
        });
    }

    function renderOcrWaiting(job, autoPoll) {
        var status = firstText(job && job.status, state.current && state.current.status).toLowerCase();
        var uploadPending = status === 'photo_uploading';
        renderAiWaitingExperience({
            kind: 'ocr',
            jobStatus: status,
            durable: !uploadPending,
            title: 'Reading your handwriting',
            description: uploadPending
                ? 'Your photos are still being confirmed by the server.'
                : 'Your photos are safely uploaded. You may leave while recognition continues.',
            pollStatusId: 'ocr-poll-status',
            statusCopy: uploadPending
                ? 'Uploading is not yet confirmed. Keep this page open until the server confirms the handoff.'
                : 'Waiting for the same saved OCR task; the page checks every 5 seconds.',
            allowBackground: !uploadPending,
            extraActions: uploadPending
                ? '<button class="primary-button" type="button" data-reupload>Upload Again</button>'
                : '<button class="secondary-button" type="button" data-reupload>Upload Again</button>'
        });
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
                var durable = firstText(job.status).toLowerCase() !== 'photo_uploading' && !composition.pending_upload;
                if (durable && !state.waitingRunner) renderOcrWaiting(job, false);
                updateAiWaitingExperience({ kind: 'ocr', jobStatus: job.status, durable: durable, pollStatusId: 'ocr-poll-status', statusCopy: durable ? 'Waiting for the same saved OCR task; the page checks every 5 seconds.' : 'Uploading is not yet confirmed. Keep this page open until the server confirms the handoff.' });
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
        destroyAiWaitingExperience();
        state.screen = 'ocr-failed';
        stage.innerHTML = '<section class="surface error-state"><strong>OCR 识别没有完成</strong><p>' + escapeHtml(message) + '</p>' +
            '<div class="form-actions"><button class="secondary-button" type="button" data-retry-ocr>重新检查状态</button>' +
            '<button class="primary-button" type="button" data-reupload>重新上传照片</button></div>' +
            '<button class="quiet-button" type="button" data-return-home>返回 AI Tutor</button></section>';
    }

    function renderOcr() {
        destroyAiWaitingExperience();
        state.screen = 'ocr';
        stage.innerHTML = '<section class="surface surface-pad ocr-review-surface"><div class="ocr-review-heading"><h2>OCR Review</h2>' +
            '<button class="secondary-button compact ocr-photo-toggle" type="button" data-toggle-ocr-photo aria-pressed="false">' + icon('camera') + 'Compare with Image</button></div>' +
            '<div class="ocr-layout" id="ocr-layout"><section class="ocr-photo" aria-label="Uploaded composition images">' + state.photoUrls.map(function(url, index) { return '<img src="' + escapeHtml(url) + '" alt="Uploaded composition page ' + (index + 1) + '">'; }).join('') + '</section>' +
            '<section class="ocr-editor"><div id="ocr-text" class="ocr-text-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Editable OCR text" spellcheck="true">' + ocrEditorHtml(state.confirmedText, state.ocr && state.ocr.uncertain_spans) + '</div></section></div>' +
            '<div class="form-actions ocr-review-actions"><button class="primary-button" type="button" data-confirm-ocr data-disable-when-busy>Confirm</button></div></section>';
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
        finishAiWaitingExperience(function() {
            syncCurrentSummary();
            if (mode === 'standardized') renderStandardized();
            else prepareLanguageReview();
            Promise.all([refreshPortfolio(), refreshWritingProfile()]).catch(function() {});
        });
    }

    function renderReviewWaiting(job, autoPoll, allowRetry) {
        var jobStatus = firstText(job && job.status, state.current && state.current.status).toLowerCase();
        renderAiWaitingExperience({
            kind: 'review',
            jobStatus: jobStatus,
            durable: true,
            title: 'Reviewing your writing',
            description: 'Your writing is safely submitted. You may leave while the review continues.',
            pollStatusId: 'review-poll-status',
            statusCopy: 'Waiting for the same saved review task; the page checks every 5 seconds.',
            allowBackground: true,
            extraActions: allowRetry ? '<button class="secondary-button" type="button" data-retry-review>Retry the same request</button>' : ''
        });
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
                updateAiWaitingExperience({ kind: 'review', jobStatus: job.status, durable: true, pollStatusId: 'review-poll-status', statusCopy: 'Waiting for the same saved review task; the page checks every 5 seconds.' });
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
        destroyAiWaitingExperience();
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
        renderAiWaitingExperience({
            kind: 'rewrite',
            jobStatus: jobStatus,
            durable: true,
            title: 'Checking your attempts',
            description: 'Your attempts are safely saved. You may leave while checking continues.',
            pollStatusId: 'rewrite-poll-status',
            statusCopy: 'Waiting for the same saved rewrite check; the page checks every 5 seconds.',
            allowBackground: true,
            extraActions: allowRetry ? '<button class="secondary-button" type="button" data-retry-rewrite>Retry the same request</button>' : ''
        });
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
        finishAiWaitingExperience(function() {
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
            }
            refreshPortfolio().catch(function() {});
        });
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
        destroyAiWaitingExperience();
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
                updateAiWaitingExperience({ kind: 'rewrite', jobStatus: job.status, durable: true, pollStatusId: 'rewrite-poll-status', statusCopy: 'Waiting for the same saved rewrite check; the page checks every 5 seconds.' });
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
        destroyAiWaitingExperience();
        state.screen = 'loading';
        stage.innerHTML = '<section class="surface loading-state"><span class="loading-orbit" aria-hidden="true"></span><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(description || '') + '</p></section>';
    }

    function renderStandardized() {
        destroyAiWaitingExperience();
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

    function restoreLanguageReviewState() {
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
        safeArray(state.current && state.current.scanned_rewrite_drafts).forEach(function(item) {
            var id = firstText(item && item.sentence_id);
            if (id && !firstText(state.rewrites[id])) state.rewrites[id] = firstText(item && item.text);
        });
        restoreRewriteDraftSnapshot(state.current);
        if (safeArray(state.current && state.current.pending_rewrite_items).length) saveRewriteDraftSnapshot();
    }

    function prepareLanguageReview() {
        restoreLanguageReviewState();
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

    function sentenceRewriteFeedbackHistory(id, result) {
        var record = state.current && state.current.rewrite_results || {};
        var rounds = safeArray(record.feedback_history).map(function(batch, index) {
            var item = safeArray(batch && batch.results).find(function(entry) {
                return firstText(entry && entry.sentence_id) === id;
            });
            if (!item) return null;
            return {
                round: Number(batch && batch.round) > 0 ? Number(batch.round) : index + 1,
                feedback: firstText(item.feedback, item.accepted ? '这句话已经修复。' : '请根据反馈再修改一次。')
            };
        }).filter(Boolean);
        if (rounds.length) return rounds;
        var legacyFeedback = firstText(result && result.feedback);
        return legacyFeedback ? [{ round: 1, feedback: legacyFeedback }] : [];
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

    function focusSentenceRewriteTarget(card, target, showRewriteFace) {
        if (!target) return;
        var phoneLayout = showRewriteFace && window.matchMedia('(max-width: 600px)').matches;
        if (!phoneLayout) {
            target.focus();
            return;
        }
        try { target.focus({ preventScroll: true }); }
        catch (error) { target.focus(); }
        window.requestAnimationFrame(function() {
            card.scrollIntoView({
                behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                block: 'start'
            });
        });
    }

    function revisionScanStatusClass(status) {
        return ['mapped', 'check', 'unresolved'].indexOf(status) >= 0 ? status : 'unresolved';
    }

    function revisionScanConfidenceMeta(confidence) {
        return ({
            high: { symbol: '✓', label: '识别置信度：高' },
            medium: { symbol: '!', label: '识别置信度：中，请检查' },
            low: { symbol: '?', label: '识别置信度：低，请仔细检查' }
        })[confidence] || { symbol: '?', label: '识别置信度：低，请仔细检查' };
    }

    function revisionScanWarningLabel(warning) {
        var code = typeof warning === 'string' ? warning : firstText(warning && warning.code);
        var labels = {
            EMPTY_RECOGNIZED_TEXT: '没有识别到可导入的句子文字。',
            MISSING_SENTENCE_NUMBER: '没有可靠识别到句子编号，请手动选择。',
            SENTENCE_NUMBER_OUT_OF_RANGE_OR_NOT_REQUIRED: '这个编号不属于当前需要订正的句子，请手动检查。',
            DUPLICATE_SENTENCE_NUMBER: '同一个句子编号出现了多次，请重新分配。'
        };
        return labels[code] || firstText(warning && warning.message, code, '这项内容需要检查。');
    }

    function revisionScanCandidate(candidate, index) {
        var scan = revisionScanState();
        var id = revisionScanCandidateId(candidate, index);
        return scan.candidates.find(function(item) { return item.candidate_id === id; }) || candidate;
    }

    function revisionScanDuplicateIds() {
        var counts = {};
        var eligible = revisionScanSentences().map(function(sentence, index) { return sentenceId(sentence, index); });
        revisionScanState().candidates.forEach(function(candidate) {
            var id = firstText(candidate.sentence_id);
            if (id && eligible.indexOf(id) >= 0) counts[id] = (counts[id] || 0) + 1;
        });
        return Object.keys(counts).filter(function(id) { return counts[id] > 1; });
    }

    function revisionScanCanConfirm() {
        var candidates = revisionScanState().candidates;
        var validIds = revisionScanSentences().map(function(sentence, index) { return sentenceId(sentence, index); });
        if (!candidates.length || revisionScanDuplicateIds().length) return false;
        return candidates.every(function(candidate) {
            return validIds.indexOf(firstText(candidate.sentence_id)) >= 0
                && Boolean(normalizedOcrText(candidate.recognized_text).trim());
        });
    }

    function updateRevisionScanConfirmState() {
        var button = document.querySelector('[data-confirm-revision-scan]');
        if (button) button.disabled = state.busy || !revisionScanCanConfirm();
    }

    function renderRevisionScanPhotoSelection() {
        destroyAiWaitingExperience();
        stopRevisionScanPolling();
        var scan = revisionScanState();
        scan.status = 'choosing';
        state.screen = 'revision-scan-photos';
        var count = scan.files.length;
        var previews = safeArray(scan.previewUrls).map(function(url, index) {
            return '<figure class="photo-preview-card revision-photo-card"><span>Photo ' + (index + 1) + '</span>' +
                '<img src="' + escapeHtml(url) + '" alt="Selected revision photo ' + (index + 1) + '">' +
                '<div><button class="danger-button compact" type="button" data-remove-revision-photo="' + index + '">Remove</button></div></figure>';
        }).join('');
        stage.innerHTML = '<section class="surface surface-pad revision-photo-selection" aria-label="Revision photos">' +
            '<div class="revision-photo-selection-heading"><h2>Revision Photos</h2><span>' + count + ' / 8</span></div>' +
            '<div class="photo-preview-grid revision-photo-preview-grid">' + previews + '</div>' +
            '<input id="revision-scan-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden>' +
            '<div class="form-actions revision-photo-actions"><button class="secondary-button" type="button" data-cancel-revision-scan>Cancel</button>' +
            '<button class="secondary-button" type="button" data-add-revision-photo' + (count >= 8 ? ' disabled' : '') + '>' + icon('camera') + 'Add Photo</button>' +
            '<button class="primary-button" type="button" data-start-revision-upload data-disable-when-busy' + (count ? '' : ' disabled') + '>Start Scanning</button></div></section>';
    }

    function addRevisionScanPhotos(files) {
        if (state.readOnly || state.busy) return;
        if (state.screen !== 'revision-scan-photos') resetRevisionScanState();
        var scan = revisionScanState();
        var additions = safeArray(files);
        var remaining = Math.max(0, 8 - scan.files.length);
        if (additions.length > remaining) setStatus('Revision Scan 最多可加入 8 张照片。');
        additions.slice(0, remaining).forEach(function(file) {
            scan.files.push(file);
            scan.previewUrls.push(URL.createObjectURL(file));
        });
        scan.operationId = '';
        scan.photoIds = [];
        scan.candidates = [];
        scan.pending = null;
        scan.job = null;
        if (scan.files.length) renderRevisionScanPhotoSelection();
        else renderLanguage();
    }

    function revisionScanCandidateHtml(candidate, index) {
        var scan = revisionScanState();
        var id = revisionScanCandidateId(candidate, index);
        var sentenceIdValue = firstText(candidate.sentence_id);
        var status = revisionScanStatusClass(candidate.status);
        if (!sentenceIdValue || !revisionScanSentences().some(function(sentence, sentenceIndex) {
            return sentenceId(sentence, sentenceIndex) === sentenceIdValue;
        })) status = 'unresolved';
        var duplicate = revisionScanDuplicateIds().indexOf(sentenceIdValue) >= 0;
        var selectedDetails = revisionScanSentenceDetails(status === 'unresolved' ? '' : sentenceIdValue);
        var confidence = ['high', 'medium', 'low'].indexOf(candidate.confidence) >= 0 ? candidate.confidence : 'low';
        var confidenceMeta = revisionScanConfidenceMeta(confidence);
        var claimedByAnother = revisionScanState().candidates.reduce(function(ids, item) {
            var sid = firstText(item.sentence_id);
            if (item.candidate_id !== id && sid && ids.indexOf(sid) < 0) ids.push(sid);
            return ids;
        }, []);
        var options = revisionScanSentences().map(function(sentence, sentenceIndex) {
            var sid = sentenceId(sentence, sentenceIndex);
            var details = revisionScanSentenceDetails(sid);
            var unavailable = claimedByAnother.indexOf(sid) >= 0 && sid !== sentenceIdValue;
            var optionLabel = details ? details.number + '  ' + firstText(details.sentence && details.sentence.original) : revisionScanSentenceLabel(sid);
            return '<option value="' + escapeHtml(sid) + '"' + (sid === sentenceIdValue && status !== 'unresolved' ? ' selected' : '') +
                (unavailable ? ' disabled' : '') + '>' + escapeHtml(optionLabel) + '</option>';
        }).join('');
        var warnings = safeArray(candidate.warnings).map(function(warning) {
            return '<li>' + escapeHtml(revisionScanWarningLabel(warning)) + '</li>';
        }).join('');
        return '<article class="revision-scan-candidate is-' + status + (duplicate ? ' has-duplicate' : '') + '" data-scan-candidate-row="' + escapeHtml(id) + '">' +
            '<label class="revision-scan-target' + (selectedDetails ? '' : ' is-unassigned') + '">' +
            '<span class="revision-scan-target-main"><strong class="revision-scan-target-number">' + (selectedDetails ? selectedDetails.number : '?') + '</strong>' +
            '<span class="revision-scan-target-copy">' + escapeHtml(selectedDetails ? firstText(selectedDetails.sentence && selectedDetails.sentence.original) : 'Select the sentence this rewrite belongs to') + '</span>' +
            '<span class="revision-scan-target-chevron" aria-hidden="true">⌄</span></span>' +
            '<select data-scan-sentence="' + escapeHtml(id) + '" aria-label="为识别项 ' + (index + 1) + ' 选择仍需订正的原句"><option value="">Select sentence</option>' + options + '</select></label>' +
            '<label class="revision-scan-recognized"><span class="revision-scan-confidence is-' + confidence + '" role="img" aria-label="' + escapeHtml(confidenceMeta.label) + '" title="' + escapeHtml(confidenceMeta.label) + '">' + confidenceMeta.symbol + '</span>' +
            '<textarea rows="3" data-scan-text="' + escapeHtml(id) + '" aria-label="编辑识别项 ' + (index + 1) + ' 的文字">' + escapeHtml(candidate.recognized_text) + '</textarea></label>' +
            (duplicate ? '<p class="revision-scan-warning">同一句被识别了两次。请为每一行选择不同的改写句子后再导入。</p>' : '') +
            (warnings ? '<ul class="revision-scan-warning-list">' + warnings + '</ul>' : '') + '</article>';
    }

    function renderRevisionScanReview() {
        if (state.screen === 'revision-scan-waiting' && state.waitingRunner) {
            finishAiWaitingExperience(function() { renderRevisionScanReview(); });
            return;
        }
        destroyAiWaitingExperience();
        stopRevisionScanPolling();
        var scan = revisionScanState();
        scan.status = 'ready';
        state.screen = 'revision-scan-review';
        var candidates = scan.candidates || [];
        var canConfirm = revisionScanCanConfirm();
        stage.innerHTML = '<section class="surface surface-pad revision-scan-surface" aria-label="扫描改写确认">' +
            (candidates.length ? '<div class="revision-scan-candidate-list">' + candidates.map(revisionScanCandidateHtml).join('') + '</div>' : '<p class="section-hint">没有可供确认的识别项目。你可以重新拍一张更清晰的照片。</p>') +
            '<div class="form-actions revision-scan-actions"><button class="secondary-button" type="button" data-cancel-revision-scan>返回 Sentence Revision</button>' +
            '<button class="primary-button" type="button" data-confirm-revision-scan' + (canConfirm ? '' : ' disabled') + '>Confirm Scanning</button></div></section>';
    }

    function renderRevisionScanWaiting(job, autoPoll, allowRetry, durable) {
        var scan = revisionScanState();
        scan.job = job || scan.job || {};
        var status = firstText(scan.job && scan.job.status, 'processing').toLowerCase();
        var isDurable = durable !== false && scan.job.durable !== false;
        renderAiWaitingExperience({
            kind: 'revision_ocr',
            jobStatus: isDurable ? status : 'photo_uploading',
            durable: isDurable,
            title: 'Matching your revisions',
            description: isDurable
                ? 'Your revision photos are safely uploaded. You may leave while recognition continues.'
                : 'Your revision photos are being uploaded and confirmed by the server.',
            pollStatusId: 'revision-scan-poll-status',
            statusCopy: isDurable
                ? 'Waiting for the same saved revision scan; the page checks every 5 seconds.'
                : 'Uploading is not yet confirmed. Keep this page open until the server confirms the handoff.',
            allowBackground: isDurable,
            extraActions: isDurable && allowRetry ? '<button class="secondary-button" type="button" data-retry-revision-scan>Retry the same request</button>' : ''
        });
        if (autoPoll) startRevisionScanPolling();
    }

    function renderRevisionScanFailure(error) {
        stopRevisionScanPolling();
        var message = firstText(error && error.message, '照片识别没有完成。你的作文和现有改写草稿仍然安全保存。');
        destroyAiWaitingExperience();
        state.screen = 'revision-scan-failed';
        stage.innerHTML = '<section class="surface error-state revision-scan-failure"><strong>Revision Scan 没有完成</strong><p>' + escapeHtml(message) + '</p>' +
            '<div class="form-actions"><button class="secondary-button" type="button" data-retry-revision-scan>重新检查状态</button><button class="primary-button" type="button" data-reupload-revision-scan>重新拍照</button></div>' +
            '<button class="quiet-button" type="button" data-cancel-revision-scan>返回 Sentence Revision</button></section>';
    }

    function startRevisionScanPolling() {
        if (state.revisionScanPollActive || !compositionId(state.current)) return;
        state.revisionScanPollActive = true;
        state.revisionScanPollGeneration += 1;
        var generation = state.revisionScanPollGeneration;
        function poll() {
            if (!state.revisionScanPollActive || generation !== state.revisionScanPollGeneration) return;
            writingCall('getComposition', { composition_id: compositionId(state.current) }).then(function(result) {
                if (!state.revisionScanPollActive || generation !== state.revisionScanPollGeneration) return;
                var composition = result.composition || {};
                state.current = composition;
                syncRevisionScanFromComposition(composition);
                if (revisionScanReady(composition)) {
                    renderRevisionScanReview();
                    return;
                }
                var job = revisionScanJobFrom(composition);
                if (firstText(job.status).toLowerCase() === 'failed') {
                    renderRevisionScanFailure({ message: '云端没有完成照片识别，请重新检查状态或拍照。' });
                    return;
                }
                updateAiWaitingExperience({ kind: 'revision_ocr', jobStatus: job.status, durable: true, pollStatusId: 'revision-scan-poll-status', statusCopy: 'Waiting for the same saved revision scan; the page checks every 5 seconds.' });
                syncCurrentSummary();
                var pollStatus = document.getElementById('revision-scan-poll-status');
                if (pollStatus) pollStatus.textContent = '正在等待识别结果；每 5 秒查询一次。';
                window.setTimeout(poll, 5000);
            }).catch(function() {
                if (!state.revisionScanPollActive || generation !== state.revisionScanPollGeneration) return;
                var pollStatus = document.getElementById('revision-scan-poll-status');
                if (pollStatus) pollStatus.textContent = '暂时无法查询，网络恢复后会继续。当前改写草稿已经安全保存。';
                window.setTimeout(poll, 5000);
            });
        }
        poll();
    }

    function beginRevisionScanUpload(files) {
        if (state.readOnly || state.busy || !compositionId(state.current)) return;
        var selectedFiles = safeArray(files).slice(0, 8);
        if (!selectedFiles.length) return;
        var scan = revisionScanState();
        scan.files = selectedFiles;
        releaseRevisionScanPreviewUrls(scan);
        scan.photoIds = [];
        scan.candidates = [];
        scan.pending = null;
        scan.operationId = logicalOperationId('revision-scan', JSON.stringify({
            composition_id: compositionId(state.current), revision: state.current && state.current.revision,
            files: selectedFiles.map(function(file) { return [file.name || '', file.size || 0, file.lastModified || 0, file.type || '']; })
        }));
        setStatus('');
        setBusy(true);
        renderRevisionScanWaiting({ status: 'photo_uploading', job_type: 'revision_ocr', operation_id: scan.operationId, durable: false }, false, false, false);
        Promise.all(selectedFiles.map(function(file) { return window.MrCatCloud.prepareEvidenceImage(file); })).then(function(preparedPages) {
            return retryNetworkTask(function() {
                return writingCall('startRevisionScanUpload', {
                    composition_id: compositionId(state.current),
                    operation_id: scan.operationId,
                    pages: preparedPages.map(function(prepared, index) {
                        return { file_name: selectedFiles[index].name || 'revision-' + (index + 1) + '.jpg', mime_type: prepared.display.type || 'image/jpeg', size_bytes: prepared.display.size };
                    })
                }).then(function(started) {
                    if (started && started.composition) state.current = started.composition;
                    var uploads = safeArray(started && started.uploads);
                    if (!uploads.length && started && started.job) return started;
                    if (uploads.length !== preparedPages.length) throw new Error('照片上传信息不完整，请重试。');
                    return Promise.all(uploads.map(function(upload, index) {
                        return window.MrCatCloud.uploadWithMetadata(upload, preparedPages[index].display);
                    })).then(function() {
                        scan.photoIds = uploads.map(function(upload) { return upload.photo_id; });
                        return writingCall('finishRevisionScanUpload', {
                            composition_id: compositionId(state.current), operation_id: scan.operationId, photo_ids: scan.photoIds
                        });
                    });
                });
            }, 2);
        }).then(function(result) {
            if (result && result.composition) state.current = result.composition;
            syncRevisionScanFromComposition(state.current);
            if (revisionScanReady(state.current)) {
                renderRevisionScanReview();
                return;
            }
            scan.job = result && result.job || revisionScanJobFrom(state.current) || scan.job;
            scan.status = 'processing';
            renderRevisionScanWaiting(scan.job, true, false);
            syncCurrentSummary();
        }).catch(function(error) {
            if (isNetworkDisconnect(error)) {
                renderRevisionScanFailure({
                    message: '网络中断，暂时无法确认照片是否已经完整交给云端。请重新检查状态；如果照片没有完成上传，再重新拍照。当前改写草稿不会丢失。'
                });
                return;
            }
            clearLogicalOperation('revision-scan');
            renderRevisionScanFailure(error);
        }).finally(function() { setBusy(false); });
    }

    function confirmRevisionScanImport() {
        if (state.busy || state.readOnly) return;
        var scan = revisionScanState();
        var validIds = revisionScanSentences().map(function(sentence, index) { return sentenceId(sentence, index); });
        var duplicateIds = revisionScanDuplicateIds();
        var selected = [];
        var errors = [];
        scan.candidates.forEach(function(candidate, index) {
            var id = revisionScanCandidateId(candidate, index);
            var chosenSentenceId = firstText(candidate.sentence_id);
            var text = normalizedOcrText(candidate.recognized_text).trim();
            if (!chosenSentenceId || validIds.indexOf(chosenSentenceId) < 0) {
                errors.push('识别项 ' + (index + 1) + ' 还没有选择有效句子。');
                return;
            }
            if (duplicateIds.indexOf(chosenSentenceId) >= 0) {
                errors.push(revisionScanSentenceLabel(chosenSentenceId) + '被重复匹配，请调整识别项。');
                return;
            }
            if (!text) {
                errors.push('识别项 ' + (index + 1) + ' 没有文字。');
                return;
            }
            selected.push({ sentence_id: chosenSentenceId, text: text });
        });
        if (errors.length) {
            setStatus(errors[0]);
            return;
        }
        setBusy(true);
        updateRevisionScanConfirmState();
        setStatus('');
        writingCall('confirmRevisionScanImport', {
            composition_id: compositionId(state.current),
            revision: scan.pending && scan.pending.composition_revision || state.current && state.current.revision,
            operation_id: scan.pending && scan.pending.operation_id || scan.operationId,
            items: selected
        }).then(function(result) {
            if (result && result.composition) state.current = result.composition;
            selected.forEach(function(item) { state.rewrites[item.sentence_id] = item.text; delete state.skipped[item.sentence_id]; });
            safeArray(state.review && state.review.sentences).forEach(function(sentence, index) {
                if (rewriteRequired(sentence)) state.rewriteFace[sentenceId(sentence, index)] = true;
            });
            saveRewriteDraftSnapshot();
            syncRevisionScanFromComposition(state.current);
            clearLogicalOperation('revision-scan');
            renderLanguage();
            setStatus('已导入选中的扫描草稿。请继续检查，完成后再按 Submit。');
        }).catch(function(error) {
            if (isNetworkDisconnect(error)) {
                renderRevisionScanReview();
                setStatus('网络暂时中断。导入状态尚未确认；请稍后重试，当前改写草稿不会丢失。');
                return;
            }
            setStatus(firstText(error && error.message, '扫描草稿导入没有完成，请重试。'));
        }).finally(function() {
            setBusy(false);
            updateRevisionScanConfirmState();
        });
    }

    function renderLanguage() {
        destroyAiWaitingExperience();
        state.screen = 'language';
        updateRevisionProgress();
        var sentences = safeArray(state.review && state.review.sentences);
        if (!sentences.length) {
            stage.innerHTML = '<section class="surface empty-state"><strong>没有需要重写的句子</strong><p>这次批改没有返回逐句训练内容。</p><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button></section>';
            return;
        }
        if (state.activeSentence >= sentences.length) state.activeSentence = Math.max(0, sentences.length - 1);
        var cards = sentences.map(sentenceCardHtml).join('');
        var manuscript = firstText(state.current && state.current.confirmed_text, state.confirmedText, '暂无原文。');
        var cefrEstimate = state.review && state.review.cefr_estimate;
        var cefrPositionSuffixes = { lower: '-', middle: '', upper: '+' };
        var cefrSuffix = cefrEstimate && Object.prototype.hasOwnProperty.call(cefrPositionSuffixes, cefrEstimate.position) ?
            cefrPositionSuffixes[cefrEstimate.position] : '';
        var cefrHtml = cefrEstimate && cefrEstimate.level ?
            '<div class="cefr-estimate"><span class="cefr-estimate-label">CEFR Writing Estimate</span>' +
            '<strong>' + escapeHtml(cefrEstimate.level + cefrSuffix) + '</strong>' +
            (cefrEstimate.commentary_zh ? '<p>' + escapeHtml(cefrEstimate.commentary_zh) + '</p>' : '') + '</div>' : '';
        stage.innerHTML = '<div class="language-review-stack">' +
            '<section class="surface language-review-card language-overall-card"><h2>Language Review</h2>' + (state.readOnly ? '<p class="language-readonly-note">这是作品库中已保存的语言训练记录，只读显示。</p>' : '') + cefrHtml + '<p>' + escapeHtml(firstText(state.review && state.review.overview, state.review && state.review.summary, '请阅读整体建议，再逐句完成需要修改的表达。')) + '</p></section>' +
            '<section class="surface language-review-card language-manuscript-card"><div class="language-section-heading"><h2>Draft</h2></div><div class="manuscript-text">' + highlightedManuscriptHtml(manuscript, sentences) + '</div></section>' +
            '<section class="surface language-review-card language-sentence-review-card">' +
            '<nav class="language-toolbar" aria-label="句子导航"><div class="capsule-row">' + sentences.map(sentenceCapsuleHtml).join('') + '</div></nav>' +
            '<div class="language-section-heading sentence-review-heading"><h2>Sentence Revision</h2></div>' +
            '<div class="sentence-stage"><div class="sentence-list">' + cards + '</div></div>' +
            (!state.readOnly ? '<div class="batch-actions">' +
                (revisionScanSentences().length ? '<button class="secondary-button scan-revision-trigger" type="button" data-start-revision-scan aria-label="Scan Revisions" title="Scan Revisions">' + icon('camera') + '</button><input id="revision-scan-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden>' : '') +
                '<button class="primary-button" type="button" data-submit-rewrites data-disable-when-busy>Submit</button></div>' : '') +
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
        var analysisCopy = analysisParts.map(function(part) {
            return /[。！？!?；;.]$/.test(part) ? part : part + '。';
        }).join(' ') || '请根据建议调整这句话。';
        var feedbackHistoryHtml = sentenceRewriteFeedbackHistory(id, result).map(function(entry) {
            return '<div class="rewrite-feedback-round"><p>' + escapeHtml(entry.feedback) + '</p></div>';
        }).join('');
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
            '<section class="grammar-analysis" aria-label="语法建议"><p class="grammar-analysis-copy">' + escapeHtml(analysisCopy) + '</p>' + feedbackHistoryHtml + '</section>' +
            sampleButton + reference + '</div></section>';
        var correctedSentence = firstText(result && result.student_rewrite, state.rewrites[id]);
        var correctedResponse = '<p class="corrected-sentence"><span class="sentence-corrected-highlight">' + escapeHtml(correctedSentence) + '</span></p>';
        var editableResponse = '<p class="original-sentence">' + original + '</p>' +
            '<div class="rewrite-area"><label for="rewrite-' + escapeHtml(id) + '">Your Attempt</label><textarea class="rewrite-input" id="rewrite-' + escapeHtml(id) + '" data-rewrite-id="' + escapeHtml(id) + '" placeholder="不要照抄，按自己的理解重写这句话…" ' + (state.readOnly ? 'disabled' : '') + '>' + escapeHtml(state.rewrites[id]) + '</textarea></div>';
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
        destroyAiWaitingExperience();
        state.screen = 'completed';
        updateRevisionProgress();
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
            if (!state.readOnly && composition.language_review) {
                state.review = composition.language_review;
                restoreLanguageReviewState();
            }
            syncRevisionScanFromComposition(composition);
            var revisionScanJob = revisionScanJobFrom(composition);
            var revisionScanStatus = firstText(revisionScanJob.status).toLowerCase();
            if (!state.readOnly && revisionScanReady(composition)) {
                state.review = composition.language_review || review;
                renderRevisionScanReview();
                syncCurrentSummary();
                return;
            }
            if (!state.readOnly && revisionScanJob.job_type === 'revision_ocr'
                && ['queued', 'processing', 'revision_queued', 'revision_processing'].indexOf(revisionScanStatus) >= 0) {
                renderRevisionScanWaiting(revisionScanJob, true, false);
                syncCurrentSummary();
                return;
            }
            if (!state.readOnly && revisionScanJob.job_type === 'revision_ocr' && revisionScanStatus === 'failed') {
                renderRevisionScanFailure({ message: '云端没有完成照片识别，请重新检查状态或拍照。' });
                syncCurrentSummary();
                return;
            }
            if (!state.readOnly && composition.pending_upload && composition.pending_upload.kind === 'revision_scan') {
                renderRevisionScanFailure({ message: '订正照片的上传尚未完整确认。请重新检查状态；如果仍未完成，再重新拍照。当前改写草稿不会丢失。' });
                syncCurrentSummary();
                return;
            }
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
        }).catch(function(error) {
            var code = error && (error.code || error.result && error.result.code) || '';
            if (code === 'COMPOSITION_NOT_FOUND') {
                state.current = null;
                state.review = null;
                syncCompositionLocator('');
                updateCurrentWritingTitle();
                renderPortfolio();
                renderWelcome();
                setStatus('这篇空白或过期作文已被清理。');
                return;
            }
            renderFatalAction(error);
        }).finally(function() { setBusy(false); });
    }

    function renderFatalAction(error) {
        destroyAiWaitingExperience();
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

    function sourceHasUserInput() {
        return Boolean(state.title || state.promptText || state.confirmedText.trim()
            || state.photoFiles.length || state.photoIds.length);
    }

    function requestSourceDiscard() {
        if (!sourceHasUserInput()) {
            returnToTutorHome();
            return;
        }
        openLeaveConfirmation('discard');
    }

    function openLeaveConfirmation(action) {
        if (state.leaveDialogOpen) return;
        state.leaveDialogAction = action === 'discard' ? 'discard' : 'dashboard';
        state.returnFocus = document.activeElement;
        state.leaveDialogOpen = true;
        var title = leaveConfirmation.querySelector('#leave-confirmation-title');
        var copy = leaveConfirmation.querySelector('#leave-confirmation-copy');
        var confirm = leaveConfirmation.querySelector('button[data-confirm-leave]');
        if (state.leaveDialogAction === 'discard') {
            if (title) title.textContent = 'Discard this writing?';
            if (copy) copy.textContent = 'Your saved draft will stay in History. Changes that have not been saved will be discarded.';
            if (confirm) confirm.textContent = 'Discard';
        } else {
            if (title) title.textContent = 'Leave this writing?';
            if (copy) copy.textContent = 'Your saved work is safe. OCR and AI review will continue in the background.';
            if (confirm) confirm.textContent = 'Leave';
        }
        leaveConfirmation.hidden = false;
        app.inert = true;
        updateOverlayLock();
        window.requestAnimationFrame(function() {
            var cancel = leaveConfirmation.querySelector('button[data-cancel-leave]');
            if (cancel) cancel.focus();
        });
    }

    function closeLeaveConfirmation(restoreFocus) {
        if (!state.leaveDialogOpen) return;
        state.leaveDialogOpen = false;
        leaveConfirmation.hidden = true;
        app.inert = false;
        updateOverlayLock();
        if (restoreFocus !== false && state.returnFocus && typeof state.returnFocus.focus === 'function') state.returnFocus.focus();
        state.returnFocus = null;
    }

    function confirmLeave() {
        var action = state.leaveDialogAction;
        closeLeaveConfirmation(false);
        if (action === 'discard') {
            window.clearTimeout(state.autosaveTimer);
            state.autosaveTimer = null;
            returnToTutorHome();
            return;
        }
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
        if (target.matches('[data-scan-text]')) {
            var scanCandidate = revisionScanState().candidates.find(function(candidate) {
                return candidate.candidate_id === target.getAttribute('data-scan-text');
            });
            if (scanCandidate) scanCandidate.recognized_text = normalizedOcrText(target.value);
            updateRevisionScanConfirmState();
        }
        if (target.id === 'ocr-text' || target.closest && target.closest('#ocr-text')) {
            var editor = target.id === 'ocr-text' ? target : target.closest('#ocr-text');
            clearChangedOcrMarks(editor);
            state.confirmedText = ocrEditorText(editor);
        }
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
        if (target.id === 'revision-scan-photo' && target.files && target.files.length) {
            addRevisionScanPhotos(Array.prototype.slice.call(target.files));
            target.value = '';
        }
        if (target.matches('[data-scan-sentence]')) {
            var sentenceCandidate = revisionScanState().candidates.find(function(candidate) {
                return candidate.candidate_id === target.getAttribute('data-scan-sentence');
            });
            if (sentenceCandidate) {
                sentenceCandidate.sentence_id = target.value || null;
                sentenceCandidate.status = sentenceCandidate.sentence_id ? 'check' : 'unresolved';
                renderRevisionScanReview();
            }
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
        var ocrMark = event.target.closest && event.target.closest('[data-ocr-uncertain]');
        if (ocrMark) {
            unwrapOcrMark(ocrMark, true);
            state.confirmedText = ocrEditorText(document.getElementById('ocr-text'));
            return;
        }
        var button = event.target.closest('button,[data-open-composition],[data-cancel-leave],[data-manuscript-sentence]');
        if (!button) return;
        if (button.matches('#history-home')) openLeaveConfirmation();
        else if (button.matches('[data-cancel-leave]')) closeLeaveConfirmation();
        else if (button.matches('[data-confirm-leave]')) confirmLeave();
        else if (button.matches('[data-discard-source]')) requestSourceDiscard();
        else if (button.matches('[data-edit-title]')) beginTitleEdit(button.getAttribute('data-edit-title'));
        else if (button.matches('[data-cancel-title]')) cancelTitleEdit();
        else if (button.matches('[data-start-new]')) createNewWriting();
        else if (button.matches('[data-return-home]')) returnToTutorHome();
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
        }
        else if (button.matches('[data-confirm-ocr]')) {
            state.confirmedText = firstText(ocrEditorText(document.getElementById('ocr-text')));
            if (!state.confirmedText) { setStatus('请先确认或补全 OCR 文本。'); return; }
            setBusy(true); saveAndEvaluate();
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
                focusSentenceRewriteTarget(flipCard, focusTarget, showRewriteFace);
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
        else if (button.matches('[data-start-revision-scan]')) {
            var scanInput = document.getElementById('revision-scan-photo');
            if (scanInput) scanInput.click();
        }
        else if (button.matches('[data-add-revision-photo]')) {
            var additionInput = document.getElementById('revision-scan-photo');
            if (additionInput) additionInput.click();
        }
        else if (button.matches('[data-remove-revision-photo]')) {
            var scan = revisionScanState();
            var photoIndex = Number(button.getAttribute('data-remove-revision-photo'));
            if (scan.previewUrls[photoIndex] && scan.previewUrls[photoIndex].indexOf('blob:') === 0) URL.revokeObjectURL(scan.previewUrls[photoIndex]);
            scan.files.splice(photoIndex, 1);
            scan.previewUrls.splice(photoIndex, 1);
            if (scan.files.length) renderRevisionScanPhotoSelection();
            else { resetRevisionScanState(); renderLanguage(); }
        }
        else if (button.matches('[data-start-revision-upload]')) {
            beginRevisionScanUpload(revisionScanState().files.slice());
        }
        else if (button.matches('[data-cancel-revision-scan]')) {
            stopRevisionScanPolling();
            if (state.screen === 'revision-scan-photos') resetRevisionScanState();
            renderLanguage();
        }
        else if (button.matches('[data-retry-revision-scan]')) {
            loadComposition(compositionId(state.current), false);
        }
        else if (button.matches('[data-reupload-revision-scan]')) {
            clearLogicalOperation('revision-scan');
            resetRevisionScanState();
            renderLanguage();
            window.requestAnimationFrame(function() {
                var input = document.getElementById('revision-scan-photo');
                if (input) input.click();
            });
        }
        else if (button.matches('[data-confirm-revision-scan]')) confirmRevisionScanImport();
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

    document.getElementById('history-new-writing').addEventListener('click', function() {
        closeSidebar();
        createNewWriting();
    });
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
    document.addEventListener('visibilitychange', function() {
        if (!state.waitingRunner) return;
        try {
            if (document.hidden) state.waitingRunner.pause();
            else state.waitingRunner.resume();
        } catch (error) {}
    });
    window.addEventListener('pagehide', function() {
        destroyAiWaitingExperience();
    });

    if (currentWritingTitleWindow && window.ResizeObserver) {
        currentWritingTitleResizeObserver = new ResizeObserver(scheduleCurrentWritingTitleOverflow);
        currentWritingTitleResizeObserver.observe(currentWritingTitleWindow);
    } else {
        window.addEventListener('resize', scheduleCurrentWritingTitleOverflow);
    }
    if (window.matchMedia) {
        var currentWritingTitleMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (currentWritingTitleMotionPreference.addEventListener) {
            currentWritingTitleMotionPreference.addEventListener('change', scheduleCurrentWritingTitleOverflow);
        }
    }

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
            app.setAttribute('aria-busy', 'false');
            renderPortfolio();
            var requestedId = requestedCompositionId();
            if (requestedId) loadComposition(requestedId);
            else renderWelcome();
        }).catch(function(error) {
            app.setAttribute('aria-busy', 'false');
            stage.innerHTML = '<section class="surface error-state"><strong>需要学生登录</strong><p>' + escapeHtml(error && error.message || '无法打开 AI Tutor。') + '</p><a class="primary-button" href="index.html">前往登录</a></section>';
        });
    }

    init();
})(window, document);
