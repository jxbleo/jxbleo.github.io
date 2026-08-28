(function(window, document) {
    'use strict';

    var state = {
        session: null,
        profile: null,
        writingProfile: [],
        quota: null,
        rubrics: [],
        compositions: [],
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
        activeSourcePhotoIndex: 0,
        ocr: null,
        ocrReviewText: '',
        ocrTitleUndo: null,
        scanTarget: 'writing',
        activeSentence: 0,
        manuscriptView: 'draft',
        rewrites: {},
        rewriteResults: {},
        skipped: {},
        rewriteFace: {},
        revisionTextLevel: 1,
        revisionSkin: 'green',
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
        waitingIssueCode: '',
        waitingIssueMode: '',
        waitingFinishPending: false,
        waitingPollTimer: null,
        waitingPollInFlight: false,
        waitingPollWakePending: false,
        waitingPollFailures: 0,
        waitingPollNow: null,
        waitingPollKind: '',
        waitingResultAction: null,
        waitingReadyAnnounced: false,
        waitingReadySoundTimer: null,
        waitingAudioContext: null,
        waitingAudioOutput: null,
        sidebarOpen: false,
        toolbarTitleEditing: false,
        titleEditError: '',
        homeComposerOpen: false,
        homeComposerPreparing: false,
        homeComposerError: '',
        compositionEntryDialogOpen: false,
        compositionEntryTargetId: '',
        compositionEntryReturnFocus: null,
        photoChoiceOpen: false,
        photoChoiceContext: '',
        photoChoiceTarget: 'writing',
        photoChoiceReturnFocus: null,
        photoViewerOpen: false,
        photoViewerUrls: [],
        photoViewerIndex: 0,
        photoViewerReturnFocus: null,
        photoRemoveDialogOpen: false,
        pendingPhotoRemoval: null,
        photoRemoveReturnFocus: null,
        leaveDialogOpen: false,
        incompleteRewriteAlertOpen: false,
        incompleteRewriteTargetId: '',
        sentenceFeedbackOpen: false,
        sentenceFeedbackIndex: -1,
        sentenceFeedbackReturnFocus: null,
        scanSubmitConfirmationOpen: false,
        scanSubmitReturnFocus: null,
        leaveDialogAction: 'dashboard',
        returnFocus: null
    };

    var app = document.getElementById('ai-tutor-app');
    var stage = document.getElementById('ai-tutor-stage');
    var statusBox = document.getElementById('global-status');
    var portfolioList = document.getElementById('portfolio-list');
    var writingProfileSummary = document.getElementById('writing-profile-summary');
    var portfolioSidebar = document.getElementById('portfolio-sidebar');
    var sidebarScrim = document.getElementById('sidebar-scrim');
    var portfolioToggle = document.getElementById('portfolio-toggle');
    var revisionProgress = document.getElementById('revision-progress');
    var currentWritingTitleWindow = document.getElementById('current-writing-title-window');
    var currentWritingTitleTrack = document.getElementById('current-writing-title-track');
    var currentWritingTitleShell = document.getElementById('current-writing-title-shell');
    var currentWritingTitleDisplay = document.getElementById('current-writing-title-display');
    var currentWritingTitleEdit = document.getElementById('current-writing-title-edit');
    var currentWritingTitleForm = document.getElementById('current-writing-title-form');
    var currentWritingTitleInput = document.getElementById('current-writing-title-input');
    var currentWritingTitleCancel = document.getElementById('current-writing-title-cancel');
    var sidebarDockedQuery = window.matchMedia ? window.matchMedia('(min-width: 820px)') : null;
    var leaveConfirmation = document.getElementById('leave-confirmation');
    var incompleteRewriteAlert = document.getElementById('incomplete-rewrite-alert');
    var sentenceFeedbackDialog = document.getElementById('sentence-feedback-dialog');
    var scanSubmitConfirmation = document.getElementById('scan-submit-confirmation');
    var photoChoiceLayer = document.getElementById('photo-choice-layer');
    var photoRemoveConfirmation = document.getElementById('photo-remove-confirmation');
    var photoViewerLayer = document.getElementById('photo-viewer-layer');
    var sentenceCardResizeObserver = null;
    var currentWritingTitleResizeObserver = null;
    var stageViewportResetToken = 0;
    var stageMaterializeToken = 0;
    var revisionTextScales = [0.9, 1, 1.15, 1.3];
    var revisionTextLevelStorageKey = 'mrcat-writing-revision-text-level-v1';
    var revisionSkinStorageKey = 'mrcat-writing-revision-skin-v1';

    function scheduleStageViewportReset() {
        updateToolbarNavigation();
        var token = ++stageViewportResetToken;
        window.requestAnimationFrame(function() {
            window.requestAnimationFrame(function() {
                if (token !== stageViewportResetToken) return;
                var main = document.getElementById('ai-tutor-main');
                var header = document.querySelector('.ai-tutor-header');
                if (!main) return;
                var headerBottom = header ? header.getBoundingClientRect().bottom : 0;
                var targetTop = window.pageYOffset + main.getBoundingClientRect().top - Math.max(12, headerBottom + 12);
                window.scrollTo(0, Math.max(0, targetTop));
            });
        });
    }

    function materializeStage() {
        var token = ++stageMaterializeToken;
        stage.classList.remove('is-opening');
        window.requestAnimationFrame(function() {
            if (token !== stageMaterializeToken || !stage.firstElementChild) return;
            stage.classList.add('is-opening');
            var surface = stage.firstElementChild;
            var cleanup = function() {
                if (token === stageMaterializeToken) stage.classList.remove('is-opening');
            };
            surface.addEventListener('animationend', cleanup, { once: true });
            window.setTimeout(cleanup, 560);
        });
    }

    function isWritingDetailScreen() {
        return Boolean(state.current && state.screen !== 'welcome');
    }

    function updateToolbarNavigation() {
        if (!portfolioToggle) return;
        portfolioToggle.setAttribute('aria-label', state.sidebarOpen ? 'Close writing sidebar' : 'Open writing sidebar');
        portfolioToggle.setAttribute('aria-expanded', String(state.sidebarOpen));
    }

    function isSidebarDockedViewport() {
        return Boolean(sidebarDockedQuery && sidebarDockedQuery.matches);
    }

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
        safeArray(spans).forEach(function(span, spanIndex) {
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
            ranges.push({
                start: start,
                end: start + needle.length,
                text: source.slice(start, start + needle.length),
                span_index: Number.isInteger(span && span.span_index) ? span.span_index : spanIndex
            });
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
                html += '<mark class="ocr-uncertain" data-ocr-uncertain data-ocr-span-index="' + escapeHtml(range.span_index) + '" data-original="' + escapeHtml(range.text) +
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

    function splitOcrFirstLine(text) {
        var lines = normalizedOcrText(text).split('\n');
        var firstLineIndex = lines.findIndex(function(line) { return Boolean(line.trim()); });
        if (firstLineIndex < 0) return null;
        var title = lines[firstLineIndex].trim();
        lines.splice(firstLineIndex, 1);
        while (lines.length && !lines[0].trim()) lines.shift();
        return {
            title: title,
            remaining: lines.join('\n').replace(/\n{3,}/g, '\n\n').replace(/\s+$/g, '')
        };
    }

    function ocrRegionAcknowledgements() {
        return Array.prototype.slice.call(document.querySelectorAll('[data-ocr-region-index].is-acknowledged')).map(function(region) {
            return region.getAttribute('data-ocr-region-index');
        });
    }

    function restoreOcrRegionAcknowledgements(indexes) {
        var acknowledged = safeArray(indexes);
        Array.prototype.slice.call(document.querySelectorAll('[data-ocr-region-index]')).forEach(function(region) {
            var hidden = acknowledged.indexOf(region.getAttribute('data-ocr-region-index')) >= 0;
            region.classList.toggle('is-acknowledged', hidden);
            region.setAttribute('aria-hidden', String(hidden));
            region.setAttribute('tabindex', hidden ? '-1' : '0');
        });
    }

    function syncOcrRegionsWithEditor() {
        var editor = document.getElementById('ocr-text');
        if (!editor) return;
        Array.prototype.slice.call(document.querySelectorAll('[data-ocr-region-index]')).forEach(function(region) {
            var spanIndex = region.getAttribute('data-ocr-region-index');
            if (editor.querySelector('[data-ocr-uncertain][data-ocr-span-index="' + spanIndex + '"]')) return;
            region.classList.add('is-acknowledged');
            region.setAttribute('aria-hidden', 'true');
            region.setAttribute('tabindex', '-1');
        });
    }

    function updateOcrTitleUndoUi(message, tone) {
        var action = document.querySelector('[data-use-ocr-first-line]');
        var feedback = document.querySelector('[data-ocr-title-feedback]');
        if (action) {
            var canUndo = Boolean(state.ocrTitleUndo);
            action.textContent = canUndo ? 'Undo' : 'Use first line';
            action.setAttribute('aria-label', canUndo ? 'Undo use of first line as title' : 'Use first line as title');
            action.classList.toggle('is-undo', canUndo);
        }
        if (feedback) {
            var copy = firstText(message);
            feedback.textContent = copy;
            feedback.hidden = !copy;
            feedback.classList.toggle('is-error', tone === 'error');
        }
    }

    function clearOcrTitleUndo() {
        state.ocrTitleUndo = null;
        updateOcrTitleUndoUi('');
    }

    function useOcrFirstLine() {
        var editor = document.getElementById('ocr-text');
        var input = document.getElementById('ocr-title');
        if (!editor || !input) return;
        var originalText = ocrEditorText(editor);
        var extracted = splitOcrFirstLine(originalText);
        if (!extracted || !extracted.title) {
            updateOcrTitleUndoUi('No first line was found.', 'error');
            return;
        }
        if (extracted.title.length > 80) {
            updateOcrTitleUndoUi('The first line is too long for a title. You can enter it manually.', 'error');
            return;
        }
        state.ocrTitleUndo = {
            title: state.title,
            text: originalText,
            editorHtml: editor.innerHTML,
            acknowledgedRegions: ocrRegionAcknowledgements()
        };
        state.title = extracted.title;
        state.ocrReviewText = extracted.remaining;
        state.confirmedText = extracted.remaining;
        input.value = state.title;
        editor.innerHTML = ocrEditorHtml(extracted.remaining, state.ocr && state.ocr.uncertain_spans);
        syncOcrRegionsWithEditor();
        updateOcrTitleUndoUi('');
    }

    function undoOcrFirstLine() {
        var snapshot = state.ocrTitleUndo;
        var editor = document.getElementById('ocr-text');
        var input = document.getElementById('ocr-title');
        if (!snapshot || !editor || !input) return;
        state.title = snapshot.title;
        state.ocrReviewText = snapshot.text;
        state.confirmedText = snapshot.text;
        input.value = snapshot.title;
        editor.innerHTML = snapshot.editorHtml;
        restoreOcrRegionAcknowledgements(snapshot.acknowledgedRegions);
        state.ocrTitleUndo = null;
        updateOcrTitleUndoUi('');
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

    function hideOcrRegion(spanIndex) {
        if (spanIndex == null) return;
        var selector = '[data-ocr-region-index="' + String(spanIndex).replace(/[^0-9-]/g, '') + '"]';
        Array.prototype.slice.call(document.querySelectorAll(selector)).forEach(function(region) {
            region.classList.add('is-acknowledged');
            region.setAttribute('aria-hidden', 'true');
            region.setAttribute('tabindex', '-1');
        });
    }

    function activateOcrRegion(region) {
        if (!region || region.classList.contains('is-acknowledged')) return;
        var spanIndex = region.getAttribute('data-ocr-region-index');
        var mark = document.querySelector('[data-ocr-uncertain][data-ocr-span-index="' + spanIndex + '"]');
        if (!mark) return;
        var editor = document.getElementById('ocr-text');
        if (editor && typeof editor.focus === 'function') {
            try { editor.focus({ preventScroll: true }); } catch (error) { editor.focus(); }
        }
        var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (typeof mark.scrollIntoView === 'function') mark.scrollIntoView({ block: 'center', behavior: reducedMotion ? 'auto' : 'smooth' });
        mark.classList.add('is-active');
        region.classList.add('is-active');
        window.setTimeout(function() {
            mark.classList.remove('is-active');
            region.classList.remove('is-active');
        }, 900);
    }

    function clearChangedOcrMarks(editor) {
        if (!editor) return;
        Array.prototype.slice.call(editor.querySelectorAll('[data-ocr-uncertain]')).forEach(function(mark) {
            if ((mark.textContent || '') !== (mark.getAttribute('data-original') || '')) {
                hideOcrRegion(mark.getAttribute('data-ocr-span-index'));
                unwrapOcrMark(mark, false);
            }
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
        var editableTitle = editableCompositionTitle(state.current);
        var title = state.current ? compositionTitle(state.current) : 'Start new Writing';
        currentWritingTitleTrack.textContent = title;
        currentWritingTitleWindow.hidden = false;
        currentWritingTitleWindow.setAttribute('aria-label', state.current ? 'Current writing: ' + title : 'Start new Writing');
        if (currentWritingTitleShell) currentWritingTitleShell.classList.toggle('is-new-writing', !state.current);
        if (currentWritingTitleEdit) currentWritingTitleEdit.hidden = !state.current || !editableTitle || state.toolbarTitleEditing;
        if (currentWritingTitleDisplay) currentWritingTitleDisplay.hidden = state.toolbarTitleEditing;
        if (currentWritingTitleForm) currentWritingTitleForm.hidden = !state.toolbarTitleEditing;
        document.title = state.current ? title + ' | AI Tutor' : 'Writing | Mr. Cat Academy';
        scheduleCurrentWritingTitleOverflow();
    }

    function beginToolbarTitleEdit() {
        var title = editableCompositionTitle(state.current);
        if (!state.current || !title || state.busy) return;
        state.toolbarTitleEditing = true;
        state.titleEditError = '';
        updateCurrentWritingTitle();
        window.requestAnimationFrame(function() {
            if (!currentWritingTitleInput) return;
            currentWritingTitleInput.value = title;
            currentWritingTitleInput.focus();
            currentWritingTitleInput.select();
        });
    }

    function cancelToolbarTitleEdit() {
        state.toolbarTitleEditing = false;
        state.titleEditError = '';
        updateCurrentWritingTitle();
        if (currentWritingTitleEdit && !currentWritingTitleEdit.hidden) currentWritingTitleEdit.focus({ preventScroll: true });
    }

    function saveToolbarTitle() {
        var id = compositionId(state.current);
        var title = firstText(currentWritingTitleInput && currentWritingTitleInput.value);
        if (!id || !title) {
            if (currentWritingTitleInput) currentWritingTitleInput.setCustomValidity('Enter a writing title.');
            if (currentWritingTitleInput) currentWritingTitleInput.reportValidity();
            return;
        }
        if (currentWritingTitleInput) currentWritingTitleInput.setCustomValidity('');
        var submit = currentWritingTitleForm && currentWritingTitleForm.querySelector('button[type="submit"]');
        if (submit) submit.disabled = true;
        writingCall('updateCompositionTitle', { composition_id: id, title: title }).then(function(result) {
            var updated = result.composition || { title: title, title_source: 'student' };
            state.current = Object.assign({}, state.current, updated);
            state.title = editableCompositionTitle(state.current);
            state.compositions = state.compositions.map(function(item) {
                return compositionId(item) === id ? Object.assign({}, item, updated) : item;
            });
            state.toolbarTitleEditing = false;
            renderPortfolio();
            updateCurrentWritingTitle();
        }).catch(function(error) {
            state.titleEditError = firstText(error && error.message, 'The title could not be saved.');
            setStatus(state.titleEditError);
        }).finally(function() {
            if (submit) submit.disabled = false;
        });
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
        revisionProgress.classList.remove('is-home-quota', 'is-ocr-photo-control');
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

    function updateOcrPhotoToolbarToggle(visible) {
        var button = document.querySelector('[data-toggle-ocr-photo]');
        if (!button) return;
        button.textContent = visible ? 'Hide image' : 'Show image';
        button.setAttribute('aria-pressed', String(Boolean(visible)));
        button.setAttribute('aria-label', visible ? 'Hide uploaded image' : 'Show uploaded image');
    }

    function showOcrPhotoToolbarToggle() {
        if (!revisionProgress) return;
        revisionProgress.classList.remove('is-home-quota');
        revisionProgress.classList.add('is-ocr-photo-control');
        revisionProgress.hidden = false;
        revisionProgress.removeAttribute('title');
        revisionProgress.removeAttribute('aria-label');
        revisionProgress.innerHTML = '<button class="secondary-button compact ocr-toolbar-photo-toggle" type="button" data-toggle-ocr-photo aria-pressed="false" aria-label="Show uploaded image">Show image</button>';
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

    function manuscriptRevisionSummary(sentences) {
        var record = state.current && state.current.rewrite_results || {};
        var storedById = {};
        safeArray(record.results).forEach(function(item) {
            var storedId = firstText(item && item.sentence_id, item && item.id);
            if (storedId) storedById[storedId] = item;
        });
        var required = [];
        var replacements = {};
        safeArray(sentences).forEach(function(sentence, index) {
            if (!rewriteRequired(sentence)) return;
            var id = sentenceId(sentence, index);
            var result = state.rewriteResults[id] || storedById[id] || sentence && sentence.rewrite_result;
            var rewrite = firstText(result && result.student_rewrite, sentence && sentence.student_rewrite);
            required.push({ result: result, rewrite: rewrite });
            if (result && result.accepted === true && rewrite) replacements[id] = rewrite;
        });
        var completed = record.passed === true || compositionStatus(state.current) === 'completed';
        return {
            available: completed && required.length > 0 && required.every(function(item) {
                return item.result && item.result.accepted === true && Boolean(item.rewrite);
            }),
            replacements: replacements
        };
    }

    function manuscriptVersionControlHtml(revisedAvailable) {
        if (!revisedAvailable) {
            return '<div class="language-section-heading"><h2 class="language-card-title">Draft</h2></div>';
        }
        return '<div class="manuscript-version-control" role="group" aria-label="Writing version">' +
            ['draft', 'revised'].map(function(view) {
                var selected = state.manuscriptView === view;
                var label = view === 'draft' ? 'Draft' : 'Revised';
                return '<button type="button" data-manuscript-view="' + view + '" class="manuscript-version-button' + (selected ? ' is-selected' : '') + '" aria-pressed="' + selected + '">' + label + '</button>';
            }).join('') + '</div>';
    }

    function highlightedManuscriptHtml(manuscript, sentences, view, revisionSummary) {
        var source = String(manuscript || '');
        var cursor = 0;
        var html = '';
        var revised = view === 'revised' && revisionSummary && revisionSummary.available;
        sentences.forEach(function(sentence, index) {
            var original = String(sentence && sentence.original || '');
            if (!original) return;
            var matchAt = source.indexOf(original, cursor);
            if (matchAt < 0) return;
            var leadingWhitespace = (original.match(/^\s*/) || [''])[0];
            var withoutLeading = original.slice(leadingWhitespace.length);
            var trailingWhitespace = (withoutLeading.match(/\s*$/) || [''])[0];
            var visibleSentence = withoutLeading.slice(0, withoutLeading.length - trailingWhitespace.length);
            var id = sentenceId(sentence, index);
            var displaySentence = revised && revisionSummary.replacements[id] ? revisionSummary.replacements[id] : visibleSentence;
            var needsRevision = !revised && rewriteRequired(sentence);
            var completedDraftFeedback = !revised && revisionSummary && revisionSummary.available;
            var interactive = !revisionSummary || !revisionSummary.available || completedDraftFeedback;
            var interactionLabel = completedDraftFeedback
                ? (needsRevision ? '查看第 ' + (index + 1) + ' 句的 AI 反馈' : '第 ' + (index + 1) + ' 句无需修改')
                : '定位到第 ' + (index + 1) + ' 句的批改';
            html += escapeHtml(source.slice(cursor, matchAt) + leadingWhitespace);
            html += '<span class="manuscript-sentence-highlight ' + (revised ? 'is-revised' : 'is-draft') + (needsRevision ? ' needs-revision' : '') + (index === state.activeSentence ? ' is-active' : '') + '"' + (interactive ? ' role="button" tabindex="0" data-sentence-index="' + index + '" data-manuscript-sentence="' + index + '"' : '') + ' style="' + sentenceColorStyle(index) + '"' + (interactive && index === state.activeSentence ? ' aria-current="true"' : '') + (interactive ? ' aria-label="' + interactionLabel + '"' : '') + '>' + escapeHtml(displaySentence) + '</span>';
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

    function restoreRevisionTextLevel() {
        try {
            var stored = Number(window.localStorage.getItem(revisionTextLevelStorageKey));
            if (Number.isInteger(stored)) {
                state.revisionTextLevel = Math.max(0, Math.min(revisionTextScales.length - 1, stored));
            }
        } catch (error) {}
    }

    function restoreRevisionSkin() {
        try {
            state.revisionSkin = window.localStorage.getItem(revisionSkinStorageKey) === 'colorful' ? 'colorful' : 'green';
        } catch (error) {
            state.revisionSkin = 'green';
        }
    }

    function revisionTextScale() {
        return revisionTextScales[state.revisionTextLevel] || 1;
    }

    function revisionFontControlsHtml() {
        var atMinimum = state.revisionTextLevel <= 0;
        var atMaximum = state.revisionTextLevel >= revisionTextScales.length - 1;
        return '<div class="revision-font-controls" role="group" aria-label="Analysis text size">' +
            '<button type="button" data-revision-font-step="-1" aria-label="Decrease analysis text size" title="Decrease analysis text size"' + (atMinimum ? ' disabled' : '') + '>−</button>' +
            '<button type="button" data-revision-font-step="1" aria-label="Increase analysis text size" title="Increase analysis text size"' + (atMaximum ? ' disabled' : '') + '>+</button></div>';
    }

    function revisionSkinControlHtml() {
        var colorful = state.revisionSkin === 'colorful';
        var label = colorful ? 'Use green revision theme' : 'Use colorful revision theme';
        return '<button class="revision-skin-toggle is-' + state.revisionSkin + '" type="button" data-revision-skin aria-pressed="' + colorful + '" aria-label="' + label + '" title="' + label + '">' +
            '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14.5 4.5 5 5L10 19H5v-5l9.5-9.5Z"></path><path d="m12.5 6.5 5 5"></path></svg></button>';
    }

    function applyRevisionSkin() {
        var colorful = state.revisionSkin === 'colorful';
        var reviewCard = document.querySelector('.language-sentence-review-card');
        if (reviewCard) {
            reviewCard.classList.toggle('revision-skin-green', !colorful);
            reviewCard.classList.toggle('revision-skin-colorful', colorful);
        }
        var button = document.querySelector('[data-revision-skin]');
        if (!button) return;
        var label = colorful ? 'Use green revision theme' : 'Use colorful revision theme';
        button.classList.toggle('is-green', !colorful);
        button.classList.toggle('is-colorful', colorful);
        button.setAttribute('aria-pressed', String(colorful));
        button.setAttribute('aria-label', label);
        button.setAttribute('title', label);
    }

    function toggleRevisionSkin() {
        state.revisionSkin = state.revisionSkin === 'green' ? 'colorful' : 'green';
        try { window.localStorage.setItem(revisionSkinStorageKey, state.revisionSkin); } catch (error) {}
        applyRevisionSkin();
    }

    function applyRevisionTextScale() {
        var reviewCard = document.querySelector('.language-sentence-review-card');
        if (reviewCard) reviewCard.style.setProperty('--revision-analysis-scale', revisionTextScale());
        Array.prototype.forEach.call(document.querySelectorAll('[data-revision-font-step]'), function(button) {
            var direction = Number(button.getAttribute('data-revision-font-step'));
            button.disabled = direction < 0 ? state.revisionTextLevel <= 0 : state.revisionTextLevel >= revisionTextScales.length - 1;
        });
        window.requestAnimationFrame(function() {
            observeSentenceCardHeights();
            Array.prototype.forEach.call(document.querySelectorAll('.sentence-card-inner.has-measured-height'), syncSentenceCardHeight);
        });
    }

    function adjustRevisionTextLevel(step) {
        var next = Math.max(0, Math.min(revisionTextScales.length - 1, state.revisionTextLevel + Number(step || 0)));
        if (next === state.revisionTextLevel) return;
        state.revisionTextLevel = next;
        try { window.localStorage.setItem(revisionTextLevelStorageKey, String(next)); } catch (error) {}
        applyRevisionTextScale();
    }

    function setBusy(busy) {
        state.busy = Boolean(busy);
        app.setAttribute('aria-busy', busy ? 'true' : 'false');
        Array.prototype.forEach.call(document.querySelectorAll('[data-disable-when-busy]'), function(button) {
            button.disabled = Boolean(busy);
        });
    }

    function clearWaitingPollSchedule() {
        if (state.waitingPollTimer != null) window.clearTimeout(state.waitingPollTimer);
        state.waitingPollTimer = null;
        state.waitingPollNow = null;
        state.waitingPollWakePending = false;
        state.waitingPollKind = '';
    }

    function waitingPollDelay(hadError) {
        if (hadError) return [3 * 1000, 6 * 1000, 12 * 1000, 20 * 1000][Math.min(3, Math.max(0, state.waitingPollFailures - 1))];
        return document.hidden ? 10000 : 3000;
    }

    function scheduleWaitingPoll(run, hadError) {
        if (typeof run !== 'function') return;
        state.waitingPollNow = run;
        if (state.waitingPollInFlight) {
            state.waitingPollWakePending = true;
            return;
        }
        if (state.waitingPollTimer != null) window.clearTimeout(state.waitingPollTimer);
        state.waitingPollTimer = window.setTimeout(function() {
            state.waitingPollTimer = null;
            if (typeof state.waitingPollNow === 'function') state.waitingPollNow();
        }, waitingPollDelay(Boolean(hadError)));
    }

    function wakeWaitingPoll() {
        if (state.waitingPollInFlight) {
            state.waitingPollWakePending = true;
            return;
        }
        if (state.waitingPollTimer != null) window.clearTimeout(state.waitingPollTimer);
        state.waitingPollTimer = null;
        if (typeof state.waitingPollNow === 'function') state.waitingPollNow();
    }

    function waitingPollComplete(run, hadError) {
        state.waitingPollInFlight = false;
        if (state.waitingPollWakePending) {
            state.waitingPollWakePending = false;
            scheduleWaitingPoll(run, false);
        } else {
            scheduleWaitingPoll(run, hadError);
        }
    }

    function stopOcrPolling() {
        state.ocrPollActive = false;
        state.ocrPollGeneration += 1;
        clearWaitingPollSchedule();
    }

    function stopReviewPolling() {
        state.reviewPollActive = false;
        state.reviewPollGeneration += 1;
        clearWaitingPollSchedule();
    }

    function stopRewritePolling() {
        state.rewritePollActive = false;
        state.rewritePollGeneration += 1;
        clearWaitingPollSchedule();
    }

    function stopRevisionScanPolling() {
        state.revisionScanPollActive = false;
        state.revisionScanPollGeneration += 1;
        clearWaitingPollSchedule();
    }

    function waitingTaskState(jobStatus, durable) {
        var status = firstText(jobStatus).toLowerCase();
        if (!durable || status === 'photo_uploading' || status === 'uploading') return 'uploading';
        if (status === 'succeeded' || status === 'ready' || status === 'completed') return 'ready';
        if (status === 'failed') return 'failed';
        if (status === 'processing' || /_processing$/.test(status) || status === 'evaluating') return 'analysing';
        return 'queued';
    }

    function waitingStageDefinitions() {
        return ['Uploaded', 'Finished'];
    }

    function waitingStageClass(stageIndex, taskState) {
        if (taskState === 'ready') return 'is-complete';
        if (taskState === 'failed') return stageIndex === 0 ? 'is-interrupted-complete' : 'is-interrupted';
        if (taskState === 'uploading') return stageIndex === 0 ? 'is-active' : 'is-upcoming';
        return stageIndex === 0 ? 'is-complete' : 'is-upcoming';
    }

    function waitingStageLabel(kind, stageIndex, taskState) {
        return waitingStageDefinitions(kind)[stageIndex];
    }

    function waitingConnectorLabel(taskState) {
        return taskState === 'failed' ? 'Interrupted' : '';
    }

    function waitingProgressAriaLabel(taskState) {
        if (taskState === 'failed') return 'Writing task progress: Uploaded, interrupted before Finished.';
        if (taskState === 'ready') return 'Writing task progress: Uploaded and Finished.';
        if (taskState === 'uploading') return 'Writing task progress: Uploading; Finished is pending.';
        return 'Writing task progress: Uploaded; processing toward Finished.';
    }

    function waitingStageMarkup(kind, taskState) {
        return waitingStageDefinitions(kind).map(function(label, stageIndex) {
            var stageClass = waitingStageClass(stageIndex, taskState);
            var current = stageClass === 'is-active' ? ' aria-current="step"' : '';
            var processLabel = waitingConnectorLabel(taskState);
            var connector = stageIndex === 0
                ? '<span class="ai-waiting-connector ' + (taskState === 'ready' ? 'is-complete' : taskState === 'failed' ? 'is-interrupted' : 'is-transmitting') + '" aria-hidden="true"><span class="ai-waiting-connector-track"></span><span class="ai-waiting-connector-label"' + (processLabel ? '' : ' hidden') + '>' + escapeHtml(processLabel) + '</span></span>'
                : '';
            var check = '<svg class="ai-waiting-stage-check" viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.2 8.2 14l7.4-8"></path></svg>';
            return '<li class="ai-waiting-stage ' + stageClass + '" data-waiting-stage-index="' + stageIndex + '"' + current + '><span class="ai-waiting-stage-node" aria-hidden="true">' + check + '</span><span class="ai-waiting-stage-label">' + escapeHtml(waitingStageLabel(kind, stageIndex, taskState)) + '</span>' + connector + '</li>';
        }).join('');
    }

    function updateWaitingStageDom(kind, taskState) {
        if (!stage) return;
        var progress = stage.querySelector('.ai-waiting-progress');
        if (progress) progress.setAttribute('aria-label', waitingProgressAriaLabel(taskState));
        var stages = stage.querySelectorAll('[data-waiting-stage-index]');
        Array.prototype.forEach.call(stages, function(item) {
            var index = Number(item.getAttribute('data-waiting-stage-index'));
            var statusClass = waitingStageClass(index, taskState);
            var nextClass = 'ai-waiting-stage ' + statusClass;
            item.className = nextClass;
            if (statusClass === 'is-active' || statusClass === 'is-interrupted') item.setAttribute('aria-current', 'step');
            else item.removeAttribute('aria-current');
            var label = item.querySelector('.ai-waiting-stage-label');
            if (label) label.textContent = waitingStageLabel(kind, index, taskState);
        });
        Array.prototype.forEach.call(stage.querySelectorAll('.ai-waiting-connector'), function(connector) {
            connector.className = 'ai-waiting-connector ' + (taskState === 'ready' ? 'is-complete' : taskState === 'failed' ? 'is-interrupted' : 'is-transmitting');
            var connectorLabel = connector.querySelector('.ai-waiting-connector-label');
            if (connectorLabel) {
                var processLabel = waitingConnectorLabel(taskState);
                connectorLabel.textContent = processLabel;
                connectorLabel.hidden = !processLabel;
            }
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
                jumpSurface: stage.parentElement || stage,
                onScore: function(score) {
                    var scoreNode = stage.querySelector('.runner-score');
                    if (scoreNode) scoreNode.textContent = 'Score ' + (Number(score.score || 0) < 0 ? '−' + Math.abs(Number(score.score || 0)) : Number(score.score || 0));
                },
                onEvent: function(event) {
                    if (event && (event.type === 'collect' || event.type === 'hit')) playWaitingGameSound(event.type);
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
        } catch (error) {
            state.waitingRunner = null;
        }
    }

    function renderAiWaitingExperience(config) {
        config = config || {};
        var previousScreen = state.screen;
        destroyAiWaitingExperience();
        var durable = config.durable !== false;
        var taskState = waitingTaskState(config.jobStatus, durable);
        state.waitingKind = firstText(config.kind);
        state.waitingTaskState = taskState;
        state.waitingIssueCode = '';
        state.waitingIssueMode = '';
        state.waitingFinishPending = false;
        state.waitingResultAction = null;
        state.waitingReadyAnnounced = taskState === 'ready';
        state.screen = firstText(config.screen, {
            ocr: 'ocr-waiting',
            review: 'review-waiting',
            rewrite: 'rewrite-waiting',
            revision_ocr: 'revision-scan-waiting'
        }[state.waitingKind] || state.waitingKind + '-waiting');
        var runnerMarkup = '<div class="runner-shell" aria-label="Mr. Cat Runner waiting activity"><div class="runner-canvas-frame"><p class="runner-score" aria-live="polite">Score 0</p><canvas class="runner-canvas" tabindex="0" role="img" aria-label="Interactive Mr. Cat Runner waiting game."></canvas></div></div>';
        var extraActions = firstText(config.extraActions);
        var readyAction = '<div class="ai-waiting-ready-action" hidden><button class="primary-button" type="button" data-view-waiting-result></button></div>';
        var interruptionNotice = '<div class="ai-waiting-interruption" role="alert" hidden><strong>Something interrupted this step.</strong><p data-waiting-interruption-copy></p></div>';
        var retryAction = '<div class="ai-waiting-retry-action" hidden><button class="primary-button" type="button" data-retry-waiting>Retry</button></div>';
        stage.innerHTML = '<section class="surface ai-waiting-experience" data-waiting-kind="' + escapeHtml(state.waitingKind) + '">' +
            '<ol class="ai-waiting-progress" aria-label="' + escapeHtml(waitingProgressAriaLabel(taskState)) + '" role="status" aria-live="polite">' + waitingStageMarkup(state.waitingKind, taskState) + '</ol>' +
            interruptionNotice +
            runnerMarkup +
            '<p class="sr-only" id="' + escapeHtml(firstText(config.pollStatusId, 'ai-waiting-status')) + '" role="status"></p>' +
            retryAction +
            readyAction + (extraActions ? '<div class="form-actions ai-waiting-actions">' + extraActions + '</div>' : '') + '</section>';
        mountWaitingRunner();
        updateWaitingStageDom(state.waitingKind, taskState);
        if (taskState === 'failed') showAiWaitingInterruption(state.waitingKind, config.failureMessage, config.failureCode, config.failureMode);
        if (previousScreen !== state.screen) scheduleStageViewportReset();
    }

    function clearAiWaitingInterruption() {
        state.waitingIssueCode = '';
        state.waitingIssueMode = '';
        var experience = stage && stage.querySelector('.ai-waiting-experience');
        if (!experience) return;
        experience.classList.remove('is-interrupted');
        var notice = experience.querySelector('.ai-waiting-interruption');
        var action = experience.querySelector('.ai-waiting-retry-action');
        if (notice) notice.hidden = true;
        if (action) action.hidden = true;
    }

    function showAiWaitingInterruption(kind, message, code, mode) {
        var active = state.waitingKind === kind && stage && stage.querySelector('.ai-waiting-experience[data-waiting-kind="' + kind + '"]');
        if (!active) {
            renderAiWaitingExperience({
                kind: kind,
                jobStatus: 'failed',
                durable: true,
                failureMessage: message,
                failureCode: code,
                failureMode: mode
            });
            return;
        }
        stopWaitingReadyReminder();
        state.waitingTaskState = 'failed';
        state.waitingIssueCode = firstText(code);
        state.waitingIssueMode = firstText(mode, 'job');
        state.waitingFinishPending = false;
        state.waitingResultAction = null;
        updateWaitingStageDom(kind, 'failed');
        if (state.waitingRunner && typeof state.waitingRunner.setTaskState === 'function') state.waitingRunner.setTaskState('failed');
        active.classList.remove('is-ready', 'is-ready-announced');
        active.classList.add('is-interrupted');
        var ready = active.querySelector('.ai-waiting-ready-action');
        var notice = active.querySelector('.ai-waiting-interruption');
        var copy = active.querySelector('[data-waiting-interruption-copy]');
        var action = active.querySelector('.ai-waiting-retry-action');
        if (ready) ready.hidden = true;
        if (copy) copy.textContent = firstText(message, 'Please retry now, or try again later.') + ' Retry now, or try again later.';
        if (notice) notice.hidden = false;
        if (action) action.hidden = false;
    }

    function resumeAiWaitingExperience(kind, jobStatus, pollStatusId) {
        var active = state.waitingKind === kind && stage && stage.querySelector('.ai-waiting-experience[data-waiting-kind="' + kind + '"]');
        if (!active) return false;
        clearAiWaitingInterruption();
        state.waitingTaskState = waitingTaskState(jobStatus, true);
        updateWaitingStageDom(kind, state.waitingTaskState);
        if (state.waitingRunner && typeof state.waitingRunner.setTaskState === 'function') state.waitingRunner.setTaskState(state.waitingTaskState);
        var statusNode = pollStatusId ? active.querySelector('#' + pollStatusId) : null;
        if (statusNode) statusNode.textContent = '';
        return true;
    }

    function updateAiWaitingExperience(config) {
        config = config || {};
        if (!state.waitingKind || (config.kind && config.kind !== state.waitingKind)) return;
        var durable = config.durable !== false;
        var nextState = waitingTaskState(config.jobStatus, durable);
        state.waitingTaskState = nextState;
        if (nextState !== 'failed') clearAiWaitingInterruption();
        updateWaitingStageDom(state.waitingKind, nextState);
        if (state.waitingRunner && typeof state.waitingRunner.setTaskState === 'function') state.waitingRunner.setTaskState(nextState === 'uploading' ? 'queued' : nextState);
        var pollStatusId = firstText(config.pollStatusId);
        var statusNode = stage && pollStatusId ? stage.querySelector('#' + pollStatusId) : null;
        if (statusNode && config.warningCopy) statusNode.textContent = config.warningCopy;
    }

    function finishAiWaitingExperience(next) {
        if (state.waitingFinishPending || state.waitingResultAction) return;
        var shouldAnnounce = !state.waitingReadyAnnounced;
        state.waitingFinishPending = true;
        state.waitingResultAction = typeof next === 'function' ? next : function() {};
        state.waitingTaskState = 'ready';
        updateWaitingStageDom(state.waitingKind, 'ready');
        if (state.waitingRunner && typeof state.waitingRunner.setTaskState === 'function') state.waitingRunner.setTaskState('ready');
        if (state.waitingRunner && typeof state.waitingRunner.pause === 'function') state.waitingRunner.pause();
        var actionLabels = {
            ocr: 'Check Text',
            review: 'View Review',
            rewrite: 'View Feedback',
            revision_ocr: 'Review Scan'
        };
        var action = stage && stage.querySelector('[data-view-waiting-result]');
        if (action) { action.textContent = actionLabels[state.waitingKind] || 'View Result'; action.parentElement.hidden = false; }
        var experience = stage && stage.querySelector('.ai-waiting-experience');
        if (experience) experience.classList.add('is-ready');
        var runnerCanvas = experience && experience.querySelector('.runner-canvas');
        if (runnerCanvas) {
            runnerCanvas.setAttribute('aria-disabled', 'true');
            runnerCanvas.setAttribute('aria-label', 'Mr. Cat Runner paused. Your result is ready.');
            runnerCanvas.setAttribute('tabindex', '-1');
        }
        if (experience && shouldAnnounce) experience.classList.add('is-ready-announced');
        if (shouldAnnounce) {
            state.waitingReadyAnnounced = true;
            startWaitingReadyReminder();
        }
    }

    function showReadyOrOpenResult(kind, next) {
        var activeWaitingCard = state.waitingKind === kind
            && stage && Boolean(stage.querySelector('.ai-waiting-experience[data-waiting-kind="' + kind + '"]'));
        if (activeWaitingCard) {
            finishAiWaitingExperience(next);
            return;
        }
        destroyAiWaitingExperience();
        if (typeof next === 'function') next();
    }

    function waitingAudioContext() {
        var AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) return null;
        if (!state.waitingAudioContext) state.waitingAudioContext = new AudioCtor();
        return state.waitingAudioContext;
    }

    function waitingAudioOutput(audio) {
        if (state.waitingAudioOutput) return state.waitingAudioOutput;
        var limiter = audio.createDynamicsCompressor();
        limiter.threshold.value = -7;
        limiter.knee.value = 8;
        limiter.ratio.value = 6;
        limiter.attack.value = 0.002;
        limiter.release.value = 0.16;
        limiter.connect(audio.destination);
        state.waitingAudioOutput = limiter;
        return limiter;
    }

    function scheduleWaitingTone(audio, options) {
        options = options || {};
        var delay = Number(options.delay || 0);
        var duration = Math.max(0.03, Number(options.duration || 0.1));
        var now = audio.currentTime + delay;
        var oscillator = audio.createOscillator();
        var gain = audio.createGain();
        oscillator.type = options.type || 'sine';
        oscillator.frequency.setValueAtTime(Number(options.frequency || 440), now);
        if (Number(options.endFrequency) > 0) {
            oscillator.frequency.exponentialRampToValueAtTime(Number(options.endFrequency), now + duration);
        }
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, Number(options.gain || 0.04)), now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        oscillator.connect(gain);
        gain.connect(waitingAudioOutput(audio));
        oscillator.start(now);
        oscillator.stop(now + duration + 0.03);
    }

    function playWaitingFinishedJingle(audio) {
        scheduleWaitingTone(audio, { frequency: 784, duration: 0.34, gain: 0.2, type: 'sine' });
        scheduleWaitingTone(audio, { frequency: 1568, duration: 0.25, gain: 0.055, type: 'triangle', delay: 0.01 });
        scheduleWaitingTone(audio, { frequency: 1175, duration: 0.88, gain: 0.295, type: 'sine', delay: 0.33 });
        scheduleWaitingTone(audio, { frequency: 2350, duration: 0.72, gain: 0.085, type: 'triangle', delay: 0.34 });
    }

    function playWaitingPointSound(audio) {
        scheduleWaitingTone(audio, { frequency: 1047, endFrequency: 920, duration: 0.15, gain: 0.07, type: 'triangle' });
    }

    function playWaitingHitSound(audio) {
        scheduleWaitingTone(audio, { frequency: 330, endFrequency: 150, duration: 0.2, gain: 0.062, type: 'sine' });
        scheduleWaitingTone(audio, { frequency: 165, duration: 0.13, gain: 0.025, type: 'triangle', delay: 0.08 });
    }

    function unlockWaitingReadySound() {
        try {
            var audio = waitingAudioContext();
            if (audio && audio.state === 'suspended' && typeof audio.resume === 'function') {
                var resume = audio.resume();
                if (resume && typeof resume.catch === 'function') resume.catch(function() {});
            }
        } catch (error) {}
    }

    function playWaitingReadySound() {
        try {
            if (document.hidden) return;
            var audio = waitingAudioContext();
            if (!audio) return;
            function scheduleChime() {
                if (document.hidden || audio.state === 'suspended') return;
                playWaitingFinishedJingle(audio);
            }
            if (audio.state === 'suspended' && typeof audio.resume === 'function') {
                var resumed = audio.resume();
                if (resumed && typeof resumed.then === 'function') resumed.then(scheduleChime).catch(function() {});
                return;
            }
            scheduleChime();
        } catch (error) {}
    }

    function stopWaitingReadyReminder() {
        if (state.waitingReadySoundTimer != null) window.clearInterval(state.waitingReadySoundTimer);
        state.waitingReadySoundTimer = null;
    }

    function startWaitingReadyReminder() {
        stopWaitingReadyReminder();
        playWaitingReadySound();
        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (reduceMotion) return;
        state.waitingReadySoundTimer = window.setInterval(function() {
            if (state.waitingTaskState === 'ready') playWaitingReadySound();
            else stopWaitingReadyReminder();
        }, 5200);
    }

    function playWaitingGameSound(kind) {
        try {
            if (document.hidden) return;
            var audio = waitingAudioContext();
            if (!audio || audio.state === 'suspended') return;
            if (kind === 'collect') playWaitingPointSound(audio);
            else if (kind === 'hit') playWaitingHitSound(audio);
        } catch (error) {}
    }

    function destroyAiWaitingExperience() {
        stopWaitingReadyReminder();
        if (state.waitingRunner && typeof state.waitingRunner.destroy === 'function') {
            try { state.waitingRunner.destroy(); } catch (error) {}
        }
        state.waitingRunner = null;
        state.waitingKind = '';
        state.waitingTaskState = '';
        state.waitingIssueCode = '';
        state.waitingIssueMode = '';
        state.waitingFinishPending = false;
        state.waitingResultAction = null;
        state.waitingReadyAnnounced = false;
    }

    function startWaitingPolling(config) {
        if (!config || typeof config.isActive !== 'function') return;
        var generationKey = config.generationKey;
        state[generationKey] += 1;
        var generation = state[generationKey];
        var capturedCompositionId = compositionId(state.current);
        var capturedOperationId = firstText(config.operationId && config.operationId());
        state.waitingPollKind = config.kind;
        state.waitingPollFailures = 0;
        state.waitingPollNow = null;

        function active() {
            return config.isActive() && state[generationKey] === generation
                && compositionId(state.current) === capturedCompositionId
                && state.waitingKind === config.kind;
        }

        function poll() {
            if (!active()) return;
            state.waitingPollNow = poll;
            if (state.waitingPollInFlight) {
                state.waitingPollWakePending = true;
                return;
            }
            state.waitingPollInFlight = true;
            var hadError = false;
            writingCall('getComposition', { composition_id: capturedCompositionId }).then(function(result) {
                if (!active()) return;
                var returnedOperationId = firstText(config.returnedOperationId && config.returnedOperationId(result));
                if (capturedOperationId && returnedOperationId && capturedOperationId !== returnedOperationId) return;
                state.waitingPollFailures = 0;
                config.onSuccess(result);
            }).catch(function(error) {
                if (!active()) return;
                hadError = true;
                state.waitingPollFailures = Math.min(4, state.waitingPollFailures + 1);
                if (typeof config.onError === 'function') config.onError(error);
            }).then(function() {
                state.waitingPollInFlight = false;
                if (state.waitingPollWakePending && typeof state.waitingPollNow === 'function') {
                    state.waitingPollWakePending = false;
                    window.setTimeout(state.waitingPollNow, 0);
                    return;
                }
                if (!active()) return;
                scheduleWaitingPoll(poll, hadError);
            });
        }
        poll();
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
                activePhotoIndex: 0,
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

    function compositionSortTime(item, completed) {
        item = item || {};
        var value = completed
            ? (item.completed_at || item.updated_at || item.created_at)
            : (item.updated_at || item.created_at);
        if (value && typeof value === 'object') value = value.$date || value.date || value.value || '';
        if (typeof value === 'number') return value < 100000000000 ? value * 1000 : value;
        var parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function portfolioGroupHtml(label, items) {
        if (!items.length) return '';
        return '<section class="portfolio-group" aria-label="' + escapeHtml(label) + '">' +
            '<p class="portfolio-group-label">' + escapeHtml(label) + '</p>' +
            items.map(function(item) {
                var id = compositionId(item);
                var active = state.current && compositionId(state.current) === id;
                return '<article class="portfolio-item' + (active ? ' is-active' : '') + '">' +
                    '<button class="portfolio-open" type="button" data-open-composition="' + escapeHtml(id) + '"' +
                    ' aria-label="Open ' + escapeHtml(compositionTitle(item)) + '"><strong>' +
                    escapeHtml(compositionTitle(item)) + '</strong></button></article>';
            }).join('') + '</section>';
    }

    function renderPortfolio() {
        var portfolioItems = portfolioCompositions();
        var unfinished = portfolioItems.filter(function(item) {
            return compositionStatus(item) !== 'completed';
        }).sort(function(a, b) { return compositionSortTime(b, false) - compositionSortTime(a, false); });
        var completed = portfolioItems.filter(function(item) {
            return compositionStatus(item) === 'completed';
        }).sort(function(a, b) { return compositionSortTime(b, true) - compositionSortTime(a, true); });
        if (!portfolioItems.length) {
            portfolioList.innerHTML = '<div class="empty-sidebar">Your writing will appear here.</div>';
            return;
        }
        portfolioList.innerHTML = portfolioGroupHtml('Continue', unfinished) + portfolioGroupHtml('Completed', completed);
    }

    function renderWritingProfile() {
        var patterns = safeArray(state.writingProfile).slice(0, 3);
        if (!writingProfileSummary) return;
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
        showWelcomeToolbar();
        stage.innerHTML = '<section class="writing-home" aria-label="Writing home"><div class="writing-home-flow">' +
            '<section class="writing-home-section writing-home-start" aria-label="Start new writing">' +
            '<div class="writing-mode-grid"><button class="writing-mode-card polishing' + (state.homeComposerOpen && state.assessmentMode === 'language' ? ' is-selected' : '') + '" type="button" data-start-mode="language" aria-pressed="' + (state.homeComposerOpen && state.assessmentMode === 'language') + '" aria-expanded="' + (state.homeComposerOpen && state.assessmentMode === 'language') + '"><span><strong>Polishing</strong><small>Improve grammar and expression</small></span></button>' +
            '<button class="writing-mode-card brainstorming' + (state.homeComposerOpen && state.assessmentMode === 'standardized' ? ' is-selected' : '') + '" type="button" data-start-mode="standardized" aria-pressed="' + (state.homeComposerOpen && state.assessmentMode === 'standardized') + '" aria-expanded="' + (state.homeComposerOpen && state.assessmentMode === 'standardized') + '"><span><strong>Brainstorming</strong><small>Develop ideas and structure</small></span></button></div>' +
            (state.homeComposerOpen ? homeComposerHtml() : '') + '</section></div></section>';
        scheduleSourceTextareaResize();
        scheduleStageViewportReset();
    }

    function compactQuota(value) {
        var number = Math.max(0, Number(value || 0));
        if (number >= 1000) return (number / 1000).toFixed(number >= 10000 ? 0 : 1).replace(/\.0$/, '') + 'k';
        return String(Math.round(number));
    }

    function showWelcomeToolbar() {
        state.toolbarTitleEditing = false;
        updateCurrentWritingTitle();
        if (revisionProgress) {
            revisionProgress.hidden = true;
            revisionProgress.innerHTML = '';
            revisionProgress.classList.remove('is-home-quota');
            revisionProgress.removeAttribute('aria-label');
            revisionProgress.removeAttribute('title');
        }
        document.title = 'Writing | Mr. Cat Academy';
    }

    function homeWorkflowProgress(composition) {
        var status = compositionStatus(composition);
        if (status === 'completed') return 100;
        var progressByStatus = {
            draft: 12, photo_uploading: 18, ocr_queued: 24, ocr_processing: 32, ocr_failed: 32,
            ocr_ready: 42, ocr_review: 42, ready: 50, queued: 54, evaluating: 60,
            review_queued: 54, review_processing: 60, review_failed: 60, standardized_ready: 72,
            language_ready: 74, review_ready: 74, reviewed: 78, sentence_training: 82,
            needs_revision: 88, rewrite_queued: 90, rewrite_processing: 94, rewrite_failed: 90,
            failed: 60
        };
        return progressByStatus[status] || 12;
    }

    function welcomeUnfinishedHtml(items) {
        return welcomeCompositionStrip(items, 'Continue', 'Unfinished writing');
    }

    function welcomeCompletedHtml(items) {
        return welcomeCompositionStrip(items, 'Review', 'Completed writing');
    }

    function welcomeCompositionStrip(items, label, ariaLabel) {
        if (!items.length) return '';
        var cards = items.map(function(item) {
            var mode = compositionMode(item);
            var progress = homeWorkflowProgress(item);
            return '<button class="writing-pending-pill" type="button" data-open-composition="' + escapeHtml(compositionId(item)) + '" aria-label="Open ' + escapeHtml(compositionTitle(item)) + ', ' + escapeHtml(statusLabel(compositionStatus(item))) + '"><span class="writing-pending-copy"><span class="writing-pending-meta"><span class="mini-badge ' + (mode === 'standardized' ? 'standardized' : '') + '">' + escapeHtml(mode === 'standardized' ? 'Brainstorming' : 'Polishing') + '</span><small>' + escapeHtml(statusLabel(compositionStatus(item))) + '</small></span><strong>' + escapeHtml(compositionTitle(item)) + '</strong></span><span class="writing-pending-progress" aria-hidden="true"><span style="width:' + progress + '%"></span></span><span class="writing-pending-arrow">' + icon('arrow') + '</span></button>';
        }).join('');
        return '<section class="writing-home-list-section"><p class="writing-home-list-label">' + escapeHtml(label) + '</p><div class="writing-pending-strip" aria-label="' + escapeHtml(ariaLabel) + '">' + cards + '</div></section>';
    }

    function homeComposerHtml() {
        var standardized = state.assessmentMode === 'standardized';
        return '<div class="writing-home-composer" aria-busy="' + state.homeComposerPreparing + '">' +
            (state.homeComposerError ? '<p class="writing-home-composer-error" role="alert">' + escapeHtml(state.homeComposerError) + '</p>' : '') +
            '<form class="form-stack source-entry-form" id="writing-source-form">' +
            sourceFieldsHtml(standardized, true) +
            '<section class="section-block" id="source-input-area">' + (state.inputMethod === 'photo' ? photoSourceHtml(state.photoUrls.length > 0) : textSourceHtml()) + '</section>' +
            '<div class="form-actions source-form-actions"><button class="source-discard-button" type="button" data-discard-source>Discard</button><button class="primary-button source-submit-button" type="submit" data-disable-when-busy>' + (state.inputMethod === 'photo' ? 'Scan' : 'Submit') + '</button></div>' +
            '</form></div>';
    }

    function clearRetiredPendingComposerStorage() {
        try {
            for (var index = window.sessionStorage.length - 1; index >= 0; index -= 1) {
                var key = window.sessionStorage.key(index);
                if (key && key.indexOf('mrcat-writing-composer-v1:') === 0) window.sessionStorage.removeItem(key);
            }
        } catch (error) {}
    }

    function resetDraft(composition) {
        closeSentenceFeedback(false);
        destroyAiWaitingExperience();
        stopOcrPolling();
        stopReviewPolling();
        stopRewritePolling();
        stopRevisionScanPolling();
        state.photoUrls.forEach(function(url) { if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url); });
        state.current = composition || null;
        state.homeComposerOpen = false;
        state.homeComposerPreparing = false;
        state.homeComposerError = '';
        state.toolbarTitleEditing = false;
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
        state.activeSourcePhotoIndex = 0;
        state.ocr = null;
        state.ocrReviewText = '';
        state.ocrTitleUndo = null;
        state.scanTarget = 'writing';
        state.activeSentence = 0;
        state.manuscriptView = 'draft';
        state.rewrites = {};
        state.rewriteResults = {};
        state.skipped = {};
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

    function returnToTutorHome(options) {
        destroyAiWaitingExperience();
        stopOcrPolling();
        stopReviewPolling();
        stopRewritePolling();
        stopRevisionScanPolling();
        resetRevisionScanState();
        if (!options || options.skipEmptyDiscard !== true) discardCurrentEmptyComposition();
        setStatus('');
        state.photoUrls.forEach(function(url) { if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url); });
        state.current = null;
        state.review = null;
        state.title = '';
        state.promptText = '';
        state.confirmedText = '';
        state.ocrTitleUndo = null;
        state.rubricId = '';
        state.inputMethod = 'text';
        state.photoFiles = [];
        state.photoUrls = [];
        state.photoIds = [];
        state.activeSourcePhotoIndex = 0;
        state.homeComposerOpen = false;
        state.homeComposerPreparing = false;
        state.homeComposerError = '';
        syncCompositionLocator('');
        updateCurrentWritingTitle();
        renderPortfolio();
        renderWelcome();
    }

    function discardDraftAndReturn() {
        var id = compositionId(state.current);
        window.clearTimeout(state.autosaveTimer);
        state.autosaveTimer = null;
        if (!id) {
            state.photoUrls.forEach(function(url) { if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url); });
            state.title = '';
            state.promptText = '';
            state.confirmedText = '';
            state.rubricId = '';
            state.photoFiles = [];
            state.photoUrls = [];
            state.photoIds = [];
            state.activeSourcePhotoIndex = 0;
            returnToTutorHome({ skipEmptyDiscard: true });
            return;
        }
        setStatus('');
        setBusy(true);
        var draftSnapshot = Object.assign({}, state.current || {}, {
            title: state.title,
            prompt_text: state.promptText,
            confirmed_text: state.confirmedText
        });
        var discardAction = isEmptyCompositionDraft(draftSnapshot) && !state.photoFiles.length && !state.photoIds.length
            ? 'discardEmptyComposition'
            : 'discardDraftComposition';
        writingCall(discardAction, { composition_id: id }).then(function(result) {
            if (!result.discarded) throw new Error('This writing has already entered processing and can no longer be discarded.');
            state.compositions = state.compositions.filter(function(item) { return compositionId(item) !== id; });
            state.photoUrls.forEach(function(url) { if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url); });
            state.photoFiles = [];
            state.photoUrls = [];
            state.photoIds = [];
            state.activeSourcePhotoIndex = 0;
            returnToTutorHome({ skipEmptyDiscard: true });
        }).catch(function(error) {
            setStatus(firstText(error && error.message, 'This draft could not be discarded. Please try again.'));
        }).finally(function() { setBusy(false); });
    }

    function focusHomeComposer() {
        window.requestAnimationFrame(function() {
            var target = document.getElementById('writing-rubric') || document.getElementById('writing-text');
            if (target) target.focus({ preventScroll: true });
        });
    }

    function startInlineWriting(mode) {
        if (state.busy) return;
        var selectedMode = mode === 'standardized' ? 'standardized' : 'language';
        if (state.homeComposerOpen && state.assessmentMode === selectedMode) {
            state.homeComposerOpen = false;
            renderWelcome();
            window.requestAnimationFrame(function() {
                var trigger = document.querySelector('[data-start-mode="' + selectedMode + '"]');
                if (trigger) trigger.focus({ preventScroll: true });
            });
            return;
        }
        state.assessmentMode = selectedMode;
        state.inputMethod = 'text';
        state.homeComposerOpen = true;
        state.homeComposerPreparing = false;
        state.homeComposerError = '';
        renderWelcome();
        focusHomeComposer();
    }

    function createNewWriting(mode) {
        if (state.busy) return;
        var selectedMode = mode === 'standardized' ? 'standardized' : 'language';
        stopOcrPolling();
        stopReviewPolling();
        setStatus('');
        returnToTutorHome({ skipEmptyDiscard: false });
        startInlineWriting(selectedMode);
    }

    function renderReplacementSource() {
        destroyAiWaitingExperience();
        state.screen = 'source';
        var standardized = state.assessmentMode === 'standardized';
        var hasPhoto = state.photoUrls.length > 0;
        stage.innerHTML = '<section class="surface surface-pad source-entry-surface">' +
            '<form class="form-stack source-entry-form" id="writing-source-form">' +
            sourceFieldsHtml(standardized, state.inputMethod !== 'photo' && isInitialSourceDraft()) +
            '<section class="section-block" id="source-input-area">' + (state.inputMethod === 'photo' ? photoSourceHtml(hasPhoto) : textSourceHtml()) + '</section>' +
            '<div class="form-actions source-form-actions"><button class="source-discard-button" type="button" data-discard-source>Discard</button><button class="primary-button source-submit-button" type="submit" data-disable-when-busy>' + (state.inputMethod === 'photo' ? 'Scan' : 'Submit') + '</button></div>' +
            '</form></section>';
        scheduleSourceTextareaResize();
        scheduleStageViewportReset();
    }

    function renderSourceEntry() {
        if (!state.review && (!compositionId(state.current) || isInitialSourceDraft())) {
            state.homeComposerOpen = true;
            renderWelcome();
            return;
        }
        renderReplacementSource();
    }

    function cameraOnlyButton(target, label) {
        return '<button class="inline-writing-scan" type="button" data-open-photo-choice="writing" data-photo-target="' + escapeHtml(target) + '" data-disable-when-busy aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '">' + icon('camera') + '</button>';
    }

    function resizeSourceTextarea(textarea) {
        if (!textarea || !textarea.matches('.source-auto-grow')) return;
        textarea.style.height = 'auto';
        textarea.style.height = textarea.scrollHeight + 'px';
    }

    function scheduleSourceTextareaResize() {
        window.requestAnimationFrame(function() {
            document.querySelectorAll('.source-auto-grow').forEach(resizeSourceTextarea);
        });
    }

    function sourceFieldsHtml(standardized, allowPromptScan) {
        var rubric = standardized
            ? '<div class="field source-control-only"><select id="writing-rubric" aria-label="Rubric"><option value="">Choose a Rubric</option>' + rubricOptions(state.rubricId) + '</select></div>'
            : '';
        var prompt = standardized
            ? '<div class="field inline-writing-field prompt-writing-field">' + (allowPromptScan ? cameraOnlyButton('prompt', 'Scan writing prompt') : '') + '<textarea class="source-auto-grow source-prompt-input" id="writing-prompt" rows="1" maxlength="6000" aria-label="Writing Prompt" placeholder="Type or paste the full writing prompt…">' + escapeHtml(state.promptText) + '</textarea></div><div class="source-fixed-divider" aria-hidden="true"></div>'
            : '';
        return standardized ? '<section class="section-block source-fields">' + rubric + prompt + '</section>' : '';
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
        return '<div class="field inline-writing-field">' + cameraOnlyButton('writing', 'Scan your writing') + '<textarea class="manuscript source-auto-grow" id="writing-text" rows="3" maxlength="30000" aria-label="Your Writing" placeholder="Type or paste your writing here…">' + escapeHtml(state.confirmedText) + '</textarea></div>';
    }

    function boundedPhotoIndex(value, count) {
        return Math.max(0, Math.min(Number(value) || 0, Math.max(0, count - 1)));
    }

    function stagedPhotoCardHtml(options) {
        var kind = options.kind === 'revision' ? 'revision' : 'source';
        var index = boundedPhotoIndex(options.index, options.count);
        var count = Math.max(1, Number(options.count) || 1);
        var previousDisabled = index <= 0 ? ' disabled' : '';
        var nextDisabled = index >= count - 1 ? ' disabled' : '';
        var counter = kind === 'source' ? 'Page ' + (index + 1) + '/' + count : (index + 1) + '/' + count;
        var alt = kind === 'source'
            ? 'Writing photo page ' + (index + 1) + ' of ' + count
            : 'Selected revision photo ' + (index + 1) + ' of ' + count;
        return '<figure class="photo-preview-card staged-photo-card ' + (kind === 'revision' ? 'revision-photo-card' : 'source-photo-preview-card') + '" data-staged-photo-kind="' + kind + '">' +
            '<span data-staged-photo-counter role="status" aria-live="polite">' + counter + '</span>' +
            '<div class="staged-photo-frame"><button class="staged-photo-open" type="button" data-open-photo-viewer="' + kind + '" data-photo-index="' + index + '" aria-label="Enlarge ' + alt + '">' +
            '<img data-staged-photo-image src="' + escapeHtml(options.url) + '" alt="' + escapeHtml(alt) + '"></button>' +
            '<button class="staged-photo-remove" type="button" data-request-photo-remove="' + kind + '" data-photo-index="' + index + '" aria-label="Remove photo ' + (index + 1) + '">' +
            '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"></path></svg></button>' +
            (count > 1 ? '<button class="staged-photo-arrow is-previous" type="button" data-staged-photo-step="-1" data-photo-kind="' + kind + '" aria-label="Previous photo"' + previousDisabled + '><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m15 5-7 7 7 7"></path></svg></button>' +
            '<button class="staged-photo-arrow is-next" type="button" data-staged-photo-step="1" data-photo-kind="' + kind + '" aria-label="Next photo"' + nextDisabled + '><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m9 5 7 7-7 7"></path></svg></button>' : '') + '</div>' +
            '<div class="staged-photo-actions">' + options.addButton + '</div></figure>';
    }

    function photoSourceHtml(hasPhoto) {
        if (hasPhoto) {
            state.activeSourcePhotoIndex = boundedPhotoIndex(state.activeSourcePhotoIndex, state.photoUrls.length);
            return '<div class="photo-preview-single">' + stagedPhotoCardHtml({
                kind: 'source',
                url: state.photoUrls[state.activeSourcePhotoIndex],
                index: state.activeSourcePhotoIndex,
                count: state.photoUrls.length,
                addButton: '<button class="secondary-button compact add-photo-button" type="button" data-open-photo-choice="writing" data-photo-target="' + escapeHtml(state.scanTarget) + '"' + (state.photoUrls.length >= 8 ? ' disabled' : '') + '>' + icon('camera') + 'Add Photo</button>'
            }) + '</div>' + writingPhotoInputs();
        }
        return '<div class="photo-source-empty"><button class="photo-drop" type="button" data-open-photo-choice="writing" data-photo-target="' + escapeHtml(state.scanTarget) + '"><span><span class="photo-drop-icon">' + icon('camera') + '</span><strong>Add a Photo</strong><small>Take a new photo or choose one from your library.</small></span></button></div>' + writingPhotoInputs();
    }

    function writingPhotoInputs() {
        return '<input type="file" data-writing-photo-input data-writing-photo-camera accept="image/jpeg,image/png,image/webp" capture="environment" hidden>' +
            '<input type="file" data-writing-photo-input data-writing-photo-library accept="image/jpeg,image/png,image/webp" multiple hidden>';
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

    function isInitialSourceDraft() {
        var composition = state.current || {};
        return compositionStatus(composition) === 'draft'
            && Number(composition.revision || 1) === 1
            && !composition.library_prompt_id
            && !composition.pending_upload
            && !composition.pending_ocr
            && !composition.active_job_id
            && !composition.active_job
            && !composition.ocr_job
            && !composition.standardized_review
            && !composition.language_review
            && !composition.rewrite_results
            && !composition.completed_at;
    }

    function persistSourceDraft() {
        return writingCall(isInitialSourceDraft() ? 'saveSourceDraft' : 'saveDraft', sourcePayload());
    }

    function scheduleAutosave() {
        window.clearTimeout(state.autosaveTimer);
        if (!compositionId(state.current)) return;
        if (state.busy) return;
        state.autosaveTimer = window.setTimeout(function() {
            persistSourceDraft().then(function(result) {
                if (result.composition) state.current = result.composition;
                syncCurrentSummary();
            }).catch(function() {});
        }, 900);
    }

    function validateSource() {
        if (state.inputMethod === 'photo' && state.scanTarget === 'prompt') {
            return state.photoFiles.length ? '' : 'Please take or choose at least one prompt photo.';
        }
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
        ensureCompositionForSubmit().then(function() {
            if (state.inputMethod === 'photo') {
                return persistSourceDraft().then(function(result) {
                    if (result.composition) state.current = result.composition;
                    return uploadAndExtract();
                });
            }
            return saveAndEvaluate();
        }).catch(function(error) {
            state.homeComposerError = firstText(error && error.message, 'This writing could not be submitted. Please try again.');
            if (!compositionId(state.current)) {
                setBusy(false);
                renderWelcome();
            } else {
                renderFatalAction(error);
            }
        }).finally(function() { setBusy(false); });
    }

    function ensureCompositionForSubmit() {
        if (compositionId(state.current)) return Promise.resolve(state.current);
        return writingCall('createComposition', {
            title: state.title,
            prompt_text: state.promptText,
            confirmed_text: state.inputMethod === 'text' ? state.confirmedText : '',
            assessment_mode: apiMode(state.assessmentMode),
            source: 'student'
        }).then(function(result) {
            var composition = result.composition || result.item || {};
            if (safeArray(result.rubrics).length) state.rubrics = result.rubrics;
            if (!compositionId(composition) && result.composition_id) composition.composition_id = result.composition_id;
            if (!compositionId(composition)) throw new Error('The new writing did not receive a valid ID.');
            state.current = composition;
            state.current.assessment_mode = apiMode(state.assessmentMode);
            syncCompositionLocator(compositionId(state.current));
            syncCurrentSummary();
            updateCurrentWritingTitle();
            return state.current;
        });
    }

    function uploadAndExtract() {
        var ocrOperation = logicalOperationId('ocr', JSON.stringify({
            composition_id: compositionId(state.current),
            ocr_purpose: state.scanTarget,
            files: state.photoFiles.map(function(file) {
                return [file.name || '', file.size || 0, file.lastModified || 0, file.type || ''];
            })
        }));
        renderOcrWaiting({ status: 'photo_uploading' }, false);
        Promise.all(state.photoFiles.map(function(file) {
            return window.MrCatCloud.prepareEvidenceImage(file);
        })).then(function(preparedPages) {
            return retryNetworkTask(function() { return writingCall('startPhotoUpload', {
                composition_id: compositionId(state.current),
                operation_id: ocrOperation,
                ocr_purpose: state.scanTarget,
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
                        ocr_purpose: state.scanTarget,
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
                ocr_purpose: state.scanTarget,
                replace_current: Boolean(state.review || state.current && (state.current.standardized_review || state.current.language_review))
            });
        }).then(function(result) {
            if (result.composition) state.current = result.composition;
            restoreOcrPhotoUrls(result);
            if (result.ocr || state.current && state.current.pending_ocr) {
                showOcrResult(result);
                return;
            }
            if (state.waitingKind === 'ocr') {
                updateAiWaitingExperience({ kind: 'ocr', jobStatus: firstText(result.job && result.job.status, state.current && state.current.ocr_job && state.current.ocr_job.status), durable: true });
                startOcrPolling();
            } else {
                renderOcrWaiting(result.job || state.current && state.current.ocr_job, true);
            }
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
        state.scanTarget = firstText(state.ocr.ocr_purpose).toLowerCase() === 'prompt' ? 'prompt' : 'writing';
        state.ocrReviewText = safeArray(state.ocr.paragraphs).length
            ? state.ocr.paragraphs.join('\n\n')
            : firstText(state.ocr.full_text);
        if (state.scanTarget === 'writing') state.confirmedText = state.ocrReviewText;
        clearLogicalOperation('ocr');
        showReadyOrOpenResult('ocr', function() {
            renderOcr();
            syncCurrentSummary();
        });
    }

    function renderOcrWaiting(job, autoPoll) {
        var status = firstText(job && job.status, state.current && state.current.status).toLowerCase();
        var uploadPending = status === 'photo_uploading';
        if (!resumeAiWaitingExperience('ocr', uploadPending ? 'queued' : status, 'ocr-poll-status')) {
            renderAiWaitingExperience({
                kind: 'ocr',
                jobStatus: status,
                durable: !uploadPending,
                pollStatusId: 'ocr-poll-status',
                allowBackground: !uploadPending,
                extraActions: ''
            });
        }
        if (autoPoll) startOcrPolling();
    }

    function startOcrPolling() {
        if (state.ocrPollActive || !compositionId(state.current)) return;
        state.ocrPollActive = true;
        startWaitingPolling({
            kind: 'ocr', requestName: 'getComposition', pollScheduler: 'scheduleWaitingPoll', inFlightGuard: 'waitingPollInFlight', generationKey: 'ocrPollGeneration',
            isActive: function() { return state.ocrPollActive; },
            operationId: function() { return firstText(state.current && state.current.ocr_job && state.current.ocr_job.operation_id); },
            returnedOperationId: function(result) { return firstText(ocrJobFrom(result).operation_id); },
            onSuccess: function(result) {
                var composition = result.composition || {};
                state.current = composition;
                restoreOcrPhotoUrls(result);
                var job = ocrJobFrom(result);
                if (composition.pending_ocr) { showOcrResult({ composition: composition, ocr: composition.pending_ocr, ocr_photo_urls: result.ocr_photo_urls }); return; }
                if (firstText(job.status).toLowerCase() === 'failed' || compositionStatus(composition) === 'ocr_failed') { renderOcrFailure({ code: job.error_code || 'WRITING_AI_OCR_FAILED', message: 'OCR 识别没有完成。' }); return; }
                var durable = firstText(job.status).toLowerCase() !== 'photo_uploading' && !composition.pending_upload;
                if (durable && !state.waitingRunner) renderOcrWaiting(job, false);
                updateAiWaitingExperience({ kind: 'ocr', jobStatus: job.status, durable: durable });
                syncCurrentSummary();
            },
            onError: function() {
                var status = document.getElementById('ocr-poll-status');
                if (status) status.textContent = compositionStatus(state.current) === 'photo_uploading' ? '暂时无法确认上传，请保持此页面。' : '暂时无法查询，网络恢复后会继续。';
            }
        });
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
        state.screen = 'ocr-waiting';
        showAiWaitingInterruption('ocr', message, code, code === 'PHOTO_UPLOAD_UNCONFIRMED' ? 'upload' : 'job');
    }

    function ocrRegionsForPage(pageIndex) {
        return safeArray(state.ocr && state.ocr.uncertain_regions).filter(function(region) {
            return region && (region.confidence === 'high' || region.confidence === 'medium')
                && Number(region.page_index) === pageIndex
                && Number.isInteger(Number(region.span_index));
        });
    }

    function ocrRegionSvg(pageIndex) {
        return ocrRegionsForPage(pageIndex).map(function(region) {
            var confidence = region.confidence === 'high' ? 'high' : 'medium';
            return '<rect class="ocr-photo-region ocr-photo-region-' + confidence + '" data-ocr-region-index="' + escapeHtml(region.span_index) +
                '" role="button" tabindex="0" aria-label="Locate unclear text in OCR editor" x="' + escapeHtml(region.x) +
                '" y="' + escapeHtml(region.y) + '" width="' + escapeHtml(region.width) + '" height="' + escapeHtml(region.height) +
                '" rx="18" vector-effect="non-scaling-stroke"></rect>';
        }).join('');
    }

    function renderOcr() {
        destroyAiWaitingExperience();
        state.ocrTitleUndo = null;
        state.screen = 'ocr';
        updateCurrentWritingTitle();
        updateToolbarNavigation();
        showOcrPhotoToolbarToggle();
        var reviewText = state.scanTarget === 'prompt' ? state.ocrReviewText : state.confirmedText;
        var imageLabel = state.scanTarget === 'prompt' ? 'Uploaded writing prompt images' : 'Uploaded composition images';
        var titleControl = state.scanTarget === 'writing'
            ? '<div class="ocr-title-control"><label class="ocr-title-field"><input id="ocr-title" type="text" maxlength="80" autocomplete="off" aria-label="Title, optional" placeholder="Title (Optional)" value="' + escapeHtml(state.title) + '"></label>' +
                '<div class="ocr-title-actions"><button class="secondary-button compact" type="button" data-use-ocr-first-line aria-label="Use first line as title">Use first line</button></div>' +
                '<span class="ocr-title-feedback" data-ocr-title-feedback role="status" aria-live="polite" hidden></span></div>'
            : '';
        stage.innerHTML = '<div class="ocr-review-shell"><section class="surface surface-pad ocr-review-surface">' +
            '<div class="ocr-layout" id="ocr-layout"><section class="ocr-photo" aria-label="' + imageLabel + '">' + state.photoUrls.map(function(url, index) { return '<figure class="ocr-photo-page" data-ocr-page-index="' + index + '"><div class="ocr-photo-layer"><img src="' + escapeHtml(url) + '" alt="Uploaded ' + (state.scanTarget === 'prompt' ? 'prompt' : 'composition') + ' page ' + (index + 1) + '" data-open-photo-viewer="source" data-photo-index="' + index + '" role="button" tabindex="0" aria-label="Enlarge uploaded ' + (state.scanTarget === 'prompt' ? 'prompt' : 'composition') + ' page ' + (index + 1) + '"><svg class="ocr-photo-overlay" viewBox="0 0 1000 1000" preserveAspectRatio="none" role="group" aria-label="Unclear handwriting locations">' + ocrRegionSvg(index) + '</svg></div><figcaption class="sr-only">Uploaded page ' + (index + 1) + '</figcaption></figure>'; }).join('') + '</section>' +
            '<section class="ocr-editor">' + titleControl + '<div id="ocr-text" class="ocr-text-editor" contenteditable="true" role="textbox" aria-multiline="true" aria-label="Editable OCR text" spellcheck="true">' + ocrEditorHtml(reviewText, state.ocr && state.ocr.uncertain_spans) + '</div></section></div></section>' +
            '<div class="form-actions ocr-review-actions"><button class="primary-button" type="button" data-confirm-ocr data-disable-when-busy>Confirm</button></div></div>';
        scheduleStageViewportReset();
    }

    function adoptPromptOcr() {
        var prompt = firstText(ocrEditorText(document.getElementById('ocr-text')));
        if (!prompt) { setStatus('Please confirm or complete the writing prompt.'); return; }
        setBusy(true);
        writingCall('adoptPromptOcr', {
            composition_id: compositionId(state.current),
            prompt_text: prompt
        }).then(function(result) {
            if (result.composition) state.current = result.composition;
            state.promptText = prompt;
            state.ocrReviewText = '';
            state.ocr = null;
            state.scanTarget = 'writing';
            state.photoFiles = [];
            state.photoIds = [];
            state.photoUrls.forEach(function(url) { if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url); });
            state.photoUrls = [];
            state.inputMethod = 'text';
            state.homeComposerOpen = true;
            clearLogicalOperation('ocr');
            syncCurrentSummary();
            renderWelcome();
            window.requestAnimationFrame(function() {
                var promptField = document.getElementById('writing-prompt');
                if (promptField) promptField.focus({ preventScroll: true });
            });
        }).catch(renderFatalAction).finally(function() { setBusy(false); });
    }

    function saveAndEvaluate() {
        renderReviewWaiting({ status: 'queued' }, false, false);
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
            if (state.waitingKind === 'review') {
                updateAiWaitingExperience({ kind: 'review', jobStatus: firstText(reviewJobFrom(result).status, 'queued'), durable: true });
                startReviewPolling();
            } else {
                renderReviewWaiting(reviewJobFrom(result), true, false);
            }
            syncCurrentSummary();
        }).catch(function(error) {
            if (isNetworkDisconnect(error) && compositionId(state.current)) {
                renderReviewWaiting({ job_type: 'review', status: 'queued', operation_id: evaluateOperation }, true, false);
                return;
            }
            if (reviewRequestMayBeRunning(error)) {
                renderReviewWaiting({ job_type: 'review', status: 'queued', operation_id: evaluateOperation }, true, false);
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
        showReadyOrOpenResult('review', function() {
            syncCurrentSummary();
            if (mode === 'standardized') renderStandardized();
            else prepareLanguageReview();
            Promise.all([refreshPortfolio(), refreshWritingProfile()]).catch(function() {});
        });
    }

    function renderReviewWaiting(job, autoPoll, allowRetry) {
        var jobStatus = firstText(job && job.status, state.current && state.current.status).toLowerCase();
        if (!resumeAiWaitingExperience('review', jobStatus, 'review-poll-status')) {
            renderAiWaitingExperience({
                kind: 'review',
                jobStatus: jobStatus,
                durable: true,
                pollStatusId: 'review-poll-status',
                allowBackground: true,
                extraActions: ''
            });
        }
        if (autoPoll) startReviewPolling(firstText(job && job.operation_id));
    }

    function startReviewPolling(expectedOperationId) {
        if (state.reviewPollActive || !compositionId(state.current)) return;
        state.reviewPollActive = true;
        startWaitingPolling({
            kind: 'review', requestName: 'getComposition', pollScheduler: 'scheduleWaitingPoll', inFlightGuard: 'waitingPollInFlight', generationKey: 'reviewPollGeneration',
            isActive: function() { return state.reviewPollActive; },
            operationId: function() { return firstText(expectedOperationId, state.current && state.current.active_job && state.current.active_job.operation_id); },
            returnedOperationId: function(result) { return firstText(reviewJobFrom(result).operation_id); },
            onSuccess: function(result) {
                var composition = result.composition || {};
                state.current = composition;
                var job = reviewJobFrom(result);
                if (reviewReady(composition)) { showReviewResult({ composition: composition }); return; }
                if (firstText(job.status).toLowerCase() === 'failed' || compositionStatus(composition) === 'review_failed') { renderReviewFailure({ code: job.error_code || 'WRITING_AI_REVIEW_FAILED', message: 'AI 批改没有完成。' }); return; }
                updateAiWaitingExperience({ kind: 'review', jobStatus: job.status, durable: true });
                syncCurrentSummary();
            },
            onError: function() { var status = document.getElementById('review-poll-status'); if (status) status.textContent = '暂时无法查询，网络恢复后会继续。作文已经安全保存。'; }
        });
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
        if (!resumeAiWaitingExperience('review', 'queued', 'review-poll-status')) {
            renderReviewWaiting({ status: 'queued' }, false, false);
        }
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
                renderReviewWaiting({ job_type: 'review', status: 'queued', operation_id: operation }, true, false);
                return;
            }
            if (reviewRequestMayBeRunning(error)) {
                renderReviewWaiting({ job_type: 'review', status: 'queued', operation_id: operation }, true, false);
                return;
            }
            if (error && error.result) clearLogicalOperation('evaluate');
            renderReviewFailure(error);
        }).finally(function() { setBusy(false); });
    }

    function retryPersistedAiJob(kind, jobType) {
        if (state.busy || !compositionId(state.current)) return;
        setBusy(true);
        resumeAiWaitingExperience(kind, 'queued', kind === 'ocr' ? 'ocr-poll-status' : kind === 'rewrite' ? 'rewrite-poll-status' : 'revision-scan-poll-status');
        writingCall('retryFailedJob', {
            composition_id: compositionId(state.current),
            job_type: jobType
        }).then(function(result) {
            if (result.composition) state.current = result.composition;
            var job = result.job || state.current && state.current.active_job || {};
            if (kind === 'ocr') {
                renderOcrWaiting(job, true);
            } else if (kind === 'rewrite') {
                renderRewriteWaiting(job, true, false);
            } else {
                syncRevisionScanFromComposition(state.current);
                renderRevisionScanWaiting(job, true, false, true);
            }
            syncCurrentSummary();
        }).catch(function(error) {
            if (kind === 'ocr') renderOcrFailure(error);
            else if (kind === 'rewrite') renderRewriteFailure(error);
            else renderRevisionScanFailure(error);
        }).finally(function() { setBusy(false); });
    }

    function retryInterruptedWaiting() {
        if (state.busy) return;
        var kind = state.waitingKind;
        var mode = state.waitingIssueMode;
        if (kind === 'review') {
            retryReviewRequest();
            return;
        }
        if (kind === 'ocr' && mode === 'upload' && state.photoFiles.length) {
            setBusy(true);
            resumeAiWaitingExperience('ocr', 'queued', 'ocr-poll-status');
            uploadAndExtract();
            return;
        }
        if (kind === 'revision_ocr' && mode === 'upload' && revisionScanState().files.length) {
            resumeAiWaitingExperience('revision_ocr', 'queued', 'revision-scan-poll-status');
            beginRevisionScanUpload(revisionScanState().files.slice());
            return;
        }
        if (kind === 'ocr') retryPersistedAiJob('ocr', 'ocr');
        else if (kind === 'rewrite') retryPersistedAiJob('rewrite', 'rewrite');
        else if (kind === 'revision_ocr') retryPersistedAiJob('revision_ocr', 'revision_ocr');
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
        state.screen = 'review-waiting';
        showAiWaitingInterruption('review', message, code, 'job');
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
        if (!resumeAiWaitingExperience('rewrite', jobStatus, 'rewrite-poll-status')) {
            renderAiWaitingExperience({
                kind: 'rewrite',
                jobStatus: jobStatus,
                durable: true,
                pollStatusId: 'rewrite-poll-status',
                allowBackground: true,
                extraActions: ''
            });
        }
        if (autoPoll) startRewritePolling(firstText(job && job.operation_id));
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
        showReadyOrOpenResult('rewrite', function() {
            syncCurrentSummary();
            if (record.passed === true || result && result.passed === true || compositionStatus(state.current) === 'completed') {
                renderCompletion();
            } else {
                state.correctionRound += 1;
                restoreLanguageReviewState();
                state.manuscriptView = manuscriptRevisionSummary(safeArray(state.review && state.review.sentences)).available ? 'revised' : 'draft';
                var sentences = safeArray(state.review && state.review.sentences);
                var rejectedIndex = sentences.findIndex(function(sentence, index) {
                    var answer = state.rewriteResults[sentenceId(sentence, index)];
                    return answer && answer.accepted === false;
                });
                state.activeSentence = Math.max(0, rejectedIndex);
                renderLanguage();
                if (rejectedIndex >= 0) focusRejectedRewriteSentence(sentenceId(sentences[rejectedIndex], rejectedIndex));
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
        state.screen = 'rewrite-waiting';
        showAiWaitingInterruption('rewrite', message, code, 'job');
    }

    function startRewritePolling(expectedOperationId) {
        if (state.rewritePollActive || !compositionId(state.current)) return;
        state.rewritePollActive = true;
        startWaitingPolling({
            kind: 'rewrite', requestName: 'getComposition', pollScheduler: 'scheduleWaitingPoll', inFlightGuard: 'waitingPollInFlight', pollDelay: 'setTimeout', generationKey: 'rewritePollGeneration',
            isActive: function() { return state.rewritePollActive; },
            operationId: function() { return firstText(expectedOperationId, state.current && state.current.active_job && state.current.active_job.operation_id); },
            returnedOperationId: function(result) { return firstText(rewriteJobFrom(result).operation_id); },
            onSuccess: function(result) {
                var composition = result.composition || {};
                state.current = composition;
                state.review = composition.language_review || state.review;
                var job = rewriteJobFrom(result);
                if (rewriteReady(composition)) { applyRewriteResult({ composition: composition }); return; }
                if (firstText(job.status).toLowerCase() === 'failed' || compositionStatus(composition) === 'rewrite_failed') { renderRewriteFailure({ code: job.error_code || 'WRITING_AI_REWRITE_FAILED', message: 'AI 改写检查没有完成。' }); return; }
                updateAiWaitingExperience({ kind: 'rewrite', jobStatus: job.status, durable: true });
                syncCurrentSummary();
            },
            onError: function() { var status = document.getElementById('rewrite-poll-status'); if (status) status.textContent = '暂时无法查询，网络恢复后会继续。你的改写已经安全保存。'; }
        });
    }

    function renderLoading(title, description) {
        destroyAiWaitingExperience();
        state.screen = 'loading';
        stage.innerHTML = '<section class="surface loading-state"><span class="loading-orbit" aria-hidden="true"></span><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(description || '') + '</p></section>';
        scheduleStageViewportReset();
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
        scheduleStageViewportReset();
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
        state.manuscriptView = manuscriptRevisionSummary(safeArray(state.review && state.review.sentences)).available ? 'revised' : 'draft';
        renderLanguage();
    }

    function sentenceId(sentence, index) { return firstText(sentence && sentence.sentence_id, sentence && sentence.id, 's' + ((index || 0) + 1)); }
    function rewriteRequired(sentence) {
        return Boolean(sentence) && sentence.rewrite_required !== false && ['effective', 'correct', 'no_change'].indexOf(sentence.status) === -1;
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

    function sentenceAnalysisCopy(sentence) {
        var parts = [];
        function addPart(value) {
            var copy = firstText(value);
            if (copy && parts.indexOf(copy) === -1) parts.push(copy);
        }
        addPart(sentence && sentence.coaching_summary);
        safeArray(sentence && sentence.issues).forEach(function(issue) {
            addPart(issue && issue.explanation);
            addPart(issue && issue.suggestion);
        });
        return parts.map(function(part) {
            return /[。！？!?；;.]$/.test(part) ? part : part + '。';
        }).join(' ') || (rewriteRequired(sentence) ? '请根据建议调整这句话。' : '这句话表达准确，无需修改。');
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
        scan.activePhotoIndex = boundedPhotoIndex(scan.activePhotoIndex, count);
        var preview = count ? stagedPhotoCardHtml({
            kind: 'revision',
            url: scan.previewUrls[scan.activePhotoIndex],
            index: scan.activePhotoIndex,
            count: count,
            addButton: '<button class="secondary-button compact add-photo-button" type="button" data-open-photo-choice="revision"' + (count >= 8 ? ' disabled' : '') + '>' + icon('camera') + 'Add Photo</button>'
        }) : '';
        stage.innerHTML = '<section class="surface surface-pad revision-photo-selection" aria-label="Revision photos">' +
            '<div class="revision-photo-carousel" data-revision-photo-carousel>' + preview + '</div>' +
            '<input id="revision-scan-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden>' +
            '<input id="revision-scan-library" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>' +
            '<div class="form-actions revision-photo-actions"><button class="secondary-button" type="button" data-cancel-revision-scan>Back</button>' +
            '<button class="primary-button" type="button" data-start-revision-upload data-disable-when-busy' + (count ? '' : ' disabled') + '>Start Scanning</button></div></section>';
        scheduleStageViewportReset();
    }

    function addRevisionScanPhotos(files) {
        if (state.readOnly || state.busy) return;
        if (state.screen !== 'revision-scan-photos') resetRevisionScanState();
        var scan = revisionScanState();
        var additions = safeArray(files);
        var remaining = Math.max(0, 8 - scan.files.length);
        if (additions.length > remaining) setStatus('Revision Scan 最多可加入 8 张照片。');
        var accepted = additions.slice(0, remaining);
        accepted.forEach(function(file) {
            scan.files.push(file);
            scan.previewUrls.push(URL.createObjectURL(file));
        });
        if (accepted.length) scan.activePhotoIndex = scan.files.length - 1;
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
        return '<article class="revision-scan-candidate is-' + status + (duplicate ? ' has-duplicate' : '') + '" data-scan-candidate-row="' + escapeHtml(id) + '">' +
            '<label class="revision-scan-target' + (selectedDetails ? '' : ' is-unassigned') + '">' +
            '<span class="revision-scan-target-main"><strong class="revision-scan-target-number">' + (selectedDetails ? selectedDetails.number : '?') + '</strong>' +
            '<span class="revision-scan-target-copy">' + escapeHtml(selectedDetails ? firstText(selectedDetails.sentence && selectedDetails.sentence.original) : 'Select the sentence this rewrite belongs to') + '</span>' +
            '<span class="revision-scan-target-chevron" aria-hidden="true">⌄</span></span>' +
            '<select data-scan-sentence="' + escapeHtml(id) + '" aria-label="为识别项 ' + (index + 1) + ' 选择仍需订正的原句"><option value="">Select sentence</option>' + options + '</select></label>' +
            '<label class="revision-scan-recognized"><span class="revision-scan-confidence is-' + confidence + '" role="img" aria-label="' + escapeHtml(confidenceMeta.label) + '" title="' + escapeHtml(confidenceMeta.label) + '">' + confidenceMeta.symbol + '</span>' +
            '<textarea rows="3" data-scan-text="' + escapeHtml(id) + '" aria-label="编辑识别项 ' + (index + 1) + ' 的文字">' + escapeHtml(candidate.recognized_text) + '</textarea></label>' +
            (duplicate ? '<p class="revision-scan-warning">同一句被识别了两次。请为每一行选择不同的改写句子后再导入。</p>' : '') + '</article>';
    }

    function renderRevisionScanReview() {
        var previousScreen = state.screen;
        if (state.screen === 'revision-scan-waiting' && state.waitingKind === 'revision_ocr') {
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
        if (previousScreen !== state.screen) scheduleStageViewportReset();
    }

    function renderRevisionScanWaiting(job, autoPoll, allowRetry, durable) {
        var scan = revisionScanState();
        scan.job = job || scan.job || {};
        var status = firstText(scan.job && scan.job.status, 'processing').toLowerCase();
        var isDurable = durable !== false && scan.job.durable !== false;
        if (!resumeAiWaitingExperience('revision_ocr', isDurable ? status : 'queued', 'revision-scan-poll-status')) {
            renderAiWaitingExperience({
                kind: 'revision_ocr',
                jobStatus: isDurable ? status : 'photo_uploading',
                durable: isDurable,
                pollStatusId: 'revision-scan-poll-status',
                allowBackground: isDurable,
                extraActions: ''
            });
        }
        if (autoPoll) startRevisionScanPolling();
    }

    function renderRevisionScanFailure(error) {
        stopRevisionScanPolling();
        var code = firstText(error && error.code, error && error.result && error.result.code, state.revisionScan && state.revisionScan.job && state.revisionScan.job.error_code);
        var message = firstText(error && error.message, '照片识别没有完成。你的作文和现有改写草稿仍然安全保存。');
        state.screen = 'revision-scan-waiting';
        showAiWaitingInterruption('revision_ocr', message, code, code === 'PHOTO_UPLOAD_UNCONFIRMED' ? 'upload' : 'job');
    }

    function startRevisionScanPolling() {
        if (state.revisionScanPollActive || !compositionId(state.current)) return;
        state.revisionScanPollActive = true;
        startWaitingPolling({
            kind: 'revision_ocr', requestName: 'getComposition', pollScheduler: 'scheduleWaitingPoll', inFlightGuard: 'waitingPollInFlight', generationKey: 'revisionScanPollGeneration',
            isActive: function() { return state.revisionScanPollActive; },
            operationId: function() { return firstText(state.revisionScan && state.revisionScan.job && state.revisionScan.job.operation_id); },
            returnedOperationId: function(result) { return firstText(revisionScanJobFrom(result && result.composition || result).operation_id); },
            onSuccess: function(result) {
                var composition = result.composition || {};
                state.current = composition;
                syncRevisionScanFromComposition(composition);
                if (revisionScanReady(composition)) { renderRevisionScanReview(); return; }
                var job = revisionScanJobFrom(composition);
                if (firstText(job.status).toLowerCase() === 'failed') { renderRevisionScanFailure({ message: '云端没有完成照片识别，请重新检查状态或拍照。' }); return; }
                updateAiWaitingExperience({ kind: 'revision_ocr', jobStatus: job.status, durable: true });
                syncCurrentSummary();
            },
            onError: function() { var status = document.getElementById('revision-scan-poll-status'); if (status) status.textContent = '暂时无法查询，网络恢复后会继续。当前改写草稿已经安全保存。'; }
        });
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
                    code: 'PHOTO_UPLOAD_UNCONFIRMED',
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
            setStatus('已导入选中的扫描草稿。');
            openScanSubmitConfirmation();
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
        var previousScreen = state.screen;
        destroyAiWaitingExperience();
        state.screen = 'language';
        updateRevisionProgress();
        var sentences = safeArray(state.review && state.review.sentences);
        if (!sentences.length) {
            stage.innerHTML = '<section class="surface empty-state"><strong>没有需要重写的句子</strong><p>这次批改没有返回逐句训练内容。</p><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button></section>';
            if (previousScreen !== state.screen) scheduleStageViewportReset();
            return;
        }
        if (state.activeSentence >= sentences.length) state.activeSentence = Math.max(0, sentences.length - 1);
        var cards = sentences.map(sentenceCardHtml).join('');
        var manuscript = firstText(state.current && state.current.confirmed_text, state.confirmedText, '暂无原文。');
        var revisionSummary = manuscriptRevisionSummary(sentences);
        if (!revisionSummary.available || (state.manuscriptView !== 'draft' && state.manuscriptView !== 'revised')) {
            state.manuscriptView = 'draft';
        }
        var cefrEstimate = state.review && state.review.cefr_estimate;
        var cefrPositionSuffixes = { lower: '-', middle: '', upper: '+' };
        var cefrSuffix = cefrEstimate && Object.prototype.hasOwnProperty.call(cefrPositionSuffixes, cefrEstimate.position) ?
            cefrPositionSuffixes[cefrEstimate.position] : '';
        var cefrHtml = cefrEstimate && cefrEstimate.level ?
            '<div class="cefr-estimate"><span class="cefr-estimate-label">CEFR Writing Estimate</span>' +
            '<strong>' + escapeHtml(cefrEstimate.level + cefrSuffix) + '</strong>' +
            (cefrEstimate.commentary_zh ? '<p>' + escapeHtml(cefrEstimate.commentary_zh) + '</p>' : '') + '</div>' : '';
        var sentenceReviewHtml = revisionSummary.available ? '' :
            '<section class="surface language-review-card language-sentence-review-card revision-skin-' + state.revisionSkin + '" style="--revision-analysis-scale:' + revisionTextScale() + '">' +
            '<div class="language-section-heading sentence-review-heading">' + revisionSkinControlHtml() + revisionFontControlsHtml() + '</div>' +
            '<nav class="language-toolbar" aria-label="句子导航"><div class="capsule-row">' + sentences.map(sentenceCapsuleHtml).join('') + '</div></nav>' +
            '<div class="sentence-stage"><div class="sentence-list">' + cards + '</div></div>' +
            (!state.readOnly ? '<div class="batch-actions">' +
                (revisionScanSentences().length ? '<button class="secondary-button scan-revision-trigger" type="button" data-open-photo-choice="revision" aria-label="Scan Revisions" title="Scan Revisions">' + icon('camera') + '</button><input id="revision-scan-photo" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden><input id="revision-scan-library" type="file" accept="image/jpeg,image/png,image/webp" multiple hidden>' : '') +
                '<button class="primary-button" type="button" data-submit-rewrites data-disable-when-busy>Submit</button></div>' : '') +
            (state.readOnly ? '<div class="form-actions language-card-footer"><button class="secondary-button" type="button" data-return-home>返回作品库</button></div>' : '') +
            '</section>';
        stage.innerHTML = '<div class="language-review-stack">' +
            '<section class="surface language-review-card language-overall-card"><h2 class="language-card-title">Language Review</h2>' + (state.readOnly ? '<p class="language-readonly-note">这是作品库中已保存的语言训练记录，只读显示。</p>' : '') + cefrHtml + '<p>' + escapeHtml(firstText(state.review && state.review.overview, state.review && state.review.summary, '请阅读整体建议，再逐句完成需要修改的表达。')) + '</p></section>' +
            '<section class="surface language-review-card language-manuscript-card ' + (state.manuscriptView === 'revised' ? 'is-revised-view' : 'is-draft-view') + '">' + manuscriptVersionControlHtml(revisionSummary.available) + '<div class="manuscript-text">' + highlightedManuscriptHtml(manuscript, sentences, state.manuscriptView, revisionSummary) + '</div></section>' +
            sentenceReviewHtml + '</div>';
        if (!revisionSummary.available) window.requestAnimationFrame(observeSentenceCardHeights);
        if (previousScreen !== state.screen) scheduleStageViewportReset();
    }

    function sentenceVisualStatus(sentence, index) {
        var id = sentenceId(sentence, index);
        var result = state.rewriteResults[id];
        if (!rewriteRequired(sentence) || result && result.accepted === true) return 'correct';
        var currentText = firstText(state.rewrites[id]);
        if (!currentText) return 'incorrect';
        var judgedText = firstText(result && result.student_rewrite);
        if (result && result.accepted === false && judgedText && currentText === judgedText) return 'incorrect';
        return 'pending';
    }

    function sentenceStatusLabel(status) {
        return status === 'correct' ? '正确' : status === 'pending' ? '等待检查' : '错误';
    }

    function sentenceStatusIconHtml(status, id) {
        var mark = status === 'correct'
            ? '<path class="sentence-status-mark" d="M7.1 12.3 10.6 15.8 17.2 8.6"></path>'
            : status === 'pending'
                ? '<path class="sentence-status-mark" d="M9.5 9.3a2.7 2.7 0 1 1 3.5 2.6c-.8.35-1 .85-1 1.55M12 16.35h.01"></path>'
                : '<path class="sentence-status-mark" d="m8.6 8.6 6.8 6.8m0-6.8-6.8 6.8"></path>';
        return '<span class="sentence-status-icon is-' + status + '" data-sentence-status="' + escapeHtml(id) + '" role="img" aria-label="' + sentenceStatusLabel(status) + '">' +
            '<svg aria-hidden="true" viewBox="0 0 24 24"><circle class="sentence-status-ring" cx="12" cy="12" r="9.2"></circle>' + mark + '</svg></span>';
    }

    function sentenceCapsuleHtml(sentence, index) {
        var id = sentenceId(sentence, index);
        var status = sentenceVisualStatus(sentence, index);
        var capsuleStatus = status === 'correct' ? '，正确' : status === 'pending' ? '，等待检查' : '，错误';
        return '<button class="sentence-capsule is-' + status + (index === state.activeSentence ? ' is-active' : '') + '" type="button" data-sentence-index="' + index + '" data-sentence-id="' + escapeHtml(id) + '" style="' + sentenceColorStyle(index) + '" aria-pressed="' + (index === state.activeSentence) + '"' + (index === state.activeSentence ? ' aria-current="true"' : '') + ' aria-label="第 ' + (index + 1) + ' 句' + capsuleStatus + '"><span aria-hidden="true">' + (index + 1) + '</span></button>';
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
        var revisionState = sentenceVisualStatus(sentence, index);
        var sentenceMeta = '<div class="sentence-card-meta">' + sentenceNumber +
            sentenceStatusIconHtml(revisionState, id, false) + '</div>';
        if (!required) {
            return cardStart +
                '<div class="sentence-flip-card"><div class="sentence-card-inner sentence-card-inner-static">' +
                '<section class="sentence-card-face sentence-effective-face">' +
                '<button class="sentence-effective-cue-hit" type="button" data-cue-effective-sentence="' + escapeHtml(id) + '" aria-label="该句无需订正"></button>' +
                '<div class="sentence-face-content">' + sentenceMeta +
                '<p class="original-sentence">' + original + '</p></div></section>' +
                '</div></div></article>';
        }
        var showRewrite = Boolean(state.rewriteFace[id]);
        var visibility = {
            analysisHidden: Boolean(showRewrite),
            rewriteHidden: !showRewrite
        };
        var analysisCopy = sentenceAnalysisCopy(sentence);
        var feedbackHistoryHtml = sentenceRewriteFeedbackHistory(id, result).map(function(entry) {
            return '<div class="rewrite-feedback-round"><p>' + escapeHtml(entry.feedback) + '</p></div>';
        }).join('');
        var analysisFaceId = 'sentence-analysis-' + id;
        var rewriteFaceId = 'sentence-rewrite-' + id;
        var analysisFace = '<section class="sentence-card-face sentence-analysis-face" id="' + escapeHtml(analysisFaceId) + '" aria-hidden="' + visibility.analysisHidden + '"' + (visibility.analysisHidden ? ' inert' : '') + '>' +
            '<button class="sentence-face-flip-hit" type="button" data-flip-sentence="' + escapeHtml(id) + '" data-face="rewrite" aria-controls="' + escapeHtml(rewriteFaceId) + '" aria-pressed="' + showRewrite + '" aria-label="翻到句子改写面"></button>' +
            '<div class="sentence-face-content">' +
            sentenceMeta + '<p class="original-sentence">' + original + '</p>' +
            '<section class="grammar-analysis" aria-label="语法建议"><p class="grammar-analysis-copy">' + escapeHtml(analysisCopy) + '</p>' + feedbackHistoryHtml + '</section></div></section>';
        var correctedSentence = firstText(result && result.student_rewrite, state.rewrites[id]);
        var correctedResponse = '<p class="corrected-sentence"><span class="sentence-corrected-highlight">' + escapeHtml(correctedSentence) + '</span></p>';
        var editableResponse = '<p class="original-sentence">' + original + '</p>' +
            '<div class="rewrite-area"><label for="rewrite-' + escapeHtml(id) + '">Your Attempt</label><textarea class="rewrite-input" id="rewrite-' + escapeHtml(id) + '" data-rewrite-id="' + escapeHtml(id) + '" placeholder="Rewrite this sentence in your own words." ' + (state.readOnly ? 'disabled' : '') + '>' + escapeHtml(state.rewrites[id]) + '</textarea></div>';
        var rewriteFace = '<section class="sentence-card-face sentence-rewrite-face" id="' + escapeHtml(rewriteFaceId) + '" aria-hidden="' + visibility.rewriteHidden + '"' + (visibility.rewriteHidden ? ' inert' : '') + '>' +
            '<button class="sentence-face-flip-hit" type="button" data-flip-sentence="' + escapeHtml(id) + '" data-face="analysis" aria-controls="' + escapeHtml(analysisFaceId) + '" aria-pressed="' + (!showRewrite) + '" aria-label="翻到句子分析面"></button>' +
            '<div class="sentence-face-content">' + sentenceMeta + '<div class="sentence-response">' + (accepted ? correctedResponse : editableResponse) +
            '</div></div></section>';
        return cardStart + '<div class="sentence-flip-card"><div class="sentence-card-inner' + (showRewrite ? ' show-rewrite' : '') + '" data-face="' + (showRewrite ? 'rewrite' : 'analysis') + '">' + analysisFace + rewriteFace + '</div></div></article>';
    }

    function focusRejectedRewriteSentence(id) {
        var token = ++stageViewportResetToken;
        window.requestAnimationFrame(function() {
            window.requestAnimationFrame(function() {
                if (token !== stageViewportResetToken) return;
                var target = document.getElementById('sentence-card-' + id);
                if (!target) return;
                target.classList.add('is-revision-attention');
                target.scrollIntoView({
                    behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                    block: 'start'
                });
                var capsule = Array.prototype.find.call(document.querySelectorAll('[data-sentence-id]'), function(item) {
                    return item.getAttribute('data-sentence-id') === id;
                });
                if (capsule) capsule.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'center' });
            });
        });
    }

    function syncSentenceDraftStatus(id) {
        var sentences = safeArray(state.review && state.review.sentences);
        var index = sentences.findIndex(function(sentence, sentenceIndex) { return sentenceId(sentence, sentenceIndex) === id; });
        if (index < 0) return;
        var status = sentenceVisualStatus(sentences[index], index);
        var capsule = Array.prototype.find.call(document.querySelectorAll('.sentence-capsule'), function(item) {
            return item.getAttribute('data-sentence-id') === id;
        });
        if (capsule) {
            ['correct', 'pending', 'incorrect'].forEach(function(value) { capsule.classList.toggle('is-' + value, value === status); });
            capsule.setAttribute('aria-label', '第 ' + (index + 1) + ' 句，' + sentenceStatusLabel(status));
        }
        Array.prototype.forEach.call(document.querySelectorAll('[data-sentence-status]'), function(item) {
            if (item.getAttribute('data-sentence-status') !== id) return;
            item.outerHTML = sentenceStatusIconHtml(status, id);
        });
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
            sentences.forEach(function(sentence, index) {
                if (rewriteRequired(sentence)) state.rewriteFace[sentenceId(sentence, index)] = true;
            });
            setStatus('');
            renderLanguage();
            openIncompleteRewriteAlert(missingId);
            window.requestAnimationFrame(function() {
                var target = document.getElementById('sentence-card-' + missingId);
                if (target) target.scrollIntoView({
                    behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
                    block: 'center'
                });
            });
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
        renderRewriteWaiting({ status: 'queued' }, false, false);
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
            if (state.waitingKind === 'rewrite') {
                updateAiWaitingExperience({ kind: 'rewrite', jobStatus: firstText(rewriteJobFrom(result).status, 'queued'), durable: true });
                startRewritePolling();
            } else {
                renderRewriteWaiting(rewriteJobFrom(result), true, false);
            }
            syncCurrentSummary();
        }).catch(function(error) {
            if (isNetworkDisconnect(error) && compositionId(state.current)) {
                renderRewriteWaiting({ job_type: 'rewrite', status: 'queued', operation_id: rewriteOperation }, true, false);
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
        scheduleStageViewportReset();
    }

    function startOptionalFullRewrite() {
        var previous = state.current || {};
        setBusy(true);
        renderLoading('Preparing your full rewrite…', 'This optional exercise will be saved as a new composition.');
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
            renderReplacementSource();
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
        state.scanTarget = 'writing';
        renderReplacementSource();
    }

    function loadComposition(id, forceReadOnly, options) {
        options = options || {};
        if (!id || state.busy) return Promise.resolve();
        state.toolbarTitleEditing = false;
        if (!isSidebarDockedViewport()) closeSidebar();
        setStatus('');
        if (!options.preserveStage) renderLoading('Opening your writing…', '');
        setBusy(true);
        var request = options.request || writingCall('getComposition', { composition_id: id });
        return request.then(function(result) {
            var composition = result.composition || result.item || {};
            if (safeArray(result.rubrics).length) state.rubrics = result.rubrics;
            var savedMode = compositionMode(composition);
            var review = result.review || composition.review || (savedMode === 'standardized' ? composition.standardized_review : composition.language_review) || null;
            resetDraft(composition);
            restoreOcrPhotoUrls(result);
            var restoredOcrPurpose = firstText(
                composition.pending_ocr && composition.pending_ocr.ocr_purpose,
                composition.ocr_job && composition.ocr_job.ocr_purpose,
                composition.pending_upload && composition.pending_upload.ocr_purpose
            ).toLowerCase();
            state.scanTarget = restoredOcrPurpose === 'prompt' ? 'prompt' : 'writing';
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
            else renderSourceEntry();
            syncCurrentSummary();
        }).then(function() {
            materializeStage();
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
                materializeStage();
                return;
            }
            renderFatalAction(error);
            materializeStage();
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
        state.screen = 'fatal';
        stage.innerHTML = '<section class="surface error-state"><strong>这一步没有完成</strong><p>' + escapeHtml(message) + '</p><div class="form-actions"><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button>' +
            (state.current ? '<button class="primary-button" type="button" data-resume-current>继续这篇作文</button>' : '') + '</div></section>';
        scheduleStageViewportReset();
    }

    function stagedPhotoCollection(kind) {
        if (kind === 'revision') {
            var scan = revisionScanState();
            return { urls: safeArray(scan.previewUrls), index: boundedPhotoIndex(scan.activePhotoIndex, scan.previewUrls.length) };
        }
        return { urls: safeArray(state.photoUrls), index: boundedPhotoIndex(state.activeSourcePhotoIndex, state.photoUrls.length) };
    }

    function refreshStagedPhotoCard(kind) {
        var collection = stagedPhotoCollection(kind);
        if (!collection.urls.length) return;
        var count = collection.urls.length;
        var addButton = kind === 'revision'
            ? '<button class="secondary-button compact add-photo-button" type="button" data-open-photo-choice="revision"' + (count >= 8 ? ' disabled' : '') + '>' + icon('camera') + 'Add Photo</button>'
            : '<button class="secondary-button compact add-photo-button" type="button" data-open-photo-choice="writing" data-photo-target="' + escapeHtml(state.scanTarget) + '"' + (count >= 8 ? ' disabled' : '') + '>' + icon('camera') + 'Add Photo</button>';
        var host = kind === 'revision'
            ? document.querySelector('[data-revision-photo-carousel]')
            : document.querySelector('.photo-preview-single');
        if (host) host.innerHTML = stagedPhotoCardHtml({
            kind: kind,
            url: collection.urls[collection.index],
            index: collection.index,
            count: count,
            addButton: addButton
        });
    }

    function stepStagedPhoto(kind, delta) {
        var collection = stagedPhotoCollection(kind);
        if (!collection.urls.length) return;
        var next = boundedPhotoIndex(collection.index + Number(delta || 0), collection.urls.length);
        if (kind === 'revision') revisionScanState().activePhotoIndex = next;
        else state.activeSourcePhotoIndex = next;
        refreshStagedPhotoCard(kind);
    }

    function renderPhotoViewer() {
        if (!photoViewerLayer || !state.photoViewerOpen) return;
        var urls = safeArray(state.photoViewerUrls);
        state.photoViewerIndex = boundedPhotoIndex(state.photoViewerIndex, urls.length);
        var image = photoViewerLayer.querySelector('#photo-viewer-image');
        var counter = photoViewerLayer.querySelector('#photo-viewer-counter');
        var previous = photoViewerLayer.querySelector('[data-photo-viewer-step="-1"]');
        var next = photoViewerLayer.querySelector('[data-photo-viewer-step="1"]');
        if (image) {
            image.src = urls[state.photoViewerIndex] || '';
            image.alt = 'Enlarged writing photo ' + (state.photoViewerIndex + 1) + ' of ' + urls.length;
        }
        if (counter) counter.textContent = 'Page ' + (state.photoViewerIndex + 1) + '/' + urls.length;
        if (previous) previous.disabled = state.photoViewerIndex <= 0;
        if (next) next.disabled = state.photoViewerIndex >= urls.length - 1;
    }

    function openPhotoViewer(kind, index, trigger) {
        if (!photoViewerLayer || state.photoViewerOpen || state.busy) return;
        var collection = stagedPhotoCollection(kind);
        if (!collection.urls.length) return;
        state.photoViewerOpen = true;
        state.photoViewerUrls = collection.urls.slice();
        state.photoViewerIndex = boundedPhotoIndex(index, collection.urls.length);
        state.photoViewerReturnFocus = trigger || document.activeElement;
        photoViewerLayer.hidden = false;
        app.inert = true;
        renderPhotoViewer();
        updateOverlayLock();
        window.requestAnimationFrame(function() {
            var close = photoViewerLayer.querySelector('[data-close-photo-viewer]');
            if (close) close.focus({ preventScroll: true });
        });
    }

    function stepPhotoViewer(delta) {
        if (!state.photoViewerOpen) return;
        state.photoViewerIndex = boundedPhotoIndex(state.photoViewerIndex + Number(delta || 0), state.photoViewerUrls.length);
        renderPhotoViewer();
    }

    function closePhotoViewer(restoreFocus) {
        if (!state.photoViewerOpen) return;
        var focusTarget = state.photoViewerReturnFocus;
        state.photoViewerOpen = false;
        state.photoViewerUrls = [];
        state.photoViewerIndex = 0;
        state.photoViewerReturnFocus = null;
        photoViewerLayer.hidden = true;
        app.inert = hasBlockingDialogOpen();
        updateOverlayLock();
        if (restoreFocus !== false && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') {
            focusTarget.focus({ preventScroll: true });
        }
    }

    function requestPhotoRemoval(kind, index, trigger) {
        if (!photoRemoveConfirmation || state.photoRemoveDialogOpen || state.busy) return;
        var collection = stagedPhotoCollection(kind);
        var photoIndex = boundedPhotoIndex(index, collection.urls.length);
        if (!collection.urls[photoIndex]) return;
        state.photoRemoveDialogOpen = true;
        state.pendingPhotoRemoval = { kind: kind === 'revision' ? 'revision' : 'source', index: photoIndex };
        state.photoRemoveReturnFocus = trigger || document.activeElement;
        photoRemoveConfirmation.hidden = false;
        app.inert = true;
        updateOverlayLock();
        window.requestAnimationFrame(function() {
            var cancel = photoRemoveConfirmation.querySelector('[data-cancel-photo-remove]');
            if (cancel) cancel.focus({ preventScroll: true });
        });
    }

    function closePhotoRemoveConfirmation(restoreFocus) {
        if (!state.photoRemoveDialogOpen) return;
        var focusTarget = state.photoRemoveReturnFocus;
        state.photoRemoveDialogOpen = false;
        state.pendingPhotoRemoval = null;
        state.photoRemoveReturnFocus = null;
        photoRemoveConfirmation.hidden = true;
        app.inert = hasBlockingDialogOpen();
        updateOverlayLock();
        if (restoreFocus !== false && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') {
            focusTarget.focus({ preventScroll: true });
        }
    }

    function confirmPhotoRemoval() {
        var pending = state.pendingPhotoRemoval;
        if (!pending) { closePhotoRemoveConfirmation(); return; }
        closePhotoRemoveConfirmation(false);
        var index = pending.index;
        if (pending.kind === 'revision') {
            var scan = revisionScanState();
            if (scan.previewUrls[index] && scan.previewUrls[index].indexOf('blob:') === 0) URL.revokeObjectURL(scan.previewUrls[index]);
            scan.files.splice(index, 1);
            scan.previewUrls.splice(index, 1);
            scan.activePhotoIndex = boundedPhotoIndex(index, scan.files.length);
            if (scan.files.length) renderRevisionScanPhotoSelection();
            else { resetRevisionScanState(); renderLanguage(); }
            return;
        }
        if (state.photoUrls[index] && state.photoUrls[index].indexOf('blob:') === 0) URL.revokeObjectURL(state.photoUrls[index]);
        state.photoFiles.splice(index, 1);
        state.photoUrls.splice(index, 1);
        state.activeSourcePhotoIndex = boundedPhotoIndex(index, state.photoUrls.length);
        renderSourceEntry();
    }

    function hasBlockingDialogOpen() {
        return state.leaveDialogOpen || state.incompleteRewriteAlertOpen || state.sentenceFeedbackOpen || state.scanSubmitConfirmationOpen ||
            state.compositionEntryDialogOpen || state.photoChoiceOpen || state.photoViewerOpen || state.photoRemoveDialogOpen;
    }

    function updateOverlayLock() {
        document.documentElement.classList.toggle('ai-overlay-open', (state.sidebarOpen && !isSidebarDockedViewport()) || hasBlockingDialogOpen());
    }

    function openPhotoChoice(context, target, trigger) {
        if (!photoChoiceLayer || state.photoChoiceOpen || state.busy) return;
        state.photoChoiceOpen = true;
        state.photoChoiceContext = context === 'revision' ? 'revision' : 'writing';
        state.photoChoiceTarget = target === 'prompt' ? 'prompt' : 'writing';
        state.photoChoiceReturnFocus = trigger || document.activeElement;
        photoChoiceLayer.hidden = false;
        app.inert = true;
        updateOverlayLock();
        window.requestAnimationFrame(function() {
            var first = photoChoiceLayer.querySelector('[data-photo-choice="camera"]');
            if (first) first.focus({ preventScroll: true });
        });
    }

    function closePhotoChoice(restoreFocus) {
        if (!state.photoChoiceOpen) return;
        var focusTarget = state.photoChoiceReturnFocus;
        state.photoChoiceOpen = false;
        state.photoChoiceContext = '';
        state.photoChoiceReturnFocus = null;
        photoChoiceLayer.hidden = true;
        app.inert = hasBlockingDialogOpen();
        updateOverlayLock();
        if (restoreFocus !== false && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') {
            focusTarget.focus({ preventScroll: true });
        }
    }

    function selectPhotoSource(source) {
        var context = state.photoChoiceContext;
        var target = state.photoChoiceTarget;
        closePhotoChoice(false);
        if (context === 'revision') {
            var revisionInput = document.getElementById(source === 'camera' ? 'revision-scan-photo' : 'revision-scan-library');
            if (revisionInput) revisionInput.click();
            return;
        }
        state.scanTarget = target;
        state.inputMethod = 'photo';
        if (compositionId(state.current)) persistSourceDraft().catch(function() {});
        // Keep the file-input click in the original user gesture. Safari on
        // iPhone/iPad may block it after a Promise or animation-frame boundary.
        renderSourceEntry();
        var selector = source === 'camera' ? '[data-writing-photo-camera]' : '[data-writing-photo-library]';
        var input = document.querySelector(selector);
        if (input && typeof input.click === 'function') input.click();
    }

    function compositionForEntry(id) {
        return portfolioCompositions().find(function(item) { return compositionId(item) === id; }) || null;
    }

    function ensureCompositionEntryDialog() {
        var existing = document.getElementById('writing-entry-overlay');
        if (existing) return existing;
        var overlay = document.createElement('div');
        overlay.className = 'practice-entry-overlay writing-entry-overlay';
        overlay.id = 'writing-entry-overlay';
        overlay.hidden = true;
        overlay.innerHTML = '<div class="practice-entry-shell"><section class="practice-entry-card is-question-confirmation" role="dialog" aria-modal="true" aria-label="Writing entry confirmation">' +
            '<div class="practice-entry-task"><small id="writing-entry-status">Draft</small><strong id="writing-entry-title">Writing</strong></div>' +
            '<div class="writing-entry-progress" aria-hidden="true"><span></span></div>' +
            '<div class="practice-entry-actions"><button class="practice-entry-enter" id="writing-entry-enter" type="button"><span>Enter</span>' + icon('arrow') + '</button></div></section>' +
            '<button class="practice-entry-close" id="writing-entry-close" type="button">Close</button></div>';
        document.body.appendChild(overlay);
        overlay.querySelector('#writing-entry-close').addEventListener('click', function() { closeCompositionEntryDialog(); });
        overlay.querySelector('#writing-entry-enter').addEventListener('click', function() {
            var id = state.compositionEntryTargetId;
            closeCompositionEntryDialog(false);
            if (id) loadComposition(id);
        });
        return overlay;
    }

    function showCompositionEntryDialog(id, trigger) {
        var composition = compositionForEntry(id);
        if (!composition) { loadComposition(id); return; }
        var overlay = ensureCompositionEntryDialog();
        var progress = homeWorkflowProgress(composition);
        state.compositionEntryDialogOpen = true;
        state.compositionEntryTargetId = id;
        state.compositionEntryReturnFocus = trigger || document.activeElement;
        overlay.querySelector('#writing-entry-status').textContent = statusLabel(compositionStatus(composition));
        overlay.querySelector('#writing-entry-title').textContent = compositionTitle(composition);
        overlay.querySelector('.writing-entry-progress > span').style.width = progress + '%';
        overlay.querySelector('.practice-entry-card').setAttribute('aria-label', compositionTitle(composition) + ', ' + statusLabel(compositionStatus(composition)));
        overlay.hidden = false;
        app.inert = true;
        updateOverlayLock();
        window.requestAnimationFrame(function() {
            var enter = overlay.querySelector('#writing-entry-enter');
            if (enter) enter.focus({ preventScroll: true });
        });
    }

    function closeCompositionEntryDialog(restoreFocus) {
        if (!state.compositionEntryDialogOpen) return;
        var overlay = document.getElementById('writing-entry-overlay');
        var focusTarget = state.compositionEntryReturnFocus;
        state.compositionEntryDialogOpen = false;
        state.compositionEntryTargetId = '';
        state.compositionEntryReturnFocus = null;
        if (overlay) overlay.hidden = true;
        app.inert = hasBlockingDialogOpen();
        updateOverlayLock();
        if (restoreFocus !== false && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') {
            focusTarget.focus({ preventScroll: true });
        }
    }

    function openIncompleteRewriteAlert(sentenceIdValue) {
        if (!incompleteRewriteAlert || state.incompleteRewriteAlertOpen) return;
        state.incompleteRewriteAlertOpen = true;
        state.incompleteRewriteTargetId = sentenceIdValue || '';
        incompleteRewriteAlert.hidden = false;
        app.inert = true;
        updateOverlayLock();
        window.requestAnimationFrame(function() {
            var ok = incompleteRewriteAlert.querySelector('[data-close-incomplete-rewrite]');
            if (ok) ok.focus({ preventScroll: true });
        });
    }

    function closeIncompleteRewriteAlert() {
        if (!state.incompleteRewriteAlertOpen) return;
        var targetId = state.incompleteRewriteTargetId;
        state.incompleteRewriteAlertOpen = false;
        state.incompleteRewriteTargetId = '';
        incompleteRewriteAlert.hidden = true;
        app.inert = hasBlockingDialogOpen();
        updateOverlayLock();
        var rewriteInput = targetId ? document.getElementById('rewrite-' + targetId) : null;
        if (rewriteInput && typeof rewriteInput.focus === 'function') rewriteInput.focus({ preventScroll: true });
    }

    function sentenceFeedbackCopies(sentence, index) {
        var id = sentenceId(sentence, index);
        var result = state.rewriteResults[id] || {};
        var copies = [sentenceAnalysisCopy(sentence)];
        sentenceRewriteFeedbackHistory(id, result).forEach(function(entry) {
            var feedback = firstText(entry && entry.feedback);
            if (feedback && copies.indexOf(feedback) === -1) copies.push(feedback);
        });
        return copies;
    }

    function cueNoFeedbackSentence(target) {
        if (!target) return;
        target.classList.remove('is-no-feedback-cue');
        void target.offsetWidth;
        target.classList.add('is-no-feedback-cue');
        window.setTimeout(function() {
            if (target.isConnected) target.classList.remove('is-no-feedback-cue');
        }, 420);
    }

    function cueEffectiveSentenceCard(target) {
        if (!target) return;
        target.classList.remove('is-effective-cue');
        void target.offsetWidth;
        target.classList.add('is-effective-cue');
        window.setTimeout(function() {
            if (target.isConnected) target.classList.remove('is-effective-cue');
        }, 420);
    }

    function openSentenceFeedback(index, trigger) {
        var sentences = safeArray(state.review && state.review.sentences);
        var revisionSummary = manuscriptRevisionSummary(sentences);
        var sentence = sentences[index];
        if (!sentenceFeedbackDialog || state.sentenceFeedbackOpen || !sentence ||
            !revisionSummary.available || state.manuscriptView !== 'draft') return;
        state.sentenceFeedbackOpen = true;
        state.sentenceFeedbackIndex = index;
        state.sentenceFeedbackReturnFocus = trigger || document.activeElement;
        var original = sentenceFeedbackDialog.querySelector('#sentence-feedback-original');
        var copy = sentenceFeedbackDialog.querySelector('#sentence-feedback-copy');
        if (original) original.textContent = firstText(sentence.original, sentence.text);
        if (copy) copy.innerHTML = sentenceFeedbackCopies(sentence, index).map(function(item) {
            return '<p class="sentence-feedback-item">' + escapeHtml(item) + '</p>';
        }).join('');
        sentenceFeedbackDialog.hidden = false;
        app.inert = true;
        updateOverlayLock();
        window.requestAnimationFrame(function() {
            var done = sentenceFeedbackDialog.querySelector('[data-close-sentence-feedback]');
            if (done) done.focus({ preventScroll: true });
        });
    }

    function closeSentenceFeedback(restoreFocus) {
        if (!state.sentenceFeedbackOpen) return;
        var focusTarget = state.sentenceFeedbackReturnFocus;
        state.sentenceFeedbackOpen = false;
        state.sentenceFeedbackIndex = -1;
        state.sentenceFeedbackReturnFocus = null;
        sentenceFeedbackDialog.hidden = true;
        app.inert = hasBlockingDialogOpen();
        updateOverlayLock();
        if (restoreFocus !== false && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') {
            focusTarget.focus({ preventScroll: true });
        }
    }

    function openScanSubmitConfirmation() {
        if (!scanSubmitConfirmation || state.scanSubmitConfirmationOpen) return;
        state.scanSubmitConfirmationOpen = true;
        state.scanSubmitReturnFocus = document.querySelector('[data-submit-rewrites]') || document.activeElement;
        scanSubmitConfirmation.hidden = false;
        app.inert = true;
        updateOverlayLock();
        window.requestAnimationFrame(function() {
            var submit = scanSubmitConfirmation.querySelector('[data-confirm-scan-submit]');
            if (submit) submit.focus({ preventScroll: true });
        });
    }

    function closeScanSubmitConfirmation(restoreFocus) {
        if (!state.scanSubmitConfirmationOpen) return;
        var focusTarget = state.scanSubmitReturnFocus;
        state.scanSubmitConfirmationOpen = false;
        state.scanSubmitReturnFocus = null;
        scanSubmitConfirmation.hidden = true;
        app.inert = hasBlockingDialogOpen();
        updateOverlayLock();
        if (restoreFocus !== false && focusTarget && focusTarget.isConnected && typeof focusTarget.focus === 'function') {
            focusTarget.focus({ preventScroll: true });
        }
    }

    function confirmScannedRewritesSubmit() {
        closeScanSubmitConfirmation(false);
        submitRewrites();
    }

    function openSidebar() {
        state.sidebarOpen = true;
        portfolioSidebar.classList.add('is-open');
        app.classList.add('has-sidebar-open');
        sidebarScrim.hidden = isSidebarDockedViewport();
        portfolioToggle.setAttribute('aria-expanded', 'true');
        updateOverlayLock();
        updateToolbarNavigation();
    }

    function closeSidebar() {
        state.sidebarOpen = false;
        portfolioSidebar.classList.remove('is-open');
        app.classList.remove('has-sidebar-open');
        sidebarScrim.hidden = true;
        portfolioToggle.setAttribute('aria-expanded', 'false');
        updateOverlayLock();
        updateToolbarNavigation();
    }

    function sourceHasUserInput() {
        return Boolean(state.title || state.promptText || state.confirmedText.trim()
            || state.photoFiles.length || state.photoIds.length);
    }

    function requestSourceDiscard() {
        if (!sourceHasUserInput()) {
            discardDraftAndReturn();
            return;
        }
        openLeaveConfirmation('discard');
    }

    function openLeaveConfirmation(action) {
        if (state.leaveDialogOpen) return;
        state.leaveDialogAction = action === 'discard' ? 'discard' : action === 'writing-home' ? 'writing-home' : 'dashboard';
        state.returnFocus = document.activeElement;
        state.leaveDialogOpen = true;
        var title = leaveConfirmation.querySelector('#leave-confirmation-title');
        var copy = leaveConfirmation.querySelector('#leave-confirmation-copy');
        var confirm = leaveConfirmation.querySelector('button[data-confirm-leave]');
        if (state.leaveDialogAction === 'discard') {
            if (title) title.textContent = 'Discard this writing?';
            if (copy) copy.textContent = 'This draft will be permanently removed from History.';
            if (confirm) confirm.textContent = 'Discard';
        } else if (state.leaveDialogAction === 'writing-home') {
            if (title) title.textContent = 'Back to Writing?';
            if (copy) copy.textContent = 'Your saved work is safe. Any cloud processing will continue in the background.';
            if (confirm) confirm.textContent = 'Back';
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
        app.inert = hasBlockingDialogOpen();
        updateOverlayLock();
        if (restoreFocus !== false && state.returnFocus && typeof state.returnFocus.focus === 'function') state.returnFocus.focus();
        state.returnFocus = null;
    }

    function confirmLeave() {
        var action = state.leaveDialogAction;
        closeLeaveConfirmation(false);
        if (action === 'discard') {
            discardDraftAndReturn();
            return;
        }
        if (action === 'writing-home') {
            returnToTutorHome();
            return;
        }
        stopOcrPolling();
        stopReviewPolling();
        clearWaitingPollSchedule();
        window.location.assign('dashboard.html');
    }

    function updateSourceState(target) {
        if (target.id === 'writing-prompt') state.promptText = target.value;
        if (target.id === 'writing-rubric') state.rubricId = target.value;
        if (target.id === 'writing-text') state.confirmedText = target.value;
        resizeSourceTextarea(target);
        if (target.name === 'assessment-mode') {
            state.assessmentMode = target.value;
            renderSourceEntry();
            return;
        }
        scheduleAutosave();
    }

    document.addEventListener('input', function(event) {
        var target = event.target;
        if (target.matches('#writing-prompt,#writing-rubric,#writing-text,[name="assessment-mode"]')) updateSourceState(target);
        if (target.id === 'ocr-title') {
            state.title = target.value.slice(0, 80);
            clearOcrTitleUndo();
        }
        if (target.matches('[data-rewrite-id]')) {
            var id = target.getAttribute('data-rewrite-id');
            state.rewrites[id] = target.value;
            delete state.skipped[id];
            var attentionCard = target.closest('[data-sentence-card]');
            if (attentionCard) attentionCard.classList.remove('is-revision-attention');
            saveRewriteDraftSnapshot();
            syncSentenceDraftStatus(id);
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
            state.ocrReviewText = ocrEditorText(editor);
            if (state.scanTarget === 'writing') state.confirmedText = state.ocrReviewText;
            clearOcrTitleUndo();
        }
    });

    document.addEventListener('change', function(event) {
        var target = event.target;
        if (target.matches('#writing-rubric,[name="assessment-mode"]')) updateSourceState(target);
        if (target.matches('[data-writing-photo-input]') && target.files && target.files.length) {
            var additions = Array.prototype.slice.call(target.files);
            if (state.photoFiles.length + additions.length > 8) {
                setStatus('一篇作文最多上传 8 页照片。');
                additions = additions.slice(0, Math.max(0, 8 - state.photoFiles.length));
            }
            state.photoFiles = state.photoFiles.concat(additions);
            state.photoUrls = state.photoUrls.concat(additions.map(function(file) { return URL.createObjectURL(file); }));
            state.activeSourcePhotoIndex = Math.max(0, state.photoUrls.length - 1);
            renderSourceEntry();
        }
        if ((target.id === 'revision-scan-photo' || target.id === 'revision-scan-library') && target.files && target.files.length) {
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
        if (event.target.id === 'current-writing-title-form') {
            event.preventDefault();
            saveToolbarTitle();
            return;
        }
        if (event.target.id === 'writing-source-form') {
            event.preventDefault();
            submitSource();
        }
    });

    document.addEventListener('click', function(event) {
        var photoViewerClose = event.target.closest && event.target.closest('[data-close-photo-viewer]');
        if (photoViewerClose) {
            closePhotoViewer();
            return;
        }
        var photoViewerOpen = event.target.closest && event.target.closest('[data-open-photo-viewer]');
        if (photoViewerOpen) {
            openPhotoViewer(photoViewerOpen.getAttribute('data-open-photo-viewer'), Number(photoViewerOpen.getAttribute('data-photo-index')), photoViewerOpen);
            return;
        }
        var photoChoice = event.target.closest && event.target.closest('[data-photo-choice]');
        if (photoChoice) {
            selectPhotoSource(photoChoice.getAttribute('data-photo-choice'));
            return;
        }
        var photoChoiceClose = event.target.closest && event.target.closest('[data-close-photo-choice]');
        if (photoChoiceClose) {
            closePhotoChoice();
            return;
        }
        var ocrRegion = event.target.closest && event.target.closest('[data-ocr-region-index]');
        if (ocrRegion) {
            activateOcrRegion(ocrRegion);
            return;
        }
        var ocrMark = event.target.closest && event.target.closest('[data-ocr-uncertain]');
        if (ocrMark) {
            hideOcrRegion(ocrMark.getAttribute('data-ocr-span-index'));
            unwrapOcrMark(ocrMark, true);
            state.ocrReviewText = ocrEditorText(document.getElementById('ocr-text'));
            if (state.scanTarget === 'writing') state.confirmedText = state.ocrReviewText;
            clearOcrTitleUndo();
            return;
        }
        var button = event.target.closest('button,[data-open-composition],[data-cancel-leave],[data-cancel-photo-remove],[data-review-scan-submit],[data-close-sentence-feedback],[data-manuscript-sentence]');
        if (!button) return;
        if (button.matches('#history-home')) openLeaveConfirmation();
        else if (button.matches('[data-cancel-leave]')) closeLeaveConfirmation();
        else if (button.matches('[data-cancel-photo-remove]')) closePhotoRemoveConfirmation();
        else if (button.matches('[data-confirm-photo-remove]')) confirmPhotoRemoval();
        else if (button.matches('[data-close-incomplete-rewrite]')) closeIncompleteRewriteAlert();
        else if (button.matches('[data-close-sentence-feedback]')) closeSentenceFeedback();
        else if (button.matches('[data-review-scan-submit]')) closeScanSubmitConfirmation();
        else if (button.matches('[data-confirm-scan-submit]')) confirmScannedRewritesSubmit();
        else if (button.matches('[data-confirm-leave]')) confirmLeave();
        else if (button.matches('[data-discard-source]')) requestSourceDiscard();
        else if (button.matches('[data-open-history]')) openSidebar();
        else if (button.matches('[data-start-mode]')) startInlineWriting(button.getAttribute('data-start-mode'));
        else if (button.matches('[data-start-new]')) createNewWriting();
        else if (button.matches('[data-return-home]')) returnToTutorHome();
        else if (button.matches('[data-view-waiting-result]')) {
            var waitingAction = state.waitingResultAction;
            state.waitingResultAction = null;
            stopOcrPolling(); stopReviewPolling(); stopRewritePolling(); stopRevisionScanPolling();
            destroyAiWaitingExperience();
            if (typeof waitingAction === 'function') waitingAction();
        }
        else if (button.matches('[data-open-composition]')) loadComposition(button.getAttribute('data-open-composition'));
        else if (button.matches('[data-open-photo-choice]')) openPhotoChoice(
            button.getAttribute('data-open-photo-choice'),
            button.getAttribute('data-photo-target'),
            button
        );
        else if (button.matches('[data-request-photo-remove]')) requestPhotoRemoval(
            button.getAttribute('data-request-photo-remove'),
            Number(button.getAttribute('data-photo-index')),
            button
        );
        else if (button.matches('[data-staged-photo-step]')) stepStagedPhoto(
            button.getAttribute('data-photo-kind'),
            Number(button.getAttribute('data-staged-photo-step'))
        );
        else if (button.matches('[data-photo-viewer-step]')) stepPhotoViewer(Number(button.getAttribute('data-photo-viewer-step')));
        else if (button.matches('[data-toggle-ocr-photo]')) {
            var layout = document.getElementById('ocr-layout');
            var visible = layout.classList.toggle('show-photo');
            updateOcrPhotoToolbarToggle(visible);
        }
        else if (button.matches('[data-use-ocr-first-line]')) {
            if (state.ocrTitleUndo) undoOcrFirstLine();
            else useOcrFirstLine();
        }
        else if (button.matches('[data-confirm-ocr]')) {
            if (state.scanTarget === 'prompt') {
                adoptPromptOcr();
                return;
            }
            var titleInput = document.getElementById('ocr-title');
            state.title = firstText(titleInput && titleInput.value).slice(0, 80);
            state.confirmedText = firstText(ocrEditorText(document.getElementById('ocr-text')));
            if (!state.confirmedText) { setStatus('请先确认或补全 OCR 文本。'); return; }
            setBusy(true); saveAndEvaluate();
        }
        else if (button.matches('[data-retry-waiting]')) retryInterruptedWaiting();
        else if (button.matches('[data-reupload]')) beginReplacement('photo');
        else if (button.matches('[data-edit-current]')) beginReplacement('text');
        else if (button.matches('[data-enter-language]')) enterLanguage();
        else if (button.matches('[data-manuscript-view]')) {
            var requestedManuscriptView = button.getAttribute('data-manuscript-view');
            var revisedAvailable = manuscriptRevisionSummary(safeArray(state.review && state.review.sentences)).available;
            state.manuscriptView = requestedManuscriptView === 'revised' && revisedAvailable ? 'revised' : 'draft';
            renderLanguage();
            window.requestAnimationFrame(function() {
                var selectedVersion = document.querySelector('[data-manuscript-view="' + state.manuscriptView + '"]');
                if (selectedVersion) selectedVersion.focus({ preventScroll: true });
            });
        }
        else if (button.matches('[data-revision-skin]')) toggleRevisionSkin();
        else if (button.matches('[data-revision-font-step]')) adjustRevisionTextLevel(Number(button.getAttribute('data-revision-font-step')));
        else if (button.matches('[data-cue-effective-sentence]')) {
            cueEffectiveSentenceCard(button.closest('.sentence-effective-face'));
        }
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
        else if (button.matches('[data-manuscript-sentence]') &&
            manuscriptRevisionSummary(safeArray(state.review && state.review.sentences)).available &&
            state.manuscriptView === 'draft') {
            var manuscriptSentenceIndex = Number(button.getAttribute('data-manuscript-sentence'));
            var manuscriptSentence = safeArray(state.review && state.review.sentences)[manuscriptSentenceIndex];
            if (rewriteRequired(manuscriptSentence)) openSentenceFeedback(manuscriptSentenceIndex, button);
            else cueNoFeedbackSentence(button);
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
        else if (button.matches('[data-start-revision-upload]')) {
            beginRevisionScanUpload(revisionScanState().files.slice());
        }
        else if (button.matches('[data-cancel-revision-scan]')) {
            stopRevisionScanPolling();
            if (state.screen === 'revision-scan-photos') resetRevisionScanState();
            renderLanguage();
        }
        else if (button.matches('[data-confirm-revision-scan]')) confirmRevisionScanImport();
        else if (button.matches('[data-submit-rewrites]')) submitRewrites();
        else if (button.matches('[data-full-rewrite]')) startOptionalFullRewrite();
        else if (button.matches('[data-open-current-readonly]')) { state.readOnly = true; prepareLanguageReview(); }
        else if (button.matches('[data-resume-current]')) { if (state.review) state.assessmentMode === 'standardized' ? renderStandardized() : prepareLanguageReview(); else renderSourceEntry(); }
    });

    document.addEventListener('keydown', function(event) {
        var photo = event.target.closest && event.target.closest('[data-open-photo-viewer]');
        if (photo && (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar')) {
            event.preventDefault();
            openPhotoViewer(photo.getAttribute('data-open-photo-viewer'), Number(photo.getAttribute('data-photo-index')), photo);
            return;
        }
        var ocrRegion = event.target.closest && event.target.closest('[data-ocr-region-index]');
        if (ocrRegion && (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar')) {
            event.preventDefault();
            activateOcrRegion(ocrRegion);
            return;
        }
        var sentence = event.target.closest && event.target.closest('[data-manuscript-sentence]');
        if (!sentence || (event.key !== 'Enter' && event.key !== ' ')) return;
        event.preventDefault();
        sentence.click();
    });
    document.addEventListener('pointerdown', unlockWaitingReadySound, { passive: true });

    document.getElementById('history-new-writing').addEventListener('click', function() {
        if (!isSidebarDockedViewport()) closeSidebar();
        returnToTutorHome();
    });
    portfolioToggle.addEventListener('click', function() {
        state.sidebarOpen ? closeSidebar() : openSidebar();
    });
    if (currentWritingTitleEdit) currentWritingTitleEdit.addEventListener('click', beginToolbarTitleEdit);
    if (currentWritingTitleCancel) currentWritingTitleCancel.addEventListener('click', cancelToolbarTitleEdit);
    sidebarScrim.addEventListener('click', closeSidebar);
    window.addEventListener('keydown', function(event) {
        if (state.photoViewerOpen) {
            if (event.key === 'ArrowLeft') { event.preventDefault(); stepPhotoViewer(-1); return; }
            if (event.key === 'ArrowRight') { event.preventDefault(); stepPhotoViewer(1); return; }
            if (event.key === 'Tab') {
                var viewerControls = photoViewerLayer.querySelectorAll('button:not(:disabled)');
                if (!viewerControls.length) return;
                var viewerFirst = viewerControls[0];
                var viewerLast = viewerControls[viewerControls.length - 1];
                if (event.shiftKey && document.activeElement === viewerFirst) { event.preventDefault(); viewerLast.focus(); }
                else if (!event.shiftKey && document.activeElement === viewerLast) { event.preventDefault(); viewerFirst.focus(); }
                return;
            }
        }
        if (state.photoRemoveDialogOpen && event.key === 'Tab') {
            var removeControls = photoRemoveConfirmation.querySelectorAll('button:not(:disabled)');
            if (!removeControls.length) return;
            var removeFirst = removeControls[0];
            var removeLast = removeControls[removeControls.length - 1];
            if (event.shiftKey && document.activeElement === removeFirst) { event.preventDefault(); removeLast.focus(); }
            else if (!event.shiftKey && document.activeElement === removeLast) { event.preventDefault(); removeFirst.focus(); }
            return;
        }
        if (state.photoChoiceOpen && event.key === 'Tab') {
            var photoControls = photoChoiceLayer.querySelectorAll('button:not(:disabled)');
            if (!photoControls.length) return;
            var photoFirst = photoControls[0];
            var photoLast = photoControls[photoControls.length - 1];
            if (event.shiftKey && document.activeElement === photoFirst) { event.preventDefault(); photoLast.focus(); }
            else if (!event.shiftKey && document.activeElement === photoLast) { event.preventDefault(); photoFirst.focus(); }
            return;
        }
        if (state.compositionEntryDialogOpen && event.key === 'Tab') {
            var entryOverlay = document.getElementById('writing-entry-overlay');
            var entryControls = entryOverlay ? entryOverlay.querySelectorAll('button:not(:disabled)') : [];
            if (!entryControls.length) return;
            var entryFirst = entryControls[0];
            var entryLast = entryControls[entryControls.length - 1];
            if (event.shiftKey && document.activeElement === entryFirst) { event.preventDefault(); entryLast.focus(); }
            else if (!event.shiftKey && document.activeElement === entryLast) { event.preventDefault(); entryFirst.focus(); }
            return;
        }
        if (state.scanSubmitConfirmationOpen && event.key === 'Tab') {
            var scanSubmitControls = scanSubmitConfirmation.querySelectorAll('button:not(:disabled)');
            if (!scanSubmitControls.length) return;
            var scanSubmitFirst = scanSubmitControls[0];
            var scanSubmitLast = scanSubmitControls[scanSubmitControls.length - 1];
            if (event.shiftKey && document.activeElement === scanSubmitFirst) { event.preventDefault(); scanSubmitLast.focus(); }
            else if (!event.shiftKey && document.activeElement === scanSubmitLast) { event.preventDefault(); scanSubmitFirst.focus(); }
            return;
        }
        if (state.incompleteRewriteAlertOpen && event.key === 'Tab') {
            var alertControl = incompleteRewriteAlert.querySelector('[data-close-incomplete-rewrite]');
            if (alertControl) { event.preventDefault(); alertControl.focus(); }
            return;
        }
        if (state.sentenceFeedbackOpen && event.key === 'Tab') {
            var feedbackControl = sentenceFeedbackDialog.querySelector('[data-close-sentence-feedback]');
            if (feedbackControl) { event.preventDefault(); feedbackControl.focus(); }
            return;
        }
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
            if (state.toolbarTitleEditing) cancelToolbarTitleEdit();
            else if (state.photoViewerOpen) closePhotoViewer();
            else if (state.photoRemoveDialogOpen) closePhotoRemoveConfirmation();
            else if (state.photoChoiceOpen) closePhotoChoice();
            else if (state.compositionEntryDialogOpen) closeCompositionEntryDialog();
            else if (state.scanSubmitConfirmationOpen) closeScanSubmitConfirmation();
            else if (state.sentenceFeedbackOpen) closeSentenceFeedback();
            else if (state.incompleteRewriteAlertOpen) closeIncompleteRewriteAlert();
            else if (state.leaveDialogOpen) closeLeaveConfirmation();
            else if (state.sidebarOpen) closeSidebar();
        }
    });
    window.addEventListener('pageshow', function() {
        if (state.photoViewerOpen) closePhotoViewer(false);
        if (state.photoRemoveDialogOpen) closePhotoRemoveConfirmation(false);
        if (state.photoChoiceOpen) closePhotoChoice(false);
        if (state.compositionEntryDialogOpen) closeCompositionEntryDialog(false);
        if (state.scanSubmitConfirmationOpen) closeScanSubmitConfirmation(false);
        if (state.sentenceFeedbackOpen) closeSentenceFeedback(false);
        if (state.incompleteRewriteAlertOpen) closeIncompleteRewriteAlert();
        if (state.leaveDialogOpen) closeLeaveConfirmation();
        scheduleSourceTextareaResize();
    });
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden) wakeWaitingPoll();
        if (!state.waitingRunner) return;
        try {
            if (document.hidden || state.waitingTaskState === 'ready') state.waitingRunner.pause();
            else state.waitingRunner.resume();
        } catch (error) {}
    });
    window.addEventListener('focus', wakeWaitingPoll);
    window.addEventListener('online', wakeWaitingPoll);
    window.addEventListener('resize', scheduleSourceTextareaResize);
    window.addEventListener('pagehide', function() {
        stopOcrPolling(); stopReviewPolling(); stopRewritePolling(); stopRevisionScanPolling();
        destroyAiWaitingExperience();
        if (state.waitingAudioContext && typeof state.waitingAudioContext.close === 'function') {
            try { state.waitingAudioContext.close(); } catch (error) {}
        }
        state.waitingAudioContext = null;
        state.waitingAudioOutput = null;
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
    if (sidebarDockedQuery && sidebarDockedQuery.addEventListener) {
        sidebarDockedQuery.addEventListener('change', function(event) {
            if (event.matches) openSidebar();
            else closeSidebar();
        });
    }

    function init() {
        restoreRevisionTextLevel();
        restoreRevisionSkin();
        if (!window.MrCatAuth) { renderFatalAction(new Error('登录组件没有载入，请刷新页面。')); return; }
        var requestedId = requestedCompositionId();
        window.MrCatAuth.getSession().then(function(session) {
            state.session = session;
            if (!state.session || state.session.mode !== 'student') {
                app.setAttribute('aria-busy', 'false');
                app.setAttribute('aria-hidden', 'true');
                app.inert = true;
                var accessDialog = document.getElementById('visitor-access-dialog');
                if (accessDialog) {
                    accessDialog.hidden = false;
                    window.requestAnimationFrame(function() {
                        var emailAction = accessDialog.querySelector('.visitor-access-email');
                        if (emailAction) emailAction.focus({ preventScroll: true });
                    });
                }
                return null;
            }
            var profileRequest = writingCall('getProfile').catch(function() { return { success: true, profile: null }; });
            var listRequest = writingCall('listCompositions');
            var detailRequest = requestedId
                ? loadComposition(requestedId, undefined, {
                    preserveStage: true,
                    request: writingCall('getComposition', { composition_id: requestedId })
                })
                : Promise.resolve(null);
            var catalogRequest = Promise.all([profileRequest, listRequest]).then(function(results) {
                state.profile = results[0].student || state.session.profile || {};
                state.writingProfile = safeArray(results[0].profile);
                state.quota = results[0].quota || null;
                state.rubrics = safeArray(results[0].rubrics).length ? results[0].rubrics : safeArray(results[1].rubrics);
                state.compositions = normalizeCompositions(results[1]);
                clearRetiredPendingComposerStorage();
                renderPortfolio();
                if (isSidebarDockedViewport()) openSidebar();
                if (!requestedId) {
                    app.setAttribute('aria-busy', 'false');
                    renderWelcome();
                    materializeStage();
                }
            }).catch(function(error) {
                if (!requestedId) throw error;
                state.profile = state.session.profile || {};
                if (!state.compositions.length && state.current) state.compositions = [state.current];
                renderPortfolio();
            });
            return Promise.all([detailRequest, catalogRequest]);
        }).catch(function(error) {
            app.setAttribute('aria-busy', 'false');
            stage.innerHTML = '<section class="surface error-state"><strong>Student sign-in required</strong><p>Your session could not be restored. Please sign in again.</p><a class="primary-button" href="index.html">Go to sign in</a></section>';
            materializeStage();
        });
    }

    init();
})(window, document);
