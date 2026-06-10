(function() {
    'use strict';

    var state = {
        session: null,
        assignments: [],
        resources: []
    };

    var identityChip = document.getElementById('identity-chip');
    var greeting = document.getElementById('greeting');
    var heroCopy = document.getElementById('hero-copy');
    var assignmentContent = document.getElementById('assignment-content');
    var resourceList = document.getElementById('resource-list');
    var profileContent = document.getElementById('profile-content');
    var resourceSearch = document.getElementById('resource-search');

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(value) {
        if (!value) return 'No due date';
        var date = value instanceof Date ? value : new Date(value);
        if (isNaN(date.getTime())) return 'No due date';
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        }).format(date);
    }

    function statusLabel(status) {
        if (status === 'done') return 'Done';
        if (status === 'failed') return 'Failed';
        return 'To Do';
    }

    function practiceHref(item, assignmentId) {
        var href = item.link || item.href || '#';
        var params = ['app=' + encodeURIComponent(window.MRCAT_CONFIG.appVersion || '1')];
        if (assignmentId) params.push('assignment=' + encodeURIComponent(assignmentId));
        if (state.session && state.session.mode === 'visitor') params.push('visitor=1');
        return href + (href.indexOf('?') === -1 ? '?' : '&') + params.join('&');
    }

    function renderSummary(assignments) {
        var counts = { not_done: 0, failed: 0, done: 0 };
        assignments.forEach(function(item) {
            counts[item.status] = (counts[item.status] || 0) + 1;
        });
        return '<div class="summary-grid">' +
            '<div class="summary-card"><span class="summary-value">' + counts.not_done + '</span><span class="summary-label">TO DO</span></div>' +
            '<div class="summary-card"><span class="summary-value">' + counts.failed + '</span><span class="summary-label">FAILED</span></div>' +
            '<div class="summary-card"><span class="summary-value">' + counts.done + '</span><span class="summary-label">DONE</span></div>' +
        '</div>';
    }

    function taskCard(item) {
        var set = item.set || item;
        var status = item.status || 'not_done';
        var action = status === 'not_done' ? 'Start' : 'Try Again';
        var score = item.latest_percentage == null ? '' : '<span>Latest ' + escapeHtml(item.latest_percentage) + '%</span>';
        var href = practiceHref(set, item.assignment_id);
        if (status !== 'not_done') href += '&retry=1';
        return '<article class="task-card">' +
            '<div>' +
                '<span class="badge ' + escapeHtml(status) + '">' + statusLabel(status) + '</span>' +
                '<h3>' + escapeHtml(set.title || set.set_id) + '</h3>' +
                '<div class="card-meta">' +
                    '<span>' + escapeHtml(set.course || set.type || 'Practice') + '</span>' +
                    '<span>Due ' + escapeHtml(formatDate(item.due_at)) + '</span>' +
                    score +
                    '<span>' + escapeHtml(item.attempt_count || 0) + ' attempt' + ((item.attempt_count || 0) === 1 ? '' : 's') + '</span>' +
                '</div>' +
            '</div>' +
            '<a class="card-button" href="' + escapeHtml(href) + '">' + action + '</a>' +
        '</article>';
    }

    function renderAssignmentGroup(title, note, items, options) {
        if (!items.length) return '';
        var controls = '';
        if (options && options.doneFilter) {
            controls = '<select class="filter-select" id="done-range">' +
                '<option value="7">1 Week</option>' +
                '<option value="14">2 Weeks</option>' +
                '<option value="30">1 Month</option>' +
                '<option value="all">View All</option>' +
            '</select>';
        }
        return '<div class="section-heading"><div><h2>' + title + '</h2><p>' + note + '</p></div>' + controls + '</div>' +
            '<div class="task-list">' + items.map(taskCard).join('') + '</div>';
    }

    function filterDone(assignments, days) {
        if (days === 'all') return assignments;
        var cutoff = Date.now() - Number(days) * 86400000;
        return assignments.filter(function(item) {
            var completed = new Date(item.completed_at || item.updated_at || 0).getTime();
            return completed >= cutoff;
        });
    }

    function renderAssignments(doneDays) {
        if (state.session.mode === 'visitor') {
            assignmentContent.innerHTML =
                '<div class="empty-card"><strong>No visitor assignments</strong>Log in to receive assignments, submit work, and save progress.</div>';
            return;
        }

        var assignments = state.assignments || [];
        var todo = assignments.filter(function(item) { return item.status === 'not_done'; });
        var failed = assignments.filter(function(item) { return item.status === 'failed'; });
        var allDone = assignments.filter(function(item) { return item.status === 'done'; });
        var done = filterDone(allDone, doneDays || '7');

        var html = renderSummary(assignments);
        html += renderAssignmentGroup('To Do', 'Start with the work still waiting for you.', todo);
        html += renderAssignmentGroup('Failed', 'These attempts are saved. Try again when you are ready.', failed);
        html += renderAssignmentGroup('Done', 'Completed work stays in your full history.', done, { doneFilter: true });
        if (!assignments.length) {
            html += '<div class="empty-card"><strong>No assignments yet</strong>Your teacher has not assigned any work to this account.</div>';
        } else if (!done.length && allDone.length) {
            html += '<div class="empty-card">No completed assignments in this time range.</div>';
        }
        assignmentContent.innerHTML = html;

        var select = document.getElementById('done-range');
        if (select) {
            select.value = doneDays || '7';
            select.addEventListener('change', function() {
                renderAssignments(select.value);
            });
        }
    }

    function resourceCard(item) {
        return '<article class="resource-card">' +
            '<div>' +
                '<span class="badge neutral">' + escapeHtml(item.course || item.sectionTitle || item.type || 'Resource') + '</span>' +
                '<h3>' + escapeHtml(item.title || item.set_id || item.id) + '</h3>' +
                '<div class="card-meta">' +
                    (item.difficulty ? '<span>' + escapeHtml(item.difficulty) + '</span>' : '') +
                    (item.estimated_minutes ? '<span>' + escapeHtml(item.estimated_minutes) + ' min</span>' : '') +
                    (item.displayValue ? '<span>' + escapeHtml(item.displayValue) + '</span>' : '') +
                '</div>' +
            '</div>' +
            '<a class="card-button" href="' + escapeHtml(practiceHref(item, null)) + '">Open</a>' +
        '</article>';
    }

    function renderResources(query) {
        var normalized = String(query || '').trim().toLowerCase();
        var items = state.resources.filter(function(item) {
            if (!normalized) return true;
            return [
                item.title, item.set_id, item.id, item.course, item.type, item.sectionTitle, item.topic
            ].join(' ').toLowerCase().indexOf(normalized) !== -1;
        });
        resourceList.innerHTML = items.length
            ? items.map(resourceCard).join('')
            : '<div class="empty-card"><strong>No matching resources</strong>Try a different title, course or type.</div>';
    }

    function renderProfile() {
        if (state.session.mode === 'visitor') {
            profileContent.innerHTML =
                '<div class="profile-card"><h2>Visitor Mode</h2><p class="muted">You can browse resources, but answers and submissions are locked.</p>' +
                '<div class="profile-actions"><button class="primary-button" id="profile-login">Log In</button></div></div>';
            document.getElementById('profile-login').addEventListener('click', function() {
                window.location.href = 'index.html';
            });
            return;
        }

        var profile = state.session.profile || {};
        var voluntary = (profile.stats && profile.stats.voluntary_attempts) || 0;
        profileContent.innerHTML =
            '<div class="profile-grid">' +
                '<section class="profile-card">' +
                    '<h2>' + escapeHtml(profile.name || profile.student_id) + '</h2>' +
                    '<div class="profile-row"><span>Student ID</span><strong>' + escapeHtml(profile.student_id) + '</strong></div>' +
                    '<div class="profile-row"><span>Class</span><strong>' + escapeHtml(profile.class_group || 'Not set') + '</strong></div>' +
                    '<div class="profile-row"><span>Independent practice</span><strong>' + voluntary + '</strong></div>' +
                '</section>' +
                '<section class="profile-card">' +
                    '<h2>Account</h2>' +
                    (profile.must_change_password ? '<p class="badge failed">Password change required</p>' : '<p class="muted">Your account is active.</p>') +
                    '<div class="profile-actions">' +
                        '<button class="outline-button" id="change-password" type="button">Change Password</button>' +
                        '<button class="danger-button" id="logout-button" type="button">Log Out</button>' +
                    '</div>' +
                '</section>' +
            '</div>';
        document.getElementById('logout-button').addEventListener('click', window.MrCatAuth.logout);
        document.getElementById('change-password').addEventListener('click', function() {
            alert('Password change will be enabled when the changePassword cloud function is deployed.');
        });
    }

    function loadPublicCatalog() {
        return fetch('data/home-catalog.json?_=' + Date.now())
            .then(function(response) {
                if (!response.ok) throw new Error('Catalog unavailable');
                return response.json();
            })
            .then(function(catalog) {
                var sections = {};
                (catalog.sections || []).forEach(function(section) {
                    sections[section.id] = section.title;
                });
                return (catalog.items || []).filter(function(item) {
                    return item.visible !== false;
                }).map(function(item) {
                    return Object.assign({}, item, {
                        set_id: item.id,
                        link: item.href,
                        sectionTitle: sections[item.sectionId] || ''
                    });
                });
            });
    }

    function loadStudentData() {
        return Promise.all([
            window.MrCatCloud.callFunction('getDashboard').catch(function() {
                return { success: false, assignments: [] };
            }),
            window.MrCatCloud.callFunction('getResources').catch(function() {
                return { success: false, resources: [] };
            })
        ]).then(function(results) {
            state.assignments = results[0] && results[0].assignments || [];
            state.resources = results[1] && results[1].resources || [];
            if (!state.resources.length) return loadPublicCatalog().then(function(items) { state.resources = items; });
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

    document.querySelectorAll('.tab-button').forEach(function(button) {
        button.addEventListener('click', function() {
            activateView(button.dataset.view);
        });
    });
    resourceSearch.addEventListener('input', function() {
        renderResources(resourceSearch.value);
    });

    window.MrCatAuth.getSession()
        .then(function(session) {
            if (session.mode === 'none') {
                window.location.replace('index.html');
                return null;
            }
            if (session.mode === 'teacher') {
                window.location.replace('teacher.html');
                return null;
            }
            state.session = session;
            if (session.mode === 'visitor') {
                identityChip.textContent = 'Visitor';
                greeting.textContent = 'Hello, Visitor.';
                heroCopy.textContent = 'Browse freely. Log in when you are ready to answer and save progress.';
                return loadPublicCatalog().then(function(items) {
                    state.resources = items;
                });
            }

            identityChip.textContent = session.profile.student_id;
            greeting.textContent = 'Hi, ' + (session.profile.name || session.profile.student_id) + '.';
            heroCopy.textContent = 'You have a clear view of what is waiting, what needs another try, and what is done.';
            return loadStudentData();
        })
        .then(function() {
            if (!state.session) return;
            renderAssignments('7');
            renderResources('');
            renderProfile();
        })
        .catch(function(error) {
            assignmentContent.innerHTML = '<div class="empty-card"><strong>Unable to load the dashboard</strong>' + escapeHtml(error.message || 'Please sign in again.') + '</div>';
        });
})();
