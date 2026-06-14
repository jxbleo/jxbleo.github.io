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
        assignView: 'new',
        studentProgressView: 'to_do',
        studentInfoEdit: '',
        disputeFilter: 'pending',
        disputeMerge: false,
        libraryFilter: 'vocabulary',
        expandedDisputes: {},
        expandedAssignmentSets: {},
        expandedAssignProgress: {},
        expandedDisputeMerges: {}
    };
    var LIBRARY_FILTERS = [
        { id: 'vocabulary', label: 'Vocabulary' },
        { id: 'grammar', label: 'Grammar' },
        { id: 'listening', label: 'Listening' }
    ];
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

    function showMessage(text, type) {
        message.textContent = text || '';
        message.className = 'teacher-message' + (type ? ' ' + type : '');
    }

    function pendingReviewCount() {
        return (state.disputes || []).filter(function(item) {
            return item.status !== 'approved' && item.status !== 'rejected';
        }).length;
    }

    function updateTopBadges() {
        var button = document.querySelector('.tab-button[data-view="argue"]');
        if (!button) return;
        var count = pendingReviewCount();
        button.innerHTML = 'Review' + (count ? '<span class="notice-dot danger">' + escapeHtml(count) + '</span>' : '');
    }

    function updateAssignView() {
        document.querySelectorAll('[data-assign-view]').forEach(function(button) {
            button.classList.toggle('active', button.dataset.assignView === state.assignView);
        });
        var newPanel = document.getElementById('assign-new-panel');
        var progressPanel = document.getElementById('assign-progress-panel');
        if (newPanel) newPanel.hidden = state.assignView !== 'new';
        if (progressPanel) progressPanel.hidden = state.assignView !== 'progress';
        if (state.assignView === 'progress') renderAssignmentOverview();
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
            set.category
        ].join(' ').toLowerCase();
        if (haystack.indexOf('vocab') !== -1 || haystack.indexOf('ngsl') !== -1) return 'vocabulary';
        if (haystack.indexOf('grammar') !== -1) return 'grammar';
        if (haystack.indexOf('listening') !== -1 || haystack.indexOf('bbc') !== -1) return 'listening';
        return 'other';
    }

    function renderLibraryTabs() {
        var container = document.getElementById('teacher-library-tabs');
        if (!container) return;
        container.innerHTML = LIBRARY_FILTERS.map(function(filter) {
            return '<button class="library-tab' + (state.libraryFilter === filter.id ? ' active' : '') +
                '" type="button" data-library-filter="' + escapeHtml(filter.id) + '">' +
                escapeHtml(filter.label) + '</button>';
        }).join('');
        container.querySelectorAll('[data-library-filter]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.libraryFilter = button.dataset.libraryFilter;
                renderLibrary();
            });
        });
    }

    function fillClassFilters() {
        var options = '<option value="">All classes</option>' + classes().map(function(classGroup) {
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
        var options = '<option value="">All columns</option>' + setSections().map(function(section) {
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
        return state.sets.filter(function(set) {
            var setSection = String(set.section || set.course || set.type || 'Other');
            var matchesSection = !section || setSection === section;
            var matchesLibrary = prefix !== 'library' || setCategory(set) === state.libraryFilter || query;
            var haystack = [set.set_id, set.title, set.course, set.type, set.section].join(' ').toLowerCase();
            return matchesSection && matchesLibrary && (!query || haystack.indexOf(query) !== -1);
        });
    }

    function renderSetOptions() {
        var sets = filteredSets('assign');
        var select = document.getElementById('assign-set');
        select.innerHTML = sets.map(function(set) {
            return '<option value="' + escapeHtml(set.set_id) + '"' +
                (state.selectedAssignSetIds[set.set_id] ? ' selected' : '') + '>' +
                escapeHtml(set.title + ' · ' + set.course) + '</option>';
        }).join('');
        updateAssignSummary();
        renderLibrary();
    }

    function syncSelectedAssignSets() {
        var select = document.getElementById('assign-set');
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
        var due = document.getElementById('assign-due').value;
        var passing = document.getElementById('assign-passing').value;
        var mastery = document.getElementById('assign-mastery').value;
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
            if (button) button.closest('.profile-card').classList.toggle('expanded', open);
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
        return href + (href.indexOf('?') === -1 ? '?' : '&') + 'teacher=1';
    }

    function renderLibrary() {
        if (!libraryList) return;
        renderLibraryTabs();
        var sets = filteredSets('library');
        libraryList.innerHTML = sets.length ? sets.map(function(set) {
            return '<article class="resource-card teacher-library-card">' +
                '<div>' +
                    '<div class="resource-card-head">' +
                        '<p class="eyebrow accent">' + escapeHtml(set.section || set.course || set.type || 'Practice') + '</p>' +
                        '<span>' + escapeHtml(set.set_id) + '</span>' +
                    '</div>' +
                    '<h3>' + escapeHtml(set.title || set.set_id) + '</h3>' +
                '</div>' +
                '<a class="card-button" href="' + escapeHtml(teacherPracticeHref(set)) + '">Open</a>' +
            '</article>';
        }).join('') : '<div class="empty-card"><strong>No matching practice sets</strong>Try another keyword or column.</div>';
    }

    function candidateStatus(candidate) {
        if (candidate.availability === 'starred') {
            return {
                label: candidate.star_source === 'explore' ? 'STAR · completed in Explore' : 'STAR · completed',
                css: 'starred',
                disabled: true
            };
        }
        if (candidate.availability === 'in_progress') {
            return { label: 'In Progress', css: 'progress', disabled: true };
        }
        if (candidate.availability === 'completed') {
            return { label: 'STAR · completed', css: 'starred', disabled: true };
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
            candidateList.innerHTML = '<div class="empty-card"><strong>Choose a practice set or column</strong>Student availability will appear here.</div>';
            updateSelectedCount();
            return;
        }
        candidateList.innerHTML = candidates.length ? candidates.map(function(student) {
            var status = candidateStatus(student);
            return '<label class="candidate-card ' + status.css + (status.disabled ? ' disabled' : '') + '">' +
                '<input class="candidate-checkbox" type="checkbox" value="' + escapeHtml(student.auth_uid) + '"' +
                    (state.selectedAssignStudentUids[student.auth_uid] && !status.disabled ? ' checked' : '') +
                    (status.disabled ? ' disabled' : '') + '>' +
                '<span class="candidate-copy"><strong>' + escapeHtml(student.name || student.student_id) + '</strong>' +
                    '<small>' + escapeHtml(student.student_id) + ' · ' + escapeHtml(student.class_group || 'No class') +
                    (student.curriculum_track ? ' · ' + escapeHtml(student.curriculum_track) : '') + '</small></span>' +
                '<span class="candidate-status">' + escapeHtml(status.label) +
                    ((student.availability === 'completed' || student.availability === 'starred') && student.best_percentage != null
                        ? '<small>Best ' + escapeHtml(student.best_percentage) + '%</small>' : '') +
                '</span>' +
            '</label>';
        }).join('') : '<div class="empty-card"><strong>No matching students</strong>Try another search or class.</div>';

        candidateList.querySelectorAll('.candidate-checkbox').forEach(function(checkbox) {
            checkbox.addEventListener('change', function() {
                rememberSelectedCandidates();
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
            taskCount + ' practice' + (taskCount === 1 ? '' : 's') + ' · ' +
            count + ' student' + (count === 1 ? '' : 's');
        document.getElementById('assign-selected').textContent =
            taskCount && count
                ? 'Assign ' + taskCount + ' practice' + (taskCount === 1 ? '' : 's') + ' to ' +
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
                (searchMode ? '<small>' + escapeHtml(student.student_id) + ' · ' + escapeHtml(student.class_group || 'No class') +
                (student.curriculum_track ? ' · ' + escapeHtml(student.curriculum_track) : '') + '</small>' : '') + '</span>' +
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
                '<span>' + escapeHtml(formatPercent(assignment.best_percentage)) + ' best</span></div>' +
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
        return items.reduce(function(counts, item) {
            var status = normalizedAssignmentStatus(item.status);
            var alert = assignmentAlert(item);
            counts.total += 1;
            if (status === 'passed' || status === 'mastered') counts.finished += 1;
            if (status === 'to_do') counts.open += 1;
            if (alert.css === 'danger') counts.alerts += 1;
            return counts;
        }, { total: 0, open: 0, finished: 0, alerts: 0 });
    }

    function renderAssignmentOverview() {
        var container = document.getElementById('assignment-overview');
        if (!container) return;
        var items = assignedProgressItems().slice().sort(function(a, b) {
            var alertA = assignmentAlert(a);
            var alertB = assignmentAlert(b);
            if (alertA.rank !== alertB.rank) return alertA.rank - alertB.rank;
            return new Date(assignmentSortDate(b) || 0) - new Date(assignmentSortDate(a) || 0);
        });
        var metrics = assignmentOverviewMetrics(items);
        if (!items.length) {
            container.innerHTML = '<div class="empty-card"><strong>No assigned work yet</strong>Assignments will appear here after you create them.</div>';
            return;
        }
        var metricHtml = '<div class="assignment-overview-metrics">' +
            '<div class="assignment-overview-metric"><span>Total</span><strong>' + escapeHtml(metrics.total) + '</strong></div>' +
            '<div class="assignment-overview-metric"><span>Open</span><strong>' + escapeHtml(metrics.open) + '</strong></div>' +
            '<div class="assignment-overview-metric"><span>Finished</span><strong>' + escapeHtml(metrics.finished) + '</strong></div>' +
            '<div class="assignment-overview-metric"><span>Needs attention</span><strong>' + escapeHtml(metrics.alerts) + '</strong></div>' +
        '</div>';
        var rows = items.map(function(item) {
            var key = item.progress_id || item.assignment_id || [item.student_uid, item.set_id].join('::');
            var expanded = state.expandedAssignProgress[key] === true;
            var alert = assignmentAlert(item);
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
                    '<span class="assignment-alert-pill ' + escapeHtml(alert.css) + '">' + escapeHtml(alert.label) + '</span>' +
                '</button>' +
                (expanded ? '<div class="assignment-overview-detail">' + renderAssignmentDetails(item, attempts) + '</div>' : '') +
            '</div>';
        }).join('');
        container.innerHTML = metricHtml +
            '<div class="assignment-table">' +
                '<div class="assignment-table-head"><span>Student</span><span>Practice</span><span>Status</span><span>Attempts</span><span>Best</span><span>Signal</span></div>' +
                rows +
            '</div>';
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
        var systemOptions = ['', 'DSE', 'A-Level', 'AP', 'IB', 'Zhongkao', 'Gaokao'];

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
                        '<button class="student-info-edit" type="button" data-edit-student-field="class"><span>Class</span><strong>' + escapeHtml(student.class_group || 'Not assigned') + '</strong></button>' +
                        (classEditing ? '<form class="student-info-editor" data-student-info-editor="class">' +
                            '<input type="text" name="class_group" value="' + escapeHtml(student.class_group || '') + '" placeholder="Class">' +
                            '<button class="primary-button" type="submit">Save</button><button class="outline-button" type="button" data-cancel-student-info>Cancel</button>' +
                        '</form>' : '') +
                    '</div>' +
                    '<div class="student-info-item">' +
                        '<button class="student-info-edit" type="button" data-edit-student-field="system"><span>System</span><strong>' + escapeHtml(student.curriculum_track || 'Not set') + '</strong></button>' +
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
                }).catch(function(error) {
                    showMessage(error.message, 'error');
                    renderDisputes();
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
    }

    function loadData() {
        return Promise.all([
            teacherCall('listStudents'),
            teacherCall('listSets'),
            teacherCall('listAssignments'),
            teacherCall('listDisputes'),
            teacherCall('listAttempts'),
            loadProgressData()
        ]).then(function(results) {
            state.students = results[0].students || [];
            state.sets = results[1].sets || [];
            state.assignments = results[2].assignments || [];
            state.disputes = results[3].disputes || [];
            state.attempts = results[4].attempts || [];
            state.progressItems = results[5].progress || [];
            fillClassFilters();
            fillSetSectionFilters();
            renderSetOptions();
            renderLibrary();
            renderStudentList();
            renderStudentDetail();
            updateAssignView();
            return loadQuestionTextForDisputes();
        }).then(function() {
            renderDisputes();
        });
    }

    document.querySelectorAll('.tab-button').forEach(function(button) {
        button.addEventListener('click', function() {
            activateView(button.dataset.view);
            if (button.dataset.view === 'assign') updateAssignView();
        });
    });
    document.querySelectorAll('[data-assign-view]').forEach(function(button) {
        button.addEventListener('click', function() {
            state.assignView = button.dataset.assignView;
            updateAssignView();
        });
    });
    document.getElementById('toggle-assign-sets').addEventListener('click', function() {
        setAssignPanel('sets', state.assignPanels.sets !== true);
    });
    document.getElementById('toggle-assign-students').addEventListener('click', function() {
        setAssignPanel('students', state.assignPanels.students !== true);
    });
    document.getElementById('toggle-assign-options').addEventListener('click', function() {
        setAssignPanel('options', state.assignPanels.options !== true);
    });
    document.getElementById('assign-sets-done').addEventListener('click', function() {
        setAssignPanel('sets', false);
    });
    document.getElementById('assign-students-done').addEventListener('click', function() {
        rememberSelectedCandidates();
        updateSelectedCount();
        setAssignPanel('students', false);
    });
    document.getElementById('assign-set').addEventListener('change', function() {
        syncSelectedAssignSets();
        updateSelectedCount();
        loadCandidates();
    });
    document.getElementById('assign-section-filter').addEventListener('change', function() {
        renderSetOptions();
    });
    document.getElementById('assign-set-search').addEventListener('input', function() {
        renderSetOptions();
    });
    document.getElementById('assign-search').addEventListener('input', renderCandidates);
    document.getElementById('assign-class-filter').addEventListener('change', renderCandidates);
    ['assign-due', 'assign-passing', 'assign-mastery'].forEach(function(id) {
        document.getElementById(id).addEventListener('input', updateAssignOptionsSummary);
    });
    document.getElementById('library-search').addEventListener('input', renderLibrary);
    renderLibraryTabs();
    document.getElementById('select-class').addEventListener('click', function() {
        candidateList.querySelectorAll('.candidate-checkbox:not(:disabled)').forEach(function(checkbox) {
            state.selectedAssignStudentUids[checkbox.value] = true;
            checkbox.checked = true;
        });
        updateSelectedCount();
    });
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
            document.getElementById('assign-set').selectedIndex = -1;
            return Promise.all([teacherCall('listAssignments'), loadProgressData(), loadCandidates()]);
        }).then(function(results) {
            state.assignments = results[0].assignments || [];
            state.progressItems = results[1].progress || [];
            renderSetOptions();
            renderStudentDetail();
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
        var card = document.querySelector('.student-select-card');
        if (card && !card.contains(event.target)) setStudentPickerOpen(false);
    });
    document.getElementById('toggle-create-student').addEventListener('click', function() {
        setStudentPickerOpen(false);
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
    document.getElementById('teacher-logout').addEventListener('click', window.MrCatAuth.logout);

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
