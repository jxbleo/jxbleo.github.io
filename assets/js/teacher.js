(function() {
    'use strict';

    var MATRIX_DENSITY_STORAGE_KEY = 'mrcat.teacher.matrix-density.v1';
    var MATRIX_DENSITY_TASK_WIDTHS = [31, 56, 72, 92, 112, 132];
    var TEACHER_HISTORY_STATE_KEY = 'mrcatTeacherWorkspace';
    var TEACHER_HISTORY_STATE_VERSION = 1;
    var TEACHER_SESSION_RETURN_KEY = 'mrcat.teacher.return-state.v1';
    var TEACHER_CACHE_DB_NAME = 'mrcat-private-cache';
    var TEACHER_CACHE_STORE_NAME = 'teacher-workspaces';
    var TEACHER_CACHE_SCHEMA_VERSION = 1;
    var TEACHER_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
    var TEACHER_PROGRESS_REFRESH_MS = 2 * 60 * 1000;
    var TEACHER_RETURN_REFRESH_AGE_MS = 30 * 1000;
    var NOTIFICATION_FEED_PAGE_SIZE = 10;
    var DISPUTE_FEED_PAGE_SIZE = 5;
    var NOTIFICATION_DETAIL_CONCURRENCY = 2;
    var teacherCacheDbPromise = null;
    var teacherLiveRefreshPromise = null;
    var teacherLiveDataLoadedAt = 0;
    var teacherRefreshTimer = 0;
    var attemptDetailPromises = {};
    var notificationThreadPromises = {};
    var notificationDetailQueue = [];
    var notificationDetailActive = 0;
    var pendingTeacherViewportSnapshot = null;
    var restoredTeacherWorkspaceView = '';

    function readMatrixDensityPreference() {
        // A desktop density can make the sticky student column consume most of
        // a phone viewport. Phones always enter the automatic Fit layout; a
        // manual phone adjustment still lives in state/history for that visit.
        if (matrixUsesPhoneLayout()) return null;
        try {
            var stored = window.localStorage.getItem(MATRIX_DENSITY_STORAGE_KEY);
            if (stored == null || stored === '') return null;
            var value = Number(stored);
            return Number.isInteger(value) && value >= 0 && value < MATRIX_DENSITY_TASK_WIDTHS.length
                ? value
                : null;
        } catch (error) {
            return null;
        }
    }

    function saveMatrixDensityPreference(value) {
        if (matrixUsesPhoneLayout()) return;
        try {
            window.localStorage.setItem(MATRIX_DENSITY_STORAGE_KEY, String(value));
        } catch (error) {
            // The matrix still resizes for this session when storage is unavailable.
        }
    }

    var state = {
        profile: null,
        students: [],
        classDirectory: [],
        sets: [],
        assignments: [],
        progressItems: [],
        attempts: [],
        notificationAttemptIds: {},
        disputes: [],
        notificationCursor: 0,
        notificationHasMore: false,
        notificationPageLoading: false,
        notificationFeedReady: false,
        notificationUnreadThreadCount: null,
        disputeCounts: { pending: 0, approved: 0, rejected: 0 },
        disputePages: {
            pending: { cursor: 0, hasMore: false, loading: false, loaded: false },
            approved: { cursor: 0, hasMore: false, loading: false, loaded: false },
            rejected: { cursor: 0, hasMore: false, loading: false, loaded: false }
        },
        candidates: [],
        selectedAssignSetIds: {},
        selectedAssignStudentUids: {},
        assignSetParams: {},
        selectedStudentProfileId: '',
        studentPickerMode: 'choose',
        assignPanels: { sets: false, students: false, options: false },
        taskView: 'assign',
        assignProgressMode: 'student',
        studentProgressView: 'to_do',
        studentInfoEdit: '',
        accountPanelOpen: false,
        teacherEmailSettings: {
            recipients: [],
            limit: 10,
            loaded: false,
            loading: false,
            saving: '',
            draft: '',
            notice: '',
            noticeType: ''
        },
        updatesOpen: false,
        reviewOpen: false,
        starOpen: false,
        starReturnToStudentLookup: false,
        starRequestView: 'pending',
        starRedemptions: { pending_count: 0, pending: [], history: [] },
        dictionaryOpen: false,
        dictionaryCategory: 'missing',
        dictionarySearch: '',
        dictionaryWords: [],
        selectedDictionaryWord: '',
        studentLookupOpen: false,
        studentMetricView: null,
        studentAccountView: null,
        createStudentReturnToLookup: false,
        attemptsSeenAt: null,
        activityReadAllAt: null,
        activityReviewedAttemptIds: [],
        activityReadAllPending: false,
        activityReadAllSuccess: false,
        notificationAttemptId: '',
        notificationAttemptEntering: false,
        notificationAttemptRevealIds: [],
        targetMatrixAttemptId: '',
        disputeFilter: 'pending',
        disputeMerge: false,
        libraryFilter: 'vocabulary',
        libraryBookFilters: {},
        expandedDisputes: {},
        expandedAssignmentSets: {},
        expandedAssignProgress: {},
        expandedAssignProgressGroups: {},
        matrixClassFilter: '',
        matrixColumnFilter: '',
        matrixDateFilter: 'all',
        matrixDensityStep: readMatrixDensityPreference(),
        selectedMatrixCell: '',
        selectedMatrixStudentKey: '',
        matrixStudentProgressSelections: {},
        matrixStudentProgressMonths: {},
        selectedMatrixReviewAttemptId: '',
        selectedProgressDetailKey: '',
        matrixInitialRevealPending: true,
        assignmentEditScopes: {},
        expandedDisputeMerges: {}
    };

    function teacherCacheIdentity(profile) {
        return String(profile && profile.student_id || '').trim();
    }

    function teacherCacheRecordId(profile) {
        var identity = teacherCacheIdentity(profile);
        return identity ? 'teacher:' + identity : '';
    }

    function openTeacherCacheDb() {
        if (teacherCacheDbPromise) return teacherCacheDbPromise;
        teacherCacheDbPromise = new Promise(function(resolve) {
            if (!window.indexedDB) {
                resolve(null);
                return;
            }
            var request;
            try {
                request = window.indexedDB.open(TEACHER_CACHE_DB_NAME, 1);
            } catch (error) {
                resolve(null);
                return;
            }
            request.onupgradeneeded = function() {
                var db = request.result;
                if (!db.objectStoreNames.contains(TEACHER_CACHE_STORE_NAME)) {
                    db.createObjectStore(TEACHER_CACHE_STORE_NAME, { keyPath: 'id' });
                }
            };
            request.onsuccess = function() { resolve(request.result); };
            request.onerror = function() { resolve(null); };
            request.onblocked = function() { resolve(null); };
        });
        return teacherCacheDbPromise;
    }

    function readTeacherWorkspaceCache(profile) {
        var id = teacherCacheRecordId(profile);
        if (!id) return Promise.resolve(null);
        return openTeacherCacheDb().then(function(db) {
            if (!db) return null;
            return new Promise(function(resolve) {
                var transaction;
                try {
                    transaction = db.transaction(TEACHER_CACHE_STORE_NAME, 'readonly');
                } catch (error) {
                    resolve(null);
                    return;
                }
                var request = transaction.objectStore(TEACHER_CACHE_STORE_NAME).get(id);
                request.onsuccess = function() {
                    var record = request.result || null;
                    if (!record || record.schema_version !== TEACHER_CACHE_SCHEMA_VERSION) {
                        resolve(null);
                        return;
                    }
                    if (!record.saved_at || Date.now() - Number(record.saved_at) > TEACHER_CACHE_MAX_AGE_MS) {
                        resolve(null);
                        return;
                    }
                    resolve(record);
                };
                request.onerror = function() { resolve(null); };
            });
        });
    }

    function redactedTeacherCacheValue(value) {
        var blockedFields = {
            password: true,
            initial_password: true,
            token: true,
            access_token: true,
            refresh_token: true,
            attempts: true,
            answers: true,
            answer: true,
            submitted_answer: true,
            correct_answer: true,
            accepted_answers: true,
            accepted_variants: true,
            answer_snapshot: true,
            explanation: true,
            explanation_snapshot: true,
            grading_key: true,
            grading_keys: true,
            question_results: true
        };
        if (Array.isArray(value)) return value.map(redactedTeacherCacheValue);
        if (!value || typeof value !== 'object' || value instanceof Date) return value;
        return Object.keys(value).reduce(function(result, key) {
            if (!blockedFields[String(key).toLowerCase()]) {
                result[key] = redactedTeacherCacheValue(value[key]);
            }
            return result;
        }, {});
    }

    function sanitizedProgressForTeacherCache(item) {
        var cached = redactedTeacherCacheValue(item || {});
        cached.attempts = [];
        return cached;
    }

    function writeTeacherWorkspaceCache() {
        var id = teacherCacheRecordId(state.profile);
        if (!id || !teacherLiveDataLoadedAt) return Promise.resolve(false);
        var record = {
            id: id,
            schema_version: TEACHER_CACHE_SCHEMA_VERSION,
            saved_at: Date.now(),
            students: (state.students || []).map(redactedTeacherCacheValue),
            classes: (state.classDirectory || []).map(redactedTeacherCacheValue),
            sets: (state.sets || []).map(redactedTeacherCacheValue),
            assignments: (state.assignments || []).map(redactedTeacherCacheValue),
            progress: (state.progressItems || []).map(sanitizedProgressForTeacherCache)
        };
        return openTeacherCacheDb().then(function(db) {
            if (!db) return false;
            return new Promise(function(resolve) {
                var transaction;
                try {
                    transaction = db.transaction(TEACHER_CACHE_STORE_NAME, 'readwrite');
                    transaction.objectStore(TEACHER_CACHE_STORE_NAME).put(record);
                } catch (error) {
                    resolve(false);
                    return;
                }
                transaction.oncomplete = function() { resolve(true); };
                transaction.onerror = function() { resolve(false); };
                transaction.onabort = function() { resolve(false); };
            });
        });
    }

    function clearTeacherWorkspaceCache(profile) {
        var id = teacherCacheRecordId(profile || state.profile);
        try { window.sessionStorage.removeItem(TEACHER_SESSION_RETURN_KEY); } catch (error) {}
        if (!id) return Promise.resolve(false);
        return openTeacherCacheDb().then(function(db) {
            if (!db) return false;
            return new Promise(function(resolve) {
                var transaction;
                try {
                    transaction = db.transaction(TEACHER_CACHE_STORE_NAME, 'readwrite');
                    transaction.objectStore(TEACHER_CACHE_STORE_NAME).delete(id);
                } catch (error) {
                    resolve(false);
                    return;
                }
                transaction.oncomplete = function() { resolve(true); };
                transaction.onerror = function() { resolve(false); };
                transaction.onabort = function() { resolve(false); };
            });
        });
    }
    var teacherViews = ['tasks', 'view', 'library'];
    var motivationalQuotes = [
        'Small steps every day create remarkable progress.',
        'Your effort today is building your confidence tomorrow.',
        'Progress matters more than perfection.',
        'Every question you try makes you stronger.',
        'Stay curious. That is where learning begins.',
        'A difficult task is a chance to grow.',
        'You do not have to be perfect to improve.',
        'Consistency turns practice into progress.',
        'One focused session can change your whole day.',
        'Mistakes are proof that you are learning.',
        'Keep going. Your future self will thank you.',
        'The more you practise, the more possible things become.',
        'A little courage can begin a lot of progress.',
        'Today is another chance to surprise yourself.',
        'Strong results begin with one honest attempt.',
        'Learning gets easier when showing up becomes a habit.',
        'Your pace is valid. Keep moving forward.',
        'Focus on the next step, not the whole staircase.',
        'Every retry carries something you learned before.',
        'You are capable of more than one difficult moment suggests.',
        'Make today count, one question at a time.',
        'Confidence grows each time you choose to continue.',
        'The work you repeat becomes the skill you keep.',
        'Be patient with yourself and serious about your goals.',
        'Start where you are and improve from there.',
        'A calm mind and steady effort can go a long way.',
        'Your best learning happens when you keep asking why.',
        'Challenges are part of becoming more capable.',
        'Give this moment your attention and let progress follow.',
        'There is always something valuable in another attempt.'
    ];
    var teacherModalRoot = document.getElementById('teacher-modal-root');

    function mountStaticTeacherModals() {
        if (!teacherModalRoot) return;
        document.querySelectorAll('[data-teacher-modal]').forEach(function(modal) {
            if (modal.parentElement !== teacherModalRoot) teacherModalRoot.appendChild(modal);
        });
    }

    function clearTeacherMatrixModals() {
        if (!teacherModalRoot) return;
        teacherModalRoot.querySelectorAll('.progress-matrix-modal-backdrop[data-matrix-close]').forEach(function(modal) {
            modal.remove();
        });
    }

    function mountTeacherMatrixModals(container) {
        if (!teacherModalRoot || !container) return;
        container.querySelectorAll('.progress-matrix-modal-backdrop[data-matrix-close]').forEach(function(modal) {
            teacherModalRoot.appendChild(modal);
        });
    }

    mountStaticTeacherModals();

    var teacherModalScrollState = null;

    function teacherModalDialogIsVisible(dialog) {
        var node = dialog;
        while (node && node !== document.documentElement) {
            if (node.hidden || node.getAttribute('aria-hidden') === 'true') return false;
            node = node.parentElement;
        }
        return true;
    }

    function teacherHasOpenModal() {
        return Array.prototype.some.call(
            document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
            teacherModalDialogIsVisible
        );
    }

    function lockTeacherModalBackground() {
        if (teacherModalScrollState) return;
        var body = document.body;
        var root = document.documentElement;
        teacherModalScrollState = {
            x: window.scrollX || 0,
            y: window.scrollY || 0,
            bodyPosition: body.style.position,
            bodyTop: body.style.top,
            bodyLeft: body.style.left,
            bodyRight: body.style.right,
            bodyWidth: body.style.width,
            bodyOverflow: body.style.overflow,
            rootOverflow: root.style.overflow,
            rootOverscrollBehavior: root.style.overscrollBehavior
        };
        root.classList.add('teacher-modal-scroll-locked');
        root.style.overflow = 'hidden';
        root.style.overscrollBehavior = 'none';
        body.style.position = 'fixed';
        body.style.top = (-teacherModalScrollState.y) + 'px';
        body.style.left = (-teacherModalScrollState.x) + 'px';
        body.style.right = '0';
        body.style.width = '100%';
        body.style.overflow = 'hidden';
    }

    function unlockTeacherModalBackground(restorePosition) {
        if (!teacherModalScrollState) return;
        var stateToRestore = teacherModalScrollState;
        var body = document.body;
        var root = document.documentElement;
        teacherModalScrollState = null;
        root.classList.remove('teacher-modal-scroll-locked');
        root.style.overflow = stateToRestore.rootOverflow;
        root.style.overscrollBehavior = stateToRestore.rootOverscrollBehavior;
        body.style.position = stateToRestore.bodyPosition;
        body.style.top = stateToRestore.bodyTop;
        body.style.left = stateToRestore.bodyLeft;
        body.style.right = stateToRestore.bodyRight;
        body.style.width = stateToRestore.bodyWidth;
        body.style.overflow = stateToRestore.bodyOverflow;
        if (restorePosition !== false) window.scrollTo(stateToRestore.x, stateToRestore.y);
    }

    function syncTeacherModalBackgroundLock() {
        if (teacherHasOpenModal()) lockTeacherModalBackground();
        else unlockTeacherModalBackground(true);
    }

    var teacherModalScrollObserver = new MutationObserver(syncTeacherModalBackgroundLock);
    teacherModalScrollObserver.observe(document.body, {
        subtree: true,
        childList: true,
        attributes: true,
        attributeFilter: ['hidden', 'aria-hidden']
    });
    syncTeacherModalBackgroundLock();
    window.addEventListener('pagehide', function() {
        unlockTeacherModalBackground(false);
    });
    window.addEventListener('pageshow', function() {
        syncTeacherModalBackgroundLock();
    });

    var message = document.getElementById('teacher-message');
    var studentList = document.getElementById('student-list');
    var studentDetail = document.getElementById('student-detail');
    var studentForm = document.getElementById('student-form');
    var candidateList = document.getElementById('assign-candidates');
    var libraryList = document.getElementById('teacher-library-list');
    var updatesPanel = document.getElementById('teacher-updates-panel');
    var updatesBody = document.getElementById('teacher-updates-body');
    var notificationAttemptRoot = document.getElementById('teacher-notification-attempt-root');
    var teacherAccountPanel = document.getElementById('teacher-account-panel');
    var teacherAccountContent = document.getElementById('teacher-account-content');
    var teacherStarPanel = document.getElementById('teacher-star-panel');
    var teacherStarList = document.getElementById('teacher-star-list');

    var questionTextCache = {};

    function sameId(a, b) {
        return String(a == null ? '' : a) === String(b == null ? '' : b);
    }

    function getQuestionTextFromData(data, questionId) {
        if (!data) return null;
        var i, arr, item;
        arr = data.blanks || [];
        for (i = 0; i < arr.length; i++) {
            if (sameId(arr[i].id, questionId)) return arr[i].sentence || arr[i].question || arr[i].text || arr[i].title;
        }
        arr = data.multipleChoice || [];
        for (i = 0; i < arr.length; i++) {
            if (sameId(arr[i].id, questionId)) return arr[i].question || arr[i].text || arr[i].sentence;
        }
        arr = data.matching || [];
        for (i = 0; i < arr.length; i++) {
            if (sameId(arr[i].id, questionId)) return arr[i].text || arr[i].sentence || arr[i].question || arr[i].title;
            var pairs = arr[i].pairs || [];
            for (var pairIndex = 0; pairIndex < pairs.length; pairIndex++) {
                if (sameId(arr[i].id + '-' + pairIndex, questionId)) {
                    return pairs[pairIndex].left || pairs[pairIndex].text || pairs[pairIndex].question || arr[i].title;
                }
            }
        }
        arr = data.questions || [];
        for (i = 0; i < arr.length; i++) {
            var items = arr[i].items || [];
            for (var j = 0; j < items.length; j++) {
                if (sameId(items[j].id, questionId)) return items[j].text || items[j].sentence || items[j].question || items[j].title;
            }
        }
        arr = data.quizGroups || [];
        for (i = 0; i < arr.length; i++) {
            var questions = arr[i].questions || [];
            for (var k = 0; k < questions.length; k++) {
                item = questions[k];
                if (sameId(item.questionKey || (arr[i].id + ':' + item.number), questionId)) {
                    return item.prompt || item.text || item.question || item.sentence;
                }
            }
        }
        return null;
    }

    function getQuestionText(item) {
        return item.question_text_snapshot ||
            getQuestionTextFromData(questionTextCache[item.set_id], item.question_id) ||
            '';
    }

    function loadQuestionTextForRecords(records) {
        var setIds = {};
        (records || []).forEach(function(record) {
            if (record.set_id) setIds[record.set_id] = true;
        });
        var keys = Object.keys(setIds);
        if (!keys.length) return Promise.resolve();
        var promises = keys.map(function(setId) {
            if (questionTextCache[setId] !== undefined) return null;
            return fetch('data/' + setId + '.json')
                .then(function(r) {
                    if (r.ok) return r.json();
                    return fetch('content/vocabulary/' + setId + '.json')
                        .then(function(vocabResponse) { return vocabResponse.ok ? vocabResponse.json() : null; });
                })
                .then(function(data) { questionTextCache[setId] = data; })
                .catch(function() { questionTextCache[setId] = null; });
        }).filter(Boolean);
        return Promise.all(promises);
    }

    function loadQuestionTextForDisputes() {
        return loadQuestionTextForRecords(state.disputes || []);
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function appVersion() {
        return window.MRCAT_CONFIG && window.MRCAT_CONFIG.appVersion || '1';
    }

    function appendQueryParam(href, key, value) {
        if (!href || href === '#' || value == null || value === '') return href || '#';
        return href + (href.indexOf('?') === -1 ? '?' : '&') + encodeURIComponent(key) + '=' + encodeURIComponent(value);
    }

    function removeQueryParam(href, key) {
        var hashIndex = href.indexOf('#');
        var hash = hashIndex === -1 ? '' : href.slice(hashIndex);
        var baseAndQuery = hashIndex === -1 ? href : href.slice(0, hashIndex);
        var queryIndex = baseAndQuery.indexOf('?');
        if (queryIndex === -1) return href;
        var base = baseAndQuery.slice(0, queryIndex);
        var query = baseAndQuery.slice(queryIndex + 1).split('&').filter(function(part) {
            return part && decodeURIComponent(part.split('=')[0]) !== key;
        }).join('&');
        return base + (query ? '?' + query : '') + hash;
    }

    function withReturnParam(href, returnUrl) {
        if (!href || href === '#') return href || '#';
        var cleanHref = removeQueryParam(href, 'return');
        return appendQueryParam(cleanHref, 'return', returnUrl || 'teacher.html?view=library');
    }

    function vocabularySourceKey(item) {
        var raw = [
            item && item.sourceName,
            item && item.source_name,
            item && item.set_id,
            item && item.id,
            item && item.title,
            item && item.topic,
            item && item.course,
            item && item.type,
            item && item.section,
            item && item.sectionId,
            item && item.section_id
        ].join(' ').toUpperCase();
        if (/(^|\s|-)NGSL(?:\s|-|$)/.test(raw)) return 'ngsl';
        if (/(^|\s|-)NAWL(?:\s|-|$)/.test(raw)) return 'nawl';
        if (/THINK\s*2|THINK2|TK2/.test(raw)) return 'tk2';
        if (/OXFORD\s*5000|OXFORD5000/.test(raw)) return 'oxford5000';
        return '';
    }

    function vocabularySourceLabel(item) {
        var labels = {
            ngsl: 'NGSL',
            nawl: 'NAWL',
            tk2: 'TK2',
            oxford5000: 'Oxford5000'
        };
        return labels[vocabularySourceKey(item)] || '';
    }

    function vocabularyLibraryUsesNumberRange(item) {
        var source = vocabularySourceKey(item);
        return source === 'ngsl' || source === 'nawl' || source === 'oxford5000';
    }

    function vocabularyRangeNumberLabel(number) {
        return number < 1000 ? String(number).padStart(3, '0') : String(number);
    }

    function vocabularyLibraryRangeFromId(item) {
        var source = vocabularySourceKey(item);
        var identity = String(item && (item.set_id || item.id || item.title) || '');
        var match = identity.match(/-([A-Z])\b/i);
        if (!match) return '';
        var index = match[1].toUpperCase().charCodeAt(0) - 64;
        if (index < 1 || index > 26) return '';
        var start = (source === 'ngsl' ? 1001 : 1) + ((index - 1) * 100);
        var end = start + 99;
        if (source === 'nawl' && index === 10) end = 963;
        return vocabularyRangeNumberLabel(start) + '-' + vocabularyRangeNumberLabel(end);
    }

    function vocabularyLibraryRangeLabel(item) {
        if (!vocabularyLibraryUsesNumberRange(item)) return '';
        var displayValue = String(item && item.displayValue || '').trim();
        var rangeMatch = displayValue.match(/(\d{1,4})\s*[-–]\s*(\d{1,4})/);
        return rangeMatch ? rangeMatch[1] + '-' + rangeMatch[2] : vocabularyLibraryRangeFromId(item) || displayValue;
    }

    function vocabularyLibrarySectionLabel(item) {
        return vocabularyLibraryUsesNumberRange(item) ? 'vocabulary' : vocabularySourceLabel(item);
    }

    function isVocabularyCategory(category) {
        return category === 'ngsl' || category === 'nawl' || category === 'tk2' || category === 'oxford5000';
    }

    function systemLogoPath(value) {
        var system = String(value || '').trim().toUpperCase();
        if (system === 'DSE') return 'assets/logos/dse-logo.png';
        if (system === 'IELTS') return 'assets/logos/ielts-logo.png';
        return '';
    }

    function renderSystemTag(value, emptyLabel) {
        var label = String(value || '').trim();
        if (!label) return escapeHtml(emptyLabel || 'Not set');
        var logo = systemLogoPath(label);
        return '<span class="system-tag' + (logo ? ' has-logo' : '') + '">' +
            (logo ? '<img src="' + escapeHtml(logo) + '" alt="" loading="lazy">' : '') +
            '<span>' + escapeHtml(label) + '</span></span>';
    }

    function studentMetaHtml(student) {
        return '<span class="student-meta">' +
            '<span>' + escapeHtml(student.student_id || 'No Login ID') + '</span>' +
            '<span>' + escapeHtml(student.class_group || 'No class') + '</span>' +
            (student.curriculum_track ? renderSystemTag(student.curriculum_track, '') : '') +
        '</span>';
    }

    function studentChineseName(student) {
        return String(student && student.chinese_name || '').trim();
    }

    function studentEnglishName(student) {
        return String(student && student.english_name || '').trim();
    }

    function joinedStudentName(chineseName, englishName, legacyName) {
        var chinese = String(chineseName || '').trim();
        var english = String(englishName || '').trim();
        if (chinese && english) return chinese + english;
        return chinese || english || String(legacyName || '').trim();
    }

    function studentDisplayName(student) {
        return joinedStudentName(
            studentChineseName(student),
            studentEnglishName(student),
            student && (student.name || student.student_id) || 'Student'
        );
    }

    function studentSearchText(student) {
        return [
            studentDisplayName(student),
            student && student.name,
            studentChineseName(student),
            studentEnglishName(student),
            student && student.student_id,
            student && student.class_group,
            student && student.curriculum_track
        ].filter(Boolean).join(' ').toLowerCase();
    }

    function showMessage(text, type) {
        message.textContent = text || '';
        message.className = 'teacher-message' + (type ? ' ' + type : '');
    }

    function pendingReviewCount() {
        if (state.disputeCounts && Number.isFinite(Number(state.disputeCounts.pending))) {
            return Number(state.disputeCounts.pending || 0);
        }
        return (state.disputes || []).filter(function(item) {
            return item.status !== 'approved' && item.status !== 'rejected';
        }).length;
    }

    function sortedAttempts() {
        return (state.attempts || []).filter(function(attempt) {
            return attempt && state.notificationAttemptIds[String(attempt.attempt_id || '')] === true;
        }).sort(function(a, b) {
            return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
        });
    }

    function reviewedAttemptIdMap() {
        return (state.activityReviewedAttemptIds || []).reduce(function(map, id) {
            if (id) map[String(id)] = true;
            return map;
        }, {});
    }

    function isAttemptReviewUnread(attempt) {
        var attemptId = attempt && attempt.attempt_id;
        if (!attemptId) return false;
        if (reviewedAttemptIdMap()[String(attemptId)] === true) return false;
        var readAllAt = state.activityReadAllAt ? new Date(state.activityReadAllAt) : null;
        var submittedAt = attempt.submitted_at ? new Date(attempt.submitted_at) : null;
        if (readAllAt && !isNaN(readAllAt.getTime()) && submittedAt && !isNaN(submittedAt.getTime())) {
            return submittedAt.getTime() > readAllAt.getTime();
        }
        return true;
    }

    function attemptThreadKey(attempt) {
        var studentKey = attempt.student_uid || attempt.student_id || 'unknown-student';
        if (attempt.assignment_id) {
            return studentKey + '::assignment::' + String(attempt.assignment_id);
        }
        return studentKey + '::self-study::' + String(attempt.set_id || 'unknown-set');
    }

    function groupedAttemptThreads() {
        var byKey = {};
        var groups = [];
        sortedAttempts().forEach(function(attempt) {
            var key = attemptThreadKey(attempt);
            var group = byKey[key];
            if (!group) {
                group = {
                    key: key,
                    attempts: [],
                    unread: false
                };
                byKey[key] = group;
                groups.push(group);
            }
            group.attempts.push(attempt);
            if (isAttemptReviewUnread(attempt)) group.unread = true;
        });
        return groups;
    }

    function activityAttemptCounts() {
        return groupedAttemptThreads().reduce(function(counts, group) {
            counts.total += 1;
            if (group.unread) counts.unread += 1;
            else counts.read += 1;
            return counts;
        }, { total: 0, unread: 0, read: 0 });
    }

    function updateActivityBadges() {
        var attemptCounts = activityAttemptCounts();
        var unreadCount = state.notificationUnreadThreadCount == null
            ? attemptCounts.unread
            : Number(state.notificationUnreadThreadCount || 0);
        var count = document.getElementById('teacher-updates-count');
        var button = document.getElementById('teacher-updates-button');
        if (count) {
            count.textContent = unreadCount ? String(unreadCount) : '';
            count.hidden = unreadCount <= 0;
        }
        if (button) button.classList.toggle('has-updates', unreadCount > 0);
    }

    function updateTopBadges() {
        var count = pendingReviewCount();
        var reviewButton = document.getElementById('teacher-review-button');
        var reviewCount = document.getElementById('teacher-review-count');
        if (reviewCount) {
            reviewCount.textContent = count ? String(count) : '';
            reviewCount.hidden = count <= 0;
        }
        if (reviewButton) reviewButton.classList.toggle('has-updates', count > 0);
        var starCount = Number(state.starRedemptions && state.starRedemptions.pending_count || 0);
        var starButton = document.getElementById('teacher-star-button');
        var starBadge = document.getElementById('teacher-star-count');
        if (starBadge) {
            starBadge.textContent = starCount ? String(starCount) : '';
            starBadge.hidden = starCount <= 0;
        }
        if (starButton) starButton.classList.toggle('has-updates', starCount > 0);
        updateActivityBadges();
    }

    function updateAssignView() {
        document.querySelectorAll('[data-task-view]').forEach(function(button) {
            button.classList.toggle('active', button.dataset.taskView === state.taskView);
        });
        var assignPanel = document.getElementById('task-assign-panel');
        if (assignPanel) assignPanel.hidden = false;
        updateTopBadges();
    }

    function teacherEmailRowsHtml() {
        var settings = state.teacherEmailSettings;
        if ((settings.loading && !settings.loaded) || !settings.recipients.length) return '';
        return settings.recipients.map(function(recipient) {
            var enabled = recipient.enabled === true;
            var busy = Boolean(settings.saving || settings.loading);
            return '<div class="teacher-email-row">' +
                '<div class="teacher-email-address"><strong>' + escapeHtml(recipient.email) + '</strong></div>' +
                '<button class="teacher-email-switch' + (enabled ? ' is-enabled' : '') + '" type="button" role="switch" aria-checked="' + (enabled ? 'true' : 'false') + '" aria-label="' + (enabled ? 'Disable ' : 'Enable ') + escapeHtml(recipient.email) + '" data-teacher-email-toggle="' + escapeHtml(recipient.email_id) + '"' + (busy ? ' disabled' : '') + '><span aria-hidden="true"></span></button>' +
            '</div>';
        }).join('');
    }

    function applyTeacherEmailSettings(result) {
        var settings = state.teacherEmailSettings;
        settings.recipients = result.recipients || [];
        settings.limit = Number(result.limit || 10);
        settings.loaded = true;
        settings.loading = false;
        settings.saving = '';
    }

    function loadTeacherEmailSettings(force) {
        var settings = state.teacherEmailSettings;
        if (settings.loading || (settings.loaded && force !== true)) return Promise.resolve();
        settings.loading = true;
        renderTeacherAccount();
        return teacherCall('getTeacherEmailSettings').then(function(result) {
            applyTeacherEmailSettings(result);
            settings.notice = '';
            settings.noticeType = '';
        }).catch(function(error) {
            settings.loading = false;
            settings.notice = error.message;
            settings.noticeType = 'error';
        }).then(renderTeacherAccount);
    }

    function saveTeacherEmailSetting(action, data, savingKey) {
        var settings = state.teacherEmailSettings;
        if (settings.saving) return;
        settings.saving = savingKey;
        settings.notice = '';
        settings.noticeType = '';
        renderTeacherAccount();
        teacherCall(action, data).then(function(result) {
            applyTeacherEmailSettings(result);
            settings.draft = '';
            settings.notice = '';
            settings.noticeType = '';
        }).catch(function(error) {
            settings.saving = '';
            settings.notice = error.message;
            settings.noticeType = 'error';
        }).then(renderTeacherAccount);
    }

    function bindTeacherEmailControls() {
        var settings = state.teacherEmailSettings;
        var form = document.getElementById('teacher-email-form');
        var input = document.getElementById('teacher-email-input');
        if (input) input.addEventListener('input', function() { settings.draft = input.value; });
        if (form) form.addEventListener('submit', function(event) {
            event.preventDefault();
            if (!input || !input.reportValidity()) return;
            settings.draft = input.value.trim();
            saveTeacherEmailSetting('addTeacherEmail', { email: settings.draft, enabled: true }, 'new');
        });
        teacherAccountContent.querySelectorAll('[data-teacher-email-toggle]').forEach(function(button) {
            button.addEventListener('click', function() {
                var emailId = button.dataset.teacherEmailToggle;
                var recipient = settings.recipients.find(function(item) { return item.email_id === emailId; });
                if (!recipient) return;
                saveTeacherEmailSetting('setTeacherEmailEnabled', {
                    email_id: emailId,
                    enabled: recipient.enabled !== true
                }, emailId);
            });
        });
    }

    function renderTeacherAccount() {
        if (!teacherAccountContent) return;
        var profile = state.profile || {};
        var settings = state.teacherEmailSettings;
        var addDisabled = settings.loading || settings.saving || settings.recipients.length >= settings.limit;
        var emailNotice = settings.notice
            ? '<p class="teacher-email-notice ' + escapeHtml(settings.noticeType) + '" aria-live="polite">' + escapeHtml(settings.notice) + '</p>'
            : '';
        teacherAccountContent.innerHTML =
            '<div class="profile-grid">' +
                '<section class="profile-card">' +
                    '<h2>' + escapeHtml(profile.name || profile.student_id || 'Teacher') + '</h2>' +
                    '<div class="profile-row"><span>Login ID</span><strong>' + escapeHtml(profile.student_id || 'Not set') + '</strong></div>' +
                    '<div class="profile-row"><span>Role</span><strong>Teacher</strong></div>' +
                    '<div class="profile-actions">' +
                        '<button class="danger-button teacher-logout" id="teacher-logout" type="button">Log Out</button>' +
                    '</div>' +
                '</section>' +
                '<section class="profile-card teacher-email-card">' +
                    '<h2 class="teacher-email-title">EMAIL NOTIFICATIONS</h2>' +
                    '<form class="teacher-email-form" id="teacher-email-form">' +
                        '<label class="sr-only" for="teacher-email-input">Email address</label>' +
                        '<input id="teacher-email-input" type="email" inputmode="email" autocomplete="email" maxlength="254" placeholder="name@example.com" value="' + escapeHtml(settings.draft) + '" required' + (addDisabled ? ' disabled' : '') + '>' +
                        '<button class="primary-button" type="submit"' + (addDisabled ? ' disabled' : '') + '>' + (settings.saving === 'new' ? 'Adding...' : 'Add') + '</button>' +
                    '</form>' +
                    '<div class="teacher-email-list">' + teacherEmailRowsHtml() + '</div>' +
                    emailNotice +
                '</section>' +
            '</div>';
        bindTeacherEmailControls();
        var logout = document.getElementById('teacher-logout');
        if (logout) {
            logout.addEventListener('click', function() {
                logout.disabled = true;
                clearTeacherWorkspaceCache(state.profile).then(function() {
                    return window.MrCatAuth.logout();
                });
            });
        }
    }

    function setTeacherAccountPanel(open) {
        state.accountPanelOpen = open === true;
        if (teacherAccountPanel) teacherAccountPanel.hidden = !state.accountPanelOpen;
        var chip = document.getElementById('teacher-chip');
        if (chip) chip.setAttribute('aria-expanded', state.accountPanelOpen ? 'true' : 'false');
        if (state.accountPanelOpen) {
            setStarRedemptionPanel(false);
            if (state.dictionaryOpen) setDictionaryPanel(false);
            state.studentLookupOpen = false;
            var lookupPanel = document.getElementById('student-lookup-panel');
            var lookupButton = document.getElementById('toggle-create-student');
            if (lookupPanel) lookupPanel.hidden = true;
            if (lookupButton) lookupButton.setAttribute('aria-expanded', 'false');
            state.updatesOpen = false;
            state.notificationAttemptId = '';
            renderUpdatesPanel();
            setReviewPanel(false);
            renderTeacherAccount();
            loadTeacherEmailSettings();
        }
    }

    function setReviewPanel(open) {
        state.reviewOpen = open === true;
        var panel = document.getElementById('teacher-review-panel');
        var button = document.getElementById('teacher-review-button');
        if (panel) panel.hidden = !state.reviewOpen;
        if (button) button.setAttribute('aria-expanded', state.reviewOpen ? 'true' : 'false');
        if (state.reviewOpen) {
            setStarRedemptionPanel(false);
            if (state.dictionaryOpen) setDictionaryPanel(false);
            state.studentLookupOpen = false;
            var lookupPanel = document.getElementById('student-lookup-panel');
            var lookupButton = document.getElementById('toggle-create-student');
            if (lookupPanel) lookupPanel.hidden = true;
            if (lookupButton) lookupButton.setAttribute('aria-expanded', 'false');
            setTeacherAccountPanel(false);
            state.updatesOpen = false;
            state.notificationAttemptId = '';
            renderUpdatesPanel();
            renderDisputes();
            if (!state.disputePages[state.disputeFilter].loaded) {
                loadDisputePage(state.disputeFilter, { reset: true });
            } else {
                loadQuestionTextForDisputes().then(renderDisputes);
            }
        }
        updateTopBadges();
    }

    function starRequestStatus(status) {
        return ({ awaiting_proof: 'Awaiting proof', awaiting_teacher: 'Ready to confirm', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled', expired: 'Expired', refunded: 'Refunded' })[status] || status;
    }

    function starRedemptionCard(request) {
        var pending = request.status === 'awaiting_proof' || request.status === 'awaiting_teacher';
        return '<article class="teacher-star-card" data-star-request-id="' + escapeHtml(request.request_id) + '">' +
            '<header><div><strong>' + escapeHtml(request.student_name || request.student_id || 'Student') + '</strong><span>' + escapeHtml(request.student_id || '') + '</span></div><b>★ ' + escapeHtml(request.star_count) + '</b></header>' +
            '<div class="teacher-star-card-meta"><span>' + escapeHtml(starRequestStatus(request.status)) + '</span><span>' + escapeHtml(formatDateTime(request.created_at)) + '</span><span>' + escapeHtml(request.evidence_count || 0) + ' photo' + (Number(request.evidence_count || 0) === 1 ? '' : 's') + '</span></div>' +
            (request.decision_reason ? '<p class="teacher-star-reason">' + escapeHtml(request.decision_reason) + '</p>' : '') +
            '<div class="teacher-star-actions">' +
                '<button class="text-button" type="button" data-teacher-star-evidence="' + escapeHtml(request.request_id) + '">View proof</button>' +
                (Number(request.evidence_count || 0) < 3 ? '<label class="account-proof-upload">Add photo<input type="file" accept="image/jpeg,image/png,image/webp" data-teacher-star-upload="' + escapeHtml(request.request_id) + '" hidden></label>' : '') +
                (pending && Number(request.evidence_count || 0) > 0 ? '<button class="primary-button" type="button" data-star-confirm="' + escapeHtml(request.request_id) + '">Confirm Cash given</button>' : '') +
                (pending ? '<button class="danger-button" type="button" data-star-reject="' + escapeHtml(request.request_id) + '">Reject</button>' : '') +
                (request.status === 'completed' ? '<button class="text-button danger-text-button" type="button" data-star-refund="' + escapeHtml(request.request_id) + '">Refund STARs</button>' : '') +
            '</div><div class="teacher-star-evidence" id="teacher-star-evidence-' + escapeHtml(request.request_id) + '"></div>' +
        '</article>';
    }

    function renderStarRedemptions() {
        if (!teacherStarList) return;
        var view = state.starRequestView || 'pending';
        var items = state.starRedemptions && state.starRedemptions[view] || [];
        document.querySelectorAll('[data-star-request-view]').forEach(function(button) { button.classList.toggle('active', button.dataset.starRequestView === view); });
        teacherStarList.innerHTML = items.length ? items.map(starRedemptionCard).join('') : '<div class="empty-card"><strong>No ' + (view === 'pending' ? 'pending requests' : 'request history') + '</strong>Cash requests will appear here.</div>';
        bindStarRedemptionActions();
        updateTopBadges();
    }

    function loadStarRedemptions() {
        return teacherCall('listStarRedemptions').then(function(result) {
            state.starRedemptions = result;
            renderStarRedemptions();
            return result;
        }).catch(function(error) {
            state.starRedemptions = { pending_count: 0, pending: [], history: [] };
            if (teacherStarList) teacherStarList.innerHTML = '<div class="empty-card">' + escapeHtml(error.message) + '</div>';
            updateTopBadges();
            return state.starRedemptions;
        });
    }

    function setStarRedemptionPanel(open) {
        var restoreStudentLookup = open !== true && state.starReturnToStudentLookup === true;
        state.starOpen = open === true;
        if (teacherStarPanel) teacherStarPanel.hidden = !state.starOpen;
        var button = document.getElementById('teacher-star-button');
        if (button) button.setAttribute('aria-expanded', state.starOpen ? 'true' : 'false');
        if (!state.starOpen) {
            if (restoreStudentLookup) {
                state.starReturnToStudentLookup = false;
                setStudentLookupPanel(true);
            }
            return;
        }
        state.dictionaryOpen = false;
        var dictionary = document.getElementById('teacher-dictionary-panel');
        if (dictionary) dictionary.hidden = true;
        state.reviewOpen = false;
        var review = document.getElementById('teacher-review-panel');
        if (review) review.hidden = true;
        state.studentLookupOpen = false;
        var lookup = document.getElementById('student-lookup-panel');
        if (lookup) lookup.hidden = true;
        state.updatesOpen = false;
        renderUpdatesPanel();
        state.accountPanelOpen = false;
        if (teacherAccountPanel) teacherAccountPanel.hidden = true;
        renderStarRedemptions();
        loadStarRedemptions();
    }

    function loadTeacherStarEvidence(requestId) {
        var target = document.getElementById('teacher-star-evidence-' + requestId);
        if (!target) return;
        target.innerHTML = '<p class="muted">Loading photos...</p>';
        teacherCall('getStarEvidence', { request_id: requestId }).then(function(result) {
            target.innerHTML = (result.evidence || []).map(function(item) {
                return '<figure class="account-evidence-item ' + (item.status === 'superseded' ? 'is-superseded' : '') + '"><img src="' + escapeHtml(item.url) + '" alt="Cash exchange proof"><figcaption>' + escapeHtml(item.uploader_role === 'teacher' ? 'Teacher' : 'Student') + (item.status === 'superseded' ? ' · Replaced' : '') + '</figcaption>' + (item.status === 'active' ? '<button class="text-button" type="button" data-teacher-evidence-supersede="' + escapeHtml(item.evidence_id) + '">Mark replaced</button>' : '') + '</figure>';
            }).join('') || '<p class="muted">No proof photo yet.</p>';
            target.querySelectorAll('[data-teacher-evidence-supersede]').forEach(function(button) {
                button.addEventListener('click', function() {
                    if (!window.confirm('Keep this photo in history but mark it as replaced?')) return;
                    teacherCall('supersedeStarEvidence', { evidence_id: button.dataset.teacherEvidenceSupersede }).then(function() { return loadStarRedemptions(); }).catch(function(error) { window.alert(error.message); });
                });
            });
        }).catch(function(error) { target.textContent = error.message; });
    }

    function uploadTeacherStarEvidence(requestId, file) {
        return window.MrCatCloud.prepareEvidenceImage(file).then(function(prepared) {
            return teacherCall('beginStarEvidenceUpload', { request_id: requestId, file_name: file.name, mime_type: file.type, size_bytes: file.size }).then(function(start) {
                return Promise.all([
                    window.MrCatCloud.uploadWithMetadata(start.original_upload, prepared.original),
                    window.MrCatCloud.uploadWithMetadata(start.display_upload, prepared.display)
                ]).then(function() { return teacherCall('finishStarEvidenceUpload', { evidence_id: start.evidence_id }); });
            });
        }).then(loadStarRedemptions);
    }

    function bindStarRedemptionActions() {
        teacherStarList.querySelectorAll('[data-teacher-star-evidence]').forEach(function(button) { button.addEventListener('click', function() { loadTeacherStarEvidence(button.dataset.teacherStarEvidence); }); });
        teacherStarList.querySelectorAll('[data-teacher-star-upload]').forEach(function(input) { input.addEventListener('change', function() { if (input.files && input.files[0]) uploadTeacherStarEvidence(input.dataset.teacherStarUpload, input.files[0]).catch(function(error) { window.alert(error.message); }); }); });
        teacherStarList.querySelectorAll('[data-star-confirm]').forEach(function(button) {
            button.addEventListener('click', function() {
                if (!window.confirm('Have you checked the proof and completed the in-person Cash exchange?')) return;
                if (!window.confirm('Final confirmation: mark this request completed and spend the reserved STARs?')) return;
                button.disabled = true;
                teacherCall('confirmStarRedemption', { request_id: button.dataset.starConfirm }).then(loadStarRedemptions).catch(function(error) { window.alert(error.message); button.disabled = false; });
            });
        });
        teacherStarList.querySelectorAll('[data-star-reject]').forEach(function(button) { button.addEventListener('click', function() { var reason = window.prompt('Reason for rejection (required):'); if (reason) teacherCall('rejectStarRedemption', { request_id: button.dataset.starReject, reason: reason }).then(loadStarRedemptions).catch(function(error) { window.alert(error.message); }); }); });
        teacherStarList.querySelectorAll('[data-star-refund]').forEach(function(button) { button.addEventListener('click', function() { var reason = window.prompt('Reason for refund (required):'); if (reason && window.confirm('Refund these STARs to the student?')) teacherCall('refundStarRedemption', { request_id: button.dataset.starRefund, reason: reason }).then(loadStarRedemptions).catch(function(error) { window.alert(error.message); }); }); });
    }

    function setStudentLookupPanel(open) {
        state.studentLookupOpen = open === true;
        if (!state.studentLookupOpen && state.studentMetricView) closeStudentMetricModal();
        if (!state.studentLookupOpen && state.studentAccountView) closeStudentAccountModal();
        var panel = document.getElementById('student-lookup-panel');
        var button = document.getElementById('toggle-create-student');
        if (panel) panel.hidden = !state.studentLookupOpen;
        if (button) button.setAttribute('aria-expanded', state.studentLookupOpen ? 'true' : 'false');
        if (state.studentLookupOpen) {
            setStarRedemptionPanel(false);
            if (state.dictionaryOpen) setDictionaryPanel(false);
            setTeacherAccountPanel(false);
            state.updatesOpen = false;
            state.notificationAttemptId = '';
            renderUpdatesPanel();
            setReviewPanel(false);
            renderStudentList();
            renderStudentDetail();
        } else {
            setStudentPickerOpen(false);
        }
    }

    function restoreStudentLookupAfterCreate() {
        if (!state.createStudentReturnToLookup) return;
        state.createStudentReturnToLookup = false;
        setStudentLookupPanel(true);
        window.setTimeout(function() {
            var createButton = document.getElementById('student-lookup-create');
            if (createButton) createButton.focus();
        }, 0);
    }

    function setCreateStudentModal(open, returnToLookup) {
        var panel = document.getElementById('create-student-panel');
        if (!panel) return;
        panel.hidden = open !== true;
        if (open) {
            state.createStudentReturnToLookup = state.studentLookupOpen === true;
            setCreateStudentSuccessModal(false);
            setStudentLookupPanel(false);
            setTeacherAccountPanel(false);
            state.updatesOpen = false;
            state.notificationAttemptId = '';
            setReviewPanel(false);
            renderUpdatesPanel();
            window.setTimeout(function() {
                var input = document.getElementById('student-id');
                if (input) input.focus();
            }, 0);
        } else if (returnToLookup === true) {
            restoreStudentLookupAfterCreate();
        }
    }

    function setCreateStudentSuccessModal(open, result) {
        var panel = document.getElementById('create-student-success-panel');
        if (!panel) return;
        if (result && result.student) {
            var copy = document.getElementById('create-student-success-copy');
            if (copy) {
                var passwordCopy = result.initial_password ? ' · Initial password: ' + result.initial_password : '';
                copy.textContent = 'Login ID: ' + result.student.student_id + passwordCopy;
            }
        }
        panel.hidden = open !== true;
        if (open) {
            window.setTimeout(function() {
                var closeButton = document.getElementById('create-student-success-close');
                if (closeButton) closeButton.focus();
            }, 0);
        }
    }

    function closeCreateStudentSuccessModal() {
        setCreateStudentSuccessModal(false);
        restoreStudentLookupAfterCreate();
    }

    function setAssignSuccessModal(open, result) {
        var panel = document.getElementById('assign-success-panel');
        if (!panel) return;
        if (result) {
            var created = result.created || [];
            var skipped = result.skipped || [];
            var copy = document.getElementById('assign-success-copy');
            if (copy) {
                var createdLabel = created.length + ' assignment' + (created.length === 1 ? '' : 's') + ' created';
                var skippedLabel = skipped.length
                    ? '; ' + skipped.length + ' skipped because an open assignment already exists.'
                    : '.';
                copy.textContent = createdLabel + skippedLabel;
            }
        }
        panel.hidden = open !== true;
        if (open) {
            window.setTimeout(function() {
                var closeButton = document.getElementById('assign-success-close');
                if (closeButton) closeButton.focus();
            }, 0);
        }
    }

    function setPasswordResetSuccessModal(open, student, result) {
        var panel = document.getElementById('password-reset-success-panel');
        if (!panel) return;
        if (open) {
            var copy = document.getElementById('password-reset-success-copy');
            if (copy) {
                var loginId = student && student.student_id ? 'Login ID: ' + student.student_id : 'The student password has been reset.';
                var passwordCopy = result && result.initial_password ? ' · Initial password: ' + result.initial_password : '';
                copy.textContent = loginId + passwordCopy;
            }
        }
        panel.hidden = open !== true;
        if (open) {
            window.setTimeout(function() {
                var closeButton = document.getElementById('password-reset-success-close');
                if (closeButton) closeButton.focus();
            }, 0);
        } else {
            window.setTimeout(function() {
                var resetButton = document.getElementById('reset-password');
                if (resetButton) resetButton.focus();
            }, 0);
        }
    }

    function setHeaderIconLoading(isLoading) {
        ['teacher-review-button', 'teacher-updates-button'].forEach(function(id) {
            var button = document.getElementById(id);
            if (!button) return;
            button.classList.toggle('is-loading', isLoading === true);
            if (isLoading === true) {
                button.setAttribute('aria-busy', 'true');
            } else {
                button.removeAttribute('aria-busy');
            }
        });
    }

    function setNotificationHeaderLoading(isLoading) {
        var button = document.getElementById('teacher-updates-button');
        if (!button) return;
        button.classList.toggle('is-loading', isLoading === true);
        if (isLoading === true) button.setAttribute('aria-busy', 'true');
        else button.removeAttribute('aria-busy');
    }

    function formatDate(value, fallback, mode) {
        if (!value) return fallback || '—';
        var date = new Date(value);
        if (isNaN(date.getTime())) return fallback || '—';
        if (mode === 'compact') {
            return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
        }
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        }).format(date);
    }

    function formatDateTime(value, fallback) {
        if (!value) return fallback || '—';
        var date = new Date(value);
        if (isNaN(date.getTime())) return fallback || '—';
        var day = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
        var time = date.toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Shanghai',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
        return day + ' ' + time;
    }

    function randomItem(items) {
        return items[Math.floor(Math.random() * items.length)];
    }

    function englishName(value) {
        var textValue = String(value && (value.name || value.student_id) || value || '').trim();
        if (!textValue) return 'Teacher';
        var englishParts = textValue.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g);
        return englishParts && englishParts.length
            ? englishParts[englishParts.length - 1]
            : textValue;
    }

    function matrixEnglishStudentName(value) {
        var fullName = String(value || '').trim();
        if (!fullName) return 'Student';
        var englishParts = fullName.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g);
        if (!englishParts || !englishParts.length) return fullName;
        return englishParts[0];
    }

    function matrixStudentSurname(value) {
        var fullName = String(value || '').trim();
        if (!fullName) return 'S';
        var chineseSurname = fullName.match(/[\u3400-\u4DBF\u4E00-\u9FFF\uF900-\uFAFF]/);
        if (chineseSurname) return chineseSurname[0];
        var englishParts = fullName.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g);
        if (englishParts && englishParts.length > 1) return englishParts[englishParts.length - 1];
        return englishParts && englishParts.length ? englishParts[0] : Array.from(fullName)[0];
    }

    function matrixStudentDisplayName(value, densityStep) {
        if (densityStep === 0) return matrixStudentSurname(value);
        if (densityStep === 1) return matrixEnglishStudentName(value);
        return String(value || '').trim() || 'Student';
    }

    function matrixTextWidthCh(value) {
        return Array.from(String(value || '')).reduce(function(width, character) {
            return width + (/[^\x00-\xFF]/.test(character) ? 2 : 1);
        }, 0);
    }

    function shanghaiHour() {
        var parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            hour: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(new Date());
        var hourPart = parts.find(function(part) { return part.type === 'hour'; });
        return Number(hourPart ? hourPart.value : 12);
    }

    function greetingFor(name) {
        var hour = shanghaiHour();
        var timeGreetings = hour < 12
            ? ['Good morning, {name}.', 'A fresh morning, {name}.', 'Morning, {name}. Ready to begin?']
            : hour < 18
                ? ['Good afternoon, {name}.', 'A bright afternoon, {name}.', 'Afternoon, {name}. Let us keep moving.']
                : ['Good evening, {name}.', 'A calm evening, {name}.', 'Evening, {name}. One more step forward.'];
        var flexibleGreetings = [
            'Welcome back, {name}.',
            'Great to see you, {name}.',
            'Ready when you are, {name}.',
            'Let us make some progress, {name}.',
            'Here we go, {name}.',
            'Your next win starts here, {name}.',
            'Let us build on yesterday, {name}.',
            'A new chance to grow, {name}.',
            'Good to have you here, {name}.',
            'Let us get started, {name}.',
            'Keep the momentum going, {name}.',
            'Today has possibilities, {name}.',
            'One step at a time, {name}.',
            'You are back, {name}. Let us do this.',
            'Ready for something new, {name}?'
        ];
        return randomItem(timeGreetings.concat(flexibleGreetings)).replace('{name}', name);
    }


    function teacherCall(action, data) {
        return window.MrCatCloud.callFunction('teacherAdmin', Object.assign({ action: action }, data || {}))
            .then(function(result) {
                if (!result || !result.success) {
                    throw new Error(result && result.message || 'Teacher action failed.');
                }
                return result;
            });
    }

    function setDictionaryPanel(open) {
        state.dictionaryOpen = open === true;
        var panel = document.getElementById('teacher-dictionary-panel');
        var button = document.getElementById('teacher-dictionary-button');
        if (panel) panel.hidden = !state.dictionaryOpen;
        if (button) button.setAttribute('aria-expanded', state.dictionaryOpen ? 'true' : 'false');
        if (!state.dictionaryOpen) return;
        setStarRedemptionPanel(false);
        setTeacherAccountPanel(false);
        setReviewPanel(false);
        state.updatesOpen = false;
        renderUpdatesPanel();
        loadDictionaryWorkspace();
    }

    function loadDictionaryWorkspace() {
        var list = document.getElementById('teacher-dictionary-list');
        if (list) list.innerHTML = '<div class="empty-card loading-card">Loading dictionary...</div>';
        return teacherCall('listDictionaryWorkspace').then(function(result) {
            state.dictionaryWords = result.words || [];
            renderDictionaryWorkspace();
        }).catch(function(error) {
            if (list) list.innerHTML = '<div class="empty-card">' + escapeHtml(error.message) + '</div>';
        });
    }

    function filteredDictionaryWords() {
        var query = String(state.dictionarySearch || '').trim().toLowerCase();
        return (state.dictionaryWords || []).filter(function(item) {
            if (item.category !== state.dictionaryCategory) return false;
            return !query || [item.word, item.normalized_word, item.dictionary && item.dictionary.chinese_meaning].join(' ').toLowerCase().indexOf(query) !== -1;
        });
    }

    function selectedDictionaryItem() {
        return (state.dictionaryWords || []).find(function(item) { return item.normalized_word === state.selectedDictionaryWord; }) || null;
    }

    function dictionaryEditorHtml(item) {
        if (!item) return '<p class="muted">Choose a word to review.</p>';
        var dictionary = item.dictionary || {};
        var reports = (item.reports || []).map(function(report) {
            return '<li><strong>' + escapeHtml(report.student_id_snapshot || 'Student') + '</strong>' + (report.reason ? ' — ' + escapeHtml(report.reason) : '') + '</li>';
        }).join('');
        return '<form class="teacher-dictionary-form" id="teacher-dictionary-form">' +
            '<div class="teacher-dictionary-editor-title"><div><p class="eyebrow accent">' + escapeHtml(item.category.replace('_', ' ')) + '</p><h3>' + escapeHtml(item.word) + '</h3></div>' +
            '<button class="outline-button" id="teacher-dictionary-ai" type="button">Draft with AI</button></div>' +
            (reports ? '<ul class="teacher-dictionary-reports">' + reports + '</ul>' : '') +
            '<input type="hidden" name="normalized_word" value="' + escapeHtml(item.normalized_word) + '">' +
            '<label>English<input name="word" value="' + escapeHtml(dictionary.word || item.word) + '" required></label>' +
            '<label>Chinese Meaning<textarea name="chinese_meaning" required>' + escapeHtml(dictionary.chinese_meaning || '') + '</textarea></label>' +
            '<label>English Definition<textarea name="english_definition" required>' + escapeHtml(dictionary.english_definition || '') + '</textarea></label>' +
            '<div class="teacher-dictionary-form-grid"><label>Part of Speech / Phrase Type<input name="part_of_speech" value="' + escapeHtml(dictionary.part_of_speech || '') + '"></label>' +
            '<label>Phonetic<input name="phonetic" value="' + escapeHtml(dictionary.phonetic || '') + '"></label></div>' +
            '<label>Word Forms<input name="word_forms" value="' + escapeHtml(dictionary.word_forms || '') + '"></label>' +
            '<button class="primary-button" type="submit">Publish reviewed entry</button><p class="teacher-dictionary-form-status" role="status"></p>' +
        '</form>';
    }

    function renderDictionaryWorkspace() {
        document.querySelectorAll('[data-dictionary-category]').forEach(function(button) {
            button.classList.toggle('active', button.dataset.dictionaryCategory === state.dictionaryCategory);
        });
        var list = document.getElementById('teacher-dictionary-list');
        var editor = document.getElementById('teacher-dictionary-editor');
        var words = filteredDictionaryWords();
        if (list) list.innerHTML = words.length ? words.map(function(item) {
            return '<button class="teacher-dictionary-row' + (item.normalized_word === state.selectedDictionaryWord ? ' active' : '') + '" type="button" data-dictionary-word="' + escapeHtml(item.normalized_word) + '">' +
                '<strong>' + escapeHtml(item.word) + '</strong><span>' + item.student_count + ' students' + (item.reports && item.reports.length ? ' · ' + item.reports.length + ' reports' : '') + '</span></button>';
        }).join('') : '<div class="empty-card">No entries in this section.</div>';
        if (editor) editor.innerHTML = dictionaryEditorHtml(selectedDictionaryItem());
        if (list) list.querySelectorAll('[data-dictionary-word]').forEach(function(button) {
            button.addEventListener('click', function() { state.selectedDictionaryWord = button.dataset.dictionaryWord; renderDictionaryWorkspace(); });
        });
        var form = document.getElementById('teacher-dictionary-form');
        if (!form) return;
        var ai = document.getElementById('teacher-dictionary-ai');
        if (ai) ai.addEventListener('click', function() {
            ai.disabled = true;
            ai.textContent = 'Drafting...';
            teacherCall('draftDictionaryWithAi', { word: form.elements.word.value }).then(function(result) {
                var draft = result.draft || {};
                ['word', 'chinese_meaning', 'english_definition', 'part_of_speech', 'phonetic', 'word_forms'].forEach(function(name) {
                    if (form.elements[name] && draft[name] != null) form.elements[name].value = draft[name];
                });
                ai.disabled = false;
                ai.textContent = 'Draft with AI';
            }).catch(function(error) { ai.disabled = false; ai.textContent = 'Draft with AI'; alert(error.message); });
        });
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            var status = form.querySelector('.teacher-dictionary-form-status');
            var submit = form.querySelector('[type="submit"]');
            submit.disabled = true;
            status.textContent = 'Publishing...';
            teacherCall('saveDictionaryEntry', {
                normalized_word: form.elements.normalized_word.value,
                word: form.elements.word.value,
                chinese_meaning: form.elements.chinese_meaning.value,
                english_definition: form.elements.english_definition.value,
                part_of_speech: form.elements.part_of_speech.value,
                phonetic: form.elements.phonetic.value,
                word_forms: form.elements.word_forms.value
            }).then(function() {
                status.textContent = 'Published for all students.';
                return loadDictionaryWorkspace();
            }).catch(function(error) { submit.disabled = false; status.textContent = error.message; });
        });
    }

    function loadProgressData() {
        return teacherCall('listProgress').catch(function() {
            return { progress: [], unavailable: true };
        });
    }

    function loadActivityState() {
        return teacherCall('getActivityState').catch(function() {
            return { attempts_seen_at: null, read_all_at: null, reviewed_attempt_ids: [], unread_thread_count: null, unavailable: true };
        });
    }

    function applyActivityState(result) {
        if (result && !result.unavailable) {
            state.attemptsSeenAt = result.attempts_seen_at || null;
            state.activityReadAllAt = result.read_all_at || null;
            state.activityReviewedAttemptIds = result.reviewed_attempt_ids || [];
            if (result.unread_thread_count != null && Number.isFinite(Number(result.unread_thread_count))) {
                state.notificationUnreadThreadCount = Number(result.unread_thread_count);
            }
        }
        setNotificationHeaderLoading(false);
        updateTopBadges();
    }

    function loadNotificationPage(options) {
        options = options || {};
        if (state.notificationPageLoading) return Promise.resolve([]);
        state.notificationPageLoading = true;
        var cursor = options.reset === true ? 0 : Number(state.notificationCursor || 0);
        if (options.reset === true) {
            state.notificationCursor = 0;
            state.notificationHasMore = false;
            state.notificationFeedReady = false;
            state.notificationAttemptIds = {};
        }
        renderUpdatesPanel();
        return teacherCall('listAttemptNotifications', {
            cursor: cursor,
            page_size: NOTIFICATION_FEED_PAGE_SIZE,
            exclude_thread_keys: options.reset === true ? [] : groupedAttemptThreads().map(function(group) { return group.key; })
        }).then(function(result) {
            var attempts = result.attempts || [];
            mergeAttemptSummaries(attempts, true);
            state.notificationCursor = result.next_cursor == null ? cursor : Number(result.next_cursor);
            state.notificationHasMore = result.has_more === true;
            state.notificationFeedReady = true;
            return attempts;
        }).catch(function() {
            return [];
        }).finally(function() {
            state.notificationPageLoading = false;
            renderUpdatesPanel();
        });
    }

    function cacheAllUnreadNotificationPages() {
        var target = Number(state.notificationUnreadThreadCount || 0);
        function next() {
            if (activityAttemptCounts().unread >= target || !state.notificationHasMore) return Promise.resolve();
            return loadNotificationPage().then(function(attempts) {
                return attempts && attempts.length ? next() : undefined;
            });
        }
        return next().then(function() {
            return prefetchNotificationItems(activityItems().filter(function(item) { return item.unread; }));
        });
    }

    function initializeNotificationFeed() {
        return Promise.all([
            loadActivityState(),
            loadNotificationPage({ reset: true })
        ]).then(function(results) {
            applyActivityState(results[0]);
            return cacheAllUnreadNotificationPages();
        }).then(function() {
            renderUpdatesPanel();
            return true;
        }).catch(function() {
            return false;
        });
    }

    function refreshNotificationFeedFromActivityState() {
        return loadNotificationPage({ reset: true }).then(function() {
            return cacheAllUnreadNotificationPages();
        }).then(function() {
            renderUpdatesPanel();
        });
    }

    function mergeDisputePage(result, reset) {
        var status = result && result.status || state.disputeFilter || 'pending';
        var incomingIds = {};
        (result.disputes || []).forEach(function(item) { incomingIds[item.dispute_id] = true; });
        state.disputes = (state.disputes || []).filter(function(item) {
            var itemStatus = item.status === 'approved' || item.status === 'rejected' ? item.status : 'pending';
            if (reset && itemStatus === status) return false;
            return !incomingIds[item.dispute_id];
        }).concat(result.disputes || []);
        if (result.counts) state.disputeCounts = result.counts;
        var page = state.disputePages[status];
        page.cursor = result.next_cursor == null ? page.cursor : Number(result.next_cursor);
        page.hasMore = result.has_more === true;
        page.loaded = true;
        return result.disputes || [];
    }

    function loadDisputePage(status, options) {
        status = status || 'pending';
        options = options || {};
        var page = state.disputePages[status];
        if (!page || page.loading) return Promise.resolve([]);
        if (options.reset === true) {
            page.cursor = 0;
            page.hasMore = false;
            page.loaded = false;
        }
        page.loading = true;
        return teacherCall('listDisputePage', {
            status: status,
            cursor: page.cursor,
            page_size: DISPUTE_FEED_PAGE_SIZE
        }).then(function(result) {
            var disputes = mergeDisputePage(result, options.reset === true);
            return loadQuestionTextForRecords(disputes).then(function() {
                renderDisputes();
                return disputes;
            });
        }).catch(function() {
            return [];
        }).finally(function() {
            page.loading = false;
            updateTopBadges();
        });
    }

    function initializeDisputeFeed() {
        return loadDisputePage('pending', { reset: true });
    }

    function initializeTeacherMessageCaches() {
        setNotificationHeaderLoading(true);
        initializeNotificationFeed();
        initializeDisputeFeed();
    }

    function studentRecords() {
        return state.students.filter(function(student) { return student.role !== 'teacher'; });
    }

    function classes() {
        var seen = {};
        return studentRecords().map(function(student) {
            return String(student.class_group || '').trim();
        }).filter(function(value) {
            if (!value || seen[value]) return false;
            seen[value] = true;
            return true;
        }).sort();
    }

    function classChoicesForStudent(student) {
        var choices = [];
        var seenIds = {};
        var seenNames = {};
        function addChoice(classId, name) {
            var id = String(classId || '').trim();
            var label = String(name || '').trim();
            var normalizedName = label.toLowerCase().replace(/\s+/g, ' ');
            if (!label || (id && seenIds[id]) || (!id && seenNames[normalizedName])) return;
            choices.push({ class_id: id, name: label });
            if (id) seenIds[id] = true;
            seenNames[normalizedName] = true;
        }
        (state.classDirectory || []).forEach(function(classRecord) {
            addChoice(classRecord.class_id, classRecord.name);
        });
        studentRecords().forEach(function(item) {
            addChoice(item.class_id, item.class_group);
        });
        addChoice(student && student.class_id, student && student.class_group);
        return choices.sort(function(left, right) { return left.name.localeCompare(right.name); });
    }

    function renderStudentClassEditor(student) {
        var currentId = String(student.class_id || '').trim();
        var currentName = String(student.class_group || '').trim().toLowerCase().replace(/\s+/g, ' ');
        var options = classChoicesForStudent(student).map(function(classRecord, index) {
            var value = classRecord.class_id || ('__legacy__' + index);
            var selected = currentId
                ? classRecord.class_id === currentId
                : classRecord.name.toLowerCase().replace(/\s+/g, ' ') === currentName;
            return '<option value="' + escapeHtml(value) + '" data-class-id="' + escapeHtml(classRecord.class_id) +
                '" data-class-name="' + escapeHtml(classRecord.name) + '"' + (selected ? ' selected' : '') + '>' +
                escapeHtml(classRecord.name) + '</option>';
        }).join('');
        return '<form class="student-info-editor" data-student-info-editor="class">' +
            '<span style="display:grid;gap:7px">' +
                '<select name="class_choice" aria-label="Choose class">' +
                    '<option value="">No class</option>' + options +
                    '<option value="__customize__">Customize</option>' +
                '</select>' +
                '<input type="text" name="custom_class_group" value="" placeholder="New class name" aria-label="New class name" hidden>' +
            '</span>' +
            '<button class="primary-button" type="submit">Save</button><button class="outline-button" type="button" data-cancel-student-info>Cancel</button>' +
        '</form>';
    }

    function studentMetricTaskRow(item) {
        var status = normalizedAssignmentStatus(item.status);
        var source = item.source === 'self_study' ? 'Self-study' : 'Assigned';
        var date = status === 'to_do'
            ? assignmentDueDate(item)
            : assignmentSortDate(item);
        var dateLabel = date
            ? (status === 'to_do' ? 'Due ' : 'Finished ') + formatDate(date, '', 'compact')
            : (status === 'to_do' ? 'No due date' : 'Finished');
        return '<article class="student-metric-row">' +
            '<span class="student-metric-row-copy"><strong>' + escapeHtml(item.set_title || setTitleFor(item.set_id) || item.set_id || 'Task') + '</strong>' +
                '<small>' + escapeHtml(source) + ' · ' + escapeHtml(dateLabel) + '</small></span>' +
            '<span class="student-metric-row-value ' + (status === 'to_do' ? 'is-open' : 'is-finished') + '">' +
                (status === 'to_do' ? escapeHtml(formatPercent(item.best_percentage)) : escapeHtml(formatPercent(item.best_percentage))) +
            '</span>' +
        '</article>';
    }

    function studentCompletedMetricHtml(assignments) {
        var visible = (assignments || []).filter(function(item) {
            return normalizedAssignmentStatus(item.status) !== 'cancelled';
        });
        var toDo = visible.filter(function(item) {
            return normalizedAssignmentStatus(item.status) === 'to_do';
        });
        var finished = visible.filter(function(item) {
            return isFinishedAssignmentStatus(normalizedAssignmentStatus(item.status));
        });
        function section(label, items) {
            return '<section class="student-metric-section"><div class="student-metric-section-head"><h3>' + escapeHtml(label) + '</h3><strong>' + escapeHtml(items.length) + '</strong></div>' +
                '<div class="student-metric-list">' + (items.length
                    ? items.slice().sort(function(left, right) {
                        return new Date(assignmentSortDate(right) || 0) - new Date(assignmentSortDate(left) || 0);
                    }).map(studentMetricTaskRow).join('')
                    : '<p class="student-metric-empty">No ' + escapeHtml(label.toLowerCase()) + ' work.</p>') +
                '</div></section>';
        }
        return section('TO DO', toDo) + section('FINISHED', finished);
    }

    function studentStarSourcesHtml(stars) {
        var items = Array.isArray(stars) ? stars : [];
        function section(type, label) {
            var matches = items.filter(function(item) { return item.star_type === type; });
            return '<section class="student-metric-section"><div class="student-metric-section-head"><h3>' + escapeHtml(label) + '</h3><strong>' + escapeHtml(matches.length) + '</strong></div>' +
                '<div class="student-metric-list">' + (matches.length ? matches.map(function(item) {
                    var converted = item.star_type === 'blue' && item.status === 'converted';
                    return '<article class="student-metric-row student-star-source-row ' + (item.star_type === 'blue' ? 'is-blue' : 'is-yellow') + '">' +
                        '<span class="student-metric-star" aria-hidden="true">★</span>' +
                        '<span class="student-metric-row-copy"><strong>' + escapeHtml(item.set_title || item.set_id || 'Practice') + '</strong>' +
                            '<small>' + escapeHtml(item.source === 'self_study' ? 'Self-study' : 'Assignment') +
                                ' · Earned ' + escapeHtml(formatDate(item.earned_at, '—', 'compact')) +
                                ' · Best ' + escapeHtml(formatPercent(item.best_percentage)) +
                                (converted ? ' · Converted to Yellow' : '') + '</small></span>' +
                    '</article>';
                }).join('') : '<p class="student-metric-empty">No ' + escapeHtml(label.toLowerCase()) + '.</p>') +
                '</div></section>';
        }
        return section('yellow', 'YELLOW STAR · ASSIGNMENT') + section('blue', 'BLUE STAR · SELF-STUDY');
    }

    function closeStudentMetricModal() {
        var view = state.studentMetricView;
        state.studentMetricView = null;
        var modal = document.getElementById('student-metric-detail-modal');
        if (modal) modal.remove();
        var lookup = document.getElementById('student-lookup-panel');
        if (lookup && state.studentLookupOpen) lookup.hidden = false;
        window.setTimeout(function() {
            var trigger = view && studentDetail.querySelector('[data-student-metric="' + view.kind + '"]');
            if (trigger) trigger.focus();
        }, 0);
    }

    function openStudentMetricModal(kind, student, assignments) {
        closeStudentMetricModal();
        state.studentMetricView = { kind: kind, studentUid: student.auth_uid };
        var title = kind === 'star' ? 'STAR SOURCE' : 'COMPLETED';
        var content = kind === 'star'
            ? '<div class="empty-card loading-card">Loading STAR sources...</div>'
            : studentCompletedMetricHtml(assignments);
        var modal = document.createElement('section');
        modal.id = 'student-metric-detail-modal';
        modal.className = 'student-metric-detail-modal teacher-utility-modal';
        modal.setAttribute('data-teacher-modal', '');
        modal.innerHTML = '<div class="student-metric-detail-shell teacher-utility-shell">' +
            '<div class="student-metric-detail-dialog teacher-utility-dialog" role="dialog" aria-modal="true" aria-labelledby="student-metric-detail-title">' +
                '<header class="student-metric-detail-head">' +
                    '<button class="student-lookup-back student-subdialog-back" type="button" data-student-metric-back aria-label="Back to student detail" title="Back to student detail">' +
                        '<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="m14.5 6-6 6 6 6"></path></svg>' +
                    '</button>' +
                    '<p class="eyebrow accent">' + escapeHtml(studentDisplayName(student)) + '</p><h2 id="student-metric-detail-title">' + escapeHtml(title) + '</h2>' +
                '</header>' +
                '<div class="student-metric-detail-body" id="student-metric-detail-body">' + content + '</div>' +
            '</div>' +
        '</div>';
        teacherModalRoot.appendChild(modal);
        var lookup = document.getElementById('student-lookup-panel');
        if (lookup) lookup.hidden = true;
        modal.addEventListener('click', function(event) {
            if (event.target === modal || event.target.closest('[data-student-metric-back]')) closeStudentMetricModal();
        });
        if (kind !== 'star') return;
        teacherCall('getStudentStarSources', { auth_uid: student.auth_uid }).then(function(result) {
            if (!state.studentMetricView || state.studentMetricView.kind !== 'star' || state.studentMetricView.studentUid !== student.auth_uid) return;
            var body = document.getElementById('student-metric-detail-body');
            if (body) body.innerHTML = studentStarSourcesHtml(result.stars || []);
        }).catch(function(error) {
            var body = document.getElementById('student-metric-detail-body');
            if (body) body.innerHTML = '<div class="empty-card"><strong>Unable to load STAR sources</strong>' + escapeHtml(error.message || 'Please try again.') + '</div>';
        });
    }

    function closeStudentAccountModal() {
        var view = state.studentAccountView;
        state.studentAccountView = null;
        state.studentInfoEdit = '';
        var modal = document.getElementById('student-account-detail-modal');
        if (modal) modal.remove();
        var lookup = document.getElementById('student-lookup-panel');
        if (lookup && state.studentLookupOpen) lookup.hidden = false;
        window.setTimeout(function() {
            var trigger = view && studentDetail.querySelector('[data-student-account]');
            if (trigger) trigger.focus();
        }, 0);
    }

    function renderStudentAccountModal() {
        var view = state.studentAccountView;
        if (!view) return;
        var student = state.students.find(function(item) { return item.auth_uid === view.studentUid; });
        if (!student) {
            closeStudentAccountModal();
            return;
        }
        var existing = document.getElementById('student-account-detail-modal');
        if (existing) existing.remove();
        var nameEditing = state.studentInfoEdit === 'name';
        var classEditing = state.studentInfoEdit === 'class';
        var systemEditing = state.studentInfoEdit === 'system';
        var systemOptions = ['', 'DSE', 'IELTS', 'A-Level', 'AP', 'IB', 'Zhongkao', 'Gaokao'];
        var chineseName = String(student.chinese_name || '').trim();
        var englishName = String(student.english_name || '').trim();
        var displayName = studentDisplayName(student);
        var modal = document.createElement('section');
        modal.id = 'student-account-detail-modal';
        modal.className = 'student-account-detail-modal teacher-utility-modal';
        modal.setAttribute('data-teacher-modal', '');
        modal.innerHTML = '<div class="student-metric-detail-shell teacher-utility-shell">' +
            '<div class="student-metric-detail-dialog student-account-detail-dialog teacher-utility-dialog" role="dialog" aria-modal="true" aria-labelledby="student-account-detail-title">' +
                '<header class="student-metric-detail-head">' +
                    '<button class="student-lookup-back student-subdialog-back" type="button" data-student-account-back aria-label="Back to student detail" title="Back to student detail">' +
                        '<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="m14.5 6-6 6 6 6"></path></svg>' +
                    '</button>' +
                    '<p class="eyebrow accent">' + escapeHtml(displayName) + '</p><h2 id="student-account-detail-title">ACCOUNT SETTINGS</h2>' +
                '</header>' +
                '<div class="student-account-detail-body">' +
                    '<div class="student-info-grid">' +
                        '<div class="student-info-item">' +
                            '<button class="student-info-edit" type="button" data-info-action="Edit" data-edit-student-field="name"><span>Chinese / English name</span><strong>' + escapeHtml(displayName || 'Not set') + '</strong></button>' +
                            (nameEditing ? '<form class="student-info-editor student-name-editor" data-student-info-editor="name">' +
                                '<label>Chinese name<input type="text" name="chinese_name" value="' + escapeHtml(chineseName) + '" placeholder="Chinese name"></label>' +
                                '<label>English name<input type="text" name="english_name" value="' + escapeHtml(englishName) + '" placeholder="English name"></label>' +
                                '<button class="primary-button" type="submit">Save</button><button class="outline-button" type="button" data-cancel-student-info>Cancel</button>' +
                            '</form>' : '') +
                        '</div>' +
                        '<div class="student-info-item"><span>Login ID</span><strong>' + escapeHtml(student.student_id || 'Not set') + '</strong></div>' +
                        '<div class="student-info-item student-account-class-item">' +
                            '<button class="student-info-edit" type="button" data-info-action="Edit" data-edit-student-field="class"><span>Class</span><strong>' + escapeHtml(student.class_group || 'Not set') + '</strong></button>' +
                            (classEditing ? renderStudentClassEditor(student) : '') +
                        '</div>' +
                        '<div class="student-info-item">' +
                            '<button class="student-info-edit system-info-edit" type="button" data-info-action="' + (student.curriculum_track ? 'Edit' : 'Assign') + '" data-edit-student-field="system"><span>System</span><strong>' + escapeHtml(student.curriculum_track || 'Not set') + '</strong></button>' +
                            (systemEditing ? '<form class="student-info-editor" data-student-info-editor="system">' +
                                '<select name="curriculum_track">' + systemOptions.map(function(option) {
                                    return '<option value="' + escapeHtml(option) + '"' + (option === (student.curriculum_track || '') ? ' selected' : '') + '>' + escapeHtml(option || 'Not set') + '</option>';
                                }).join('') + '</select>' +
                                '<button class="primary-button" type="submit">Save</button><button class="outline-button" type="button" data-cancel-student-info>Cancel</button>' +
                            '</form>' : '') +
                        '</div>' +
                    '</div>' +
                    '<div class="student-account-actions">' +
                        '<button class="outline-button" id="reset-password" type="button">Reset password</button>' +
                        '<button class="danger-button" id="delete-student-account" type="button">Delete Account</button>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';
        teacherModalRoot.appendChild(modal);
        var lookup = document.getElementById('student-lookup-panel');
        if (lookup) lookup.hidden = true;
        modal.addEventListener('click', function(event) {
            if (event.target === modal || event.target.closest('[data-student-account-back]')) closeStudentAccountModal();
        });
        modal.querySelectorAll('[data-edit-student-field]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.studentInfoEdit = state.studentInfoEdit === button.dataset.editStudentField ? '' : button.dataset.editStudentField;
                renderStudentAccountModal();
            });
        });
        modal.querySelectorAll('[data-cancel-student-info]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.studentInfoEdit = '';
                renderStudentAccountModal();
            });
        });
        var classChoice = modal.querySelector('[data-student-info-editor="class"] select[name="class_choice"]');
        if (classChoice) classChoice.addEventListener('change', function() {
            var customInput = classChoice.form.elements.custom_class_group;
            var isCustom = classChoice.value === '__customize__';
            customInput.hidden = !isCustom;
            if (isCustom) customInput.focus();
            else customInput.value = '';
        });
        modal.querySelectorAll('[data-student-info-editor]').forEach(function(form) {
            form.addEventListener('submit', function(event) {
                event.preventDefault();
                var field = form.dataset.studentInfoEditor;
                var update;
                if (field === 'name') {
                    var nextChineseName = form.elements.chinese_name.value.trim();
                    var nextEnglishName = form.elements.english_name.value.trim();
                    var nextName = joinedStudentName(nextChineseName, nextEnglishName, '');
                    if (!nextName) {
                        showMessage('Enter a Chinese name or English name.', 'error');
                        return;
                    }
                    update = { name: nextName, chinese_name: nextChineseName, english_name: nextEnglishName };
                } else if (field === 'class') {
                    var selectedOption = form.elements.class_choice.options[form.elements.class_choice.selectedIndex];
                    if (form.elements.class_choice.value === '__customize__') {
                        var customClassName = form.elements.custom_class_group.value.trim();
                        if (!customClassName) {
                            showMessage('Enter a new class name.', 'error');
                            return;
                        }
                        update = { class_group: customClassName };
                    } else {
                        var selectedClassId = selectedOption ? String(selectedOption.dataset.classId || '').trim() : '';
                        var selectedClassName = selectedOption ? String(selectedOption.dataset.className || '').trim() : '';
                        update = selectedClassId ? { class_id: selectedClassId } : { class_id: '', class_group: selectedClassName };
                    }
                } else {
                    update = { curriculum_track: form.elements.curriculum_track.value };
                }
                state.studentInfoEdit = '';
                updateStudent(student.auth_uid, update).then(function(saved) {
                    if (!saved) state.studentInfoEdit = field;
                    renderStudentAccountModal();
                });
            });
        });
        modal.querySelector('#delete-student-account').addEventListener('click', function() {
            deleteStudentAccount(student).then(function() {
                var stillExists = state.students.some(function(item) { return item.auth_uid === student.auth_uid; });
                if (stillExists) renderStudentAccountModal();
                else closeStudentAccountModal();
            });
        });
        modal.querySelector('#reset-password').addEventListener('click', function() {
            if (!confirm('Reset the password for ' + student.student_id + '?')) return;
            teacherCall('resetStudentPassword', { auth_uid: student.auth_uid }).then(function(result) {
                showMessage('', '');
                return refreshStudents().then(function() { setPasswordResetSuccessModal(true, student, result); });
            }).catch(function(error) { showMessage(error.message, 'error'); });
        });
    }

    function openStudentAccountModal(student) {
        state.studentInfoEdit = '';
        state.studentAccountView = { studentUid: student.auth_uid };
        renderStudentAccountModal();
    }

    function setCategory(set) {
        var haystack = [
            set.set_id,
            set.title,
            set.course,
            set.type,
            set.section,
            set.section_id,
            set.sectionId,
            set.category
        ].join(' ').toLowerCase();
        var vocabKey = vocabularySourceKey(set);
        if (vocabKey) return vocabKey;
        if (haystack.indexOf('ielts-reading') !== -1 || haystack.indexOf('ielts reading') !== -1) return 'ielts-reading';
        if (haystack.indexOf('ielts-listening') !== -1 || haystack.indexOf('ielts listening') !== -1) return 'ielts-listening';
        if (haystack.indexOf('bbc-six-minute-english') !== -1 || haystack.indexOf('bbc listening') !== -1 || haystack.indexOf('bbc') !== -1) return 'bbc-listening';
        if (haystack.indexOf('grammar') !== -1) return 'grammar';
        return 'other';
    }

    function setFilterKey(set) {
        var category = setCategory(set);
        if (category !== 'other') return category;
        var raw = String(set.section || set.course || set.type || 'Other').trim();
        return raw ? raw.toLowerCase().replace(/\s+/g, '-') : 'other';
    }

    function setFilterLabel(key, set) {
        var labels = {
            'bbc-listening': 'BBC',
            ngsl: 'NGSL',
            nawl: 'NAWL',
            tk2: 'TK2',
            oxford5000: 'Oxford5000',
            'ielts-reading': 'IELTS Reading',
            'ielts-listening': 'IELTS Listening',
            grammar: 'Grammar',
            other: 'Other'
        };
        if (labels[key]) return labels[key];
        var raw = set && String(set.section || set.course || set.type || '').trim();
        if (raw) return raw;
        return key.split('-').map(function(part) {
            return part ? part.charAt(0).toUpperCase() + part.slice(1) : part;
        }).join(' ');
    }

    function filterOptionOrder(key) {
        var order = {
            'bbc-listening': 10,
            ngsl: 20,
            nawl: 30,
            tk2: 40,
            oxford5000: 45,
            'ielts-reading': 50,
            'ielts-listening': 60,
            grammar: 70,
            other: 999
        };
        return order[key] || 500;
    }

    function setSections() {
        var byKey = {};
        state.sets.forEach(function(set) {
            var key = setFilterKey(set);
            if (!byKey[key]) byKey[key] = {
                key: key,
                label: setFilterLabel(key, set)
            };
        });
        return Object.keys(byKey).map(function(key) {
            return byKey[key];
        }).sort(function(left, right) {
            return filterOptionOrder(left.key) - filterOptionOrder(right.key) ||
                left.label.localeCompare(right.label);
        });
    }

    function isCambridgeCategory(category) {
        return category === 'ielts-reading' || category === 'ielts-listening';
    }

    function cambridgeBookId(set) {
        var id = String(set.set_id || set.id || '').trim().toUpperCase();
        var match = id.match(/^C(\d+)(?:-|$)/);
        return match ? 'C' + match[1] : '';
    }

    function cambridgeBookSortValue(book) {
        var match = String(book || '').match(/^C(\d+)$/i);
        return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
    }

    function cambridgeBooks(sets) {
        var seen = {};
        return (sets || []).map(cambridgeBookId).filter(function(book) {
            if (!book || seen[book]) return false;
            seen[book] = true;
            return true;
        }).sort(function(left, right) {
            return cambridgeBookSortValue(left) - cambridgeBookSortValue(right) || left.localeCompare(right);
        });
    }

    function currentLibraryBook(books) {
        var current = state.libraryBookFilters[state.libraryFilter] || '';
        if (books.indexOf(current) !== -1) return current;
        current = books[0] || '';
        if (current) state.libraryBookFilters[state.libraryFilter] = current;
        return current;
    }

    var teacherLibraryActiveTab = 'general';
    var teacherLibraryActiveSubTab = '';
    var teacherLibraryCatalog = null;

    function activeTeacherViewName() {
        var active = document.querySelector('.tab-button.active');
        var view = active && active.dataset && active.dataset.view || '';
        return teacherViews.indexOf(view) === -1 ? 'view' : view;
    }

    function trueStateKeys(source) {
        return Object.keys(source || {}).filter(function(key) { return source[key] === true; });
    }

    function trueStateMap(keys) {
        return (Array.isArray(keys) ? keys : []).reduce(function(result, key) {
            if (key) result[String(key)] = true;
            return result;
        }, {});
    }

    function readTeacherWorkspaceHistoryState() {
        var historyState = window.history && window.history.state;
        var snapshot = historyState && historyState[TEACHER_HISTORY_STATE_KEY];
        if ((!snapshot || snapshot.version !== TEACHER_HISTORY_STATE_VERSION)
            && new URLSearchParams(window.location.search).get('restore') === '1') {
            try {
                snapshot = JSON.parse(window.sessionStorage.getItem(TEACHER_SESSION_RETURN_KEY) || 'null');
            } catch (error) {
                snapshot = null;
            }
        }
        if (!snapshot || snapshot.version !== TEACHER_HISTORY_STATE_VERSION) return null;
        return snapshot;
    }

    function applyTeacherWorkspaceHistoryState() {
        var snapshot = readTeacherWorkspaceHistoryState();
        if (!snapshot) return null;
        var matrix = snapshot.matrix || {};
        state.matrixClassFilter = String(matrix.class_filter || '');
        state.matrixColumnFilter = String(matrix.column_filter || '');
        state.matrixDateFilter = String(matrix.date_filter || 'all');
        if (matrix.phone_layout === matrixUsesPhoneLayout()
            && Number.isInteger(matrix.density_step)
            && matrix.density_step >= 0
            && matrix.density_step < MATRIX_DENSITY_TASK_WIDTHS.length) {
            state.matrixDensityStep = matrix.density_step;
        }
        state.assignProgressMode = snapshot.progress_mode === 'task' ? 'task' : 'student';
        state.expandedAssignProgressGroups = trueStateMap(snapshot.expanded_progress_groups);
        state.expandedAssignProgress = trueStateMap(snapshot.expanded_progress_rows);
        state.libraryBookFilters = Object.assign({}, snapshot.library_book_filters || {});
        teacherLibraryActiveTab = snapshot.library_tab === 'exam' ? 'exam' : 'general';
        teacherLibraryActiveSubTab = String(snapshot.library_sub_tab || '');
        var libraryTabBar = document.getElementById('teacher-library-tab-bar');
        if (libraryTabBar) {
            libraryTabBar.querySelectorAll('.library-tab-btn').forEach(function(button) {
                button.classList.toggle('active', button.getAttribute('data-tab') === teacherLibraryActiveTab);
            });
        }
        restoredTeacherWorkspaceView = teacherViews.indexOf(snapshot.view) === -1 ? '' : snapshot.view;
        pendingTeacherViewportSnapshot = snapshot.viewport || null;
        state.selectedMatrixCell = '';
        state.selectedMatrixStudentKey = '';
        state.selectedProgressDetailKey = '';
        state.selectedMatrixReviewAttemptId = '';
        state.matrixInitialRevealPending = false;
        var librarySearch = document.getElementById('library-search');
        if (librarySearch) librarySearch.value = String(snapshot.library_search || '');
        if (window.history && window.history.replaceState) {
            var installedState = Object.assign({}, window.history.state || {});
            installedState[TEACHER_HISTORY_STATE_KEY] = snapshot;
            var installedUrl = new URL(window.location.href);
            installedUrl.searchParams.delete('restore');
            window.history.replaceState(installedState, '', installedUrl);
        }
        return snapshot;
    }

    function captureTeacherWorkspaceHistoryState() {
        if (!window.history || !window.history.replaceState) return null;
        var container = document.getElementById('assignment-overview');
        var snapshot = {
            version: TEACHER_HISTORY_STATE_VERSION,
            saved_at: Date.now(),
            view: activeTeacherViewName(),
            matrix: {
                class_filter: state.matrixClassFilter || '',
                column_filter: state.matrixColumnFilter || '',
                date_filter: state.matrixDateFilter || 'all',
                phone_layout: matrixUsesPhoneLayout(),
                density_step: resolvedMatrixDensityStep()
            },
            progress_mode: state.assignProgressMode === 'task' ? 'task' : 'student',
            expanded_progress_groups: trueStateKeys(state.expandedAssignProgressGroups),
            expanded_progress_rows: trueStateKeys(state.expandedAssignProgress),
            library_tab: teacherLibraryActiveTab,
            library_sub_tab: teacherLibraryActiveSubTab,
            library_search: String(document.getElementById('library-search') && document.getElementById('library-search').value || ''),
            library_book_filters: Object.assign({}, state.libraryBookFilters || {}),
            viewport: matrixScrollSnapshot(container)
        };
        var nextState = Object.assign({}, window.history.state || {});
        nextState[TEACHER_HISTORY_STATE_KEY] = snapshot;
        window.history.replaceState(nextState, '', window.location.href);
        try {
            window.sessionStorage.setItem(TEACHER_SESSION_RETURN_KEY, JSON.stringify(snapshot));
        } catch (error) {}
        return snapshot;
    }

    function restorePendingTeacherViewport(finalize) {
        if (!pendingTeacherViewportSnapshot) return;
        var snapshot = pendingTeacherViewportSnapshot;
        if (finalize === true) pendingTeacherViewportSnapshot = null;
        restoreMatrixScroll(snapshot);
    }

    var TEACHER_LIBRARY_GROUP_IDS = {
        general: ['basics', 'lessons'],
        exam: ['ielts', 'dse']
    };

    var TEACHER_LIBRARY_SUB_TABS = {
        general: [
            { id: 'bbc-2024', sectionId: 'bbc-six-minute-english', label: 'BBC2024', itemYear: '2024' },
            { id: 'bbc-2025', sectionId: 'bbc-six-minute-english', label: 'BBC2025', itemYear: '2025' },
            { id: 'bbc-2026', sectionId: 'bbc-six-minute-english', label: 'BBC2026', itemYear: '2026' },
            { id: 'ngsl', label: 'NGSL', vocabularySource: 'ngsl' },
            { id: 'nawl', label: 'NAWL', vocabularySource: 'nawl' },
            { id: 'tk2', label: 'TK2', vocabularySource: 'tk2' },
            { id: 'oxford5000', label: 'Oxford5000', vocabularySource: 'oxford5000' },
            { id: 'lesson-dse', label: 'DSE' },
            { id: 'lesson-ielts', label: 'IELTS' }
        ],
        exam: [
            { id: '', label: 'All' },
            { id: 'ielts-reading', label: 'IELTS Reading', bookFilter: true },
            { id: 'ielts-listening', label: 'IELTS Listening', bookFilter: true },
            { id: 'dse-english-paper-1', label: 'DSE Reading' },
            { id: 'dse-english-paper-2', label: 'DSE Writing' },
            { id: 'dse-integrated', label: 'DSE Integrated' },
            { id: 'dse-english-paper-4', label: 'DSE Speaking' }
        ]
    };

    function teacherLibraryLoadSections() {
        if (teacherLibraryCatalog) return Promise.resolve();
        return fetch('data/home-catalog.json?v=' + encodeURIComponent(appVersion()))
            .then(function(r) { if (!r.ok) return; return r.json(); })
            .then(function(c) { if (c) teacherLibraryCatalog = c; })
            .catch(function() {});
    }

    function teacherLibraryBadge(item, section, itemYear) {
        return '';
    }

    function teacherLibrarySectionLabel(sectionId, fallback) {
        var labels = {
            'ielts-reading': 'ielts-reading',
            'ielts-listening': 'ielts-listening',
            'dse-english-paper-1': 'DSE Reading',
            'dse-english-paper-2': 'DSE Writing',
            'dse-english-paper-3': 'DSE Integrated',
            'dse-integrated': 'DSE Integrated',
            'dse-english-paper-4': 'DSE Speaking'
        };
        return labels[sectionId] || fallback || 'Practice';
    }

    function teacherLibrarySubTabMatchesSection(config, section) {
        if (!config || !config.id) return true;
        if (config.vocabularySource) return section && section.id === 'vocabulary';
        return section && section.id === (config.sectionId || config.id);
    }

    function teacherLibrarySubTabMatchesItem(config, item) {
        if (!config || !config.id) return true;
        if (config.vocabularySource) return vocabularySourceKey(item) === config.vocabularySource;
        if (config.itemYear) return teacherLibraryItemYear(item) === config.itemYear;
        return true;
    }

    function teacherBuildCard(item, section, hidden, itemYear) {
        var sectionId = section && section.id || item.sectionId || item.section_id || '';
        var meta = vocabularyLibrarySectionLabel(item) ||
            teacherLibrarySectionLabel(sectionId, section && section.title || item.section || item.course || item.type || sectionId);
        var setId = vocabularyLibraryRangeLabel(item) || item.set_id || item.id || item.displayValue || '';
        var href = teacherPracticeHref(item);
        var itemStatus = practiceEntryStatus({ dataset: { entryStatus: item.status || '' } });
        var itemLocked = item.answer_revealed === true || item.mastery_locked === true;
        var displayTitle = teacherEditionTitle(item);
        return '<article class="resource-card library-task-card teacher-library-card' + (hidden ? ' year-hidden' : '') + '"' +
            (itemYear ? ' data-year="' + escapeHtml(itemYear) + '"' : '') +
            ' data-entry-kind="' + escapeHtml(meta) + '" data-entry-title="' + escapeHtml(displayTitle || setId || 'Practice') + '"' +
            ' data-entry-status="' + escapeHtml(itemStatus) + '" data-entry-best="' + escapeHtml(item.best_percentage == null ? '' : item.best_percentage) + '"' +
            ' data-entry-locked="' + (itemLocked ? 'true' : 'false') + '"' +
            ' data-open-href="' + escapeHtml(href) + '" role="link" tabindex="0" aria-label="Open ' + escapeHtml(item.title || setId) + '">' +
            '<div class="library-task-copy">' +
                '<div class="resource-card-head">' +
                    '<p class="eyebrow accent">' + escapeHtml(meta) + '</p>' +
                    '<span>' + escapeHtml(setId) + '</span>' +
                '</div>' +
                '<h3>' + escapeHtml(displayTitle || setId) + '</h3>' +
            '</div>' +
        '</article>';
    }

    function teacherBuildPlaceholder(section) {
        return '<div class="empty-card teacher-library-placeholder">' +
            '<strong>' + escapeHtml(section.emptyMessage || 'Developing') + '</strong>' +
            escapeHtml(section.emptyNote || '') +
        '</div>';
    }

    function practiceEntryTitle(element) {
        if (!element) return 'this practice';
        if (element.dataset && element.dataset.entryTitle) return element.dataset.entryTitle;
        var titleNode = element.querySelector && element.querySelector('h3');
        var title = titleNode && titleNode.textContent || element.getAttribute && element.getAttribute('aria-label') || '';
        return String(title || 'this practice').replace(/^Open\s+/i, '').trim() || 'this practice';
    }

    function practiceEntryKind(element) {
        if (!element) return 'Practice';
        if (element.dataset && element.dataset.entryKind) return element.dataset.entryKind;
        var kindNode = element.querySelector && element.querySelector('.eyebrow');
        return String(kindNode && kindNode.textContent || 'Practice').trim() || 'Practice';
    }

    function practiceEntryStatus(element) {
        var status = String(element && element.dataset && element.dataset.entryStatus || '').toLowerCase();
        if (status === 'mastered' || status === 'done') return 'mastered';
        if (status === 'passed') return 'passed';
        return 'not-passed';
    }

    function formatEntryPercent(value) {
        if (value == null || value === '') return '—';
        var number = Number(value);
        if (!isFinite(number)) return '—';
        return (Math.round(number * 10) / 10).toString().replace(/\.0$/, '') + '%';
    }

    function practiceEntryLocked(element) {
        return String(element && element.dataset && element.dataset.entryLocked || '').toLowerCase() === 'true';
    }

    function practiceEntryScoreHtml(best, locked) {
        return (locked ? '<span class="practice-entry-score-lock" aria-hidden="true">&#128274;</span>' : '') +
            '<span>Score: ' + escapeHtml(formatEntryPercent(best)) + '</span>';
    }

    function ensurePracticeEntryDialog() {
        var existing = document.getElementById('practice-entry-overlay');
        if (existing) return existing;
        var overlay = document.createElement('div');
        overlay.className = 'practice-entry-overlay';
        overlay.id = 'practice-entry-overlay';
        overlay.hidden = true;
        overlay.innerHTML =
            '<div class="practice-entry-shell">' +
                '<section class="practice-entry-card" role="dialog" aria-modal="true" aria-label="Practice entry confirmation">' +
                    '<div class="practice-entry-task">' +
                        '<small id="practice-entry-kind">Practice</small>' +
                        '<strong id="practice-entry-title">Practice</strong>' +
                    '</div>' +
                    '<div class="practice-entry-actions">' +
                        '<button class="practice-entry-enter" id="practice-entry-enter" type="button">' +
                            '<span>Enter</span>' +
                            '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
                                '<path d="M5 12h12"></path>' +
                                '<path d="M13 7l5 5-5 5"></path>' +
                            '</svg>' +
                        '</button>' +
                    '</div>' +
                    '<div class="practice-entry-ribbon not-passed" id="practice-entry-ribbon">' +
                        '<span id="practice-entry-status">Not yet</span>' +
                    '</div>' +
                '</section>' +
                '<button class="practice-entry-close" id="practice-entry-close" type="button">Close</button>' +
            '</div>';
        document.body.appendChild(overlay);
        overlay.addEventListener('click', function(event) {
            if (event.target === overlay) closePracticeEntryDialog();
        });
        overlay.querySelector('#practice-entry-close').addEventListener('click', closePracticeEntryDialog);
        overlay.querySelector('#practice-entry-enter').addEventListener('click', function() {
            var href = overlay.dataset.href;
            if (href) {
                captureTeacherWorkspaceHistoryState();
                closePracticeEntryDialog();
                window.location.href = href;
            }
        });
        return overlay;
    }

    function closePracticeEntryDialog() {
        var overlay = document.getElementById('practice-entry-overlay');
        if (!overlay) return;
        overlay.hidden = true;
        delete overlay.dataset.href;
        document.removeEventListener('keydown', handlePracticeEntryKeydown);
    }

    window.addEventListener('pageshow', function(event) {
        closePracticeEntryDialog();
        if (event.persisted) {
            window.setTimeout(function() {
                if (Date.now() - teacherLiveDataLoadedAt >= TEACHER_RETURN_REFRESH_AGE_MS) {
                    refreshTeacherLiveProgress();
                }
            }, 0);
        }
    });

    window.addEventListener('pagehide', function() {
        if (state.profile) captureTeacherWorkspaceHistoryState();
    });

    function handlePracticeEntryKeydown(event) {
        if (event.key === 'Escape') closePracticeEntryDialog();
    }

    function showPracticeEntryDialog(element, href) {
        var overlay = ensurePracticeEntryDialog();
        var status = practiceEntryStatus(element);
        var best = element && element.dataset && element.dataset.entryBest;
        var locked = practiceEntryLocked(element);
        overlay.dataset.href = href || '';
        overlay.querySelector('#practice-entry-kind').textContent = practiceEntryKind(element);
        overlay.querySelector('#practice-entry-title').textContent = practiceEntryTitle(element);
        overlay.querySelector('#practice-entry-ribbon').className = 'practice-entry-ribbon ' + status;
        overlay.querySelector('#practice-entry-status').innerHTML = practiceEntryScoreHtml(best, locked);
        overlay.hidden = false;
        overlay.querySelector('#practice-entry-enter').focus();
        document.addEventListener('keydown', handlePracticeEntryKeydown);
    }

    function openHrefCard(card, event) {
        if (!card) return;
        var interactiveTarget = event && event.target && event.target.closest('button, a');
        if (interactiveTarget && interactiveTarget !== card) return;
        var href = card.dataset.openHref;
        if (href) {
            if (event) event.preventDefault();
            showPracticeEntryDialog(card, href);
        }
    }

    function teacherLibraryItemIdentity(item) {
        return String(item && (item.set_id || item.id || item.displayValue || item.href || item.title) || '');
    }

    function teacherLibraryItemYear(item) {
        var raw = String((item && (item.sortValue || item.publishedOn || item.displayValue)) || '');
        var dateMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) return dateMatch[1];
        var idMatch = teacherLibraryItemIdentity(item).match(/BBC-(\d{2})(\d{2})(\d{2})/i);
        if (idMatch) {
            var year = Number(idMatch[1]);
            return (year < 70 ? '20' : '19') + idMatch[1];
        }
        return '';
    }

    function teacherLibraryDateSortValue(item) {
        var raw = String((item && (item.sortValue || item.publishedOn || item.displayValue)) || '');
        var dateMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) return Number(dateMatch[1] + dateMatch[2] + dateMatch[3]);
        var idMatch = teacherLibraryItemIdentity(item).match(/BBC-(\d{2})(\d{2})(\d{2})/i);
        if (idMatch) {
            var year = Number(idMatch[1]);
            return Number((year < 70 ? '20' : '19') + idMatch[1] + idMatch[2] + idMatch[3]);
        }
        return 0;
    }

    function teacherLibraryIeltsSortValue(item) {
        var match = teacherLibraryItemIdentity(item).match(/C(\d+)-T(\d+)-[PS](\d+)/i);
        if (!match) return null;
        return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
    }

    function teacherLibraryNumberSortValue(item, section) {
        var direct = item && (item.sortValue != null ? item.sortValue : item.sortOrder);
        var number = Number(direct);
        if (isFinite(number) && number !== 0) return number;
        if (section && /^ielts-/i.test(section.id || '')) {
            var ielts = teacherLibraryIeltsSortValue(item);
            if (ielts != null) return ielts;
        }
        return Number.MAX_SAFE_INTEGER;
    }

    function teacherLibraryTitleSortValue(item) {
        return String(item && (item.title || item.displayValue || item.id || item.set_id) || '').toLowerCase();
    }

    function naturalTextCompare(left, right) {
        return String(left || '').localeCompare(String(right || ''), undefined, {
            numeric: true,
            sensitivity: 'base'
        });
    }

    function teacherLibraryCompareFallback(left, right) {
        return naturalTextCompare(teacherLibraryTitleSortValue(left), teacherLibraryTitleSortValue(right)) ||
            naturalTextCompare(teacherLibraryItemIdentity(left), teacherLibraryItemIdentity(right));
    }

    function teacherCompareItemsForSection(left, right, section) {
        if (section.sortType === 'date_desc') {
            return teacherLibraryDateSortValue(right) - teacherLibraryDateSortValue(left) || teacherLibraryCompareFallback(left, right);
        }
        if (section.sortType === 'date_asc') {
            return teacherLibraryDateSortValue(left) - teacherLibraryDateSortValue(right) || teacherLibraryCompareFallback(left, right);
        }
        if (section.sortType === 'number_asc') {
            return teacherLibraryNumberSortValue(left, section) - teacherLibraryNumberSortValue(right, section) || teacherLibraryCompareFallback(left, right);
        }
        if (section.sortType === 'number_desc') {
            return teacherLibraryNumberSortValue(right, section) - teacherLibraryNumberSortValue(left, section) || teacherLibraryCompareFallback(left, right);
        }
        return teacherLibraryCompareFallback(left, right);
    }

    function teacherSortItems(items, section) {
        var sorted = items.slice();
        sorted.sort(function(left, right) {
            return teacherCompareItemsForSection(left, right, section || {});
        });
        return sorted;
    }

    function teacherGetTabSections(tabId) {
        var groupIds = TEACHER_LIBRARY_GROUP_IDS[tabId] || [];
        var result = [];
        for (var i = 0; i < (teacherLibraryCatalog.sections || []).length; i++) {
            var section = teacherLibraryCatalog.sections[i];
            if (groupIds.indexOf(section.groupId || 'general') !== -1) {
                result.push(section);
            }
        }
        return result;
    }

    function teacherLibrarySectionById(sectionId) {
        sectionId = String(sectionId || '').trim();
        if (!sectionId || !teacherLibraryCatalog || !teacherLibraryCatalog.sections) return null;
        for (var i = 0; i < teacherLibraryCatalog.sections.length; i++) {
            if (teacherLibraryCatalog.sections[i].id === sectionId) return teacherLibraryCatalog.sections[i];
        }
        return null;
    }

    function normalizedSectionText(value) {
        return String(value || '').trim().toLowerCase().replace(/[\s_]+/g, '-');
    }

    function teacherLibrarySectionForSet(set) {
        var explicit = set && (set.sectionId || set.section_id);
        var section = teacherLibrarySectionById(explicit);
        if (section) return section;

        var categorySectionIds = {
            'bbc-listening': 'bbc-six-minute-english',
            ngsl: 'vocabulary',
            nawl: 'vocabulary',
            tk2: 'vocabulary',
            oxford5000: 'vocabulary',
            grammar: 'grammar',
            'ielts-reading': 'ielts-reading',
            'ielts-listening': 'ielts-listening'
        };
        section = teacherLibrarySectionById(categorySectionIds[setCategory(set)]);
        if (section) return section;

        if (!teacherLibraryCatalog || !teacherLibraryCatalog.sections) return null;
        var rawValues = [
            set && set.section,
            set && set.course,
            set && set.type,
            set && set.category
        ].map(normalizedSectionText).filter(Boolean);
        for (var i = 0; i < teacherLibraryCatalog.sections.length; i++) {
            var candidate = teacherLibraryCatalog.sections[i];
            var labels = [
                candidate.id,
                candidate.title,
                teacherLibrarySectionLabel(candidate.id, candidate.title)
            ].map(normalizedSectionText);
            for (var ri = 0; ri < rawValues.length; ri++) {
                if (labels.indexOf(rawValues[ri]) !== -1) return candidate;
            }
        }
        return null;
    }

    function teacherLibrarySectionOrder(section) {
        if (!section || !teacherLibraryCatalog || !teacherLibraryCatalog.sections) return Number.MAX_SAFE_INTEGER;
        for (var i = 0; i < teacherLibraryCatalog.sections.length; i++) {
            if (teacherLibraryCatalog.sections[i].id === section.id) return i;
        }
        return Number.MAX_SAFE_INTEGER;
    }

    function sortAssignSets(sets, selectedSection) {
        var section = null;
        if (selectedSection) {
            section = teacherLibrarySectionById(selectedSection);
            if (!section) {
                section = teacherLibrarySectionForSet({ section: selectedSection, course: selectedSection, type: selectedSection });
            }
            if (!section && sets.length) section = teacherLibrarySectionForSet(sets[0]);
            return teacherSortItems(sets, section || {});
        }
        return sets.slice().sort(function(left, right) {
            var leftSection = teacherLibrarySectionForSet(left);
            var rightSection = teacherLibrarySectionForSet(right);
            var sectionDiff = teacherLibrarySectionOrder(leftSection) - teacherLibrarySectionOrder(rightSection);
            if (sectionDiff) return sectionDiff;
            return teacherCompareItemsForSection(left, right, leftSection || {});
        });
    }

    function renderTeacherLibrary(tabId) {
        tabId = tabId || teacherLibraryActiveTab;
        var root = document.getElementById('teacher-library-content');
        var subTabBar = document.getElementById('teacher-sub-tab-bar');
        var yearBar = document.getElementById('teacher-year-bar');
        if (!root) return;

        var subTabs = TEACHER_LIBRARY_SUB_TABS[tabId];
        if (!subTabs) { root.innerHTML = ''; return; }

        var searchText = String(document.getElementById('library-search').value || '').trim().toLowerCase();

        if (!teacherLibraryCatalog || !teacherLibraryCatalog.sections) {
            root.innerHTML = '<p class="section-description">Loading library catalog...</p>';
            teacherLibraryLoadSections().then(function() { renderTeacherLibrary(tabId); });
            return;
        }

        var subTabHtml = '';
        for (var si = 0; si < subTabs.length; si++) {
            var isActive = (!teacherLibraryActiveSubTab && si === 0) || subTabs[si].id === teacherLibraryActiveSubTab;
            subTabHtml += '<button class="sub-tab-btn' + (isActive ? ' active' : '') + '" data-subtab="' + escapeHtml(subTabs[si].id) + '">' + escapeHtml(subTabs[si].label) + '</button>';
        }
        subTabBar.innerHTML = subTabHtml;
        subTabBar.style.display = 'flex';

        var activeSubTabConfig = subTabs[0];
        for (var si = 0; si < subTabs.length; si++) {
            if ((!teacherLibraryActiveSubTab && si === 0) || subTabs[si].id === teacherLibraryActiveSubTab) {
                activeSubTabConfig = subTabs[si];
                break;
            }
        }

        var tabSections = teacherGetTabSections(tabId);
        var targetSectionId = activeSubTabConfig.sectionId || activeSubTabConfig.id;

        var itemsBySection = {};
        var allItems = teacherLibraryDisplayItems().filter(function(item) { return item.visible !== false; });
        for (var i = 0; i < allItems.length; i++) {
            var item = allItems[i];
            var sid = item.sectionId || item.section_id || '';
            if (!sid) {
                var cat = setCategory(item);
                if (isVocabularyCategory(cat)) sid = 'vocabulary';
                else if (cat === 'grammar') sid = 'grammar';
                else if (cat === 'bbc-listening') sid = 'bbc-six-minute-english';
                else if (cat === 'ielts-reading') sid = 'ielts-reading';
                else if (cat === 'ielts-listening') sid = 'ielts-listening';
                else continue;
                item.sectionId = sid;
            }
            if (!itemsBySection[sid]) itemsBySection[sid] = [];
            itemsBySection[sid].push(item);
        }

        var showYearFilter = false;
        var activeYear = '';
        var yearSectionId = '';
        if (activeSubTabConfig.yearFilter) {
            yearSectionId = targetSectionId;
            var yearSection = null;
            for (var i = 0; i < teacherLibraryCatalog.sections.length; i++) {
                if (teacherLibraryCatalog.sections[i].id === targetSectionId) {
                    yearSection = teacherLibraryCatalog.sections[i];
                    break;
                }
            }
            if (yearSection) {
                var yearItems = teacherSortItems(itemsBySection[targetSectionId] || [], yearSection);
                var years = {};
                for (var yi = 0; yi < yearItems.length; yi++) {
                    var y = String(yearItems[yi].sortValue || '').substring(0, 4);
                    if (y && y.length === 4) years[y] = true;
                }
                var yearList = Object.keys(years).sort();
                if (yearList.length > 1) {
                    showYearFilter = true;
                    activeYear = yearList[0];
                    var yearHtml = '';
                    yearHtml += '<button class="year-tab" data-year="">All</button>';
                    for (var yj = 0; yj < yearList.length; yj++) {
                        yearHtml += '<button class="year-tab' + (yearList[yj] === activeYear ? ' active' : '') + '" data-year="' + yearList[yj] + '">' + yearList[yj] + '</button>';
                    }
                    yearBar.innerHTML = '<div class="year-tabs">' + yearHtml + '</div>';
                }
            }
        }
        if (!showYearFilter) {
            yearBar.innerHTML = '';
        }

        var cardsHtml = '';
        for (var i = 0; i < tabSections.length; i++) {
            var section = tabSections[i];
            if (!teacherLibrarySubTabMatchesSection(activeSubTabConfig, section)) continue;

            var sectionItems = (itemsBySection[section.id] || []).filter(function(item) {
                if (!teacherLibrarySubTabMatchesItem(activeSubTabConfig, item)) return false;
                if (!searchText) return true;
                return [item.title, item.set_id, item.id, item.topic, item.displayValue].join(' ').toLowerCase().indexOf(searchText) !== -1;
            });

            if (section.id === yearSectionId && !sectionItems.length) {
                cardsHtml += teacherBuildPlaceholder(section);
                continue;
            }
            var sortedItems = teacherSortItems(sectionItems, section);

            if (sortedItems.length) {
                for (var k = 0; k < sortedItems.length; k++) {
                    var item = sortedItems[k];
                    var itemYear = section.yearFilter ? teacherLibraryItemYear(item) : '';
                    var hidden = activeYear && itemYear !== activeYear;
                    cardsHtml += teacherBuildCard(item, section, hidden, itemYear);
                }
            } else if (!targetSectionId && !section.yearFilter) {
                cardsHtml += teacherBuildPlaceholder(section);
            }
        }

        if (targetSectionId && !cardsHtml && !activeSubTabConfig.vocabularySource) {
            for (var i = 0; i < teacherLibraryCatalog.sections.length; i++) {
                if (teacherLibraryCatalog.sections[i].id === targetSectionId) {
                    cardsHtml = teacherBuildPlaceholder(teacherLibraryCatalog.sections[i]);
                    break;
                }
            }
        }

        if (!cardsHtml) {
            cardsHtml = '<p class="section-description">No content yet.</p>';
        }

        root.innerHTML = '<div class="resource-list teacher-library-list">' + cardsHtml + '</div>';
    }

    function fillClassFilters() {
        var options = '<option value="">All</option>' + classes().map(function(classGroup) {
            return '<option value="' + escapeHtml(classGroup) + '">' + escapeHtml(classGroup) + '</option>';
        }).join('');
        ['assign-class-filter', 'student-class-filter'].forEach(function(id) {
            var select = document.getElementById(id);
            var current = select.value;
            select.innerHTML = options;
            select.value = current;
        });
    }

    function fillSetSectionFilters() {
        var options = '<option value="">All</option>' + setSections().map(function(section) {
            return '<option value="' + escapeHtml(section.key) + '">' + escapeHtml(section.label) + '</option>';
        }).join('');
        ['assign-section-filter'].forEach(function(id) {
            var select = document.getElementById(id);
            if (!select) return;
            var current = select.value;
            select.innerHTML = options;
            select.value = current;
        });
    }

    function filteredSets(prefix) {
        var sectionEl = document.getElementById(prefix + '-section-filter');
        var section = sectionEl ? sectionEl.value : '';
        var searchEl = document.getElementById(prefix + '-set-search') || document.getElementById(prefix + '-search');
        var query = searchEl ? searchEl.value.trim().toLowerCase() : '';
        var libraryCategorySets = prefix === 'library' ? state.sets.filter(function(set) {
            return setCategory(set) === state.libraryFilter;
        }) : [];
        var libraryBook = prefix === 'library' ? currentLibraryBook(cambridgeBooks(libraryCategorySets)) : '';
        var sets = state.sets.filter(function(set) {
            var matchesSection = !section || setFilterKey(set) === section;
            var matchesLibrary = prefix !== 'library' || setCategory(set) === state.libraryFilter;
            var matchesBook = prefix !== 'library' || !libraryBook || cambridgeBookId(set) === libraryBook;
            var haystack = [set.set_id, set.title, set.course, set.type, set.section,
                set.edition_family, set.edition_label].join(' ').toLowerCase();
            return matchesSection && matchesLibrary && matchesBook && (!query || haystack.indexOf(query) !== -1);
        });
        return prefix === 'assign' ? sortAssignSets(sets, section) : sets;
    }

    function teacherEditionTitle(set) {
        var title = set && (set.title || set.set_id) || 'Task';
        if (!window.MrCatEditions || !window.MrCatEditions.hasEditionMetadata(set)) return title;
        return title + ' · ' + window.MrCatEditions.tag(set);
    }

    function renderSetOptions() {
        var sets = filteredSets('assign');
        var select = document.getElementById('assign-set');
        var list = document.getElementById('assign-set-list');
        sets.forEach(function(set) {
            if (set.publicCatalogOnly) delete state.selectedAssignSetIds[set.set_id];
            var setStatus = availabilityStatus(workAvailabilityForSet(set));
            if (setStatus.disabled) delete state.selectedAssignSetIds[set.set_id];
        });
        if (select) {
            select.innerHTML = sets.map(function(set) {
                var status = availabilityStatus(workAvailabilityForSet(set));
                return '<option value="' + escapeHtml(set.set_id) + '"' +
                    (status.disabled ? ' disabled' : '') +
                    (state.selectedAssignSetIds[set.set_id] ? ' selected' : '') + '>' +
                    escapeHtml(teacherEditionTitle(set) + ' · ' + status.label) + '</option>';
            }).join('');
        }
        if (list) {
            list.innerHTML = sets.length ? sets.map(function(set) {
                var status = availabilityStatus(workAvailabilityForSet(set));
                var disabled = status.disabled;
                var selected = state.selectedAssignSetIds[set.set_id] === true && !disabled;
                var baseMeta = [set.set_id, set.course || set.type || set.section || ''].filter(Boolean).join(' · ');
                var meta = [baseMeta, status.label === 'Available' ? '' : status.label].filter(Boolean).join(' · ');
                return '<label class="assign-choice-card' + (selected ? ' selected' : '') +
                    ' ' + escapeHtml(status.css) +
                    (disabled ? ' disabled' : '') + '">' +
                    '<input class="assign-set-checkbox" type="checkbox" value="' + escapeHtml(set.set_id) + '"' +
                        (selected ? ' checked' : '') +
                        (disabled ? ' disabled' : '') + '>' +
                    '<span class="assign-choice-mark" aria-hidden="true"></span>' +
                    '<span class="assign-choice-copy"><strong>' + escapeHtml(teacherEditionTitle(set)) + '</strong>' +
                        '<small>' + escapeHtml(meta) + '</small></span>' +
                '</label>';
            }).join('') : '<div class="empty-card compact-empty"><strong>No matching work</strong>Try another search or column.</div>';
            list.querySelectorAll('.assign-set-checkbox').forEach(function(checkbox) {
                checkbox.addEventListener('change', function() {
                    if (checkbox.checked) {
                        state.selectedAssignSetIds[checkbox.value] = true;
                    } else {
                        delete state.selectedAssignSetIds[checkbox.value];
                    }
                    renderSetOptions();
                    updateSelectedCount();
                    loadCandidates();
                });
            });
        }
        updateAssignSummary();
        updateSelectedCount();
        renderLibrary();
    }

    function syncSelectedAssignSets() {
        var select = document.getElementById('assign-set');
        if (!select) return;
        state.selectedAssignSetIds = {};
        Array.prototype.forEach.call(select.selectedOptions || [], function(option) {
            if (option.value) state.selectedAssignSetIds[option.value] = true;
        });
    }

    function assignmentTargetSetIds() {
        return Object.keys(state.selectedAssignSetIds || {});
    }

    function selectedSetRecords() {
        var selected = assignmentTargetSetIds();
        return selected.map(function(setId) {
            return state.sets.find(function(set) { return set.set_id === setId; }) || { set_id: setId, title: setId };
        });
    }

    function selectedCandidateRecords() {
        var selected = selectedCandidateUids();
        return selected.map(function(uid) {
            return state.candidates.find(function(student) { return student.auth_uid === uid; }) ||
                state.students.find(function(student) { return student.auth_uid === uid; }) ||
                { auth_uid: uid, name: uid };
        });
    }

    function assignmentStateForPair(studentUid, setId) {
        var matching = (state.assignments || []).filter(function(assignment) {
            return assignment &&
                String(assignment.student_uid || '') === String(studentUid || '') &&
                String(assignment.set_id || '') === String(setId || '');
        });
        var open = matching.find(function(assignment) {
            var rawStatus = String(assignment.status || 'to_do');
            return ['to_do', 'not_done', 'failed'].indexOf(rawStatus) !== -1;
        });
        if (open) {
            return {
                availability: 'in_progress',
                assignment_id: open.assignment_id || open._id || '',
                status: open.status || 'to_do',
                best_percentage: studentSetBestPercentage(studentUid, setId)
            };
        }
        var globalBest = studentSetBestPercentage(studentUid, setId);
        var set = state.sets.find(function(item) { return item.set_id === setId; }) || { set_id: setId };
        var passing = Number(assignParamForSet(set).passingPercentage || defaultPassingForSet(set));
        if (globalBest != null && globalBest >= passing) {
            return {
                availability: 'completed',
                completed_count: 1,
                best_percentage: globalBest,
                completed_before_assignment: true
            };
        }
        if (globalBest != null) {
            return {
                availability: 'existing_progress',
                best_percentage: globalBest
            };
        }
        var completed = matching.filter(function(assignment) {
            return ['done', 'passed', 'mastered'].indexOf(String(assignment.status || '')) !== -1;
        });
        if (completed.length) {
            return {
                availability: 'completed',
                completed_count: completed.length,
                best_percentage: completed.reduce(function(best, assignment) {
                    return Math.max(best, Number(assignment.best_percentage || 0));
                }, 0)
            };
        }
        return { availability: 'available' };
    }

    function studentSetBestPercentage(studentUid, setId) {
        var values = [];
        (state.progressItems || []).forEach(function(item) {
            if (String(item.student_uid || '') !== String(studentUid || '') || String(item.set_id || '') !== String(setId || '')) return;
            var value = numericPercent(item.best_percentage);
            if (value != null) values.push(value);
        });
        (state.assignments || []).forEach(function(item) {
            if (String(item.student_uid || '') !== String(studentUid || '') || String(item.set_id || '') !== String(setId || '')) return;
            var value = numericPercent(item.best_percentage);
            if (value != null) values.push(value);
        });
        return values.length ? Math.max.apply(Math, values) : null;
    }

    function mergedAssignmentAvailability(states) {
        var hasProgress = states.some(function(item) { return item.availability === 'in_progress'; });
        if (hasProgress) return 'in_progress';
        var hasCompleted = states.some(function(item) { return item.availability === 'completed'; });
        if (hasCompleted) return 'completed';
        var hasExistingProgress = states.some(function(item) { return item.availability === 'existing_progress'; });
        if (hasExistingProgress) return 'existing_progress';
        return 'available';
    }

    function candidateAvailabilityForStudent(student) {
        var setIds = assignmentTargetSetIds();
        if (!setIds.length) return 'available';
        return mergedAssignmentAvailability(setIds.map(function(setId) {
            return assignmentStateForPair(student.auth_uid, setId);
        }));
    }

    function workAvailabilityForSet(set) {
        if (set.publicCatalogOnly) return 'catalog_only';
        var studentUids = selectedCandidateUids();
        if (!studentUids.length) return 'available';
        return mergedAssignmentAvailability(studentUids.map(function(uid) {
            return assignmentStateForPair(uid, set.set_id);
        }));
    }

    function availabilityStatus(availability) {
        if (availability === 'catalog_only') {
            return { label: 'Import to CloudBase before assigning', css: 'catalog-only', disabled: true };
        }
        if (availability === 'in_progress') {
            return { label: 'Assigned · class Assign can merge', css: 'progress', disabled: false };
        }
        if (availability === 'existing_progress') {
            return { label: 'Existing progress', css: 'progress', disabled: false };
        }
        if (availability === 'completed' || availability === 'starred') {
            return { label: 'Completed · can reassign', css: 'starred', disabled: false };
        }
        return { label: 'Available', css: 'available', disabled: false };
    }

    function removeSelectedAssignItem(kind, id) {
        if (kind === 'set') {
            delete state.selectedAssignSetIds[id];
            delete state.assignSetParams[id];
            renderSetOptions();
            loadCandidates();
            return;
        }
        if (kind === 'student') {
            delete state.selectedAssignStudentUids[id];
            renderSetOptions();
            loadCandidates();
        }
    }

    function renderAssignChips(containerId, items, labelFn, idFn, removeKind) {
        var container = document.getElementById(containerId);
        if (!container) return;
        if (!items.length) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = items.map(function(item) {
            var id = idFn(item);
            var label = labelFn(item);
            return '<span class="assign-chip">' +
                '<span class="assign-chip-label">' + escapeHtml(label) + '</span>' +
                '<button class="assign-chip-remove" type="button" data-remove-assign-' + escapeHtml(removeKind) + '="' + escapeHtml(id) + '" aria-label="Remove ' + escapeHtml(label) + '">x</button>' +
            '</span>';
        }).join('');
        container.querySelectorAll('[data-remove-assign-' + removeKind + ']').forEach(function(button) {
            button.addEventListener('click', function(event) {
                event.stopPropagation();
                removeSelectedAssignItem(removeKind, button.getAttribute('data-remove-assign-' + removeKind));
            });
        });
    }

    function formatPercentInput(value) {
        var number = Number(value);
        if (!isFinite(number)) return '';
        return String(Math.round(number * 100) / 100);
    }

    function configuredDefaultPassing() {
        return Number(window.MRCAT_CONFIG && window.MRCAT_CONFIG.defaultPassingPercentage || 50);
    }

    function setMatchesFamily(set, family) {
        if (!set) return false;
        if (family === 'bbc' && /^BBC-/i.test(String(set.set_id || ''))) return true;
        var fields = [set.section_id, set.section, set.type, set.course, set.category];
        return fields.some(function(value) {
            var normalized = String(value || '').toLowerCase();
            if (family === 'vocabulary') return normalized === 'vocabulary';
            return normalized === 'bbc' || normalized === 'bbc-six-minute-english';
        });
    }

    function familyDefaultPassingForSet(set) {
        if (setMatchesFamily(set, 'vocabulary')) return 90;
        if (setMatchesFamily(set, 'bbc')) return 80;
        return configuredDefaultPassing();
    }

    function familyDefaultMasteryForSet(set) {
        if (setMatchesFamily(set, 'vocabulary')) return 100;
        if (setMatchesFamily(set, 'bbc')) return 95;
        return 90;
    }

    function shanghaiDateInputValueFromParts(parts) {
        if (!parts) return '';
        return [
            String(parts.year).padStart(4, '0'),
            String(parts.month).padStart(2, '0'),
            String(parts.day).padStart(2, '0')
        ].join('-');
    }

    function shanghaiDateInputValue(value) {
        return shanghaiDateInputValueFromParts(shanghaiDateParts(value));
    }

    function currentShanghaiMondayParts(weekOffset) {
        var today = shanghaiDateParts(new Date());
        if (!today) return null;
        var mondayOffset = -((shanghaiWeekday(today) + 6) % 7) + (weekOffset || 0) * 7;
        return addShanghaiDays(today, mondayOffset);
    }

    function shanghaiDatePartsFromInput(value) {
        var match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return null;
        return {
            year: Number(match[1]),
            month: Number(match[2]),
            day: Number(match[3])
        };
    }

    function weekOptionLabel(startParts) {
        var endParts = addShanghaiDays(startParts, 6);
        var weekInfo = shanghaiCalendarWeekInfoFromParts(startParts);
        return [
            weekInfo ? weekInfo.label : 'W--',
            shanghaiDateInputValueFromParts(startParts) + ' - ' + shanghaiDateInputValueFromParts(endParts)
        ].join(' · ');
    }

    function assignDefaultDateValue(weekOffset) {
        return shanghaiDateInputValueFromParts(currentShanghaiMondayParts(weekOffset || 0));
    }

    function weekLabelFromDateInput(value) {
        var parts = shanghaiDatePartsFromInput(value);
        var weekInfo = shanghaiCalendarWeekInfoFromParts(parts);
        return weekInfo ? weekInfo.label : 'W--';
    }

    function assignWeekOptionsHtml(selectedValue) {
        var options = [];
        for (var offset = 0; offset <= 15; offset += 1) {
            var startParts = currentShanghaiMondayParts(offset);
            if (!startParts) continue;
            var value = shanghaiDateInputValueFromParts(startParts);
            options.push('<option value="' + escapeHtml(value) + '"' +
                (value === selectedValue ? ' selected' : '') + '>' +
                escapeHtml(weekOptionLabel(startParts)) + '</option>');
        }
        return options.join('');
    }

    function assignmentWeekStartValue(value) {
        var parts = shanghaiDateParts(value);
        if (!parts) return '';
        var mondayOffset = -((shanghaiWeekday(parts) + 6) % 7);
        return shanghaiDateInputValueFromParts(addShanghaiDays(parts, mondayOffset));
    }

    function assignmentEditWeekOptionsHtml(selectedValue) {
        var options = [];
        var included = {};
        for (var offset = -52; offset <= 52; offset += 1) {
            var startParts = currentShanghaiMondayParts(offset);
            if (!startParts) continue;
            var value = shanghaiDateInputValueFromParts(startParts);
            included[value] = true;
            options.push({ value: value, label: weekOptionLabel(startParts) });
        }
        if (selectedValue && !included[selectedValue]) {
            var selectedParts = shanghaiDatePartsFromInput(selectedValue);
            if (selectedParts) options.push({ value: selectedValue, label: weekOptionLabel(selectedParts) });
        }
        options.sort(function(a, b) { return String(a.value).localeCompare(String(b.value)); });
        return (!selectedValue ? '<option value="" selected disabled>Mixed / choose</option>' : '') + options.map(function(option) {
            return '<option value="' + escapeHtml(option.value) + '"' +
                (option.value === selectedValue ? ' selected' : '') + '>' + escapeHtml(option.label) + '</option>';
        }).join('');
    }

    function defaultPassingForSet(set) {
        var raw = set && set.passing_percentage;
        var fallback = familyDefaultPassingForSet(set);
        var number = Number(raw == null || raw === '' ? fallback : raw);
        return isFinite(number) ? number : fallback;
    }

    function defaultMasteryForSet(set) {
        var raw = set && set.mastery_percentage;
        var fallback = familyDefaultMasteryForSet(set);
        var number = Number(raw == null || raw === '' ? fallback : raw);
        return isFinite(number) ? number : fallback;
    }

    function normalizedPickerPercentage(value, fallback) {
        var number = Number(value);
        if (!isFinite(number)) number = Number(fallback);
        if (!isFinite(number)) number = 50;
        return Math.max(0, Math.min(100, Math.round(number)));
    }

    function percentagePickerTriggerHtml(value, label, extraAttributes, placeholder, fallback) {
        var raw = String(value == null ? '' : value).trim();
        var hasValue = raw !== '' && isFinite(Number(raw));
        var normalized = hasValue ? normalizedPickerPercentage(raw, fallback) : '';
        var display = hasValue ? normalized + '%' : (placeholder || 'Choose');
        var ariaValue = hasValue ? normalized + ' percent' : display;
        return '<button class="percentage-picker-trigger" type="button" data-percent-picker ' +
            'data-percent-title="' + escapeHtml(label) + '" data-percent-default="' +
            escapeHtml(normalizedPickerPercentage(fallback, 50)) + '" value="' +
            escapeHtml(normalized) + '" aria-haspopup="dialog" aria-label="' +
            escapeHtml(label + ', ' + ariaValue) + '" ' + (extraAttributes || '') + '>' +
                '<span data-percent-picker-value>' + escapeHtml(display) + '</span>' +
                '<span class="percentage-picker-glyph" aria-hidden="true">↕</span>' +
            '</button>';
    }

    function setPercentagePickerTriggerValue(trigger, value) {
        if (!trigger) return;
        var normalized = normalizedPickerPercentage(value, trigger.getAttribute('data-percent-default'));
        trigger.value = String(normalized);
        trigger.setAttribute('value', String(normalized));
        var output = trigger.querySelector('[data-percent-picker-value]');
        if (output) output.textContent = normalized + '%';
        var title = trigger.getAttribute('data-percent-title') || 'Percentage';
        trigger.setAttribute('aria-label', title + ', ' + normalized + ' percent');
    }

    function openPercentagePicker(trigger, onCommit) {
        if (!trigger || document.querySelector('.percentage-picker-overlay')) return;
        var title = trigger.getAttribute('data-percent-title') || 'Percentage';
        var selected = normalizedPickerPercentage(trigger.value, trigger.getAttribute('data-percent-default'));
        var options = [];
        for (var value = 0; value <= 100; value += 1) {
            options.push('<button class="percentage-wheel-option" type="button" role="option" tabindex="-1" ' +
                'data-percent-option="' + value + '" aria-selected="' + (value === selected ? 'true' : 'false') + '">' +
                value + '<span aria-hidden="true">%</span></button>');
        }
        var overlay = document.createElement('div');
        overlay.className = 'percentage-picker-overlay';
        overlay.innerHTML =
            '<section class="percentage-picker-dialog" role="dialog" aria-modal="true" aria-labelledby="percentage-picker-title">' +
                '<header class="percentage-picker-head">' +
                    '<button class="percentage-picker-action cancel" type="button" data-percent-cancel>Cancel</button>' +
                    '<div><p>SELECT</p><h2 id="percentage-picker-title">' + escapeHtml(title) + '</h2></div>' +
                    '<button class="percentage-picker-action done" type="button" data-percent-done>Done</button>' +
                '</header>' +
                '<div class="percentage-wheel-frame">' +
                    '<div class="percentage-wheel-highlight" aria-hidden="true"></div>' +
                    '<div class="percentage-wheel-fade top" aria-hidden="true"></div>' +
                    '<div class="percentage-wheel-fade bottom" aria-hidden="true"></div>' +
                    '<div class="percentage-wheel" role="listbox" tabindex="0" aria-label="' + escapeHtml(title) + '">' +
                        options.join('') +
                    '</div>' +
                '</div>' +
                '<output class="percentage-picker-output" aria-live="polite">' + selected + '%</output>' +
            '</section>';
        document.body.appendChild(overlay);

        var wheel = overlay.querySelector('.percentage-wheel');
        var output = overlay.querySelector('.percentage-picker-output');
        var scrollFrame = 0;
        var previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';

        function syncSelection(nextValue) {
            selected = normalizedPickerPercentage(nextValue, selected);
            output.textContent = selected + '%';
            wheel.querySelectorAll('[data-percent-option]').forEach(function(option) {
                var active = Number(option.getAttribute('data-percent-option')) === selected;
                option.classList.toggle('active', active);
                option.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }

        function scrollToSelection(nextValue, behavior) {
            selected = normalizedPickerPercentage(nextValue, selected);
            wheel.scrollTo({
                top: selected * 44,
                behavior: behavior || (
                    window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches
                        ? 'auto'
                        : 'smooth'
                )
            });
            syncSelection(selected);
        }

        function closePicker(commit) {
            document.removeEventListener('keydown', handlePickerKeydown);
            if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
            if (commit) syncSelection(Math.round(wheel.scrollTop / 44));
            document.body.style.overflow = previousBodyOverflow;
            if (commit && typeof onCommit === 'function') onCommit(selected);
            overlay.remove();
            trigger.focus();
        }

        function handlePickerKeydown(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closePicker(false);
                return;
            }
            if (event.key === 'Tab') {
                var focusable = Array.from(overlay.querySelectorAll('button, [tabindex]:not([tabindex="-1"])'));
                var first = focusable[0];
                var last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }
        }

        wheel.addEventListener('scroll', function() {
            if (scrollFrame) window.cancelAnimationFrame(scrollFrame);
            scrollFrame = window.requestAnimationFrame(function() {
                scrollFrame = 0;
                syncSelection(Math.round(wheel.scrollTop / 44));
            });
        }, { passive: true });
        wheel.addEventListener('keydown', function(event) {
            var next = selected;
            if (event.key === 'ArrowUp') next -= 1;
            else if (event.key === 'ArrowDown') next += 1;
            else if (event.key === 'PageUp') next -= 5;
            else if (event.key === 'PageDown') next += 5;
            else if (event.key === 'Home') next = 0;
            else if (event.key === 'End') next = 100;
            else if (event.key === 'Enter') {
                event.preventDefault();
                closePicker(true);
                return;
            } else {
                return;
            }
            event.preventDefault();
            scrollToSelection(next);
        });
        wheel.addEventListener('click', function(event) {
            var option = event.target.closest('[data-percent-option]');
            if (!option) return;
            scrollToSelection(option.getAttribute('data-percent-option'));
        });
        overlay.querySelector('[data-percent-cancel]').addEventListener('click', function() {
            closePicker(false);
        });
        overlay.querySelector('[data-percent-done]').addEventListener('click', function() {
            closePicker(true);
        });
        overlay.addEventListener('click', function(event) {
            if (event.target === overlay) closePicker(false);
        });
        document.addEventListener('keydown', handlePickerKeydown);
        window.requestAnimationFrame(function() {
            wheel.scrollTop = selected * 44;
            syncSelection(selected);
            wheel.focus();
        });
    }

    function defaultAssignParamsForSet(set) {
        return {
            datePreset: 'this_week',
            week: assignDefaultDateValue(0),
            passingPercentage: formatPercentInput(defaultPassingForSet(set)),
            masteryEnabled: false,
            masteryPercentage: ''
        };
    }

    function assignParamForSet(set) {
        var setId = String(set && set.set_id || '');
        if (!setId) return defaultAssignParamsForSet(set);
        if (!state.assignSetParams[setId]) {
            state.assignSetParams[setId] = defaultAssignParamsForSet(set);
        }
        var params = state.assignSetParams[setId];
        if (!params.week) params.week = assignDefaultDateValue(0);
        if (!params.datePreset) params.datePreset = 'this_week';
        if (!params.passingPercentage) params.passingPercentage = formatPercentInput(defaultPassingForSet(set));
        return params;
    }

    function pruneAssignSetParams() {
        var selected = {};
        assignmentTargetSetIds().forEach(function(setId) {
            selected[setId] = true;
        });
        Object.keys(state.assignSetParams || {}).forEach(function(setId) {
            if (!selected[setId]) delete state.assignSetParams[setId];
        });
    }

    function assignDateLabel(params) {
        if (params.datePreset === 'next_week') {
            return 'Next week ' + weekLabelFromDateInput(assignDefaultDateValue(1));
        }
        if (params.datePreset === 'custom') {
            return 'Due ' + weekLabelFromDateInput(params.week || assignDefaultDateValue(0));
        }
        return 'This week ' + weekLabelFromDateInput(assignDefaultDateValue(0));
    }

    function dueAtIsoForWeekStart(value) {
        var startParts = shanghaiDatePartsFromInput(value);
        if (!startParts) return null;
        var sunday = addShanghaiDays(startParts, 6);
        return shanghaiDateInputValueFromParts(sunday) + 'T23:59:59+08:00';
    }

    function assignDueAtIso(params) {
        var value = '';
        if (params.datePreset === 'next_week') {
            value = assignDefaultDateValue(1);
        } else if (params.datePreset === 'custom') {
            value = params.week;
        } else {
            value = assignDefaultDateValue(0);
        }
        return dueAtIsoForWeekStart(value);
    }

    function renderAssignDateControls(setId, params) {
        var preset = params.datePreset || 'this_week';
        var html = '<select data-set-id="' + escapeHtml(setId) + '" data-assign-param="datePreset" aria-label="Due week">' +
            '<option value="this_week"' + (preset === 'this_week' ? ' selected' : '') + '>This week</option>' +
            '<option value="next_week"' + (preset === 'next_week' ? ' selected' : '') + '>Next week</option>' +
            '<option value="custom"' + (preset === 'custom' ? ' selected' : '') + '>Customize</option>' +
        '</select>' +
        '<small>' + escapeHtml(assignDateLabel(params)) + '</small>';
        if (preset !== 'custom') return html;
        html += '<div class="assign-custom-date-controls">' +
            '<small class="assign-week-current-label">This week is ' + escapeHtml(shanghaiCurrentWeekLabel(0)) + '</small>' +
            '<select data-set-id="' + escapeHtml(setId) + '" data-assign-param="week" aria-label="Due week">' +
                assignWeekOptionsHtml(params.week || assignDefaultDateValue(0)) +
            '</select>';
        return html + '</div>';
    }

    function renderAssignStarControls(setId, params, set) {
        var masteryDefault = formatPercentInput(defaultMasteryForSet(set));
        var checked = params.masteryEnabled === true;
        var html = '<label class="assign-star-toggle compact">' +
            '<input type="checkbox" data-set-id="' + escapeHtml(setId) + '" data-assign-param="masteryEnabled"' + (checked ? ' checked' : '') + '>' +
            '<span>Earn STAR</span>' +
        '</label>';
        if (checked) {
            html += '<label class="assign-mastery-inline">' +
                '<span>Mastery %</span>' +
                percentagePickerTriggerHtml(
                    params.masteryPercentage || masteryDefault,
                    'Mastery percentage',
                    'data-set-id="' + escapeHtml(setId) + '" data-assign-param="masteryPercentage"',
                    'Choose',
                    masteryDefault
                ) +
            '</label>';
        }
        return html;
    }

    function assignProgressPreview(set) {
        var setId = String(set && set.set_id || '');
        var passing = Number(assignParamForSet(set).passingPercentage || defaultPassingForSet(set));
        var groups = { not_started: [], existing: [], finished: [] };
        selectedCandidateRecords().forEach(function(student) {
            var stateForPair = assignmentStateForPair(student.auth_uid, setId);
            var best = stateForPair.best_percentage == null
                ? studentSetBestPercentage(student.auth_uid, setId)
                : numericPercent(stateForPair.best_percentage);
            var open = stateForPair.availability === 'in_progress';
            var item = {
                name: studentDisplayName(student) || student.student_id || student.auth_uid,
                best: best,
                open: open
            };
            if (best != null && best >= passing) groups.finished.push(item);
            else if (best != null || open) groups.existing.push(item);
            else groups.not_started.push(item);
        });
        return groups;
    }

    function renderAssignProgressPreview(set) {
        var groups = assignProgressPreview(set);
        var total = groups.not_started.length + groups.existing.length + groups.finished.length;
        if (!total) return '';
        var chips = [
            '<span class="is-new">' + groups.not_started.length + ' not started</span>',
            '<span class="is-progress">' + groups.existing.length + ' existing progress</span>',
            '<span class="is-finished">' + groups.finished.length + ' already finished</span>'
        ].join('');
        var details = [];
        if (groups.existing.length) {
            details.push('<section><strong>Existing progress</strong>' + groups.existing.map(function(item) {
                return '<p><span>' + escapeHtml(item.name) + '</span><small>' +
                    escapeHtml(item.best == null ? 'Previously assigned · complete Class Assign can merge it' :
                        'Best ' + formatPercent(item.best) + (item.open ? ' · complete Class Assign can merge it' : ' · will remain To Do')) +
                '</small></p>';
            }).join('') + '</section>');
        }
        if (groups.finished.length) {
            details.push('<section><strong>Already finished</strong>' + groups.finished.map(function(item) {
                return '<p><span>' + escapeHtml(item.name) + '</span><small>Best ' +
                    escapeHtml(formatPercent(item.best)) + ' · Finished immediately</small></p>';
            }).join('') + '</section>');
        }
        return '<details class="assign-progress-preview">' +
            '<summary><span>Class progress preview</span><span class="assign-progress-preview-chips">' + chips + '</span></summary>' +
            (details.length ? '<div class="assign-progress-preview-detail">' + details.join('') + '</div>' : '') +
        '</details>';
    }

    function renderAssignParamRow(set) {
        var setId = String(set && set.set_id || '');
        var params = assignParamForSet(set);
        return '<div class="assign-params-row" role="row">' +
            '<div class="assign-params-cell task" role="cell">' +
                '<strong>' + escapeHtml(set && (set.title || set.set_id) || setId) + '</strong>' +
                '<small>' + escapeHtml(setId) + '</small>' +
            '</div>' +
            '<div class="assign-params-cell date" role="cell">' + renderAssignDateControls(setId, params) + '</div>' +
            '<div class="assign-params-cell passing" role="cell">' +
                percentagePickerTriggerHtml(
                    params.passingPercentage,
                    'Passing percentage',
                    'data-set-id="' + escapeHtml(setId) + '" data-assign-param="passingPercentage"',
                    'Choose',
                    defaultPassingForSet(set)
                ) +
            '</div>' +
            '<div class="assign-params-cell star" role="cell">' + renderAssignStarControls(setId, params, set) + '</div>' +
        '</div>';
    }

    function handleAssignParamChange(control) {
        var setId = control.getAttribute('data-set-id');
        var key = control.getAttribute('data-assign-param');
        var set = state.sets.find(function(item) { return item.set_id === setId; }) || { set_id: setId };
        var params = assignParamForSet(set);
        if (key === 'masteryEnabled') {
            params.masteryEnabled = control.checked === true;
            params.masteryPercentage = params.masteryEnabled
                ? formatPercentInput(defaultMasteryForSet(set))
                : '';
            renderAssignParameterTable();
            return;
        }
        params[key] = control.value;
        if (key === 'datePreset') {
            renderAssignParameterTable();
            return;
        }
        updateAssignOptionsSummary();
    }

    function bindAssignParameterTable() {
        var table = document.getElementById('assign-params-table');
        if (!table) return;
        table.querySelectorAll('[data-assign-param]').forEach(function(control) {
            if (control.hasAttribute('data-percent-picker')) {
                control.addEventListener('click', function() {
                    openPercentagePicker(control, function(value) {
                        setPercentagePickerTriggerValue(control, value);
                        handleAssignParamChange(control);
                    });
                });
                return;
            }
            var eventName = control.tagName === 'SELECT' || control.type === 'checkbox' || control.type === 'date' ? 'change' : 'input';
            control.addEventListener(eventName, function() {
                handleAssignParamChange(control);
            });
        });
    }

    function renderAssignParameterTable() {
        var table = document.getElementById('assign-params-table');
        if (!table) return;
        pruneAssignSetParams();
        var sets = selectedSetRecords();
        if (!sets.length) {
            table.innerHTML = '<div class="assign-params-empty">Choose work to set task parameters.</div>';
            updateAssignOptionsSummary();
            return;
        }
        table.innerHTML = '<div class="assign-params-row assign-params-header" role="row">' +
            '<div role="columnheader">Task</div>' +
            '<div role="columnheader">Due week</div>' +
            '<div role="columnheader">Passing %</div>' +
            '<div role="columnheader">STAR</div>' +
        '</div>' + sets.map(function(set) {
            return renderAssignParamRow(set) + renderAssignProgressPreview(set);
        }).join('');
        bindAssignParameterTable();
        updateAssignOptionsSummary();
    }

    function resetAssignParameters() {
        state.assignSetParams = {};
        renderAssignParameterTable();
    }

    function validateAssignPercent(value, label, required) {
        var raw = String(value == null ? '' : value).trim();
        if (!raw) {
            if (required) throw new Error(label + ' is required.');
            return '';
        }
        var number = Number(raw);
        if (!isFinite(number) || number < 0 || number > 100) {
            throw new Error(label + ' must be between 0 and 100.');
        }
        return formatPercentInput(number);
    }

    function collectAssignParameters() {
        var sets = selectedSetRecords();
        if (!sets.length) throw new Error('Choose work first.');
        var options = sets.map(function(set) {
            var params = assignParamForSet(set);
            var label = set.title || set.set_id || 'Task';
            var passing = validateAssignPercent(params.passingPercentage, label + ' Passing %', true);
            var masteryEnabled = params.masteryEnabled === true;
            var mastery = validateAssignPercent(params.masteryPercentage, label + ' Mastery %', masteryEnabled);
            if (masteryEnabled && Number(mastery) < Number(passing)) {
                throw new Error(label + ' Mastery % must be at least the Passing %.');
            }
            var dueAt = assignDueAtIso(params);
            if (!dueAt) throw new Error('Choose a due week for ' + label + '.');
            var option = {
                set_id: set.set_id,
                due_at: dueAt,
                passing_percentage: passing,
                mastery_enabled: masteryEnabled
            };
            if (masteryEnabled) option.mastery_percentage = mastery;
            return option;
        });
        return {
            set_options: options
        };
    }

    function updateAssignOptionsSummary() {
        var summary = document.getElementById('assign-options-summary');
        if (!summary) return;
        var sets = selectedSetRecords();
        if (!sets.length) {
            summary.textContent = 'Choose work';
            return;
        }
        var dateLabels = sets.map(function(set) {
            return assignDateLabel(assignParamForSet(set));
        }).filter(function(value, index, arr) {
            return value && arr.indexOf(value) === index;
        });
        var starCount = sets.filter(function(set) {
            return assignParamForSet(set).masteryEnabled === true;
        }).length;
        summary.textContent = [
            sets.length + ' task' + (sets.length === 1 ? '' : 's'),
            dateLabels.length === 1 ? dateLabels[0] : 'Mixed due weeks',
            starCount ? starCount + ' STAR' : 'No STAR'
        ].join(' · ');
    }

    function updateAssignPanelState() {
        [
            { key: 'sets', panel: 'assign-sets-panel', button: 'toggle-assign-sets' },
            { key: 'students', panel: 'assign-students-panel', button: 'toggle-assign-students' },
            { key: 'options', panel: 'assign-options-panel', button: 'toggle-assign-options' }
        ].forEach(function(item) {
            var open = state.assignPanels[item.key] === true;
            var panel = document.getElementById(item.panel);
            var button = document.getElementById(item.button);
            if (panel) panel.hidden = !open;
            if (button) button.setAttribute('aria-expanded', open ? 'true' : 'false');
            if (button && button.closest('.profile-card')) button.closest('.profile-card').classList.toggle('expanded', open);
        });
    }

    function setAssignPanel(key, open) {
        Object.keys(state.assignPanels).forEach(function(panelKey) {
            state.assignPanels[panelKey] = panelKey === key ? open : false;
        });
        updateAssignPanelState();
        if (open) {
            window.setTimeout(function() {
                var focusId = key === 'sets' ? 'assign-set-search' :
                    key === 'students' ? 'assign-search' : '';
                var focusTarget = focusId ? document.getElementById(focusId) : null;
                if (focusTarget) focusTarget.focus();
            }, 0);
        }
    }

    function updateAssignSummary() {
        var sets = selectedSetRecords();
        var students = selectedCandidateRecords();
        var setCount = document.getElementById('assign-set-count');
        var studentCount = document.getElementById('assign-student-count');
        var setDialogCount = document.getElementById('assign-sets-dialog-count');
        var studentDialogCount = document.getElementById('assign-students-dialog-count');
        if (setCount) setCount.textContent = sets.length
            ? sets.length + ' selected'
            : '';
        if (studentCount) studentCount.textContent = students.length
            ? students.length + ' selected'
            : '';
        if (setDialogCount) setDialogCount.textContent = sets.length
            ? sets.length + ' selected'
            : '';
        if (studentDialogCount) studentDialogCount.textContent = students.length
            ? students.length + ' selected'
            : '';
        renderAssignChips('assign-set-chips', sets, function(set) {
            return [set.title || set.set_id, set.set_id].filter(Boolean).join(' · ');
        }, function(set) {
            return set.set_id;
        }, 'set');
        renderAssignChips('assign-student-chips', students, function(student) {
            return [studentDisplayName(student) || student.student_id || student.auth_uid, student.class_group || 'No class'].filter(Boolean).join(' · ');
        }, function(student) {
            return student.auth_uid;
        }, 'student');
        renderAssignParameterTable();
    }

    function teacherPracticeHref(set, returnUrl) {
        var href = set.link || set.href || '#';
        if (!href || href === '#') return '#';
        var params = ['teacher=1'];
        if (appVersion()) {
            params.push('app=' + encodeURIComponent(appVersion()));
        }
        href = href + (href.indexOf('?') === -1 ? '?' : '&') + params.join('&');
        var fallbackReturn = appendQueryParam(returnUrl || 'teacher.html?view=library', 'restore', '1');
        return withReturnParam(href, fallbackReturn);
    }

    function renderLibrary() {
        renderTeacherLibrary(teacherLibraryActiveTab);
    }

    function candidateStatus(candidate) {
        return availabilityStatus(candidate.availability || candidateAvailabilityForStudent(candidate));
    }

    function filteredCandidates() {
        var query = document.getElementById('assign-search').value.trim().toLowerCase();
        var classGroup = document.getElementById('assign-class-filter').value;
        return state.candidates.filter(function(student) {
            var matchesQuery = !query || studentSearchText(student).indexOf(query) !== -1;
            return matchesQuery && (!classGroup || student.class_group === classGroup);
        });
    }

    function rememberSelectedCandidates() {
        candidateList.querySelectorAll('.candidate-checkbox').forEach(function(checkbox) {
            if (checkbox.checked) {
                state.selectedAssignStudentUids[checkbox.value] = true;
            } else {
                delete state.selectedAssignStudentUids[checkbox.value];
            }
        });
    }

    function pruneSelectedCandidates() {
        var available = {};
        (state.candidates || []).forEach(function(student) {
            if (!candidateStatus(student).disabled) available[student.auth_uid] = true;
        });
        Object.keys(state.selectedAssignStudentUids || {}).forEach(function(uid) {
            if (!available[uid]) delete state.selectedAssignStudentUids[uid];
        });
    }

    function renderCandidates() {
        var candidates = filteredCandidates();
        candidateList.innerHTML = candidates.length ? candidates.map(function(student) {
            var status = candidateStatus(student);
            var selected = state.selectedAssignStudentUids[student.auth_uid] && !status.disabled;
            return '<label class="candidate-card assign-choice-card ' + status.css + (selected ? ' selected' : '') + (status.disabled ? ' disabled' : '') + '">' +
                '<input class="candidate-checkbox" type="checkbox" value="' + escapeHtml(student.auth_uid) + '"' +
                    (selected ? ' checked' : '') +
                    (status.disabled ? ' disabled' : '') + '>' +
                '<span class="assign-choice-mark" aria-hidden="true"></span>' +
                '<span class="candidate-copy assign-choice-copy"><strong>' + escapeHtml(studentDisplayName(student) || student.student_id) + '</strong>' +
                    '<small>' + escapeHtml([student.class_group || 'No class', status.label === 'Available' ? '' : status.label].filter(Boolean).join(' · ')) + '</small></span>' +
            '</label>';
        }).join('') : '<div class="empty-card compact-empty"><strong>No matching students</strong>Try another search or class.</div>';

        candidateList.querySelectorAll('.candidate-checkbox').forEach(function(checkbox) {
            checkbox.addEventListener('change', function() {
                rememberSelectedCandidates();
                var card = checkbox.closest('.assign-choice-card');
                if (card) card.classList.toggle('selected', checkbox.checked);
                renderSetOptions();
                updateSelectedCount();
            });
        });
        updateSelectedCount();
    }

    function selectedCandidateUids() {
        return Object.keys(state.selectedAssignStudentUids || {});
    }

    function updateSelectedCount() {
        var count = selectedCandidateUids().length;
        var taskCount = assignmentTargetSetIds().length;
        document.getElementById('selected-count').textContent =
            taskCount + ' work' + ' · ' +
            count + ' student' + (count === 1 ? '' : 's');
        document.getElementById('assign-selected').textContent =
            taskCount && count
                ? 'Assign ' + taskCount + ' work to ' +
                    count + ' student' + (count === 1 ? '' : 's')
                : 'Assign';
        document.getElementById('assign-selected').disabled =
            !count || !assignmentTargetSetIds().length;
        updateAssignSummary();
    }

    function loadCandidates() {
        state.candidates = [];
        renderCandidates();
        state.candidates = studentRecords().filter(function(student) {
            return student.active === true && student.profile_complete;
        }).map(function(student) {
            return Object.assign({}, student, {
                availability: candidateAvailabilityForStudent(student)
            });
        });
        pruneSelectedCandidates();
        renderSetOptions();
        renderCandidates();
        return Promise.resolve();
    }

    function filteredStudents() {
        var searchInput = document.getElementById('student-search');
        var classFilter = document.getElementById('student-class-filter');
        var query = String(searchInput && searchInput.value || '').trim().toLowerCase();
        var classGroup = String(classFilter && classFilter.value || '');
        return studentRecords().filter(function(student) {
            var matchesQuery = !query || studentSearchText(student).indexOf(query) !== -1;
            return matchesQuery && (!classGroup || student.class_group === classGroup);
        });
    }

    function updateSelectedStudentLabel() {
        var selected = state.students.find(function(item) {
            return item.profile_id === state.selectedStudentProfileId;
        });
        var searchState = document.getElementById('student-lookup-search-state');
        var titleState = document.getElementById('student-lookup-title-state');
        if (searchState) searchState.hidden = Boolean(selected);
        if (titleState) titleState.hidden = !selected;
    }

    function setStudentPickerOpen(open, mode) {
        if (mode) state.studentPickerMode = mode;
        var card = document.querySelector('.student-select-card');
        var selected = state.students.find(function(item) {
            return item.profile_id === state.selectedStudentProfileId;
        });
        var searching = open === true && !selected;
        if (card) card.classList.toggle('picker-open', searching);
        if (card) {
            card.classList.remove('picker-choose');
            card.classList.toggle('picker-search', searching);
        }
        state.studentPickerMode = 'search';
        updateSelectedStudentLabel();
    }

    function openStudentSelector(mode) {
        setStudentPickerOpen(true, mode || 'choose');
        renderStudentList();
        if (state.studentPickerMode === 'search') {
            window.setTimeout(function() {
                var input = document.getElementById('student-search');
                if (input) input.focus();
            }, 0);
        }
    }

    function selectStudent(profileId) {
        state.selectedStudentProfileId = profileId;
        var selected = state.students.find(function(item) {
            return item.profile_id === state.selectedStudentProfileId;
        });
        if (selected && document.getElementById('student-search')) document.getElementById('student-search').value = '';
        state.studentProgressView = 'to_do';
        state.expandedAssignmentSets = {};
        setStudentPickerOpen(false);
        renderStudentList();
        renderStudentDetail();
    }

    function returnToStudentSearch() {
        state.selectedStudentProfileId = '';
        state.studentProgressView = 'to_do';
        state.expandedAssignmentSets = {};
        renderStudentDetail();
        setStudentPickerOpen(true, 'search');
        renderStudentList();
        window.setTimeout(function() {
            var input = document.getElementById('student-search');
            if (input) input.focus();
        }, 0);
    }

    function renderStudentList() {
        var students = filteredStudents();
        var searchMode = true;
        updateSelectedStudentLabel();
        studentList.innerHTML = students.length ? students.map(function(student) {
            if (!student.profile_complete) {
                return '<div class="student-pick incomplete-profile">' +
                    '<span><strong>Profile incomplete</strong><small>Database record is missing Login ID or User ID</small></span></div>';
            }
            return '<button class="student-pick' + (searchMode ? '' : ' compact') +
                (student.profile_id === state.selectedStudentProfileId ? ' active' : '') +
                '" type="button" data-profile-id="' + escapeHtml(student.profile_id) + '">' +
                '<span><strong>' + escapeHtml(studentDisplayName(student) || student.student_id) + '</strong></span>' +
                (searchMode ? '<svg class="student-pick-chevron" aria-hidden="true" viewBox="0 0 20 20"><path d="m7.5 4.5 5 5.5-5 5.5"></path></svg>' : '') +
            '</button>';
        }).join('') : '<div class="empty-card"><strong>No matching students</strong>' +
            (searchMode ? 'Try another search.' : 'No student accounts are available.') + '</div>';

        studentList.querySelectorAll('.student-pick').forEach(function(button) {
            if (button.classList.contains('incomplete-profile')) return;
            button.addEventListener('click', function() {
                selectStudent(button.dataset.profileId);
            });
        });
    }

    function assignmentStatusCounts(assignments) {
        var counts = { to_do: 0, passed: 0, mastered: 0, cancelled: 0 };
        assignments.forEach(function(item) {
            var status = normalizedAssignmentStatus(item.status);
            counts[status] = (counts[status] || 0) + 1;
        });
        return counts;
    }

    function progressModeTabs(assignments) {
        var counts = assignmentStatusCounts(assignments);
        var finishedCount = counts.passed + counts.mastered;
        var tabs = [
            { id: 'to_do', label: 'TO DO', count: counts.to_do },
            { id: 'finished', label: 'Finished', count: finishedCount },
            { id: 'data', label: 'Data', count: null }
        ];
        return '<div class="summary-grid student-summary" role="tablist" aria-label="Progress sections">' +
            tabs.map(function(tab) {
                return '<button class="summary-card assignment-filter progress-status-filter' +
                    (state.studentProgressView === tab.id ? ' active' : '') +
                    '" type="button" data-progress-view="' + escapeHtml(tab.id) + '">' +
                    '<span class="summary-value">' + (tab.count == null ? '—' : tab.count) + '</span><span class="summary-label">' + escapeHtml(tab.label) + '</span>' +
                    '</button>';
            }).join('') +
        '</div>';
    }

    function setTitleFor(setId) {
        var set = state.sets.find(function(item) { return item.set_id === setId; });
        return set ? set.title || setId : setId;
    }

    function assignmentSortDate(assignment) {
        return assignment.best_improved_at || assignment.progress_updated_at || assignment.completed_at || assignment.updated_at || assignment.due_at || assignment.assigned_at || null;
    }

    function legacyAssignmentDueDate(assignment) {
        var source = assignment && (assignment.assigned_at || assignment.created_at);
        var parts = shanghaiDateParts(source);
        if (!parts) return null;
        var mondayOffset = -((shanghaiWeekday(parts) + 6) % 7);
        var sunday = addShanghaiDays(parts, mondayOffset + 6);
        return shanghaiDateTime(sunday, 23, 59, 59, 0);
    }

    function assignmentDueDate(assignment) {
        var dueDate = assignment && assignment.due_at ? new Date(assignment.due_at) : null;
        if (dueDate && !isNaN(dueDate.getTime())) return dueDate;
        return legacyAssignmentDueDate(assignment);
    }

    function isSelfStudyMatrixItem(item) {
        return Boolean(item && (item.source === 'self_study' || !item.assignment_id));
    }

    function matrixFilterDateValue(item) {
        return isSelfStudyMatrixItem(item) ? null : assignmentDueDate(item);
    }

    function matrixDateValue(item) {
        return matrixFilterDateValue(item) || (isSelfStudyMatrixItem(item) ? assignmentSortDate(item) : null);
    }

    function shanghaiDateParts(value) {
        var date = value instanceof Date ? value : new Date(value);
        if (isNaN(date.getTime())) return null;
        var parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date);
        var output = {};
        parts.forEach(function(part) {
            if (part.type !== 'literal') output[part.type] = Number(part.value);
        });
        return output.year && output.month && output.day ? output : null;
    }

    function shanghaiWeekday(parts) {
        return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
    }

    function shanghaiDayIndex(parts) {
        return Math.floor(Date.UTC(parts.year, parts.month - 1, parts.day) / 86400000);
    }

    function addShanghaiDays(parts, days) {
        var date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
        return {
            year: date.getUTCFullYear(),
            month: date.getUTCMonth() + 1,
            day: date.getUTCDate()
        };
    }

    function shanghaiDateTime(parts, hour, minute, second, millisecond) {
        return new Date(Date.UTC(
            parts.year,
            parts.month - 1,
            parts.day,
            hour - 8,
            minute,
            second,
            millisecond
        ));
    }

    function shanghaiWeekRange(weekOffset) {
        var today = shanghaiDateParts(new Date());
        if (!today) return { start: null, end: null };
        var mondayOffset = -((shanghaiWeekday(today) + 6) % 7) + weekOffset * 7;
        var startParts = addShanghaiDays(today, mondayOffset);
        var endParts = addShanghaiDays(startParts, 6);
        return {
            start: shanghaiDateTime(startParts, 0, 0, 0, 0),
            end: shanghaiDateTime(endParts, 23, 59, 59, 999)
        };
    }

    function firstMondayOfShanghaiYear(year) {
        var janFirst = { year: year, month: 1, day: 1 };
        return addShanghaiDays(janFirst, (8 - shanghaiWeekday(janFirst)) % 7);
    }

    function shanghaiCalendarWeekInfoFromParts(parts) {
        if (!parts) return null;
        var firstMonday = firstMondayOfShanghaiYear(parts.year);
        var dayDiff = shanghaiDayIndex(parts) - shanghaiDayIndex(firstMonday);
        var weekNumber = dayDiff < 0 ? 0 : Math.floor(dayDiff / 7) + 1;
        return {
            year: parts.year,
            week: weekNumber,
            label: 'W' + String(weekNumber).padStart(2, '0')
        };
    }

    function shanghaiCalendarWeekInfo(value) {
        return shanghaiCalendarWeekInfoFromParts(shanghaiDateParts(value));
    }

    function shanghaiCurrentWeekLabel(dayOffset) {
        var today = shanghaiDateParts(new Date());
        var target = today ? addShanghaiDays(today, dayOffset || 0) : null;
        var weekInfo = shanghaiCalendarWeekInfoFromParts(target);
        return weekInfo ? weekInfo.label : 'W--';
    }

    function matrixWeekInfo(item) {
        if (isSelfStudyMatrixItem(item)) {
            return { year: null, week: null, label: 'Self study' };
        }
        return shanghaiCalendarWeekInfo(assignmentDueDate(item));
    }

    function legacyMatrixAssignedBucket(item) {
        var source = item && item.assigned_at || assignmentDueDate(item);
        var date = source ? new Date(source) : null;
        if (!date || isNaN(date.getTime())) return 'unassigned';
        return String(Math.floor(date.getTime() / (5 * 60 * 1000)));
    }

    function matrixDateRange() {
        var mode = state.matrixDateFilter || 'all';
        if (mode === 'all') return { start: null, end: null };
        if (mode === 'week') {
            return shanghaiWeekRange(0);
        }
        if (mode === 'next_week') {
            return shanghaiWeekRange(1);
        }
        if (mode === 'last_week') {
            return shanghaiWeekRange(-1);
        }
        return { start: null, end: null };
    }

    function dateMatchesMatrixRange(value, range) {
        if (!value) return false;
        var date = new Date(value);
        if (isNaN(date.getTime())) return false;
        if (range.start && date < range.start) return false;
        if (range.end && date > range.end) return false;
        return true;
    }

    function matrixItemMatchesDate(item) {
        var mode = state.matrixDateFilter || 'all';
        if (mode === 'self_study') return isSelfStudyMatrixItem(item);
        if (isSelfStudyMatrixItem(item)) return false;
        if (mode === 'all') return true;
        var range = matrixDateRange();
        return dateMatchesMatrixRange(matrixFilterDateValue(item), range);
    }

    function visibleProgressAssignments(assignments) {
        return assignments.filter(function(item) {
            var status = normalizedAssignmentStatus(item.status);
            if (state.studentProgressView === 'finished') return status === 'passed' || status === 'mastered';
            return status === 'to_do';
        }).sort(function(a, b) {
            return new Date(assignmentSortDate(b) || 0) - new Date(assignmentSortDate(a) || 0);
        });
    }

    function progressAttemptsForAssignment(assignment) {
        if (Array.isArray(assignment.attempts)) {
            return assignment.attempts.slice().sort(function(a, b) {
                return new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0);
            });
        }
        var assignmentId = assignment.assignment_id;
        var attempts = (state.attempts || []).filter(function(attempt) {
            if (assignmentId && attempt.assignment_id) return attempt.assignment_id === assignmentId;
            return attempt.student_uid === assignment.student_uid && attempt.set_id === assignment.set_id;
        });
        return attempts.sort(function(a, b) {
            return new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0);
        });
    }

    function mergeAttemptSummaries(items, includeInNotifications) {
        (items || []).forEach(function(summary) {
            if (!summary || !summary.attempt_id) return;
            var id = String(summary.attempt_id);
            var index = state.attempts.findIndex(function(item) {
                return String(item && item.attempt_id || '') === id;
            });
            if (index === -1) {
                state.attempts.push(summary);
            } else if (attemptHasDetail(state.attempts[index])) {
                state.attempts[index] = Object.assign({}, summary, state.attempts[index], { detail_loaded: true });
            } else {
                state.attempts[index] = Object.assign({}, state.attempts[index], summary);
            }
            if (includeInNotifications) state.notificationAttemptIds[id] = true;
        });
        return items || [];
    }

    function mergeAttemptDetail(detail) {
        if (!detail || !detail.attempt_id) return detail;
        var found = false;
        state.attempts = (state.attempts || []).map(function(attempt) {
            if (attempt.attempt_id !== detail.attempt_id) return attempt;
            found = true;
            return Object.assign({}, attempt, detail, { detail_loaded: true });
        });
        if (!found) state.attempts.push(Object.assign({}, detail, { detail_loaded: true }));
        (state.progressItems || []).forEach(function(item) {
            if (!Array.isArray(item.attempts)) return;
            item.attempts = item.attempts.map(function(attempt) {
                return attempt.attempt_id === detail.attempt_id
                    ? Object.assign({}, attempt, detail, { detail_loaded: true })
                    : attempt;
            });
        });
        return detail;
    }

    function attemptHasDetail(attempt) {
        return Boolean(attempt && (
            attempt.detail_loaded === true || Array.isArray(attempt.question_results)
        ));
    }

    function loadAttemptDetail(attemptId) {
        var id = String(attemptId || '');
        if (!id) return Promise.reject(new Error('Attempt record is unavailable.'));
        var existing = (state.attempts || []).find(function(attempt) {
            return String(attempt.attempt_id || '') === id && attemptHasDetail(attempt);
        });
        if (existing) return Promise.resolve(existing);
        if (attemptDetailPromises[id]) return attemptDetailPromises[id];
        attemptDetailPromises[id] = teacherCall('getAttemptDetail', { attempt_id: id })
            .then(function(result) { return mergeAttemptDetail(result.attempt); })
            .then(function(detail) {
                delete attemptDetailPromises[id];
                return detail;
            }, function(error) {
                delete attemptDetailPromises[id];
                throw error;
            });
        return attemptDetailPromises[id];
    }

    function runNotificationDetailQueue() {
        while (notificationDetailActive < NOTIFICATION_DETAIL_CONCURRENCY && notificationDetailQueue.length) {
            var item = notificationDetailQueue.shift();
            if (!item) continue;
            notificationDetailActive += 1;
            loadAttemptDetail(item.id).then(item.resolve, function(error) {
                if (item.retries < 1) {
                    item.retries += 1;
                    notificationDetailQueue.push(item);
                    return null;
                }
                item.reject(error);
                return null;
            }).then(function() {
                notificationDetailActive -= 1;
                runNotificationDetailQueue();
            });
        }
    }

    function queueNotificationAttemptDetail(attemptId, priority) {
        var id = String(attemptId || '');
        if (!id) return Promise.resolve(null);
        var existing = (state.attempts || []).find(function(item) {
            return String(item && item.attempt_id || '') === id && attemptHasDetail(item);
        });
        if (existing) return Promise.resolve(existing);
        var queued = notificationDetailQueue.find(function(item) { return item.id === id; });
        if (queued) {
            if (priority) {
                notificationDetailQueue = notificationDetailQueue.filter(function(item) { return item !== queued; });
                notificationDetailQueue.unshift(queued);
            }
            return queued.promise;
        }
        var resolveItem;
        var rejectItem;
        var promise = new Promise(function(resolve, reject) {
            resolveItem = resolve;
            rejectItem = reject;
        });
        var item = { id: id, retries: 0, promise: promise, resolve: resolveItem, reject: rejectItem };
        if (priority) notificationDetailQueue.unshift(item);
        else notificationDetailQueue.push(item);
        runNotificationDetailQueue();
        return promise;
    }

    function ensureNotificationThread(attempt) {
        if (!attempt) return Promise.resolve([]);
        var key = attemptThreadKey(attempt);
        if (notificationThreadPromises[key]) return notificationThreadPromises[key];
        notificationThreadPromises[key] = teacherCall('listAttemptThread', {
            student_uid: attempt.student_uid || '',
            assignment_id: attempt.assignment_id || '',
            set_id: attempt.set_id || ''
        }).then(function(result) {
            return mergeAttemptSummaries(result.attempts || [], true);
        }).finally(function() {
            delete notificationThreadPromises[key];
        });
        return notificationThreadPromises[key];
    }

    function loadProgressAttemptThread(item) {
        if (!item || !item.student_uid || !item.set_id) return Promise.resolve([]);
        return teacherCall('listAttemptThread', {
            student_uid: item.student_uid,
            assignment_id: item.assignment_id || '',
            set_id: item.set_id || ''
        }).then(function(result) {
            return mergeAttemptSummaries(result.attempts || [], false);
        }).catch(function() {
            return [];
        });
    }

    function prefetchNotificationThread(attempt, priority) {
        return ensureNotificationThread(attempt).then(function(attempts) {
            var ordered = (attempts || []).slice().sort(function(left, right) {
                return new Date(right.submitted_at || 0) - new Date(left.submitted_at || 0);
            });
            var requests = ordered.map(function(item) {
                return queueNotificationAttemptDetail(item.attempt_id, priority).catch(function() { return null; });
            });
            requests.push(loadQuestionTextForRecords([{ set_id: attempt.set_id || '' }]).catch(function() { return null; }));
            return Promise.all(requests);
        });
    }

    function prefetchNotificationItems(items) {
        var chain = Promise.resolve();
        (items || []).forEach(function(item) {
            chain = chain.then(function() {
                return prefetchNotificationThread(item.attempt, false);
            });
        });
        return chain;
    }

    function openAttemptPaperReview(attemptId, setId, render) {
        return Promise.all([
            loadAttemptDetail(attemptId),
            loadQuestionTextForRecords([{ set_id: setId || '' }])
        ]).then(function() {
            state.selectedMatrixReviewAttemptId = attemptId || '';
            render();
        }).catch(function(error) {
            showMessage(error.message || 'Unable to load this attempt report.', 'error');
        });
    }

    function loadNotificationThreadAttemptDetails(attempt, render) {
        var errors = [];
        return ensureNotificationThread(attempt).then(function(threadAttempts) {
            var ids = (threadAttempts || []).map(function(item) { return item.attempt_id; }).filter(Boolean);
            var revealIds = ids.filter(function(attemptId) {
                return !(state.attempts || []).some(function(item) {
                    return String(item.attempt_id || '') === String(attemptId) && attemptHasDetail(item);
                });
            });
            var requests = ids.map(function(attemptId) {
                return queueNotificationAttemptDetail(attemptId, true).catch(function(error) {
                    errors.push(error);
                    return null;
                });
            });
            requests.push(loadQuestionTextForRecords([{ set_id: attempt && attempt.set_id || '' }]));
            return Promise.all(requests).then(function() {
                if (!attempt || state.notificationAttemptId !== attempt.attempt_id) return;
                state.notificationAttemptRevealIds = revealIds;
                render();
                window.requestAnimationFrame(function() {
                    state.notificationAttemptRevealIds = [];
                });
                if (errors.length) {
                    showMessage('Some answer comparisons could not be loaded. Please try opening the notification again.', 'error');
                }
            });
        });
    }

    function formatPercent(value) {
        if (value == null || value === '') return '—';
        var number = Number(value);
        if (!isFinite(number)) return '—';
        return (Math.round(number * 10) / 10).toString().replace(/\.0$/, '') + '%';
    }

    function numericPercent(value) {
        if (value == null || value === '') return null;
        var number = Number(value);
        return isFinite(number) ? Math.max(0, Math.min(100, number)) : null;
    }

    function averageBestPercent(items) {
        var values = (items || []).map(function(item) {
            return numericPercent(item.best_percentage);
        }).filter(function(value) {
            return value != null;
        });
        if (!values.length) return null;
        return values.reduce(function(sum, value) { return sum + value; }, 0) / values.length;
    }

    function isFinishedAssignmentStatus(status) {
        return status === 'passed' || status === 'mastered';
    }

    function formatDateInputValue(value) {
        if (!value) return '';
        var date = new Date(value);
        if (isNaN(date.getTime())) return '';
        var year = date.getFullYear();
        var month = String(date.getMonth() + 1).padStart(2, '0');
        var day = String(date.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
    }

    function commonFieldValue(items, field) {
        var values = (items || []).map(function(item) {
            return item[field] == null ? '' : String(item[field]);
        });
        if (!values.length) return '';
        return values.every(function(value) { return value === values[0]; }) ? values[0] : '';
    }

    function attemptCorrectCount(attempt) {
        if (attempt.correct_count != null) return Number(attempt.correct_count || 0);
        return (attempt.question_results || []).filter(function(item) { return item.correct === true; }).length;
    }

    function attemptQuestionCount(attempt) {
        if (attempt.question_count != null) return Number(attempt.question_count || 0);
        return (attempt.question_results || []).length;
    }

    function attemptWrongCount(attempt) {
        return Math.max(attemptQuestionCount(attempt) - attemptCorrectCount(attempt), 0);
    }

    function formatDuration(seconds) {
        if (seconds == null || seconds === '') return '';
        var total = Number(seconds);
        if (!isFinite(total) || total < 0) return '';
        var minutes = Math.floor(total / 60);
        var remainder = Math.round(total % 60);
        if (!minutes) return remainder + 's';
        if (!remainder) return minutes + 'm';
        return minutes + 'm ' + remainder + 's';
    }

    function formatAnswerText(value, fallback) {
        if (value == null || value === '') return fallback || '—';
        if (Array.isArray(value)) {
            var parts = value.map(function(part) { return formatAnswerText(part, ''); }).filter(Boolean);
            return parts.length ? parts.join(' / ') : (fallback || '—');
        }
        if (typeof value === 'object') {
            try {
                return JSON.stringify(value);
            } catch (error) {
                return fallback || '—';
            }
        }
        return String(value);
    }


    function renderAttemptWrongAnswers(attempt) {
        if (attempt && !attemptHasDetail(attempt)) {
            return '<div class="attempt-wrong-list">Open the paper report to load question details.</div>';
        }
        var wrong = (attempt.question_results || []).filter(function(item) {
            return item.correct !== true;
        });
        if (!wrong.length) {
            return '<div class="attempt-wrong-list ok">No wrong questions recorded.</div>';
        }
        return '<div class="attempt-wrong-list">' +
            '<strong>Wrong questions</strong>' +
            wrong.map(function(item) {
                var questionId = item.question_id || '?';
                var answer = item.submitted_answer == null || item.submitted_answer === ''
                    ? 'blank'
                    : item.submitted_answer;
                var correctAnswer = formatAnswerText(item.correct_answer, 'not available');
                return '<span><b>Q' + escapeHtml(questionId) + '</b> Student: ' + escapeHtml(answer) +
                    ' · Correct: ' + escapeHtml(correctAnswer) + '</span>';
            }).join('') +
        '</div>';
    }

    function renderLatestAnswerComparison(attempt) {
        if (!attempt) {
            return '<div class="latest-answer-panel empty">No latest attempt recorded yet.</div>';
        }
        if (!attemptHasDetail(attempt)) {
            return '<div class="latest-answer-panel empty">Question details load only when a paper report is opened.</div>';
        }
        var wrong = (attempt.question_results || []).filter(function(item) {
            return item.correct !== true;
        });
        var heading = '<div class="latest-answer-head"><div><strong>Latest wrong answers</strong>' +
            '<small>Attempt #' + escapeHtml(attempt.attempt_number || '1') +
            ' · ' + escapeHtml(formatDateTime(attempt.submitted_at)) + '</small></div>' +
            '<span>' + escapeHtml(formatPercent(attempt.percentage)) + '</span></div>';
        if (!wrong.length) {
            return '<section class="latest-answer-panel all-correct">' + heading +
                '<p>Latest attempt has no wrong answers.</p></section>';
        }
        return '<section class="latest-answer-panel">' + heading +
            '<div class="latest-answer-grid latest-answer-grid-head">' +
                '<span>Question</span><span>Student answer</span><span>Correct answer</span>' +
            '</div>' +
            wrong.map(function(item) {
                var questionId = item.question_id || '?';
                var answer = item.submitted_answer == null || item.submitted_answer === ''
                    ? 'blank'
                    : item.submitted_answer;
                var correctAnswer = formatAnswerText(item.correct_answer, 'not available');
                return '<div class="latest-answer-grid">' +
                    '<span><strong>Q' + escapeHtml(questionId) + '</strong></span>' +
                    '<span class="student-answer">' + escapeHtml(answer) + '</span>' +
                    '<span class="correct-answer">' + escapeHtml(correctAnswer) + '</span>' +
                '</div>';
            }).join('') +
        '</section>';
    }

    function answerRevealBadge(assignment) {
        if (!assignment || assignment.source === 'self_study') {
            return '<span class="answer-reveal-badge neutral">Self-study</span>';
        }
        if (assignment.answer_revealed === true || assignment.mastery_locked === true) {
            var revealedAt = assignment.answer_revealed_at ? ' · ' + formatDate(assignment.answer_revealed_at, '', 'compact') : '';
            return '<span class="answer-reveal-badge locked">Answers viewed · locked' + escapeHtml(revealedAt) + '</span>';
        }
        return '<span class="answer-reveal-badge fresh">Answers not viewed</span>';
    }

    function renderAttemptTrend(attempts, assignment) {
        if (!attempts.length) {
            return '<div class="attempt-history-empty">No attempt records yet.</div>';
        }
        var best = Number(assignment.best_percentage == null ? 0 : assignment.best_percentage);
        return '<div class="attempt-trend" aria-label="Attempt score trend">' +
            attempts.map(function(attempt, index) {
                var percent = Math.max(0, Math.min(100, Number(attempt.percentage || 0)));
                var isBest = best && Math.abs(percent - best) < 0.01;
                return '<div class="attempt-trend-point' + (isBest ? ' best' : '') + '">' +
                    '<span class="attempt-trend-value">' + escapeHtml(formatPercent(percent)) + '</span>' +
                    '<span class="attempt-trend-bar" style="height:' + escapeHtml(Math.max(percent, 6)) + '%"></span>' +
                    '<span class="attempt-trend-label">#' + escapeHtml(attempt.attempt_number || index + 1) + '</span>' +
                '</div>';
            }).join('') +
        '</div>';
    }

    function renderAttemptHistory(attempts) {
        if (!attempts.length) return '';
        return '<div class="attempt-history-list">' +
            attempts.slice().reverse().map(function(attempt, index) {
                var number = attempt.attempt_number || (attempts.length - index);
                var score = formatPercent(attempt.percentage);
                var correct = attemptCorrectCount(attempt);
                var total = attemptQuestionCount(attempt);
                var wrong = attemptWrongCount(attempt);
                var duration = formatDuration(attempt.duration_seconds);
                return '<section class="attempt-history-row">' +
                    '<div class="attempt-history-main">' +
                        '<strong>Attempt #' + escapeHtml(number) + '</strong>' +
                        '<small>' + escapeHtml(formatDateTime(attempt.submitted_at)) +
                        (duration ? ' · ' + escapeHtml(duration) : '') + '</small>' +
                    '</div>' +
                    '<div class="attempt-history-score">' +
                        '<strong>' + escapeHtml(score) + '</strong>' +
                        '<small>' + escapeHtml(correct) + '/' + escapeHtml(total) +
                        ' · ' + escapeHtml(wrong) + ' wrong</small>' +
                    '</div>' +
                    renderAttemptWrongAnswers(attempt) +
                '</section>';
            }).join('') +
        '</div>';
    }

    function renderAssignmentDetails(assignment, attempts) {
        var latestAttempt = attempts.length ? attempts[attempts.length - 1] : null;
        var sourceLabel = assignment.source === 'self_study' ? 'Self-study' : 'Assigned';
        return '<div class="attempt-detail-list">' +
            '<section class="attempt-detail-row">' +
                '<div class="attempt-detail-head"><div><strong>Attempt History</strong>' +
                '<small>' + escapeHtml(sourceLabel) + (assignmentDueDate(assignment) ? ' · Due: ' + escapeHtml(formatDateTime(assignmentDueDate(assignment))) : '') + '</small></div>' +
                '<div class="attempt-detail-actions">' + answerRevealBadge(assignment) +
                '<span>' + escapeHtml(formatPercent(assignment.best_percentage)) + ' best</span></div></div>' +
                renderLatestAnswerComparison(latestAttempt) +
                renderAttemptTrend(attempts, assignment) +
                (latestAttempt ? '<p class="wrong-summary">Latest: ' + escapeHtml(formatPercent(latestAttempt.percentage)) +
                    ' · ' + escapeHtml(attemptCorrectCount(latestAttempt)) + '/' + escapeHtml(attemptQuestionCount(latestAttempt)) +
                    ' · ' + escapeHtml(attemptWrongCount(latestAttempt)) + ' wrong</p>' : '') +
                renderAttemptHistory(attempts) +
            '</section>' +
        '</div>';
    }

    function renderAssignmentCapsule(assignment) {
        var key = assignment.progress_id || assignment.assignment_id || assignment.set_id;
        var expanded = state.expandedAssignmentSets[key] === true;
        var attempts = progressAttemptsForAssignment(assignment);
        var score = formatPercent(assignment.best_percentage);
        var attemptCount = Math.max(Number(assignment.attempt_count || 0), attempts.length);
        var sourceLabel = assignment.source === 'self_study' ? 'Self-study' : 'Assigned';
        return '<article class="attempt-set-capsule assignment-capsule' + (expanded ? ' expanded' : '') + '">' +
            '<button class="attempt-set-head" type="button" data-assignment-set="' + escapeHtml(key) + '">' +
                '<span><strong>' + escapeHtml(assignment.set_title || setTitleFor(assignment.set_id)) + '</strong>' +
                '<small>' + escapeHtml(assignment.set_id) + ' · ' + escapeHtml(sourceLabel) +
                ' · ' + escapeHtml(attemptCount) + ' attempt' + (attemptCount === 1 ? '' : 's') +
                ' · ' + escapeHtml(formatDateTime(assignmentSortDate(assignment))) + '</small></span>' +
                '<span class="assignment-best-score">' + escapeHtml(score) + '</span>' +
            '</button>' +
            (expanded ? renderAssignmentDetails(assignment, attempts) : '') +
        '</article>';
    }

    function renderAssignmentProgress(assignments) {
        if (state.studentProgressView === 'data') {
            return '<div class="learning-section attempt-set-list"><h3>Data</h3>' +
                '<p class="muted">Data analysis will appear here later.</p></div>';
        }
        var visibleAssignments = visibleProgressAssignments(assignments);
        var label = state.studentProgressView === 'finished' ? 'Finished' : 'To Do';
        var assignmentHtml = visibleAssignments.length ? visibleAssignments.map(renderAssignmentCapsule).join('') :
            '<p class="muted">No ' + escapeHtml(label.toLowerCase()) + ' work yet.</p>';

        return '<div class="learning-section attempt-set-list"><h3>' + escapeHtml(label) + '</h3>' +
                assignmentHtml + '</div>';
    }

    function assignedProgressItems() {
        var source = state.progressItems.length ? state.progressItems : state.assignments;
        return source.filter(function(item) {
            return (!item.source || item.source === 'assigned') && normalizedAssignmentStatus(item.status) !== 'cancelled';
        });
    }

    function assignmentAlert(item) {
        var status = normalizedAssignmentStatus(item.status);
        var attempts = progressAttemptsForAssignment(item);
        var attemptCount = Math.max(Number(item.attempt_count || 0), attempts.length);
        var best = item.best_percentage == null ? null : Number(item.best_percentage);
        var dueDate = assignmentDueDate(item);
        var overdue = dueDate && !isNaN(dueDate.getTime()) && dueDate < new Date() && status === 'to_do';
        if (overdue) return { label: 'Overdue', css: 'danger', rank: 0 };
        if (status === 'to_do' && attemptCount >= 2) return { label: 'Stuck', css: 'danger', rank: 1 };
        if (status === 'to_do' && best != null && best < Number(item.passing_percentage || 50)) {
            return { label: 'Low score', css: 'watch', rank: 2 };
        }
        if (status === 'to_do' && !attemptCount) return { label: 'Not started', css: 'watch', rank: 3 };
        if (status === 'to_do') return { label: 'Working', css: 'watch', rank: 4 };
        return { label: status === 'mastered' ? 'Mastered' : 'Finished', css: 'ok', rank: 5 };
    }

    function assignmentOverviewMetrics(items, completedAverageOnly) {
        var counts = items.reduce(function(total, item) {
            var status = normalizedAssignmentStatus(item.status);
            total.total += 1;
            total.attempts += Math.max(Number(item.attempt_count || 0), progressAttemptsForAssignment(item).length);
            if (isFinishedAssignmentStatus(status)) total.finished += 1;
            return total;
        }, { total: 0, finished: 0, attempts: 0, average: null });
        counts.average = averageBestPercent(completedAverageOnly
            ? items.filter(function(item) { return isFinishedAssignmentStatus(normalizedAssignmentStatus(item.status)); })
            : items);
        return counts;
    }

    function sortAssignmentOverviewItems(items) {
        return items.slice().sort(function(a, b) {
            var scoreA = numericPercent(a.best_percentage);
            var scoreB = numericPercent(b.best_percentage);
            if (scoreA != null || scoreB != null) {
                if (scoreA == null) return 1;
                if (scoreB == null) return -1;
                if (scoreA !== scoreB) return scoreA - scoreB;
            }
            return new Date(assignmentSortDate(b) || 0) - new Date(assignmentSortDate(a) || 0);
        });
    }

    function assignmentProgressKey(item) {
        return item.progress_id || item.assignment_id || [item.student_uid, item.set_id].join('::');
    }

    function renderAssignmentOverviewRow(item) {
        var key = assignmentProgressKey(item);
        var expanded = state.expandedAssignProgress[key] === true;
        var status = normalizedAssignmentStatus(item.status);
        var attempts = progressAttemptsForAssignment(item);
        var attemptCount = Math.max(Number(item.attempt_count || 0), attempts.length);
        return '<div class="assignment-table-item">' +
            '<button class="assignment-table-row" type="button" data-assign-progress="' + escapeHtml(key) + '">' +
                '<span><strong>' + escapeHtml(item.student_name || item.student_id || 'Student') + '</strong><small>' + escapeHtml(item.student_id || '') + '</small></span>' +
                '<span><strong>' + escapeHtml(item.set_title || setTitleFor(item.set_id)) + '</strong><small>' + escapeHtml(item.set_id || '') + '</small></span>' +
                '<span class="assignment-status-pill ' + escapeHtml(status) + '">' + escapeHtml(assignmentStatusLabel(status)) + '</span>' +
                '<span><strong>' + escapeHtml(attemptCount) + '</strong><small>attempts</small></span>' +
                '<span><strong>' + escapeHtml(formatPercent(item.best_percentage)) + '</strong><small>best</small></span>' +
                '<span><strong>' + escapeHtml(formatPercent(item.passing_percentage)) + '</strong><small>pass</small></span>' +
            '</button>' +
            (expanded ? '<div class="assignment-overview-detail">' + renderAssignmentDetails(item, attempts) + '</div>' : '') +
        '</div>';
    }

    function assignmentProgressGroups(items, mode) {
        var groupMap = {};
        items.forEach(function(item) {
            var isTaskMode = mode === 'task';
            var id = isTaskMode
                ? String(item.set_id || 'unknown-task')
                : String(item.student_uid || item.auth_uid || item.student_id || 'unknown-student');
            var key = (isTaskMode ? 'task::' : 'student::') + id;
            if (!groupMap[key]) {
                groupMap[key] = {
                    key: key,
                    mode: mode,
                    title: isTaskMode
                        ? (item.set_title || setTitleFor(item.set_id))
                        : (item.student_name || item.student_id || 'Student'),
                    subtitle: isTaskMode
                        ? (item.set_id || '')
                        : (item.student_id || ''),
                    items: []
                };
            }
            groupMap[key].items.push(item);
        });
        return Object.keys(groupMap).map(function(key) {
            var group = groupMap[key];
            group.items = sortAssignmentOverviewItems(group.items);
            group.metrics = assignmentOverviewMetrics(group.items, mode === 'task');
            return group;
        }).sort(function(a, b) {
            if (a.mode === 'task' && b.mode === 'task') {
                var avgA = a.metrics.average == null ? 101 : a.metrics.average;
                var avgB = b.metrics.average == null ? 101 : b.metrics.average;
                if (avgA !== avgB) return avgA - avgB;
            }
            if (b.metrics.finished !== a.metrics.finished) return b.metrics.finished - a.metrics.finished;
            return String(a.title).localeCompare(String(b.title));
        });
    }

    function assignmentStableId(item) {
        if (!item) return '';
        if (item.assignment_id) return String(item.assignment_id);
        if (item._id) return String(item._id);
        var progressId = String(item.progress_id || '');
        return progressId.indexOf('assigned::') === 0 ? progressId.slice('assigned::'.length) : '';
    }

    function editableAssignments(items) {
        return (items || []).filter(function(item) {
            return item.source !== 'self_study' && assignmentStableId(item) && normalizedAssignmentStatus(item.status) !== 'cancelled';
        });
    }

    function assignmentEditStableIds(items) {
        var seen = {};
        return editableAssignments(items).map(assignmentStableId).filter(function(id) {
            if (!id || seen[id]) return false;
            seen[id] = true;
            return true;
        });
    }

    function assignmentEditTriggerAttributes(items, title, subtitle) {
        return ' data-assignment-edit-ids="' + escapeHtml(JSON.stringify(assignmentEditStableIds(items))) + '"' +
            ' data-assignment-edit-title="' + escapeHtml(title || 'Assignments') + '"' +
            ' data-assignment-edit-subtitle="' + escapeHtml(subtitle || '') + '"';
    }

    function assignmentEditIdsFromTrigger(trigger) {
        if (!trigger || !trigger.dataset) return [];
        try {
            var parsed = JSON.parse(trigger.dataset.assignmentEditIds || '[]');
            return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
        } catch (error) {
            return [];
        }
    }

    function currentAssignmentsForStableIds(ids) {
        var wanted = {};
        (ids || []).forEach(function(id) { wanted[String(id)] = true; });
        var found = {};
        (state.progressItems || []).concat(state.assignments || []).forEach(function(item) {
            var stableId = assignmentStableId(item);
            if (!stableId || !wanted[stableId] || found[stableId]) return;
            if (!editableAssignments([item]).length) return;
            found[stableId] = item;
        });
        return (ids || []).map(function(id) { return found[String(id)] || null; }).filter(Boolean);
    }

    function isCancellableAssignmentItem(item) {
        return Boolean(item) && normalizedAssignmentStatus(item.status) !== 'cancelled';
    }

    function renderAssignmentGroupTools(group) {
        var editable = editableAssignments(group.items);
        if (!editable.length) return '';
        var scopeLabel = group.mode === 'class'
            ? 'Edit assignments in class'
            : group.mode === 'task'
                ? 'Edit selected task'
                : 'Edit student assignments';
        return '<div class="assignment-group-tools">' +
            '<span>' + escapeHtml(editable.length) + ' assigned item' + (editable.length === 1 ? '' : 's') + '</span>' +
            '<button class="outline-button assignment-edit-button" type="button" data-edit-assignment-scope="' + escapeHtml(group.key) + '"' +
                assignmentEditTriggerAttributes(editable, group.title, group.subtitle) + '>' +
                escapeHtml(scopeLabel) +
            '</button>' +
        '</div>';
    }

    function renderTaskScoreBars(group) {
        var rows = group.items.slice().sort(function(a, b) {
            var left = numericPercent(a.best_percentage);
            var right = numericPercent(b.best_percentage);
            if (left == null && right == null) return String(a.student_name || '').localeCompare(String(b.student_name || ''));
            if (left == null) return -1;
            if (right == null) return 1;
            return left - right;
        });
        return '<div class="task-score-chart" aria-label="Student scores from low to high">' +
            rows.map(function(item) {
                var score = numericPercent(item.best_percentage);
                var height = score == null ? 4 : Math.max(score, 4);
                var key = assignmentProgressKey(item);
                return '<button class="task-score-bar" type="button" data-student-history-progress="' + escapeHtml(key) + '" title="' +
                    escapeHtml((item.student_name || item.student_id || 'Student') + ' · ' + formatPercent(item.best_percentage)) + '">' +
                    '<span class="task-score-value">' + escapeHtml(formatPercent(item.best_percentage)) + '</span>' +
                    '<span class="task-score-fill" style="height:' + escapeHtml(height) + '%"></span>' +
                    '<span class="task-score-label">' + escapeHtml(item.student_name || item.student_id || 'Student') + '</span>' +
                '</button>';
            }).join('') +
        '</div>';
    }

    function renderGroupMiniMatrix(group) {
        var items = group.items.slice().sort(function(a, b) {
            return String(a.set_title || a.set_id || '').localeCompare(String(b.set_title || b.set_id || ''));
        });
        return '<div class="group-mini-matrix" aria-label="Group assignment completion">' +
            items.map(function(item) {
                var status = normalizedAssignmentStatus(item.status);
                var key = assignmentProgressKey(item);
                var score = formatPercent(item.best_percentage);
                return '<button class="group-mini-cell ' + escapeHtml(status) + '" type="button" data-assign-progress="' + escapeHtml(key) + '">' +
                    '<strong>' + escapeHtml(score) + '</strong>' +
                    '<small>' + escapeHtml(item.set_id || item.student_id || '') + '</small>' +
                '</button>';
            }).join('') +
        '</div>';
    }

    function studentHistoryInitial(title) {
        var text = String(title || 'Student').trim();
        return text ? text.charAt(0).toUpperCase() : 'S';
    }

    function studentHistoryItems(group) {
        return (group.items || []).slice().sort(function(a, b) {
            return new Date(assignmentSortDate(b) || 0) - new Date(assignmentSortDate(a) || 0) ||
                String(a.set_title || a.set_id || '').localeCompare(String(b.set_title || b.set_id || ''));
        });
    }

    function renderStudentHistoryList(group) {
        var items = studentHistoryItems(group);
        if (!items.length) return '<div class="empty-card"><strong>No history yet</strong>No assigned work has been recorded for this student.</div>';
        return '<div class="student-history-shell">' +
            '<aside class="student-history-sidebar">' +
                '<div class="student-history-identity">' +
                    '<span class="student-history-avatar">' + escapeHtml(studentHistoryInitial(group.title)) + '</span>' +
                    '<strong>' + escapeHtml(group.title || 'Student') + '</strong>' +
                '</div>' +
            '</aside>' +
            '<div class="student-history-list">' +
                items.map(function(item) {
                    var key = assignmentProgressKey(item);
                    var score = numericPercent(item.best_percentage);
                    var status = normalizedAssignmentStatus(item.status);
                    var scoreClass = status === 'mastered' ? ' mastered' : status === 'to_do' && (score == null || score < Number(item.passing_percentage || 50)) ? ' low' : '';
                    return '<button class="student-history-row" type="button" data-student-history-progress="' + escapeHtml(key) + '">' +
                        '<span class="student-history-task"><strong>' + escapeHtml(item.set_title || setTitleFor(item.set_id) || item.set_id || 'Task') + '</strong>' +
                        '<small>' + escapeHtml(item.set_id || '') + '</small></span>' +
                        '<span class="student-history-score' + scoreClass + '">' + escapeHtml(formatPercent(item.best_percentage)) + '</span>' +
                    '</button>';
                }).join('') +
            '</div>' +
        '</div>';
    }

    function openAssignmentEditDialog(scopeKey, trigger) {
        var scopedGroup = state.assignmentEditScopes[scopeKey] || null;
        var requestedIds = assignmentEditIdsFromTrigger(trigger);
        var currentItems = currentAssignmentsForStableIds(requestedIds);
        var items = requestedIds.length
            ? currentItems
            : editableAssignments(scopedGroup && scopedGroup.items || []);
        var group = {
            key: scopeKey || '',
            mode: scopedGroup && scopedGroup.mode || 'selection',
            title: trigger && trigger.dataset && trigger.dataset.assignmentEditTitle
                || scopedGroup && scopedGroup.title
                || 'Assignments',
            subtitle: trigger && trigger.dataset && trigger.dataset.assignmentEditSubtitle
                || scopedGroup && scopedGroup.subtitle
                || '',
            items: items
        };
        if (!items.length || (requestedIds.length && items.length !== requestedIds.length)) {
            showMessage('Assignment parameters are temporarily unavailable. Refresh Teacher View and try again.', 'error');
            return false;
        }
        var cancelableItems = items.filter(isCancellableAssignmentItem);
        var commonDue = commonFieldValue(items, 'due_at');
        var commonDueSource = commonDue || (items.length === 1 ? assignmentDueDate(items[0]) : null);
        var dueWeek = assignmentWeekStartValue(commonDueSource);
        var commonPassing = commonFieldValue(items, 'passing_percentage');
        var commonMastery = commonFieldValue(items, 'mastery_percentage');
        var masteryEnabledChecked = items.every(assignmentCanEarnStar);
        var scopeSubtitle = group.subtitle ? group.subtitle + ' · ' : '';
        var overlay = document.createElement('div');
        overlay.className = 'assignment-edit-overlay';
        overlay.innerHTML =
            '<div class="assignment-edit-shell">' +
            '<section class="assignment-edit-dialog" role="dialog" aria-modal="true" aria-labelledby="assignment-edit-title">' +
                '<div class="assignment-edit-head">' +
                    '<p class="eyebrow accent">MANAGE ASSIGNMENTS</p>' +
                    '<h2 id="assignment-edit-title">' + escapeHtml(group.title || 'Assignments') + '</h2>' +
                    '<p>' + escapeHtml(scopeSubtitle) + escapeHtml(items.length) + ' selected assignment' + (items.length === 1 ? '' : 's') + '.</p>' +
                '</div>' +
                '<form class="assignment-edit-form">' +
                    '<div class="assignment-edit-field">' +
                        '<label for="assignment-edit-due-week">Due week</label>' +
                        '<select id="assignment-edit-due-week" name="due_week">' + assignmentEditWeekOptionsHtml(dueWeek) + '</select>' +
                    '</div>' +
                    '<div class="assignment-edit-field">' +
                        '<span class="assignment-edit-field-label">Passing %</span>' +
                        '<div class="assignment-edit-percentage">' +
                        percentagePickerTriggerHtml(
                            commonPassing,
                            'Passing percentage',
                            'data-percent-input="passing_percentage"',
                            'Mixed / choose',
                            50
                        ) +
                        '<input type="hidden" name="passing_percentage" value="' + escapeHtml(commonPassing) + '">' +
                        '</div>' +
                    '</div>' +
                    '<div class="assignment-edit-field mastery-field">' +
                        '<span class="assignment-edit-field-label">Mastery %' +
                            '<label class="assignment-edit-earn-star"><input type="checkbox" name="mastery_enabled"' + (masteryEnabledChecked ? ' checked' : '') + '><span>Earn STAR</span></label>' +
                        '</span>' +
                        '<div class="assignment-edit-percentage' + (masteryEnabledChecked ? '' : ' is-disabled') + '">' +
                        percentagePickerTriggerHtml(
                            commonMastery,
                            'Mastery percentage',
                            'data-percent-input="mastery_percentage"' + (masteryEnabledChecked ? '' : ' disabled aria-disabled="true"'),
                            'Mixed / choose',
                            90
                        ) +
                        '<input type="hidden" name="mastery_percentage" value="' + escapeHtml(commonMastery) + '">' +
                        '</div>' +
                    '</div>' +
                    '<div class="dialog-actions">' +
                        '<button class="danger-button assignment-cancel-open-button" type="button" data-cancel-assignments' + (cancelableItems.length ? '' : ' disabled') + '>Cancel assignments</button>' +
                        '<button class="primary-button" type="submit">Save changes</button>' +
                    '</div>' +
                '</form>' +
            '</section>' +
            '<button class="progress-matrix-modal-close assignment-edit-external-close" type="button" ' +
                'data-assignment-edit-close aria-label="Close assignment parameters">Close</button>' +
            '</div>';
        document.body.appendChild(overlay);

        function close() {
            overlay.remove();
        }

        function refreshAssignmentViews() {
            return Promise.all([teacherCall('listAssignments'), loadProgressData(), loadCandidates()]).then(function(results) {
                state.assignments = results[0].assignments || [];
                state.progressItems = results[1].progress || [];
                renderSetOptions();
                renderStudentDetail();
                renderAssignmentOverview();
                updateAssignView();
            });
        }

        overlay.querySelector('[data-assignment-edit-close]').addEventListener('click', close);
        overlay.querySelectorAll('[data-percent-picker]').forEach(function(trigger) {
            trigger.addEventListener('click', function() {
                openPercentagePicker(trigger, function(value) {
                    setPercentagePickerTriggerValue(trigger, value);
                    var form = trigger.closest('form');
                    var inputName = trigger.getAttribute('data-percent-input');
                    if (form && inputName && form.elements[inputName]) {
                        form.elements[inputName].value = String(value);
                    }
                });
            });
        });
        var masteryEnabledInput = overlay.querySelector('input[name="mastery_enabled"]');
        var masteryPicker = overlay.querySelector('[data-percent-input="mastery_percentage"]');
        var masteryPickerShell = masteryPicker && masteryPicker.closest('.assignment-edit-percentage');
        function syncMasteryPicker() {
            var enabled = masteryEnabledInput && masteryEnabledInput.checked;
            if (masteryPicker) {
                masteryPicker.disabled = !enabled;
                masteryPicker.setAttribute('aria-disabled', enabled ? 'false' : 'true');
            }
            if (masteryPickerShell) masteryPickerShell.classList.toggle('is-disabled', !enabled);
        }
        if (masteryEnabledInput) {
            masteryEnabledInput.addEventListener('change', function() {
                syncMasteryPicker();
                if (masteryEnabledInput.checked && masteryPicker) masteryPicker.focus();
            });
        }
        syncMasteryPicker();
        overlay.addEventListener('click', function(event) {
            if (event.target === overlay) close();
        });
        overlay.querySelector('form').addEventListener('submit', function(event) {
            event.preventDefault();
            var form = event.currentTarget;
            var payload = {
                assignment_ids: items.map(assignmentStableId),
                mastery_enabled: form.elements.mastery_enabled.checked
            };
            if (!form.elements.due_week.value) {
                showMessage('Choose a Due week.', 'error');
                return;
            }
            payload.due_at = dueAtIsoForWeekStart(form.elements.due_week.value);
            if (!form.elements.passing_percentage.value) {
                showMessage('Choose a Passing percentage.', 'error');
                return;
            }
            payload.passing_percentage = form.elements.passing_percentage.value;
            if (payload.mastery_enabled) {
                if (!form.elements.mastery_percentage.value) {
                    showMessage('Choose a Mastery percentage.', 'error');
                    return;
                }
                payload.mastery_percentage = form.elements.mastery_percentage.value;
                if (Number(payload.mastery_percentage) < Number(payload.passing_percentage)) {
                    showMessage('Mastery percentage must be at least the Passing percentage.', 'error');
                    return;
                }
            }
            var submit = form.querySelector('button[type="submit"]');
            submit.disabled = true;
            submit.textContent = 'Saving...';
            teacherCall('updateAssignments', payload).then(function(result) {
                var updated = (result.updated || []).length;
                var missing = (result.missing || []).length;
                var skipped = (result.skipped || []).length;
                if (!updated) {
                    throw new Error(missing
                        ? 'The selected assignment records could not be found. Refresh Teacher View and try again.'
                        : 'No assignment parameters were updated.');
                }
                showMessage(updated + ' assignment(s) updated' +
                    (missing ? '; ' + missing + ' missing' : '') +
                    (skipped ? '; ' + skipped + ' skipped' : '') + '.',
                    missing || skipped ? 'error' : 'success');
                close();
                return refreshAssignmentViews();
            }).catch(function(error) {
                showMessage(error.message, 'error');
                submit.disabled = false;
                submit.textContent = 'Save changes';
            });
        });
        var cancelAssignmentsButton = overlay.querySelector('[data-cancel-assignments]');
        if (cancelAssignmentsButton) {
            cancelAssignmentsButton.addEventListener('click', function() {
                if (!cancelableItems.length) {
                    showMessage('No assignment can be cancelled in this selection.', 'error');
                    return;
                }
                openCancelAssignmentsConfirmation();
            });
        }

        function openCancelAssignmentsConfirmation() {
            if (document.querySelector('.assignment-cancel-confirm-overlay')) return;
            var confirmOverlay = document.createElement('div');
            confirmOverlay.className = 'assignment-cancel-confirm-overlay';
            confirmOverlay.innerHTML =
                '<section class="assignment-cancel-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="assignment-cancel-confirm-title">' +
                    '<span class="assignment-cancel-confirm-icon" aria-hidden="true">!</span>' +
                    '<h2 id="assignment-cancel-confirm-title">Cancel assignments?</h2>' +
                    '<p>This will remove ' + escapeHtml(cancelableItems.length) + ' assignment' + (cancelableItems.length === 1 ? '' : 's') +
                        ' from active assignment views. Existing attempts, learning progress, completed work, and STARs will stay saved.</p>' +
                    '<div class="assignment-cancel-confirm-actions">' +
                        '<button class="outline-button" type="button" data-keep-assignments>Keep assignments</button>' +
                        '<button class="danger-button" type="button" data-confirm-cancel-assignments>Cancel assignments</button>' +
                    '</div>' +
                '</section>';
            document.body.appendChild(confirmOverlay);
            var confirmButton = confirmOverlay.querySelector('[data-confirm-cancel-assignments]');
            var keepButton = confirmOverlay.querySelector('[data-keep-assignments]');

            function closeConfirmation() {
                document.removeEventListener('keydown', handleConfirmationKeydown, true);
                confirmOverlay.remove();
                if (cancelAssignmentsButton.isConnected) cancelAssignmentsButton.focus();
            }

            function handleConfirmationKeydown(event) {
                if (event.key === 'Escape') {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    closeConfirmation();
                    return;
                }
                if (event.key !== 'Tab') return;
                var first = keepButton;
                var last = confirmButton;
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first.focus();
                }
            }

            keepButton.addEventListener('click', closeConfirmation);
            confirmOverlay.addEventListener('click', function(event) {
                if (event.target === confirmOverlay) closeConfirmation();
            });
            confirmButton.addEventListener('click', function() {
                confirmButton.disabled = true;
                confirmButton.textContent = 'Cancelling...';
                teacherCall('cancelAssignments', {
                    assignment_ids: cancelableItems.map(assignmentStableId)
                }).then(function(result) {
                    var cancelled = (result.cancelled || []).length;
                    var skipped = (result.skipped || []).length;
                    state.selectedMatrixCell = '';
                    showMessage(cancelled + ' assignment(s) cancelled' + (skipped ? '; ' + skipped + ' skipped.' : '.'), 'success');
                    closeConfirmation();
                    close();
                    return refreshAssignmentViews();
                }).catch(function(error) {
                    showMessage(error.message, 'error');
                    confirmButton.disabled = false;
                    confirmButton.textContent = 'Cancel assignments';
                });
            });
            document.addEventListener('keydown', handleConfirmationKeydown, true);
            confirmButton.focus();
        }
        return true;
    }

    function handleAssignmentEditTrigger(event) {
        var target = event && event.target;
        var trigger = target && typeof target.closest === 'function'
            ? target.closest('[data-edit-assignment-scope]')
            : null;
        if (!trigger) return false;
        if (event.preventDefault) event.preventDefault();
        if (event.stopPropagation) event.stopPropagation();
        openAssignmentEditDialog(trigger.dataset.editAssignmentScope || '', trigger);
        return true;
    }

    function renderAssignmentProgressGroup(group) {
        var expanded = state.expandedAssignProgressGroups[group.key] === true;
        var metrics = group.metrics || assignmentOverviewMetrics(group.items, group.mode === 'task');
        var isStudentMode = group.mode === 'student';
        var isTaskMode = group.mode === 'task';
        state.assignmentEditScopes[group.key] = group;
        return '<article class="assignment-progress-group' + (isStudentMode ? ' student-history-group' : '') + (isTaskMode ? ' task-progress-group' : '') + (expanded ? ' expanded' : '') + '">' +
            '<button class="assignment-progress-group-head" type="button" data-assign-progress-group="' + escapeHtml(group.key) + '" aria-expanded="' + expanded + '">' +
                '<span class="assignment-progress-group-copy"><strong>' + escapeHtml(group.title || 'Group') + '</strong>' +
                    (isStudentMode ? '' : '<small>' + escapeHtml(group.subtitle || '') + '</small>') + '</span>' +
                (isStudentMode ? '' :
                '<span class="assignment-progress-group-stats">' +
                    '<span><strong>' + escapeHtml(metrics.total) + '</strong><small>Total</small></span>' +
                    '<span><strong>' + escapeHtml(formatPercent(metrics.average)) + '</strong><small>Avg</small></span>' +
                '</span>') +
            '</button>' +
            (expanded ? '<div class="assignment-progress-group-body">' +
                (isStudentMode
                    ? renderStudentHistoryList(group)
                    : renderAssignmentGroupTools(group) +
                        (group.mode === 'task' ? renderTaskScoreBars(group) : renderGroupMiniMatrix(group)) +
                        '<div class="assignment-table compact">' +
                            group.items.map(renderAssignmentOverviewRow).join('') +
                        '</div>') +
            '</div>' : '') +
        '</article>';
    }

    function renderAssignmentProgressModeTabs() {
        var mode = state.assignProgressMode || 'student';
        if (mode === 'class') mode = 'student';
        return '<div class="assignment-overview-toolbar">' +
            '<div class="assignment-progress-mode-tabs" role="tablist" aria-label="Assignment progress view">' +
                '<button class="assignment-progress-mode-tab' + (mode === 'student' ? ' active' : '') + '" type="button" data-assign-progress-mode="student">By student</button>' +
                '<button class="assignment-progress-mode-tab' + (mode === 'task' ? ' active' : '') + '" type="button" data-assign-progress-mode="task">By task</button>' +
            '</div>' +
        '</div>';
    }

    function matrixStudentKey(item) {
        return String(item.student_uid || item.auth_uid || item.student_id || 'unknown');
    }

    function matrixSetKey(item) {
        if (isSelfStudyMatrixItem(item)) {
            return 'self-study::' + String(item.progress_id || item.set_id || 'unknown');
        }
        if (item && item.assignment_batch_id) {
            var weekInfo = matrixWeekInfo(item);
            var weekKey = weekInfo && weekInfo.year != null && weekInfo.week != null
                ? String(weekInfo.year) + '-W' + String(weekInfo.week).padStart(2, '0')
                : 'unassigned';
            return 'batch::' + String(item.assignment_batch_id) + '::' + weekKey;
        }
        return [
            'legacy',
            String(item && item.set_id || 'unknown'),
            legacyMatrixAssignedBucket(item)
        ].join('::');
    }

    function assignmentCanEarnStar(item) {
        return !item || (item.mastery_enabled !== false && item.mastery_enabled !== 'false');
    }

    function matrixStatusIcon(item, status) {
        if (status === 'mastered') return assignmentCanEarnStar(item) ? '★' : '✓';
        if (status === 'passed') return '✓';
        if (status === 'cancelled') return '×';
        return '○';
    }

    function matrixStudentClass(item) {
        if (item.class_group) return String(item.class_group);
        var uid = item.student_uid || item.auth_uid || '';
        var student = state.students.find(function(profile) {
            return profile.auth_uid === uid || profile.student_id === item.student_id;
        });
        return student && student.class_group ? String(student.class_group) : '';
    }

    function matrixStudentName(item) {
        var uid = item.student_uid || item.auth_uid || '';
        var student = state.students.find(function(profile) {
            return profile.auth_uid === uid || profile.student_id === item.student_id;
        });
        return (student && studentDisplayName(student)) || item.student_name || item.student_id || 'Student';
    }

    function matrixStudentId(item) {
        var uid = item.student_uid || item.auth_uid || '';
        var student = state.students.find(function(profile) {
            return profile.auth_uid === uid || profile.student_id === item.student_id;
        });
        return item.student_id || (student && student.student_id) || '';
    }

    function matrixIndividualFilterValue(item) {
        return 'individual:' + matrixStudentKey(item);
    }

    function matrixClassOptions(items) {
        var classes = {};
        var individuals = {};
        items.forEach(function(item) {
            var className = matrixStudentClass(item);
            if (className) {
                classes[className] = true;
                return;
            }
            var key = matrixStudentKey(item);
            if (!individuals[key]) {
                individuals[key] = {
                    value: matrixIndividualFilterValue(item),
                    label: matrixStudentName(item)
                };
            }
        });
        return {
            classes: Object.keys(classes).sort(function(a, b) { return a.localeCompare(b); }),
            individuals: Object.keys(individuals).map(function(key) { return individuals[key]; })
                .sort(function(a, b) { return a.label.localeCompare(b.label); })
        };
    }

    function renderMatrixClassSelect(classOptions) {
        var classHtml = classOptions.classes.map(function(className) {
            return '<option value="' + escapeHtml(className) + '"' + (className === state.matrixClassFilter ? ' selected' : '') + '>' + escapeHtml(className) + '</option>';
        }).join('');
        var individualHtml = classOptions.individuals.map(function(student) {
            return '<option value="' + escapeHtml(student.value) + '"' + (student.value === state.matrixClassFilter ? ' selected' : '') + '>' + escapeHtml(student.label) + '</option>';
        }).join('');
        return '<select class="matrix-class-filter" id="matrix-class-filter" aria-label="Class">' +
            '<option value="">All</option>' +
            classHtml +
            individualHtml +
        '</select>';
    }

    function matrixClassFilterExists(classOptions, value) {
        if (!value) return true;
        if (classOptions.classes.indexOf(value) !== -1) return true;
        return classOptions.individuals.some(function(student) { return student.value === value; });
    }

    function matrixItemMatchesClassFilter(item) {
        var filter = state.matrixClassFilter || '';
        if (!filter) return true;
        if (filter.indexOf('individual:') === 0) {
            return !matrixStudentClass(item) && matrixIndividualFilterValue(item) === filter;
        }
        return matrixStudentClass(item) === filter;
    }

    function renderMatrixDateSelect() {
        var value = state.matrixDateFilter || 'all';
        var phoneLayout = matrixUsesPhoneLayout();
        var options = [
            { value: 'all', label: 'All time' },
            { value: 'week', label: (phoneLayout ? 'This ' : 'This week - ') + shanghaiCurrentWeekLabel(0) },
            { value: 'next_week', label: (phoneLayout ? 'Next ' : 'Next week - ') + shanghaiCurrentWeekLabel(7) },
            { value: 'last_week', label: (phoneLayout ? 'Last ' : 'Last week - ') + shanghaiCurrentWeekLabel(-7) },
            { value: 'self_study', label: 'Self study' }
        ];
        return '<select class="matrix-date-filter" id="matrix-date-filter" aria-label="Due week">' +
            options.map(function(option) {
                return '<option value="' + escapeHtml(option.value) + '"' + (option.value === value ? ' selected' : '') + '>' +
                    escapeHtml(option.label) + '</option>';
            }).join('') +
        '</select>';
    }

    function matrixColumnSource(item) {
        var set = state.sets.find(function(candidate) {
            return candidate.set_id === item.set_id || candidate.id === item.set_id;
        }) || {};
        return {
            set_id: item.set_id || set.set_id || set.id,
            title: item.set_title || set.title,
            course: item.course || set.course,
            type: item.type || set.type,
            section: item.section || set.section,
            section_id: item.section_id || set.section_id,
            sectionId: item.sectionId || set.sectionId,
            category: item.category || set.category
        };
    }

    function matrixColumnKey(item) {
        var source = matrixColumnSource(item);
        var category = setCategory(source);
        if (category !== 'other') return category;
        var raw = String(source.section || source.section_id || source.course || source.type || source.category || '').trim();
        if (raw) return raw.toLowerCase().replace(/\s+/g, '-');
        return 'other';
    }

    function matrixColumnLabel(key, item) {
        var labels = {
            'ielts-reading': 'IELTS Reading',
            'ielts-listening': 'IELTS Listening',
            'bbc-listening': 'BBC',
            ngsl: 'NGSL',
            nawl: 'NAWL',
            tk2: 'TK2',
            oxford5000: 'Oxford5000',
            grammar: 'Grammar',
            other: 'Other'
        };
        if (labels[key]) return labels[key];
        if (item) {
            var source = matrixColumnSource(item);
            var raw = String(source.section || source.section_id || source.course || source.type || source.category || '').trim();
            if (raw) return raw;
        }
        return key.split('-').map(function(part) {
            return part ? part.charAt(0).toUpperCase() + part.slice(1) : part;
        }).join(' ');
    }

    function matrixColumnOptions(items) {
        var columns = {};
        items.forEach(function(item) {
            var key = matrixColumnKey(item);
            if (!columns[key]) {
                columns[key] = matrixColumnLabel(key, item);
            }
        });
        return Object.keys(columns)
            .map(function(key) { return { key: key, label: columns[key] }; })
            .sort(function(a, b) {
                return filterOptionOrder(a.key) - filterOptionOrder(b.key) ||
                    a.label.localeCompare(b.label);
            });
    }

    function renderMatrixColumnSelect(columnOptions) {
        return '<select class="matrix-column-filter" id="matrix-column-filter" aria-label="Column">' +
            '<option value="">All type</option>' +
            columnOptions.map(function(column) {
                return '<option value="' + escapeHtml(column.key) + '"' + (column.key === state.matrixColumnFilter ? ' selected' : '') + '>' +
                    escapeHtml(column.label) + '</option>';
            }).join('') +
        '</select>';
    }

    function matrixUsesPhoneLayout() {
        return window.matchMedia
            ? window.matchMedia('(max-width: 760px)').matches
            : window.innerWidth <= 760;
    }

    function resolvedMatrixDensityStep() {
        if (state.matrixDensityStep != null) return state.matrixDensityStep;
        return matrixUsesPhoneLayout() ? 0 : MATRIX_DENSITY_TASK_WIDTHS.length - 1;
    }

    function matrixDensityClass(step) {
        var classes = [];
        if (step === 0) classes.push('matrix-density-fit');
        if (step <= 1) classes.push('matrix-density-tight');
        if (step <= 2) classes.push('matrix-density-condensed');
        return classes.join(' ');
    }

    function renderMatrixDensityControls() {
        var step = resolvedMatrixDensityStep();
        var lastStep = MATRIX_DENSITY_TASK_WIDTHS.length - 1;
        return '<div class="matrix-density-controls" role="group" aria-label="Matrix size">' +
            '<button class="matrix-density-button" type="button" data-matrix-density-action="smaller"' +
                (step === 0 ? ' disabled' : '') + ' aria-label="Make matrix smaller" title="Smaller">−</button>' +
            '<button class="matrix-density-fit-button' + (step === 0 ? ' active' : '') + '" type="button" ' +
                'data-matrix-density-action="fit" aria-pressed="' + (step === 0 ? 'true' : 'false') +
                '" aria-label="Fit the complete matrix to this screen" title="Fit to screen">Fit</button>' +
            '<button class="matrix-density-button" type="button" data-matrix-density-action="larger"' +
                (step === lastStep ? ' disabled' : '') + ' aria-label="Make matrix larger" title="Larger">+</button>' +
        '</div>';
    }

    function compactMatrixSetId(value) {
        var id = String(value || 'Task').trim();
        var match = id.match(/^([^-]+)-(.+)$/);
        if (!match) {
            return {
                lead: id.length > 5 ? id.slice(0, Math.ceil(id.length / 2)) : id,
                tail: id.length > 5 ? id.slice(Math.ceil(id.length / 2)) : ''
            };
        }
        var lead = match[1];
        if (/^OXFORD5000$/i.test(lead)) lead = 'OX5K';
        return { lead: lead, tail: match[2] };
    }

    function compactMatrixPercent(value) {
        var number = numericPercent(value);
        if (number == null) return '—';
        return (Math.round(number * 10) / 10).toString().replace(/\.0$/, '');
    }

    function setMatrixDensityStep(nextStep) {
        var step = Math.max(0, Math.min(MATRIX_DENSITY_TASK_WIDTHS.length - 1, Number(nextStep) || 0));
        if (step === resolvedMatrixDensityStep()) return;
        var container = document.getElementById('assignment-overview');
        var snapshot = matrixScrollSnapshot(container);
        state.matrixDensityStep = step;
        saveMatrixDensityPreference(step);
        renderAssignmentOverview();
        restoreMatrixScroll(snapshot);
    }

    function matrixAttemptsForItem(item) {
        return progressAttemptsForAssignment(item);
    }

    function matrixCellKey(item) {
        return [
            item.assignment_id || item.progress_id || '',
            item.student_uid || '',
            item.set_id || ''
        ].join('::');
    }

    function attemptDurationLabel(attempt) {
        if (!attempt) return '';
        var parts = [];
        var pageDuration = formatDuration(attempt.duration_seconds);
        var audioDuration = formatDuration(attempt.audio_to_submit_seconds);
        if (pageDuration) parts.push('Page ' + pageDuration);
        if (audioDuration) parts.push('Audio ' + audioDuration);
        return parts.join(' · ');
    }

    function compactAttemptDuration(value) {
        var seconds = Math.max(0, Math.round(Number(value)));
        if (!isFinite(seconds)) return '';
        if (seconds >= 3600) {
            return Math.floor(seconds / 3600) + 'h' +
                String(Math.floor((seconds % 3600) / 60)).padStart(2, '0') + 'm';
        }
        if (seconds >= 60) {
            return Math.floor(seconds / 60) + 'm' + String(seconds % 60).padStart(2, '0') + 's';
        }
        return seconds + 's';
    }

    function compactAttemptTimes(attempt) {
        if (!attempt) return '';
        var page = attempt.duration_seconds == null ? '' : compactAttemptDuration(attempt.duration_seconds);
        var audio = attempt.audio_to_submit_seconds == null ? '' : compactAttemptDuration(attempt.audio_to_submit_seconds);
        return (page ? '<small class="page-time">P' + escapeHtml(page) + '</small>' : '') +
            (audio ? '<small class="audio-time">A' + escapeHtml(audio) + '</small>' : '');
    }

    function attemptChartAriaLabel(attempt, number, percent) {
        var parts = ['Attempt ' + number, formatPercent(percent)];
        var pageDuration = formatDuration(attempt && attempt.duration_seconds);
        var audioDuration = formatDuration(attempt && attempt.audio_to_submit_seconds);
        if (pageDuration) parts.push('Page time ' + pageDuration);
        if (audioDuration) parts.push('Audio time ' + audioDuration);
        if (attempt && attempt.submitted_at) parts.push('Submitted ' + formatDateTime(attempt.submitted_at));
        return parts.join(', ');
    }

    function attemptDisplayNumber(attempt, index) {
        return attempt && attempt.attempt_number ? attempt.attempt_number : index + 1;
    }

    function isBbcAttempt(attempt, assignment) {
        return (attempt && attempt.mode === 'bbc') || /^BBC-/i.test(attemptSetId(attempt, assignment));
    }

    function isVocabularyAttempt(attempt, assignment) {
        var mode = String(attempt && attempt.mode || '');
        return mode.indexOf('vocabulary_') === 0 || setMatchesFamily(assignment || {}, 'vocabulary');
    }

    function vocabularyAttemptModeLabel(attempt, assignment) {
        if (!isVocabularyAttempt(attempt, assignment)) return '';
        return attempt && attempt.mode === 'vocabulary_practice_timed' ? 'Practice' : 'Quiz';
    }

    function vocabularyAttemptGroupLabels(attempt, assignment) {
        var ids = Array.isArray(attempt && attempt.selected_group_ids) ? attempt.selected_group_ids : [];
        if (!ids.length) return [];
        var data = questionTextCache[attemptSetId(attempt, assignment)];
        var groups = data && Array.isArray(data.quizGroups) ? data.quizGroups : [];
        if (!groups.length) return [];
        return ids.map(function(groupId) {
            var index = groups.findIndex(function(group) { return sameId(group.id, groupId); });
            if (index !== -1) return String(index + 1);
            var numericSuffix = String(groupId).match(/(?:^|\D)(\d+)$/);
            return numericSuffix ? String(Number(numericSuffix[1])) : String(groupId);
        }).sort(function(a, b) {
            var left = Number(a);
            var right = Number(b);
            return isFinite(left) && isFinite(right) ? left - right : String(a).localeCompare(String(b));
        });
    }

    function renderVocabularyAttemptContext(attempt, assignment) {
        var mode = vocabularyAttemptModeLabel(attempt, assignment);
        if (!mode) return '';
        var groups = vocabularyAttemptGroupLabels(attempt, assignment);
        var groupCount = Number(attempt && attempt.selected_group_count || groups.length || 0);
        var compactGroups = groups.map(function(group) {
            return String(group) === '10' ? 'X' : String(group);
        }).join('');
        return '<div class="matrix-attempt-context">' +
            '<span class="mode ' + (mode === 'Practice' ? 'practice' : 'quiz') + '">' + escapeHtml(mode) + '</span>' +
            (mode === 'Quiz'
                ? (groupCount ? '<span class="quiz-set-count">' + escapeHtml(groupCount) + ' sets</span>' : '')
                : (compactGroups ? '<span class="matrix-practice-group-sequence" aria-label="Selected practice groups: ' +
                    escapeHtml(groups.join(', ')) + '">' + escapeHtml(compactGroups) + '</span>' : '')) +
        '</div>';
    }

    function teacherQuestionNumber(questionId) {
        var raw = String(questionId == null || questionId === '' ? '?' : questionId).trim();
        var trailingNumber = raw.match(/(\d+)\D*$/);
        if (trailingNumber) return String(Number(trailingNumber[1]));
        return raw.replace(/^q(?:uestion)?[\s_:-]*/i, '') || '?';
    }

    function teacherQuestionLabel(questionId, attempt, assignment) {
        var value = isBbcAttempt(attempt, assignment) ? teacherQuestionNumber(questionId) : String(questionId || '?');
        return 'Q' + value;
    }

    function matrixAttemptEntries(attempts) {
        return (attempts || []).map(function(attempt, index) {
            return {
                attempt: attempt,
                number: attemptDisplayNumber(attempt, index),
                index: index
            };
        });
    }

    function matrixAttemptStatus(attempt, assignment) {
        if (attempt && attempt.mastered === true) return 'mastered';
        if (attempt && attempt.passed === true) return 'passed';
        var percent = numericPercent(attempt && attempt.percentage);
        if (percent == null) return 'not-passed';
        var mastery = numericPercent(assignment && assignment.mastery_percentage);
        var passing = numericPercent(assignment && assignment.passing_percentage);
        if (mastery == null) mastery = numericPercent(attempt && attempt.mastery_percentage);
        if (passing == null) passing = numericPercent(attempt && attempt.passing_percentage);
        var masteryEnabled = assignment && typeof assignment.mastery_enabled === 'boolean'
            ? assignment.mastery_enabled
            : attempt && typeof attempt.mastery_enabled === 'boolean'
                ? attempt.mastery_enabled
                : false;
        if (masteryEnabled && mastery != null && percent >= mastery) return 'mastered';
        if (passing != null && percent >= passing) return 'passed';
        return 'not-passed';
    }

    function backendAttemptChartValue(entries, assignment, field) {
        var assignmentValue = numericPercent(assignment && assignment[field]);
        if (assignmentValue != null) return assignmentValue;
        for (var index = entries.length - 1; index >= 0; index -= 1) {
            var attemptValue = numericPercent(entries[index].attempt && entries[index].attempt[field]);
            if (attemptValue != null) return attemptValue;
        }
        return null;
    }

    function backendAttemptChartMasteryEnabled(entries, assignment) {
        if (assignment && typeof assignment.mastery_enabled === 'boolean') return assignment.mastery_enabled;
        for (var index = entries.length - 1; index >= 0; index -= 1) {
            var attempt = entries[index].attempt;
            if (attempt && typeof attempt.mastery_enabled === 'boolean') return attempt.mastery_enabled;
        }
        return false;
    }

    function renderMatrixScoreLock(item) {
        var locked = item && (item.answer_revealed === true || item.mastery_locked === true);
        var label = locked ? 'Answers viewed; score locked' : 'Answers not viewed; score not locked';
        return '<span class="matrix-score-lock ' + (locked ? 'locked' : 'unlocked') +
            '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' +
            (locked ? '<span aria-hidden="true">&#128274;</span>' : '') +
            '<strong>' + escapeHtml(formatPercent(item && item.best_percentage)) + '</strong></span>';
    }

    function renderMatrixAttemptChart(entries, assignment) {
        if (!entries.length) return '<div class="matrix-attempt-empty">No attempt records yet.</div>';
        var passing = backendAttemptChartValue(entries, assignment, 'passing_percentage');
        var mastery = backendAttemptChartValue(entries, assignment, 'mastery_percentage');
        var masteryEnabled = backendAttemptChartMasteryEnabled(entries, assignment);
        var best = numericPercent(assignment && assignment.best_percentage);
        function thresholdLine(label, value, className) {
            var top = 31 + ((100 - value) / 100 * 82);
            return '<span class="matrix-attempt-threshold ' + className + '" style="top:' + escapeHtml(top.toFixed(2)) + 'px" aria-hidden="true">' +
                '<small>' + escapeHtml(label) + '</small></span>';
        }
        return '<div class="matrix-attempt-bars" aria-label="Attempt score history">' +
            '<div class="matrix-attempt-bars-track" style="--attempt-count:' + escapeHtml(entries.length) + '">' +
                (passing == null ? '' : thresholdLine('PASS ' + formatPercent(passing), passing, 'passing')) +
                (masteryEnabled && mastery != null ? thresholdLine('STAR ' + formatPercent(mastery), mastery, 'mastery') : '') +
                entries.map(function(entry) {
                var attempt = entry.attempt;
                var percent = Math.max(0, Math.min(100, Number(attempt.percentage || 0)));
                var scoreClass = ' ' + matrixAttemptStatus(attempt, assignment);
                var highlighted = state.targetMatrixAttemptId && attempt.attempt_id === state.targetMatrixAttemptId;
                var isBest = best != null && Math.abs(percent - best) < 0.01;
                var ariaLabel = attemptChartAriaLabel(attempt, entry.number, percent) + (isBest ? ', best score' : '');
                return '<button class="matrix-attempt-bar' + (highlighted ? ' highlight' : '') + (isBest ? ' best' : '') +
                    '" type="button" data-matrix-attempt-target="' + escapeHtml(entry.index) +
                    '" data-matrix-attempt-id="' + escapeHtml(attempt.attempt_id || '') +
                    '" data-matrix-review-set="' + escapeHtml(attemptSetId(attempt, assignment)) +
                    '" aria-label="' + escapeHtml(ariaLabel) + '" title="' + escapeHtml(ariaLabel) + '">' +
                    '<span class="matrix-attempt-score">' + escapeHtml(formatPercent(percent)) + '</span>' +
                    '<span class="matrix-attempt-track"><span class="matrix-attempt-fill' + scoreClass +
                    '" style="height:' + escapeHtml(Math.max(percent, 6)) + '%"></span></span>' +
                    '<span class="matrix-attempt-number">#' + escapeHtml(entry.number) + '</span>' +
                    '<span class="matrix-attempt-caption">' + compactAttemptTimes(attempt) + '</span>' +
                    '</button>';
                }).join('') +
            '</div>' +
        '</div>';
    }

    function renderMatrixAttemptWrongRows(attempt, assignment) {
        if (attempt && !attemptHasDetail(attempt)) {
            return attemptDetailPromises[String(attempt.attempt_id || '')]
                ? '<div class="matrix-wrong-empty loading">Loading answer comparison...</div>'
                : '';
        }
        var wrong = (attempt.question_results || []).filter(function(result) {
            return result.correct !== true;
        });
        if (!wrong.length) {
            return '<div class="matrix-wrong-empty">No wrong answers in this attempt.</div>';
        }
        return '<div class="matrix-answer-table">' +
            wrong.map(function(result) {
                var answer = result.submitted_answer == null || result.submitted_answer === ''
                    ? 'blank'
                    : result.submitted_answer;
                return '<div class="q-cell">' + escapeHtml(teacherQuestionLabel(result.question_id, attempt, assignment)) + '</div>' +
                    '<div class="student-answer">' + escapeHtml(formatAnswerText(answer, 'blank')) + '</div>' +
                    '<div class="correct-answer">' + escapeHtml(formatAnswerText(result.correct_answer, 'not available')) + '</div>';
            }).join('') +
        '</div>';
    }

    function renderPaperReviewIcon() {
        return '<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">' +
            '<path d="M7 3.75h7.4L18 7.35v12.9H7z"></path>' +
            '<path d="M14 3.75v4h4"></path>' +
            '<path d="M9.6 11.2h4.8"></path>' +
            '<path d="M9.6 14.2h4.8"></path>' +
            '<path d="M9.6 17.2h2.9"></path>' +
        '</svg>';
    }

    function attemptSetId(attempt, assignment) {
        return (attempt && attempt.set_id) || (assignment && assignment.set_id) || '';
    }

    function attemptQuestionText(result, attempt, assignment) {
        return result.question_text_snapshot ||
            getQuestionTextFromData(questionTextCache[attemptSetId(attempt, assignment)], result.question_id) ||
            '';
    }

    function renderMatrixAttemptReview(entry, entries, assignment) {
        var attempt = entry && entry.attempt;
        if (!attempt) return '';
        var duration = attemptDurationLabel(attempt);
        var results = attempt.question_results || [];
        var mistakesOnly = isBbcAttempt(attempt, assignment) || isVocabularyAttempt(attempt, assignment);
        var visibleResults = mistakesOnly ? results.filter(function(result) {
            return result.correct !== true;
        }) : results;
        var reportLabel = vocabularyAttemptModeLabel(attempt, assignment);
        return '<section class="matrix-work-review">' +
            '<div class="matrix-work-review-head">' +
                '<button class="matrix-review-back" type="button" data-matrix-review-back>Back to attempts</button>' +
                '<div><h3>Attempt #' + escapeHtml(entry.number) + (reportLabel ? ' · ' + escapeHtml(reportLabel) : '') + ' report</h3>' +
                '<small>' + escapeHtml(formatDateTime(attempt.submitted_at)) +
                (duration ? ' · ' + escapeHtml(duration) : '') +
                ' · ' + escapeHtml(formatPercent(attempt.percentage)) + '</small></div>' +
            '</div>' +
            renderVocabularyAttemptContext(attempt, assignment) +
            '<div class="matrix-work-history">' +
                '<strong>Attempt history</strong>' +
                '<span>' + escapeHtml(entries.map(function(item) {
                    return '#' + item.number + ' ' + formatPercent(item.attempt.percentage);
                }).join(' · ')) + '</span>' +
            '</div>' +
            (visibleResults.length
                ? '<div class="matrix-work-question-list">' + visibleResults.map(function(result) {
                    var correct = result.correct === true;
                    var questionText = attemptQuestionText(result, attempt, assignment);
                    return '<article class="matrix-work-question ' + (correct ? 'correct' : 'wrong') + '">' +
                        '<div class="matrix-work-question-top">' +
                            '<strong>' + escapeHtml(teacherQuestionLabel(result.question_id, attempt, assignment)) + '</strong>' +
                            '<span>' + (correct ? 'Correct' : 'Wrong') + '</span>' +
                        '</div>' +
                        (questionText
                            ? '<p class="matrix-work-question-text">' + escapeHtml(questionText) + '</p>'
                            : '<p class="matrix-work-question-text missing">Question text is not available from the current public data.</p>') +
                        '<div class="matrix-work-answer-grid">' +
                            '<div><small>Student answer</small><strong>' +
                                escapeHtml(formatAnswerText(result.submitted_answer, 'blank')) + '</strong></div>' +
                            '<div><small>Correct answer</small><strong>' +
                                escapeHtml(formatAnswerText(result.correct_answer, 'not available')) + '</strong></div>' +
                        '</div>' +
                        (isBbcAttempt(attempt, assignment)
                            ? '<div class="matrix-work-explanation"><small>Answer explanation</small><p>' +
                                escapeHtml(formatAnswerText(result.explanation, 'No explanation available yet.')) + '</p></div>'
                            : '') +
                    '</article>';
                }).join('') + '</div>'
                : '<div class="matrix-wrong-empty">' +
                    (mistakesOnly && results.length ? 'No wrong answers in this attempt.' : 'No per-question records are available for this attempt.') +
                '</div>') +
        '</section>';
    }

    function renderMatrixAttemptDetails(entries, assignment) {
        if (!entries.length) return '';
        var revealIds = state.notificationAttemptRevealIds || [];
        return '<div class="matrix-attempt-list">' +
            entries.slice().reverse().map(function(entry) {
                var attempt = entry.attempt;
                var highlighted = state.targetMatrixAttemptId && attempt.attempt_id === state.targetMatrixAttemptId;
                var revealIndex = revealIds.findIndex(function(attemptId) {
                    return String(attemptId || '') === String(attempt.attempt_id || '');
                });
                var answerRevealClass = revealIndex === -1 ? '' : ' is-revealing';
                var answerRevealStyle = revealIndex === -1
                    ? ''
                    : ' style="--attempt-reveal-order:' + escapeHtml(Math.min(revealIndex, 6)) + '"';
                return '<article class="matrix-attempt-card' + (highlighted ? ' highlight' : '') +
                    '" data-matrix-attempt-index="' + escapeHtml(entry.index) + '">' +
                    '<div class="matrix-attempt-head"><div class="matrix-attempt-identity"><h3>#' + escapeHtml(entry.number) + '</h3>' +
                        renderVocabularyAttemptContext(attempt, assignment) +
                    '</div>' +
                    '<time class="matrix-attempt-date" datetime="' + escapeHtml(attempt.submitted_at || '') + '">' +
                        escapeHtml(formatDateTime(attempt.submitted_at)) + '</time>' +
                        '<button class="matrix-work-button" type="button" data-matrix-review-attempt="' +
                            escapeHtml(attempt.attempt_id || '') + '" data-matrix-review-set="' +
                            escapeHtml(attemptSetId(attempt, assignment)) + '" aria-label="View full work for attempt ' +
                            escapeHtml(entry.number) + '" title="View full work">' +
                            renderPaperReviewIcon() +
                        '</button>' +
                    '</div>' +
                    '<div class="matrix-attempt-answer-region' + answerRevealClass + '"' + answerRevealStyle + '>' +
                        renderMatrixAttemptWrongRows(attempt, assignment) +
                    '</div>' +
                '</article>';
            }).join('') +
        '</div>';
    }

    function matrixAssignmentEditScopeKey(item) {
        return 'matrix-assignment::' + matrixCellKey(item);
    }

    function registerMatrixAssignmentEditScope(item, title) {
        var key = matrixAssignmentEditScopeKey(item);
        state.assignmentEditScopes[key] = {
            key: key,
            mode: 'single',
            title: item.student_name || item.student_id || 'Student',
            subtitle: title || item.set_id || '',
            items: [item]
        };
        return key;
    }

    function matrixColumnEditScopeKey(set) {
        return 'matrix-column::' + String(set && set.id || 'unknown');
    }

    function registerMatrixColumnEditScope(set) {
        var items = editableAssignments(set && set.items || []);
        if (!items.length) return '';
        var key = matrixColumnEditScopeKey(set);
        var sample = items[0] || {};
        var scopeLabel = state.matrixClassFilter
            ? (String(state.matrixClassFilter).indexOf('individual:') === 0
                ? (sample.student_name || sample.student_id || 'Individual')
                : state.matrixClassFilter)
            : 'All visible students';
        state.assignmentEditScopes[key] = {
            key: key,
            mode: 'task',
            title: set.title || set.set_id || 'Task',
            subtitle: scopeLabel + ' · ' + (set.set_id || ''),
            items: items
        };
        return key;
    }

    function renderMatrixCellDetail(item) {
        if (!item) return '';
        var attempts = matrixAttemptsForItem(item);
        var entries = matrixAttemptEntries(attempts);
        var reviewEntry = state.selectedMatrixReviewAttemptId
            ? entries.find(function(entry) {
                return entry.attempt && entry.attempt.attempt_id === state.selectedMatrixReviewAttemptId;
            })
            : null;
        var title = item.set_title || setTitleFor(item.set_id) || item.set_id || 'Set';
        var status = normalizedAssignmentStatus(item.status);
        var editButton = '';
        if (item.source !== 'self_study' && assignmentStableId(item) && status !== 'cancelled') {
            editButton = '<button class="matrix-edit-pill" type="button" data-edit-assignment-scope="' +
                escapeHtml(registerMatrixAssignmentEditScope(item, title)) + '"' +
                assignmentEditTriggerAttributes([item], item.student_name || item.student_id || 'Student', title) + '>Edit</button>';
        }
        return '<div class="progress-matrix-detail">' +
            '<div class="matrix-detail-summary">' +
                '<h2>' + escapeHtml(title) + '</h2>' +
                '<div class="matrix-detail-pills">' +
                    '<span class="matrix-detail-pill">' + escapeHtml(item.student_name || item.student_id || 'Student') + '</span>' +
                    renderMatrixScoreLock(item) +
                    editButton +
                '</div>' +
            '</div>' +
            renderMatrixAttemptChart(entries, item) +
            (reviewEntry ? renderMatrixAttemptReview(reviewEntry, entries, item) : renderMatrixAttemptDetails(entries, item)) +
        '</div>';
    }

    function scrollMatrixAttemptCardIntoView(root, options) {
        if (!root) return;
        var target = root.querySelector('.matrix-attempt-card.highlight');
        if (!target) return;
        var scroller = target.closest('.progress-matrix-modal-scroll') || target.closest('.progress-matrix-modal-shell');
        if (!scroller) return;
        var block = options && options.block || 'start';
        var behavior = options && options.behavior || 'auto';
        var scrollerRect = scroller.getBoundingClientRect();
        var targetRect = target.getBoundingClientRect();
        var nextTop = scroller.scrollTop + targetRect.top - scrollerRect.top;
        if (block === 'center') {
            nextTop -= Math.max(0, (scroller.clientHeight - target.offsetHeight) / 2);
        }
        nextTop = Math.max(0, nextTop);
        if (typeof scroller.scrollTo === 'function') {
            scroller.scrollTo({ top: nextTop, behavior: behavior });
        } else {
            scroller.scrollTop = nextTop;
        }
    }

    function renderMatrixCellModal(item) {
        if (!item) return '';
        return '<div class="progress-matrix-modal-backdrop" data-matrix-close="backdrop">' +
            '<div class="progress-matrix-modal-shell">' +
                '<section class="progress-matrix-modal" role="dialog" aria-modal="true" aria-label="Assignment details">' +
                    '<div class="progress-matrix-modal-scroll">' +
                        renderMatrixCellDetail(item) +
                    '</div>' +
                '</section>' +
                '<button class="progress-matrix-modal-close matrix-cell-external-close" type="button" ' +
                    'data-matrix-close="button" aria-label="Close assignment details">Close</button>' +
            '</div>' +
        '</div>';
    }

    function matrixStudentInitial(name) {
        var text = String(name || 'Student').trim();
        return text ? text.charAt(0).toUpperCase() : 'S';
    }

    function matrixStudentOverviewMetrics(items) {
        var total = items.length;
        var finishedItems = items.filter(function(item) {
            return isFinishedAssignmentStatus(normalizedAssignmentStatus(item.status));
        });
        var starKeys = {};
        finishedItems.forEach(function(item) {
            var status = normalizedAssignmentStatus(item.status);
            var hasStar = item.star_claimed === true || item.star_type === 'yellow' || item.star_type === 'blue' ||
                (status === 'mastered' && (isSelfStudyMatrixItem(item) || assignmentCanEarnStar(item)));
            if (!hasStar) return;
            var key = item.achievement_id || item.progress_id || item.assignment_id || item.set_id;
            if (key) starKeys[String(key)] = true;
        });
        return {
            total: total,
            finished: finishedItems.length,
            stars: Object.keys(starKeys).length,
            average: averageBestPercent(finishedItems)
        };
    }

    function matrixStudentProgressItems(studentKey, fallbackItems) {
        var source = state.progressItems.length ? state.progressItems : (fallbackItems || []);
        return source.filter(function(item) {
            return matrixStudentKey(item) === studentKey &&
                normalizedAssignmentStatus(item.status) !== 'cancelled';
        });
    }

    function matrixStudentCompletionDate(item) {
        if (!item || !isFinishedAssignmentStatus(normalizedAssignmentStatus(item.status))) return null;
        var value = item.mastered_at || item.completed_at || item.updated_at || item.latest_submitted_at || null;
        var date = value ? new Date(value) : null;
        return date && !isNaN(date.getTime()) ? date : null;
    }

    function matrixStudentProgressDate(parts) {
        return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    }

    function matrixStudentProgressKey(parts) {
        return parts.year + '-' + String(parts.month).padStart(2, '0') + '-' + String(parts.day).padStart(2, '0');
    }

    function matrixStudentIsoWeekNumber(parts) {
        var target = matrixStudentProgressDate(parts);
        var dayNumber = (target.getUTCDay() + 6) % 7;
        target.setUTCDate(target.getUTCDate() - dayNumber + 3);
        var firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
        var firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
        firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
        return 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604800000);
    }

    function matrixStudentMonthSerial(parts) {
        return parts.year * 12 + parts.month - 1;
    }

    function matrixStudentMonthParts(serial) {
        var year = Math.floor(serial / 12);
        return { year: year, month: serial - year * 12 + 1, day: 1 };
    }

    function matrixStudentMonthLabel(parts) {
        return new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC',
            year: 'numeric',
            month: 'long'
        }).format(new Date(Date.UTC(parts.year, parts.month - 1, 1)));
    }

    function matrixStudentSelectionLabel(selected) {
        if (!selected) return 'Completed work';
        if (selected.days) return selected.weekLabel;
        return new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC',
            month: 'short',
            day: 'numeric',
            weekday: 'short'
        }).format(new Date(selected.key + 'T12:00:00Z'));
    }

    function matrixStudentProgressModel(studentKey, items) {
        var today = shanghaiDateParts(new Date());
        if (!today) return { days: [], weeks: [], selected: null, weekdayLabels: [] };
        var currentMonthSerial = matrixStudentMonthSerial(today);
        var itemMonthSerials = (items || []).map(matrixStudentCompletionDate).filter(Boolean).map(function(date) {
            return matrixStudentMonthSerial(shanghaiDateParts(date));
        });
        var earliestMonthSerial = itemMonthSerials.length ? Math.min.apply(Math, itemMonthSerials) : currentMonthSerial;
        var requestedMonthSerial = Number(state.matrixStudentProgressMonths[studentKey]);
        if (!isFinite(requestedMonthSerial)) requestedMonthSerial = currentMonthSerial;
        requestedMonthSerial = Math.max(earliestMonthSerial, Math.min(currentMonthSerial, requestedMonthSerial));
        state.matrixStudentProgressMonths[studentKey] = requestedMonthSerial;
        var monthParts = matrixStudentMonthParts(requestedMonthSerial);
        var firstMonthDay = { year: monthParts.year, month: monthParts.month, day: 1 };
        var firstWeekStart = addShanghaiDays(firstMonthDay, -((shanghaiWeekday(firstMonthDay) + 6) % 7));
        var daysInMonth = new Date(Date.UTC(monthParts.year, monthParts.month, 0)).getUTCDate();
        var gridDayCount = Math.ceil((((shanghaiWeekday(firstMonthDay) + 6) % 7) + daysInMonth) / 7) * 7;
        var todayKey = matrixStudentProgressKey(today);
        var days = [];
        var daysByKey = {};
        var weeks = [];
        var weeksByKey = {};
        var weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        for (var weekIndex = 0; weekIndex < gridDayCount / 7; weekIndex++) {
            var weekParts = addShanghaiDays(firstWeekStart, weekIndex * 7);
            var weekStartKey = matrixStudentProgressKey(weekParts);
            var weekKey = 'week:' + weekStartKey;
            var week = {
                key: weekKey,
                weekLabel: 'W' + matrixStudentIsoWeekNumber(weekParts),
                days: [],
                items: []
            };
            weeks.push(week);
            weeksByKey[weekKey] = week;
            for (var dayIndex = 0; dayIndex < 7; dayIndex++) {
                var parts = addShanghaiDays(weekParts, dayIndex);
                var key = matrixStudentProgressKey(parts);
                var day = {
                    key: key,
                    weekKey: weekKey,
                    weekLabel: week.weekLabel,
                    dayLabel: weekdayLabels[dayIndex],
                    items: [],
                    day: parts.day,
                    outsideMonth: parts.month !== monthParts.month,
                    isFuture: key > todayKey
                };
                days.push(day);
                week.days.push(day);
                daysByKey[key] = day;
            }
        }

        (items || []).forEach(function(item) {
            var date = matrixStudentCompletionDate(item);
            var parts = date && shanghaiDateParts(date);
            var key = parts && matrixStudentProgressKey(parts);
            if (!key || !daysByKey[key] || daysByKey[key].outsideMonth) return;
            daysByKey[key].items.push(item);
        });

        days.forEach(function(day) {
            day.items.sort(function(left, right) {
                return matrixStudentCompletionDate(right).getTime() - matrixStudentCompletionDate(left).getTime();
            });
            day.hasStar = day.items.some(function(item) {
                return normalizedAssignmentStatus(item.status) === 'mastered' || item.star_claimed === true;
            });
            day.level = Math.min(4, day.items.length);
        });
        weeks.forEach(function(week) {
            week.items = week.days.reduce(function(result, day) {
                return result.concat(day.items);
            }, []).sort(function(left, right) {
                return matrixStudentCompletionDate(right).getTime() - matrixStudentCompletionDate(left).getTime();
            });
        });

        var selectedKey = state.matrixStudentProgressSelections[studentKey] || '';
        var selected = weeksByKey[selectedKey] || daysByKey[selectedKey];
        if (selected && selected.outsideMonth) selected = null;
        if (!selected) {
            var activeDays = days.filter(function(day) { return !day.outsideMonth && !day.isFuture && day.items.length; });
            selected = activeDays.length ? activeDays[activeDays.length - 1] :
                (requestedMonthSerial === currentMonthSerial ? daysByKey[todayKey] : null) ||
                days.find(function(day) { return !day.outsideMonth && !day.isFuture; });
        }
        state.matrixStudentProgressSelections[studentKey] = selected ? selected.key : '';
        return {
            days: days,
            weeks: weeks,
            selected: selected,
            weekdayLabels: weekdayLabels,
            monthParts: monthParts,
            monthLabel: matrixStudentMonthLabel(monthParts),
            canGoPrevious: requestedMonthSerial > earliestMonthSerial,
            canGoNext: requestedMonthSerial < currentMonthSerial
        };
    }

    function renderMatrixStudentProgressTask(item) {
        var source = matrixColumnSource(item);
        var kind = matrixColumnLabel(matrixColumnKey(item), item);
        return '<article class="progress-detail-task matrix-student-progress-task">' +
            '<strong>' + escapeHtml(item.set_title || source.title || setTitleFor(item.set_id) || item.set_id || 'Task') + '</strong>' +
            '<span class="progress-task-meta">' +
                '<span class="progress-task-type">' + escapeHtml(kind || 'Practice') + '</span>' +
                '<span class="progress-task-score">' + escapeHtml(formatPercent(item.best_percentage)) + '</span>' +
            '</span>' +
        '</article>';
    }

    function renderMatrixStudentProgressBoard(studentKey, items) {
        var model = matrixStudentProgressModel(studentKey, items);
        var weekBands = model.weeks.map(function(week) {
            var weekClasses = ['progress-week-band'];
            if (model.selected && (week.key === model.selected.key || week.key === model.selected.weekKey)) weekClasses.push('active');
            return '<div class="' + weekClasses.join(' ') + '">' +
                '<button class="progress-week-button" type="button" data-matrix-student-progress-week="' + escapeHtml(week.key) + '" aria-label="' +
                    escapeHtml(week.weekLabel + ', ' + week.items.length + ' finished this week') + '">' + escapeHtml(week.weekLabel) + '</button>' +
                '<div class="progress-week-days">' + week.days.map(function(day) {
                    var classes = ['progress-dot'];
                    if (day.level) classes.push('l' + day.level);
                    if (day.hasStar) classes.push('star');
                    if (day.isFuture) classes.push('future');
                    if (day.outsideMonth) classes.push('outside-month');
                    if (model.selected && day.key === model.selected.key) classes.push('active');
                    return '<button class="' + classes.join(' ') + '" type="button" data-matrix-student-progress-day="' +
                        escapeHtml(day.key) + '" aria-label="' + escapeHtml(day.weekLabel + ' ' + day.dayLabel + ' ' + day.day + ', ' + day.items.length + ' finished') + '"' +
                        (day.isFuture || day.outsideMonth ? ' disabled' : '') + '><span>' + escapeHtml(day.day) + '</span>' +
                        (day.hasStar ? '<i aria-hidden="true">★</i>' : '') + '</button>';
                }).join('') + '</div>' +
            '</div>';
        }).join('');
        var detail = model.selected && model.selected.items.length
            ? model.selected.items.map(renderMatrixStudentProgressTask).join('')
            : '<p class="matrix-student-progress-empty">No completed work for this selection.</p>';
        var detailCount = model.selected ? model.selected.items.length : 0;
        return '<div class="progress-board matrix-student-progress-board">' +
            '<section class="progress-map-panel">' +
                '<div class="matrix-student-calendar-toolbar">' +
                    '<button type="button" data-matrix-student-progress-month="previous" data-student-key="' + escapeHtml(studentKey) + '" aria-label="Previous month"' + (model.canGoPrevious ? '' : ' disabled') + '>‹</button>' +
                    '<h3>' + escapeHtml(model.monthLabel) + '</h3>' +
                    '<button type="button" data-matrix-student-progress-month="next" data-student-key="' + escapeHtml(studentKey) + '" aria-label="Next month"' + (model.canGoNext ? '' : ' disabled') + '>›</button>' +
                '</div>' +
                '<div class="progress-weekday-row" aria-hidden="true">' + model.weekdayLabels.map(function(label) {
                    return '<span>' + escapeHtml(label) + '</span>';
                }).join('') + '</div>' +
                '<div class="progress-week-band-list" aria-label="Monthly completion calendar">' + weekBands +
                '</div>' +
            '</section>' +
            '<section class="progress-detail-panel" aria-live="polite">' +
                '<div class="matrix-student-progress-detail-head"><h3>' + escapeHtml(matrixStudentSelectionLabel(model.selected)) + '</h3><span>' + escapeHtml(detailCount) + '</span></div>' +
                '<div class="progress-detail-list">' + detail + '</div>' +
            '</section>' +
        '</div>';
    }

    function shiftMatrixStudentProgressMonth(studentKey, offset) {
        var today = shanghaiDateParts(new Date());
        if (!today || !studentKey) return;
        var current = Number(state.matrixStudentProgressMonths[studentKey]);
        if (!isFinite(current)) current = matrixStudentMonthSerial(today);
        state.matrixStudentProgressMonths[studentKey] = current + offset;
        state.matrixStudentProgressSelections[studentKey] = '';
    }

    function renderMatrixStudentTimeline(items) {
        var sorted = items.slice().sort(function(a, b) {
            return new Date(assignmentSortDate(b) || 0) - new Date(assignmentSortDate(a) || 0) ||
                String(a.set_title || a.set_id || '').localeCompare(String(b.set_title || b.set_id || ''));
        });
        if (!sorted.length) {
            return '<div class="matrix-student-empty">No assigned work recorded for this student.</div>';
        }
        return '<div class="matrix-student-timeline">' +
            sorted.map(function(item) {
                var status = normalizedAssignmentStatus(item.status);
                var score = numericPercent(item.best_percentage);
                var fill = score == null ? 0 : Math.max(score, 4);
                var rowClass = status === 'mastered' ? ' mastered' : status === 'to_do' ? ' open' : status === 'cancelled' ? ' cancelled' : '';
                var date = assignmentSortDate(item);
                return '<article class="matrix-student-timeline-row' + rowClass + '">' +
                    '<span class="matrix-student-date">' + escapeHtml(date ? formatDate(date, '', 'compact') : 'Not yet') + '</span>' +
                    '<span class="matrix-student-task"><strong>' + escapeHtml(item.set_title || setTitleFor(item.set_id) || item.set_id || 'Task') + '</strong>' +
                    '<small>' + escapeHtml(item.set_id || '') + ' · ' + escapeHtml(assignmentStatusLabel(status)) + '</small></span>' +
                    '<span class="matrix-student-bar"><span style="width:' + escapeHtml(fill) + '%"></span></span>' +
                    '<span class="matrix-student-score">' + escapeHtml(formatPercent(item.best_percentage)) + '</span>' +
                '</article>';
            }).join('') +
        '</div>';
    }

    function renderMatrixStudentModal(studentKey, items) {
        if (!studentKey) return '';
        var matrixItems = (items || []).filter(function(item) {
            return matrixStudentKey(item) === studentKey;
        });
        var studentItems = matrixStudentProgressItems(studentKey, items);
        if (!matrixItems.length && !studentItems.length) return '';
        var sample = matrixItems[0] || studentItems[0];
        var name = matrixStudentName(sample);
        var className = matrixStudentClass(sample) || 'Individual';
        var metrics = matrixStudentOverviewMetrics(studentItems);
        return '<div class="progress-matrix-modal-backdrop" data-matrix-close="backdrop">' +
            '<div class="progress-matrix-modal-shell">' +
                '<section class="progress-matrix-modal matrix-student-modal" role="dialog" aria-modal="true" aria-label="Student monthly progress">' +
                    '<div class="progress-matrix-modal-scroll">' +
                        '<div class="matrix-student-overview">' +
                            '<div class="matrix-student-identity">' +
                                '<span class="matrix-student-avatar">' + escapeHtml(matrixStudentInitial(name)) + '</span>' +
                                '<span><h2>' + escapeHtml(name) + '</h2></span>' +
                            '</div>' +
                            '<div class="matrix-student-stats">' +
                                '<span><strong>' + escapeHtml(className) + '</strong><small>Class</small></span>' +
                                '<span><strong>' + escapeHtml(metrics.stars) + '</strong><small>STAR</small></span>' +
                                '<span><strong>' + escapeHtml(metrics.finished + '/' + metrics.total) + '</strong><small>Completed</small></span>' +
                            '</div>' +
                        '</div>' +
                        renderMatrixStudentProgressBoard(studentKey, studentItems) +
                    '</div>' +
                    '<div class="matrix-modal-actions">' +
                        '<button class="progress-matrix-modal-close" type="button" data-matrix-close="button" aria-label="Close">Close</button>' +
                    '</div>' +
                '</section>' +
            '</div>' +
        '</div>';
    }

    function closeMatrixCellModal(container) {
        state.selectedMatrixCell = '';
        state.selectedMatrixStudentKey = '';
        state.selectedProgressDetailKey = '';
        state.targetMatrixAttemptId = '';
        clearTeacherMatrixModals();
        if (!container) return;
        container.querySelectorAll('.progress-matrix-cell.selected').forEach(function(cell) {
            cell.classList.remove('selected');
        });
    }

    function matrixScrollSnapshot(container) {
        var scroll = container && container.querySelector('.progress-matrix-scroll');
        var snapshot = {
            left: scroll ? scroll.scrollLeft : 0,
            top: scroll ? scroll.scrollTop : 0,
            windowX: window.pageXOffset || document.documentElement.scrollLeft || 0,
            windowY: window.pageYOffset || document.documentElement.scrollTop || 0
        };
        if (scroll) {
            var scrollRect = scroll.getBoundingClientRect();
            var stickyCell = scroll.querySelector('.progress-matrix-head .progress-matrix-student-cell');
            var visibleLeft = stickyCell ? stickyCell.getBoundingClientRect().right : scrollRect.left;
            var headers = Array.prototype.slice.call(scroll.querySelectorAll('[data-matrix-column-key]'));
            var anchor = headers.find(function(header) {
                return header.getBoundingClientRect().right > visibleLeft + 1;
            });
            if (anchor) {
                snapshot.column_anchor_key = anchor.dataset.matrixColumnKey || '';
                snapshot.column_anchor_offset = anchor.getBoundingClientRect().left - visibleLeft;
            }
        }
        if (container) {
            var groupButtons = Array.prototype.slice.call(container.querySelectorAll('[data-assign-progress-group]'));
            var pageAnchor = groupButtons.find(function(button) {
                var rect = button.getBoundingClientRect();
                return rect.bottom > 0 && rect.top < window.innerHeight;
            });
            if (pageAnchor) {
                snapshot.page_anchor_key = pageAnchor.dataset.assignProgressGroup || '';
                snapshot.page_anchor_offset = pageAnchor.getBoundingClientRect().top;
            }
        }
        return snapshot;
    }

    function restoreMatrixScroll(snapshot) {
        if (!snapshot) return;
        function restore() {
            var container = document.getElementById('assignment-overview');
            var scroll = container && container.querySelector('.progress-matrix-scroll');
            if (scroll) {
                scroll.scrollLeft = snapshot.left || 0;
                scroll.scrollTop = snapshot.top || 0;
                if (snapshot.column_anchor_key) {
                    var headers = Array.prototype.slice.call(scroll.querySelectorAll('[data-matrix-column-key]'));
                    var anchor = headers.find(function(header) {
                        return header.dataset.matrixColumnKey === snapshot.column_anchor_key;
                    });
                    if (anchor) {
                        var scrollRect = scroll.getBoundingClientRect();
                        var stickyCell = scroll.querySelector('.progress-matrix-head .progress-matrix-student-cell');
                        var visibleLeft = stickyCell ? stickyCell.getBoundingClientRect().right : scrollRect.left;
                        var currentOffset = anchor.getBoundingClientRect().left - visibleLeft;
                        scroll.scrollLeft += currentOffset - Number(snapshot.column_anchor_offset || 0);
                    }
                }
            }
            window.scrollTo(snapshot.windowX || 0, snapshot.windowY || 0);
            if (container && snapshot.page_anchor_key) {
                var groupButtons = Array.prototype.slice.call(container.querySelectorAll('[data-assign-progress-group]'));
                var pageAnchor = groupButtons.find(function(button) {
                    return button.dataset.assignProgressGroup === snapshot.page_anchor_key;
                });
                if (pageAnchor) {
                    var pageOffset = pageAnchor.getBoundingClientRect().top - Number(snapshot.page_anchor_offset || 0);
                    if (Math.abs(pageOffset) > 0.5) window.scrollBy(0, pageOffset);
                }
            }
        }
        restore();
        window.requestAnimationFrame(function() {
            window.requestAnimationFrame(restore);
        });
    }

    function renderAssignmentMatrix(items) {
        if (!items.length) return '';
        var classOptions = matrixClassOptions(items);
        if (!matrixClassFilterExists(classOptions, state.matrixClassFilter)) {
            state.matrixClassFilter = '';
        }
        var columnOptions = matrixColumnOptions(items);
        if (state.matrixColumnFilter && !columnOptions.some(function(column) { return column.key === state.matrixColumnFilter; })) {
            state.matrixColumnFilter = '';
        }
        var classSelect = renderMatrixClassSelect(classOptions);
        var dateSelect = renderMatrixDateSelect();
        var columnSelect = renderMatrixColumnSelect(columnOptions);
        var matrixItems = items.filter(matrixItemMatchesClassFilter);
        if (state.matrixColumnFilter) {
            matrixItems = matrixItems.filter(function(item) {
                return matrixColumnKey(item) === state.matrixColumnFilter;
            });
        }
        matrixItems = matrixItems.filter(matrixItemMatchesDate);
        if (!matrixItems.length) {
            return '<section class="progress-matrix-card">' +
                '<div class="progress-matrix-title"><div class="progress-matrix-tools">' + classSelect + columnSelect + dateSelect + '<span>No matching records</span></div></div>' +
                '<div class="empty-card"><strong>No matching records</strong>Adjust the filters to see assignment progress.</div>' +
            '</section>';
        }
        var setMap = {};
        var studentMap = {};
        matrixItems.forEach(function(item) {
            var setKey = matrixSetKey(item);
            var weekInfo = matrixWeekInfo(item);
            if (!setMap[setKey]) {
                setMap[setKey] = {
                    id: setKey,
                    set_id: item.set_id || setKey,
                    title: item.set_title || setTitleFor(item.set_id),
                    date: new Date(matrixDateValue(item) || 0).getTime(),
                    week_label: weekInfo && weekInfo.label || '',
                    items: []
                };
            } else {
                setMap[setKey].date = Math.max(setMap[setKey].date, new Date(matrixDateValue(item) || 0).getTime());
            }
            setMap[setKey].items.push(item);
            var studentKey = matrixStudentKey(item);
            if (!studentMap[studentKey]) {
                studentMap[studentKey] = {
                    key: studentKey,
                    name: item.student_name || item.student_id || 'Student',
                    items: {}
                };
            }
            var current = studentMap[studentKey].items[setKey];
            if (!current || new Date(matrixDateValue(item) || 0) > new Date(matrixDateValue(current) || 0)) {
                studentMap[studentKey].items[setKey] = item;
            }
        });
        var allSets = Object.keys(setMap).map(function(key) { return setMap[key]; })
            .sort(function(a, b) { return b.date - a.date || a.title.localeCompare(b.title); });
        var sets = allSets;
        var allStudents = Object.keys(studentMap).map(function(key) { return studentMap[key]; })
            .sort(function(a, b) { return a.name.localeCompare(b.name); });
        var students = allStudents;
        if (!sets.length || !students.length) return '';
        var densityStep = resolvedMatrixDensityStep();
        var studentHeaderLabel = '';
        var dueHeaderLabel = densityStep <= 1 ? 'Due' : 'DUE AT';
        students.forEach(function(student) {
            student.displayName = matrixStudentDisplayName(student.name, densityStep);
        });
        var selectedItem = null;
        var maxStudentNameWidth = students.reduce(function(max, student) {
            return Math.max(max, matrixTextWidthCh(student.displayName));
        }, Math.max(matrixTextWidthCh(studentHeaderLabel), matrixTextWidthCh(dueHeaderLabel)));
        var studentColCh = Math.max(densityStep === 0 ? 3 : 5, Math.min(20, maxStudentNameWidth + 2));
        var taskColumnWidth = MATRIX_DENSITY_TASK_WIDTHS[densityStep];
        var matrixStyle = '--matrix-cols:' + sets.length +
            ';--matrix-student-col:' + studentColCh + 'ch' +
            ';--matrix-task-col:' + taskColumnWidth + 'px' +
            ';--matrix-min:calc(var(--matrix-student-col) + ' + (sets.length * taskColumnWidth) + 'px)' +
            ';--matrix-student-col-fit:var(--matrix-student-col)' +
            ';--matrix-fit-min:calc(var(--matrix-student-col-fit) + ' + (sets.length * MATRIX_DENSITY_TASK_WIDTHS[0]) + 'px)';
        var header = '<div class="progress-matrix-row progress-matrix-head" style="' + escapeHtml(matrixStyle) + '">' +
            '<span class="progress-matrix-student-cell" aria-label="Students"></span>' +
            sets.map(function(set) {
                var title = set.title || set.id || 'Task';
                var compactId = compactMatrixSetId(set.set_id || set.id);
                var sourceSet = state.sets.find(function(item) {
                    return String(item.set_id || item.id || '') === String(set.set_id || '');
                }) || set;
                var href = teacherPracticeHref(sourceSet, 'teacher.html?view=view');
                var tag = href && href !== '#' ? 'a' : 'span';
                return '<' + tag + ' class="progress-matrix-task-head" title="' + escapeHtml(title) + '"' +
                    ' data-matrix-column-key="' + escapeHtml(set.id) + '"' +
                    (tag === 'a' ? ' href="' + escapeHtml(href) + '" data-open-href="' + escapeHtml(href) +
                        '" data-entry-kind="Teacher preview" data-entry-title="' + escapeHtml(title) +
                        '" aria-haspopup="dialog" aria-label="Confirm teacher preview for ' + escapeHtml(title) + '"' : '') + '>' +
                    '<strong class="progress-matrix-task-id-full">' + escapeHtml(set.set_id || set.id) + '</strong>' +
                    '<strong class="progress-matrix-task-id-compact" aria-hidden="true"><span>' +
                        escapeHtml(compactId.lead) + '</span>' +
                        (compactId.tail ? '<span>' + escapeHtml(compactId.tail) + '</span>' : '') + '</strong>' +
                    '<small class="progress-matrix-task-name">' + escapeHtml(title) + '</small>' +
                '</' + tag + '>';
            }).join('') +
        '</div>';
        var dueRow = '<div class="progress-matrix-row progress-matrix-due-row" style="' + escapeHtml(matrixStyle) + '">' +
            '<span class="progress-matrix-student-cell" title="Editable assignment parameters" aria-label="Due at parameters">' +
                '<span class="matrix-due-parameter-label">' +
                    '<svg viewBox="0 0 20 20" aria-hidden="true" focusable="false">' +
                        '<path d="M3 6h14M3 14h14"></path><circle cx="8" cy="6" r="2"></circle><circle cx="13" cy="14" r="2"></circle>' +
                    '</svg><span>' + escapeHtml(dueHeaderLabel) + '</span>' +
                '</span>' +
            '</span>' +
            sets.map(function(set) {
                var title = set.title || set.id || 'Task';
                var dueLabel = set.week_label || '—';
                var editScope = registerMatrixColumnEditScope(set);
                var tag = editScope ? 'button' : 'span';
                return '<' + tag + ' class="progress-matrix-due-cell"' +
                    (editScope ? ' type="button" data-edit-assignment-scope="' + escapeHtml(editScope) +
                        '"' + assignmentEditTriggerAttributes(
                            state.assignmentEditScopes[editScope] && state.assignmentEditScopes[editScope].items || [],
                            title,
                            state.assignmentEditScopes[editScope] && state.assignmentEditScopes[editScope].subtitle || ''
                        ) +
                        ' title="Edit class parameters for ' + escapeHtml(title) +
                        '" aria-label="Edit class parameters for ' + escapeHtml(title) + ', due ' + escapeHtml(dueLabel) + '"' : '') + '>' +
                    '<span class="matrix-due-parameter-pill">' + escapeHtml(dueLabel) + '</span></' + tag + '>';
            }).join('') +
        '</div>';
        var rows = students.map(function(student) {
            return '<div class="progress-matrix-row" style="' + escapeHtml(matrixStyle) + '">' +
                '<button class="progress-matrix-student-cell progress-matrix-student-button' +
                    (student.key === state.selectedMatrixStudentKey ? ' selected' : '') +
                    '" type="button" data-matrix-student="' + escapeHtml(student.key) + '" title="' +
                    escapeHtml(student.name) + '" aria-label="Open progress for ' + escapeHtml(student.name) + '">' +
                    '<strong>' + escapeHtml(student.displayName) + '</strong></button>' +
                sets.map(function(set) {
                    var item = student.items[set.id];
                    if (!item) return '<span class="progress-matrix-cell empty">-</span>';
                    var title = set.title || set.set_id || set.id || 'Task';
                    var status = normalizedAssignmentStatus(item.status);
                    var score = numericPercent(item.best_percentage);
                    var statusIcon = matrixStatusIcon(item, status);
                    var label = status === 'cancelled' ? 'Cancelled' : score == null ? '—' : formatPercent(score);
                    var compactLabel = status === 'cancelled' ? '—' : compactMatrixPercent(score);
                    var cellKey = matrixCellKey(item);
                    if (cellKey === state.selectedMatrixCell) selectedItem = item;
                    return '<button class="progress-matrix-cell ' + escapeHtml(status) +
                        (cellKey === state.selectedMatrixCell ? ' selected' : '') +
                        '" type="button" data-matrix-cell="' + escapeHtml(cellKey) + '" aria-label="' +
                        escapeHtml(student.name + ', ' + title + ', ' + label + ' best') + '" title="' +
                        escapeHtml(formatPercent(item.best_percentage) + ' best · click for answers') + '">' +
                        '<span class="progress-matrix-status-icon" aria-hidden="true">' + escapeHtml(statusIcon) + '</span>' +
                        '<span class="progress-matrix-status-score progress-matrix-status-score-full">' + escapeHtml(label) + '</span>' +
                        '<span class="progress-matrix-status-score progress-matrix-status-score-compact" aria-hidden="true">' +
                            escapeHtml(compactLabel) + '</span>' +
                        '</button>';
                }).join('') +
            '</div>';
        }).join('');
        var detailHtml = selectedItem
            ? renderMatrixCellModal(selectedItem)
            : renderMatrixStudentModal(state.selectedMatrixStudentKey, items);
        return '<section class="progress-matrix-card">' +
            '<div class="progress-matrix-title"><div class="progress-matrix-tools">' + classSelect + columnSelect + dateSelect + '</div>' +
                renderMatrixDensityControls() + '</div>' +
            '<div class="progress-matrix-scroll ' + escapeHtml(matrixDensityClass(densityStep)) + '">' + header + dueRow + rows + '</div>' +
        '</section>' +
        detailHtml;
    }

    function renderAssignmentOverview() {
        var container = document.getElementById('assignment-overview');
        if (!container) return;
        clearTeacherMatrixModals();
        var items = sortAssignmentOverviewItems(assignedProgressItems());
        state.assignmentEditScopes = {};
        var shouldRevealMatrix = state.matrixInitialRevealPending && items.length;
        if (state.matrixInitialRevealPending) state.matrixInitialRevealPending = false;
        container.classList.remove('matrix-reveal-ready');
        if (!items.length) {
            container.innerHTML = '<div class="empty-card"><strong>No assigned work yet</strong>Assignments will appear here after you create them.</div>';
            return;
        }
        var progressMode = state.assignProgressMode === 'task' ? 'task' : 'student';
        state.assignProgressMode = progressMode;
        var groups = assignmentProgressGroups(items, progressMode);
        var selectedProgressDetailItem = state.selectedProgressDetailKey
            ? items.find(function(item) { return assignmentProgressKey(item) === state.selectedProgressDetailKey; })
            : null;
        container.innerHTML = renderAssignmentMatrix(items) + renderAssignmentProgressModeTabs() +
            '<div class="assignment-progress-groups">' +
                groups.map(renderAssignmentProgressGroup).join('') +
            '</div>' +
            (selectedProgressDetailItem ? renderMatrixCellModal(selectedProgressDetailItem) : '');
        if (shouldRevealMatrix) {
            container.classList.add('matrix-reveal-ready');
            window.setTimeout(function() {
                container.classList.remove('matrix-reveal-ready');
            }, 720);
        }
        container.querySelectorAll('[data-assign-progress-mode]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.assignProgressMode = button.dataset.assignProgressMode === 'task' ? 'task' : 'student';
                state.selectedMatrixStudentKey = '';
                renderAssignmentOverview();
            });
        });
        var matrixClassFilter = document.getElementById('matrix-class-filter');
        if (matrixClassFilter) {
            matrixClassFilter.addEventListener('change', function() {
                state.matrixClassFilter = matrixClassFilter.value;
                state.selectedMatrixCell = '';
                state.selectedMatrixStudentKey = '';
                state.selectedMatrixReviewAttemptId = '';
                renderAssignmentOverview();
            });
        }
        var matrixDateFilter = document.getElementById('matrix-date-filter');
        if (matrixDateFilter) {
            matrixDateFilter.addEventListener('change', function() {
                state.matrixDateFilter = matrixDateFilter.value;
                state.selectedMatrixCell = '';
                state.selectedMatrixStudentKey = '';
                state.selectedMatrixReviewAttemptId = '';
                renderAssignmentOverview();
            });
        }
        var matrixColumnFilter = document.getElementById('matrix-column-filter');
        if (matrixColumnFilter) {
            matrixColumnFilter.addEventListener('change', function() {
                state.matrixColumnFilter = matrixColumnFilter.value;
                state.selectedMatrixCell = '';
                state.selectedMatrixStudentKey = '';
                state.selectedMatrixReviewAttemptId = '';
                renderAssignmentOverview();
            });
        }
        container.querySelectorAll('[data-matrix-density-action]').forEach(function(button) {
            button.addEventListener('click', function() {
                var action = button.dataset.matrixDensityAction;
                var step = resolvedMatrixDensityStep();
                if (action === 'fit') setMatrixDensityStep(0);
                if (action === 'smaller') setMatrixDensityStep(step - 1);
                if (action === 'larger') setMatrixDensityStep(step + 1);
            });
        });
        container.querySelectorAll('[data-matrix-student]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.matrixStudent || '';
                var scrollSnapshot = matrixScrollSnapshot(container);
                state.selectedMatrixStudentKey = state.selectedMatrixStudentKey === key ? '' : key;
                state.selectedMatrixCell = '';
                state.selectedProgressDetailKey = '';
                state.targetMatrixAttemptId = '';
                state.selectedMatrixReviewAttemptId = '';
                renderAssignmentOverview();
                restoreMatrixScroll(scrollSnapshot);
            });
        });
        container.querySelectorAll('[data-matrix-student-progress-day], [data-matrix-student-progress-week]').forEach(function(button) {
            button.addEventListener('click', function(event) {
                event.stopPropagation();
                var key = button.dataset.matrixStudentProgressDay || button.dataset.matrixStudentProgressWeek || '';
                var studentKey = state.selectedMatrixStudentKey || '';
                if (!key || !studentKey) return;
                var scrollSnapshot = matrixScrollSnapshot(container);
                state.matrixStudentProgressSelections[studentKey] = key;
                renderAssignmentOverview();
                restoreMatrixScroll(scrollSnapshot);
            });
        });
        container.querySelectorAll('[data-matrix-student-progress-month]').forEach(function(button) {
            button.addEventListener('click', function(event) {
                event.stopPropagation();
                var studentKey = button.dataset.studentKey || state.selectedMatrixStudentKey || '';
                if (!studentKey) return;
                var scrollSnapshot = matrixScrollSnapshot(container);
                shiftMatrixStudentProgressMonth(studentKey, button.dataset.matrixStudentProgressMonth === 'next' ? 1 : -1);
                renderAssignmentOverview();
                restoreMatrixScroll(scrollSnapshot);
            });
        });
        container.querySelectorAll('[data-matrix-cell]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.matrixCell;
                var item = items.find(function(candidate) { return matrixCellKey(candidate) === key; });
                var scrollSnapshot = matrixScrollSnapshot(container);
                state.selectedMatrixCell = state.selectedMatrixCell === key ? '' : key;
                state.selectedMatrixStudentKey = '';
                state.selectedProgressDetailKey = '';
                state.targetMatrixAttemptId = '';
                state.selectedMatrixReviewAttemptId = '';
                renderAssignmentOverview();
                restoreMatrixScroll(scrollSnapshot);
                if (state.selectedMatrixCell && item) {
                    loadProgressAttemptThread(item).then(function() {
                        if (state.selectedMatrixCell === key) renderAssignmentOverview();
                    });
                }
            });
        });
        container.querySelectorAll('[data-matrix-close]').forEach(function(button) {
            button.addEventListener('click', function(event) {
                if (button.dataset.matrixClose === 'backdrop' && event.target !== button) return;
                state.selectedMatrixReviewAttemptId = '';
                closeMatrixCellModal(container);
            });
        });
        container.querySelectorAll('[data-matrix-review-attempt]').forEach(function(button) {
            button.addEventListener('click', function(event) {
                event.stopPropagation();
                openAttemptPaperReview(
                    button.dataset.matrixReviewAttempt || '',
                    button.dataset.matrixReviewSet || '',
                    renderAssignmentOverview
                );
            });
        });
        container.querySelectorAll('[data-matrix-review-back]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.selectedMatrixReviewAttemptId = '';
                renderAssignmentOverview();
            });
        });
        container.querySelectorAll('[data-matrix-attempt-target]').forEach(function(button) {
            button.addEventListener('click', function() {
                if (state.selectedMatrixReviewAttemptId && button.dataset.matrixAttemptId) {
                    openAttemptPaperReview(
                        button.dataset.matrixAttemptId,
                        button.dataset.matrixReviewSet || '',
                        renderAssignmentOverview
                    );
                    return;
                }
                state.targetMatrixAttemptId = '';
                var modal = button.closest('.progress-matrix-modal-shell');
                var target = modal && modal.querySelector('[data-matrix-attempt-index="' + button.dataset.matrixAttemptTarget + '"]');
                if (target) {
                    modal.querySelectorAll('.matrix-attempt-bar.highlight').forEach(function(bar) {
                        bar.classList.remove('highlight');
                    });
                    button.classList.add('highlight');
                    modal.querySelectorAll('.matrix-attempt-card.highlight').forEach(function(card) {
                        card.classList.remove('highlight');
                    });
                    target.classList.add('highlight');
                    scrollMatrixAttemptCardIntoView(modal, { behavior: 'smooth', block: 'start' });
                }
            });
        });
        if (state.targetMatrixAttemptId) {
            scrollMatrixAttemptCardIntoView(teacherModalRoot || container, { behavior: 'auto', block: 'center' });
        }
        container.querySelectorAll('[data-assign-progress-group]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.assignProgressGroup;
                var scrollSnapshot = matrixScrollSnapshot(container);
                state.expandedAssignProgressGroups[key] = state.expandedAssignProgressGroups[key] !== true;
                state.selectedMatrixStudentKey = '';
                state.selectedProgressDetailKey = '';
                renderAssignmentOverview();
                restoreMatrixScroll(scrollSnapshot);
            });
        });
        container.querySelectorAll('[data-assign-progress]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.assignProgress;
                var scrollSnapshot = matrixScrollSnapshot(container);
                state.expandedAssignProgress[key] = state.expandedAssignProgress[key] !== true;
                renderAssignmentOverview();
                restoreMatrixScroll(scrollSnapshot);
            });
        });
        container.querySelectorAll('[data-student-history-progress]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.selectedProgressDetailKey = button.dataset.studentHistoryProgress || '';
                var item = items.find(function(candidate) {
                    return assignmentProgressKey(candidate) === state.selectedProgressDetailKey;
                });
                state.selectedMatrixCell = '';
                state.selectedMatrixStudentKey = '';
                state.targetMatrixAttemptId = '';
                renderAssignmentOverview();
                if (item) {
                    loadProgressAttemptThread(item).then(function() {
                        if (state.selectedProgressDetailKey === assignmentProgressKey(item)) renderAssignmentOverview();
                    });
                }
            });
        });
        mountTeacherMatrixModals(container);
    }

    function renderStudentDetail() {
        var student = state.students.find(function(item) {
            return item.profile_id === state.selectedStudentProfileId;
        });
        if (!student) {
            studentDetail.innerHTML =
                '<section class="profile-card student-profile-card empty-check-card">' +
                    '<p class="eyebrow accent">INFO</p><p class="muted">Select a student to see their profile.</p></section>' +
                '<section class="profile-card student-progress-card empty-check-card">' +
                    '<p class="eyebrow accent">PROGRESS</p><p class="muted">To Do, Finished, and Data will appear here.</p></section>';
            return;
        }
        var assignments = (state.progressItems.length ? state.progressItems : state.assignments).filter(function(item) {
            return item.student_uid === student.auth_uid;
        });
        var chineseName = String(student.chinese_name || '').trim();
        var englishName = String(student.english_name || '').trim();
        var displayName = studentDisplayName(student);
        var legacyName = !chineseName && !englishName ? String(student.name || '').trim() : '';
        var identityChineseName = chineseName || legacyName || '中文名未设置';
        var identityEnglishName = englishName || (legacyName ? 'Legacy name · review in Account' : 'English name not set');
        var metrics = matrixStudentOverviewMetrics(assignments);
        var studentKey = student.auth_uid || student.student_id;

        studentDetail.innerHTML =
            '<section class="profile-card student-profile-card student-profile-summary">' +
                '<div class="student-identity-capsule">' +
                    '<span class="matrix-student-avatar">' + escapeHtml(matrixStudentInitial(displayName)) + '</span>' +
                    '<span class="student-identity-copy"><strong>' + escapeHtml(identityChineseName) + '</strong><small>' + escapeHtml(identityEnglishName) + '</small></span>' +
                '</div>' +
                '<div class="student-summary-actions">' +
                    '<button class="student-summary-capsule is-star" type="button" data-student-metric="star" aria-haspopup="dialog">' +
                        '<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.4 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.4 6.3-.9L12 2.8Z"></path></svg>' +
                        '<span><strong>' + escapeHtml(metrics.stars) + '</strong><small>STAR</small></span>' +
                    '</button>' +
                    '<button class="student-summary-capsule is-completed" type="button" data-student-metric="completed" aria-haspopup="dialog">' +
                        '<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><circle cx="12" cy="12" r="8.5"></circle><path d="m8.2 12.2 2.4 2.4 5.4-5.5"></path></svg>' +
                        '<span><strong>' + escapeHtml(metrics.finished + ' / ' + metrics.total) + '</strong><small>COMPLETED</small></span>' +
                    '</button>' +
                    '<button class="student-summary-capsule is-account" type="button" data-student-account aria-haspopup="dialog">' +
                        '<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5"></rect><circle cx="9.5" cy="11" r="2.2"></circle><path d="M6.6 16.5a3.5 3.5 0 0 1 5.8 0M14.2 10h3.3M14.2 14h3.3"></path></svg>' +
                        '<span><strong>Account</strong><small>SETTINGS</small></span>' +
                    '</button>' +
                '</div>' +
            '</section>' +
            '<section class="profile-card student-calendar-card">' +
                '<p class="eyebrow accent">PROGRESS CALENDAR</p>' +
                renderMatrixStudentProgressBoard(studentKey, assignments) +
            '</section>';

        studentDetail.querySelectorAll('[data-student-metric]').forEach(function(button) {
            button.addEventListener('click', function() {
                openStudentMetricModal(button.dataset.studentMetric, student, assignments);
            });
        });
        var accountButton = studentDetail.querySelector('[data-student-account]');
        if (accountButton) accountButton.addEventListener('click', function() { openStudentAccountModal(student); });
        studentDetail.querySelectorAll('[data-matrix-student-progress-day], [data-matrix-student-progress-week]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.matrixStudentProgressDay || button.dataset.matrixStudentProgressWeek || '';
                if (!key) return;
                state.matrixStudentProgressSelections[studentKey] = key;
                renderStudentDetail();
            });
        });
        studentDetail.querySelectorAll('[data-matrix-student-progress-month]').forEach(function(button) {
            button.addEventListener('click', function() {
                shiftMatrixStudentProgressMonth(studentKey, button.dataset.matrixStudentProgressMonth === 'next' ? 1 : -1);
                renderStudentDetail();
            });
        });
    }

    function studentForUid(uid) {
        return state.students.find(function(student) { return student.auth_uid === uid; }) || {};
    }

    function attemptStatusLabel(attempt) {
        if (attempt && attempt.mode === 'vocabulary_practice_timed') return 'practiced';
        if (attempt && attempt.mode === 'vocabulary_test') return 'completed a quiz for';
        if (attempt.mastered) return 'mastered';
        if (attempt.passed) return 'finished';
        return 'tried';
    }

    function activityDateValue(item) {
        return item.date || item.submitted_at || item.created_at || item.updated_at || item.resolved_at || null;
    }

    function attemptActivityItem(attempt) {
        var student = studentForUid(attempt.student_uid);
        var name = studentDisplayName(student) || attempt.student_id || 'Student';
        var action = attemptStatusLabel(attempt);
        return {
            type: 'attempt',
            date: attempt.submitted_at || null,
            unread: isAttemptReviewUnread(attempt),
            attempt: attempt,
            label: name + ' ' + action + ' ' + (setTitleFor(attempt.set_id) || attempt.set_id),
            score: attempt.percentage,
            time: formatDateTime(attempt.submitted_at),
            attempt_id: attempt.attempt_id || '',
            student_uid: attempt.student_uid || '',
            assignment_id: attempt.assignment_id || '',
            set_id: attempt.set_id || '',
            finished: attempt.passed || attempt.mastered,
            mastered: attempt.mastered === true,
            attempt_count: 1
        };
    }

    function activityItems() {
        return groupedAttemptThreads().map(function(group) {
            var latest = group.attempts[0];
            var target = group.attempts.find(isAttemptReviewUnread) || latest;
            var item = attemptActivityItem(latest);
            item.unread = group.unread;
            item.attempt_id = target.attempt_id || latest.attempt_id || '';
            item.attempt_count = group.attempts.length;
            return item;
        })
            .sort(function(a, b) {
                return new Date(activityDateValue(b) || 0) - new Date(activityDateValue(a) || 0);
            });
    }

    function renderActivityFeedRow(item) {
        var attemptCount = Math.max(1, Number(item.attempt_count || 1));
        var attemptClass = attemptCount >= 3 ? ' many' : attemptCount === 2 ? ' repeat' : ' single';
        var scoreClass = item.mastered ? ' mastered' : item.finished ? '' : ' low';
        return '<button class="activity-row compact-activity-row' + (item.unread ? ' unread' : '') +
            '" type="button" data-open-attempt-id="' + escapeHtml(item.attempt_id) +
            '" data-open-attempt-student="' + escapeHtml(item.student_uid) +
            '" data-open-attempt-assignment="' + escapeHtml(item.assignment_id) +
            '" data-open-attempt-set="' + escapeHtml(item.set_id) + '">' +
            '<span class="activity-unread-dot"></span>' +
            '<span class="activity-line"><strong>' + escapeHtml(item.label) + '</strong></span>' +
            '<span class="activity-timing"><span class="activity-attempt-count' + attemptClass + '">' +
                escapeHtml(attemptCount + ' attempt' + (attemptCount === 1 ? '' : 's')) + '</span>' +
                '<span class="activity-date">' + escapeHtml(item.time) + '</span></span>' +
            '<span class="activity-score' + scoreClass + '">' + escapeHtml(formatPercent(item.score)) + '</span>' +
        '</button>';
    }

    function renderActivityFeed() {
        var items = activityItems();
        return '<div class="activity-list compact-activity-list">' +
            (items.length ? items.map(renderActivityFeedRow).join('') :
                '<div class="empty-card compact-empty"><strong>No attempts</strong>Student attempt activity will appear here.</div>') +
            (state.notificationPageLoading ? '<div class="notification-feed-loading" role="status"><span aria-hidden="true"></span><span class="sr-only">Loading more notifications</span></div>' : '') +
            '</div>';
    }

    function notificationScrollNeedsMore(dialog) {
        if (!dialog || !state.notificationHasMore || state.notificationPageLoading || state.notificationAttemptId) return false;
        return dialog.scrollHeight <= dialog.clientHeight + 2 ||
            dialog.scrollTop + dialog.clientHeight >= dialog.scrollHeight - 72;
    }

    function loadNextNotificationPageForScroll(dialog) {
        if (!notificationScrollNeedsMore(dialog)) return;
        loadNotificationPage();
    }

    function bindNotificationInfiniteScroll(dialog) {
        if (!dialog) return;
        dialog.onscroll = function() {
            loadNextNotificationPageForScroll(dialog);
        };
    }

    function relatedAttemptIdsForAttempt(attempt) {
        if (!attempt) return [];
        var assignmentId = attempt.assignment_id || '';
        var ids = (state.attempts || []).filter(function(item) {
            if (!item || !item.attempt_id) return false;
            if (assignmentId) {
                return item.student_uid === attempt.student_uid &&
                    item.assignment_id &&
                    String(item.assignment_id) === String(assignmentId);
            }
            return item.student_uid === attempt.student_uid &&
                item.set_id === attempt.set_id &&
                !item.assignment_id;
        }).map(function(item) {
            return item.attempt_id;
        });
        if (attempt.attempt_id && ids.indexOf(attempt.attempt_id) === -1) ids.push(attempt.attempt_id);
        return ids;
    }

    function setReviewedAttemptIds(ids) {
        var map = {};
        (state.activityReviewedAttemptIds || []).forEach(function(id) {
            if (id) map[String(id)] = true;
        });
        (ids || []).forEach(function(id) {
            if (id) map[String(id)] = true;
        });
        state.activityReviewedAttemptIds = Object.keys(map);
    }

    function markAttemptGroupReviewed(attempt) {
        var wasUnread = relatedAttemptIdsForAttempt(attempt).some(function(id) {
            var item = (state.attempts || []).find(function(candidate) { return candidate.attempt_id === id; });
            return item && isAttemptReviewUnread(item);
        });
        var ids = relatedAttemptIdsForAttempt(attempt);
        if (!ids.length) return;
        setReviewedAttemptIds(ids);
        if (wasUnread && state.notificationUnreadThreadCount != null) {
            state.notificationUnreadThreadCount = Math.max(0, Number(state.notificationUnreadThreadCount || 0) - 1);
        }
        var batches = [];
        for (var index = 0; index < ids.length; index += 100) {
            batches.push(ids.slice(index, index + 100));
        }
        var persist = Promise.resolve();
        batches.forEach(function(batch) {
            persist = persist.then(function() {
                return teacherCall('markActivityAttemptsReviewed', { attempt_ids: batch });
            }).then(function(result) {
                state.activityReviewedAttemptIds = result.reviewed_attempt_ids || state.activityReviewedAttemptIds || [];
            });
        });
        persist.then(function() {
            renderUpdatesPanel();
        }).catch(function() {});
    }

    function renderNotificationAttemptModal() {
        if (!state.notificationAttemptId) return '';
        var attempt = (state.attempts || []).find(function(item) {
            return item.attempt_id === state.notificationAttemptId;
        });
        if (!attempt) return '';
        var detailItem = notificationDetailItemForAttempt(attempt);
        var renderPhaseClass = state.notificationAttemptEntering ? ' is-entering' : ' is-refreshing';
        return '<div class="progress-matrix-modal-backdrop notification-attempt-modal teacher-utility-modal' + renderPhaseClass + '" data-notification-attempt-close="backdrop">' +
            '<div class="progress-matrix-modal-shell notification-attempt-shell teacher-utility-shell">' +
                '<section class="progress-matrix-modal notification-attempt-dialog teacher-utility-dialog" role="dialog" aria-modal="true" aria-label="Attempt details">' +
                    '<div class="progress-matrix-modal-scroll">' +
                        renderMatrixCellDetail(detailItem) +
                    '</div>' +
                '</section>' +
                '<button class="progress-matrix-modal-close notification-attempt-external-close" type="button" data-notification-attempt-close="button" aria-label="Close attempt details">Close</button>' +
            '</div>' +
        '</div>';
    }

    function notificationDetailItemForAttempt(attempt) {
        var assignmentId = attempt.assignment_id || '';
        var candidates = (state.progressItems || []).concat(state.assignments || []);
        var matched = candidates.find(function(item) {
            return assignmentId && item.assignment_id && String(item.assignment_id) === String(assignmentId);
        });
        if (!matched && !assignmentId) {
            matched = candidates.find(function(item) {
                return item.student_uid === attempt.student_uid &&
                    item.set_id === attempt.set_id &&
                    (!item.assignment_id || item.source === 'self_study');
            });
        }
        var attempts = notificationAttemptsForAttempt(attempt, matched);
        if (matched) {
            var detail = Object.assign({}, matched);
            detail.attempts = attempts;
            if (!detail.student_name) {
                var matchedStudent = studentForUid(attempt.student_uid);
                detail.student_name = studentDisplayName(matchedStudent) || attempt.student_id || 'Student';
            }
            if (!detail.set_title) detail.set_title = setTitleFor(attempt.set_id) || attempt.set_id || 'Attempt';
            return detail;
        }
        var student = studentForUid(attempt.student_uid);
        return {
            source: assignmentId ? 'assigned' : 'self_study',
            assignment_id: assignmentId || null,
            student_uid: attempt.student_uid || '',
            student_id: attempt.student_id || '',
            student_name: studentDisplayName(student) || attempt.student_id || 'Student',
            set_id: attempt.set_id || '',
            set_title: setTitleFor(attempt.set_id) || attempt.set_id || 'Attempt',
            status: attempt.mastered ? 'mastered' : attempt.passed ? 'passed' : 'to_do',
            best_percentage: bestAttemptPercentage(attempts),
            passing_percentage: attempt.passing_percentage,
            mastery_percentage: attempt.mastery_percentage,
            mastery_enabled: attempt.mastery_enabled,
            answer_revealed: false,
            mastery_locked: false,
            attempts: attempts
        };
    }

    function notificationAttemptsForAttempt(attempt, assignment) {
        var attempts = [];
        if (assignment) attempts = progressAttemptsForAssignment(assignment);
        if (!attempts.length) {
            attempts = (state.attempts || []).filter(function(item) {
                if (attempt.assignment_id) {
                    return item.assignment_id && String(item.assignment_id) === String(attempt.assignment_id);
                }
                return item.student_uid === attempt.student_uid && item.set_id === attempt.set_id && !item.assignment_id;
            }).sort(function(a, b) {
                return new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0);
            });
        }
        if (!attempts.some(function(item) { return item.attempt_id === attempt.attempt_id; })) {
            attempts = attempts.concat([attempt]).sort(function(a, b) {
                return new Date(a.submitted_at || 0) - new Date(b.submitted_at || 0);
            });
        }
        return attempts;
    }

    function bestAttemptPercentage(attempts) {
        return (attempts || []).reduce(function(best, attempt) {
            var value = numericPercent(attempt.display_percentage == null ? attempt.percentage : attempt.display_percentage);
            if (value == null) return best;
            return best == null ? value : Math.max(best, value);
        }, null);
    }

    function openAttemptFromNotification(row) {
        var attemptId = row.dataset.openAttemptId || '';
        var attempt = (state.attempts || []).find(function(item) {
            return item.attempt_id === attemptId;
        });
        state.notificationAttemptId = attemptId;
        state.targetMatrixAttemptId = '';
        state.selectedMatrixReviewAttemptId = '';
        state.notificationAttemptEntering = true;
        renderUpdatesPanel();
        state.notificationAttemptEntering = false;
        ensureNotificationThread(attempt).then(function() {
            markAttemptGroupReviewed(attempt);
            renderUpdatesPanel();
            return loadNotificationThreadAttemptDetails(attempt, renderUpdatesPanel);
        }).catch(function() {
            return loadNotificationThreadAttemptDetails(attempt, renderUpdatesPanel);
        });
    }

    function renderUpdatesPanel() {
        updateActivityBadges();
        if (!updatesPanel || !updatesBody) return;
        updatesPanel.hidden = !state.updatesOpen;
        var button = document.getElementById('teacher-updates-button');
        var readAllButton = document.getElementById('teacher-updates-read-all');
        if (button) button.setAttribute('aria-expanded', state.updatesOpen ? 'true' : 'false');
        if (readAllButton) {
            var unreadCount = state.notificationUnreadThreadCount == null
                ? activityAttemptCounts().unread
                : Number(state.notificationUnreadThreadCount || 0);
            readAllButton.disabled = state.activityReadAllPending || unreadCount <= 0;
            readAllButton.classList.toggle('has-unread', unreadCount > 0);
            readAllButton.classList.toggle('is-pending', state.activityReadAllPending);
            readAllButton.classList.toggle('is-success', state.activityReadAllSuccess);
            readAllButton.setAttribute('aria-busy', state.activityReadAllPending ? 'true' : 'false');
            readAllButton.title = state.activityReadAllPending ? 'Marking all as read...' : 'Read all';
        }
        var updatesDialog = updatesPanel.querySelector('.teacher-updates-dialog');
        if (updatesDialog) {
            if (state.notificationAttemptId) updatesDialog.setAttribute('aria-hidden', 'true');
            else updatesDialog.removeAttribute('aria-hidden');
        }
        if (!state.updatesOpen) {
            if (notificationAttemptRoot) notificationAttemptRoot.innerHTML = '';
            return;
        }
        updatesBody.innerHTML = renderActivityFeed();
        var modalRoot = notificationAttemptRoot || updatesBody;
        if (notificationAttemptRoot) notificationAttemptRoot.innerHTML = renderNotificationAttemptModal();
        else updatesBody.insertAdjacentHTML('beforeend', renderNotificationAttemptModal());
        updatesBody.querySelectorAll('[data-open-attempt-id]').forEach(function(row) {
            row.addEventListener('click', function() {
                openAttemptFromNotification(row);
            });
        });
        bindNotificationInfiniteScroll(updatesDialog);
        modalRoot.querySelectorAll('[data-notification-attempt-close]').forEach(function(button) {
            button.addEventListener('click', function(event) {
                if (button.dataset.notificationAttemptClose === 'backdrop' && event.target !== button) return;
                state.notificationAttemptId = '';
                state.targetMatrixAttemptId = '';
                state.selectedMatrixReviewAttemptId = '';
                renderUpdatesPanel();
            });
        });
        modalRoot.querySelectorAll('[data-matrix-review-attempt]').forEach(function(button) {
            button.addEventListener('click', function(event) {
                event.stopPropagation();
                openAttemptPaperReview(
                    button.dataset.matrixReviewAttempt || '',
                    button.dataset.matrixReviewSet || '',
                    renderUpdatesPanel
                );
            });
        });
        modalRoot.querySelectorAll('[data-matrix-review-back]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.selectedMatrixReviewAttemptId = '';
                renderUpdatesPanel();
            });
        });
        modalRoot.querySelectorAll('[data-matrix-attempt-target]').forEach(function(button) {
            button.addEventListener('click', function() {
                if (state.selectedMatrixReviewAttemptId && button.dataset.matrixAttemptId) {
                    openAttemptPaperReview(
                        button.dataset.matrixAttemptId,
                        button.dataset.matrixReviewSet || '',
                        renderUpdatesPanel
                    );
                    return;
                }
                var modal = button.closest('.progress-matrix-modal-shell');
                var target = modal && modal.querySelector('[data-matrix-attempt-index="' + button.dataset.matrixAttemptTarget + '"]');
                if (target) {
                    modal.querySelectorAll('.matrix-attempt-bar.highlight').forEach(function(bar) {
                        bar.classList.remove('highlight');
                    });
                    button.classList.add('highlight');
                    modal.querySelectorAll('.matrix-attempt-card.highlight').forEach(function(card) {
                        card.classList.remove('highlight');
                    });
                    target.classList.add('highlight');
                    scrollMatrixAttemptCardIntoView(modal, { behavior: 'smooth', block: 'start' });
                }
            });
        });
        if (state.notificationAttemptId && state.targetMatrixAttemptId) {
            scrollMatrixAttemptCardIntoView(
                modalRoot.querySelector('.notification-attempt-modal .progress-matrix-modal-shell'),
                { behavior: 'auto', block: 'center' }
            );
        }
    }

    function answerText(value) {
        if (Array.isArray(value)) return value.join(' / ');
        if (value && typeof value === 'object') return JSON.stringify(value);
        return value == null ? '—' : String(value);
    }

    function normalizedAssignmentStatus(status) {
        if (status === 'cancelled' || status === 'canceled') return 'cancelled';
        if (status === 'done') return 'mastered';
        if (status === 'failed' || status === 'not_done') return 'to_do';
        return status || 'to_do';
    }

    function assignmentStatusLabel(status) {
        status = normalizedAssignmentStatus(status);
        if (status === 'cancelled') return 'Cancelled';
        if (status === 'mastered') return 'Mastered';
        if (status === 'passed') return 'Passed';
        return 'To Do';
    }

    function disputeCounts() {
        if (state.disputeCounts) {
            return {
                pending: Number(state.disputeCounts.pending || 0),
                approved: Number(state.disputeCounts.approved || 0),
                rejected: Number(state.disputeCounts.rejected || 0)
            };
        }
        var counts = { pending: 0, approved: 0, rejected: 0 };
        (state.disputes || []).forEach(function(item) {
            var status = item.status === 'approved' || item.status === 'rejected' ? item.status : 'pending';
            counts[status] += 1;
        });
        return counts;
    }

    function filteredDisputes() {
        return (state.disputes || []).filter(function(item) {
            var status = item.status === 'approved' || item.status === 'rejected' ? item.status : 'pending';
            return status === state.disputeFilter;
        }).sort(function(a, b) {
            var aDate = a.status === 'pending'
                ? (a.created_at || a.updated_at || a.resolved_at)
                : (a.resolved_at || a.updated_at || a.created_at);
            var bDate = b.status === 'pending'
                ? (b.created_at || b.updated_at || b.resolved_at)
                : (b.resolved_at || b.updated_at || b.created_at);
            return new Date(bDate || 0) - new Date(aDate || 0);
        });
    }

    function mergeDisputesBySet(disputes) {
        var groups = {};
        disputes.forEach(function(item) {
            var key = item.set_id || 'unknown';
            if (!groups[key]) groups[key] = {
                key: key,
                set_id: item.set_id || '',
                set_title: item.set_title || item.set_id || 'Unknown set',
                records: []
            };
            groups[key].records.push(item);
        });
        return Object.keys(groups).map(function(key) {
            var group = groups[key];
            group.records.sort(function(a, b) {
                return new Date((b.resolved_at || b.updated_at || b.created_at) || 0) -
                    new Date((a.resolved_at || a.updated_at || a.created_at) || 0);
            });
            return group;
        }).sort(function(a, b) {
            return b.records.length - a.records.length ||
                String(a.set_title).localeCompare(String(b.set_title));
        });
    }

    function countBy(records, getter) {
        return records.reduce(function(map, item) {
            var key = getter(item) || 'Unknown';
            map[key] = (map[key] || 0) + 1;
            return map;
        }, {});
    }

    function renderMergeBars(counts, total) {
        var rows = Object.keys(counts).sort(function(a, b) {
            return counts[b] - counts[a] || String(a).localeCompare(String(b));
        }).slice(0, 8);
        return '<div class="merge-bars">' + rows.map(function(key) {
            var value = counts[key];
            var width = total ? Math.max(6, Math.round(value / total * 100)) : 0;
            return '<div class="merge-bar-row">' +
                '<span>' + escapeHtml(key) + '</span>' +
                '<span class="merge-bar-track"><span class="merge-bar-fill" style="width:' + escapeHtml(width) + '%"></span></span>' +
                '<strong>' + escapeHtml(value) + '</strong>' +
            '</div>';
        }).join('') + '</div>';
    }

    function renderDisputeMergeGroup(group) {
        var key = group.key + '::' + state.disputeFilter;
        var expanded = state.expandedDisputeMerges[key] === true;
        var decisionCounts = countBy(group.records, function(item) { return item.decision || item.status; });
        var questionCounts = countBy(group.records, function(item) { return 'Q' + item.question_id; });
        var requesterCount = Object.keys(countBy(group.records, function(item) {
            return item.requester_role === 'teacher'
                ? 'Teacher'
                : (item.student_id || item.student_name || 'Student');
        })).length;
        return '<article class="profile-card dispute-merge-card">' +
            '<button class="dispute-merge-head" type="button" data-toggle-dispute-merge="' + escapeHtml(key) + '">' +
                '<span><strong>' + escapeHtml(group.set_title) + '</strong>' +
                '<small>' + escapeHtml(group.set_id) + ' · ' + escapeHtml(group.records.length) +
                ' record' + (group.records.length === 1 ? '' : 's') + ' · ' + escapeHtml(requesterCount) +
                ' requester' + (requesterCount === 1 ? '' : 's') + '</small></span>' +
                '<span class="badge ' + escapeHtml(state.disputeFilter) + '">' + escapeHtml(state.disputeFilter) + '</span>' +
            '</button>' +
            (expanded ? '<div class="dispute-merge-viz">' +
                '<div class="attempt-detail-row"><div class="attempt-detail-head"><div><strong>Question distribution</strong><small>Where requests clustered inside this set</small></div><span>' +
                escapeHtml(group.records.length) + ' total</span></div>' + renderMergeBars(questionCounts, group.records.length) + '</div>' +
                '<div class="attempt-detail-row"><div class="attempt-detail-head"><div><strong>Decision distribution</strong><small>How these requests were resolved</small></div></div>' +
                renderMergeBars(decisionCounts, group.records.length) + '</div>' +
                '<div class="dispute-group-detail">' + group.records.map(renderDisputeDetail).join('') + '</div>' +
            '</div>' : '') +
        '</article>';
    }

    function renderDisputeDetail(item) {
        var pending = item.status === 'pending';
        var questionText = getQuestionText(item);
        var requesterLabel = item.requester_role === 'teacher' ? 'Teacher note' : 'Student note';
        var statusText = item.status === 'rejected' ? 'rejected' : item.status;
        return '<article class="dispute-detail ' + escapeHtml(item.status) + '" data-dispute-id="' +
            escapeHtml(item.dispute_id) + '">' +
            '<div class="dispute-detail-head">' +
                '<div><strong>Question ' + escapeHtml(item.question_id) + '</strong>' +
                '<small>' + escapeHtml(formatDate(item.created_at)) + '</small></div>' +
                '<span class="badge dispute-status ' + escapeHtml(pending ? 'pending' : item.status) + '">' + escapeHtml(statusText) + '</span>' +
            '</div>' +
            (questionText
                ? '<p class="dispute-question-text">' + escapeHtml(questionText) + '</p>'
                : '<p class="dispute-question-text missing">Question text is not available from the current public data.</p>') +
            '<div class="dispute-comparison">' +
                '<div><span>Submitted answer</span><strong>' + escapeHtml(answerText(item.submitted_answer)) + '</strong></div>' +
                '<div><span>Correct answer snapshot</span><strong>' + escapeHtml(answerText(item.answer_snapshot)) + '</strong></div>' +
            '</div>' +
            (item.explanation || item.explanation_snapshot
                ? '<p class="dispute-explanation"><strong>Explanation:</strong> ' + escapeHtml(item.explanation || item.explanation_snapshot) + '</p>'
                : '<p class="dispute-explanation missing"><strong>Explanation:</strong> No explanation is stored for this question.</p>') +
            '<p class="dispute-reason"><strong>' + requesterLabel + ':</strong> ' +
                escapeHtml(item.student_reason || 'No note provided.') + '</p>' +
            (pending
                ? '<textarea class="dispute-note" maxlength="1000" placeholder="Teacher note (optional)"></textarea>' +
                  '<div class="dispute-actions">' +
                    '<button class="outline-button" type="button" data-decision="keep">Keep Original Ruling</button>' +
                    '<button class="primary-button" type="button" data-decision="add">Add as Accepted Answer</button>' +
                    '<button class="danger-button" type="button" data-decision="replace">Replace Correct Answer</button>' +
                  '</div>'
                : '<p class="muted">Decision: ' + escapeHtml(item.decision || item.status) +
                  (item.teacher_note ? ' · ' + escapeHtml(item.teacher_note) : '') + '</p>') +
        '</article>';
    }

    function renderDisputes() {
        var list = document.getElementById('dispute-list');
        updateTopBadges();
        if (!list) return;
        var counts = disputeCounts();
        var disputes = filteredDisputes();
        if (state.disputeFilter === 'pending') state.disputeMerge = false;
        var filters = [
            { id: 'pending', label: 'Pending' },
            { id: 'approved', label: 'Approved' },
            { id: 'rejected', label: 'Rejected' }
        ];
        var tabs = '<div class="summary-grid assignment-filters revise-tabs" role="tablist" aria-label="Review status">' +
            filters.map(function(filter) {
                var isPending = filter.id === 'pending';
                var countMarkup = isPending
                    ? (counts.pending > 0
                        ? '<span class="notice-dot review-pending-count" aria-label="' + escapeHtml(counts.pending) + ' pending requests">' + escapeHtml(counts.pending) + '</span>'
                        : '')
                    : '<span class="review-status-count ' + escapeHtml(filter.id) + '">' + escapeHtml(counts[filter.id]) + '</span>';
                return '<button class="summary-card assignment-filter revise-filter' + (state.disputeFilter === filter.id ? ' active' : '') +
                    '" type="button" data-dispute-filter="' + escapeHtml(filter.id) +
                    '" aria-label="' + escapeHtml(filter.label) + ': ' + escapeHtml(counts[filter.id]) + '">' +
                    '<span class="summary-label">' + escapeHtml(filter.label).toUpperCase() + '</span>' + countMarkup +
                '</button>';
            }).join('') +
        '</div>';
        var mergeToggle = state.disputeFilter === 'pending' ? '' :
            '<div class="assignment-list-tools"><button class="review-merge-toggle' + (state.disputeMerge ? ' active' : '') +
            '" type="button" data-review-merge="1">' + (state.disputeMerge ? 'List' : 'Merge') + '</button></div>';
        var body = state.disputeMerge
            ? (disputes.length ? mergeDisputesBySet(disputes).map(renderDisputeMergeGroup).join('') :
                '<div class="empty-card"><strong>No merged records</strong>Handled requests will appear here.</div>')
            : (disputes.length ? disputes.map(function(item) {
            var status = item.status === 'approved' || item.status === 'rejected' ? item.status : 'pending';
            var expanded = state.expandedDisputes[item.dispute_id] === true;
            var requester = item.requester_role === 'teacher'
                ? 'Teacher preview'
                : englishName(item.student_name || item.student_id || 'Student');
            var displayDate = status === 'pending'
                ? (item.created_at || item.updated_at || item.resolved_at)
                : (item.resolved_at || item.updated_at || item.created_at);
            return '<article class="profile-card dispute-card ' + escapeHtml(status) +
                '" data-dispute-card="' + escapeHtml(item.dispute_id) + '">' +
                '<button class="dispute-capsule" type="button" data-toggle-dispute="' + escapeHtml(item.dispute_id) + '" aria-expanded="' + expanded + '">' +
                    '<span class="dispute-capsule-copy">' +
                        '<strong>' + escapeHtml(item.set_title || item.set_id) + '</strong>' +
                        '<small>' + escapeHtml(requester) +
                            ' · Question ' + escapeHtml(item.question_id) +
                            ' · ' + escapeHtml(item.set_id) +
                            ' · ' + escapeHtml(formatDate(displayDate, '—', 'compact')) +
                        '</small>' +
                    '</span>' +
                    '<span class="dispute-capsule-meta">' +
                        '<span class="badge ' + escapeHtml(status) + '">' + escapeHtml(status) + '</span>' +
                    '</span>' +
                '</button>' +
                (expanded
                    ? '<div class="dispute-group-detail">' + renderDisputeDetail(item) + '</div>'
                    : '') +
            '</article>';
        }).join('') : '<div class="empty-card"><strong>No ' + escapeHtml(state.disputeFilter) + ' requests</strong>' +
            (state.disputeFilter === 'pending' ? 'New requests will appear here.' : 'Handled requests will appear here.') +
            '</div>');
        var disputePage = state.disputePages[state.disputeFilter];
        var loadMore = disputePage && disputePage.hasMore
            ? '<button class="outline-button teacher-feed-load-more" type="button" data-dispute-load-more>Load 5 more</button>'
            : '';
        list.innerHTML = tabs + mergeToggle + body + loadMore;

        list.querySelectorAll('[data-dispute-filter]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.disputeFilter = button.dataset.disputeFilter;
                if (state.disputeFilter === 'pending') state.disputeMerge = false;
                renderDisputes();
                if (!state.disputePages[state.disputeFilter].loaded) {
                    loadDisputePage(state.disputeFilter, { reset: true });
                }
            });
        });

        var disputeLoadMore = list.querySelector('[data-dispute-load-more]');
        if (disputeLoadMore) {
            disputeLoadMore.addEventListener('click', function() {
                disputeLoadMore.disabled = true;
                loadDisputePage(state.disputeFilter);
            });
        }

        list.querySelectorAll('[data-review-merge]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.disputeMerge = state.disputeMerge !== true;
                renderDisputes();
            });
        });

        list.querySelectorAll('[data-toggle-dispute-merge]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.toggleDisputeMerge;
                state.expandedDisputeMerges[key] = state.expandedDisputeMerges[key] !== true;
                renderDisputes();
            });
        });

        list.querySelectorAll('[data-toggle-dispute]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.toggleDispute;
                state.expandedDisputes[key] = state.expandedDisputes[key] !== true;
                renderDisputes();
            });
        });

        list.querySelectorAll('[data-decision]').forEach(function(button) {
            button.addEventListener('click', function() {
                var card = button.closest('[data-dispute-id]');
                var decision = button.dataset.decision;
                if (decision === 'replace' && !confirm('Replace the correct answer for future submissions? The previous rule will remain in history.')) {
                    return;
                }
                card.querySelectorAll('button').forEach(function(item) { item.disabled = true; });
                showMessage('Resolving Argue request...', '');
                teacherCall('resolveDispute', {
                    dispute_id: card.dataset.disputeId,
                    decision: decision,
                    teacher_note: card.querySelector('.dispute-note').value
                }).then(function() {
                    showMessage('Argue request resolved.', 'success');
                    return Promise.all([
                        teacherCall('listAssignments'),
                        loadProgressData(),
                        loadDisputePage(state.disputeFilter, { reset: true }),
                        initializeNotificationFeed()
                    ]);
                }).then(function(results) {
                    state.assignments = results[0].assignments || [];
                    state.progressItems = results[1].progress || [];
                    return loadQuestionTextForDisputes();
                }).then(function() {
                    renderDisputes();
                    renderStudentDetail();
                    renderUpdatesPanel();
                }).catch(function(error) {
                    showMessage(error.message, 'error');
                    renderDisputes();
                    renderUpdatesPanel();
                });
            });
        });
    }

    function refreshStudents() {
        return Promise.all([
            teacherCall('listStudents'),
            teacherCall('listClasses').catch(function() { return { classes: [], unavailable: true }; })
        ]).then(function(results) {
            state.students = results[0].students || [];
            if (!results[1].unavailable) state.classDirectory = results[1].classes || [];
            fillClassFilters();
            renderStudentList();
            renderStudentDetail();
        });
    }

    function updateStudent(authUid, update) {
        showMessage('Saving student...', '');
        return teacherCall('updateStudent', Object.assign({ auth_uid: authUid }, update))
            .then(function() {
                showMessage('Student updated.', 'success');
                return refreshStudents().then(function() { return true; });
            }).catch(function(error) {
                showMessage(error.message, 'error');
                return false;
            });
    }

    function deleteStudentAccount(student) {
        if (!student || !student.auth_uid) return Promise.resolve();
        var label = studentDisplayName(student) || student.student_id || 'this student';
        if (!confirm('Delete student account for ' + label + '? This removes the login account and hides the student from teacher views. Attempts and assignment history stay saved.')) {
            return Promise.resolve();
        }
        showMessage('Deleting student account...', '');
        return teacherCall('deleteStudentAccount', { auth_uid: student.auth_uid })
            .then(function() {
                state.selectedStudentProfileId = '';
                delete state.selectedAssignStudentUids[student.auth_uid];
                return refreshStudents();
            })
            .then(function() {
                return Promise.all([teacherCall('listAssignments'), loadProgressData(), loadCandidates()]);
            })
            .then(function(results) {
                state.assignments = results[0].assignments || [];
                state.progressItems = results[1].progress || [];
                renderSetOptions();
                renderAssignmentOverview();
                updateAssignView();
                showMessage('Student account deleted.', 'success');
            })
            .catch(function(error) {
                showMessage(error.message, 'error');
            });
    }

    function initialTeacherView() {
        if (restoredTeacherWorkspaceView) return restoredTeacherWorkspaceView;
        var view = new URLSearchParams(window.location.search).get('view') || '';
        return view === 'library' ? 'library' : 'view';
    }

    function rememberTeacherView(viewName) {
        if (teacherViews.indexOf(viewName) === -1 || !window.history || !window.history.replaceState) return;
        var url = new URL(window.location.href);
        if (viewName === 'library') url.searchParams.set('view', viewName);
        else url.searchParams.delete('view');
        var nextState = Object.assign({}, window.history.state || {});
        if (nextState[TEACHER_HISTORY_STATE_KEY]) {
            nextState[TEACHER_HISTORY_STATE_KEY] = Object.assign({}, nextState[TEACHER_HISTORY_STATE_KEY], {
                view: viewName,
                saved_at: Date.now()
            });
        }
        window.history.replaceState(nextState, '', url);
    }

    function applyTeacherViewShell(viewName) {
        if (teacherViews.indexOf(viewName) === -1) viewName = 'view';
        document.querySelectorAll('.tab-button').forEach(function(button) {
            button.classList.toggle('active', button.dataset.view === viewName);
        });
        document.querySelectorAll('.dashboard-view').forEach(function(view) {
            view.hidden = view.id !== 'view-' + viewName;
        });
        return viewName;
    }

    function activateView(viewName, skipUrlUpdate) {
        viewName = applyTeacherViewShell(viewName);
        if (!skipUrlUpdate) rememberTeacherView(viewName);
        setTeacherAccountPanel(false);
        if (viewName === 'tasks') updateAssignView();
        if (viewName === 'view') renderAssignmentOverview();
        if (viewName === 'library') renderTeacherLibrary(teacherLibraryActiveTab);
        if (viewName === 'view' && teacherLiveDataLoadedAt
            && Date.now() - teacherLiveDataLoadedAt >= TEACHER_RETURN_REFRESH_AGE_MS) {
            refreshTeacherLiveProgress();
        }
    }

    function loadPublicCatalog() {
        return fetch('data/home-catalog.json?v=' + encodeURIComponent(appVersion()))
            .then(function(response) {
                if (!response.ok) throw new Error('Catalog unavailable');
                return response.json();
            })
            .then(function(catalog) {
                teacherLibraryCatalog = catalog;
                return (catalog.items || []).filter(function(item) {
                    return item.visible !== false;
                }).map(function(item) {
                    return {
                        set_id: item.id,
                        title: item.title || item.id,
                        course: item.sectionId || '',
                        type: '',
                        section: item.sectionId || '',
                        sectionId: item.sectionId || '',
                        link: item.href || '#',
                        href: item.href || '#',
                        displayValue: item.displayValue || '',
                        sortValue: item.sortValue || '',
                        topic: item.topic || '',
                        tags: item.tags || [],
                        note: item.note || '',
                        edition_family: item.edition_family || '',
                        edition_number: item.edition_number == null ? null : Number(item.edition_number),
                        edition_label: item.edition_label || '',
                        is_latest_edition: item.is_latest_edition === true,
                        visible: item.visible !== false,
                        passing_percentage: 50,
                        mastery_percentage: 90,
                    };
                });
            });
    }

    function publicCatalogSetItems() {
        if (!teacherLibraryCatalog || !teacherLibraryCatalog.items) return [];
        return teacherLibraryCatalog.items.filter(function(item) {
            return item.visible !== false;
        }).map(function(item) {
            return {
                set_id: item.id,
                id: item.id,
                title: item.title || item.id,
                course: item.sectionId || '',
                type: '',
                section: item.sectionId || '',
                sectionId: item.sectionId || '',
                link: item.href || '#',
                href: item.href || '#',
                displayValue: item.displayValue || '',
                sortValue: item.sortValue || '',
                topic: item.topic || '',
                tags: item.tags || [],
                note: item.note || '',
                edition_family: item.edition_family || '',
                edition_number: item.edition_number == null ? null : Number(item.edition_number),
                edition_label: item.edition_label || '',
                is_latest_edition: item.is_latest_edition === true,
                visible: item.visible !== false,
                passing_percentage: 50,
                mastery_percentage: 90,
                publicCatalogOnly: true,
            };
        });
    }

    function mergeCloudAndPublicSets(cloudSets) {
        var byId = {};
        var merged = [];
        (cloudSets || []).forEach(function(item) {
            var id = item.set_id || item.id;
            if (!id || byId[id]) return;
            byId[id] = true;
            merged.push(Object.assign({}, item, {
                publicCatalogOnly: false,
                cloudReady: true
            }));
        });
        publicCatalogSetItems().forEach(function(item) {
            var id = item.set_id || item.id;
            if (!id || byId[id]) return;
            byId[id] = true;
            merged.push(item);
        });
        return merged;
    }

    function teacherLibraryDisplayItems() {
        var byId = {};
        var items = [];
        (state.sets || []).forEach(function(item) {
            var id = item.set_id || item.id || item.displayValue || item.href || item.title;
            if (id) byId[id] = true;
            items.push(item);
        });
        publicCatalogSetItems().forEach(function(item) {
            var id = item.set_id || item.id;
            if (!id || byId[id]) return;
            byId[id] = true;
            items.push(item);
        });
        return items;
    }

    function renderCachedTeacherWorkspace() {
        fillClassFilters();
        fillSetSectionFilters();
        renderSetOptions();
        loadCandidates();
        renderLibrary();
        renderStudentList();
        renderStudentDetail();
        renderAssignmentOverview();
        updateAssignView();
        restorePendingTeacherViewport();
    }

    function hydrateTeacherWorkspaceCache(profile) {
        return readTeacherWorkspaceCache(profile).then(function(record) {
            if (!record) return false;
            state.students = Array.isArray(record.students) ? record.students : [];
            state.classDirectory = Array.isArray(record.classes) ? record.classes : [];
            state.sets = Array.isArray(record.sets) ? record.sets : [];
            state.assignments = Array.isArray(record.assignments) ? record.assignments : [];
            state.progressItems = Array.isArray(record.progress) ? record.progress : [];
            state.matrixInitialRevealPending = false;
            renderCachedTeacherWorkspace();
            return true;
        });
    }

    function loadData() {
        var studentsPromise = teacherCall('listStudents');
        var classesPromise = teacherCall('listClasses').catch(function() { return { classes: [], unavailable: true }; });
        var setsPromise = teacherCall('listSets').catch(function() { return { sets: [], unavailable: true }; });
        var assignmentsPromise = teacherCall('listAssignments');
        var progressPromise = loadProgressData();
        var starPromise = loadStarRedemptions();
        var catalogPromise = loadPublicCatalog().catch(function() {
            teacherLibraryCatalog = teacherLibraryCatalog || { sections: [], items: [] };
        });
        initializeTeacherMessageCaches();

        Promise.all([setsPromise, progressPromise, catalogPromise]).then(function(results) {
            var viewport = matrixScrollSnapshot(document.getElementById('assignment-overview'));
            var setResult = results[0] || {};
            var progressResult = results[1] || {};
            if (!setResult.unavailable) state.sets = mergeCloudAndPublicSets(setResult.sets || []);
            if (!progressResult.unavailable) state.progressItems = progressResult.progress || [];
            renderAssignmentOverview();
            restoreMatrixScroll(viewport);
            restorePendingTeacherViewport();
        }).catch(function() {});

        return Promise.all([
            studentsPromise,
            setsPromise,
            assignmentsPromise,
            progressPromise,
            starPromise,
            catalogPromise,
            classesPromise
        ]).then(function(results) {
            var viewport = matrixScrollSnapshot(document.getElementById('assignment-overview'));
            state.students = results[0].students || [];
            if (!results[1].unavailable) state.sets = mergeCloudAndPublicSets(results[1].sets || []);
            state.assignments = results[2].assignments || [];
            if (!results[6].unavailable) state.classDirectory = results[6].classes || [];
            if (!results[3].unavailable) state.progressItems = results[3].progress || [];
            teacherLiveDataLoadedAt = Date.now();
            afterDataLoaded();
            restoreMatrixScroll(viewport);
            restorePendingTeacherViewport(true);
            writeTeacherWorkspaceCache();
            scheduleTeacherProgressRefresh();
        });
    }

    function refreshTeacherLiveProgress() {
        if (teacherLiveRefreshPromise || !state.profile || document.hidden || activeTeacherViewName() !== 'view') {
            return teacherLiveRefreshPromise || Promise.resolve(false);
        }
        teacherLiveRefreshPromise = Promise.all([
            teacherCall('listAssignments').catch(function() { return { assignments: [], unavailable: true }; }),
            loadProgressData(),
            loadActivityState()
        ]).then(function(results) {
            var viewport = matrixScrollSnapshot(document.getElementById('assignment-overview'));
            if (!results[0].unavailable) state.assignments = results[0].assignments || [];
            if (!results[1].unavailable) state.progressItems = results[1].progress || [];
            applyActivityState(results[2]);
            refreshNotificationFeedFromActivityState();
            teacherLiveDataLoadedAt = Date.now();
            renderAssignmentOverview();
            if (state.updatesOpen) updateTopBadges();
            else renderUpdatesPanel();
            restoreMatrixScroll(viewport);
            writeTeacherWorkspaceCache();
            return true;
        }).catch(function() {
            return false;
        }).then(function(result) {
            teacherLiveRefreshPromise = null;
            return result;
        });
        return teacherLiveRefreshPromise;
    }

    function scheduleTeacherProgressRefresh() {
        if (teacherRefreshTimer) window.clearInterval(teacherRefreshTimer);
        teacherRefreshTimer = window.setInterval(function() {
            refreshTeacherLiveProgress();
        }, TEACHER_PROGRESS_REFRESH_MS);
    }

    function afterDataLoaded() {
        fillClassFilters();
        fillSetSectionFilters();
        resetAssignParameters();
        renderSetOptions();
        loadCandidates();
        renderLibrary();
        renderStudentList();
        renderStudentDetail();
        renderAssignmentOverview();
        updateAssignView();
        renderUpdatesPanel();
        renderDisputes();
    }

    document.querySelectorAll('.tab-button').forEach(function(button) {
        button.addEventListener('click', function() {
            activateView(button.dataset.view);
        });
    });
    document.querySelectorAll('[data-task-view]').forEach(function(button) {
        button.addEventListener('click', function() {
            state.taskView = button.dataset.taskView;
            updateAssignView();
        });
    });
    var teacherChip = document.getElementById('teacher-chip');
    if (teacherChip) {
        teacherChip.addEventListener('click', function(event) {
            event.stopPropagation();
            setTeacherAccountPanel(!state.accountPanelOpen);
        });
    }
    var teacherAccountClose = document.getElementById('teacher-account-close');
    if (teacherAccountClose) {
        teacherAccountClose.addEventListener('click', function() {
            setTeacherAccountPanel(false);
        });
    }
    var teacherStarButton = document.getElementById('teacher-star-button');
    if (teacherStarButton) teacherStarButton.addEventListener('click', function(event) {
        event.stopPropagation();
        state.starReturnToStudentLookup = state.studentLookupOpen === true;
        setStarRedemptionPanel(!state.starOpen);
    });
    var teacherStarBack = document.getElementById('teacher-star-back');
    if (teacherStarBack) teacherStarBack.addEventListener('click', function() { setStarRedemptionPanel(false); });
    if (teacherStarPanel) teacherStarPanel.addEventListener('click', function(event) { if (event.target === teacherStarPanel) setStarRedemptionPanel(false); });
    document.querySelectorAll('[data-star-request-view]').forEach(function(button) {
        button.addEventListener('click', function() { state.starRequestView = button.dataset.starRequestView; renderStarRedemptions(); });
    });
    var teacherReviewButton = document.getElementById('teacher-review-button');
    if (teacherReviewButton) {
        teacherReviewButton.addEventListener('click', function(event) {
            event.stopPropagation();
            setReviewPanel(!state.reviewOpen);
        });
    }
    var teacherReviewClose = document.getElementById('teacher-review-close');
    if (teacherReviewClose) {
        teacherReviewClose.addEventListener('click', function() {
            setReviewPanel(false);
        });
    }
    var teacherReviewPanel = document.getElementById('teacher-review-panel');
    if (teacherReviewPanel) {
        teacherReviewPanel.addEventListener('click', function(event) {
            if (event.target === teacherReviewPanel) setReviewPanel(false);
        });
    }
    var teacherDictionaryButton = document.getElementById('teacher-dictionary-button');
    if (teacherDictionaryButton) teacherDictionaryButton.addEventListener('click', function(event) {
        event.stopPropagation();
        setDictionaryPanel(!state.dictionaryOpen);
    });
    var teacherDictionaryClose = document.getElementById('teacher-dictionary-close');
    if (teacherDictionaryClose) teacherDictionaryClose.addEventListener('click', function() { setDictionaryPanel(false); });
    var teacherDictionaryPanel = document.getElementById('teacher-dictionary-panel');
    if (teacherDictionaryPanel) teacherDictionaryPanel.addEventListener('click', function(event) {
        if (event.target === teacherDictionaryPanel) setDictionaryPanel(false);
    });
    document.querySelectorAll('[data-dictionary-category]').forEach(function(button) {
        button.addEventListener('click', function() {
            state.dictionaryCategory = button.dataset.dictionaryCategory;
            state.selectedDictionaryWord = '';
            renderDictionaryWorkspace();
        });
    });
    var teacherDictionarySearch = document.getElementById('teacher-dictionary-search');
    if (teacherDictionarySearch) teacherDictionarySearch.addEventListener('input', function() {
        state.dictionarySearch = teacherDictionarySearch.value;
        renderDictionaryWorkspace();
    });
    document.getElementById('teacher-updates-button').addEventListener('click', function() {
        state.updatesOpen = state.updatesOpen !== true;
        if (!state.updatesOpen) state.notificationAttemptId = '';
        if (state.updatesOpen) {
            setStarRedemptionPanel(false);
            setReviewPanel(false);
        }
        renderUpdatesPanel();
    });
    document.getElementById('teacher-updates-close').addEventListener('click', function() {
        state.updatesOpen = false;
        state.notificationAttemptId = '';
        renderUpdatesPanel();
    });
    var teacherUpdatesReadAll = document.getElementById('teacher-updates-read-all');
    if (teacherUpdatesReadAll) {
        teacherUpdatesReadAll.addEventListener('click', function() {
            var unreadCount = state.notificationUnreadThreadCount == null
                ? activityAttemptCounts().unread
                : Number(state.notificationUnreadThreadCount || 0);
            if (state.activityReadAllPending || unreadCount <= 0) return;
            state.activityReadAllPending = true;
            renderUpdatesPanel();
            teacherCall('markActivityAttemptsReadAll').then(function(result) {
                state.activityReadAllAt = result.read_all_at || new Date().toISOString();
                state.activityReviewedAttemptIds = result.reviewed_attempt_ids || [];
                state.notificationUnreadThreadCount = 0;
                state.activityReadAllSuccess = true;
                showMessage('All student attempt notifications marked as read.', 'success');
            }).catch(function(error) {
                showMessage(error.message, 'error');
            }).then(function() {
                state.activityReadAllPending = false;
                renderUpdatesPanel();
                if (state.activityReadAllSuccess) {
                    window.setTimeout(function() {
                        state.activityReadAllSuccess = false;
                        renderUpdatesPanel();
                    }, 900);
                }
            });
        });
    }
    if (updatesPanel) {
        updatesPanel.addEventListener('click', function(event) {
            if (event.target === updatesPanel) {
                state.updatesOpen = false;
                state.notificationAttemptId = '';
                renderUpdatesPanel();
            }
        });
    }
    var toggleAssignSets = document.getElementById('toggle-assign-sets');
    if (toggleAssignSets) {
        toggleAssignSets.addEventListener('click', function() {
            setAssignPanel('sets', state.assignPanels.sets !== true);
        });
    }
    var toggleAssignStudents = document.getElementById('toggle-assign-students');
    if (toggleAssignStudents) {
        toggleAssignStudents.addEventListener('click', function() {
            setAssignPanel('students', state.assignPanels.students !== true);
        });
    }
    var toggleAssignOptions = document.getElementById('toggle-assign-options');
    if (toggleAssignOptions) {
        toggleAssignOptions.addEventListener('click', function() {
            setAssignPanel('options', state.assignPanels.options !== true);
        });
    }
    var assignSetsDone = document.getElementById('assign-sets-done');
    if (assignSetsDone) {
        assignSetsDone.addEventListener('click', function() {
            setAssignPanel('sets', false);
        });
    }
    var assignSetsClose = document.getElementById('assign-sets-close');
    if (assignSetsClose) {
        assignSetsClose.addEventListener('click', function() {
            setAssignPanel('sets', false);
        });
    }
    var assignStudentsDone = document.getElementById('assign-students-done');
    if (assignStudentsDone) {
        assignStudentsDone.addEventListener('click', function() {
            rememberSelectedCandidates();
            updateSelectedCount();
            renderSetOptions();
            setAssignPanel('students', false);
        });
    }
    var assignStudentsClose = document.getElementById('assign-students-close');
    if (assignStudentsClose) {
        assignStudentsClose.addEventListener('click', function() {
            rememberSelectedCandidates();
            updateSelectedCount();
            renderSetOptions();
            setAssignPanel('students', false);
        });
    }
    var assignSetsPanel = document.getElementById('assign-sets-panel');
    if (assignSetsPanel) {
        assignSetsPanel.addEventListener('click', function(event) {
            if (event.target === assignSetsPanel) setAssignPanel('sets', false);
        });
    }
    var assignStudentsPanel = document.getElementById('assign-students-panel');
    if (assignStudentsPanel) {
        assignStudentsPanel.addEventListener('click', function(event) {
            if (event.target === assignStudentsPanel) {
                rememberSelectedCandidates();
                updateSelectedCount();
                renderSetOptions();
                setAssignPanel('students', false);
            }
        });
    }
    var assignSetSelect = document.getElementById('assign-set');
    if (assignSetSelect) {
        assignSetSelect.addEventListener('change', function() {
            syncSelectedAssignSets();
            updateSelectedCount();
            loadCandidates();
        });
    }
    document.getElementById('assign-section-filter').addEventListener('change', function() {
        renderSetOptions();
    });
    document.getElementById('assign-set-search').addEventListener('input', function() {
        renderSetOptions();
    });
    document.getElementById('assign-search').addEventListener('input', renderCandidates);
    document.getElementById('assign-class-filter').addEventListener('change', renderCandidates);
    document.getElementById('library-search').addEventListener('input', function() {
        renderTeacherLibrary(teacherLibraryActiveTab);
    });
    document.getElementById('teacher-library-tab-bar').addEventListener('click', function(e) {
        var btn = e.target.closest('.library-tab-btn');
        if (!btn) return;
        var tabId = btn.getAttribute('data-tab');
        if (tabId === teacherLibraryActiveTab) return;
        teacherLibraryActiveTab = tabId;
        teacherLibraryActiveSubTab = '';
        var bar = document.getElementById('teacher-library-tab-bar');
        if (bar) {
            var tabs = bar.querySelectorAll('.library-tab-btn');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tabId);
            }
        }
        renderTeacherLibrary(tabId);
    });
    document.getElementById('assign-selected').addEventListener('click', function() {
        var button = this;
        var studentUids = selectedCandidateUids();
        var assignSuccessResult = null;
        var assignParameters;
        try {
            assignParameters = collectAssignParameters();
        } catch (error) {
            showMessage(error.message, 'error');
            return;
        }
        button.disabled = true;
        showMessage('Assigning practice...', '');
        var payload = {
            set_ids: assignmentTargetSetIds(),
            student_uids: studentUids,
            set_options: assignParameters.set_options
        };
        teacherCall('createAssignments', payload).then(function(result) {
            assignSuccessResult = result;
            showMessage('', '');
            state.selectedAssignSetIds = {};
            state.selectedAssignStudentUids = {};
            resetAssignParameters();
            document.getElementById('assign-set-search').value = '';
            document.getElementById('assign-section-filter').value = '';
            document.getElementById('assign-search').value = '';
            document.getElementById('assign-class-filter').value = '';
            var assignSet = document.getElementById('assign-set');
            if (assignSet) assignSet.selectedIndex = -1;
            return Promise.all([teacherCall('listAssignments'), loadProgressData(), loadCandidates()]);
        }).then(function(results) {
            state.assignments = results[0].assignments || [];
            state.progressItems = results[1].progress || [];
            renderSetOptions();
            renderStudentDetail();
            renderAssignmentOverview();
            updateAssignView();
            setAssignSuccessModal(true, assignSuccessResult);
        }).catch(function(error) {
            showMessage(error.message, 'error');
        }).finally(updateSelectedCount);
    });

    document.getElementById('student-search').addEventListener('focus', function() {
        openStudentSelector('search');
    });
    document.getElementById('student-search').addEventListener('input', function() {
        setStudentPickerOpen(true, 'search');
        renderStudentList();
    });
    document.getElementById('student-lookup-back').addEventListener('click', returnToStudentSearch);
    document.getElementById('student-class-filter').addEventListener('change', renderStudentList);
    document.addEventListener('click', function(event) {
        if (handleAssignmentEditTrigger(event)) return;
        var createPanel = document.getElementById('create-student-panel');
        if (createPanel && !createPanel.hidden && event.target === createPanel) {
            setCreateStudentModal(false, true);
            return;
        }
        var createSuccessPanel = document.getElementById('create-student-success-panel');
        if (createSuccessPanel && !createSuccessPanel.hidden && event.target === createSuccessPanel) {
            closeCreateStudentSuccessModal();
            return;
        }
        var assignSuccessPanel = document.getElementById('assign-success-panel');
        if (assignSuccessPanel && !assignSuccessPanel.hidden && event.target === assignSuccessPanel) {
            setAssignSuccessModal(false);
            return;
        }
        var passwordResetSuccessPanel = document.getElementById('password-reset-success-panel');
        if (passwordResetSuccessPanel && !passwordResetSuccessPanel.hidden && event.target === passwordResetSuccessPanel) {
            setPasswordResetSuccessModal(false);
            return;
        }
        var studentLookupPanel = document.getElementById('student-lookup-panel');
        if (studentLookupPanel && !studentLookupPanel.hidden && event.target === studentLookupPanel) {
            setStudentLookupPanel(false);
            return;
        }
        if (state.accountPanelOpen && teacherAccountPanel && !teacherAccountPanel.contains(event.target) && !event.target.closest('#teacher-chip')) {
            setTeacherAccountPanel(false);
        }
        var openCard = event.target.closest('[data-open-href]');
        if (openCard) {
            openHrefCard(openCard, event);
            return;
        }
        var card = document.querySelector('.student-select-card');
        var lookupHead = event.target.closest('.student-lookup-head');
        if (card && !card.contains(event.target) && !lookupHead) setStudentPickerOpen(false);

        var subTabBtn = event.target.closest('#teacher-sub-tab-bar .sub-tab-btn');
        if (subTabBtn) {
            var subTab = subTabBtn.getAttribute('data-subtab');
            if (subTab === teacherLibraryActiveSubTab) return;
            teacherLibraryActiveSubTab = subTab;
            renderTeacherLibrary(teacherLibraryActiveTab);
            return;
        }

        var yearTab = event.target.closest('#teacher-year-bar .year-tab');
        if (yearTab) {
            var year = yearTab.getAttribute('data-year');
            var tabsContainer = yearTab.closest('.year-tabs');
            if (tabsContainer) {
                var tabs = tabsContainer.querySelectorAll('.year-tab');
                for (var ti = 0; ti < tabs.length; ti++) {
                    tabs[ti].classList.toggle('active', tabs[ti] === yearTab);
                }
                var cardsRoot = document.getElementById('teacher-library-content');
                if (cardsRoot) {
                    var cards = cardsRoot.querySelectorAll('.teacher-library-card');
                    for (var ci = 0; ci < cards.length; ci++) {
                        if (!year) {
                            cards[ci].classList.remove('year-hidden');
                        } else {
                            cards[ci].classList.toggle('year-hidden', cards[ci].getAttribute('data-year') !== year);
                        }
                    }
                }
            }
            return;
        }
    });
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape') {
            if (state.studentMetricView) {
                closeStudentMetricModal();
                return;
            }
            var createPanel = document.getElementById('create-student-panel');
            if (createPanel && !createPanel.hidden) {
                setCreateStudentModal(false, true);
                return;
            }
            var createSuccessPanel = document.getElementById('create-student-success-panel');
            if (createSuccessPanel && !createSuccessPanel.hidden) {
                closeCreateStudentSuccessModal();
                return;
            }
            var assignSuccessPanel = document.getElementById('assign-success-panel');
            if (assignSuccessPanel && !assignSuccessPanel.hidden) {
                setAssignSuccessModal(false);
                return;
            }
            var passwordResetSuccessPanel = document.getElementById('password-reset-success-panel');
            if (passwordResetSuccessPanel && !passwordResetSuccessPanel.hidden) {
                setPasswordResetSuccessModal(false);
                return;
            }
            if (state.studentAccountView) {
                closeStudentAccountModal();
                return;
            }
            if (state.starOpen) {
                setStarRedemptionPanel(false);
                return;
            }
            if (state.updatesOpen && state.notificationAttemptId) {
                state.notificationAttemptId = '';
                state.targetMatrixAttemptId = '';
                state.selectedMatrixReviewAttemptId = '';
                renderUpdatesPanel();
                return;
            }
            if (state.updatesOpen) {
                state.updatesOpen = false;
                renderUpdatesPanel();
                return;
            }
            if (state.reviewOpen) {
                setReviewPanel(false);
                return;
            }
            if (state.studentLookupOpen) {
                setStudentLookupPanel(false);
                return;
            }
            if (state.assignPanels.sets) {
                setAssignPanel('sets', false);
                return;
            }
            if (state.assignPanels.students) {
                rememberSelectedCandidates();
                updateSelectedCount();
                setAssignPanel('students', false);
                return;
            }
        }
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var openCard = event.target.closest('[data-open-href]');
        if (!openCard) return;
        if (event.target.closest('button, a')) return;
        event.preventDefault();
        openHrefCard(openCard, event);
    });
    document.getElementById('toggle-create-student').addEventListener('click', function() {
        setStudentLookupPanel(state.studentLookupOpen !== true);
    });
    document.getElementById('student-lookup-create').addEventListener('click', function() {
        setCreateStudentModal(true);
    });
    document.getElementById('student-lookup-close').addEventListener('click', function() {
        setStudentLookupPanel(false);
    });
    document.getElementById('create-student-back').addEventListener('click', function() {
        setCreateStudentModal(false, true);
    });
    var createSuccessClose = document.getElementById('create-student-success-close');
    if (createSuccessClose) {
        createSuccessClose.addEventListener('click', function() {
            closeCreateStudentSuccessModal();
        });
    }
    var assignSuccessClose = document.getElementById('assign-success-close');
    if (assignSuccessClose) {
        assignSuccessClose.addEventListener('click', function() {
            setAssignSuccessModal(false);
        });
    }
    var passwordResetSuccessClose = document.getElementById('password-reset-success-close');
    if (passwordResetSuccessClose) {
        passwordResetSuccessClose.addEventListener('click', function() {
            setPasswordResetSuccessModal(false);
        });
    }
    studentForm.addEventListener('submit', function(event) {
        event.preventDefault();
        var button = studentForm.querySelector('button[type="submit"]');
        var chineseName = document.getElementById('student-chinese-name').value.trim();
        var englishName = document.getElementById('student-english-name').value.trim();
        var legacyName = joinedStudentName(chineseName, englishName, '');
        if (!legacyName) {
            showMessage('Enter a Chinese name or English name.', 'error');
            return;
        }
        button.disabled = true;
        showMessage('Creating student account...', '');
        teacherCall('createStudent', {
            student_id: document.getElementById('student-id').value,
            // `name` remains the legacy display fallback for old surfaces and records.
            name: legacyName,
            chinese_name: chineseName,
            english_name: englishName,
            class_group: document.getElementById('student-class').value,
            curriculum_track: document.getElementById('student-curriculum').value
        }).then(function(result) {
            studentForm.reset();
            setCreateStudentModal(false);
            state.selectedStudentProfileId = result.student.profile_id;
            showMessage('Student created and activated.', 'success');
            setCreateStudentSuccessModal(true, result);
            state.students.push(result.student);
            fillClassFilters();
            renderStudentList();
            renderStudentDetail();
            window.setTimeout(function() {
                refreshStudents().catch(function() {});
            }, 1000);
        }).catch(function(error) {
            showMessage(error.message, 'error');
        }).finally(function() {
            button.disabled = false;
        });
    });
    var matrixAutoPhoneLayout = matrixUsesPhoneLayout();
    window.addEventListener('resize', function() {
        var nextPhoneLayout = matrixUsesPhoneLayout();
        if (nextPhoneLayout === matrixAutoPhoneLayout) return;
        matrixAutoPhoneLayout = nextPhoneLayout;
        state.matrixDensityStep = nextPhoneLayout ? null : readMatrixDensityPreference();
        var overview = document.getElementById('assignment-overview');
        if (overview && overview.querySelector('.progress-matrix-scroll')) renderAssignmentOverview();
    }, { passive: true });
    document.addEventListener('visibilitychange', function() {
        if (!document.hidden && teacherLiveDataLoadedAt
            && Date.now() - teacherLiveDataLoadedAt >= TEACHER_RETURN_REFRESH_AGE_MS) {
            refreshTeacherLiveProgress();
        }
    });
    applyTeacherWorkspaceHistoryState();
    applyTeacherViewShell(initialTeacherView());
    window.MrCatAuth.getSession().then(function(session) {
        if (session.mode === 'none') {
            window.location.replace('index.html');
            return null;
        }
        if (session.mode !== 'teacher') {
            window.location.replace('dashboard.html');
            return null;
        }
        state.profile = session.profile;
        document.getElementById('teacher-chip').textContent = session.profile.student_id;
        applyTeacherViewShell(initialTeacherView());
        return hydrateTeacherWorkspaceCache(session.profile).then(function() {
            return loadData();
        });
    }).then(function(result) {
        if (result === null) return;
        activateView(initialTeacherView(), true);
    }).catch(function(error) {
        setHeaderIconLoading(false);
        showMessage(error.message || 'Unable to load the teacher desk.', 'error');
    });
})();
