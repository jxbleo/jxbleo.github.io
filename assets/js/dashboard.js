(function() {
    'use strict';

    var state = {
        session: null,
        assignments: [],
        resources: [],
        assignmentFilter: 'todo',
        resourceFilter: 'vocabulary',
        resourceBookFilters: {},
        starCount: 0,
        assignmentStarCount: 0,
        selfStudyStarCount: 0,
        teacherReplies: [],
        vocabItems: [],
        vocabSearch: ''
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
    var starCounter = document.getElementById('star-counter');
    var selfStudyStarCounter = document.getElementById('self-study-star-counter');
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

    function appIconConfig(system) {
        var normalized = String(system || '').trim().toUpperCase();
        if (normalized === 'IELTS') {
            return {
                apple: 'assets/icons/ielts-apple-touch-icon.png',
                manifest: 'site-ielts.webmanifest'
            };
        }
        return {
            apple: 'assets/icons/dse-apple-touch-icon.png',
            manifest: 'site-dse.webmanifest'
        };
    }

    function ensureHeadLink(selector, rel) {
        var link = document.querySelector(selector);
        if (!link) {
            link = document.createElement('link');
            link.rel = rel;
            document.head.appendChild(link);
        }
        return link;
    }

    function updateAppIconForSystem(system) {
        var config = appIconConfig(system);
        var apple = ensureHeadLink('link[rel="apple-touch-icon"]', 'apple-touch-icon');
        apple.setAttribute('sizes', '180x180');
        apple.setAttribute('href', config.apple);
        var manifest = ensureHeadLink('link[rel="manifest"]', 'manifest');
        manifest.setAttribute('href', config.manifest);
    }

    function formatDate(value) {
        if (!value) return 'Due next class';
        var date = value instanceof Date ? value : new Date(value);
        if (isNaN(date.getTime())) return 'Due next class';
        return 'Due ' + new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            month: 'short',
            day: 'numeric'
        }).format(date);
    }

    function formatShortDate(value) {
        if (!value) return '';
        var date = value instanceof Date ? value : new Date(value);
        if (isNaN(date.getTime())) return '';
        return new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            month: 'short',
            day: 'numeric'
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
        if (status === 'mastered') return 'MASTERED';
        if (status === 'passed') return 'PASSED';
        return 'TO-DO';
    }

    function normalizedStatus(status) {
        if (status === 'done') return 'mastered';
        if (status === 'failed' || status === 'not_done') return 'to_do';
        return status || 'to_do';
    }

    function isFinishedStatus(status) {
        var normalized = normalizedStatus(status);
        return normalized === 'passed' || normalized === 'mastered';
    }

    function assignmentBucket(status) {
        return isFinishedStatus(status) ? 'finished' : 'todo';
    }

    function teacherReplyCount(item) {
        if (!item) return 0;
        if (item.teacher_reply_count != null) return Number(item.teacher_reply_count || 0);
        return Array.isArray(item.teacher_replies) ? item.teacher_replies.length : 0;
    }

    function replyKeyForItem(item) {
        var set = item && (item.set || item) || {};
        return String(item && (item.assignment_id || item.achievement_id) || set.set_id || set.id || '');
    }

    function replyIds(replies) {
        return (replies || []).map(function(reply) { return reply.dispute_id; }).filter(Boolean);
    }

    function appendQueryParam(href, key, value) {
        if (!href || href === '#' || value == null || value === '') return href || '#';
        return href + (href.indexOf('?') === -1 ? '?' : '&') + encodeURIComponent(key) + '=' + encodeURIComponent(value);
    }

    function practiceHref(item, assignmentId) {
        var href = item.link || item.href || '#';
        var params = ['app=' + encodeURIComponent(window.MRCAT_CONFIG.appVersion || '1')];
        if (assignmentId) params.push('assignment=' + encodeURIComponent(assignmentId));
        if (item.status) params.push('status=' + encodeURIComponent(normalizedStatus(item.status)));
        if (item.prefill_attempt_id) params.push('prefill=' + encodeURIComponent(item.prefill_attempt_id));
        if (item.history_attempt_id) params.push('history=' + encodeURIComponent(item.history_attempt_id));
        if (item.best_percentage != null) params.push('history_score=' + encodeURIComponent(item.best_percentage));
        if (state.session && state.session.mode === 'visitor') params.push('visitor=1');
        return href + (href.indexOf('?') === -1 ? '?' : '&') + params.join('&');
    }

    function defaultPracticeLink(setId) {
        var id = String(setId || '');
        if (/^BBC-/i.test(id)) return 'bbc.html?set=' + encodeURIComponent(id);
        if (/^C\d+-T\d+-S\d+/i.test(id)) return 'ielts-listening.html?set=' + encodeURIComponent(id);
        if (/^C\d+-T\d+-P\d+/i.test(id)) return 'ielts-reading.html?set=' + encodeURIComponent(id);
        if (id) return 'vocabulary.html?set=' + encodeURIComponent(id);
        return '#';
    }

    function assignmentForReply(reply) {
        var assignments = state.assignments || [];
        return assignments.find(function(item) {
            return (reply.assignment_id && String(item.assignment_id || '') === String(reply.assignment_id)) ||
                (reply.set_id && String((item.set && (item.set.set_id || item.set.id)) || item.set_id || item.id || '') === String(reply.set_id));
        }) || null;
    }

    function hrefForTeacherReply(reply) {
        var assignment = assignmentForReply(reply);
        var set = assignment && assignment.set || {
            set_id: reply.set_id,
            id: reply.set_id,
            title: reply.set_title,
            link: reply.link || reply.href || defaultPracticeLink(reply.set_id)
        };
        if (set && !set.link && !set.href) set = Object.assign({}, set, { link: defaultPracticeLink(set.set_id || set.id || reply.set_id) });
        var href = practiceHref(Object.assign({}, set, {
            status: assignment && assignment.status,
            history_attempt_id: reply.attempt_id || assignment && assignment.history_attempt_id,
            best_percentage: assignment && assignment.best_percentage
        }), reply.assignment_id || assignment && assignment.assignment_id);
        return appendQueryParam(href, 'focus', reply.question_id);
    }

    function replyQuestionLabel(questionId) {
        var text = String(questionId || 'Question').trim();
        var match = text.match(/(\d+)\s*$/);
        if (match) return 'Q' + String(Number(match[1]));
        if (/^q/i.test(text)) return text.toUpperCase();
        return text;
    }

    function replyStatusLabel(reply) {
        return reply.status === 'approved' ? 'Approved' : reply.status === 'rejected' ? 'Rejected' : 'Pending';
    }

    function answerText(value, fallback) {
        if (Array.isArray(value)) return value.join(' / ');
        if (value == null || value === '') return fallback || '';
        return String(value);
    }

    function renderAssignmentFilters(assignments) {
        var counts = { todo: 0, finished: 0 };
        var replies = { todo: 0, finished: 0 };
        assignments.forEach(function(item) {
            var bucket = assignmentBucket(item.status);
            counts[bucket] = (counts[bucket] || 0) + 1;
            replies[bucket] += teacherReplyCount(item);
        });
        var todoNotice = replies.todo
            ? '<span class="reply-count-badge filter-reply-count">' + replies.todo + '</span>'
            : '';
        var finishedNotice = replies.finished
            ? '<span class="reply-count-badge filter-reply-count">' + replies.finished + '</span>'
            : '';
        return '<div class="summary-grid assignment-filters" role="tablist" aria-label="Assignment status">' +
            '<button class="summary-card assignment-filter' + (state.assignmentFilter === 'todo' || state.assignmentFilter === 'all' ? ' active' : '') + '" type="button" data-assignment-filter="todo">' +
                todoNotice + '<span class="summary-value">' + counts.todo + '</span><span class="summary-label">TO DO</span></button>' +
            '<button class="summary-card assignment-filter' + (state.assignmentFilter === 'finished' ? ' active' : '') + '" type="button" data-assignment-filter="finished">' +
                finishedNotice + '<span class="summary-value">' + counts.finished + '</span><span class="summary-label">FINISHED</span></button>' +
        '</div>';
    }

    function isStarCollected(item) {
        return item.star_claimed === true;
    }

    function updateStarCounter(animate) {
        if (selfStudyStarCounter) {
            selfStudyStarCounter.textContent = '★ ' + state.selfStudyStarCount;
            selfStudyStarCounter.classList.toggle('pop', animate === true);
            if (animate) window.setTimeout(function() { selfStudyStarCounter.classList.remove('pop'); }, 700);
        }
        if (starCounter) {
            starCounter.textContent = '★ ' + state.assignmentStarCount;
            starCounter.classList.toggle('pop', animate === true);
            if (animate) window.setTimeout(function() { starCounter.classList.remove('pop'); }, 700);
        }
    }

    function playStarSound() {
        var AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) return;
        try {
            var context = new AudioContext();
            var gain = context.createGain();
            gain.connect(context.destination);
            gain.gain.setValueAtTime(0.0001, context.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.16, context.currentTime + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.34);

            [660, 880, 1175].forEach(function(frequency, index) {
                var oscillator = context.createOscillator();
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(frequency, context.currentTime + index * 0.055);
                oscillator.connect(gain);
                oscillator.start(context.currentTime + index * 0.055);
                oscillator.stop(context.currentTime + 0.32 + index * 0.03);
            });

            window.setTimeout(function() { context.close().catch(function() {}); }, 520);
        } catch (error) {
            // Audio feedback is decorative; never block star collection.
        }
    }

    function animateStarToCounter(sourceElement) {
        if (!sourceElement || !starCounter) {
            updateStarCounter(true);
            return;
        }
        var sourceRect = sourceElement.getBoundingClientRect();
        var targetRect = starCounter.getBoundingClientRect();
        var startX = sourceRect.left + sourceRect.width / 2;
        var startY = sourceRect.top + sourceRect.height / 2;
        var endX = targetRect.left + targetRect.width / 2;
        var endY = targetRect.top + targetRect.height / 2;
        var flyer = document.createElement('div');
        flyer.className = 'star-flyer';
        flyer.textContent = '★';
        flyer.style.left = startX + 'px';
        flyer.style.top = startY + 'px';
        flyer.style.setProperty('--star-dx', (endX - startX) + 'px');
        flyer.style.setProperty('--star-dy', (endY - startY) + 'px');
        document.body.appendChild(flyer);
        window.setTimeout(function() { updateStarCounter(true); }, 520);
        window.setTimeout(function() { flyer.remove(); }, 950);
    }

    function scorePill(item, status) {
        if (status === 'to_do') {
            if (item.best_correct_count != null && item.best_question_count != null) {
                return 'Only ' + item.best_correct_count + '/' + item.best_question_count;
            }
            return 'No attempts';
        }
        var value = item.best_percentage == null ? item.latest_percentage : item.best_percentage;
        if (value == null) return 'FINISHED';
        return 'Accuracy ' + value + '%';
    }

    function percentValue(value, fallback) {
        var number = Number(value);
        if (!isFinite(number)) number = Number(fallback || 0);
        return Math.max(0, Math.min(100, number));
    }

    function scoreValue(item) {
        var value = item.best_percentage == null ? item.latest_percentage : item.best_percentage;
        return percentValue(value, 0);
    }

    function compactAssignmentTitle(title) {
        return String(title || 'Practice')
            .replace(/^\s*BBC\s+6\s+Minute\s+English\s*[:|-]\s*/i, '')
            .replace(/^\s*BBC\s+Six\s+Minute\s+English\s*[:|-]\s*/i, '')
            .replace(/^\s*IELTS\s+Reading\s*[:|-]\s*/i, '')
            .replace(/^\s*IELTS\s+Listening\s*[:|-]\s*/i, '')
            .replace(/^\s*Vocabulary\s*[:|-]\s*/i, '')
            .trim() || String(title || 'Practice');
    }

    function todoAssignments() {
        return (state.assignments || [])
            .filter(function(item) { return normalizedStatus(item.status) === 'to_do'; })
            .sort(newestFirst);
    }

    function finishedTaskCard(item, set, status, href, replyCount, replyKey, collected) {
        var score = scoreValue(item);
        var pass = percentValue(item.passing_percentage, 50);
        var mastery = percentValue(item.mastery_percentage, 90);
        var stateClass = status === 'mastered' ? 'mastered' : 'passed';
        var replyButton = replyCount
            ? '<button class="card-button reply-button" type="button" data-teacher-replies-key="' + escapeHtml(replyKey) + '">' +
                'Teacher replies <span class="reply-count-badge">' + escapeHtml(replyCount) + '</span></button>'
            : '';
        return '<article class="task-card finished-task-card ' + escapeHtml(stateClass) + (replyCount ? ' has-teacher-replies' : '') + '" role="link" tabindex="0" data-open-href="' + escapeHtml(href) + '" data-assignment-id="' + escapeHtml(item.assignment_id || '') + '" data-reply-key="' + escapeHtml(replyKey) + '" style="--score: ' + score + '%; --pass: ' + pass + '%; --mastery: ' + mastery + '%;">' +
            '<div class="finished-task-main">' +
                '<h3 class="assignment-title finished-title">' + escapeHtml(compactAssignmentTitle(set.title || set.set_id || set.id || 'Practice')) + '</h3>' +
                '<div class="finished-progress-wrap" aria-hidden="true">' +
                    '<span class="finished-marker pass"><span class="finished-pennant"></span></span>' +
                    '<span class="finished-marker mastery"><span class="finished-star">★</span></span>' +
                    '<span class="finished-progress"><span class="finished-progress-fill"></span></span>' +
                '</div>' +
            '</div>' +
            '<div class="finished-score-rail"><span class="finished-score">' + score + '%</span></div>' +
            (status === 'mastered' && !collected
                ? '<button class="card-button star-button" type="button" data-get-star="' + escapeHtml(item.assignment_id || '') + '">Get Star</button>'
                : '') +
            replyButton +
        '</article>';
    }

    function passwordValidationMessage(password) {
        if (password.length < 6) return 'Password must be at least 6 characters.';
        if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
            return 'Use uppercase and lowercase letters, a number, and a symbol. A short example is Aa_888.';
        }
        if (/^(.)\1+$/.test(password)) return 'Please avoid passwords made from one repeated character.';
        return '';
    }

    function openChangePasswordDialog() {
        var existing = document.querySelector('.password-dialog-overlay');
        if (existing) existing.remove();

        var overlay = document.createElement('div');
        overlay.className = 'password-dialog-overlay';
        overlay.innerHTML =
            '<div class="password-dialog" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title">' +
                '<button class="dialog-close-button" type="button" aria-label="Close password dialog">×</button>' +
                '<p class="eyebrow accent">Account</p>' +
                '<h2 id="password-dialog-title">Change Password</h2>' +
                '<form class="password-form" id="password-form">' +
                    '<label for="new-password">New password</label>' +
                    '<input id="new-password" name="new-password" type="password" autocomplete="new-password" required>' +
                    '<label for="confirm-password">Confirm password</label>' +
                    '<input id="confirm-password" name="confirm-password" type="password" autocomplete="new-password" required>' +
                    '<p class="password-hint">Minimum 6 characters with uppercase, lowercase, number, and symbol. Avoid repeated digits like 88888888.</p>' +
                    '<p class="password-message" id="password-message" aria-live="polite"></p>' +
                    '<div class="dialog-actions">' +
                        '<button class="outline-button" type="button" data-dialog-cancel>Cancel</button>' +
                        '<button class="primary-button" type="submit">Save Password</button>' +
                    '</div>' +
                '</form>' +
            '</div>';
        document.body.appendChild(overlay);

        var form = overlay.querySelector('#password-form');
        var passwordInput = overlay.querySelector('#new-password');
        var confirmInput = overlay.querySelector('#confirm-password');
        var message = overlay.querySelector('#password-message');
        var submitButton = form.querySelector('button[type="submit"]');
        var closeButton = overlay.querySelector('.dialog-close-button');
        var cancelButton = overlay.querySelector('[data-dialog-cancel]');

        function close() {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
        }

        function setMessage(text, kind) {
            message.textContent = text || '';
            message.classList.toggle('success', kind === 'success');
            message.classList.toggle('error', kind === 'error');
        }

        function onKeydown(event) {
            if (event.key === 'Escape') close();
        }

        overlay.addEventListener('click', function(event) {
            if (event.target === overlay) close();
        });
        closeButton.addEventListener('click', close);
        cancelButton.addEventListener('click', close);
        document.addEventListener('keydown', onKeydown);

        form.addEventListener('submit', function(event) {
            event.preventDefault();
            var first = passwordInput.value.trim();
            var second = confirmInput.value.trim();
            var validation = passwordValidationMessage(first);
            if (validation) {
                setMessage(validation, 'error');
                passwordInput.focus();
                return;
            }
            if (first !== second) {
                setMessage('The two passwords do not match.', 'error');
                confirmInput.focus();
                return;
            }

            submitButton.disabled = true;
            submitButton.textContent = 'Saving...';
            setMessage('', '');
            window.MrCatCloud.callFunction('changePassword', { new_password: first })
                .then(function(result) {
                    if (!result || !result.success) throw new Error(result && result.message || 'Unable to change password.');
                    state.session.profile.must_change_password = false;
                    setMessage('Password changed.', 'success');
                    window.setTimeout(function() {
                        close();
                        renderProfile();
                    }, 650);
                }).catch(function(error) {
                    submitButton.disabled = false;
                    submitButton.textContent = 'Save Password';
                    setMessage(error.message || 'Unable to change password.', 'error');
                });
        });

        window.setTimeout(function() {
            passwordInput.focus();
        }, 0);
    }

    function taskCard(item) {
        var set = item.set || item;
        var status = normalizedStatus(item.status);
        var finished = isFinishedStatus(status);
        var action = status === 'to_do' ? 'Go' : (status === 'mastered' ? 'Beat Your Best' : 'Improve Accuracy');
        var actionClass = status === 'to_do' ? ' task-go-button' : '';
        var badgeClass = finished ? 'finished' : status;
        var replyCount = teacherReplyCount(item);
        var replyKey = replyKeyForItem(item);
        var href = practiceHref(Object.assign({}, set, {
            prefill_attempt_id: item.prefill_attempt_id,
            history_attempt_id: item.history_attempt_id,
            best_percentage: item.best_percentage
        }), item.assignment_id);
        var collected = isStarCollected(item);
        var sourcePill = item.source === 'self_study'
            ? '<span class="assignment-pill source self-study">SELF STUDY</span>'
            : '';
        var milestonePill = finished
            ? '<span class="assignment-pill milestone ' + escapeHtml(status) + '">' + escapeHtml(statusLabel(status)) + '</span>'
            : '';
        var replyButton = replyCount
            ? '<button class="card-button reply-button" type="button" data-teacher-replies-key="' + escapeHtml(replyKey) + '">' +
                'Teacher replies <span class="reply-count-badge">' + escapeHtml(replyCount) + '</span></button>'
            : '';
        if (finished) return finishedTaskCard(item, set, status, href, replyCount, replyKey, collected);
        return '<article class="task-card' + (replyCount ? ' has-teacher-replies' : '') + '" data-assignment-id="' + escapeHtml(item.assignment_id || '') + '" data-reply-key="' + escapeHtml(replyKey) + '">' +
            '<div>' +
                '<h3 class="assignment-title">' + escapeHtml(set.title || set.set_id || set.id || 'Practice') + '</h3>' +
                '<div class="assignment-pills">' +
                    sourcePill +
                    '<span class="assignment-pill set-id">' + escapeHtml(set.set_id || set.id || set.title) + '</span>' +
                    milestonePill +
                    (status === 'to_do' ? '' : '<span class="assignment-pill status ' + escapeHtml(badgeClass) + '">' + escapeHtml(scorePill(item, status)) + '</span>') +
                '</div>' +
            '</div>' +
            (status === 'mastered' && !collected
                ? '<button class="card-button star-button" type="button" data-get-star="' + escapeHtml(item.assignment_id || '') + '">Get Star</button>'
                : '') +
            replyButton +
            '<a class="card-button' + actionClass + '" href="' + escapeHtml(href) + '">' + action + '</a>' +
        '</article>';
    }

    function assignmentTime(item) {
        return new Date(item.assigned_at || item.updated_at || 0).getTime();
    }

    function newestFirst(left, right) {
        return assignmentTime(right) - assignmentTime(left);
    }

    function teacherReplyTotal() {
        return (state.teacherReplies || []).length;
    }

    function updateDashboardTabNotices() {
        var todoCount = todoAssignments().length;
        var replyCount = teacherReplyTotal();
        var count = todoCount || replyCount;
        var button = document.querySelector('.tab-button[data-view="assignments"]');
        if (!button) return;
        var existing = button.querySelector('.notice-dot');
        if (existing) existing.remove();
        if (!count) return;
        var dot = document.createElement('span');
        dot.className = 'notice-dot' + (todoCount ? ' todo' : '');
        dot.textContent = count > 9 ? '9+' : String(count);
        button.appendChild(dot);
    }

    function clearTeacherReplies(seenIds) {
        var idSet = new Set(seenIds || []);
        if (!idSet.size) return;
        state.teacherReplies = (state.teacherReplies || []).filter(function(reply) {
            return !idSet.has(reply.dispute_id);
        });
        (state.assignments || []).forEach(function(item) {
            if (!Array.isArray(item.teacher_replies)) return;
            item.teacher_replies = item.teacher_replies.filter(function(reply) {
                return !idSet.has(reply.dispute_id);
            });
            item.teacher_reply_count = item.teacher_replies.length;
        });
        updateDashboardTabNotices();
    }

    function replyStatusClass(reply) {
        if (reply.status === 'approved') return 'approved';
        if (reply.status === 'rejected') return 'rejected';
        return 'pending';
    }

    function renderTeacherRepliesPrompt() {
        var replies = state.teacherReplies || [];
        if (!replies.length) return '';
        return '<section class="teacher-replies-card">' +
            '<div>' +
                '<span class="teacher-replies-tag">Teacher Replies</span>' +
                '<h3>Your teacher replied to ' + replies.length + ' question' + (replies.length === 1 ? '' : 's') + '.</h3>' +
            '</div>' +
            '<button class="primary-button" id="open-teacher-replies" type="button">View replies</button>' +
        '</section>';
    }

    function openTeacherRepliesDialog(replyItems) {
        var replies = Array.isArray(replyItems) ? replyItems : (state.teacherReplies || []);
        if (!replies.length) return;
        var overlay = document.createElement('div');
        overlay.className = 'teacher-replies-overlay';
        overlay.innerHTML =
            '<div class="teacher-replies-dialog" role="dialog" aria-modal="true" aria-labelledby="teacher-replies-title">' +
                '<button class="dialog-close-button" type="button" aria-label="Close teacher replies">×</button>' +
                '<div class="teacher-replies-dialog-head">' +
                    '<h2 id="teacher-replies-title">' + replies.length + ' repl' + (replies.length === 1 ? 'y is' : 'ies are') + ' ready.</h2>' +
                '</div>' +
                '<div class="teacher-replies-list">' + replies.map(function(reply) {
                    var statusClass = replyStatusClass(reply);
                    var statusLabel = replyStatusLabel(reply);
                    var statusIcon = statusClass === 'approved' ? '&#10003;' : statusClass === 'rejected' ? '&times;' : '!';
                    var title = reply.set_title || reply.set_id || 'Practice';
                    var before = answerText(reply.answer_snapshot, 'Not shown');
                    var yours = answerText(reply.submitted_answer, 'Not shown');
                    var href = hrefForTeacherReply(reply);
                    return '<article class="teacher-reply-item ' + escapeHtml(statusClass) + '">' +
                        '<div class="teacher-reply-head">' +
                            '<div class="teacher-reply-question">' +
                                '<strong>' + escapeHtml(replyQuestionLabel(reply.question_id)) + '</strong>' +
                                '<small>' + escapeHtml(title) + '</small>' +
                            '</div>' +
                            '<span class="teacher-reply-status ' + escapeHtml(statusClass) + '"><span>' + statusIcon + '</span>' + escapeHtml(statusLabel) + '</span>' +
                        '</div>' +
                        '<div class="teacher-reply-flow">' +
                            '<div class="teacher-reply-answer"><b>Before</b><span>' + escapeHtml(before) + '</span></div>' +
                            '<div class="teacher-reply-arrow" aria-hidden="true">&rarr;</div>' +
                            '<div class="teacher-reply-answer yours"><b>Yours</b><span>' + escapeHtml(yours) + '</span></div>' +
                        '</div>' +
                        (statusClass === 'rejected' && reply.teacher_note ? '<div class="teacher-reply-note"><b>Teacher note</b><span>' + escapeHtml(reply.teacher_note) + '</span></div>' : '') +
                        '<div class="teacher-reply-actions"><a class="teacher-reply-go" href="' + escapeHtml(href) + '">Go to question</a></div>' +
                    '</article>';
                }).join('') + '</div>' +
                '<div class="dialog-actions">' +
                    '<button class="primary-button" id="teacher-replies-done" type="button">Close</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        function close(markSeen) {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
            if (!markSeen) return Promise.resolve();
            var ids = replyIds(replies);
            clearTeacherReplies(ids);
            renderAssignments();
            if (!ids.length || !window.MrCatCloud) return Promise.resolve();
            return window.MrCatCloud.callFunction('getDashboard', {
                action: 'markTeacherRepliesSeen',
                dispute_ids: ids
            }).catch(function() {});
        }

        function onKeydown(event) {
            if (event.key === 'Escape') close(true);
        }

        overlay.addEventListener('click', function(event) {
            if (event.target === overlay) close(true);
        });
        overlay.querySelector('.dialog-close-button').addEventListener('click', function() { close(true); });
        overlay.querySelector('#teacher-replies-done').addEventListener('click', function() { close(true); });
        overlay.querySelectorAll('.teacher-reply-go').forEach(function(link) {
            link.addEventListener('click', function(event) {
                var href = link.getAttribute('href');
                if (!href || href === '#') return;
                event.preventDefault();
                Promise.resolve(close(true)).then(function() {
                    window.location.href = href;
                });
            });
        });
        document.addEventListener('keydown', onKeydown);
    }

    function renderAssignments() {
        if (state.session.mode === 'visitor') {
            assignmentContent.innerHTML =
                '<div class="empty-card"><strong>No visitor assignments</strong>Log in to receive assignments, submit work, and save progress.</div>';
            return;
        }

        var assignments = state.assignments || [];
        var todo = assignments.filter(function(item) { return normalizedStatus(item.status) === 'to_do'; }).sort(newestFirst);
        var finished = assignments.filter(function(item) { return isFinishedStatus(item.status); }).sort(function(left, right) {
            var byReply = teacherReplyCount(right) - teacherReplyCount(left);
            if (byReply) return byReply;
            return new Date(right.mastered_at || right.completed_at || right.updated_at || 0).getTime() -
                new Date(left.mastered_at || left.completed_at || left.updated_at || 0).getTime();
        });
        var visible = [];
        if (state.assignmentFilter === 'todo') visible = todo;
        else if (state.assignmentFilter === 'finished') visible = finished;
        else visible = todo;

        var html = renderTeacherRepliesPrompt() + renderAssignmentFilters(assignments);
        if (visible.length) html += '<div class="task-list">' + visible.map(taskCard).join('') + '</div>';
        if (!assignments.length) {
            html += '<div class="empty-card"><strong>No assignments yet</strong>Your teacher has not assigned any work to this account.</div>';
        } else if (!visible.length) {
            var emptyLabel = state.assignmentFilter === 'finished'
                ? 'No finished work yet.'
                : state.assignmentFilter === 'todo'
                    ? 'No new work is waiting.'
                    : 'Nothing is waiting right now.';
            html += '<div class="empty-card">' + emptyLabel + '</div>';
        }
        assignmentContent.innerHTML = html;
        updateDashboardTabNotices();

        document.querySelectorAll('[data-assignment-filter]').forEach(function(button) {
            button.addEventListener('click', function() {
                var nextFilter = button.dataset.assignmentFilter;
                state.assignmentFilter = state.assignmentFilter === nextFilter ? 'all' : nextFilter;
                renderAssignments();
            });
        });

        var repliesButton = document.getElementById('open-teacher-replies');
        if (repliesButton) repliesButton.addEventListener('click', openTeacherRepliesDialog);

        document.querySelectorAll('[data-teacher-replies-key]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.teacherRepliesKey;
                var item = assignments.find(function(candidate) {
                    return replyKeyForItem(candidate) === key;
                });
                openTeacherRepliesDialog(item && item.teacher_replies || []);
            });
        });

        document.querySelectorAll('[data-open-href]').forEach(function(card) {
            function openCard(event) {
                if (event && event.target && event.target.closest('button, a')) return;
                var href = card.dataset.openHref;
                if (href) window.location.href = href;
            }
            card.addEventListener('click', openCard);
            card.addEventListener('keydown', function(event) {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                openCard(event);
            });
        });

        document.querySelectorAll('[data-get-star]').forEach(function(button) {
            button.addEventListener('click', function() {
                var assignmentId = button.dataset.getStar;
                var item = assignments.find(function(candidate) { return candidate.assignment_id === assignmentId; });
                button.disabled = true;
                button.textContent = 'Collecting...';
                window.MrCatCloud.callFunction('getDashboard', {
                    action: 'claimStar',
                    assignment_id: assignmentId
                }).then(function(result) {
                    if (!result || !result.success) throw new Error(result && result.message || 'Unable to collect star.');
                    if (item) item.star_claimed = true;
                    state.starCount = Number(result.star_count || state.starCount + 1);
                    state.assignmentStarCount = Number(result.assignment_star_count == null ? state.assignmentStarCount + 1 : result.assignment_star_count);
                    state.selfStudyStarCount = Number(result.self_study_star_count == null ? state.selfStudyStarCount : result.self_study_star_count);
                    playStarSound();
                    animateStarToCounter(button);
                    button.classList.add('collected');
                    window.setTimeout(function() { button.remove(); }, 120);
                }).catch(function(error) {
                    button.disabled = false;
                    button.textContent = 'Get Star';
                    alert(error.message || 'Unable to collect star.');
                });
            });
        });
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

    var libraryTabConfig = {
        general: { groupIds: ['basics'], emptyMessage: 'No general practice content yet.' },
        exam: { groupIds: ['ielts', 'dse'], emptyMessage: 'No exam practice content yet.' },
        lessons: { groupIds: ['lessons'], emptyMessage: 'No lessons available yet.' }
    };
    var libraryActiveTab = 'general';
    var libraryCatalog = null;

    function libraryBuildTags(tags, topic) {
        var html = '';
        if (topic) html += '<span class="tag tag-topic">' + escapeHtml(topic) + '</span>';
        if (tags && tags.length) {
            for (var i = 0; i < tags.length; i++) {
                html += '<span class="tag tag-bbc">' + escapeHtml(tags[i]) + '</span>';
            }
        }
        return html;
    }

    function libraryShouldShowNote(item) {
        return item.note && item.note !== 'Listening Practice' && item.note !== 'Passage Practice';
    }

    function librarySortItems(items, section) {
        var sorted = items.slice();
        if (section.sortType === 'date_desc') {
            sorted.sort(function(a, b) { return String(b.sortValue || '').localeCompare(String(a.sortValue || '')); });
        } else if (section.sortType === 'date_asc') {
            sorted.sort(function(a, b) { return String(a.sortValue || '').localeCompare(String(b.sortValue || '')); });
        } else if (section.sortType === 'number_asc') {
            sorted.sort(function(a, b) { return Number(a.sortValue || 0) - Number(b.sortValue || 0); });
        } else if (section.sortType === 'number_desc') {
            sorted.sort(function(a, b) { return Number(b.sortValue || 0) - Number(a.sortValue || 0); });
        }
        return sorted;
    }

    function libraryBuildCard(item, extraClass, itemYear) {
        var href = practiceHref(item, null);
        return '<li class="menu-card' + (extraClass ? ' ' + extraClass : '') + '"' +
            (itemYear ? ' data-year="' + escapeHtml(itemYear) + '"' : '') + '>' +
            '<a class="practice-link" href="' + escapeHtml(href) + '">' +
                '<div class="card-content">' +
                    '<h3 class="card-title">' + escapeHtml(item.title) + '</h3>' +
                    '<div class="meta-row">' +
                        '<div class="card-date">' + escapeHtml(item.displayValue || item.id) + '</div>' +
                        '<div class="tags">' + libraryBuildTags(item.tags, item.topic) + '</div>' +
                    '</div>' +
                    (libraryShouldShowNote(item) ? '<p class="card-note">' + escapeHtml(item.note) + '</p>' : '') +
                '</div>' +
                '<div class="arrow-box">→</div>' +
            '</a>' +
        '</li>';
    }

    function libraryBuildPlaceholderCard(section) {
        return '<li class="menu-card placeholder-card">' +
            '<div class="menu-card-content">' +
                '<div class="card-content">' +
                    '<h3 class="card-title">' + escapeHtml(section.emptyMessage || 'Developing') + '</h3>' +
                    '<p class="card-note">' + escapeHtml(section.emptyNote || '') + '</p>' +
                '</div>' +
                '<div class="arrow-box" style="background-color:transparent;color:var(--text-muted);">⏳</div>' +
            '</div>' +
        '</li>';
    }

    function libraryBuildSection(section, items) {
        var cardsHtml = '';
        var yearTabsHtml = '';
        var activeYear = '';

        if (items.length) {
            var sortedItems = librarySortItems(items, section);

            if (section.yearFilter) {
                var years = {};
                for (var yi = 0; yi < sortedItems.length; yi++) {
                    var y = String(sortedItems[yi].sortValue || '').substring(0, 4);
                    if (y && y.length === 4) years[y] = true;
                }
                var yearList = Object.keys(years).sort();
                if (yearList.length > 1) {
                    activeYear = yearList[0];
                    yearTabsHtml = '<div class="year-tabs" data-section="' + escapeHtml(section.id) + '">' +
                        '<button class="year-tab" data-year="">All</button>';
                    for (var yj = 0; yj < yearList.length; yj++) {
                        yearTabsHtml += '<button class="year-tab' + (yearList[yj] === activeYear ? ' active' : '') + '" data-year="' + yearList[yj] + '">' + yearList[yj] + '</button>';
                    }
                    yearTabsHtml += '</div>';
                }
            }

            for (var i = 0; i < sortedItems.length; i++) {
                var item = sortedItems[i];
                var itemYear = section.yearFilter ? String(item.sortValue || '').substring(0, 4) : '';
                var hidden = activeYear && itemYear !== activeYear;
                cardsHtml += libraryBuildCard(item, hidden ? 'year-hidden' : '', itemYear);
            }
        } else {
            cardsHtml = libraryBuildPlaceholderCard(section);
        }

        return '<div class="section' + (activeYear ? ' year-filter-active' : '') + '" data-section-id="' + escapeHtml(section.id) + '">' +
            '<div class="section-title">' +
                escapeHtml(section.title) +
                '<span class="toggle-btn">Show</span>' +
            '</div>' +
            '<div class="section-body" style="display:none;">' +
                yearTabsHtml +
                '<ul class="menu-list">' + cardsHtml + '</ul>' +
            '</div>' +
        '</div>';
    }

    function libraryLoadTabContent(tabId) {
        tabId = tabId || libraryActiveTab;
        var root = document.getElementById('student-library-sections');
        if (!root) return;

        if (!libraryCatalog || !libraryCatalog.sections) {
            root.innerHTML = '<p class="section-description">Unable to load the library catalog.</p>';
            return;
        }

        var config = libraryTabConfig[tabId];
        if (!config) {
            root.innerHTML = '<p class="section-description">Unknown tab.</p>';
            return;
        }

        var itemsBySection = {};
        var visibleItems = (state.resources || []).filter(function(item) {
            return item.visible !== false;
        });
        for (var i = 0; i < visibleItems.length; i++) {
            var item = visibleItems[i];
            var sid = item.sectionId || item.section_id;
            if (!sid) continue;
            if (!itemsBySection[sid]) itemsBySection[sid] = [];
            itemsBySection[sid].push(item);
        }

        var html = '';
        for (var j = 0; j < libraryCatalog.sections.length; j++) {
            var section = libraryCatalog.sections[j];
            var groupId = section.groupId || 'general';
            if (config.groupIds.indexOf(groupId) === -1) continue;

            var searchText = String(resourceSearch.value || '').trim().toLowerCase();
            var sectionItems = (itemsBySection[section.id] || []).filter(function(item) {
                if (!searchText) return true;
                return [
                    item.title, item.id, item.set_id, item.topic, item.displayValue,
                    (item.tags || []).join(' ')
                ].join(' ').toLowerCase().indexOf(searchText) !== -1;
            });

            html += libraryBuildSection(section, sectionItems);
        }

        if (!html) {
            html = '<p class="section-description">' + escapeHtml(config.emptyMessage) + '</p>';
        }

        root.innerHTML = html;
    }

    function librarySwitchTab(tabId) {
        if (tabId === libraryActiveTab) return;
        libraryActiveTab = tabId;
        var bar = document.getElementById('student-library-tab-bar');
        if (bar) {
            var tabs = bar.querySelectorAll('.library-tab-btn');
            for (var i = 0; i < tabs.length; i++) {
                tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === tabId);
            }
        }
        libraryLoadTabContent(tabId);
    }

    function wordSourceLabel(word) {
        return word.source_title || word.source_set_id || word.source_path || 'Saved from Mr. Cat Academy';
    }

    function wordTimeLabel(word) {
        return formatShortDate(word.last_added_at || word.updated_at || word.created_at);
    }

    function sortedVocabItems(items) {
        return (items || []).slice().sort(function(left, right) {
            return new Date(right.updated_at || right.last_added_at || right.created_at || 0).getTime() -
                new Date(left.updated_at || left.last_added_at || left.created_at || 0).getTime();
        });
    }

    function filteredVocabItems() {
        var query = String(state.vocabSearch || '').trim().toLowerCase();
        return sortedVocabItems(state.vocabItems || []).filter(function(word) {
            if ((word.status || 'active') !== 'active') return false;
            if (!query) return true;
            return [
                word.text,
                word.normalized_text,
                word.source_title,
                word.source_set_id,
                word.context
            ].join(' ').toLowerCase().indexOf(query) !== -1;
        });
    }

    function myWordsListHtml() {
        var words = filteredVocabItems();
        if (!words.length) {
            return '<div class="my-words-empty">' +
                (state.vocabSearch ? 'No saved words match this search.' : 'Select a word or short phrase anywhere in the site to save it here.') +
            '</div>';
        }
        return words.map(function(word) {
            var source = wordSourceLabel(word);
            var date = wordTimeLabel(word);
            return '<article class="my-word-item">' +
                '<div class="my-word-main">' +
                    '<strong>' + escapeHtml(word.text || '') + '</strong>' +
                    '<span>' + escapeHtml(source) + (date ? ' · ' + escapeHtml(date) : '') + '</span>' +
                    (word.context ? '<p>' + escapeHtml(word.context) + '</p>' : '') +
                '</div>' +
                '<button class="outline-button my-word-action" type="button" data-archive-word="' + escapeHtml(word.vocab_id || '') + '">Archive</button>' +
            '</article>';
        }).join('');
    }

    function bindMyWordActions() {
        document.querySelectorAll('[data-archive-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                var vocabId = button.dataset.archiveWord;
                if (!vocabId) return;
                button.disabled = true;
                button.textContent = 'Archiving...';
                window.MrCatCloud.callFunction('studentVocabulary', {
                    action: 'archive',
                    vocab_id: vocabId
                }).then(function(result) {
                    if (!result || !result.success) throw new Error(result && result.message || 'Unable to archive this word.');
                    state.vocabItems = (state.vocabItems || []).filter(function(word) {
                        return word.vocab_id !== vocabId;
                    });
                    renderMyWordsList();
                }).catch(function(error) {
                    button.disabled = false;
                    button.textContent = 'Archive';
                    alert(error.message || 'Unable to archive this word.');
                });
            });
        });
    }

    function renderMyWordsList() {
        var list = document.getElementById('my-words-list');
        var count = document.getElementById('my-words-count');
        if (count) {
            var activeCount = (state.vocabItems || []).filter(function(word) {
                return (word.status || 'active') === 'active';
            }).length;
            count.textContent = activeCount + ' saved';
        }
        if (!list) return;
        list.innerHTML = myWordsListHtml();
        bindMyWordActions();
    }

    function bindMyWordsCard() {
        var search = document.getElementById('my-words-search');
        if (search) {
            search.value = state.vocabSearch;
            search.addEventListener('input', function() {
                state.vocabSearch = search.value;
                renderMyWordsList();
            });
        }
        var refresh = document.getElementById('my-words-refresh');
        if (refresh) {
            refresh.addEventListener('click', function() {
                refresh.disabled = true;
                refresh.textContent = 'Refreshing...';
                window.MrCatCloud.callFunction('studentVocabulary', {
                    action: 'list',
                    status: 'active',
                    limit: 100
                }).then(function(result) {
                    if (!result || !result.success) throw new Error(result && result.message || 'Unable to load My Words.');
                    state.vocabItems = result.words || [];
                    renderMyWordsList();
                }).catch(function(error) {
                    alert(error.message || 'Unable to load My Words.');
                }).finally(function() {
                    refresh.disabled = false;
                    refresh.textContent = 'Refresh';
                });
            });
        }
        bindMyWordActions();
    }

    function renderMyWordsCard() {
        var activeCount = (state.vocabItems || []).filter(function(word) {
            return (word.status || 'active') === 'active';
        }).length;
        return '<section class="profile-card my-words-card">' +
            '<div class="my-words-head">' +
                '<div>' +
                    '<p class="eyebrow accent">My Words</p>' +
                    '<h2>My Words</h2>' +
                '</div>' +
                '<span class="badge neutral" id="my-words-count">' + activeCount + ' saved</span>' +
            '</div>' +
            '<div class="my-words-tools">' +
                '<input id="my-words-search" class="resource-search" type="search" placeholder="Search saved words...">' +
                '<button class="outline-button my-word-refresh" id="my-words-refresh" type="button">Refresh</button>' +
            '</div>' +
            '<div class="my-words-list" id="my-words-list">' + myWordsListHtml() + '</div>' +
        '</section>';
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
                    '<div class="profile-row"><span>System</span><strong>' + escapeHtml(profile.curriculum_track || 'Not set') + '</strong></div>' +
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
                renderMyWordsCard() +
            '</div>';
        document.getElementById('logout-button').addEventListener('click', window.MrCatAuth.logout);
        document.getElementById('change-password').addEventListener('click', function() {
            openChangePasswordDialog();
        });
        bindMyWordsCard();
    }

    function loadPublicCatalog() {
        return fetch('data/home-catalog.json?_=' + Date.now())
            .then(function(response) {
                if (!response.ok) throw new Error('Catalog unavailable');
                return response.json();
            })
            .then(function(catalog) {
                libraryCatalog = catalog;
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

    function loadPublicCatalogSections() {
        if (libraryCatalog) return Promise.resolve();
        return fetch('data/home-catalog.json?_=' + Date.now())
            .then(function(response) {
                if (!response.ok) return;
                return response.json();
            })
            .then(function(catalog) {
                if (catalog) libraryCatalog = catalog;
            })
            .catch(function() {});
    }

    function loadStudentData() {
        return Promise.all([
            window.MrCatCloud.callFunction('getDashboard').catch(function() {
                return { success: false, assignments: [] };
            }),
            window.MrCatCloud.callFunction('getResources').catch(function() {
                return { success: false, resources: [] };
            }),
            window.MrCatCloud.callFunction('studentVocabulary', {
                action: 'list',
                status: 'active',
                limit: 100
            }).catch(function() {
                return { success: false, words: [] };
            })
        ]).then(function(results) {
            var dashboard = results[0] || {};
            state.assignments = dashboard.assignments || [];
            state.starCount = Number(dashboard.star_count || 0);
            state.assignmentStarCount = Number(dashboard.assignment_star_count == null ? state.starCount : dashboard.assignment_star_count);
            state.selfStudyStarCount = Number(dashboard.self_study_star_count || 0);
            state.teacherReplies = dashboard.teacher_replies || [];
            updateStarCounter(false);
            state.resources = results[1] && results[1].resources || [];
            state.vocabItems = results[2] && results[2].words || [];
            if (!state.resources.length) return loadPublicCatalog().then(function(items) { state.resources = items; });
            return loadPublicCatalogSections();
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
        libraryLoadTabContent(libraryActiveTab);
    });

    document.addEventListener('click', function(e) {
        var tabBtn = e.target.closest('.library-tab-btn');
        if (tabBtn) {
            librarySwitchTab(tabBtn.getAttribute('data-tab'));
            return;
        }
        var sectionTitle = e.target.closest('#student-library-sections .section-title');
        if (sectionTitle) {
            var section = sectionTitle.closest('.section');
            var body = section.querySelector('.section-body');
            var btn = sectionTitle.querySelector('.toggle-btn');
            var isOpen = body.style.display !== 'none';
            body.style.display = isOpen ? 'none' : 'block';
            section.classList.toggle('is-open', !isOpen);
            if (btn) btn.textContent = isOpen ? 'Show' : 'Hide';
            return;
        }
        var yearTab = e.target.closest('.year-tab');
        if (yearTab) {
            var year = yearTab.getAttribute('data-year');
            var tabsContainer = yearTab.closest('.year-tabs');
            var sectionEl = tabsContainer ? tabsContainer.closest('.section') : null;
            if (sectionEl) {
                var tabs = tabsContainer.querySelectorAll('.year-tab');
                for (var ti = 0; ti < tabs.length; ti++) {
                    tabs[ti].classList.toggle('active', tabs[ti] === yearTab);
                }
                var cards = sectionEl.querySelectorAll('.menu-card');
                for (var ci = 0; ci < cards.length; ci++) {
                    if (!year) {
                        cards[ci].classList.remove('year-hidden');
                    } else {
                        cards[ci].classList.toggle('year-hidden', cards[ci].getAttribute('data-year') !== year);
                    }
                }
            }
            return;
        }
    });

    window.addEventListener('mrcat:vocab-saved', function(event) {
        if (!state.session || state.session.mode !== 'student') return;
        var word = event.detail;
        if (!word || !word.vocab_id) return;
        state.vocabItems = (state.vocabItems || []).filter(function(item) {
            return item.vocab_id !== word.vocab_id;
        });
        state.vocabItems.unshift(word);
        var profileView = document.getElementById('view-profile');
        if (profileView && !profileView.hidden) renderProfile();
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
                state.starCount = 0;
                updateStarCounter(false);
                greeting.textContent = 'Welcome, Visitor.';
                heroCopy.textContent = randomItem(motivationalQuotes);
                return loadPublicCatalog().then(function(items) {
                    state.resources = items;
                });
            }

            var preferredName = englishName(session.profile);
            updateAppIconForSystem(session.profile && session.profile.curriculum_track);
            identityChip.textContent = preferredName;
            greeting.textContent = greetingFor(preferredName);
            heroCopy.textContent = randomItem(motivationalQuotes);
            return loadStudentData();
        })
        .then(function() {
            if (!state.session) return;
            renderAssignments();
            libraryLoadTabContent(libraryActiveTab);
            renderProfile();
        })
        .catch(function(error) {
            assignmentContent.innerHTML = '<div class="empty-card"><strong>Unable to load the dashboard</strong>' + escapeHtml(error.message || 'Please sign in again.') + '</div>';
        });
})();
