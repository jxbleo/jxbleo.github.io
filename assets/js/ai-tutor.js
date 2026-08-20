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
        layout: 'sequential',
        activeSentence: 0,
        rewrites: {},
        rewriteResults: {},
        skipped: {},
        referenceOpen: {},
        correctionRound: 0,
        busy: false,
        autosaveTimer: null,
        sidebarOpen: false
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
    var mobileContext = document.getElementById('mobile-context');

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

    function compositionTitle(composition) {
        return firstText(composition && composition.title, composition && composition.prompt_title, composition && composition.prompt_text, 'Untitled writing');
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
            draft: '草稿', ocr_processing: '正在识别', ocr_ready: '待确认', ocr_review: '待确认', ready: '等待批改', queued: '等待批改', evaluating: '正在批改',
            review_ready: '待训练', reviewed: '评估完成', sentence_training: '待逐句训练', needs_revision: '需要再修改', completed: '已完成', failed: '稍后继续'
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
            return '<button class="portfolio-item' + (active ? ' is-active' : '') + '" type="button" data-open-composition="' + escapeHtml(id) + '">' +
                '<strong>' + escapeHtml(compositionTitle(item)) + '</strong>' +
                '<small>' + escapeHtml(formatDate(item.updated_at || item.created_at)) + score + '</small>' +
                '<span class="portfolio-item-meta"><span class="mini-badge ' + (mode === 'standardized' ? 'standardized' : '') + '">' + modeLabel(mode) + '</span>' +
                '<span class="mini-badge">' + escapeHtml(statusLabel(compositionStatus(item))) + '</span></span>' +
            '</button>';
        }).join('');
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
        mobileContext.textContent = 'AI 写作工作区';
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
        state.photoUrls.forEach(function(url) { if (url.indexOf('blob:') === 0) URL.revokeObjectURL(url); });
        state.current = composition || null;
        state.review = null;
        state.readOnly = false;
        state.inputMethod = 'text';
        state.assessmentMode = compositionMode(composition);
        state.rubricId = firstText(composition && composition.rubric_id);
        state.title = firstText(composition && composition.title);
        state.promptText = firstText(composition && composition.prompt_text);
        state.confirmedText = firstText(composition && composition.confirmed_text, composition && composition.full_text);
        state.photoFiles = [];
        state.photoUrls = [];
        state.photoIds = [];
        state.ocr = null;
        state.layout = 'sequential';
        state.activeSentence = 0;
        state.rewrites = {};
        state.rewriteResults = {};
        state.skipped = {};
        state.referenceOpen = {};
        state.correctionRound = 0;
    }

    function createNewWriting() {
        if (state.busy) return;
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
        mobileContext.textContent = '开始新作文';
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
            '<section class="section-block"><label class="field"><span>作文名称 <small>（方便以后找到）</small></span><input id="writing-title" maxlength="160" autocomplete="off" placeholder="例如：My Ideal City" value="' + escapeHtml(state.title) + '"></label>' +
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
        if (!state.title) state.title = state.promptText ? state.promptText.slice(0, 80) : 'Untitled writing';
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
        var ocrOperation = '';
        renderLoading('正在准备作文照片…', '照片上传后会先提取文字，再交给你确认。');
        Promise.all(state.photoFiles.map(function(file) {
            return window.MrCatCloud.prepareEvidenceImage(file);
        })).then(function(preparedPages) {
            return writingCall('startPhotoUpload', {
                composition_id: compositionId(state.current),
                replace_current: Boolean(state.review || state.current && (state.current.standardized_review || state.current.language_review)),
                pages: preparedPages.map(function(prepared, index) {
                    return {
                        file_name: state.photoFiles[index].name || 'writing-' + (index + 1) + '.jpg',
                        mime_type: prepared.display.type || 'image/jpeg',
                        size_bytes: prepared.display.size
                    };
                })
            }).then(function(started) {
                var uploads = safeArray(started.uploads);
                if (uploads.length !== preparedPages.length) throw new Error('照片上传信息不完整。');
                return Promise.all(uploads.map(function(upload, index) {
                    return window.MrCatCloud.uploadWithMetadata(upload, preparedPages[index].display);
                })).then(function() {
                    state.photoIds = uploads.map(function(upload) { return upload.photo_id; });
                    return writingCall('finishPhotoUpload', {
                        composition_id: compositionId(state.current), photo_ids: state.photoIds
                    });
                });
            });
        }).then(function() {
            ocrOperation = logicalOperationId('ocr', JSON.stringify({
                composition_id: compositionId(state.current),
                photo_ids: state.photoIds
            }));
            return writingCall('extractOcr', {
                composition_id: compositionId(state.current),
                photo_ids: state.photoIds,
                operation_id: ocrOperation,
                replace_current: Boolean(state.review || state.current && (state.current.standardized_review || state.current.language_review))
            });
        }).then(function(result) {
            if (!result.ocr) return waitForOcrResult(ocrOperation);
            return result;
        }).catch(function(error) {
            if (!isNetworkDisconnect(error)) throw error;
            renderLoading('照片已收到，正在识别文字…', '网络连接中断不会停止识别，页面会自动查询结果，请稍候。');
            return waitForOcrResult(ocrOperation);
        }).then(function(result) {
            clearLogicalOperation('ocr');
            state.ocr = result.ocr || {};
            state.confirmedText = firstText(state.ocr.full_text, safeArray(state.ocr.paragraphs).join('\n\n'));
            if (result.composition) state.current = result.composition;
            renderOcr();
            syncCurrentSummary();
        }).catch(function(error) {
            if (error && error.result) clearLogicalOperation('ocr');
            renderFatalAction(error);
        }).finally(function() { setBusy(false); });
    }

    function isNetworkDisconnect(error) {
        return /network(?: request)? error|failed to fetch|networkerror|timeout/i.test(firstText(error && error.message));
    }

    function delay(milliseconds) {
        return new Promise(function(resolve) { window.setTimeout(resolve, milliseconds); });
    }

    function waitForOcrResult(operationIdValue) {
        var deadline = Date.now() + 120000;
        function poll() {
            return writingCall('getComposition', { composition_id: compositionId(state.current) }).then(function(result) {
                var composition = result.composition || {};
                var job = composition.ocr_job || {};
                var ocr = composition.pending_ocr || null;
                if (ocr && (!job.status || job.status === 'succeeded')) {
                    return { success: true, ocr: ocr, composition: composition };
                }
                if (job.status === 'failed' && (!operationIdValue || !job.operation_id || job.operation_id === operationIdValue)) {
                    var failed = new Error('OCR 识别没有完成。');
                    failed.code = job.error_code || 'WRITING_AI_OCR_FAILED';
                    failed.result = { success: false, code: failed.code };
                    throw failed;
                }
                if (Date.now() >= deadline) {
                    var timedOut = new Error('OCR 仍在云端处理中，请稍后继续这篇作文。');
                    timedOut.code = 'WRITING_AI_TIMEOUT';
                    throw timedOut;
                }
                return delay(3000).then(poll);
            }).catch(function(error) {
                if (error && error.result || Date.now() >= deadline) throw error;
                return delay(3000).then(poll);
            });
        }
        return poll();
    }

    function renderOcr() {
        state.screen = 'ocr';
        mobileContext.textContent = '确认识别文字';
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
            clearLogicalOperation('evaluate');
            if (result.composition) state.current = result.composition;
            state.review = result.review || (result.composition && result.composition.review) || {};
            state.readOnly = false;
            syncCurrentSummary();
            if (state.assessmentMode === 'standardized') renderStandardized();
            else prepareLanguageReview();
        }).then(function() {
            return Promise.all([refreshPortfolio(), refreshWritingProfile()]);
        }).catch(function(error) {
            if (error && error.result) clearLogicalOperation('evaluate');
            renderFatalAction(error);
        }).finally(function() { setBusy(false); });
    }

    function renderLoading(title, description) {
        state.screen = 'loading';
        stage.innerHTML = '<section class="surface loading-state"><span class="loading-orbit" aria-hidden="true"></span><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(description || '') + '</p></section>';
    }

    function renderStandardized() {
        state.screen = 'standardized';
        mobileContext.textContent = '标化考试内容评估';
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
        state.activeSentence = 0;
        sentences.forEach(function(sentence) {
            var id = sentenceId(sentence);
            var stored = storedById[id] || sentence.rewrite_result;
            state.rewrites[id] = firstText(sentence.student_rewrite, sentence.rewrite_text, stored && stored.student_rewrite);
            if (stored) state.rewriteResults[id] = stored;
        });
        renderLanguage();
    }

    function sentenceId(sentence, index) { return firstText(sentence && sentence.sentence_id, sentence && sentence.id, 's' + ((index || 0) + 1)); }
    function rewriteRequired(sentence) { return sentence && sentence.rewrite_required !== false && sentence.status !== 'correct' && sentence.status !== 'no_change'; }
    function coordinateReferenceAndRewrite(referenceOpen) {
        return { referenceVisible: Boolean(referenceOpen), rewriteInputHidden: Boolean(referenceOpen) };
    }

    function languageProgress(sentences) {
        var required = sentences.filter(rewriteRequired);
        var done = required.filter(function(sentence, index) {
            var id = sentenceId(sentence, index);
            return state.rewriteResults[id] && state.rewriteResults[id].accepted === true;
        });
        var filled = required.filter(function(sentence, index) { return firstText(state.rewrites[sentenceId(sentence, index)]); });
        return { required: required.length, accepted: done.length, filled: filled.length };
    }

    function renderLanguage() {
        state.screen = 'language';
        mobileContext.textContent = state.correctionRound ? '需要再修改' : '逐句语言训练';
        var sentences = safeArray(state.review && state.review.sentences);
        if (!sentences.length) {
            stage.innerHTML = '<section class="surface empty-state"><strong>没有需要重写的句子</strong><p>这次批改没有返回逐句训练内容。</p><button class="secondary-button" type="button" data-return-home>返回 AI Tutor</button></section>';
            return;
        }
        if (state.activeSentence >= sentences.length) state.activeSentence = Math.max(0, sentences.length - 1);
        var progress = languageProgress(sentences);
        var cards = sentences.map(sentenceCardHtml).join('');
        stage.innerHTML = (state.readOnly ? '<p class="readonly-banner">这是作品库中已保存的语言训练记录，只读显示。</p>' : '') +
            '<section class="result-banner language"><p class="eyebrow">GENERAL LANGUAGE COACHING</p><h2>' + (state.correctionRound ? '再检查几句话' : '现在，轮到你来改写。') + '</h2><p>' + escapeHtml(firstText(state.review && state.review.overview, state.review && state.review.summary, '参考语言分析，亲手重写需要改善的句子。全部完成后，AI 会一次性检查。')) + '</p></section>' +
            '<nav class="language-toolbar" aria-label="句子导航"><div class="capsule-row">' + sentences.map(sentenceCapsuleHtml).join('') + '</div>' +
            '<div class="language-toolbar-bottom"><span class="progress-copy">' + (state.readOnly ? progress.accepted + ' / ' + progress.required + ' 已完成' : progress.filled + ' / ' + progress.required + ' 已填写') + '</span>' +
            '<div class="view-toggle" role="group" aria-label="训练布局"><button type="button" data-layout="sequential" aria-pressed="' + (state.layout === 'sequential') + '">' + icon('focus') + '逐句</button><button type="button" data-layout="list" aria-pressed="' + (state.layout === 'list') + '">' + icon('list') + '列表</button></div></div></nav>' +
            '<div class="sentence-stage"><div class="sentence-list ' + escapeHtml(state.layout) + '">' + cards + '</div></div>' +
            (!state.readOnly ? '<div class="batch-actions"><p>未完成的句子会在数字胶囊下方显示小圆点。提交后统一检查。</p><button class="primary-button" type="button" data-submit-rewrites data-disable-when-busy>' + (state.correctionRound ? '再次提交检查' : '全部完成，提交检查') + icon('arrow') + '</button></div>' : '') +
            (state.readOnly ? '<div class="form-actions"><button class="secondary-button" type="button" data-return-home>返回作品库</button></div>' : '');
    }

    function sentenceCapsuleHtml(sentence, index) {
        var id = sentenceId(sentence, index);
        var result = state.rewriteResults[id];
        var done = !rewriteRequired(sentence) || result && result.accepted === true;
        var review = result && result.accepted === false;
        var missing = rewriteRequired(sentence) && !done && (!firstText(state.rewrites[id]) || state.skipped[id]);
        return '<button class="sentence-capsule' + (index === state.activeSentence ? ' is-active' : '') + (done ? ' is-done' : '') + (review ? ' is-review' : '') + (missing ? ' has-gap' : '') + '" type="button" data-sentence-index="' + index + '" aria-label="第 ' + (index + 1) + ' 句' + (missing ? '，尚未完成' : '') + '">' + (index + 1) + '</button>';
    }

    function sentenceCardHtml(sentence, index) {
        var id = sentenceId(sentence, index);
        var required = rewriteRequired(sentence);
        var result = state.rewriteResults[id];
        var accepted = !required || result && result.accepted === true;
        var needsReview = result && result.accepted === false;
        var visibility = coordinateReferenceAndRewrite(state.referenceOpen[id]);
        var referenceOpen = visibility.referenceVisible;
        var issues = safeArray(sentence.issues);
        var status = accepted ? '已完成' : needsReview ? '需要再修改' : required ? '等待改写' : '表达正确';
        return '<article class="sentence-card' + (index === state.activeSentence ? ' is-active' : '') + (accepted ? ' is-accepted' : '') + (needsReview ? ' needs-review' : '') + '" id="sentence-card-' + escapeHtml(id) + '" data-sentence-card="' + escapeHtml(id) + '">' +
            '<div class="sentence-card-header"><span class="sentence-number">SENTENCE ' + (index + 1) + '</span><span class="sentence-status">' + status + '</span></div>' +
            '<p class="original-sentence">' + escapeHtml(sentence.original) + '</p>' +
            (issues.length ? '<div class="issue-list">' + issues.map(function(issue) {
                var issueCopy = [firstText(issue.explanation), firstText(issue.suggestion)].filter(Boolean).join(' · ');
                return '<div class="issue"><b>' + escapeHtml(firstText(issue.category, issue.span, 'LANGUAGE')) + '</b><p>' + escapeHtml(issueCopy) + '</p></div>';
            }).join('') + '</div>' : '') +
            (sentence.coaching_summary ? '<p class="coaching-summary">' + escapeHtml(sentence.coaching_summary) + '</p>' : '') +
            (required ? (visibility.rewriteInputHidden ? '<div class="reference-panel"><small>AI 参考修改</small><p>' + escapeHtml(sentence.reference_revision) + '</p></div>' :
                '<div class="rewrite-area"><label for="rewrite-' + escapeHtml(id) + '">你的改写</label><textarea class="rewrite-input" id="rewrite-' + escapeHtml(id) + '" data-rewrite-id="' + escapeHtml(id) + '" placeholder="不要照抄，按自己的理解重写这句话…" ' + (accepted || state.readOnly ? 'disabled' : '') + '>' + escapeHtml(state.rewrites[id]) + '</textarea></div>') : '') +
            (result ? '<p class="sentence-feedback ' + (result.accepted ? 'accepted' : '') + '">' + escapeHtml(firstText(result.feedback, result.next_step, result.accepted ? '这句话已经修复。' : '请根据反馈再修改一次。')) + '</p>' : '') +
            (required ? '<div class="sentence-actions">' +
                (!state.readOnly && !accepted ? '<button class="quiet-button" type="button" data-toggle-reference="' + escapeHtml(id) + '" aria-expanded="' + referenceOpen + '">' + (referenceOpen ? '隐藏参考，开始重写' : '查看参考句') + '</button>' : '<span></span>') +
                (!state.readOnly && state.layout === 'sequential' ? '<button class="secondary-button compact" type="button" data-next-sentence="' + index + '">' + (index === safeArray(state.review.sentences).length - 1 ? '回到未完成' : '下一句') + icon('arrow') + '</button>' : '') + '</div>' : '') +
            '</article>';
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
            state.layout = 'sequential';
            setStatus('还有句子没有完成。已带你回到第一个未完成的位置。');
            renderLanguage();
            return;
        }
        var pending = required.filter(function(sentence, index) {
            var result = state.rewriteResults[sentenceId(sentence, index)];
            return !(result && result.accepted === true);
        });
        if (!pending.length) { renderCompletion(); return; }
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
        writingCall('submitRewrites', {
            composition_id: compositionId(state.current),
            operation_id: logicalOperationId('rewrites', rewriteFingerprint),
            items: submittedItems
        }).then(function(result) {
            clearLogicalOperation('rewrites');
            safeArray(result.results).forEach(function(item) {
                var id = firstText(item.sentence_id, item.id);
                if (id) {
                    state.rewriteResults[id] = Object.assign({}, item, {
                        student_rewrite: firstText(item.student_rewrite, state.rewrites[id])
                    });
                }
            });
            if (state.current) {
                state.current.rewrite_results = {
                    results: Object.keys(state.rewriteResults).map(function(id) { return state.rewriteResults[id]; }),
                    passed: safeArray(result.results).every(function(item) { return item.accepted === true; })
                };
            }
            if (result.composition) state.current = result.composition;
            var rejected = safeArray(result.results).filter(function(item) { return item.accepted !== true; });
            if (!rejected.length) {
                if (state.current) state.current.status = 'completed';
                syncCurrentSummary();
                renderCompletion();
            } else {
                state.correctionRound += 1;
                state.activeSentence = Math.max(0, sentences.findIndex(function(sentence, index) {
                    var answer = state.rewriteResults[sentenceId(sentence, index)];
                    return answer && answer.accepted === false;
                }));
                state.layout = 'sequential';
                renderLanguage();
                setStatus('统一检查完成：只需要再处理标记为“需要再修改”的句子。');
            }
            refreshPortfolio().catch(function() {});
        }).catch(function(error) {
            if (error && error.result) clearLogicalOperation('rewrites');
            renderFatalAction(error);
        }).finally(function() { setBusy(false); });
    }

    function renderCompletion() {
        state.screen = 'completed';
        mobileContext.textContent = '训练完成';
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
            state.review = review;
            state.assessmentMode = compositionMode(composition);
            state.readOnly = forceReadOnly !== false && compositionStatus(composition) === 'completed';
            state.confirmedText = firstText(composition.confirmed_text, composition.full_text);
            if (composition.ocr_job && composition.ocr_job.status === 'processing') {
                renderLoading('照片已收到，正在识别文字…', '页面会自动查询云端结果，请稍候。');
                return waitForOcrResult(composition.ocr_job.operation_id).then(function(waited) {
                    state.current = waited.composition || composition;
                    state.ocr = waited.ocr || {};
                    state.confirmedText = firstText(state.ocr.full_text, safeArray(state.ocr.paragraphs).join('\n\n'));
                    renderOcr();
                    syncCurrentSummary();
                });
            }
            if (composition.pending_ocr) {
                state.ocr = composition.pending_ocr;
                state.confirmedText = firstText(state.ocr.full_text, safeArray(state.ocr.paragraphs).join('\n\n'));
                renderOcr();
                syncCurrentSummary();
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

    function openSidebar() {
        state.sidebarOpen = true;
        portfolioSidebar.classList.add('is-open');
        sidebarScrim.hidden = false;
        portfolioToggle.setAttribute('aria-expanded', 'true');
        document.documentElement.style.overflow = 'hidden';
    }

    function closeSidebar() {
        state.sidebarOpen = false;
        portfolioSidebar.classList.remove('is-open');
        sidebarScrim.hidden = true;
        portfolioToggle.setAttribute('aria-expanded', 'false');
        document.documentElement.style.overflow = '';
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
        if (event.target.id !== 'writing-source-form') return;
        event.preventDefault();
        submitSource();
    });

    document.addEventListener('click', function(event) {
        var button = event.target.closest('button,[data-open-composition]');
        if (!button) return;
        if (button.matches('[data-start-new]')) createNewWriting();
        else if (button.matches('[data-return-home]')) { setStatus(''); state.current = null; state.review = null; renderPortfolio(); renderWelcome(); }
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
        else if (button.matches('[data-reupload]')) beginReplacement('photo');
        else if (button.matches('[data-edit-current]')) beginReplacement('text');
        else if (button.matches('[data-enter-language]')) enterLanguage();
        else if (button.matches('[data-layout]')) { state.layout = button.getAttribute('data-layout'); renderLanguage(); }
        else if (button.matches('[data-sentence-index]')) {
            state.activeSentence = Number(button.getAttribute('data-sentence-index')) || 0;
            if (state.layout === 'sequential') renderLanguage();
            else {
                Array.prototype.forEach.call(document.querySelectorAll('.sentence-capsule'), function(item) { item.classList.toggle('is-active', item === button); });
                var card = document.querySelectorAll('[data-sentence-card]')[state.activeSentence];
                if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        }
        else if (button.matches('[data-next-sentence]')) {
            var sentences = safeArray(state.review && state.review.sentences);
            var index = Number(button.getAttribute('data-next-sentence')) || 0;
            var sentence = sentences[index];
            var id = sentenceId(sentence, index);
            if (rewriteRequired(sentence) && !firstText(state.rewrites[id])) state.skipped[id] = true;
            var next = index + 1;
            if (next >= sentences.length) {
                next = sentences.findIndex(function(item, itemIndex) {
                    var itemId = sentenceId(item, itemIndex);
                    return rewriteRequired(item) && !firstText(state.rewrites[itemId]);
                });
                if (next < 0) next = 0;
            }
            state.activeSentence = next;
            renderLanguage();
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
    window.addEventListener('keydown', function(event) { if (event.key === 'Escape' && state.sidebarOpen) closeSidebar(); });

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
