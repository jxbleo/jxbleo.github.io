(function() {
    'use strict';

    var state = {
        session: null,
        assignments: [],
        resources: [],
        assignmentFilter: 'all',
        starsRange: '7'
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

    function randomItem(items) {
        return items[Math.floor(Math.random() * items.length)];
    }

    function englishName(profile) {
        var fullName = String((profile && (profile.name || profile.student_id)) || '').trim();
        var englishParts = fullName.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g);
        return englishParts && englishParts.length
            ? englishParts[englishParts.length - 1]
            : fullName;
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

    function statusLabel(status) {
        if (status === 'done') return 'STAR';
        if (status === 'failed') return 'RE-DO';
        return 'TO-DO';
    }

    function practiceHref(item, assignmentId) {
        var href = item.link || item.href || '#';
        var params = ['app=' + encodeURIComponent(window.MRCAT_CONFIG.appVersion || '1')];
        if (assignmentId) params.push('assignment=' + encodeURIComponent(assignmentId));
        if (state.session && state.session.mode === 'visitor') params.push('visitor=1');
        return href + (href.indexOf('?') === -1 ? '?' : '&') + params.join('&');
    }

    function renderAssignmentFilters(assignments) {
        var counts = { not_done: 0, failed: 0, done: 0 };
        assignments.forEach(function(item) {
            counts[item.status] = (counts[item.status] || 0) + 1;
        });
        return '<div class="summary-grid assignment-filters" role="tablist" aria-label="Assignment status">' +
            '<button class="summary-card assignment-filter' + (state.assignmentFilter === 'todo' || state.assignmentFilter === 'all' ? ' active' : '') + '" type="button" data-assignment-filter="todo">' +
                '<span class="summary-value">' + counts.not_done + '</span><span class="summary-label">TO-DO</span></button>' +
            '<button class="summary-card assignment-filter' + (state.assignmentFilter === 'redo' || state.assignmentFilter === 'all' ? ' active' : '') + '" type="button" data-assignment-filter="redo">' +
                '<span class="summary-value">' + counts.failed + '</span><span class="summary-label">RE-DO</span></button>' +
            '<button class="summary-card assignment-filter' + (state.assignmentFilter === 'stars' ? ' active' : '') + '" type="button" data-assignment-filter="stars">' +
                '<span class="summary-value">' + counts.done + '</span><span class="summary-label">STARS</span></button>' +
        '</div>';
    }

    function taskCard(item) {
        var set = item.set || item;
        var status = item.status || 'not_done';
        var action = status === 'not_done' ? 'Start' : 'Try Again';
        var badgeClass = status === 'not_done' ? 'todo' : status;
        var score = item.latest_percentage == null ? '' : '<span>Latest ' + escapeHtml(item.latest_percentage) + '%</span>';
        var href = practiceHref(set, item.assignment_id);
        if (status !== 'not_done') href += '&retry=1';
        return '<article class="task-card">' +
            '<div>' +
                '<span class="badge ' + escapeHtml(badgeClass) + '">' + statusLabel(status) + '</span>' +
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

    function starsControls() {
        return '<div class="assignment-list-tools">' +
            '<select class="filter-select" id="stars-range" aria-label="Completed assignment date range">' +
                '<option value="7">1 Week</option>' +
                '<option value="30">1 Month</option>' +
                '<option value="all">All</option>' +
            '</select></div>';
    }

    function filterDone(assignments, days) {
        if (days === 'all') return assignments;
        var cutoff = Date.now() - Number(days) * 86400000;
        return assignments.filter(function(item) {
            var completed = new Date(item.completed_at || item.updated_at || 0).getTime();
            return completed >= cutoff;
        });
    }

    function assignmentTime(item) {
        return new Date(item.assigned_at || item.updated_at || 0).getTime();
    }

    function newestFirst(left, right) {
        return assignmentTime(right) - assignmentTime(left);
    }

    function renderAssignments() {
        if (state.session.mode === 'visitor') {
            assignmentContent.innerHTML =
                '<div class="empty-card"><strong>No visitor assignments</strong>Log in to receive assignments, submit work, and save progress.</div>';
            return;
        }

        var assignments = state.assignments || [];
        var todo = assignments.filter(function(item) { return item.status === 'not_done'; }).sort(newestFirst);
        var redo = assignments.filter(function(item) { return item.status === 'failed'; }).sort(newestFirst);
        var allStars = assignments.filter(function(item) { return item.status === 'done'; }).sort(function(left, right) {
            return new Date(right.completed_at || right.updated_at || 0).getTime() -
                new Date(left.completed_at || left.updated_at || 0).getTime();
        });
        var visible = [];
        if (state.assignmentFilter === 'todo') visible = todo;
        else if (state.assignmentFilter === 'redo') visible = redo;
        else if (state.assignmentFilter === 'stars') visible = filterDone(allStars, state.starsRange);
        else visible = redo.concat(todo);

        var html = renderAssignmentFilters(assignments);
        if (state.assignmentFilter === 'stars') html += starsControls();
        if (visible.length) html += '<div class="task-list">' + visible.map(taskCard).join('') + '</div>';
        if (!assignments.length) {
            html += '<div class="empty-card"><strong>No assignments yet</strong>Your teacher has not assigned any work to this account.</div>';
        } else if (!visible.length) {
            var emptyLabel = state.assignmentFilter === 'stars'
                ? 'No stars in this time range.'
                : state.assignmentFilter === 'redo'
                    ? 'No work needs another try.'
                    : state.assignmentFilter === 'todo'
                        ? 'No new work is waiting.'
                        : 'Nothing is waiting right now.';
            html += '<div class="empty-card">' + emptyLabel + '</div>';
        }
        assignmentContent.innerHTML = html;

        document.querySelectorAll('[data-assignment-filter]').forEach(function(button) {
            button.addEventListener('click', function() {
                var nextFilter = button.dataset.assignmentFilter;
                state.assignmentFilter = state.assignmentFilter === nextFilter ? 'all' : nextFilter;
                renderAssignments();
            });
        });

        var select = document.getElementById('stars-range');
        if (select) {
            select.value = state.starsRange;
            select.addEventListener('change', function() {
                state.starsRange = select.value;
                renderAssignments();
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
                greeting.textContent = 'Welcome, Visitor.';
                heroCopy.textContent = randomItem(motivationalQuotes);
                return loadPublicCatalog().then(function(items) {
                    state.resources = items;
                });
            }

            var preferredName = englishName(session.profile);
            identityChip.textContent = preferredName;
            greeting.textContent = greetingFor(preferredName);
            heroCopy.textContent = randomItem(motivationalQuotes);
            return loadStudentData();
        })
        .then(function() {
            if (!state.session) return;
            renderAssignments();
            renderResources('');
            renderProfile();
        })
        .catch(function(error) {
            assignmentContent.innerHTML = '<div class="empty-card"><strong>Unable to load the dashboard</strong>' + escapeHtml(error.message || 'Please sign in again.') + '</div>';
        });
})();
