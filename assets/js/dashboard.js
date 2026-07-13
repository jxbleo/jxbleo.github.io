(function() {
    'use strict';

    var state = {
        session: null,
        assignments: [],
        resources: [],
        resourceFilter: 'vocabulary',
        resourceBookFilters: {},
        starCount: 0,
        assignmentStarCount: 0,
        selfStudyStarCount: 0,
        teacherReplies: [],
        vocabItems: [],
        vocabSearch: '',
        vocabFilter: 'all',
        vocabReviewMode: false,
        vocabReviewRevealed: false,
        vocabReviewWordId: '',
        progressSelectedDay: '',
        accountPanelOpen: false,
        wordsPanelOpen: false,
        myWordsScrollTop: 0
    };
    var dashboardViews = ['resources'];
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
        'There is always something valuable in another attempt.',
        'A steady learner becomes a strong learner.',
        'You only need the next useful step.',
        'Practice turns uncertainty into skill.',
        'Give yourself credit for showing up.',
        'The next question is a new chance.',
        'Your attention is powerful when you use it well.',
        'A careful attempt is already progress.',
        'Keep your goals close and your steps simple.',
        'Small wins are still wins.',
        'Every finished task adds to your foundation.',
        'The habit matters as much as the score.',
        'You are training your brain to stay with hard things.',
        'A strong result often starts quietly.',
        'One clear answer can unlock the next one.',
        'Let today be a solid page in your learning story.',
        'The work you do now makes later work lighter.',
        'Progress is built in ordinary moments.',
        'Stay steady. The skills are forming.',
        'A focused start is half the battle.',
        'You can do hard things one piece at a time.',
        'Keep choosing the next right effort.',
        'Your future confidence is being built here.',
        'The best learners keep returning.',
        'A little discipline can create a lot of freedom.',
        'Do the next task with care.',
        'Every practice session gives you more evidence that you can improve.',
        'Learning is not a race. It is a rhythm.',
        'Try, notice, adjust, and try again.',
        'You are allowed to grow at a human pace.',
        'A brave attempt is better than a perfect delay.',
        'Keep your curiosity awake.',
        'One more thoughtful try can change the pattern.',
        'Build the skill, not just the score.',
        'The next small effort still counts.',
        'You are closer than you were before you started.',
        'Let the work be simple and honest today.',
        'Strong students are made by steady choices.',
        'You do not need a perfect day to make progress.',
        'Take the next step and let momentum find you.',
        'Your practice is becoming your strength.'
    ];

    var identityChip = document.getElementById('identity-chip');
    var starCounter = null;
    var selfStudyStarCounter = null;
    var greeting = document.getElementById('greeting');
    var heroCopy = document.getElementById('hero-copy');
    var heroProgressStats = document.getElementById('hero-progress-stats');
    var progressBoard = document.getElementById('progress-board');
    var assignmentContent = document.getElementById('assignment-content');
    var resourceList = document.getElementById('resource-list');
    var profileContent = document.getElementById('profile-content');
    var myWordsContent = document.getElementById('my-words-content');
    var resourceSearch = document.getElementById('resource-search');
    var accountPanel = document.getElementById('student-account-panel');
    var wordsButton = document.getElementById('student-words-button');
    var wordsOverlay = document.getElementById('student-words-overlay');
    var wordsScroll = document.getElementById('student-words-dialog-scroll');
    var messageButton = document.getElementById('student-message-button');
    var messageCount = document.getElementById('student-message-count');

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
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

    function shanghaiDateParts(value) {
        var date = value instanceof Date ? value : new Date(value || Date.now());
        if (isNaN(date.getTime())) return null;
        var parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date);
        var result = {};
        parts.forEach(function(part) {
            if (part.type !== 'literal') result[part.type] = part.value;
        });
        var year = Number(result.year);
        var month = Number(result.month);
        var day = Number(result.day);
        if (!year || !month || !day) return null;
        return {
            year: year,
            month: month,
            day: day,
            key: year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0')
        };
    }

    function utcDateFromShanghaiParts(parts) {
        return new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
    }

    function addUtcDays(date, days) {
        var next = new Date(date.getTime());
        next.setUTCDate(next.getUTCDate() + days);
        return next;
    }

    function keyFromUtcDate(date) {
        return date.getUTCFullYear() + '-' +
            String(date.getUTCMonth() + 1).padStart(2, '0') + '-' +
            String(date.getUTCDate()).padStart(2, '0');
    }

    function mondayIndexFromUtcDate(date) {
        return (date.getUTCDay() + 6) % 7;
    }

    function currentShanghaiWeekStart() {
        var parts = shanghaiDateParts(new Date());
        var today = utcDateFromShanghaiParts(parts);
        return addUtcDays(today, -mondayIndexFromUtcDate(today));
    }

    function isoWeekNumber(date) {
        var target = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        var dayNumber = (target.getUTCDay() + 6) % 7;
        target.setUTCDate(target.getUTCDate() - dayNumber + 3);
        var firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
        var firstDayNumber = (firstThursday.getUTCDay() + 6) % 7;
        firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNumber + 3);
        return 1 + Math.round((target.getTime() - firstThursday.getTime()) / 604800000);
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

    function greetingFor(name) {
        var greetings = [
            'Hi, {name}.',
            'Hello, {name}.',
            'Welcome back, {name}.',
            'Good to see you, {name}.',
            'Nice to see you, {name}.',
            'Glad you are here, {name}.',
            'Here you are, {name}.',
            'Welcome, {name}.',
            'Let us begin, {name}.',
            'Keep going, {name}.',
            'Start here, {name}.',
            'One step at a time, {name}.',
            'Back to learning, {name}.',
            'Your next step, {name}.'
        ];
        return randomItem(greetings).replace('{name}', name);
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

    function appVersion() {
        return window.MRCAT_CONFIG && window.MRCAT_CONFIG.appVersion || '1';
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
        return appendQueryParam(cleanHref, 'return', returnUrl || 'dashboard.html');
    }

    function dashboardReturnUrl(viewName) {
        var view = dashboardViews.indexOf(viewName) === -1 ? 'assignments' : viewName;
        return 'dashboard.html?view=' + encodeURIComponent(view);
    }

    function isVocabularyHref(href) {
        return /(?:^|\/)vocabulary\.html(?:\?|$)/i.test(String(href || ''));
    }

    function vocabularyLearningHref(set, returnView) {
        var href = set.link || set.href || defaultPracticeLink(set.set_id || set.id || '');
        var params = [
            'app=' + encodeURIComponent(appVersion()),
            'entry=learn'
        ];
        if (state.session && state.session.mode === 'visitor') params.push('visitor=1');
        href = href + (href.indexOf('?') === -1 ? '?' : '&') + params.join('&');
        return withReturnParam(href, dashboardReturnUrl(returnView || 'resources'));
    }

    function practiceHref(item, assignmentId, returnView) {
        var href = item.link || item.href || '#';
        var params = ['app=' + encodeURIComponent(appVersion())];
        if (assignmentId) params.push('assignment=' + encodeURIComponent(assignmentId));
        if (item.status) params.push('status=' + encodeURIComponent(normalizedStatus(item.status)));
        if (item.prefill_attempt_id) params.push('prefill=' + encodeURIComponent(item.prefill_attempt_id));
        if (item.history_attempt_id) params.push('history=' + encodeURIComponent(item.history_attempt_id));
        if (item.best_percentage != null) params.push('history_score=' + encodeURIComponent(item.best_percentage));
        if (assignmentId && isVocabularyHref(href) && !item.prefill_attempt_id && !item.history_attempt_id) {
            params.push('entry=learn');
        }
        if (state.session && state.session.mode === 'visitor') params.push('visitor=1');
        href = href + (href.indexOf('?') === -1 ? '?' : '&') + params.join('&');
        return withReturnParam(href, dashboardReturnUrl(returnView || (assignmentId ? 'assignments' : 'resources')));
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

    function isStarCollected(item) {
        return item.star_claimed === true;
    }

    function updateStarCounter(animate) {
        if (!starCounter) starCounter = document.getElementById('star-counter');
        if (!selfStudyStarCounter) selfStudyStarCounter = document.getElementById('self-study-star-counter');
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

    function todoAssignments() {
        return (state.assignments || [])
            .filter(function(item) { return normalizedStatus(item.status) === 'to_do'; })
            .sort(newestFirst);
    }

    function finishedAssignments() {
        return (state.assignments || [])
            .filter(function(item) { return isFinishedStatus(item.status); })
            .sort(function(left, right) { return finishedDate(right) - finishedDate(left); });
    }

    function assignmentSet(item) {
        return item && (item.set || item) || {};
    }

    function assignmentSetId(item) {
        var set = assignmentSet(item);
        return set.set_id || set.id || set.title || '';
    }

    function assignmentTitle(item) {
        var set = assignmentSet(item);
        return set.title || assignmentSetId(item) || 'Practice';
    }

    function assignmentKind(item) {
        var set = assignmentSet(item);
        var sectionId = set.sectionId || set.section_id || '';
        return vocabularySourceLabel(set) ||
            (sectionId ? librarySectionLabel(sectionId, set.course || set.type || 'Assignment') : (set.course || set.type || 'Assignment'));
    }

    function assignmentOpenHref(item) {
        var set = assignmentSet(item);
        var status = normalizedStatus(item.status);
        var finished = isFinishedStatus(status);
        var assignmentHref = practiceHref(Object.assign({}, set, {
            prefill_attempt_id: item.prefill_attempt_id,
            history_attempt_id: item.history_attempt_id,
            best_percentage: item.best_percentage
        }), item.assignment_id);
        var setHref = set.link || set.href || defaultPracticeLink(set.set_id || set.id || '');
        return finished && isVocabularyHref(setHref)
            ? vocabularyLearningHref(set, 'assignments')
            : assignmentHref;
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
        var set = assignmentSet(item);
        var status = normalizedStatus(item.status);
        var finished = isFinishedStatus(status);
        var replyCount = teacherReplyCount(item);
        var replyKey = replyKeyForItem(item);
        var setId = assignmentSetId(item);
        var href = assignmentOpenHref(item);
        var collected = isStarCollected(item);
        var replyButton = replyCount
            ? '<button class="card-button reply-button" type="button" data-teacher-replies-key="' + escapeHtml(replyKey) + '">' +
                'Teacher replies <span class="reply-count-badge">' + escapeHtml(replyCount) + '</span></button>'
            : '';
        var eyebrow = assignmentKind(item);
        var entryStatus = finished ? status : 'not-passed';
        var entryLocked = item.answer_revealed === true || item.mastery_locked === true;
        return '<article class="resource-card library-task-card assignment-task-card' +
            (finished ? ' finished-assignment-card ' + escapeHtml(status) : '') +
            (replyCount ? ' has-teacher-replies' : '') +
            '" data-assignment-id="' + escapeHtml(item.assignment_id || '') + '" data-reply-key="' + escapeHtml(replyKey) + '"' +
            ' data-entry-kind="' + escapeHtml(eyebrow) + '" data-entry-title="' + escapeHtml(set.title || setId || 'Practice') + '"' +
            ' data-entry-status="' + escapeHtml(entryStatus) + '" data-entry-best="' + escapeHtml(item.best_percentage == null ? '' : item.best_percentage) + '"' +
            ' data-entry-locked="' + (entryLocked ? 'true' : 'false') + '"' +
            ' data-open-href="' + escapeHtml(href) + '" role="link" tabindex="0" aria-label="Open ' + escapeHtml(set.title || setId || 'assignment') + '">' +
            '<div class="library-task-copy">' +
                '<div class="resource-card-head">' +
                    '<p class="eyebrow accent">' + escapeHtml(eyebrow) + '</p>' +
                    '<span>' + escapeHtml(setId) + '</span>' +
                '</div>' +
                '<h3>' + escapeHtml(set.title || setId || 'Practice') + '</h3>' +
            '</div>' +
            '<div class="library-task-actions">' +
                (status === 'mastered' && !collected
                    ? '<button class="card-button star-button" type="button" data-get-star="' + escapeHtml(item.assignment_id || '') + '">Get Star</button>'
                    : '') +
                replyButton +
            '</div>' +
        '</article>';
    }

    function assignmentTime(item) {
        return new Date(item.assigned_at || item.updated_at || 0).getTime();
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
        var status = element && element.dataset && element.dataset.entryStatus || 'not-passed';
        status = normalizedStatus(status);
        if (status === 'mastered') return 'mastered';
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
                var onCommit = overlay.practiceEntryOnCommit;
                closePracticeEntryDialog({ restoreSource: false });
                if (typeof onCommit === 'function') onCommit();
                window.location.href = href;
            }
        });
        return overlay;
    }

    function closePracticeEntryDialog(options) {
        var overlay = document.getElementById('practice-entry-overlay');
        if (!overlay) return;
        var restoreSource = !options || options.restoreSource !== false;
        var onDismiss = restoreSource ? overlay.practiceEntryOnDismiss : null;
        overlay.hidden = true;
        delete overlay.dataset.href;
        overlay.practiceEntryOnDismiss = null;
        overlay.practiceEntryOnCommit = null;
        document.removeEventListener('keydown', handlePracticeEntryKeydown);
        if (typeof onDismiss === 'function') onDismiss();
    }

    window.addEventListener('pageshow', function() {
        closePracticeEntryDialog({ restoreSource: false });
    });

    function handlePracticeEntryKeydown(event) {
        if (event.key === 'Escape') closePracticeEntryDialog();
    }

    function showPracticeEntryDialog(element, href, options) {
        var overlay = ensurePracticeEntryDialog();
        var status = practiceEntryStatus(element);
        var best = element && element.dataset && element.dataset.entryBest;
        var locked = practiceEntryLocked(element);
        options = options || {};
        overlay.dataset.href = href || '';
        overlay.practiceEntryOnDismiss = typeof options.onDismiss === 'function' ? options.onDismiss : null;
        overlay.practiceEntryOnCommit = typeof options.onCommit === 'function' ? options.onCommit : null;
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
        if (event && event.target && event.target.closest('button, a')) return;
        var href = card.dataset.openHref;
        if (href) showPracticeEntryDialog(card, href);
    }

    function newestFirst(left, right) {
        return assignmentTime(right) - assignmentTime(left);
    }

    function teacherReplyTotal() {
        return (state.teacherReplies || []).length;
    }

    function studentMessageTotal() {
        return todoAssignments().length + teacherReplyTotal();
    }

    function updateDashboardTabNotices() {
        var messageTotal = studentMessageTotal();
        var button = document.querySelector('.tab-button[data-view="assignments"]');
        if (button) {
            var existing = button.querySelector('.notice-dot');
            if (existing) existing.remove();
        }
        if (messageCount) {
            messageCount.textContent = messageTotal ? (messageTotal > 9 ? '9+' : String(messageTotal)) : '';
            messageCount.hidden = messageTotal <= 0;
        }
        if (messageButton) {
            messageButton.classList.toggle('has-updates', messageTotal > 0);
            messageButton.setAttribute('aria-label', messageTotal ? messageTotal + ' notifications' : 'Notifications');
            messageButton.setAttribute('aria-expanded', 'false');
        }
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

    function markTeacherRepliesSeen(replies) {
        var ids = replyIds(replies);
        if (!ids.length) return Promise.resolve();
        clearTeacherReplies(ids);
        renderAssignments();
        updateDashboardTabNotices();
        if (!window.MrCatCloud) return Promise.resolve();
        return window.MrCatCloud.callFunction('getDashboard', {
            action: 'markTeacherRepliesSeen',
            dispute_ids: ids
        }).catch(function() {});
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

    function renderTeacherReplyItem(reply) {
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
    }

    function renderStudentMessageTask(item, type) {
        var status = normalizedStatus(item.status);
        var finished = isFinishedStatus(status);
        var href = assignmentOpenHref(item);
        var title = assignmentTitle(item);
        var kind = assignmentKind(item);
        var score = finished && item.best_percentage != null
            ? '<span class="student-message-score">' + escapeHtml(formatEntryPercent(item.best_percentage)) + '</span>'
            : '';
        var entryStatus = finished ? status : 'not-passed';
        var entryLocked = item.answer_revealed === true || item.mastery_locked === true;
        return '<article class="student-message-task ' + escapeHtml(type) + '"' +
            ' data-entry-kind="' + escapeHtml(kind) + '" data-entry-title="' + escapeHtml(title) + '"' +
            ' data-entry-status="' + escapeHtml(entryStatus) + '" data-entry-best="' + escapeHtml(item.best_percentage == null ? '' : item.best_percentage) + '"' +
            ' data-entry-locked="' + (entryLocked ? 'true' : 'false') + '" data-open-href="' + escapeHtml(href) + '"' +
            ' role="link" tabindex="0" aria-label="Review before opening ' + escapeHtml(title) + '">' +
            '<div class="student-message-task-main">' +
                '<span class="student-message-kicker">' + escapeHtml(kind) + '</span>' +
                '<strong>' + escapeHtml(title) + '</strong>' +
            '</div>' +
            '<div class="student-message-task-meta" aria-hidden="true">' +
                score +
                '<svg viewBox="0 0 24 24" focusable="false"><path d="m9 5 7 7-7 7"></path></svg>' +
            '</div>' +
        '</article>';
    }

    function renderStudentMessageSection(title, count, body, emptyText, extraClass) {
        return '<section class="student-message-section ' + escapeHtml(extraClass || '') + '">' +
            '<div class="student-message-section-head">' +
                '<h3>' + escapeHtml(title) + '</h3>' +
                '<span>' + escapeHtml(count) + '</span>' +
            '</div>' +
            (body ? '<div class="student-message-list">' + body + '</div>' : '<div class="student-message-empty">' + escapeHtml(emptyText) + '</div>') +
        '</section>';
    }

    function openStudentMessageCenter() {
        var existing = document.querySelector('.student-message-overlay');
        if (existing) existing.remove();

        var todos = state.session && state.session.mode === 'student' ? todoAssignments() : [];
        var finished = state.session && state.session.mode === 'student' ? finishedAssignments() : [];
        var replies = state.teacherReplies || [];
        var overlay = document.createElement('div');
        overlay.className = 'teacher-replies-overlay student-message-overlay';
        overlay.innerHTML =
            '<div class="teacher-replies-dialog student-message-dialog" role="dialog" aria-modal="true" aria-labelledby="student-message-title">' +
                '<button class="dialog-close-button" type="button" aria-label="Close notifications">×</button>' +
                '<div class="teacher-replies-dialog-head student-message-dialog-head">' +
                    '<h2 id="student-message-title">Notifications</h2>' +
                    '<div class="student-message-summary">' +
                        '<span><b>' + escapeHtml(todos.length) + '</b> to do</span>' +
                        '<span><b>' + escapeHtml(finished.length) + '</b> finished</span>' +
                        '<span><b>' + escapeHtml(replies.length) + '</b> replies</span>' +
                    '</div>' +
                '</div>' +
                '<div class="student-message-sections">' +
                    renderStudentMessageSection(
                        'To do',
                        todos.length,
                        todos.map(function(item) { return renderStudentMessageTask(item, 'todo'); }).join(''),
                        'No unfinished assignments.',
                        'todo'
                    ) +
                    renderStudentMessageSection(
                        'Finished',
                        finished.length,
                        finished.map(function(item) { return renderStudentMessageTask(item, 'finished'); }).join(''),
                        'Finished assignments will appear here.',
                        'finished'
                    ) +
                    renderStudentMessageSection(
                        'Teacher replies',
                        replies.length,
                        replies.map(renderTeacherReplyItem).join(''),
                        'No new teacher replies.',
                        'replies'
                    ) +
                '</div>' +
                '<div class="dialog-actions">' +
                    '<button class="primary-button" id="student-message-done" type="button">Close</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);
        if (messageButton) messageButton.setAttribute('aria-expanded', 'true');

        var didMarkSeen = false;
        function close(markSeen) {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
            if (messageButton) messageButton.setAttribute('aria-expanded', 'false');
            if (!markSeen || didMarkSeen) return Promise.resolve();
            didMarkSeen = true;
            return markTeacherRepliesSeen(replies);
        }

        function suspend() {
            document.removeEventListener('keydown', onKeydown);
            overlay.hidden = true;
            if (messageButton) messageButton.setAttribute('aria-expanded', 'false');
        }

        function resume(card) {
            overlay.hidden = false;
            if (messageButton) messageButton.setAttribute('aria-expanded', 'true');
            document.addEventListener('keydown', onKeydown);
            if (card && card.isConnected) card.focus();
        }

        function onKeydown(event) {
            if (event.key === 'Escape') close(true);
        }

        overlay.addEventListener('click', function(event) {
            if (event.target === overlay) close(true);
        });
        overlay.querySelector('.dialog-close-button').addEventListener('click', function() { close(true); });
        overlay.querySelector('#student-message-done').addEventListener('click', function() { close(true); });
        overlay.querySelectorAll('.student-message-task[data-open-href]').forEach(function(card) {
            function openTask(event) {
                if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                var href = card.dataset.openHref;
                if (!href) return;
                suspend();
                showPracticeEntryDialog(card, href, {
                    onDismiss: function() { resume(card); },
                    onCommit: function() { close(true); }
                });
            }
            card.addEventListener('click', openTask);
            card.addEventListener('keydown', openTask);
        });
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
                '<div class="teacher-replies-list">' + replies.map(renderTeacherReplyItem).join('') + '</div>' +
                '<div class="dialog-actions">' +
                    '<button class="primary-button" id="teacher-replies-done" type="button">Close</button>' +
                '</div>' +
            '</div>';
        document.body.appendChild(overlay);

        var didMarkSeen = false;
        function close(markSeen) {
            document.removeEventListener('keydown', onKeydown);
            overlay.remove();
            if (!markSeen || didMarkSeen) return Promise.resolve();
            didMarkSeen = true;
            return markTeacherRepliesSeen(replies);
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

    function finishedDate(item) {
        return new Date(item.mastered_at || item.completed_at || item.updated_at || item.latest_submitted_at || 0).getTime();
    }

    function progressItemDateValue(item) {
        if (!item || !isFinishedStatus(item.status)) return null;
        var value = item.mastered_at || item.completed_at || item.updated_at || item.latest_submitted_at || null;
        var date = value ? new Date(value) : null;
        return date && !isNaN(date.getTime()) ? date : null;
    }

    function progressItemKind(item) {
        var set = item && (item.set || item) || {};
        var sectionId = set.sectionId || set.section_id || '';
        return vocabularySourceLabel(set) ||
            librarySectionLabel(sectionId, set.course || set.type || 'Practice');
    }

    function progressItemTitle(item) {
        var set = item && (item.set || item) || {};
        return set.title || set.set_id || set.id || 'Practice';
    }

    function progressItemScoreLabel(item) {
        return item && item.best_percentage != null ? formatEntryPercent(item.best_percentage) : '--';
    }

    function renderProgressTask(item) {
        var status = normalizedStatus(item.status);
        var title = progressItemTitle(item);
        var kind = progressItemKind(item) || 'Practice';
        var href = assignmentOpenHref(item);
        var entryLocked = item.answer_revealed === true || item.mastery_locked === true;
        return '<article class="progress-detail-task" data-open-href="' + escapeHtml(href) + '"' +
            ' data-entry-kind="' + escapeHtml(kind) + '" data-entry-title="' + escapeHtml(title) + '"' +
            ' data-entry-status="' + escapeHtml(status) + '" data-entry-best="' + escapeHtml(item.best_percentage == null ? '' : item.best_percentage) + '"' +
            ' data-entry-locked="' + (entryLocked ? 'true' : 'false') + '" role="link" tabindex="0"' +
            ' aria-label="Open completed task ' + escapeHtml(title) + '">' +
            '<strong>' + escapeHtml(title) + '</strong>' +
            '<span class="progress-task-meta">' +
                '<span class="progress-task-type">' + escapeHtml(kind) + '</span>' +
                '<span class="progress-task-score">' + escapeHtml(progressItemScoreLabel(item)) + '</span>' +
            '</span>' +
        '</article>';
    }

    function progressDayModel() {
        var weekStart = currentShanghaiWeekStart();
        var firstWeekStart = addUtcDays(weekStart, -21);
        var todayParts = shanghaiDateParts(new Date());
        var todayKey = todayParts && todayParts.key;
        var days = [];
        var daysByKey = {};
        var weeks = [];
        var weeksByKey = {};
        var weekdayLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

        for (var weekIndex = 0; weekIndex < 4; weekIndex++) {
            var weekDate = addUtcDays(firstWeekStart, weekIndex * 7);
            var weekKey = 'week:' + keyFromUtcDate(weekDate);
            var week = {
                key: weekKey,
                startKey: keyFromUtcDate(weekDate),
                weekLabel: 'W' + isoWeekNumber(weekDate),
                type: 'week',
                days: [],
                items: []
            };
            weeks.push(week);
            weeksByKey[weekKey] = week;
            for (var dayIndex = 0; dayIndex < 7; dayIndex++) {
                var date = addUtcDays(weekDate, dayIndex);
                var key = keyFromUtcDate(date);
                var day = {
                    key: key,
                    weekKey: weekKey,
                    date: date,
                    weekLabel: week.weekLabel,
                    dayLabel: weekdayLabels[dayIndex],
                    type: 'day',
                    items: [],
                    isFuture: todayKey ? key > todayKey : false
                };
                days.push(day);
                week.days.push(day);
                daysByKey[key] = day;
            }
        }

        (state.assignments || []).forEach(function(item) {
            var date = progressItemDateValue(item);
            if (!date) return;
            var parts = shanghaiDateParts(date);
            if (!parts || !daysByKey[parts.key]) return;
            daysByKey[parts.key].items.push(item);
        });

        days.forEach(function(day) {
            day.items.sort(function(left, right) {
                return progressItemDateValue(right).getTime() - progressItemDateValue(left).getTime();
            });
            day.hasStar = day.items.some(function(item) {
                return normalizedStatus(item.status) === 'mastered' || item.star_claimed === true;
            });
            day.level = Math.min(4, day.items.length);
        });

        weeks.forEach(function(week) {
            week.items = week.days.reduce(function(items, day) {
                return items.concat(day.items);
            }, []).sort(function(left, right) {
                return progressItemDateValue(right).getTime() - progressItemDateValue(left).getTime();
            });
        });

        var selected = null;
        if (state.progressSelectedDay) {
            selected = weeksByKey[state.progressSelectedDay] || daysByKey[state.progressSelectedDay] || null;
        }
        if (!selected) selected = daysByKey[todayKey];
        if (!selected) {
            for (var i = days.length - 1; i >= 0; i--) {
                if (days[i].items.length) {
                    selected = days[i];
                    break;
                }
            }
        }
        if (!selected) selected = days[days.length - 1];
        state.progressSelectedDay = selected ? selected.key : '';

        return {
            days: days,
            weeks: weeks,
            selected: selected,
            todayKey: todayKey,
            weekdayLabels: weekdayLabels
        };
    }

    function renderHeroProgressMeter(finishedCount, todoCount) {
        var total = finishedCount + todoCount;
        var percent = total ? Math.round((finishedCount / total) * 100) : 0;
        var label = total ? finishedCount + ' / ' + total : '0 / 0';
        return '<div class="hero-meter-row">' +
                '<strong>' + escapeHtml(label) + '</strong>' +
            '</div>' +
            '<div class="hero-meter-track" role="progressbar" aria-label="Assignment completion progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + escapeHtml(percent) + '">' +
                '<i style="width: ' + escapeHtml(percent) + '%"></i>' +
            '</div>' +
            '<div class="hero-meter-legend">' +
                '<span><b>' + escapeHtml(finishedCount) + '</b> finished</span>' +
                '<span><b>' + escapeHtml(todoCount) + '</b> to do</span>' +
            '</div>';
    }

    function renderProgressStats() {
        if (!heroProgressStats) return;
        heroProgressStats.classList.remove('is-loading');
        if (!state.session || state.session.mode !== 'student') {
            heroProgressStats.innerHTML = renderHeroProgressMeter(0, 0);
            return;
        }
        var assignments = state.assignments || [];
        var finished = assignments.filter(function(item) { return isFinishedStatus(item.status); });
        var todo = assignments.filter(function(item) { return normalizedStatus(item.status) === 'to_do'; });
        heroProgressStats.innerHTML = renderHeroProgressMeter(finished.length, todo.length);
    }

    function renderProgressDetail(day) {
        if (!day) return '';
        var count = day.items.length;
        var body = count
            ? day.items.map(renderProgressTask).join('')
            : '';
        return '<section class="progress-detail-panel" aria-live="polite">' +
            '<div class="progress-detail-list">' + body + '</div>' +
        '</section>';
    }

    function renderProgressBoard() {
        if (!progressBoard) return;
        progressBoard.classList.remove('is-loading');
        renderProgressStats();
        if (!state.session || state.session.mode !== 'student') {
            progressBoard.innerHTML =
                '<section class="progress-map-panel visitor">' +
                    '<div class="progress-dot-map" aria-hidden="true">' +
                        '<span></span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span>' +
                        '<span>W--</span><i></i><i></i><i></i><i></i><i></i><i></i><i></i>' +
                        '<span>W--</span><i></i><i></i><i></i><i></i><i></i><i></i><i></i>' +
                        '<span>W--</span><i></i><i></i><i></i><i></i><i></i><i></i><i></i>' +
                        '<span>W--</span><i></i><i></i><i></i><i></i><i></i><i></i><i></i>' +
                    '</div>' +
                '</section>' +
                '<section class="progress-detail-panel"><div class="progress-detail-list"><div class="progress-detail-empty">Log in to keep assignment history and STAR records.</div></div></section>';
            return;
        }

        var model = progressDayModel();
        var cells = '';
        model.days.forEach(function(day, index) {
            if (index % 7 === 0) {
                var week = model.weeks[index / 7];
                var weekClasses = ['progress-week-label', 'progress-week-button'];
                if (week && week.key === state.progressSelectedDay) weekClasses.push('active');
                var weekLabel = week ? week.weekLabel : day.weekLabel;
                var weekItemCount = week ? week.items.length : 0;
                cells += '<button class="' + weekClasses.join(' ') + '" type="button" data-progress-week="' + escapeHtml(week ? week.key : '') + '" aria-label="' + escapeHtml(weekLabel + ', ' + weekItemCount + ' finished this week') + '">' + escapeHtml(weekLabel) + '</button>';
            }
            var classes = ['progress-dot'];
            if (day.level) classes.push('l' + day.level);
            if (day.hasStar) classes.push('star');
            if (day.isFuture) classes.push('future');
            if (day.key === state.progressSelectedDay) classes.push('active');
            var label = day.weekLabel + ' ' + day.dayLabel + ', ' + day.items.length + ' finished';
            cells += '<button class="' + classes.join(' ') + '" type="button" data-progress-day="' + escapeHtml(day.key) + '" aria-label="' + escapeHtml(label) + '"></button>';
        });
        progressBoard.innerHTML =
            '<section class="progress-map-panel">' +
                '<div class="progress-dot-map" aria-label="Recent assignment progress">' +
                    '<span></span>' +
                    model.weekdayLabels.map(function(label) { return '<span class="progress-day-label">' + escapeHtml(label) + '</span>'; }).join('') +
                    cells +
                '</div>' +
            '</section>' +
            renderProgressDetail(model.selected);
    }

    function renderAssignments() {
        if (state.session.mode === 'visitor') {
            assignmentContent.innerHTML =
                '<div class="empty-card"><strong>No visitor assignments</strong>Log in to receive assignments, submit work, and save progress.</div>';
            updateDashboardTabNotices();
            return;
        }

        var assignments = state.assignments || [];
        var todo = assignments.filter(function(item) { return normalizedStatus(item.status) === 'to_do'; }).sort(newestFirst);

        var html = '';
        if (todo.length) html += '<div class="task-list">' + todo.map(taskCard).join('') + '</div>';
        if (!assignments.length) {
            html += '<div class="empty-card"><strong>No assignments yet</strong>Your teacher has not assigned any work to this account.</div>';
        } else if (!todo.length) {
            html += '<div class="empty-card"><strong>No new work is waiting.</strong>Open the bell to review finished work, or explore the Library.</div>';
        }
        assignmentContent.innerHTML = html;
        updateDashboardTabNotices();

        document.querySelectorAll('[data-teacher-replies-key]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.teacherRepliesKey;
                var item = assignments.find(function(candidate) {
                    return replyKeyForItem(candidate) === key;
                });
                openTeacherRepliesDialog(item && item.teacher_replies || []);
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
                    renderProgressBoard();
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

    var libraryActiveTab = 'general';
    var libraryActiveSubTab = '';
    var libraryCatalog = null;

    var LIBRARY_GROUP_IDS = {
        general: ['basics', 'lessons'],
        exam: ['ielts', 'dse']
    };

    var LIBRARY_SUB_TABS = {
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

    function librarySectionLabel(sectionId, fallback) {
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

    function librarySubTabMatchesSection(config, section) {
        if (!config || !config.id) return true;
        if (config.vocabularySource) return section && section.id === 'vocabulary';
        return section && section.id === (config.sectionId || config.id);
    }

    function librarySubTabMatchesItem(config, item) {
        if (!config || !config.id) return true;
        if (config.vocabularySource) return vocabularySourceKey(item) === config.vocabularySource;
        if (config.itemYear) return libraryItemYear(item) === config.itemYear;
        return true;
    }

    function libraryCardBadge(item, section, itemYear) {
        var sectionId = section && section.id || item.sectionId || item.section_id || '';
        if (sectionId === 'bbc-six-minute-english') return itemYear || String(item.sortValue || '').substring(0, 4);
        return '';
    }

    function libraryCardMeta(item, section, itemYear) {
        var badge = libraryCardBadge(item, section, itemYear);
        var sectionId = section && section.id || item.sectionId || item.section_id || '';
        var sectionLabel = vocabularyLibrarySectionLabel(item) ||
            librarySectionLabel(sectionId, section && section.title || item.sectionTitle || item.course || item.type);
        var setId = vocabularyLibraryRangeLabel(item) || item.set_id || item.id || item.displayValue || '';
        return {
            badge: badge,
            sectionLabel: sectionLabel,
            setId: setId
        };
    }

    function libraryShouldShowNote(item) {
        return item.note && item.note !== 'Listening Practice' && item.note !== 'Passage Practice';
    }

    function libraryItemIdentity(item) {
        return String(item && (item.set_id || item.id || item.displayValue || item.href || item.title) || '');
    }

    function libraryItemYear(item) {
        var raw = String((item && (item.sortValue || item.publishedOn || item.displayValue)) || '');
        var dateMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) return dateMatch[1];
        var idMatch = libraryItemIdentity(item).match(/BBC-(\d{2})(\d{2})(\d{2})/i);
        if (idMatch) {
            var year = Number(idMatch[1]);
            return (year < 70 ? '20' : '19') + idMatch[1];
        }
        return '';
    }

    function libraryDateSortValue(item) {
        var raw = String((item && (item.sortValue || item.publishedOn || item.displayValue)) || '');
        var dateMatch = raw.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (dateMatch) return Number(dateMatch[1] + dateMatch[2] + dateMatch[3]);
        var idMatch = libraryItemIdentity(item).match(/BBC-(\d{2})(\d{2})(\d{2})/i);
        if (idMatch) {
            var year = Number(idMatch[1]);
            return Number((year < 70 ? '20' : '19') + idMatch[1] + idMatch[2] + idMatch[3]);
        }
        return 0;
    }

    function libraryIeltsSortValue(item) {
        var match = libraryItemIdentity(item).match(/C(\d+)-T(\d+)-[PS](\d+)/i);
        if (!match) return null;
        return Number(match[1]) * 10000 + Number(match[2]) * 100 + Number(match[3]);
    }

    function libraryNumberSortValue(item, section) {
        var direct = item && (item.sortValue != null ? item.sortValue : item.sortOrder);
        var number = Number(direct);
        if (isFinite(number) && number !== 0) return number;
        if (section && /^ielts-/i.test(section.id || '')) {
            var ielts = libraryIeltsSortValue(item);
            if (ielts != null) return ielts;
        }
        return Number.MAX_SAFE_INTEGER;
    }

    function libraryTitleSortValue(item) {
        return String(item && (item.title || item.displayValue || item.id || item.set_id) || '').toLowerCase();
    }

    function libraryCompareFallback(left, right) {
        return libraryTitleSortValue(left).localeCompare(libraryTitleSortValue(right)) ||
            libraryItemIdentity(left).localeCompare(libraryItemIdentity(right));
    }

    function librarySortItems(items, section) {
        var sorted = items.slice();
        if (section.sortType === 'date_desc') {
            sorted.sort(function(a, b) {
                return libraryDateSortValue(b) - libraryDateSortValue(a) || libraryCompareFallback(a, b);
            });
        } else if (section.sortType === 'date_asc') {
            sorted.sort(function(a, b) {
                return libraryDateSortValue(a) - libraryDateSortValue(b) || libraryCompareFallback(a, b);
            });
        } else if (section.sortType === 'number_asc') {
            sorted.sort(function(a, b) {
                return libraryNumberSortValue(a, section) - libraryNumberSortValue(b, section) || libraryCompareFallback(a, b);
            });
        } else if (section.sortType === 'number_desc') {
            sorted.sort(function(a, b) {
                return libraryNumberSortValue(b, section) - libraryNumberSortValue(a, section) || libraryCompareFallback(a, b);
            });
        } else {
            sorted.sort(libraryCompareFallback);
        }
        return sorted;
    }

    function libraryBuildCard(item, section, extraClass, itemYear) {
        var href = practiceHref(item, null);
        var meta = libraryCardMeta(item, section, itemYear);
        var itemStatus = practiceEntryStatus({ dataset: { entryStatus: item.status || '' } });
        var itemLocked = item.answer_revealed === true || item.mastery_locked === true;
        return '<article class="resource-card library-task-card student-library-card' + (extraClass ? ' ' + extraClass : '') + '"' +
            (itemYear ? ' data-year="' + escapeHtml(itemYear) + '"' : '') +
            ' data-entry-kind="' + escapeHtml(meta.sectionLabel) + '" data-entry-title="' + escapeHtml(item.title || meta.setId || 'Practice') + '"' +
            ' data-entry-status="' + escapeHtml(itemStatus) + '" data-entry-best="' + escapeHtml(item.best_percentage == null ? '' : item.best_percentage) + '"' +
            ' data-entry-locked="' + (itemLocked ? 'true' : 'false') + '"' +
            ' data-open-href="' + escapeHtml(href) + '" role="link" tabindex="0" aria-label="Open ' + escapeHtml(item.title || meta.setId) + '">' +
            '<div class="library-task-copy">' +
                '<div class="resource-card-head">' +
                    '<p class="eyebrow accent">' + escapeHtml(meta.sectionLabel) + '</p>' +
                    '<span>' + escapeHtml(meta.setId) + '</span>' +
                '</div>' +
                '<h3>' + escapeHtml(item.title || meta.setId) + '</h3>' +
                '<div class="library-task-foot">' +
                    '<div class="tags">' + libraryBuildTags(item.tags, item.topic) + '</div>' +
                    (libraryShouldShowNote(item) ? '<p class="card-note">' + escapeHtml(item.note) + '</p>' : '') +
                '</div>' +
            '</div>' +
        '</article>';
    }

    function libraryBuildPlaceholderCard(section) {
        return '<div class="empty-card library-task-placeholder">' +
            '<strong>' + escapeHtml(section.emptyMessage || 'Developing') + '</strong>' +
            escapeHtml(section.emptyNote || '') +
        '</div>';
    }

    function libraryGetTabSections(tabId) {
        var groupIds = LIBRARY_GROUP_IDS[tabId] || [];
        var result = [];
        for (var i = 0; i < (libraryCatalog.sections || []).length; i++) {
            var section = libraryCatalog.sections[i];
            if (groupIds.indexOf(section.groupId || 'general') !== -1) {
                result.push(section);
            }
        }
        return result;
    }

    function libraryLoadTabContent(tabId) {
        tabId = tabId || libraryActiveTab;
        var root = document.getElementById('student-library-content');
        var subTabBar = document.getElementById('student-sub-tab-bar');
        var yearBar = document.getElementById('student-year-bar');
        if (!root) return;

        if (!libraryCatalog || !libraryCatalog.sections) {
            root.innerHTML = '<p class="section-description">Unable to load the library catalog.</p>';
            return;
        }

        var subTabs = LIBRARY_SUB_TABS[tabId];
        if (!subTabs) {
            root.innerHTML = '<p class="section-description">Unknown tab.</p>';
            return;
        }

        var searchText = String(resourceSearch.value || '').trim().toLowerCase();

        var subTabHtml = '';
        for (var si = 0; si < subTabs.length; si++) {
            var isActive = (!libraryActiveSubTab && si === 0) || subTabs[si].id === libraryActiveSubTab;
            subTabHtml += '<button class="sub-tab-btn' + (isActive ? ' active' : '') + '" data-subtab="' + escapeHtml(subTabs[si].id) + '">' + escapeHtml(subTabs[si].label) + '</button>';
        }
        subTabBar.innerHTML = subTabHtml;
        subTabBar.style.display = 'flex';

        var activeSubTabConfig = subTabs[0];
        for (var si = 0; si < subTabs.length; si++) {
            if ((!libraryActiveSubTab && si === 0) || subTabs[si].id === libraryActiveSubTab) {
                activeSubTabConfig = subTabs[si];
                break;
            }
        }

        var tabSections = libraryGetTabSections(tabId);
        var targetSectionId = activeSubTabConfig.sectionId || activeSubTabConfig.id;

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

        var showYearFilter = false;
        var activeYear = '';
        var yearSectionId = '';
        if (activeSubTabConfig.yearFilter) {
            yearSectionId = targetSectionId;
            var yearSection = null;
            for (var i = 0; i < libraryCatalog.sections.length; i++) {
                if (libraryCatalog.sections[i].id === targetSectionId) {
                    yearSection = libraryCatalog.sections[i];
                    break;
                }
            }
            if (yearSection) {
                var yearItems = librarySortItems(itemsBySection[targetSectionId] || [], yearSection);
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
            if (!librarySubTabMatchesSection(activeSubTabConfig, section)) continue;

            var sectionItems = (itemsBySection[section.id] || []).filter(function(item) {
                if (!librarySubTabMatchesItem(activeSubTabConfig, item)) return false;
                if (!searchText) return true;
                return [
                    item.title, item.id, item.set_id, item.topic, item.displayValue,
                    (item.tags || []).join(' ')
                ].join(' ').toLowerCase().indexOf(searchText) !== -1;
            });

            if (section.id === yearSectionId && !sectionItems.length) {
                cardsHtml += libraryBuildPlaceholderCard(section);
                continue;
            }
            var sortedItems = librarySortItems(sectionItems, section);

            if (sortedItems.length) {
                for (var k = 0; k < sortedItems.length; k++) {
                    var item = sortedItems[k];
                    var itemYear = section.yearFilter ? libraryItemYear(item) : '';
                    var hidden = activeYear && itemYear !== activeYear;
                    cardsHtml += libraryBuildCard(item, section, hidden ? 'year-hidden' : '', itemYear);
                }
            } else if (!targetSectionId && !section.yearFilter) {
                cardsHtml += libraryBuildPlaceholderCard(section);
            }
        }

        if (targetSectionId && !cardsHtml && !activeSubTabConfig.vocabularySource) {
            for (var i = 0; i < libraryCatalog.sections.length; i++) {
                if (libraryCatalog.sections[i].id === targetSectionId) {
                    cardsHtml = libraryBuildPlaceholderCard(libraryCatalog.sections[i]);
                    break;
                }
            }
        }

        if (!cardsHtml) {
            cardsHtml = '<p class="section-description">No content yet.</p>';
        }

        root.innerHTML = '<div class="resource-list library-task-list student-library-list">' + cardsHtml + '</div>';
    }

    function librarySwitchTab(tabId) {
        if (tabId === libraryActiveTab) return;
        libraryActiveTab = tabId;
        libraryActiveSubTab = '';
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

    function wordLearningStatus(word) {
        return word && word.learning_status || 'new';
    }

    function wordIsDue(word) {
        if (!word || (word.status || 'active') !== 'active') return false;
        var due = new Date(word.review_due_at || word.created_at || 0).getTime();
        return !due || due <= Date.now();
    }

    function wordPrimaryHtml(word) {
        var dictionary = word && word.dictionary;
        if (!dictionary) {
            var status = word && word.lookup_status || 'pending';
            return '<div class="my-word-primary-copy">' +
                '<span class="my-word-pos">—</span>' +
                '<span class="my-word-chinese">' + (status === 'not_found' ? '暂未找到中文释义' : '正在查找释义…') + '</span>' +
            '</div>';
        }
        return '<div class="my-word-primary-copy">' +
            '<span class="my-word-pos">' + escapeHtml(dictionary.part_of_speech || '—') + '</span>' +
            '<span class="my-word-chinese">' + escapeHtml(dictionary.chinese_meaning || '暂无中文释义') + '</span>' +
        '</div>';
    }

    function wordDetailHtml(word) {
        var dictionary = word && word.dictionary;
        var status = wordLearningStatus(word);
        var statusLabel = status === 'mastered' ? 'Mastered' : (status === 'learning' ? 'Learning' : 'New');
        var source = wordSourceLabel(word);
        var date = wordTimeLabel(word);
        if (!dictionary) {
            var lookupStatus = word && word.lookup_status || 'pending';
            return '<div class="my-word-detail-copy muted">' +
                '<p>' + (lookupStatus === 'not_found' ? 'Dictionary entry not found yet.' : 'Finding dictionary details...') + '</p>' +
                (lookupStatus === 'not_found' ? '<button class="my-word-lookup" type="button" data-lookup-word="' + escapeHtml(word.vocab_id || '') + '">Retry</button>' : '') +
                (word.context ? '<blockquote>' + escapeHtml(word.context) + '</blockquote>' : '') +
                '<p class="my-word-detail-meta">' + escapeHtml(source) + (date ? ' · ' + escapeHtml(date) : '') + '</p>' +
                '<div class="my-word-detail-actions"><span class="my-word-learning-status ' + escapeHtml(status) + '">' + statusLabel + '</span>' +
                    (status !== 'mastered' ? '<button class="outline-button" type="button" data-master-word="' + escapeHtml(word.vocab_id || '') + '">Mark mastered</button>' : '<button class="outline-button" type="button" data-learn-word="' + escapeHtml(word.vocab_id || '') + '">Review again</button>') +
                    '<button class="outline-button" type="button" data-archive-word="' + escapeHtml(word.vocab_id || '') + '">Archive</button></div>' +
            '</div>';
        }
        return '<div class="my-word-detail-copy">' +
            (dictionary.phonetic ? '<p class="my-word-phonetic">' + escapeHtml(dictionary.phonetic) + '</p>' : '') +
            (dictionary.english_definition ? '<p class="my-word-definition">' + escapeHtml(dictionary.english_definition) + '</p>' : '') +
            (dictionary.word_forms ? '<p><strong>Forms:</strong> ' + escapeHtml(dictionary.word_forms) + '</p>' : '') +
            (word.context ? '<blockquote>' + escapeHtml(word.context) + '</blockquote>' : '') +
            '<p class="my-word-detail-meta">' + escapeHtml(source) + (date ? ' · ' + escapeHtml(date) : '') + '</p>' +
            '<div class="my-word-detail-actions">' +
                '<span class="my-word-learning-status ' + escapeHtml(status) + '">' + statusLabel + '</span>' +
                (status !== 'mastered' ? '<button class="outline-button" type="button" data-master-word="' + escapeHtml(word.vocab_id || '') + '">Mark mastered</button>' : '<button class="outline-button" type="button" data-learn-word="' + escapeHtml(word.vocab_id || '') + '">Review again</button>') +
                '<button class="outline-button" type="button" data-archive-word="' + escapeHtml(word.vocab_id || '') + '">Archive</button>' +
            '</div>' +
        '</div>';
    }

    function wordCardHtml(word) {
        var dictionary = word && word.dictionary || {};
        var spokenWord = dictionary.word || word.text || '';
        var detailId = 'my-word-detail-' + escapeHtml(word.vocab_id || 'word');
        return '<article class="my-word-item">' +
            '<div class="my-word-summary">' +
                '<button class="my-word-toggle" type="button" data-toggle-word="' + escapeHtml(word.vocab_id || '') + '" aria-expanded="false" aria-controls="' + detailId + '">' +
                    '<strong>' + escapeHtml(word.text || '') + '</strong>' +
                    wordPrimaryHtml(word) +
                '</button>' +
                '<button class="my-word-speak" type="button" data-speak-word="' + escapeHtml(spokenWord) + '" aria-label="Pronounce ' + escapeHtml(spokenWord) + '">🔊</button>' +
            '</div>' +
            '<div class="my-word-detail" id="' + detailId + '" hidden>' + wordDetailHtml(word) + '</div>' +
        '</article>';
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
            var learningStatus = wordLearningStatus(word);
            if (state.vocabFilter === 'today' && !wordIsDue(word)) return false;
            if (['new', 'learning', 'mastered'].indexOf(state.vocabFilter) !== -1 && learningStatus !== state.vocabFilter) return false;
            if (!query) return true;
            return [
                word.text,
                word.normalized_text,
                word.source_title,
                word.source_set_id,
                word.context,
                word.dictionary && word.dictionary.chinese_meaning,
                word.dictionary && word.dictionary.english_definition,
                word.dictionary && word.dictionary.part_of_speech
            ].join(' ').toLowerCase().indexOf(query) !== -1;
        });
    }

    function myWordsListHtml() {
        var words = filteredVocabItems();
        if (!words.length) {
            return '<div class="my-words-empty">' +
                (state.vocabSearch ? 'No saved words match this search.' : (state.vocabFilter !== 'all' ? 'No saved words in this view.' : 'Select a word or short phrase anywhere in the site to save it here.')) +
            '</div>';
        }
        return '<div class="my-words-table" aria-label="Saved words">' + words.map(wordCardHtml).join('') + '</div>';
    }

    function upsertVocabItem(word) {
        if (!word || !word.vocab_id) return;
        var next = (state.vocabItems || []).filter(function(item) {
            return item.vocab_id !== word.vocab_id;
        });
        next.unshift(word);
        state.vocabItems = next;
    }

    function manualWordValidation(text) {
        var clean = String(text || '').replace(/\s+/g, ' ').trim();
        if (!clean) return 'Enter a word or short phrase first.';
        if (clean.length > 120 || clean.split(/\s+/).filter(Boolean).length > 16) {
            return 'Please add one word or a short phrase at a time.';
        }
        if (!/[\p{L}\p{N}]/u.test(clean)) return 'Use letters or numbers in the word.';
        return '';
    }

    function bindManualWordAdd() {
        var form = document.getElementById('my-words-manual-form');
        if (!form) return;
        var textInput = document.getElementById('my-words-manual-text');
        var contextInput = document.getElementById('my-words-manual-context');
        var status = document.getElementById('my-words-manual-status');
        var submit = document.getElementById('my-words-manual-submit');
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            var text = String(textInput && textInput.value || '').replace(/\s+/g, ' ').trim();
            var context = String(contextInput && contextInput.value || '').replace(/\s+/g, ' ').trim();
            var validation = manualWordValidation(text);
            if (validation) {
                if (status) status.textContent = validation;
                if (textInput) textInput.focus();
                return;
            }
            if (!window.MrCatCloud || typeof window.MrCatCloud.callFunction !== 'function') {
                if (status) status.textContent = 'Word saving is not available right now.';
                return;
            }
            if (submit) {
                submit.disabled = true;
                submit.textContent = 'Adding...';
            }
            if (status) status.textContent = '';
            window.MrCatCloud.callFunction('studentVocabulary', {
                action: 'add',
                text: text,
                source_set_id: null,
                source_title: 'My Words',
                source_path: 'dashboard.html#my-words',
                context: context
            }).then(function(result) {
                if (!result || !result.success) throw new Error(result && result.message || 'Unable to add this word.');
                upsertVocabItem(result.word);
                if (textInput) textInput.value = '';
                if (contextInput) contextInput.value = '';
                if (status) status.textContent = result.word && result.word.dictionary
                    ? (result.created ? 'Added with dictionary details.' : 'Already saved. Dictionary details are ready.')
                    : (result.created ? 'Added. Finding dictionary details...' : 'Already saved. Checking dictionary details...');
                renderMyWordsList();
                if (window.MrCatPersonalVocab && window.MrCatPersonalVocab.enrichWord) {
                    window.MrCatPersonalVocab.enrichWord(result.word, false);
                }
            }).catch(function(error) {
                if (status) status.textContent = error.message || 'Unable to add this word.';
            }).finally(function() {
                if (submit) {
                    submit.disabled = false;
                    submit.textContent = 'Add';
                }
            });
        });
    }

    function bindMyWordActions() {
        document.querySelectorAll('[data-toggle-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                var detail = document.getElementById(button.getAttribute('aria-controls'));
                if (!detail) return;
                var open = detail.hidden;
                detail.hidden = !open;
                button.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        });
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
        document.querySelectorAll('[data-master-word], [data-learn-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                var vocabId = button.dataset.masterWord || button.dataset.learnWord;
                var learningStatus = button.dataset.masterWord ? 'mastered' : 'learning';
                if (!vocabId) return;
                button.disabled = true;
                window.MrCatCloud.callFunction('studentVocabulary', {
                    action: 'setLearningStatus',
                    vocab_id: vocabId,
                    learning_status: learningStatus
                }).then(function(result) {
                    if (!result || !result.success || !result.word) throw new Error('Unable to update learning status.');
                    upsertVocabItem(result.word);
                    renderMyWordsList();
                }).catch(function(error) {
                    button.disabled = false;
                    alert(error.message || 'Unable to update learning status.');
                });
            });
        });
        document.querySelectorAll('[data-speak-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                var value = button.dataset.speakWord || '';
                if (!value || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
                window.speechSynthesis.cancel();
                var utterance = new SpeechSynthesisUtterance(value);
                utterance.lang = 'en-GB';
                window.speechSynthesis.speak(utterance);
            });
        });
        document.querySelectorAll('[data-lookup-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                var vocabId = button.dataset.lookupWord;
                if (!vocabId) return;
                button.disabled = true;
                button.textContent = 'Looking up...';
                window.MrCatCloud.callFunction('studentVocabulary', {
                    action: 'enrich',
                    vocab_id: vocabId,
                    force: true
                }).then(function(result) {
                    if (!result || !result.success || !result.word) throw new Error('Dictionary lookup unavailable.');
                    upsertVocabItem(result.word);
                    renderMyWordsList();
                }).catch(function() {
                    button.disabled = false;
                    button.textContent = 'Retry';
                });
            });
        });
    }

    function dueVocabItems() {
        return sortedVocabItems(state.vocabItems || []).filter(wordIsDue);
    }

    function currentReviewWord() {
        var due = dueVocabItems();
        var selected = due.find(function(word) { return word.vocab_id === state.vocabReviewWordId; });
        if (selected) return selected;
        state.vocabReviewWordId = due[0] && due[0].vocab_id || '';
        return due[0] || null;
    }

    function reviewWordHtml() {
        var due = dueVocabItems();
        var word = currentReviewWord();
        if (!word) {
            return '<section class="my-words-review complete">' +
                '<p class="eyebrow accent">Review complete</p><h2>You are caught up.</h2>' +
                '<p class="muted">Come back when the next words are due.</p>' +
                '<button class="primary-button" type="button" data-review-exit>Back to My Words</button>' +
            '</section>';
        }
        var dictionary = word.dictionary || {};
        var spokenWord = dictionary.word || word.text || '';
        return '<section class="my-words-review">' +
            '<div class="my-words-review-head"><span>' + due.length + ' due</span><button class="outline-button" type="button" data-review-exit>Exit review</button></div>' +
            '<div class="my-words-review-card">' +
                '<div class="my-words-review-word"><h2>' + escapeHtml(word.text || '') + '</h2>' +
                    '<button class="my-word-speak" type="button" data-speak-word="' + escapeHtml(spokenWord) + '" aria-label="Pronounce ' + escapeHtml(spokenWord) + '">🔊</button>' +
                '</div>' +
                (state.vocabReviewRevealed ? '<div class="my-words-review-answer">' +
                    '<p><strong>' + escapeHtml(dictionary.part_of_speech || '—') + '</strong></p>' +
                    '<p class="my-word-chinese">' + escapeHtml(dictionary.chinese_meaning || '暂无中文释义') + '</p>' +
                    (dictionary.english_definition ? '<p class="my-word-definition">' + escapeHtml(dictionary.english_definition) + '</p>' : '') +
                    (word.context ? '<blockquote>' + escapeHtml(word.context) + '</blockquote>' : '') +
                '</div>' : '<button class="primary-button my-words-reveal" type="button" data-review-reveal>Reveal meaning</button>') +
                (state.vocabReviewRevealed ? '<div class="my-words-review-ratings">' +
                    '<button type="button" data-review-rating="forgot">Forgot</button>' +
                    '<button type="button" data-review-rating="fuzzy">A little</button>' +
                    '<button type="button" data-review-rating="know">Know</button>' +
                '</div>' : '') +
            '</div>' +
        '</section>';
    }

    function bindReviewActions() {
        document.querySelectorAll('[data-review-exit]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.vocabReviewMode = false;
                state.vocabReviewRevealed = false;
                state.vocabReviewWordId = '';
                renderMyWordsView();
            });
        });
        var reveal = document.querySelector('[data-review-reveal]');
        if (reveal) reveal.addEventListener('click', function() {
            state.vocabReviewRevealed = true;
            renderMyWordsView();
        });
        document.querySelectorAll('[data-review-rating]').forEach(function(button) {
            button.addEventListener('click', function() {
                var word = currentReviewWord();
                if (!word) return;
                document.querySelectorAll('[data-review-rating]').forEach(function(item) { item.disabled = true; });
                window.MrCatCloud.callFunction('studentVocabulary', {
                    action: 'review',
                    vocab_id: word.vocab_id,
                    rating: button.dataset.reviewRating
                }).then(function(result) {
                    if (!result || !result.success || !result.word) throw new Error('Unable to save review.');
                    upsertVocabItem(result.word);
                    state.vocabReviewRevealed = false;
                    state.vocabReviewWordId = '';
                    renderMyWordsView();
                }).catch(function(error) {
                    alert(error.message || 'Unable to save review.');
                    renderMyWordsView();
                });
            });
        });
        bindMyWordActions();
    }

    function enrichPendingVocabItems(items) {
        if (!window.MrCatPersonalVocab || !window.MrCatPersonalVocab.enrichWord) return;
        (items || []).filter(function(word) {
            return word && !word.dictionary && (word.lookup_status || 'pending') === 'pending';
        }).slice(0, 8).forEach(function(word, index) {
            window.setTimeout(function() {
                window.MrCatPersonalVocab.enrichWord(word, false);
            }, index * 180);
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
        document.querySelectorAll('[data-vocab-filter]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.vocabFilter = button.dataset.vocabFilter || 'all';
                renderMyWordsView();
            });
        });
        var reviewStart = document.getElementById('my-words-review-start');
        if (reviewStart) reviewStart.addEventListener('click', function() {
            state.vocabReviewMode = true;
            state.vocabReviewRevealed = false;
            state.vocabReviewWordId = '';
            renderMyWordsView();
        });
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
                    enrichPendingVocabItems(state.vocabItems);
                }).catch(function(error) {
                    alert(error.message || 'Unable to load My Words.');
                }).finally(function() {
                    refresh.disabled = false;
                    refresh.textContent = 'Refresh';
                });
            });
        }
        bindMyWordActions();
        bindManualWordAdd();
    }

    function renderMyWordsCard() {
        var activeCount = (state.vocabItems || []).filter(function(word) {
            return (word.status || 'active') === 'active';
        }).length;
        var dueCount = dueVocabItems().length;
        var filters = [
            { id: 'all', label: 'All' },
            { id: 'today', label: 'Today' },
            { id: 'new', label: 'New' },
            { id: 'learning', label: 'Learning' },
            { id: 'mastered', label: 'Mastered' }
        ];
        return '<section class="profile-card my-words-card">' +
            '<div class="my-words-head">' +
                '<div>' +
                    '<p class="eyebrow accent">My Words</p>' +
                    '<h2>My Words</h2>' +
                '</div>' +
                '<span class="badge neutral" id="my-words-count">' + activeCount + ' saved</span>' +
            '</div>' +
            '<form class="my-words-manual" id="my-words-manual-form">' +
                '<input id="my-words-manual-text" class="resource-search" type="text" maxlength="120" placeholder="Add a word or phrase...">' +
                '<input id="my-words-manual-context" class="resource-search" type="text" maxlength="320" placeholder="Optional note or context...">' +
                '<button class="primary-button my-word-add" id="my-words-manual-submit" type="submit">Add</button>' +
                '<span class="my-words-manual-status" id="my-words-manual-status" role="status" aria-live="polite"></span>' +
            '</form>' +
            '<div class="my-words-tools">' +
                '<input id="my-words-search" class="resource-search" type="search" placeholder="Search saved words...">' +
                '<button class="outline-button my-word-refresh" id="my-words-refresh" type="button">Refresh</button>' +
            '</div>' +
            '<div class="my-words-learning-tools">' +
                '<div class="my-words-filters" aria-label="Filter saved words">' + filters.map(function(filter) {
                    return '<button class="' + (state.vocabFilter === filter.id ? 'active' : '') + '" type="button" data-vocab-filter="' + filter.id + '">' + filter.label + '</button>';
                }).join('') + '</div>' +
                '<button class="primary-button my-words-review-start" id="my-words-review-start" type="button"' + (dueCount ? '' : ' disabled') + '>Review due (' + dueCount + ')</button>' +
            '</div>' +
            '<div class="my-words-list" id="my-words-list">' + myWordsListHtml() + '</div>' +
        '</section>';
    }

    function renderMyWordsView() {
        if (!myWordsContent) return;
        if (!state.session) {
            myWordsContent.innerHTML = '<div class="profile-card loading-card">Loading My Words...</div>';
            return;
        }
        if (state.session.mode === 'visitor') {
            myWordsContent.innerHTML =
                '<div class="profile-card"><h2>My Words</h2><p class="muted">Log in as a student to save words and phrases.</p>' +
                '<div class="profile-actions"><button class="primary-button" id="words-login">Log In</button></div></div>';
            document.getElementById('words-login').addEventListener('click', function() {
                window.location.href = 'index.html';
            });
            return;
        }
        if (state.vocabReviewMode) {
            myWordsContent.innerHTML = reviewWordHtml();
            bindReviewActions();
            return;
        }
        myWordsContent.innerHTML = renderMyWordsCard();
        bindMyWordsCard();
    }

    function rememberedMyWordsScrollTop() {
        if (state.myWordsScrollTop > 0) return state.myWordsScrollTop;
        try {
            return Math.max(0, Number(sessionStorage.getItem('mrcat_my_words_scroll_top') || 0));
        } catch (error) {
            return 0;
        }
    }

    function saveMyWordsScrollPosition() {
        if (!wordsScroll) return;
        state.myWordsScrollTop = Math.max(0, wordsScroll.scrollTop || 0);
        try {
            sessionStorage.setItem('mrcat_my_words_scroll_top', String(state.myWordsScrollTop));
        } catch (error) {}
    }

    function setWordsPanel(open) {
        state.wordsPanelOpen = open === true;
        if (!wordsOverlay) return;
        if (!state.wordsPanelOpen) saveMyWordsScrollPosition();
        wordsOverlay.hidden = !state.wordsPanelOpen;
        if (wordsButton) {
            wordsButton.classList.toggle('active', state.wordsPanelOpen);
            wordsButton.setAttribute('aria-expanded', state.wordsPanelOpen ? 'true' : 'false');
        }
        if (!state.wordsPanelOpen) return;
        setAccountPanel(false);
        renderMyWordsView();
        window.requestAnimationFrame(function() {
            if (wordsScroll) wordsScroll.scrollTop = rememberedMyWordsScrollTop();
            var close = document.getElementById('student-words-close');
            if (close) close.focus({ preventScroll: true });
        });
    }

    function renderProfile() {
        if (!profileContent) return;
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
        var finishedCount = (state.assignments || []).filter(function(item) {
            return isFinishedStatus(item.status);
        }).length;
        profileContent.innerHTML =
            '<div class="profile-grid">' +
                '<section class="profile-card account-summary-card">' +
                    '<div class="account-name-row">' +
                        '<h2 class="account-summary-name">' + escapeHtml(profile.name || profile.student_id) + '</h2>' +
                        '<strong class="account-star-pair">' +
                            '<span class="star-counter assignment-star-counter account-row-star" id="star-counter">★ ' + escapeHtml(state.assignmentStarCount) + '</span>' +
                            '<span class="star-counter self-study-star-counter account-row-star" id="self-study-star-counter">★ ' + escapeHtml(state.selfStudyStarCount) + '</span>' +
                        '</strong>' +
                    '</div>' +
                    '<div class="profile-row"><span>Student ID</span><strong>' + escapeHtml(profile.student_id) + '</strong></div>' +
                    '<div class="profile-row"><span>Class</span><strong>' + escapeHtml(profile.class_group || 'Not set') + '</strong></div>' +
                    '<div class="profile-row"><span>System</span><strong>' + escapeHtml(profile.curriculum_track || 'Not set') + '</strong></div>' +
                    '<div class="profile-row account-final-row"><span>Finished</span><strong>' + escapeHtml(finishedCount) + '</strong></div>' +
                    '<div class="account-quiet-footer">' +
                        '<div class="account-quiet-actions">' +
                            '<button class="text-button" id="change-password" type="button">Change password</button>' +
                            '<button class="text-button danger-text-button" id="logout-button" type="button">Log out</button>' +
                        '</div>' +
                    '</div>' +
                '</section>' +
            '</div>';
        starCounter = document.getElementById('star-counter');
        selfStudyStarCounter = document.getElementById('self-study-star-counter');
        updateStarCounter(false);
        document.getElementById('logout-button').addEventListener('click', window.MrCatAuth.logout);
        document.getElementById('change-password').addEventListener('click', function() {
            openChangePasswordDialog();
        });
    }

    function setAccountPanel(open) {
        state.accountPanelOpen = open === true;
        if (accountPanel) accountPanel.hidden = !state.accountPanelOpen;
        if (identityChip) identityChip.setAttribute('aria-expanded', state.accountPanelOpen ? 'true' : 'false');
        if (state.accountPanelOpen) renderProfile();
    }

    function loadPublicCatalog() {
        return fetch('data/home-catalog.json?v=' + encodeURIComponent(appVersion()))
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
        return fetch('data/home-catalog.json?v=' + encodeURIComponent(appVersion()))
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
            enrichPendingVocabItems(state.vocabItems);
            if (!state.resources.length) return loadPublicCatalog().then(function(items) { state.resources = items; });
            return loadPublicCatalogSections();
        });
    }

    function initialDashboardView() {
        var view = new URLSearchParams(window.location.search).get('view') || '';
        return dashboardViews.indexOf(view) === -1 ? 'resources' : view;
    }

    function rememberDashboardView(viewName) {
        if (dashboardViews.indexOf(viewName) === -1 || !window.history || !window.history.replaceState) return;
        var url = new URL(window.location.href);
        if (viewName === 'resources') url.searchParams.delete('view');
        else url.searchParams.set('view', viewName);
        window.history.replaceState({}, '', url);
    }

    function activateView(viewName, skipUrlUpdate) {
        if (dashboardViews.indexOf(viewName) === -1) viewName = 'resources';
        document.querySelectorAll('.tab-button').forEach(function(button) {
            button.classList.toggle('active', button.dataset.view === viewName);
        });
        document.querySelectorAll('.dashboard-view').forEach(function(view) {
            view.hidden = view.id !== 'view-' + viewName;
        });
        if (!skipUrlUpdate) rememberDashboardView(viewName);
    }

    document.querySelectorAll('.tab-button').forEach(function(button) {
        button.addEventListener('click', function() {
            activateView(button.dataset.view);
            setAccountPanel(false);
        });
    });
    if (identityChip) {
        identityChip.addEventListener('click', function(event) {
            event.stopPropagation();
            setAccountPanel(!state.accountPanelOpen);
        });
    }
    var accountClose = document.getElementById('student-account-close');
    if (accountClose) {
        accountClose.addEventListener('click', function() {
            setAccountPanel(false);
        });
    }
    if (messageButton) {
        messageButton.addEventListener('click', function() {
            openStudentMessageCenter();
        });
    }
    if (wordsButton) {
        wordsButton.addEventListener('click', function() {
            setWordsPanel(true);
        });
    }
    var wordsClose = document.getElementById('student-words-close');
    if (wordsClose) {
        wordsClose.addEventListener('click', function() {
            setWordsPanel(false);
        });
    }
    if (wordsOverlay) {
        wordsOverlay.addEventListener('click', function(event) {
            if (event.target === wordsOverlay) setWordsPanel(false);
        });
    }
    resourceSearch.addEventListener('input', function() {
        libraryLoadTabContent(libraryActiveTab);
    });

    document.addEventListener('click', function(e) {
        if (state.accountPanelOpen && accountPanel && !accountPanel.contains(e.target) && !e.target.closest('#identity-chip')) {
            setAccountPanel(false);
        }
        var openCard = e.target.closest('[data-open-href]');
        if (openCard) {
            openHrefCard(openCard, e);
            return;
        }
        var progressDay = e.target.closest('[data-progress-day]');
        if (progressDay) {
            state.progressSelectedDay = progressDay.dataset.progressDay || '';
            renderProgressBoard();
            return;
        }
        var progressWeek = e.target.closest('[data-progress-week]');
        if (progressWeek) {
            state.progressSelectedDay = progressWeek.dataset.progressWeek || '';
            renderProgressBoard();
            return;
        }
        var tabBtn = e.target.closest('.library-tab-btn');
        if (tabBtn) {
            librarySwitchTab(tabBtn.getAttribute('data-tab'));
            return;
        }
        var subTabBtn = e.target.closest('#student-sub-tab-bar .sub-tab-btn');
        if (subTabBtn) {
            var subTab = subTabBtn.getAttribute('data-subtab');
            if (subTab === libraryActiveSubTab) return;
            libraryActiveSubTab = subTab;
            libraryLoadTabContent(libraryActiveTab);
            return;
        }
        var yearTab = e.target.closest('#student-year-bar .year-tab');
        if (yearTab) {
            var year = yearTab.getAttribute('data-year');
            var tabsContainer = yearTab.closest('.year-tabs');
            if (tabsContainer) {
                var tabs = tabsContainer.querySelectorAll('.year-tab');
                for (var ti = 0; ti < tabs.length; ti++) {
                    tabs[ti].classList.toggle('active', tabs[ti] === yearTab);
                }
                var cardsRoot = document.getElementById('student-library-content');
                if (cardsRoot) {
                    var cards = cardsRoot.querySelectorAll('.library-task-card');
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

    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && state.wordsPanelOpen) {
            setWordsPanel(false);
            if (wordsButton) wordsButton.focus();
            return;
        }
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var openCard = e.target.closest('[data-open-href]');
        if (!openCard) return;
        if (e.target.closest('button, a')) return;
        e.preventDefault();
        openHrefCard(openCard, e);
    });

    window.addEventListener('mrcat:vocab-saved', function(event) {
        if (!state.session || state.session.mode !== 'student') return;
        var word = event.detail;
        if (!word || !word.vocab_id) return;
        state.vocabItems = (state.vocabItems || []).filter(function(item) {
            return item.vocab_id !== word.vocab_id;
        });
        state.vocabItems.unshift(word);
        if (state.wordsPanelOpen) renderMyWordsView();
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
            renderProgressBoard();
            renderAssignments();
            libraryLoadTabContent(libraryActiveTab);
            renderProfile();
            activateView(initialDashboardView(), true);
            if (new URLSearchParams(window.location.search).get('view') === 'words') {
                setWordsPanel(true);
            }
        })
        .catch(function(error) {
            assignmentContent.innerHTML = '<div class="empty-card"><strong>Unable to load the dashboard</strong>' + escapeHtml(error.message || 'Please sign in again.') + '</div>';
        });
})();
