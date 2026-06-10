(function() {
    'use strict';

    var state = {
        profile: null,
        students: [],
        sets: [],
        assignments: [],
        attempts: []
    };

    var message = document.getElementById('teacher-message');
    var studentList = document.getElementById('student-list');
    var assignmentList = document.getElementById('assignment-list');
    var attemptList = document.getElementById('attempt-list');
    var studentForm = document.getElementById('student-form');
    var assignmentForm = document.getElementById('assignment-form');
    var attemptSearch = document.getElementById('attempt-search');

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
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        }).format(date);
    }

    function teacherCall(action, data) {
        return window.MrCatCloud.callFunction('teacherAdmin', Object.assign({
            action: action
        }, data || {})).then(function(result) {
            if (!result || !result.success) {
                throw new Error(result && result.message || 'Teacher action failed.');
            }
            return result;
        });
    }

    function statusBadge(status) {
        var normalized = status === 'done' ? 'done' : (status === 'failed' ? 'failed' : 'todo');
        var label = status === 'done' ? 'Done' : (status === 'failed' ? 'Failed' : 'To Do');
        return '<span class="badge ' + normalized + '">' + label + '</span>';
    }

    function renderStudents() {
        var students = state.students.filter(function(student) {
            return student.role !== 'teacher';
        });
        studentList.innerHTML = students.length ? students.map(function(student) {
            return '<article class="teacher-row">' +
                '<div class="teacher-row-main">' +
                    '<div><strong>' + escapeHtml(student.name || student.student_id) + '</strong>' +
                    '<span>' + escapeHtml(student.student_id) + ' · ' + escapeHtml(student.class_group || 'No class') + '</span></div>' +
                    '<span class="badge ' + (student.active ? 'done' : 'failed') + '">' + (student.active ? 'Active' : 'Inactive') + '</span>' +
                '</div>' +
                '<div class="teacher-row-actions">' +
                    '<button class="outline-button student-edit" type="button" data-uid="' + escapeHtml(student.auth_uid) + '">Edit</button>' +
                    '<button class="outline-button student-reset" type="button" data-uid="' + escapeHtml(student.auth_uid) + '">Reset Password</button>' +
                    '<button class="' + (student.active ? 'danger-button' : 'outline-button') + ' student-toggle" type="button" data-uid="' +
                        escapeHtml(student.auth_uid) + '" data-active="' + (student.active ? 'true' : 'false') + '">' +
                        (student.active ? 'Deactivate' : 'Activate') + '</button>' +
                '</div>' +
            '</article>';
        }).join('') : '<div class="empty-card"><strong>No students yet</strong>Create the first student account here.</div>';

        studentList.querySelectorAll('.student-toggle').forEach(function(button) {
            button.addEventListener('click', function() {
                updateStudent(button.dataset.uid, { active: button.dataset.active !== 'true' });
            });
        });
        studentList.querySelectorAll('.student-edit').forEach(function(button) {
            button.addEventListener('click', function() {
                var student = state.students.find(function(item) { return item.auth_uid === button.dataset.uid; });
                if (!student) return;
                var name = prompt('Student name', student.name || '');
                if (name === null) return;
                var classGroup = prompt('Class', student.class_group || '');
                if (classGroup === null) return;
                updateStudent(student.auth_uid, { name: name, class_group: classGroup });
            });
        });
        studentList.querySelectorAll('.student-reset').forEach(function(button) {
            button.addEventListener('click', function() {
                var student = state.students.find(function(item) { return item.auth_uid === button.dataset.uid; });
                if (!student) return;
                if (!confirm('Reset the password for ' + student.student_id + '? Their current password will stop working.')) return;
                button.disabled = true;
                showMessage('Resetting password...', '');
                teacherCall('resetStudentPassword', { auth_uid: student.auth_uid })
                    .then(function(result) {
                        showMessage(
                            'Password reset for ' + student.student_id + '. Initial password: ' + result.initial_password,
                            'success'
                        );
                        return teacherCall('listStudents');
                    })
                    .then(function(result) {
                        state.students = result.students || [];
                        renderStudents();
                    })
                    .catch(function(error) {
                        showMessage(error.message, 'error');
                    })
                    .finally(function() {
                        button.disabled = false;
                    });
            });
        });
        renderStudentOptions();
    }

    function renderStudentOptions() {
        var select = document.getElementById('assignment-student');
        var students = state.students.filter(function(student) {
            return student.role !== 'teacher' && student.active;
        });
        select.innerHTML = '<option value="">Choose a student</option>' + students.map(function(student) {
            return '<option value="' + escapeHtml(student.auth_uid) + '">' +
                escapeHtml(student.name + ' (' + student.student_id + ')') + '</option>';
        }).join('');
    }

    function renderSetOptions() {
        var select = document.getElementById('assignment-set');
        select.innerHTML = '<option value="">Choose a practice set</option>' + state.sets.map(function(set) {
            return '<option value="' + escapeHtml(set.set_id) + '">' +
                escapeHtml(set.title + ' · ' + set.course) + '</option>';
        }).join('');
    }

    function renderAssignments() {
        assignmentList.innerHTML = state.assignments.length ? state.assignments.map(function(item) {
            return '<article class="teacher-row">' +
                '<div class="teacher-row-main">' +
                    '<div><strong>' + escapeHtml(item.set_title) + '</strong>' +
                    '<span>' + escapeHtml(item.student_name || item.student_id) + ' · assigned ' +
                        escapeHtml(formatDate(item.assigned_at, 'date unavailable')) + '</span></div>' +
                    statusBadge(item.status) +
                '</div>' +
                '<div class="teacher-metrics">' +
                    '<span>Attempts <strong>' + escapeHtml(item.attempt_count) + '</strong></span>' +
                    '<span>Latest <strong>' + (item.latest_percentage == null ? '—' : escapeHtml(item.latest_percentage) + '%') + '</strong></span>' +
                    '<span>Best <strong>' + (item.best_percentage == null ? '—' : escapeHtml(item.best_percentage) + '%') + '</strong></span>' +
                    '<span>Due <strong>' + escapeHtml(formatDate(item.due_at)) + '</strong></span>' +
                '</div>' +
            '</article>';
        }).join('') : '<div class="empty-card"><strong>No assignments yet</strong>Choose a student and practice set to begin.</div>';
    }

    function renderAttempts(query) {
        var normalized = String(query || '').trim().toLowerCase();
        var attempts = state.attempts.filter(function(item) {
            if (!normalized) return true;
            return [item.student_id, item.set_id, item.mode].join(' ').toLowerCase().indexOf(normalized) !== -1;
        });
        attemptList.innerHTML = attempts.length ? attempts.map(function(item) {
            return '<article class="teacher-row">' +
                '<div class="teacher-row-main">' +
                    '<div><strong>' + escapeHtml(item.student_id || item.student_uid) + ' · ' + escapeHtml(item.set_id) + '</strong>' +
                    '<span>' + escapeHtml(formatDate(item.submitted_at, 'date unavailable')) + ' · attempt ' +
                        escapeHtml(item.attempt_number) + (item.selected_group_count ? ' · ' + escapeHtml(item.selected_group_count) + ' groups' : '') +
                    '</span></div>' +
                    '<span class="badge ' + (item.passed ? 'done' : 'failed') + '">' + (item.passed ? 'Passed' : 'Failed') + '</span>' +
                '</div>' +
                '<div class="teacher-metrics">' +
                    '<span>Score <strong>' + escapeHtml(item.percentage) + '%</strong></span>' +
                    '<span>Correct <strong>' + escapeHtml(item.correct_count) + '/' + escapeHtml(item.question_count) + '</strong></span>' +
                    '<span>Pass mark <strong>' + escapeHtml(item.passing_percentage) + '%</strong></span>' +
                    '<span>Source <strong>' + escapeHtml(item.practice_context || 'practice') + '</strong></span>' +
                '</div>' +
            '</article>';
        }).join('') : '<div class="empty-card"><strong>No matching attempts</strong>Recorded submissions will appear here.</div>';
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
            renderStudents();
            renderSetOptions();
            renderAssignments();
            renderAttempts(attemptSearch.value);
        });
    }

    function updateStudent(authUid, update) {
        showMessage('Saving...', '');
        teacherCall('updateStudent', Object.assign({ auth_uid: authUid }, update))
            .then(function() {
                showMessage('Student updated.', 'success');
                return teacherCall('listStudents');
            })
            .then(function(result) {
                state.students = result.students || [];
                renderStudents();
            })
            .catch(function(error) {
                showMessage(error.message, 'error');
            });
    }

    document.querySelectorAll('.tab-button').forEach(function(button) {
        button.addEventListener('click', function() {
            document.querySelectorAll('.tab-button').forEach(function(item) {
                item.classList.toggle('active', item === button);
            });
            document.querySelectorAll('.dashboard-view').forEach(function(view) {
                view.hidden = view.id !== 'view-' + button.dataset.view;
            });
        });
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
            showMessage(
                'Student created. Login ID: ' + result.student.student_id +
                ' · Initial password: ' + result.initial_password,
                'success'
            );
            return teacherCall('listStudents');
        }).then(function(result) {
            state.students = result.students || [];
            renderStudents();
        }).catch(function(error) {
            showMessage(error.message, 'error');
        }).finally(function() {
            button.disabled = false;
        });
    });

    assignmentForm.addEventListener('submit', function(event) {
        event.preventDefault();
        var button = assignmentForm.querySelector('button[type="submit"]');
        var dueValue = document.getElementById('assignment-due').value;
        button.disabled = true;
        showMessage('Creating assignment...', '');
        teacherCall('createAssignment', {
            student_uid: document.getElementById('assignment-student').value,
            set_id: document.getElementById('assignment-set').value,
            due_at: dueValue ? dueValue + 'T23:59:59+08:00' : null
        }).then(function() {
            assignmentForm.reset();
            showMessage('Assignment created.', 'success');
            return teacherCall('listAssignments');
        }).then(function(result) {
            state.assignments = result.assignments || [];
            renderAssignments();
        }).catch(function(error) {
            showMessage(error.message, 'error');
        }).finally(function() {
            button.disabled = false;
        });
    });

    attemptSearch.addEventListener('input', function() {
        renderAttempts(attemptSearch.value);
    });
    document.getElementById('teacher-logout').addEventListener('click', window.MrCatAuth.logout);

    window.MrCatAuth.getSession()
        .then(function(session) {
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
        })
        .catch(function(error) {
            showMessage(error.message || 'Unable to load the teacher desk.', 'error');
        });
})();
