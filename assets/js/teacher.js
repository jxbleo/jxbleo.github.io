(function() {
    'use strict';

    var state = {
        profile: null,
        students: [],
        sets: [],
        assignments: [],
        attempts: [],
        candidates: [],
        selectedStudentProfileId: ''
    };

    var message = document.getElementById('teacher-message');
    var studentList = document.getElementById('student-list');
    var studentDetail = document.getElementById('student-detail');
    var studentForm = document.getElementById('student-form');
    var candidateList = document.getElementById('assign-candidates');

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

    function formatDate(value, fallback) {
        if (!value) return fallback || '—';
        var date = new Date(value);
        if (isNaN(date.getTime())) return fallback || '—';
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        }).format(date);
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

    function renderSetOptions() {
        document.getElementById('assign-set').innerHTML =
            '<option value="">Choose a practice set</option>' +
            state.sets.map(function(set) {
                return '<option value="' + escapeHtml(set.set_id) + '">' +
                    escapeHtml(set.title + ' · ' + set.course) + '</option>';
            }).join('');
    }

    function candidateStatus(candidate) {
        if (candidate.availability === 'in_progress') {
            return { label: 'In Progress', css: 'progress', disabled: true };
        }
        if (candidate.availability === 'completed') {
            return { label: 'Completed · can reassign', css: 'completed', disabled: false };
        }
        return { label: 'Available', css: 'available', disabled: false };
    }

    function filteredCandidates() {
        var query = document.getElementById('assign-search').value.trim().toLowerCase();
        var classGroup = document.getElementById('assign-class-filter').value;
        return state.candidates.filter(function(student) {
            var matchesQuery = !query || [student.name, student.student_id, student.class_group]
                .join(' ').toLowerCase().indexOf(query) !== -1;
            return matchesQuery && (!classGroup || student.class_group === classGroup);
        });
    }

    function renderCandidates() {
        var candidates = filteredCandidates();
        if (!document.getElementById('assign-set').value) {
            candidateList.innerHTML = '<div class="empty-card"><strong>Choose a practice set</strong>Student availability will appear here.</div>';
            updateSelectedCount();
            return;
        }
        candidateList.innerHTML = candidates.length ? candidates.map(function(student) {
            var status = candidateStatus(student);
            return '<label class="candidate-card ' + status.css + (status.disabled ? ' disabled' : '') + '">' +
                '<input class="candidate-checkbox" type="checkbox" value="' + escapeHtml(student.auth_uid) + '"' +
                    (status.disabled ? ' disabled' : '') + '>' +
                '<span class="candidate-copy"><strong>' + escapeHtml(student.name || student.student_id) + '</strong>' +
                    '<small>' + escapeHtml(student.student_id) + ' · ' + escapeHtml(student.class_group || 'No class') + '</small></span>' +
                '<span class="candidate-status">' + escapeHtml(status.label) +
                    (student.availability === 'completed' && student.best_percentage != null
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
            !count || !document.getElementById('assign-set').value;
    }

    function loadCandidates() {
        var setId = document.getElementById('assign-set').value;
        state.candidates = [];
        renderCandidates();
        if (!setId) return Promise.resolve();
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
            var matchesQuery = !query || [student.name, student.student_id, student.class_group]
                .join(' ').toLowerCase().indexOf(query) !== -1;
            return matchesQuery && (!classGroup || student.class_group === classGroup);
        });
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
                '<small>' + escapeHtml(student.student_id) + ' · ' + escapeHtml(student.class_group || 'No class') + '</small></span>' +
                '<i class="' + (student.active ? 'account-active' : 'account-inactive') + '"></i>' +
            '</button>';
        }).join('') : '<div class="empty-card"><strong>No matching students</strong>Try another search or class.</div>';

        studentList.querySelectorAll('.student-pick').forEach(function(button) {
            if (button.classList.contains('incomplete-profile')) return;
            button.addEventListener('click', function() {
                state.selectedStudentProfileId = button.dataset.profileId;
                renderStudentList();
                renderStudentDetail();
            });
        });
    }

    function assignmentSummary(assignments) {
        var counts = { not_done: 0, failed: 0, done: 0 };
        assignments.forEach(function(item) {
            counts[item.status] = (counts[item.status] || 0) + 1;
        });
        return '<div class="summary-grid student-summary">' +
            '<div class="summary-card"><span class="summary-value">' + counts.not_done + '</span><span class="summary-label">TO DO</span></div>' +
            '<div class="summary-card"><span class="summary-value">' + counts.failed + '</span><span class="summary-label">FAILED</span></div>' +
            '<div class="summary-card"><span class="summary-value">' + counts.done + '</span><span class="summary-label">DONE</span></div>' +
        '</div>';
    }

    function renderStudentDetail() {
        var student = state.students.find(function(item) {
            return item.profile_id === state.selectedStudentProfileId;
        });
        if (!student) {
            studentDetail.innerHTML = '<div class="empty-card"><strong>Select a student</strong>Account details and learning progress will appear here.</div>';
            return;
        }
        var assignments = state.assignments.filter(function(item) {
            return item.student_uid === student.auth_uid;
        });
        var attempts = state.attempts.filter(function(item) {
            return item.student_uid === student.auth_uid || item.student_id === student.student_id;
        }).slice(0, 10);

        var assignmentHtml = assignments.length ? assignments.map(function(item) {
            return '<article class="learning-row"><div><strong>' + escapeHtml(item.set_title) + '</strong>' +
                '<small>' + escapeHtml(item.status === 'done' ? 'Done' : item.status === 'failed' ? 'Failed' : 'To Do') +
                ' · ' + escapeHtml(item.attempt_count) + ' attempts</small></div>' +
                '<span>' + (item.best_percentage == null ? '—' : escapeHtml(item.best_percentage) + '% best') + '</span></article>';
        }).join('') : '<p class="muted">No assignments yet.</p>';

        var attemptHtml = attempts.length ? attempts.map(function(item) {
            return '<article class="learning-row"><div><strong>' + escapeHtml(item.set_id) + '</strong>' +
                '<small>' + escapeHtml(formatDate(item.submitted_at)) + ' · attempt ' + escapeHtml(item.attempt_number) + '</small></div>' +
                '<span class="' + (item.passed ? 'score-pass' : 'score-fail') + '">' + escapeHtml(item.percentage) + '%</span></article>';
        }).join('') : '<p class="muted">No recorded attempts yet.</p>';

        studentDetail.innerHTML =
            '<section class="profile-card student-account-card">' +
                '<div class="student-detail-heading"><div><p class="eyebrow accent">STUDENT ACCOUNT</p><h2>' +
                    escapeHtml(student.name || student.student_id) + '</h2><p>' +
                    escapeHtml(student.student_id) + '</p></div>' +
                    '<span class="badge ' + (student.active ? 'done' : 'failed') + '">' +
                    (student.active ? 'Active' : 'Inactive') + '</span></div>' +
                '<div class="profile-row"><span>Class</span><strong>' + escapeHtml(student.class_group || 'Not assigned') + '</strong></div>' +
                '<div class="student-account-actions">' +
                    '<input id="detail-class" type="text" value="' + escapeHtml(student.class_group || '') + '" placeholder="Class name">' +
                    '<button class="outline-button" id="save-class" type="button">Assign Class</button>' +
                    '<button class="outline-button" id="reset-password" type="button">Reset Password</button>' +
                    '<button class="' + (student.active ? 'danger-button' : 'outline-button') + '" id="toggle-account" type="button">' +
                        (student.active ? 'Disable Account' : 'Enable Account') + '</button>' +
                '</div>' +
            '</section>' +
            assignmentSummary(assignments) +
            '<section class="profile-card learning-section"><h3>Assigned work</h3>' + assignmentHtml + '</section>' +
            '<section class="profile-card learning-section"><h3>Recent attempts</h3>' + attemptHtml + '</section>';

        document.getElementById('save-class').addEventListener('click', function() {
            updateStudent(student.auth_uid, { class_group: document.getElementById('detail-class').value });
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
            teacherCall('listAttempts')
        ]).then(function(results) {
            state.students = results[0].students || [];
            state.sets = results[1].sets || [];
            state.assignments = results[2].assignments || [];
            state.attempts = results[3].attempts || [];
            fillClassFilters();
            renderSetOptions();
            renderStudentList();
            renderStudentDetail();
        });
    }

    document.querySelectorAll('.tab-button').forEach(function(button) {
        button.addEventListener('click', function() { activateView(button.dataset.view); });
    });
    document.getElementById('assign-set').addEventListener('change', loadCandidates);
    document.getElementById('assign-search').addEventListener('input', renderCandidates);
    document.getElementById('assign-class-filter').addEventListener('change', renderCandidates);
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
            set_id: document.getElementById('assign-set').value,
            student_uids: studentUids,
            due_at: due ? due + 'T23:59:59+08:00' : null
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

    document.getElementById('student-search').addEventListener('input', renderStudentList);
    document.getElementById('student-class-filter').addEventListener('change', renderStudentList);
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
