(function() {
    'use strict';

    var state = {
        profile: null,
        students: [],
        sets: [],
        assignments: [],
        progressItems: [],
        attempts: [],
        disputes: [],
        candidates: [],
        selectedAssignSetIds: {},
        selectedAssignStudentUids: {},
        selectedStudentProfileId: '',
        studentPickerMode: 'choose',
        assignPanels: { sets: false, students: false, options: false },
        taskView: 'assign',
        assignProgressMode: 'student',
        studentProgressView: 'to_do',
        studentInfoEdit: '',
        accountPanelOpen: false,
        updatesOpen: false,
        updatesFilter: 'unread',
        attemptsSeenAt: null,
        disputeFilter: 'pending',
        disputeMerge: false,
        libraryFilter: 'vocabulary',
        libraryBookFilters: {},
        expandedDisputes: {},
        expandedAssignmentSets: {},
        expandedAssignProgress: {},
        expandedAssignProgressGroups: {},
        matrixClassFilter: '',
        matrixRecentLimit: '7',
        matrixColumnFilter: '',
        matrixDateFilter: 'month',
        matrixDateFrom: '',
        matrixDateTo: '',
        selectedMatrixCell: '',
        assignmentEditScopes: {},
        expandedDisputeMerges: {}
    };
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
    var message = document.getElementById('teacher-message');
    var studentList = document.getElementById('student-list');
    var studentDetail = document.getElementById('student-detail');
    var studentForm = document.getElementById('student-form');
    var candidateList = document.getElementById('assign-candidates');
    var libraryList = document.getElementById('teacher-library-list');
    var updatesPanel = document.getElementById('teacher-updates-panel');
    var updatesBody = document.getElementById('teacher-updates-body');
    var teacherAccountPanel = document.getElementById('teacher-account-panel');
    var teacherAccountContent = document.getElementById('teacher-account-content');

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

    function showMessage(text, type) {
        message.textContent = text || '';
        message.className = 'teacher-message' + (type ? ' ' + type : '');
    }

    function pendingReviewCount() {
        return (state.disputes || []).filter(function(item) {
            return item.status !== 'approved' && item.status !== 'rejected';
        }).length;
    }

    function attemptsSeenDate() {
        if (state.attemptsSeenAt) {
            var stored = new Date(state.attemptsSeenAt);
            if (!isNaN(stored.getTime())) return stored;
        }
        var fallback = new Date();
        fallback.setHours(fallback.getHours() - 24);
        return fallback;
    }

    function sortedAttempts() {
        return (state.attempts || []).slice().sort(function(a, b) {
            return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
        });
    }

    function isAttemptUnread(attempt) {
        var submitted = new Date(attempt.submitted_at || 0);
        return !isNaN(submitted.getTime()) && submitted > attemptsSeenDate();
    }

    function activityAttemptCounts() {
        return sortedAttempts().reduce(function(counts, attempt) {
            counts.total += 1;
            if (isAttemptUnread(attempt)) counts.unread += 1;
            else counts.read += 1;
            return counts;
        }, { total: 0, unread: 0, read: 0 });
    }

    function reviewActivityCounts() {
        return (state.disputes || []).reduce(function(counts, item) {
            var pending = item.status !== 'approved' && item.status !== 'rejected';
            if (pending) counts.pending += 1;
            else counts.finished += 1;
            return counts;
        }, { pending: 0, finished: 0 });
    }

    function updateActivityBadges() {
        var attemptCounts = activityAttemptCounts();
        var reviewCounts = reviewActivityCounts();
        var total = attemptCounts.unread + reviewCounts.pending;
        var count = document.getElementById('teacher-updates-count');
        var button = document.getElementById('teacher-updates-button');
        if (count) {
            count.textContent = total ? String(total) : '';
            count.hidden = total <= 0;
        }
        if (button) button.classList.toggle('has-updates', total > 0);
    }

    function updateTopBadges() {
        var count = pendingReviewCount();
        var tasksButton = document.querySelector('.tab-button[data-view="tasks"]');
        if (tasksButton) {
            tasksButton.innerHTML = 'Tasks' + (count ? '<span class="notice-dot danger">' + escapeHtml(count) + '</span>' : '');
        }
        var reviewButton = document.querySelector('[data-task-view="review"] .summary-label');
        if (reviewButton) {
            reviewButton.innerHTML = 'REVIEW' + (count ? ' ' + escapeHtml(count) : '');
        }
        updateActivityBadges();
    }

    function updateAssignView() {
        document.querySelectorAll('[data-task-view]').forEach(function(button) {
            button.classList.toggle('active', button.dataset.taskView === state.taskView);
        });
        var assignPanel = document.getElementById('task-assign-panel');
        var reviewPanel = document.getElementById('task-review-panel');
        if (assignPanel) assignPanel.hidden = state.taskView !== 'assign';
        if (reviewPanel) reviewPanel.hidden = state.taskView !== 'review';
        if (state.taskView === 'review') renderDisputes();
        updateTopBadges();
    }

    function renderTeacherAccount() {
        if (!teacherAccountContent) return;
        var profile = state.profile || {};
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
            '</div>';
        var logout = document.getElementById('teacher-logout');
        if (logout) logout.addEventListener('click', window.MrCatAuth.logout);
    }

    function setTeacherAccountPanel(open) {
        state.accountPanelOpen = open === true;
        if (teacherAccountPanel) teacherAccountPanel.hidden = !state.accountPanelOpen;
        var chip = document.getElementById('teacher-chip');
        if (chip) chip.setAttribute('aria-expanded', state.accountPanelOpen ? 'true' : 'false');
        if (state.accountPanelOpen) renderTeacherAccount();
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

    function loadProgressData() {
        return teacherCall('listProgress').catch(function() {
            return { progress: [] };
        });
    }

    function loadActivityState() {
        return teacherCall('getActivityState').catch(function() {
            return { attempts_seen_at: null };
        });
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

    function setSections() {
        var seen = {};
        return state.sets.map(function(set) {
            return String(set.section || set.course || set.type || 'Other').trim();
        }).filter(function(value) {
            if (!value || seen[value]) return false;
            seen[value] = true;
            return true;
        }).sort();
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
        if (haystack.indexOf('ielts-reading') !== -1 || haystack.indexOf('ielts reading') !== -1) return 'ielts-reading';
        if (haystack.indexOf('ielts-listening') !== -1 || haystack.indexOf('ielts listening') !== -1) return 'ielts-listening';
        if (haystack.indexOf('bbc-six-minute-english') !== -1 || haystack.indexOf('bbc listening') !== -1 || haystack.indexOf('bbc') !== -1) return 'bbc-listening';
        if (haystack.indexOf('vocab') !== -1 || haystack.indexOf('ngsl') !== -1) return 'vocabulary';
        if (haystack.indexOf('grammar') !== -1) return 'grammar';
        return 'other';
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

    var TEACHER_LIBRARY_GROUP_IDS = {
        general: ['basics'],
        exam: ['ielts', 'dse'],
        lessons: ['lessons']
    };

    var TEACHER_LIBRARY_SUB_TABS = {
        general: [
            { id: '', label: 'All' },
            { id: 'bbc-six-minute-english', label: 'BBC', yearFilter: true },
            { id: 'vocabulary', label: 'Vocabulary' },
            { id: 'grammar', label: 'Grammar' },
            { id: 'general-writing', label: 'Writing' }
        ],
        exam: [
            { id: '', label: 'All' },
            { id: 'ielts-reading', label: 'IELTS Reading', bookFilter: true },
            { id: 'ielts-listening', label: 'IELTS Listening', bookFilter: true },
            { id: 'dse-english-paper-1', label: 'DSE Reading' },
            { id: 'dse-english-paper-2', label: 'DSE Writing' },
            { id: 'dse-integrated', label: 'DSE Integrated' },
            { id: 'dse-english-paper-4', label: 'DSE Speaking' }
        ],
        lessons: [
            { id: '', label: 'All' },
            { id: 'lesson-grammar', label: 'Grammar' },
            { id: 'lesson-dse', label: 'DSE' },
            { id: 'lesson-ielts', label: 'IELTS' }
        ]
    };

    function teacherLibraryLoadSections() {
        if (teacherLibraryCatalog) return Promise.resolve();
        return fetch('data/home-catalog.json?_=' + Date.now())
            .then(function(r) { if (!r.ok) return; return r.json(); })
            .then(function(c) { if (c) teacherLibraryCatalog = c; })
            .catch(function() {});
    }

    function teacherLibraryBadge(item, section, itemYear) {
        var sectionId = section && section.id || item.sectionId || item.section_id || '';
        if (sectionId === 'bbc-six-minute-english') return itemYear || String(item.sortValue || '').substring(0, 4);
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

    function teacherBuildCard(item, section, hidden, itemYear) {
        var sectionId = section && section.id || item.sectionId || item.section_id || '';
        var meta = teacherLibrarySectionLabel(sectionId, section && section.title || item.section || item.course || item.type || sectionId);
        var setId = item.set_id || item.id || item.displayValue || '';
        var badge = teacherLibraryBadge(item, section, itemYear);
        var href = teacherPracticeHref(item);
        var itemStatus = practiceEntryStatus({ dataset: { entryStatus: item.status || '' } });
        return '<article class="resource-card library-task-card teacher-library-card' + (hidden ? ' year-hidden' : '') + '"' +
            (itemYear ? ' data-year="' + escapeHtml(itemYear) + '"' : '') +
            ' data-entry-kind="' + escapeHtml(meta) + '" data-entry-title="' + escapeHtml(item.title || setId || 'Practice') + '"' +
            ' data-entry-status="' + escapeHtml(itemStatus) + '" data-entry-best="' + escapeHtml(item.best_percentage == null ? '' : item.best_percentage) + '"' +
            ' data-open-href="' + escapeHtml(href) + '" role="link" tabindex="0" aria-label="Open ' + escapeHtml(item.title || setId) + '">' +
            '<div class="library-task-copy">' +
                '<div class="resource-card-head">' +
                    '<p class="eyebrow accent">' + escapeHtml(meta) + '</p>' +
                    '<span>' + escapeHtml(setId) + '</span>' +
                '</div>' +
                '<h3>' + escapeHtml(item.title || setId) + '</h3>' +
            '</div>' +
            '<div class="library-task-actions">' +
                (badge ? '<span class="library-card-badge">' + escapeHtml(badge) + '</span>' : '') +
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

    function practiceEntryStatusText(status, best) {
        if (status === 'not-passed') return 'Not yet';
        var labels = {
            passed: 'Passed',
            mastered: 'Mastered'
        };
        return (labels[status] || 'Not yet') + ' · Best ' + formatEntryPercent(best);
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
                    '<div class="practice-entry-stamp">Ready?</div>' +
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
            if (href) window.location.href = href;
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

    function handlePracticeEntryKeydown(event) {
        if (event.key === 'Escape') closePracticeEntryDialog();
    }

    function showPracticeEntryDialog(element, href) {
        var overlay = ensurePracticeEntryDialog();
        var status = practiceEntryStatus(element);
        var best = element && element.dataset && element.dataset.entryBest;
        overlay.dataset.href = href || '';
        overlay.querySelector('#practice-entry-kind').textContent = practiceEntryKind(element);
        overlay.querySelector('#practice-entry-title').textContent = practiceEntryTitle(element);
        overlay.querySelector('#practice-entry-ribbon').className = 'practice-entry-ribbon ' + status;
        overlay.querySelector('#practice-entry-status').textContent = practiceEntryStatusText(status, best);
        overlay.hidden = false;
        overlay.querySelector('#practice-entry-enter').focus();
        document.addEventListener('keydown', handlePracticeEntryKeydown);
    }

    function openHrefCard(card, event) {
        if (!card) return;
        if (event && event.target && event.target.closest('button, a')) return;
        var href = card.dataset.openHref;
        if (href) showPracticeEntryDialog(card, href);
    }

    function teacherLibraryItemIdentity(item) {
        return String(item && (item.set_id || item.id || item.displayValue || item.href || item.title) || '');
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
            vocabulary: 'vocabulary',
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
            var isActive = (!teacherLibraryActiveSubTab && !subTabs[si].id) || subTabs[si].id === teacherLibraryActiveSubTab;
            subTabHtml += '<button class="sub-tab-btn' + (isActive ? ' active' : '') + '" data-subtab="' + escapeHtml(subTabs[si].id) + '">' + escapeHtml(subTabs[si].label) + '</button>';
        }
        subTabBar.innerHTML = subTabHtml;
        subTabBar.style.display = 'flex';

        var activeSubTabConfig = subTabs[0];
        for (var si = 0; si < subTabs.length; si++) {
            if ((!teacherLibraryActiveSubTab && !subTabs[si].id) || subTabs[si].id === teacherLibraryActiveSubTab) {
                activeSubTabConfig = subTabs[si];
                break;
            }
        }

        var tabSections = teacherGetTabSections(tabId);
        var targetSectionId = activeSubTabConfig.id;

        var itemsBySection = {};
        var allItems = (state.sets || []).filter(function(item) { return item.visible !== false; });
        for (var i = 0; i < allItems.length; i++) {
            var item = allItems[i];
            var sid = item.sectionId || item.section_id || '';
            if (!sid) {
                var cat = setCategory(item);
                if (cat === 'vocabulary') sid = 'vocabulary';
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
            if (targetSectionId && section.id !== targetSectionId) continue;

            var sectionItems = (itemsBySection[section.id] || []).filter(function(item) {
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
                    var itemYear = section.yearFilter ? String(item.sortValue || '').substring(0, 4) : '';
                    var hidden = activeYear && itemYear !== activeYear;
                    cardsHtml += teacherBuildCard(item, section, hidden, itemYear);
                }
            } else if (!targetSectionId && !section.yearFilter) {
                cardsHtml += teacherBuildPlaceholder(section);
            }
        }

        if (targetSectionId && !cardsHtml) {
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
            return '<option value="' + escapeHtml(section) + '">' + escapeHtml(section) + '</option>';
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
            var setSection = String(set.section || set.course || set.type || 'Other');
            var matchesSection = !section || setSection === section;
            var matchesLibrary = prefix !== 'library' || setCategory(set) === state.libraryFilter;
            var matchesBook = prefix !== 'library' || !libraryBook || cambridgeBookId(set) === libraryBook;
            var haystack = [set.set_id, set.title, set.course, set.type, set.section].join(' ').toLowerCase();
            return matchesSection && matchesLibrary && matchesBook && (!query || haystack.indexOf(query) !== -1);
        });
        return prefix === 'assign' ? sortAssignSets(sets, section) : sets;
    }

    function renderSetOptions() {
        var sets = filteredSets('assign');
        var select = document.getElementById('assign-set');
        var list = document.getElementById('assign-set-list');
        if (select) {
            select.innerHTML = sets.map(function(set) {
                return '<option value="' + escapeHtml(set.set_id) + '"' +
                    (state.selectedAssignSetIds[set.set_id] ? ' selected' : '') + '>' +
                    escapeHtml(set.title + ' · ' + set.course) + '</option>';
            }).join('');
        }
        if (list) {
            list.innerHTML = sets.length ? sets.map(function(set) {
                var selected = state.selectedAssignSetIds[set.set_id] === true;
                var meta = [set.set_id, set.course || set.type || set.section || ''].filter(Boolean).join(' · ');
                return '<label class="assign-choice-card' + (selected ? ' selected' : '') + '">' +
                    '<input class="assign-set-checkbox" type="checkbox" value="' + escapeHtml(set.set_id) + '"' +
                        (selected ? ' checked' : '') + '>' +
                    '<span class="assign-choice-mark" aria-hidden="true"></span>' +
                    '<span class="assign-choice-copy"><strong>' + escapeHtml(set.title || set.set_id) + '</strong>' +
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

    function renderAssignChips(containerId, items, labelFn) {
        var container = document.getElementById(containerId);
        if (!container) return;
        if (!items.length) {
            container.innerHTML = '<span class="assign-empty-chip">Nothing selected yet</span>';
            return;
        }
        var visible = items.slice(0, 3);
        container.innerHTML = visible.map(function(item) {
            return '<span class="assign-chip">' + escapeHtml(labelFn(item)) + '</span>';
        }).join('') + (items.length > visible.length
            ? '<span class="assign-chip more">+ ' + escapeHtml(items.length - visible.length) + ' more</span>'
            : '');
    }

    function updateAssignOptionsSummary() {
        var summary = document.getElementById('assign-options-summary');
        if (!summary) return;
        var parts = [];
        var dueEl = document.getElementById('assign-due');
        var passingEl = document.getElementById('assign-passing');
        var masteryEl = document.getElementById('assign-mastery');
        var due = dueEl ? dueEl.value : '';
        var passing = passingEl ? passingEl.value : '';
        var mastery = masteryEl ? masteryEl.value : '';
        if (due) parts.push('Due ' + due);
        if (passing) parts.push('Pass ' + passing + '%');
        if (mastery) parts.push('Mastery ' + mastery + '%');
        summary.textContent = parts.length ? parts.join(' · ') : 'Default';
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
        state.assignPanels[key] = open;
        updateAssignPanelState();
    }

    function updateAssignSummary() {
        var sets = selectedSetRecords();
        var students = selectedCandidateRecords();
        var setCount = document.getElementById('assign-set-count');
        var studentCount = document.getElementById('assign-student-count');
        if (setCount) setCount.textContent = sets.length
            ? sets.length + ' selected'
            : 'None selected';
        if (studentCount) studentCount.textContent = students.length
            ? students.length + ' selected'
            : 'None selected';
        renderAssignChips('assign-set-chips', sets, function(set) { return set.set_id || set.title; });
        renderAssignChips('assign-student-chips', students, function(student) { return student.name || student.student_id || student.auth_uid; });
        updateAssignOptionsSummary();
    }

    function teacherPracticeHref(set) {
        var href = set.link || '#';
        var params = ['teacher=1'];
        if (window.MRCAT_CONFIG && window.MRCAT_CONFIG.appVersion) {
            params.push('app=' + encodeURIComponent(window.MRCAT_CONFIG.appVersion));
        }
        return href + (href.indexOf('?') === -1 ? '?' : '&') + params.join('&');
    }

    function renderLibrary() {
        renderTeacherLibrary(teacherLibraryActiveTab);
    }

    function candidateStatus(candidate) {
        if (candidate.availability === 'starred') {
            return {
                label: candidate.star_source === 'explore' ? 'STAR · can reassign' : 'STAR · can reassign',
                css: 'starred',
                disabled: false
            };
        }
        if (candidate.availability === 'in_progress') {
            return { label: 'In Progress', css: 'progress', disabled: true };
        }
        if (candidate.availability === 'completed') {
            return { label: 'Completed · can reassign', css: 'starred', disabled: false };
        }
        return { label: 'Available', css: 'available', disabled: false };
    }

    function filteredCandidates() {
        var query = document.getElementById('assign-search').value.trim().toLowerCase();
        var classGroup = document.getElementById('assign-class-filter').value;
        return state.candidates.filter(function(student) {
            var matchesQuery = !query || [student.name, student.student_id, student.class_group, student.curriculum_track]
                .join(' ').toLowerCase().indexOf(query) !== -1;
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
        if (!assignmentTargetSetIds().length) {
            candidateList.innerHTML = '<div class="empty-card compact-empty"><strong>Choose work</strong>Select one or more tasks first.</div>';
            updateSelectedCount();
            return;
        }
        candidateList.innerHTML = candidates.length ? candidates.map(function(student) {
            var status = candidateStatus(student);
            var selected = state.selectedAssignStudentUids[student.auth_uid] && !status.disabled;
            return '<label class="candidate-card assign-choice-card ' + status.css + (selected ? ' selected' : '') + (status.disabled ? ' disabled' : '') + '">' +
                '<input class="candidate-checkbox" type="checkbox" value="' + escapeHtml(student.auth_uid) + '"' +
                    (selected ? ' checked' : '') +
                    (status.disabled ? ' disabled' : '') + '>' +
                '<span class="assign-choice-mark" aria-hidden="true"></span>' +
                '<span class="candidate-copy assign-choice-copy"><strong>' + escapeHtml(student.name || student.student_id) + '</strong>' +
                    '<small>' + escapeHtml(student.class_group || 'No class') + '</small></span>' +
            '</label>';
        }).join('') : '<div class="empty-card compact-empty"><strong>No matching students</strong>Try another search or class.</div>';

        candidateList.querySelectorAll('.candidate-checkbox').forEach(function(checkbox) {
            checkbox.addEventListener('change', function() {
                rememberSelectedCandidates();
                var card = checkbox.closest('.assign-choice-card');
                if (card) card.classList.toggle('selected', checkbox.checked);
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
        var targetSetIds = assignmentTargetSetIds();
        state.candidates = [];
        renderCandidates();
        if (!targetSetIds.length || targetSetIds.length > 1) {
            state.candidates = studentRecords().filter(function(student) {
                return student.active === true && student.profile_complete;
            }).map(function(student) {
                return Object.assign({}, student, { availability: 'available' });
            });
            pruneSelectedCandidates();
            renderCandidates();
            return Promise.resolve();
        }
        candidateList.innerHTML = '<div class="empty-card loading-card">Checking assignment status...</div>';
        return teacherCall('getAssignmentCandidates', { set_id: targetSetIds[0] }).then(function(result) {
            state.candidates = result.candidates || [];
            pruneSelectedCandidates();
            renderCandidates();
        }).catch(function(error) {
            candidateList.innerHTML = '<div class="empty-card"><strong>Unable to load students</strong>' +
                escapeHtml(error.message) + '</div>';
        });
    }

    function filteredStudents() {
        var query = document.getElementById('student-search').value.trim().toLowerCase();
        var classGroup = document.getElementById('student-class-filter').value;
        if (state.studentPickerMode !== 'search') query = '';
        return studentRecords().filter(function(student) {
            var matchesQuery = !query || [student.name, student.student_id, student.class_group, student.curriculum_track]
                .join(' ').toLowerCase().indexOf(query) !== -1;
            return matchesQuery && (!classGroup || student.class_group === classGroup);
        });
    }

    function updateSelectedStudentLabel() {
        var label = document.getElementById('selected-student-label');
        if (!label) return;
        var selected = state.students.find(function(item) {
            return item.profile_id === state.selectedStudentProfileId;
        });
        label.textContent = selected ? selected.name || selected.student_id || 'Selected student' : 'No student selected';
        label.classList.toggle('empty', !selected);
    }

    function setStudentPickerOpen(open, mode) {
        if (mode) state.studentPickerMode = mode;
        var card = document.querySelector('.student-select-card');
        var input = document.getElementById('student-search');
        var searchbar = document.getElementById('student-picker-searchbar');
        var chooseButton = document.getElementById('choose-student');
        var searchButton = document.getElementById('search-student');
        if (card) card.classList.toggle('picker-open', open === true);
        if (card) {
            card.classList.toggle('picker-choose', open === true && state.studentPickerMode === 'choose');
            card.classList.toggle('picker-search', open === true && state.studentPickerMode === 'search');
        }
        if (searchbar) searchbar.hidden = !(open === true && state.studentPickerMode === 'search');
        if (chooseButton) chooseButton.classList.toggle('active', open === true && state.studentPickerMode === 'choose');
        if (searchButton) searchButton.classList.toggle('active', open === true && state.studentPickerMode === 'search');
        if (input) {
            if (open === true && state.studentPickerMode === 'choose') input.value = '';
        }
        updateSelectedStudentLabel();
    }

    function selectedStudentLabel() {
        var selected = state.students.find(function(item) {
            return item.profile_id === state.selectedStudentProfileId;
        });
        return selected ? selected.name || selected.student_id || '' : '';
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

    function confirmStudentSearch() {
        var card = document.querySelector('.student-select-card');
        if (state.selectedStudentProfileId && (!card || !card.classList.contains('picker-open'))) {
            renderStudentDetail();
            return;
        }
        var firstMatch = filteredStudents().find(function(student) {
            return student.profile_complete;
        });
        if (!firstMatch) {
            showMessage('No matching student found.', 'error');
            setStudentPickerOpen(true, state.studentPickerMode);
            renderStudentList();
            return;
        }
        selectStudent(firstMatch.profile_id);
    }

    function renderStudentList() {
        var students = filteredStudents();
        var searchMode = state.studentPickerMode === 'search';
        updateSelectedStudentLabel();
        studentList.innerHTML = students.length ? students.map(function(student) {
            if (!student.profile_complete) {
                return '<div class="student-pick incomplete-profile">' +
                    '<span><strong>Profile incomplete</strong><small>Database record is missing Login ID or User ID</small></span></div>';
            }
            return '<button class="student-pick' + (searchMode ? '' : ' compact') +
                (student.profile_id === state.selectedStudentProfileId ? ' active' : '') +
                '" type="button" data-profile-id="' + escapeHtml(student.profile_id) + '">' +
                '<span><strong>' + escapeHtml(student.name || student.student_id) + '</strong>' +
                (searchMode ? '<small>' + studentMetaHtml(student) + '</small>' : '') + '</span>' +
                (searchMode ? '<i class="' + (student.active ? 'account-active' : 'account-inactive') + '"></i>' : '') +
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
        var counts = { to_do: 0, passed: 0, mastered: 0 };
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
        return assignment.completed_at || assignment.latest_submitted_at || assignment.updated_at || assignment.assigned_at || assignment.due_at || null;
    }

    function matrixDateValue(item) {
        return assignmentSortDate(item);
    }

    function startOfLocalDay(date) {
        var copy = new Date(date);
        copy.setHours(0, 0, 0, 0);
        return copy;
    }

    function endOfLocalDay(date) {
        var copy = new Date(date);
        copy.setHours(23, 59, 59, 999);
        return copy;
    }

    function parseDateInput(value, endOfDay) {
        if (!value) return null;
        var date = new Date(value + 'T00:00:00');
        if (isNaN(date.getTime())) return null;
        return endOfDay ? endOfLocalDay(date) : startOfLocalDay(date);
    }

    function matrixDateRange() {
        var mode = state.matrixDateFilter || 'month';
        var now = new Date();
        if (mode === 'week') {
            var weekStart = startOfLocalDay(now);
            weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
            var weekEnd = endOfLocalDay(weekStart);
            weekEnd.setDate(weekStart.getDate() + 6);
            return { start: weekStart, end: weekEnd };
        }
        if (mode === 'custom') {
            return {
                start: parseDateInput(state.matrixDateFrom, false),
                end: parseDateInput(state.matrixDateTo, true)
            };
        }
        var monthStart = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), 1));
        var monthEnd = endOfLocalDay(new Date(now.getFullYear(), now.getMonth() + 1, 0));
        return { start: monthStart, end: monthEnd };
    }

    function matrixItemMatchesDate(item) {
        var range = matrixDateRange();
        if (!range.start && !range.end) return true;
        var rawDate = matrixDateValue(item);
        if (!rawDate) return false;
        var date = new Date(rawDate);
        if (isNaN(date.getTime())) return false;
        if (range.start && date < range.start) return false;
        if (range.end && date > range.end) return false;
        return true;
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

    function assignmentClassGroup(item) {
        if (item.class_group) return String(item.class_group);
        var uid = item.student_uid || item.auth_uid || '';
        var student = state.students.find(function(profile) {
            return profile.auth_uid === uid || profile.student_id === item.student_id;
        });
        return student && student.class_group ? String(student.class_group) : '';
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
                '<small>' + escapeHtml(sourceLabel) + (assignment.assigned_at ? ' · Assigned: ' + escapeHtml(formatDateTime(assignment.assigned_at)) : '') +
                (assignment.due_at ? ' · Due: ' + escapeHtml(formatDateTime(assignment.due_at)) : '') + '</small></div>' +
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
            return !item.source || item.source === 'assigned';
        });
    }

    function assignmentAlert(item) {
        var status = normalizedAssignmentStatus(item.status);
        var attempts = progressAttemptsForAssignment(item);
        var attemptCount = Math.max(Number(item.attempt_count || 0), attempts.length);
        var best = item.best_percentage == null ? null : Number(item.best_percentage);
        var dueDate = item.due_at ? new Date(item.due_at) : null;
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

    function assignmentOverviewMetrics(items) {
        var counts = items.reduce(function(total, item) {
            var status = normalizedAssignmentStatus(item.status);
            total.total += 1;
            total.attempts += Math.max(Number(item.attempt_count || 0), progressAttemptsForAssignment(item).length);
            if (status === 'passed' || status === 'mastered') total.finished += 1;
            return total;
        }, { total: 0, finished: 0, attempts: 0, average: null });
        counts.average = averageBestPercent(items);
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
            var isClassMode = mode === 'class';
            var id = isTaskMode
                ? String(item.set_id || 'unknown-task')
                : isClassMode
                    ? (assignmentClassGroup(item) || 'No class')
                    : String(item.student_uid || item.auth_uid || item.student_id || 'unknown-student');
            var key = (isTaskMode ? 'task::' : isClassMode ? 'class::' : 'student::') + id;
            if (!groupMap[key]) {
                groupMap[key] = {
                    key: key,
                    mode: mode,
                    title: isTaskMode
                        ? (item.set_title || setTitleFor(item.set_id))
                        : isClassMode
                            ? (assignmentClassGroup(item) || 'No class')
                        : (item.student_name || item.student_id || 'Student'),
                    subtitle: isTaskMode
                        ? (item.set_id || '')
                        : isClassMode
                            ? 'Class group'
                        : (item.student_id || ''),
                    items: []
                };
            }
            groupMap[key].items.push(item);
        });
        return Object.keys(groupMap).map(function(key) {
            var group = groupMap[key];
            group.items = sortAssignmentOverviewItems(group.items);
            group.metrics = assignmentOverviewMetrics(group.items);
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

    function editableAssignments(items) {
        return (items || []).filter(function(item) {
            return item.source !== 'self_study' && item.assignment_id;
        });
    }

    function renderAssignmentGroupTools(group) {
        var editable = editableAssignments(group.items);
        if (!editable.length) return '';
        var scopeLabel = group.mode === 'class'
            ? 'Edit class standards'
            : group.mode === 'task'
                ? 'Edit task standards'
                : 'Edit student standards';
        return '<div class="assignment-group-tools">' +
            '<span>' + escapeHtml(editable.length) + ' assigned item' + (editable.length === 1 ? '' : 's') + '</span>' +
            '<button class="outline-button assignment-edit-button" type="button" data-edit-assignment-scope="' + escapeHtml(group.key) + '">' +
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
                return '<button class="task-score-bar" type="button" data-assign-progress="' + escapeHtml(key) + '" title="' +
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

    function openAssignmentEditDialog(scopeKey) {
        var group = state.assignmentEditScopes[scopeKey];
        if (!group) return;
        var items = editableAssignments(group.items);
        if (!items.length) {
            showMessage('No editable assigned items in this group.', 'error');
            return;
        }
        var commonDue = commonFieldValue(items, 'due_at');
        var commonPassing = commonFieldValue(items, 'passing_percentage');
        var commonMastery = commonFieldValue(items, 'mastery_percentage');
        var overlay = document.createElement('div');
        overlay.className = 'assignment-edit-overlay';
        overlay.innerHTML =
            '<section class="assignment-edit-dialog" role="dialog" aria-modal="true">' +
                '<button class="dialog-close-button" type="button" aria-label="Close">x</button>' +
                '<div class="assignment-edit-head">' +
                    '<p class="eyebrow accent">EDIT ASSIGNMENT STANDARDS</p>' +
                    '<h2>' + escapeHtml(group.title || 'Assignments') + '</h2>' +
                    '<p>' + escapeHtml(items.length) + ' assignment' + (items.length === 1 ? '' : 's') + ' will be updated.</p>' +
                '</div>' +
                '<form class="assignment-edit-form">' +
                    '<label class="assignment-edit-check"><input type="checkbox" name="change_due"' + (commonDue ? ' checked' : '') + '><span>Due date</span></label>' +
                    '<input type="date" name="due_at" value="' + escapeHtml(formatDateInputValue(commonDue)) + '">' +
                    '<label class="assignment-edit-check"><input type="checkbox" name="change_passing"' + (commonPassing !== '' ? ' checked' : '') + '><span>Passing %</span></label>' +
                    '<input type="number" name="passing_percentage" min="0" max="100" step="0.01" placeholder="' + (commonPassing === '' ? 'Mixed / unchanged' : '') + '" value="' + escapeHtml(commonPassing) + '">' +
                    '<label class="assignment-edit-check"><input type="checkbox" name="change_mastery"' + (commonMastery !== '' ? ' checked' : '') + '><span>Mastery %</span></label>' +
                    '<input type="number" name="mastery_percentage" min="0" max="100" step="0.01" placeholder="' + (commonMastery === '' ? 'Mixed / unchanged' : '') + '" value="' + escapeHtml(commonMastery) + '">' +
                    '<p class="assignment-edit-note">Completed work and protected STAR records are not downgraded. New submissions use the updated standards.</p>' +
                    '<div class="dialog-actions">' +
                        '<button class="outline-button" type="button" data-cancel-edit>Cancel</button>' +
                        '<button class="primary-button" type="submit">Save changes</button>' +
                    '</div>' +
                '</form>' +
            '</section>';
        document.body.appendChild(overlay);

        function close() {
            overlay.remove();
        }

        overlay.querySelector('.dialog-close-button').addEventListener('click', close);
        overlay.querySelector('[data-cancel-edit]').addEventListener('click', close);
        overlay.addEventListener('click', function(event) {
            if (event.target === overlay) close();
        });
        overlay.querySelector('form').addEventListener('submit', function(event) {
            event.preventDefault();
            var form = event.currentTarget;
            var payload = {
                assignment_ids: items.map(function(item) { return item.assignment_id; })
            };
            if (form.elements.change_due.checked) {
                payload.due_at = form.elements.due_at.value ? form.elements.due_at.value + 'T23:59:59+08:00' : null;
            }
            if (form.elements.change_passing.checked) {
                payload.passing_percentage = form.elements.passing_percentage.value;
            }
            if (form.elements.change_mastery.checked) {
                payload.mastery_percentage = form.elements.mastery_percentage.value;
            }
            if (!Object.prototype.hasOwnProperty.call(payload, 'due_at') &&
                !Object.prototype.hasOwnProperty.call(payload, 'passing_percentage') &&
                !Object.prototype.hasOwnProperty.call(payload, 'mastery_percentage')) {
                showMessage('Choose at least one field to update.', 'error');
                return;
            }
            var submit = form.querySelector('button[type="submit"]');
            submit.disabled = true;
            submit.textContent = 'Saving...';
            teacherCall('updateAssignments', payload).then(function(result) {
                showMessage((result.updated || []).length + ' assignment(s) updated.', 'success');
                close();
                return Promise.all([teacherCall('listAssignments'), loadProgressData(), loadCandidates()]);
            }).then(function(results) {
                state.assignments = results[0].assignments || [];
                state.progressItems = results[1].progress || [];
                renderSetOptions();
                renderStudentDetail();
                renderAssignmentOverview();
                updateAssignView();
            }).catch(function(error) {
                showMessage(error.message, 'error');
                submit.disabled = false;
                submit.textContent = 'Save changes';
            });
        });
    }

    function renderAssignmentProgressGroup(group) {
        var expanded = state.expandedAssignProgressGroups[group.key] === true;
        var metrics = group.metrics || assignmentOverviewMetrics(group.items);
        state.assignmentEditScopes[group.key] = group;
        return '<article class="assignment-progress-group' + (expanded ? ' expanded' : '') + '">' +
            '<button class="assignment-progress-group-head" type="button" data-assign-progress-group="' + escapeHtml(group.key) + '" aria-expanded="' + expanded + '">' +
                '<span class="assignment-progress-group-copy"><strong>' + escapeHtml(group.title || 'Group') + '</strong>' +
                    '<small>' + escapeHtml(group.subtitle || '') + '</small></span>' +
                '<span class="assignment-progress-group-stats">' +
                    '<span><strong>' + escapeHtml(metrics.total) + '</strong><small>Total</small></span>' +
                    '<span><strong>' + escapeHtml(metrics.finished) + '</strong><small>Done</small></span>' +
                    '<span><strong>' + escapeHtml(formatPercent(metrics.average)) + '</strong><small>Avg</small></span>' +
                '</span>' +
            '</button>' +
            (expanded ? '<div class="assignment-progress-group-body">' +
                renderAssignmentGroupTools(group) +
                (group.mode === 'task' ? renderTaskScoreBars(group) : renderGroupMiniMatrix(group)) +
                '<div class="assignment-table compact">' +
                    group.items.map(renderAssignmentOverviewRow).join('') +
                '</div>' +
            '</div>' : '') +
        '</article>';
    }

    function renderAssignmentProgressModeTabs() {
        var mode = state.assignProgressMode || 'student';
        return '<div class="assignment-overview-toolbar">' +
            '<div class="assignment-progress-mode-tabs" role="tablist" aria-label="Assignment progress view">' +
                '<button class="assignment-progress-mode-tab' + (mode === 'student' ? ' active' : '') + '" type="button" data-assign-progress-mode="student">By student</button>' +
                '<button class="assignment-progress-mode-tab' + (mode === 'class' ? ' active' : '') + '" type="button" data-assign-progress-mode="class">By class</button>' +
                '<button class="assignment-progress-mode-tab' + (mode === 'task' ? ' active' : '') + '" type="button" data-assign-progress-mode="task">By task</button>' +
            '</div>' +
        '</div>';
    }

    function matrixStudentKey(item) {
        return String(item.student_uid || item.auth_uid || item.student_id || 'unknown');
    }

    function matrixSetKey(item) {
        return String(item.set_id || 'unknown');
    }

    function matrixStudentClass(item) {
        if (item.class_group) return String(item.class_group);
        var uid = item.student_uid || item.auth_uid || '';
        var student = state.students.find(function(profile) {
            return profile.auth_uid === uid || profile.student_id === item.student_id;
        });
        return student && student.class_group ? String(student.class_group) : '';
    }

    function matrixClassOptions(items) {
        var classes = {};
        items.forEach(function(item) {
            var className = matrixStudentClass(item);
            if (className) classes[className] = true;
        });
        return Object.keys(classes).sort(function(a, b) { return a.localeCompare(b); });
    }

    function renderMatrixClassSelect(classOptions) {
        if (!classOptions.length) return '';
        return '<label class="matrix-class-filter"><span>Class</span><select id="matrix-class-filter">' +
            '<option value="">All</option>' +
            classOptions.map(function(className) {
                return '<option value="' + escapeHtml(className) + '"' + (className === state.matrixClassFilter ? ' selected' : '') + '>' + escapeHtml(className) + '</option>';
            }).join('') +
        '</select></label>';
    }

    function matrixRecentLimit() {
        var value = Number(state.matrixRecentLimit || 7);
        return isFinite(value) && value > 0 ? Math.min(Math.floor(value), 20) : 7;
    }

    function renderMatrixRecentSelect() {
        var value = matrixRecentLimit();
        var options = [];
        for (var i = 1; i <= 20; i += 1) options.push(i);
        return '<label class="matrix-recent-filter"><span>Recent</span><select id="matrix-recent-limit">' +
            options.map(function(option) {
                return '<option value="' + escapeHtml(option) + '"' + (option === value ? ' selected' : '') + '>' +
                    escapeHtml(option) + '</option>';
            }).join('') +
        '</select></label>';
    }

    function renderMatrixDateSelect() {
        var value = state.matrixDateFilter || 'month';
        var options = [
            { value: 'week', label: 'This week' },
            { value: 'month', label: 'This month' },
            { value: 'custom', label: 'Custom' }
        ];
        var html = '<label class="matrix-date-filter"><span>Date</span><select id="matrix-date-filter">' +
            options.map(function(option) {
                return '<option value="' + escapeHtml(option.value) + '"' + (option.value === value ? ' selected' : '') + '>' +
                    escapeHtml(option.label) + '</option>';
            }).join('') +
        '</select></label>';
        if (value === 'custom') {
            html += '<label class="matrix-date-bound"><span>From</span><input id="matrix-date-from" type="date" value="' + escapeHtml(state.matrixDateFrom || '') + '"></label>' +
                '<label class="matrix-date-bound"><span>To</span><input id="matrix-date-to" type="date" value="' + escapeHtml(state.matrixDateTo || '') + '"></label>';
        }
        return html;
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
            vocabulary: 'Vocabulary',
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
            .sort(function(a, b) { return a.label.localeCompare(b.label); });
    }

    function renderMatrixColumnSelect(columnOptions) {
        return '<label class="matrix-column-filter"><span>Column</span><select id="matrix-column-filter">' +
            '<option value="">All</option>' +
            columnOptions.map(function(column) {
                return '<option value="' + escapeHtml(column.key) + '"' + (column.key === state.matrixColumnFilter ? ' selected' : '') + '>' +
                    escapeHtml(column.label) + '</option>';
            }).join('') +
        '</select></label>';
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

    function formatAttemptChartDate(value) {
        if (!value) return '—';
        var date = new Date(value);
        if (isNaN(date.getTime())) return '—';
        return new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Shanghai',
            month: 'short',
            day: 'numeric'
        }).format(date);
    }

    function formatAttemptClock(value) {
        if (!value) return '—';
        var date = new Date(value);
        if (isNaN(date.getTime())) return '—';
        return date.toLocaleTimeString('en-GB', {
            timeZone: 'Asia/Shanghai',
            hour: '2-digit',
            minute: '2-digit',
            hour12: false
        });
    }

    function attemptDurationLabel(attempt) {
        return formatDuration(attempt && attempt.duration_seconds);
    }

    function attemptDisplayNumber(attempt, index) {
        return attempt && attempt.attempt_number ? attempt.attempt_number : index + 1;
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

    function renderMatrixScoreLock(item) {
        var locked = item && (item.answer_revealed === true || item.mastery_locked === true);
        var icon = locked ? '&#128274;' : '&#128275;';
        var label = locked ? 'Answers viewed; score locked' : 'Answers not viewed; score not locked';
        return '<span class="matrix-score-lock ' + (locked ? 'locked' : 'unlocked') +
            '" title="' + escapeHtml(label) + '" aria-label="' + escapeHtml(label) + '">' +
            '<span aria-hidden="true">' + icon + '</span><strong>' + escapeHtml(formatPercent(item && item.best_percentage)) + '</strong></span>';
    }

    function renderMatrixAttemptChart(entries) {
        if (!entries.length) return '<div class="matrix-attempt-empty">No attempt records yet.</div>';
        return '<div class="matrix-attempt-bars" aria-label="Attempt score history">' +
            entries.map(function(entry) {
                var attempt = entry.attempt;
                var percent = Math.max(0, Math.min(100, Number(attempt.percentage || 0)));
                var scoreClass = percent >= 80 ? ' high' : (percent >= 50 ? ' mid' : ' low');
                var duration = attemptDurationLabel(attempt);
                return '<button class="matrix-attempt-bar" type="button" data-matrix-attempt-target="' + escapeHtml(entry.index) + '">' +
                    '<span class="matrix-attempt-track"><span class="matrix-attempt-fill' + scoreClass +
                    '" style="height:' + escapeHtml(Math.max(percent, 6)) + '%">' + escapeHtml(formatPercent(percent)) + '</span></span>' +
                    '<span class="matrix-attempt-caption"><small>' + escapeHtml(formatAttemptChartDate(attempt.submitted_at)) + '</small>' +
                    '<small class="bar-time">' + escapeHtml(formatAttemptClock(attempt.submitted_at)) + '</small>' +
                    (duration ? '<small class="bar-spent">' + escapeHtml(duration) + '</small>' : '') +
                    '</span></button>';
            }).join('') +
        '</div>';
    }

    function renderMatrixAttemptWrongRows(attempt) {
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
                return '<div class="q-cell">Q' + escapeHtml(result.question_id || '?') + '</div>' +
                    '<div class="student-answer">' + escapeHtml(formatAnswerText(answer, 'blank')) + '</div>' +
                    '<div class="correct-answer">' + escapeHtml(formatAnswerText(result.correct_answer, 'not available')) + '</div>';
            }).join('') +
        '</div>';
    }

    function renderMatrixAttemptDetails(entries) {
        if (!entries.length) return '';
        return '<div class="matrix-attempt-list">' +
            entries.slice().reverse().map(function(entry) {
                var attempt = entry.attempt;
                var duration = attemptDurationLabel(attempt);
                var percent = numericPercent(attempt.percentage);
                return '<article class="matrix-attempt-card" data-matrix-attempt-index="' + escapeHtml(entry.index) + '">' +
                    '<div class="matrix-attempt-head"><div><h3>Attempt #' + escapeHtml(entry.number) + '</h3>' +
                    '<div class="matrix-attempt-meta">' +
                    '<span>' + escapeHtml(formatDateTime(attempt.submitted_at)) + '</span>' +
                    (duration ? '<span class="time">' + escapeHtml(duration) + '</span>' : '') +
                    '</div></div>' +
                    '<span class="matrix-score-pill ' + (percent != null && percent < 50 ? 'fail' : '') + '">' +
                    escapeHtml(formatPercent(attempt.percentage)) + '</span></div>' +
                    renderMatrixAttemptWrongRows(attempt) +
                '</article>';
            }).join('') +
        '</div>';
    }

    function renderMatrixCellDetail(item) {
        if (!item) return '';
        var attempts = matrixAttemptsForItem(item);
        var entries = matrixAttemptEntries(attempts);
        var title = item.set_title || setTitleFor(item.set_id) || item.set_id || 'Set';
        return '<div class="progress-matrix-detail">' +
            '<div class="matrix-detail-summary">' +
                '<h2>' + escapeHtml(title) + '</h2>' +
                '<div class="matrix-detail-pills">' +
                    '<span class="matrix-detail-pill">' + escapeHtml(item.student_name || item.student_id || 'Student') + '</span>' +
                    renderMatrixScoreLock(item) +
                '</div>' +
            '</div>' +
            renderMatrixAttemptChart(entries) +
            renderMatrixAttemptDetails(entries) +
        '</div>';
    }

    function renderMatrixCellModal(item) {
        if (!item) return '';
        return '<div class="progress-matrix-modal-backdrop" data-matrix-close="backdrop">' +
            '<div class="progress-matrix-modal-shell">' +
                '<section class="progress-matrix-modal" role="dialog" aria-modal="true" aria-label="Assignment details">' +
                    renderMatrixCellDetail(item) +
                '</section>' +
                '<button class="progress-matrix-modal-close" type="button" data-matrix-close="button" aria-label="Close">Close</button>' +
            '</div>' +
        '</div>';
    }

    function renderAssignmentMatrix(items) {
        if (!items.length) return '';
        var classOptions = matrixClassOptions(items);
        if (state.matrixClassFilter && classOptions.indexOf(state.matrixClassFilter) === -1) {
            state.matrixClassFilter = '';
        }
        var columnOptions = matrixColumnOptions(items);
        if (state.matrixColumnFilter && !columnOptions.some(function(column) { return column.key === state.matrixColumnFilter; })) {
            state.matrixColumnFilter = '';
        }
        var classSelect = renderMatrixClassSelect(classOptions);
        var recentSelect = renderMatrixRecentSelect();
        var dateSelect = renderMatrixDateSelect();
        var columnSelect = renderMatrixColumnSelect(columnOptions);
        var matrixItems = state.matrixClassFilter
            ? items.filter(function(item) { return matrixStudentClass(item) === state.matrixClassFilter; })
            : items;
        if (state.matrixColumnFilter) {
            matrixItems = matrixItems.filter(function(item) {
                return matrixColumnKey(item) === state.matrixColumnFilter;
            });
        }
        matrixItems = matrixItems.filter(matrixItemMatchesDate);
        if (!matrixItems.length) {
            return '<section class="progress-matrix-card">' +
                '<div class="progress-matrix-title"><div class="progress-matrix-tools">' + classSelect + columnSelect + recentSelect + dateSelect + '<span>No matching records</span></div></div>' +
                '<div class="empty-card"><strong>No matching records</strong>Adjust the filters to see assignment progress.</div>' +
            '</section>';
        }
        var setMap = {};
        var studentMap = {};
        matrixItems.forEach(function(item) {
            var setKey = matrixSetKey(item);
            if (!setMap[setKey]) {
                setMap[setKey] = {
                    id: setKey,
                    title: item.set_title || setTitleFor(item.set_id),
                    date: new Date(matrixDateValue(item) || 0).getTime()
                };
            } else {
                setMap[setKey].date = Math.max(setMap[setKey].date, new Date(matrixDateValue(item) || 0).getTime());
            }
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
        var sets = Object.keys(setMap).map(function(key) { return setMap[key]; })
            .sort(function(a, b) { return b.date - a.date || a.title.localeCompare(b.title); })
            .slice(0, matrixRecentLimit());
        var students = Object.keys(studentMap).map(function(key) { return studentMap[key]; })
            .sort(function(a, b) { return a.name.localeCompare(b.name); })
            .slice(0, 12);
        if (!sets.length || !students.length) return '';
        var selectedItem = null;
        var matrixStyle = '--matrix-cols:' + sets.length + ';--matrix-min:' + (150 + sets.length * 112) + 'px;--matrix-min-mobile:' + (126 + sets.length * 96) + 'px;';
        var header = '<div class="progress-matrix-row progress-matrix-head" style="' + escapeHtml(matrixStyle) + '">' +
            '<span>Student</span>' +
            sets.map(function(set) {
                var title = set.title || set.id || 'Task';
                return '<span class="progress-matrix-task-head" title="' + escapeHtml(title) + '">' +
                    '<strong>' + escapeHtml(set.id) + '</strong>' +
                    '<small class="progress-matrix-task-name">' + escapeHtml(title) + '</small>' +
                '</span>';
            }).join('') +
        '</div>';
        var rows = students.map(function(student) {
            return '<div class="progress-matrix-row" style="' + escapeHtml(matrixStyle) + '">' +
                '<span><strong>' + escapeHtml(student.name) + '</strong></span>' +
                sets.map(function(set) {
                    var item = student.items[set.id];
                    if (!item) return '<span class="progress-matrix-cell empty">-</span>';
                    var status = normalizedAssignmentStatus(item.status);
                    var score = numericPercent(item.best_percentage);
                    var label = status === 'mastered' ? '★ ' + formatPercent(item.best_percentage) :
                        status === 'passed' ? formatPercent(item.best_percentage) :
                            score == null ? '—' : formatPercent(score);
                    var cellKey = matrixCellKey(item);
                    if (cellKey === state.selectedMatrixCell) selectedItem = item;
                    return '<button class="progress-matrix-cell ' + escapeHtml(status) +
                        (cellKey === state.selectedMatrixCell ? ' selected' : '') +
                        '" type="button" data-matrix-cell="' + escapeHtml(cellKey) + '" title="' +
                        escapeHtml(formatPercent(item.best_percentage) + ' best · click for answers') + '">' +
                        escapeHtml(label) + '</button>';
                }).join('') +
            '</div>';
        }).join('');
        var detailHtml = selectedItem ? renderMatrixCellModal(selectedItem) : '';
        return '<section class="progress-matrix-card">' +
            '<div class="progress-matrix-title"><div class="progress-matrix-tools">' + classSelect + columnSelect + recentSelect + dateSelect + '<span>Showing ' + escapeHtml(sets.length) + ' tasks</span></div></div>' +
            '<div class="progress-matrix-scroll">' + header + rows + '</div>' +
            detailHtml +
        '</section>';
    }

    function renderAssignmentOverview() {
        var container = document.getElementById('assignment-overview');
        if (!container) return;
        var items = sortAssignmentOverviewItems(assignedProgressItems());
        state.assignmentEditScopes = {};
        if (!items.length) {
            container.innerHTML = '<div class="empty-card"><strong>No assigned work yet</strong>Assignments will appear here after you create them.</div>';
            return;
        }
        var groups = assignmentProgressGroups(items, state.assignProgressMode || 'student');
        container.innerHTML = renderAssignmentMatrix(items) + renderAssignmentProgressModeTabs() +
            '<div class="assignment-progress-groups">' +
                groups.map(renderAssignmentProgressGroup).join('') +
            '</div>';
        container.querySelectorAll('[data-assign-progress-mode]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.assignProgressMode = button.dataset.assignProgressMode;
                renderAssignmentOverview();
            });
        });
        var matrixClassFilter = document.getElementById('matrix-class-filter');
        if (matrixClassFilter) {
            matrixClassFilter.addEventListener('change', function() {
                state.matrixClassFilter = matrixClassFilter.value;
                state.selectedMatrixCell = '';
                renderAssignmentOverview();
            });
        }
        var matrixRecentLimitSelect = document.getElementById('matrix-recent-limit');
        if (matrixRecentLimitSelect) {
            matrixRecentLimitSelect.addEventListener('change', function() {
                state.matrixRecentLimit = matrixRecentLimitSelect.value;
                state.selectedMatrixCell = '';
                renderAssignmentOverview();
            });
        }
        var matrixDateFilter = document.getElementById('matrix-date-filter');
        if (matrixDateFilter) {
            matrixDateFilter.addEventListener('change', function() {
                state.matrixDateFilter = matrixDateFilter.value;
                state.selectedMatrixCell = '';
                renderAssignmentOverview();
            });
        }
        var matrixDateFrom = document.getElementById('matrix-date-from');
        if (matrixDateFrom) {
            matrixDateFrom.addEventListener('change', function() {
                state.matrixDateFrom = matrixDateFrom.value;
                state.selectedMatrixCell = '';
                renderAssignmentOverview();
            });
        }
        var matrixDateTo = document.getElementById('matrix-date-to');
        if (matrixDateTo) {
            matrixDateTo.addEventListener('change', function() {
                state.matrixDateTo = matrixDateTo.value;
                state.selectedMatrixCell = '';
                renderAssignmentOverview();
            });
        }
        var matrixColumnFilter = document.getElementById('matrix-column-filter');
        if (matrixColumnFilter) {
            matrixColumnFilter.addEventListener('change', function() {
                state.matrixColumnFilter = matrixColumnFilter.value;
                state.selectedMatrixCell = '';
                renderAssignmentOverview();
            });
        }
        container.querySelectorAll('[data-matrix-cell]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.matrixCell;
                state.selectedMatrixCell = state.selectedMatrixCell === key ? '' : key;
                renderAssignmentOverview();
            });
        });
        container.querySelectorAll('[data-matrix-close]').forEach(function(button) {
            button.addEventListener('click', function(event) {
                if (button.dataset.matrixClose === 'backdrop' && event.target !== button) return;
                state.selectedMatrixCell = '';
                renderAssignmentOverview();
            });
        });
        container.querySelectorAll('[data-matrix-attempt-target]').forEach(function(button) {
            button.addEventListener('click', function() {
                var modal = button.closest('.progress-matrix-modal-shell');
                var target = modal && modal.querySelector('[data-matrix-attempt-index="' + button.dataset.matrixAttemptTarget + '"]');
                if (target) {
                    modal.querySelectorAll('.matrix-attempt-card.highlight').forEach(function(card) {
                        card.classList.remove('highlight');
                    });
                    target.classList.add('highlight');
                    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            });
        });
        container.querySelectorAll('[data-assign-progress-group]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.assignProgressGroup;
                state.expandedAssignProgressGroups[key] = state.expandedAssignProgressGroups[key] !== true;
                renderAssignmentOverview();
            });
        });
        container.querySelectorAll('[data-edit-assignment-scope]').forEach(function(button) {
            button.addEventListener('click', function(event) {
                event.preventDefault();
                event.stopPropagation();
                openAssignmentEditDialog(button.dataset.editAssignmentScope);
            });
        });
        container.querySelectorAll('[data-assign-progress]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.assignProgress;
                state.expandedAssignProgress[key] = state.expandedAssignProgress[key] !== true;
                renderAssignmentOverview();
            });
        });
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
        var progressHtml = renderAssignmentProgress(assignments);
        var classEditing = state.studentInfoEdit === 'class';
        var systemEditing = state.studentInfoEdit === 'system';
        var systemOptions = ['', 'DSE', 'IELTS', 'A-Level', 'AP', 'IB', 'Zhongkao', 'Gaokao'];

        studentDetail.innerHTML =
            '<section class="profile-card student-profile-card">' +
                '<div class="student-info-head">' +
                    '<p class="eyebrow accent">INFO</p>' +
                    '<h2 class="student-info-name">' + escapeHtml(student.name || student.student_id || 'Student') + '</h2>' +
                    '<span></span>' +
                '</div>' +
                '<div class="student-info-grid">' +
                    '<div class="student-info-item"><span>Login ID</span><strong>' + escapeHtml(student.student_id || 'Not set') + '</strong></div>' +
                    '<div class="student-info-item">' +
                        '<button class="student-info-edit" type="button" data-info-action="' + (student.class_group ? 'Edit' : 'Assign') + '" data-edit-student-field="class"><span>Class</span><strong>' + escapeHtml(student.class_group || 'Not assigned') + '</strong></button>' +
                        (classEditing ? '<form class="student-info-editor" data-student-info-editor="class">' +
                            '<input type="text" name="class_group" value="' + escapeHtml(student.class_group || '') + '" placeholder="Class">' +
                            '<button class="primary-button" type="submit">Save</button><button class="outline-button" type="button" data-cancel-student-info>Cancel</button>' +
                        '</form>' : '') +
                    '</div>' +
                    '<div class="student-info-item">' +
                        '<button class="student-info-edit system-info-edit" type="button" data-info-action="' + (student.curriculum_track ? 'Edit' : 'Assign') + '" data-edit-student-field="system"><span>System</span><strong>' + escapeHtml(student.curriculum_track || 'Not set') + '</strong></button>' +
                        (systemEditing ? '<form class="student-info-editor" data-student-info-editor="system">' +
                            '<select name="curriculum_track">' + systemOptions.map(function(option) {
                                return '<option value="' + escapeHtml(option) + '"' + (option === (student.curriculum_track || '') ? ' selected' : '') + '>' +
                                    escapeHtml(option || 'Not set') + '</option>';
                            }).join('') + '</select>' +
                            '<button class="primary-button" type="submit">Save</button><button class="outline-button" type="button" data-cancel-student-info>Cancel</button>' +
                        '</form>' : '') +
                    '</div>' +
                    '<div class="student-info-item"><span>Status</span><strong>' + escapeHtml(student.active ? 'Active' : 'Inactive') + '</strong></div>' +
                '</div>' +
                '<div class="student-account-actions">' +
                    '<button class="outline-button" id="reset-password" type="button">Reset password</button>' +
                    '<button class="' + (student.active ? 'danger-button' : 'outline-button') + '" id="toggle-account" type="button">' +
                        (student.active ? 'Disable Account' : 'Enable Account') + '</button>' +
                '</div>' +
            '</section>' +
            '<section class="profile-card student-progress-card">' +
                '<p class="eyebrow accent">PROGRESS</p>' +
                progressModeTabs(assignments) + progressHtml +
            '</section>';

        document.getElementById('toggle-account').addEventListener('click', function() {
            updateStudent(student.auth_uid, { active: !student.active });
        });
        document.getElementById('reset-password').addEventListener('click', function() {
            if (!confirm('Reset the password for ' + student.student_id + '?')) return;
            teacherCall('resetStudentPassword', { auth_uid: student.auth_uid }).then(function(result) {
                showMessage('Password reset. Initial password: ' + result.initial_password, 'success');
                return refreshStudents();
            }).catch(function(error) {
                showMessage(error.message, 'error');
            });
        });
        studentDetail.querySelectorAll('[data-progress-view]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.studentProgressView = button.dataset.progressView;
                renderStudentDetail();
            });
        });
        studentDetail.querySelectorAll('[data-edit-student-field]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.studentInfoEdit = state.studentInfoEdit === button.dataset.editStudentField ? '' : button.dataset.editStudentField;
                renderStudentDetail();
            });
        });
        studentDetail.querySelectorAll('[data-cancel-student-info]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.studentInfoEdit = '';
                renderStudentDetail();
            });
        });
        studentDetail.querySelectorAll('[data-student-info-editor]').forEach(function(form) {
            form.addEventListener('submit', function(event) {
                event.preventDefault();
                var field = form.dataset.studentInfoEditor;
                state.studentInfoEdit = '';
                if (field === 'class') {
                    updateStudent(student.auth_uid, { class_group: form.elements.class_group.value.trim() });
                    return;
                }
                updateStudent(student.auth_uid, { curriculum_track: form.elements.curriculum_track.value });
            });
        });
        studentDetail.querySelectorAll('[data-assignment-set]').forEach(function(button) {
            button.addEventListener('click', function() {
                var setId = button.dataset.assignmentSet;
                state.expandedAssignmentSets[setId] = state.expandedAssignmentSets[setId] !== true;
                renderStudentDetail();
            });
        });
    }

    function studentForUid(uid) {
        return state.students.find(function(student) { return student.auth_uid === uid; }) || {};
    }

    function attemptStatusLabel(attempt) {
        if (attempt.mastered) return 'mastered';
        if (attempt.passed) return 'finished';
        return 'tried';
    }

    function activityDateValue(item) {
        return item.date || item.submitted_at || item.created_at || item.updated_at || item.resolved_at || null;
    }

    function attemptActivityItem(attempt) {
        var student = studentForUid(attempt.student_uid);
        var name = student.name || attempt.student_id || 'Student';
        var action = attemptStatusLabel(attempt);
        return {
            type: 'attempt',
            date: attempt.submitted_at || null,
            unread: isAttemptUnread(attempt),
            attempt: attempt,
            label: name + ' ' + action + ' ' + (setTitleFor(attempt.set_id) || attempt.set_id),
            meta: formatPercent(attempt.percentage) + ' · #' + (attempt.attempt_number || 1),
            time: formatDateTime(attempt.submitted_at),
            student_uid: attempt.student_uid || '',
            assignment_id: attempt.assignment_id || '',
            set_id: attempt.set_id || '',
            finished: attempt.passed || attempt.mastered
        };
    }

    function disputeActivityItem(item) {
        var pending = item.status !== 'approved' && item.status !== 'rejected';
        var requester = item.requester_role === 'teacher'
            ? 'Teacher preview'
            : englishName(item.student_name || item.student_id || 'Student');
        var displayDate = pending
            ? (item.created_at || item.updated_at || item.resolved_at)
            : (item.resolved_at || item.updated_at || item.created_at);
        return {
            type: 'review',
            date: displayDate || null,
            unread: pending,
            dispute: item,
            label: requester + ' requested review',
            meta: 'Q' + (item.question_id || '') + ' · ' + (item.set_id || ''),
            time: formatDateTime(displayDate),
            dispute_id: item.dispute_id,
            dispute_filter: pending ? 'pending' : item.status
        };
    }

    function activityItems() {
        return sortedAttempts().map(attemptActivityItem)
            .concat((state.disputes || []).map(disputeActivityItem))
            .filter(function(item) {
                if (state.updatesFilter === 'attempts') return item.type === 'attempt';
                if (state.updatesFilter === 'review') return item.type === 'review';
                if (state.updatesFilter === 'unread') return item.unread;
                return true;
            })
            .sort(function(a, b) {
                return new Date(activityDateValue(b) || 0) - new Date(activityDateValue(a) || 0);
            })
            .slice(0, state.updatesFilter === 'all' ? 24 : 16);
    }

    function activityFilterTabs() {
        var attemptCounts = activityAttemptCounts();
        var reviewCounts = reviewActivityCounts();
        var unread = attemptCounts.unread + reviewCounts.pending;
        var tabs = [
            { id: 'unread', label: 'Unread', count: unread },
            { id: 'all', label: 'All', count: attemptCounts.total + state.disputes.length },
            { id: 'attempts', label: 'Attempts', count: attemptCounts.total },
            { id: 'review', label: 'Review', count: state.disputes.length }
        ];
        return '<div class="updates-feed-tools">' +
            '<div class="sub-tabs activity-sub-tabs" role="tablist" aria-label="Activity filter">' +
                tabs.map(function(tab) {
                    return '<button class="sub-tab' + (state.updatesFilter === tab.id ? ' active' : '') +
                        '" type="button" data-updates-filter="' + escapeHtml(tab.id) + '">' +
                        escapeHtml(tab.label) + (tab.count ? ' ' + escapeHtml(tab.count) : '') +
                    '</button>';
                }).join('') +
            '</div>' +
            (attemptCounts.unread && state.updatesFilter !== 'review'
                ? '<button class="activity-mark-read" type="button" id="mark-attempts-read">Mark attempts read</button>'
                : '') +
        '</div>';
    }

    function renderActivityFeedRow(item) {
        if (item.type === 'attempt') {
            var attempt = item.attempt;
            return '<button class="activity-row compact-activity-row' + (item.unread ? ' unread' : '') +
                '" type="button" data-open-attempt-student="' + escapeHtml(item.student_uid) +
                '" data-open-attempt-assignment="' + escapeHtml(item.assignment_id) +
                '" data-open-attempt-set="' + escapeHtml(item.set_id) +
                '" data-open-attempt-finished="' + escapeHtml(item.finished ? '1' : '') + '">' +
                '<span class="activity-unread-dot"></span>' +
                '<span class="activity-line"><strong>' + escapeHtml(item.label) + '</strong><small>' +
                    escapeHtml(item.meta) + '</small></span>' +
                '<span class="activity-date">' + escapeHtml(item.time) + '</span>' +
            '</button>';
        }
        return '<button class="activity-row compact-activity-row review-activity-row' + (item.unread ? ' unread' : '') +
            '" type="button" data-open-dispute="' + escapeHtml(item.dispute_id) +
            '" data-open-dispute-filter="' + escapeHtml(item.dispute_filter) + '">' +
            '<span class="activity-unread-dot"></span>' +
            '<span class="activity-line"><strong>' + escapeHtml(item.label) + '</strong><small>' +
                escapeHtml(item.meta) + '</small></span>' +
            '<span class="activity-date">' + escapeHtml(item.time) + '</span>' +
        '</button>';
    }

    function renderActivityFeed() {
        var items = activityItems();
        var emptyCopy = state.updatesFilter === 'unread'
            ? 'No unread student activity right now.'
            : 'Recent student activity will appear here.';
        return activityFilterTabs() +
            '<div class="activity-list compact-activity-list">' +
                (items.length ? items.map(renderActivityFeedRow).join('') :
                    '<div class="empty-card compact-empty"><strong>No updates</strong>' + escapeHtml(emptyCopy) + '</div>') +
            '</div>';
    }

    function renderUpdatesPanel() {
        updateActivityBadges();
        if (!updatesPanel || !updatesBody) return;
        updatesPanel.hidden = !state.updatesOpen;
        var button = document.getElementById('teacher-updates-button');
        if (button) button.setAttribute('aria-expanded', state.updatesOpen ? 'true' : 'false');
        if (!state.updatesOpen) return;
        updatesBody.innerHTML = renderActivityFeed();
        updatesBody.querySelectorAll('[data-updates-filter]').forEach(function(tab) {
            tab.addEventListener('click', function() {
                state.updatesFilter = tab.dataset.updatesFilter;
                renderUpdatesPanel();
            });
        });
        var markRead = document.getElementById('mark-attempts-read');
        if (markRead) {
            markRead.addEventListener('click', function() {
                markRead.disabled = true;
                teacherCall('markAttemptsRead').then(function(result) {
                    state.attemptsSeenAt = result.attempts_seen_at || new Date().toISOString();
                    if (!reviewActivityCounts().pending) state.updatesFilter = 'all';
                    showMessage('Attempts marked as read.', 'success');
                    renderUpdatesPanel();
                }).catch(function(error) {
                    showMessage(error.message, 'error');
                    renderUpdatesPanel();
                });
            });
        }
        updatesBody.querySelectorAll('[data-open-attempt-student]').forEach(function(row) {
            row.addEventListener('click', function() {
                var student = state.students.find(function(item) { return item.auth_uid === row.dataset.openAttemptStudent; });
                if (student) {
                    state.selectedStudentProfileId = student.profile_id;
                    state.studentProgressView = row.dataset.openAttemptFinished ? 'finished' : 'to_do';
                    state.expandedAssignmentSets = {};
                    var expandKey = row.dataset.openAttemptAssignment || row.dataset.openAttemptSet;
                    if (expandKey) state.expandedAssignmentSets[expandKey] = true;
                    state.updatesOpen = false;
                    activateView('view');
                    setStudentPickerOpen(false);
                    renderStudentList();
                    renderStudentDetail();
                    renderAssignmentOverview();
                    renderUpdatesPanel();
                }
            });
        });
        updatesBody.querySelectorAll('[data-open-dispute]').forEach(function(row) {
            row.addEventListener('click', function() {
                state.disputeFilter = row.dataset.openDisputeFilter || 'pending';
                state.expandedDisputes[row.dataset.openDispute] = true;
                state.disputeMerge = false;
                state.updatesOpen = false;
                state.taskView = 'review';
                activateView('tasks');
                updateAssignView();
                renderDisputes();
                renderUpdatesPanel();
            });
        });
    }

    function answerText(value) {
        if (Array.isArray(value)) return value.join(' / ');
        if (value && typeof value === 'object') return JSON.stringify(value);
        return value == null ? '—' : String(value);
    }

    function normalizedAssignmentStatus(status) {
        if (status === 'done') return 'mastered';
        if (status === 'failed' || status === 'not_done') return 'to_do';
        return status || 'to_do';
    }

    function assignmentStatusLabel(status) {
        status = normalizedAssignmentStatus(status);
        if (status === 'mastered') return 'Mastered';
        if (status === 'passed') return 'Passed';
        return 'To Do';
    }

    function disputeCounts() {
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
                return '<button class="summary-card assignment-filter revise-filter' + (state.disputeFilter === filter.id ? ' active' : '') +
                    '" type="button" data-dispute-filter="' + escapeHtml(filter.id) + '">' +
                    '<span class="summary-label">' + escapeHtml(filter.label).toUpperCase() + '</span>' +
                    (filter.id === 'pending' && counts.pending ? '<span class="notice-dot danger">' + counts.pending + '</span>' : '') +
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
        list.innerHTML = tabs + mergeToggle + body;

        list.querySelectorAll('[data-dispute-filter]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.disputeFilter = button.dataset.disputeFilter;
                if (state.disputeFilter === 'pending') state.disputeMerge = false;
                renderDisputes();
            });
        });

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
                        teacherCall('listDisputes'),
                        teacherCall('listAssignments'),
                        teacherCall('listAttempts'),
                        loadProgressData()
                    ]);
                }).then(function(results) {
                    state.disputes = results[0].disputes || [];
                    state.assignments = results[1].assignments || [];
                    state.attempts = results[2].attempts || [];
                    state.progressItems = results[3].progress || [];
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
        return teacherCall('listStudents').then(function(result) {
            state.students = result.students || [];
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
                return refreshStudents();
            }).catch(function(error) {
                showMessage(error.message, 'error');
            });
    }

    function activateView(viewName) {
        document.querySelectorAll('.tab-button').forEach(function(button) {
            button.classList.toggle('active', button.dataset.view === viewName);
        });
        document.querySelectorAll('.dashboard-view').forEach(function(view) {
            view.hidden = view.id !== 'view-' + viewName;
        });
        setTeacherAccountPanel(false);
        if (viewName === 'tasks') updateAssignView();
        if (viewName === 'view') renderAssignmentOverview();
    }

    function loadPublicCatalog() {
        return fetch('data/home-catalog.json?_=' + Date.now())
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
                        visible: item.visible !== false,
                        passing_percentage: 50,
                        mastery_percentage: 90,
                    };
                });
            });
    }

    function loadData() {
        return Promise.all([
            teacherCall('listStudents'),
            teacherCall('listSets').catch(function() { return { sets: [] }; }),
            teacherCall('listAssignments'),
            teacherCall('listDisputes'),
            teacherCall('listAttempts'),
            loadProgressData(),
            loadActivityState()
        ]).then(function(results) {
            state.students = results[0].students || [];
            state.sets = results[1].sets || [];
            state.assignments = results[2].assignments || [];
            state.disputes = results[3].disputes || [];
            state.attempts = results[4].attempts || [];
            state.progressItems = results[5].progress || [];
            state.attemptsSeenAt = results[6].attempts_seen_at || null;
            if (!state.sets.length) {
                return loadPublicCatalog().then(function(items) {
                    state.sets = items;
                    afterDataLoaded();
                });
            }
            return teacherLibraryLoadSections().then(afterDataLoaded);
        });
    }

    function afterDataLoaded() {
        fillClassFilters();
        fillSetSectionFilters();
        renderSetOptions();
        renderLibrary();
        renderStudentList();
        renderStudentDetail();
        renderAssignmentOverview();
        updateAssignView();
        renderUpdatesPanel();
        loadQuestionTextForDisputes().then(function() {
            renderDisputes();
            renderUpdatesPanel();
        });
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
    document.getElementById('teacher-updates-button').addEventListener('click', function() {
        state.updatesOpen = state.updatesOpen !== true;
        if (state.updatesOpen && state.updatesFilter === 'unread') {
            var counts = activityAttemptCounts();
            var reviewCounts = reviewActivityCounts();
            if (counts.unread + reviewCounts.pending <= 0) state.updatesFilter = 'all';
        }
        renderUpdatesPanel();
    });
    document.getElementById('teacher-updates-close').addEventListener('click', function() {
        state.updatesOpen = false;
        renderUpdatesPanel();
    });
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
    var assignStudentsDone = document.getElementById('assign-students-done');
    if (assignStudentsDone) {
        assignStudentsDone.addEventListener('click', function() {
            rememberSelectedCandidates();
            updateSelectedCount();
            setAssignPanel('students', false);
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
    ['assign-due', 'assign-passing', 'assign-mastery'].forEach(function(id) {
        var input = document.getElementById(id);
        if (input) input.addEventListener('input', updateAssignOptionsSummary);
    });
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
    var selectClassButton = document.getElementById('select-class');
    if (selectClassButton) {
        selectClassButton.addEventListener('click', function() {
            candidateList.querySelectorAll('.candidate-checkbox:not(:disabled)').forEach(function(checkbox) {
                state.selectedAssignStudentUids[checkbox.value] = true;
                checkbox.checked = true;
            });
            updateSelectedCount();
        });
    }
    document.getElementById('assign-selected').addEventListener('click', function() {
        var button = this;
        var studentUids = selectedCandidateUids();
        var due = document.getElementById('assign-due').value;
        button.disabled = true;
        showMessage('Assigning practice...', '');
        teacherCall('createAssignments', {
            set_ids: assignmentTargetSetIds(),
            student_uids: studentUids,
            due_at: due ? due + 'T23:59:59+08:00' : null,
            passing_percentage: document.getElementById('assign-passing').value,
            mastery_percentage: document.getElementById('assign-mastery').value
        }).then(function(result) {
            showMessage(
                result.created.length + ' assignment(s) created' +
                (result.skipped.length ? '; ' + result.skipped.length + ' skipped.' : '.'),
                'success'
            );
            state.selectedAssignSetIds = {};
            state.selectedAssignStudentUids = {};
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
        }).catch(function(error) {
            showMessage(error.message, 'error');
        }).finally(updateSelectedCount);
    });

    document.getElementById('choose-student').addEventListener('click', function() {
        openStudentSelector('choose');
    });
    document.getElementById('search-student').addEventListener('click', function() {
        openStudentSelector('search');
    });
    document.getElementById('student-search').addEventListener('input', function() {
        setStudentPickerOpen(true, 'search');
        renderStudentList();
    });
    document.getElementById('student-search').addEventListener('keydown', function(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            confirmStudentSearch();
        }
    });
    document.getElementById('confirm-student-search').addEventListener('click', confirmStudentSearch);
    document.getElementById('student-class-filter').addEventListener('change', renderStudentList);
    document.addEventListener('click', function(event) {
        if (state.accountPanelOpen && teacherAccountPanel && !teacherAccountPanel.contains(event.target) && !event.target.closest('#teacher-chip')) {
            setTeacherAccountPanel(false);
        }
        var openCard = event.target.closest('[data-open-href]');
        if (openCard) {
            openHrefCard(openCard, event);
            return;
        }
        var card = document.querySelector('.student-select-card');
        if (card && !card.contains(event.target)) setStudentPickerOpen(false);

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
        if (event.key !== 'Enter' && event.key !== ' ') return;
        var openCard = event.target.closest('[data-open-href]');
        if (!openCard) return;
        if (event.target.closest('button, a')) return;
        event.preventDefault();
        openHrefCard(openCard, event);
    });
    document.getElementById('toggle-create-student').addEventListener('click', function() {
        setStudentPickerOpen(false);
        setTeacherAccountPanel(false);
        activateView('view');
        document.getElementById('create-student-panel').hidden = false;
    });
    document.getElementById('close-create-student').addEventListener('click', function() {
        document.getElementById('create-student-panel').hidden = true;
    });
    studentForm.addEventListener('submit', function(event) {
        event.preventDefault();
        var button = studentForm.querySelector('button[type="submit"]');
        button.disabled = true;
        showMessage('Creating student account...', '');
        teacherCall('createStudent', {
            student_id: document.getElementById('student-id').value,
            name: document.getElementById('student-name').value,
            class_group: document.getElementById('student-class').value
            ,
            curriculum_track: document.getElementById('student-curriculum').value
        }).then(function(result) {
            studentForm.reset();
            state.selectedStudentProfileId = result.student.profile_id;
            showMessage(
                'Student created and activated. Login ID: ' + result.student.student_id +
                ' · Initial password: ' + result.initial_password,
                'success'
            );
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
        var preferredName = englishName(session.profile);
        document.getElementById('teacher-chip').textContent = session.profile.student_id;
        document.getElementById('teacher-greeting').textContent = greetingFor(preferredName);
        document.getElementById('teacher-hero-copy').textContent = randomItem(motivationalQuotes);
        return loadData();
    }).catch(function(error) {
        showMessage(error.message || 'Unable to load the teacher desk.', 'error');
    });
})();
