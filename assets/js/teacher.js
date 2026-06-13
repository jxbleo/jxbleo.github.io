(function() {
    'use strict';

    var state = {
        profile: null,
        students: [],
        sets: [],
        assignments: [],
        attempts: [],
        disputes: [],
        candidates: [],
        selectedStudentProfileId: '',
        studentProgressFilter: 'to_do',
        studentProgressView: 'assignment',
        disputeFilter: 'pending',
        libraryFilter: 'vocabulary',
        expandedDisputes: {},
        expandedAttemptSets: {}
    };
    var LIBRARY_FILTERS = [
        { id: 'vocabulary', label: 'Vocabulary' },
        { id: 'grammar', label: 'Grammar' },
        { id: 'listening', label: 'Listening' }
    ];
    var CURRICULUM_OPTIONS = ['', 'DSE', 'A-Level', 'AP', 'IB', 'Zhongkao', 'Gaokao'];

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

    function loadQuestionTextForAttempts() {
        return loadQuestionTextForRecords(state.attempts || []);
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

    function englishName(value) {
        var textValue = String(value || '').trim();
        if (!textValue) return 'Student';
        var parts = textValue.split(/\s+/).filter(Boolean);
        return parts[parts.length - 1] || textValue;
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
        document.getElementById('assign-set').innerHTML =
            '<option value="">Choose a practice set</option>' +
            sets.map(function(set) {
                return '<option value="' + escapeHtml(set.set_id) + '">' +
                    escapeHtml(set.title + ' · ' + set.course) + '</option>';
            }).join('');
        renderLibrary();
    }

    function assignmentTargetSetIds() {
        var selected = document.getElementById('assign-set').value;
        var section = document.getElementById('assign-section-filter').value;
        var query = document.getElementById('assign-set-search').value.trim();
        if (selected) return [selected];
        if (!section && !query) return [];
        return filteredSets('assign').map(function(set) { return set.set_id; });
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
            checkbox.addEventListener('change', updateSelectedCount);
        });
        updateSelectedCount();
    }

    function selectedCandidateUids() {
        return Array.prototype.map.call(
            candidateList.querySelectorAll('.candidate-checkbox:checked'),
            function(checkbox) { return checkbox.value; }
        );
    }

    function updateSelectedCount() {
        var count = selectedCandidateUids().length;
        document.getElementById('selected-count').textContent =
            count + ' student' + (count === 1 ? '' : 's') + ' selected';
        document.getElementById('assign-selected').disabled =
            !count || !assignmentTargetSetIds().length;
    }

    function loadCandidates() {
        var setId = document.getElementById('assign-set').value;
        state.candidates = [];
        renderCandidates();
        if (!setId) {
            state.candidates = studentRecords().filter(function(student) {
                return student.active === true && student.profile_complete;
            }).map(function(student) {
                return Object.assign({}, student, { availability: 'available' });
            });
            renderCandidates();
            return Promise.resolve();
        }
        candidateList.innerHTML = '<div class="empty-card loading-card">Checking assignment status...</div>';
        return teacherCall('getAssignmentCandidates', { set_id: setId }).then(function(result) {
            state.candidates = result.candidates || [];
            renderCandidates();
        }).catch(function(error) {
            candidateList.innerHTML = '<div class="empty-card"><strong>Unable to load students</strong>' +
                escapeHtml(error.message) + '</div>';
        });
    }

    function filteredStudents() {
        var query = document.getElementById('student-search').value.trim().toLowerCase();
        var classGroup = document.getElementById('student-class-filter').value;
        return studentRecords().filter(function(student) {
            var matchesQuery = !query || [student.name, student.student_id, student.class_group, student.curriculum_track]
                .join(' ').toLowerCase().indexOf(query) !== -1;
            return matchesQuery && (!classGroup || student.class_group === classGroup);
        });
    }

    function setStudentPickerOpen(open) {
        var card = document.querySelector('.student-select-card');
        if (card) card.classList.toggle('picker-open', open === true);
    }

    function renderStudentList() {
        var students = filteredStudents();
        studentList.innerHTML = students.length ? students.map(function(student) {
            if (!student.profile_complete) {
                return '<div class="student-pick incomplete-profile">' +
                    '<span><strong>Profile incomplete</strong><small>Database record is missing Login ID or User ID</small></span></div>';
            }
            return '<button class="student-pick' +
                (student.profile_id === state.selectedStudentProfileId ? ' active' : '') +
                '" type="button" data-profile-id="' + escapeHtml(student.profile_id) + '">' +
                '<span><strong>' + escapeHtml(student.name || student.student_id) + '</strong>' +
                '<small>' + escapeHtml(student.student_id) + ' · ' + escapeHtml(student.class_group || 'No class') +
                (student.curriculum_track ? ' · ' + escapeHtml(student.curriculum_track) : '') + '</small></span>' +
                '<i class="' + (student.active ? 'account-active' : 'account-inactive') + '"></i>' +
            '</button>';
        }).join('') : '<div class="empty-card"><strong>No matching students</strong>Try another search or class.</div>';

        studentList.querySelectorAll('.student-pick').forEach(function(button) {
            if (button.classList.contains('incomplete-profile')) return;
            button.addEventListener('click', function() {
                state.selectedStudentProfileId = button.dataset.profileId;
                var selected = state.students.find(function(item) {
                    return item.profile_id === state.selectedStudentProfileId;
                });
                if (selected) {
                    document.getElementById('student-search').value = selected.name || selected.student_id || '';
                }
                state.studentProgressFilter = 'to_do';
                state.studentProgressView = 'assignment';
                state.expandedAttemptSets = {};
                setStudentPickerOpen(false);
                renderStudentList();
                renderStudentDetail();
            });
        });
    }

    function assignmentSummary(assignments) {
        var counts = { to_do: 0, passed: 0, mastered: 0 };
        assignments.forEach(function(item) {
            var status = normalizedAssignmentStatus(item.status);
            counts[status] = (counts[status] || 0) + 1;
        });
        var filters = [
            { id: 'to_do', label: 'TO DO', count: counts.to_do },
            { id: 'passed', label: 'PASSED', count: counts.passed },
            { id: 'mastered', label: 'MASTERED', count: counts.mastered }
        ];
        return '<div class="summary-grid student-summary" role="tablist" aria-label="Student progress">' +
            filters.map(function(filter) {
                return '<button class="summary-card assignment-filter' + (state.studentProgressFilter === filter.id ? ' active' : '') +
                    '" type="button" data-student-progress-filter="' + escapeHtml(filter.id) + '">' +
                    '<span class="summary-value">' + filter.count + '</span><span class="summary-label">' + escapeHtml(filter.label) + '</span></button>';
            }).join('') +
        '</div>';
    }

    function setTitleFor(setId) {
        var set = state.sets.find(function(item) { return item.set_id === setId; });
        return set ? set.title || setId : setId;
    }

    function progressModeTabs() {
        var tabs = [
            { id: 'assignment', label: 'Assignment' },
            { id: 'attempt', label: 'Attempt' }
        ];
        return '<div class="progress-mode-tabs" role="tablist" aria-label="Progress detail type">' +
            tabs.map(function(tab) {
                return '<button class="progress-mode-tab' + (state.studentProgressView === tab.id ? ' active' : '') +
                    '" type="button" data-progress-view="' + escapeHtml(tab.id) + '">' +
                    escapeHtml(tab.label) + '</button>';
            }).join('') +
        '</div>';
    }

    function questionTextFor(setId, questionId) {
        return getQuestionTextFromData(questionTextCache[setId], questionId) || '';
    }

    function wrongResults(attempt) {
        return (attempt.question_results || []).filter(function(result) {
            return result && result.correct === false;
        });
    }

    function renderWrongQuestions(attempt) {
        var wrong = wrongResults(attempt);
        if (!wrong.length) return '<p class="attempt-all-correct">All checked answers were correct.</p>';
        return '<div class="wrong-question-list">' + wrong.map(function(result) {
            var questionText = questionTextFor(attempt.set_id, result.question_id);
            return '<div class="wrong-question">' +
                '<strong>' + escapeHtml(result.question_id || 'Question') + '</strong>' +
                (questionText ? '<p>' + escapeHtml(questionText) + '</p>' : '') +
                '<small>Student answer: ' + escapeHtml(answerText(result.submitted_answer)) + '</small>' +
            '</div>';
        }).join('') + '</div>';
    }

    function groupAttemptsBySet(attempts) {
        var groups = {};
        attempts.forEach(function(attempt) {
            var key = attempt.set_id || 'unknown';
            if (!groups[key]) {
                groups[key] = { set_id: key, title: setTitleFor(key), attempts: [], latest_at: attempt.submitted_at || null };
            }
            groups[key].attempts.push(attempt);
            if (new Date(attempt.submitted_at || 0) > new Date(groups[key].latest_at || 0)) {
                groups[key].latest_at = attempt.submitted_at || null;
            }
        });
        return Object.keys(groups).map(function(key) {
            groups[key].attempts.sort(function(a, b) {
                return new Date(b.submitted_at || 0) - new Date(a.submitted_at || 0);
            });
            return groups[key];
        }).sort(function(a, b) {
            return new Date(b.latest_at || 0) - new Date(a.latest_at || 0);
        });
    }

    function renderAssignmentProgress(assignments) {
        var visibleAssignments = assignments.filter(function(item) {
            return normalizedAssignmentStatus(item.status) === state.studentProgressFilter;
        });
        var assignmentHtml = visibleAssignments.length ? visibleAssignments.map(function(item) {
            return '<article class="learning-row"><div><strong>' + escapeHtml(item.set_title) + '</strong>' +
                '<small>' + escapeHtml(assignmentStatusLabel(item.status)) +
                ' · ' + escapeHtml(item.attempt_count) + ' attempts</small></div>' +
                '<span>' + (item.best_percentage == null ? '—' : escapeHtml(item.best_percentage) + '% best') + '</span></article>';
        }).join('') : '<p class="muted">No ' + escapeHtml(assignmentStatusLabel(state.studentProgressFilter).toLowerCase()) + ' assignments.</p>';

        return assignmentSummary(assignments) +
            '<div class="learning-section"><h3>' + escapeHtml(assignmentStatusLabel(state.studentProgressFilter)) + ' assignments</h3>' +
                assignmentHtml + '</div>';
    }

    function renderAttemptProgress(attempts) {
        var groups = groupAttemptsBySet(attempts);
        if (!groups.length) {
            return '<div class="learning-section"><h3>Attempts</h3><p class="muted">No recorded attempts yet.</p></div>';
        }
        return '<div class="learning-section attempt-set-list"><h3>Attempts</h3>' + groups.map(function(group) {
            var expanded = state.expandedAttemptSets[group.set_id] === true;
            var latest = group.attempts[0] || {};
            var latestWrong = wrongResults(latest).length;
            return '<article class="attempt-set-capsule' + (expanded ? ' expanded' : '') + '">' +
                '<button class="attempt-set-head" type="button" data-attempt-set="' + escapeHtml(group.set_id) + '">' +
                    '<span><strong>' + escapeHtml(group.title) + '</strong>' +
                    '<small>Set ID: ' + escapeHtml(group.set_id) + ' · ' + group.attempts.length + ' attempt' +
                    (group.attempts.length === 1 ? '' : 's') + ' · latest ' + escapeHtml(formatDateTime(group.latest_at)) + '</small></span>' +
                    '<span class="' + (latest.passed ? 'score-pass' : 'score-fail') + '">' +
                        escapeHtml(latest.percentage == null ? '—' : latest.percentage + '%') +
                        '<small>' + (latestWrong ? latestWrong + ' wrong' : 'clear') + '</small>' +
                    '</span>' +
                '</button>' +
                (expanded ? '<div class="attempt-detail-list">' + group.attempts.map(function(attempt) {
                    var wrong = wrongResults(attempt);
                    return '<section class="attempt-detail-row">' +
                        '<div class="attempt-detail-head"><div><strong>Attempt ' + escapeHtml(attempt.attempt_number || 1) + '</strong>' +
                        '<small>Submitted: ' + escapeHtml(formatDateTime(attempt.submitted_at)) +
                        (attempt.assignment_id ? ' · assigned work' : ' · self-study') + '</small></div>' +
                        '<span class="' + (attempt.passed ? 'score-pass' : 'score-fail') + '">' +
                        escapeHtml(attempt.percentage == null ? '—' : attempt.percentage + '%') +
                        ' · ' + escapeHtml(attempt.correct_count) + '/' + escapeHtml(attempt.question_count) + '</span></div>' +
                        (wrong.length ? '<p class="wrong-summary">Wrong: ' + escapeHtml(wrong.map(function(result) {
                            return result.question_id || 'Question';
                        }).join(', ')) + '</p>' : '') +
                        renderWrongQuestions(attempt) +
                    '</section>';
                }).join('') + '</div>' : '') +
            '</article>';
        }).join('') + '</div>';
    }

    function renderStudentDetail() {
        var student = state.students.find(function(item) {
            return item.profile_id === state.selectedStudentProfileId;
        });
        if (!student) {
            studentDetail.innerHTML =
                '<section class="profile-card student-profile-card empty-check-card">' +
                    '<h2>Basic information</h2><p class="muted">Select a student to see their profile.</p></section>' +
                '<section class="profile-card student-progress-card empty-check-card">' +
                    '<h2>Progress</h2><p class="muted">Assignments and recent attempts will appear here.</p></section>';
            return;
        }
        var assignments = state.assignments.filter(function(item) {
            return item.student_uid === student.auth_uid;
        });
        var attempts = state.attempts.filter(function(item) {
            return item.student_uid === student.auth_uid || item.student_id === student.student_id;
        });
        var progressHtml = state.studentProgressView === 'attempt'
            ? renderAttemptProgress(attempts)
            : renderAssignmentProgress(assignments);

        studentDetail.innerHTML =
            '<section class="profile-card student-profile-card">' +
                '<div class="student-detail-heading"><div><p class="eyebrow accent">BASIC INFORMATION</p><h2>' +
                    escapeHtml(student.name || student.student_id) + '</h2><p>' +
                    escapeHtml(student.student_id) + '</p></div>' +
                    '<span class="badge ' + (student.active ? 'done' : 'failed') + '">' +
                    (student.active ? 'Active' : 'Inactive') + '</span></div>' +
                '<div class="profile-row"><span>Class</span><strong>' + escapeHtml(student.class_group || 'Not assigned') + '</strong></div>' +
                '<div class="profile-row"><span>System</span><strong>' + escapeHtml(student.curriculum_track || 'Not set') + '</strong></div>' +
                '<div class="student-account-actions">' +
                    '<input id="detail-class" type="text" value="' + escapeHtml(student.class_group || '') + '" placeholder="Class name">' +
                    '<select id="detail-curriculum">' + CURRICULUM_OPTIONS.map(function(option) {
                        return '<option value="' + escapeHtml(option) + '"' + (option === (student.curriculum_track || '') ? ' selected' : '') + '>' +
                            escapeHtml(option || 'Not set') + '</option>';
                    }).join('') + '</select>' +
                    '<button class="outline-button" id="save-class" type="button">Assign Class</button>' +
                    '<button class="outline-button" id="reset-password" type="button">Reset Password</button>' +
                    '<button class="' + (student.active ? 'danger-button' : 'outline-button') + '" id="toggle-account" type="button">' +
                        (student.active ? 'Disable Account' : 'Enable Account') + '</button>' +
                '</div>' +
            '</section>' +
            '<section class="profile-card student-progress-card">' +
                '<div class="student-detail-heading"><div><p class="eyebrow accent">PROGRESS</p><h2>Student progress</h2></div></div>' +
                progressModeTabs() + progressHtml +
            '</section>';

        document.getElementById('save-class').addEventListener('click', function() {
            updateStudent(student.auth_uid, {
                class_group: document.getElementById('detail-class').value,
                curriculum_track: document.getElementById('detail-curriculum').value
            });
        });
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
        studentDetail.querySelectorAll('[data-student-progress-filter]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.studentProgressFilter = button.dataset.studentProgressFilter;
                renderStudentDetail();
            });
        });
        studentDetail.querySelectorAll('[data-progress-view]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.studentProgressView = button.dataset.progressView;
                renderStudentDetail();
            });
        });
        studentDetail.querySelectorAll('[data-attempt-set]').forEach(function(button) {
            button.addEventListener('click', function() {
                var setId = button.dataset.attemptSet;
                state.expandedAttemptSets[setId] = state.expandedAttemptSets[setId] !== true;
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
        var counts = disputeCounts();
        var disputes = filteredDisputes();
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
        var body = disputes.length ? disputes.map(function(item) {
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
            '</div>';
        list.innerHTML = tabs + body;

        list.querySelectorAll('[data-dispute-filter]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.disputeFilter = button.dataset.disputeFilter;
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
                        teacherCall('listAttempts')
                    ]);
                }).then(function(results) {
                    state.disputes = results[0].disputes || [];
                    state.assignments = results[1].assignments || [];
                    state.attempts = results[2].attempts || [];
                    return Promise.all([loadQuestionTextForDisputes(), loadQuestionTextForAttempts()]);
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
            teacherCall('listAttempts'),
            teacherCall('listDisputes')
        ]).then(function(results) {
            state.students = results[0].students || [];
            state.sets = results[1].sets || [];
            state.assignments = results[2].assignments || [];
            state.attempts = results[3].attempts || [];
            state.disputes = results[4].disputes || [];
            fillClassFilters();
            fillSetSectionFilters();
            renderSetOptions();
            renderLibrary();
            renderStudentList();
            renderStudentDetail();
            return Promise.all([loadQuestionTextForDisputes(), loadQuestionTextForAttempts()]);
        }).then(function() {
            renderDisputes();
        });
    }

    document.querySelectorAll('.tab-button').forEach(function(button) {
        button.addEventListener('click', function() { activateView(button.dataset.view); });
    });
    document.getElementById('assign-set').addEventListener('change', loadCandidates);
    document.getElementById('assign-section-filter').addEventListener('change', function() {
        renderSetOptions();
        loadCandidates();
    });
    document.getElementById('assign-set-search').addEventListener('input', function() {
        renderSetOptions();
        loadCandidates();
    });
    document.getElementById('assign-search').addEventListener('input', renderCandidates);
    document.getElementById('assign-class-filter').addEventListener('change', renderCandidates);
    document.getElementById('library-search').addEventListener('input', renderLibrary);
    renderLibraryTabs();
    document.getElementById('select-class').addEventListener('click', function() {
        candidateList.querySelectorAll('.candidate-checkbox:not(:disabled)').forEach(function(checkbox) {
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
            return Promise.all([teacherCall('listAssignments'), loadCandidates()]);
        }).then(function(results) {
            state.assignments = results[0].assignments || [];
            renderStudentDetail();
        }).catch(function(error) {
            showMessage(error.message, 'error');
        }).finally(updateSelectedCount);
    });

    document.getElementById('student-search').addEventListener('focus', function() {
        this.select();
        setStudentPickerOpen(true);
        renderStudentList();
    });
    document.getElementById('student-search').addEventListener('input', function() {
        setStudentPickerOpen(true);
        renderStudentList();
    });
    document.getElementById('student-class-filter').addEventListener('change', renderStudentList);
    document.addEventListener('click', function(event) {
        var card = document.querySelector('.student-select-card');
        if (card && !card.contains(event.target)) setStudentPickerOpen(false);
    });
    document.getElementById('toggle-create-student').addEventListener('click', function() {
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
        document.getElementById('teacher-chip').textContent = session.profile.student_id;
        document.getElementById('teacher-greeting').textContent =
            'Hi, ' + (session.profile.name || session.profile.student_id) + '.';
        return loadData();
    }).catch(function(error) {
        showMessage(error.message || 'Unable to load the teacher desk.', 'error');
    });
})();
