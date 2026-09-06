(function() {
    'use strict';

    if (window.location && window.location.hash === '#my-words') {
        window.location.replace('my-words.html');
        return;
    }

    var state = {
        session: null,
        assignments: [],
        assignmentCounts: null,
        weeklySummary: null,
        assignmentsComplete: false,
        assignmentPages: {
            todo: { nextCursor: null, hasMore: false, loading: false },
            finished: { nextCursor: null, hasMore: false, loading: false }
        },
        resources: [],
        libraryProgress: [],
        resourceFilter: 'vocabulary',
        resourceBookFilters: {},
        starCount: 0,
        assignmentStarCount: 0,
        selfStudyStarCount: 0,
        starAchievements: [],
        accountStarView: '',
        starPanelOpen: false,
        starRewards: { available: false, wallet: null, cash_requests: [], unread_count: 0 },
        teacherReplies: [],
        teacherReplyUnreadCount: 0,
        teacherRepliesComplete: false,
        vocabItems: [],
        vocabTotalCount: 0,
        vocabSearch: '',
        vocabExportOpen: false,
        vocabExportRange: 'all',
        vocabSelected: {},
        vocabExpanded: {},
        vocabEditingId: '',
        vocabNoteEditingId: '',
        accountPanelOpen: false,
        calendarPanelOpen: false,
        calendarYear: null,
        calendarMonth: null,
        calendarSelectedDay: '',
        achievementCalendar: null,
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
    var studentGreetingResizeObserver = null;
    var studentGreetingLine = document.getElementById('student-greeting-line');
    var studentGreetingPrimary = document.getElementById('student-greeting-primary');
    var studentGreetingMotivation = document.getElementById('student-greeting-motivation');
    var studentGreetingAccessible = document.getElementById('student-greeting-accessible');
    var studentSkillEntries = document.querySelector('.student-skill-entries');
    var studentSkillSentenceResizeObserver = null;
    var workspaceConfirmOverlay = document.getElementById('student-workspace-confirm-overlay');
    var workspaceConfirmIcon = document.getElementById('student-workspace-confirm-icon');
    var workspaceConfirmTitle = document.getElementById('student-workspace-confirm-title');
    var workspaceConfirmCopy = document.getElementById('student-workspace-confirm-copy');
    var workspaceConfirmCancel = document.getElementById('student-workspace-confirm-cancel');
    var workspaceConfirmSubmit = document.getElementById('student-workspace-confirm-submit');
    var workspaceConfirmTrigger = null;
    var workspaceConfirmHref = '';
    var workspaceConfirmCloseTimer = null;
    var weeklyFocusProgress = document.getElementById('weekly-focus-progress');
    var achievementsPanel = document.getElementById('student-achievements-panel');
    var achievementsTotal = document.getElementById('student-achievements-total');
    var achievementsScroll = document.getElementById('student-achievements-scroll');
    var achievementsStatus = document.getElementById('student-achievements-status');
    var assignmentContent = document.getElementById('assignment-content');
    var resourceList = document.getElementById('resource-list');
    var profileContent = document.getElementById('profile-content');
    var starOverlay = document.getElementById('student-star-overlay');
    var starContent = document.getElementById('student-star-content');
    var myWordsContent = document.getElementById('my-words-content');
    var resourceSearch = document.getElementById('resource-search');
    var resourceSearchToggle = document.getElementById('resource-search-toggle');
    var resourceSearchClose = document.getElementById('resource-search-close');
    var studentLibraryDock = document.getElementById('student-library-dock');
    var studentLibrarySearchPanel = document.getElementById('student-library-search-panel');
    var studentLibraryCategoryMenu = document.getElementById('student-library-category-menu');
    var studentLibraryCategoryTrigger = document.getElementById('student-library-category-trigger');
    var studentLibraryCategoryLabel = document.getElementById('student-library-category-label');
    var studentLibraryCategoryPopover = document.getElementById('student-sub-tab-bar');
    var accountPanel = document.getElementById('student-account-panel');
    var logoutConfirmOverlay = document.getElementById('logout-confirm-overlay');
    var calendarOverlay = document.getElementById('student-calendar-overlay');
    var calendarContent = document.getElementById('student-calendar-content');
    var calendarScroll = document.getElementById('student-calendar-scroll');
    var calendarTrigger = null;
    var wordsButton = document.getElementById('student-words-button');
    var wordsOpenLink = document.querySelector('.student-words-open-button');
    var myWordsWarmPromise = null;
    var studentDashboardWarmPromise = null;
    var studentDashboardCacheName = 'mrcat-student-dashboard-v1';
    var studentDashboardCacheStore = 'snapshots';
    var studentDashboardCacheMaxAge = 24 * 60 * 60 * 1000;

    function studentDashboardOwner() {
        var profile = state.session && state.session.profile || {};
        return String(profile.auth_uid || profile.student_id || '');
    }

    function openStudentDashboardCache() {
        if (!window.indexedDB) return Promise.reject(new Error('IndexedDB unavailable'));
        return new Promise(function(resolve, reject) {
            var request = window.indexedDB.open(studentDashboardCacheName, 1);
            request.onupgradeneeded = function() {
                var database = request.result;
                if (!database.objectStoreNames.contains(studentDashboardCacheStore)) {
                    database.createObjectStore(studentDashboardCacheStore, { keyPath: 'owner' });
                }
            };
            request.onsuccess = function() { resolve(request.result); };
            request.onerror = function() { reject(request.error || new Error('Unable to open Dashboard cache')); };
        });
    }

    function withStudentDashboardCache(mode, callback) {
        return openStudentDashboardCache().then(function(database) {
            return new Promise(function(resolve, reject) {
                var transaction = database.transaction(studentDashboardCacheStore, mode);
                var store = transaction.objectStore(studentDashboardCacheStore);
                var result;
                try {
                    result = callback(store);
                } catch (error) {
                    database.close();
                    reject(error);
                    return;
                }
                transaction.oncomplete = function() {
                    database.close();
                    resolve(result && result.result);
                };
                transaction.onerror = function() {
                    database.close();
                    reject(transaction.error || new Error('Dashboard cache transaction failed'));
                };
            });
        });
    }

    function safeCachedAssignment(item) {
        if (!item || typeof item !== 'object') return null;
        var safe = {};
        [
            'assignment_id', 'achievement_id', 'source', 'status', 'assigned_at',
            'due_at', 'created_at', 'completed_at', 'mastered_at', 'updated_at',
            'best_improved_at', 'progress_updated_at', 'latest_submitted_at',
            'attempt_count', 'latest_percentage', 'best_percentage',
            'best_correct_count', 'best_question_count', 'review_attempt_id',
            'history_attempt_id', 'prefill_attempt_id', 'answer_revealed',
            'mastery_locked', 'completed_before_assignment', 'star_claimed',
            'passing_percentage', 'mastery_percentage', 'mastery_enabled'
        ].forEach(function(key) {
            if (Object.prototype.hasOwnProperty.call(item, key)) safe[key] = item[key];
        });
        safe.teacher_replies = [];
        safe.teacher_reply_count = Number(item.teacher_reply_count || 0);
        var sourceSet = item.set && typeof item.set === 'object' ? item.set : {};
        safe.set = {};
        [
            'set_id', 'id', 'title', 'link', 'href', 'section_id', 'sectionId',
            'section', 'course', 'type', 'category', 'sourceName', 'edition_label',
            'edition_number', 'edition_family'
        ].forEach(function(key) {
            if (Object.prototype.hasOwnProperty.call(sourceSet, key)) safe.set[key] = sourceSet[key];
        });
        return safe;
    }

    function studentDashboardCacheSnapshot() {
        var owner = studentDashboardOwner();
        if (!owner) return null;
        return {
            owner: owner,
            saved_at: Date.now(),
            assignments: (state.assignments || []).map(safeCachedAssignment).filter(Boolean),
            assignment_counts: Object.assign({}, state.assignmentCounts || {}),
            weekly_summary: state.weeklySummary ? Object.assign({}, state.weeklySummary) : null,
            assignment_star_count: Number(state.assignmentStarCount || 0),
            self_study_star_count: Number(state.selfStudyStarCount || 0),
            teacher_reply_unread_count: Number(state.teacherReplyUnreadCount || 0)
        };
    }

    function saveStudentDashboardCache() {
        var snapshot = studentDashboardCacheSnapshot();
        if (!snapshot) return Promise.resolve();
        return withStudentDashboardCache('readwrite', function(store) {
            return store.put(snapshot);
        }).catch(function() {});
    }

    function readStudentDashboardCache() {
        var owner = studentDashboardOwner();
        if (!owner) return Promise.resolve(null);
        return withStudentDashboardCache('readonly', function(store) {
            return store.get(owner);
        }).then(function(snapshot) {
            if (!snapshot || snapshot.owner !== owner) return null;
            if (Date.now() - Number(snapshot.saved_at || 0) > studentDashboardCacheMaxAge) return null;
            return snapshot;
        }).catch(function() { return null; });
    }

    function warmMyWordsFirstPage() {
        if (myWordsWarmPromise) return myWordsWarmPromise;
        if (!state.session || state.session.mode !== 'student') return Promise.resolve(null);
        var profile = state.session.profile || {};
        var owner = String(profile.auth_uid || profile.student_id || '');
        if (!owner) return Promise.resolve(null);
        myWordsWarmPromise = window.MrCatCloud.callFunction('studentVocabulary', {
            action: 'list',
            status: 'active',
            paginated: true,
            cursor: 0,
            page_size: 18
        }).then(function(result) {
            if (!result || !result.success) return null;
            try {
                window.sessionStorage.setItem('mrcat_my_words_first_page_v1', JSON.stringify({
                    owner: owner,
                    saved_at: Date.now(),
                    words: (result.words || []).slice(0, 18),
                    next_cursor: result.next_cursor == null ? null : result.next_cursor,
                    has_more: result.has_more === true,
                    total_count: result.total_count != null && Number.isFinite(Number(result.total_count)) ? Number(result.total_count) : null
                }));
            } catch (error) {}
            return result;
        }).catch(function() {
            myWordsWarmPromise = null;
            return null;
        });
        return myWordsWarmPromise;
    }

    function useMyWordsFallbackTransition(event) {
        if (!wordsButton || typeof document.startViewTransition === 'function') return false;
        if (window.CSS && window.CSS.supports && window.CSS.supports('view-transition-name: my-words-surface')) return false;
        if (event && (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return false;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
        var rect = wordsButton.getBoundingClientRect();
        var surface = document.createElement('div');
        surface.className = 'my-words-route-surface';
        surface.setAttribute('aria-hidden', 'true');
        surface.innerHTML = wordsButton.innerHTML;
        surface.style.top = rect.top + 'px';
        surface.style.left = rect.left + 'px';
        surface.style.width = rect.width + 'px';
        surface.style.height = rect.height + 'px';
        document.body.appendChild(surface);
        try { window.sessionStorage.setItem('mrcat_my_words_fallback_arrival', '1'); } catch (error) {}
        window.requestAnimationFrame(function() {
            surface.classList.add('is-expanding');
            surface.style.top = '12px';
            surface.style.left = '12px';
            surface.style.width = Math.max(0, window.innerWidth - 24) + 'px';
            surface.style.height = Math.max(0, window.innerHeight - 24) + 'px';
        });
        window.setTimeout(function() { window.location.href = wordsButton.href; }, 300);
        return true;
    }
    var wordsOverlay = document.getElementById('student-words-overlay');
    var wordsScroll = document.getElementById('student-words-dialog-scroll');
    var wordsPreview = document.getElementById('student-words-preview');
    var wordsPreviewAddTrigger = document.getElementById('student-words-preview-add-trigger');
    var wordsPreviewAddMenu = document.getElementById('student-words-preview-add-menu');
    var wordsPreviewScan = document.querySelector('[data-preview-scan]');
    var wordsPreviewAddForm = document.getElementById('student-words-preview-add-form');
    var wordsPreviewAddInput = document.getElementById('student-words-preview-add-input');
    var wordsPreviewContextInput = document.getElementById('student-words-preview-context-input');
    var wordsPreviewAddStatus = document.getElementById('student-words-preview-add-status');
    var wordsSearchTrigger = document.getElementById('my-words-search-trigger');
    var wordsExportTrigger = document.getElementById('my-words-export-trigger');
    var wordsExportPanel = document.getElementById('my-words-export-panel');
    var wordsSearchPanel = document.getElementById('my-words-search-panel');
    var wordsSearchInput = document.getElementById('my-words-search');
    var wordsAddTrigger = document.getElementById('my-words-add-trigger');
    var wordsAddPanel = document.getElementById('my-words-add-panel');
    var wordsAddForm = document.getElementById('my-words-manual-form');
    var wordsAddInput = document.getElementById('my-words-manual-text');
    var wordsAddStatus = document.getElementById('my-words-manual-status');
    var messageButton = document.getElementById('student-message-button');
    var messageCount = document.getElementById('student-message-count');
    var studentCalendarTitleObserver = null;
    var weeklyFocusTitleObserver = null;
    var studentMessageScrollLock = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function lockStudentMessageBackground() {
        if (studentMessageScrollLock || !document.body || !document.documentElement) return;
        var body = document.body;
        var root = document.documentElement;
        var scrollX = window.scrollX || window.pageXOffset || 0;
        var scrollY = window.scrollY || window.pageYOffset || 0;
        var scrollbarGap = Math.max(0, window.innerWidth - root.clientWidth);
        var computedPaddingRight = parseFloat(window.getComputedStyle(body).paddingRight) || 0;

        studentMessageScrollLock = {
            scrollX: scrollX,
            scrollY: scrollY,
            bodyPosition: body.style.position,
            bodyTop: body.style.top,
            bodyLeft: body.style.left,
            bodyRight: body.style.right,
            bodyWidth: body.style.width,
            bodyOverflow: body.style.overflow,
            bodyPaddingRight: body.style.paddingRight,
            rootOverflow: root.style.overflow,
            rootOverscrollBehavior: root.style.overscrollBehavior,
            rootScrollBehavior: root.style.scrollBehavior
        };

        root.style.overflow = 'hidden';
        root.style.overscrollBehavior = 'none';
        root.style.scrollBehavior = 'auto';
        body.style.position = 'fixed';
        body.style.top = (-scrollY) + 'px';
        body.style.left = '0';
        body.style.right = '0';
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        if (scrollbarGap) body.style.paddingRight = (computedPaddingRight + scrollbarGap) + 'px';
    }

    function unlockStudentMessageBackground() {
        if (!studentMessageScrollLock || !document.body || !document.documentElement) return;
        var lock = studentMessageScrollLock;
        var body = document.body;
        var root = document.documentElement;
        studentMessageScrollLock = null;

        body.style.position = lock.bodyPosition;
        body.style.top = lock.bodyTop;
        body.style.left = lock.bodyLeft;
        body.style.right = lock.bodyRight;
        body.style.width = lock.bodyWidth;
        body.style.overflow = lock.bodyOverflow;
        body.style.paddingRight = lock.bodyPaddingRight;
        root.style.overflow = lock.rootOverflow;
        root.style.overscrollBehavior = lock.rootOverscrollBehavior;
        window.scrollTo(lock.scrollX, lock.scrollY);
        root.style.scrollBehavior = lock.rootScrollBehavior;
    }

    function finishWorkspaceConfirmClose(restoreFocus) {
        if (!workspaceConfirmOverlay) return;
        workspaceConfirmOverlay.hidden = true;
        workspaceConfirmOverlay.setAttribute('aria-hidden', 'true');
        workspaceConfirmHref = '';
        unlockStudentMessageBackground();
        if (restoreFocus && workspaceConfirmTrigger && document.contains(workspaceConfirmTrigger)) {
            workspaceConfirmTrigger.focus();
        }
        workspaceConfirmTrigger = null;
    }

    function closeWorkspaceConfirm(restoreFocus) {
        if (!workspaceConfirmOverlay || workspaceConfirmOverlay.hidden) return;
        if (workspaceConfirmCloseTimer) window.clearTimeout(workspaceConfirmCloseTimer);
        workspaceConfirmOverlay.classList.remove('is-visible');
        workspaceConfirmCloseTimer = window.setTimeout(function() {
            workspaceConfirmCloseTimer = null;
            finishWorkspaceConfirmClose(restoreFocus !== false);
        }, window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
    }

    function openWorkspaceConfirm(card) {
        if (!workspaceConfirmOverlay || !card) return;
        if (workspaceConfirmCloseTimer) {
            window.clearTimeout(workspaceConfirmCloseTimer);
            workspaceConfirmCloseTimer = null;
        }
        workspaceConfirmTrigger = card;
        workspaceConfirmHref = card.href || card.getAttribute('href') || '';
        var name = String(card.getAttribute('data-workspace-name') || 'workspace');
        var copy = String(card.getAttribute('data-workspace-confirm-copy') || 'Continue to this learning workspace.');
        var icon = card.querySelector('.student-skill-icon svg');
        if (workspaceConfirmIcon) {
            workspaceConfirmIcon.replaceChildren();
            if (icon) workspaceConfirmIcon.appendChild(icon.cloneNode(true));
        }
        if (workspaceConfirmTitle) workspaceConfirmTitle.textContent = 'Open ' + name + '?';
        if (workspaceConfirmCopy) workspaceConfirmCopy.textContent = copy;
        if (workspaceConfirmSubmit) workspaceConfirmSubmit.textContent = 'Enter ' + name;
        workspaceConfirmOverlay.hidden = false;
        workspaceConfirmOverlay.setAttribute('aria-hidden', 'false');
        lockStudentMessageBackground();
        window.requestAnimationFrame(function() {
            workspaceConfirmOverlay.classList.add('is-visible');
            if (workspaceConfirmCancel) workspaceConfirmCancel.focus();
        });
    }

    function achievementDate(key) {
        var match = String(key || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
        return match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
    }

    function achievementDateKey(date) {
        return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0') + '-' + String(date.getUTCDate()).padStart(2, '0');
    }

    function achievementDateLabel(key, includeWeekday) {
        var date = achievementDate(key);
        if (!date) return key;
        return new Intl.DateTimeFormat('en', {
            timeZone: 'UTC',
            weekday: includeWeekday ? 'long' : undefined,
            month: 'long',
            day: 'numeric',
            year: 'numeric'
        }).format(date);
    }

    function emptyAchievementCalendar() {
        var now = new Date();
        var shanghaiParts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
        }).formatToParts(now).reduce(function(output, part) {
            if (part.type !== 'literal') output[part.type] = Number(part.value);
            return output;
        }, {});
        var today = new Date(Date.UTC(shanghaiParts.year, shanghaiParts.month - 1, shanghaiParts.day));
        var mondayIndex = (today.getUTCDay() + 6) % 7;
        var start = new Date(today.getTime() - ((mondayIndex + (52 * 7)) * 86400000));
        var end = new Date(start.getTime() + (370 * 86400000));
        return {
            start_date: achievementDateKey(start),
            today_date: achievementDateKey(today),
            end_date: achievementDateKey(end),
            total_achievements: 0,
            active_days: 0,
            days: []
        };
    }

    function achievementMonthLabels(startDate) {
        var labels = new Array(53).fill('');
        var runStart = 0;
        var runMonth = startDate.getUTCMonth();
        var monthFormatter = new Intl.DateTimeFormat('en', { timeZone: 'UTC', month: 'short' });
        for (var column = 1; column <= 53; column += 1) {
            var date = column < 53 ? new Date(startDate.getTime() + (column * 7 * 86400000)) : null;
            var month = date ? date.getUTCMonth() : -1;
            if (column === 53 || month !== runMonth) {
                if (column - runStart >= 2) {
                    var runDate = new Date(startDate.getTime() + (runStart * 7 * 86400000));
                    labels[runStart] = monthFormatter.format(runDate);
                }
                runStart = column;
                runMonth = month;
            }
        }
        return labels.map(function(label) { return '<span>' + escapeHtml(label) + '</span>'; }).join('');
    }

    function renderAchievementCalendar(calendar) {
        if (!achievementsPanel || !achievementsScroll) return;
        calendar = calendar && calendar.start_date ? calendar : emptyAchievementCalendar();
        state.achievementCalendar = calendar;
        var dayMap = {};
        (calendar.days || []).forEach(function(day) { dayMap[day.date] = day; });
        var start = achievementDate(calendar.start_date);
        if (!start) return;
        var cells = [];
        for (var index = 0; index < 371; index += 1) {
            var key = achievementDateKey(new Date(start.getTime() + (index * 86400000)));
            var day = dayMap[key] || { date: key, count: 0, items: [] };
            var future = key > calendar.today_date;
            var today = key === calendar.today_date;
            var count = Math.max(0, Number(day.count || 0));
            var level = Math.min(4, count);
            var label = (today ? 'Today, ' : '') + achievementDateLabel(key, true) + ': ' + count + (count === 1 ? ' achievement' : ' achievements');
            var todayDay = today ? String(Number(key.slice(8, 10))) : '';
            cells.push('<button class="student-achievement-cell level-' + level + (today ? ' is-today' : '') + (future ? ' is-future' : '') + '" type="button" data-achievement-date="' + key + '"' + (today ? ' data-achievement-today-day="' + todayDay + '"' : '') + ' aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '"' + (today ? ' aria-current="date"' : '') + (future ? ' disabled' : '') + '></button>');
        }
        achievementsScroll.innerHTML = '<div class="student-achievements-calendar">' +
            '<div class="student-achievements-month-corner" aria-hidden="true"></div>' +
            '<div class="student-achievements-months" aria-hidden="true">' + achievementMonthLabels(start) + '</div>' +
            '<div class="student-achievements-weekdays" aria-hidden="true"><span>Mon</span><span></span><span>Wed</span><span></span><span>Fri</span><span></span><span></span></div>' +
            '<div class="student-achievements-grid">' + cells.join('') + '</div>' +
        '</div>';
        var total = Number(calendar.total_achievements || 0);
        var activeDays = Number(calendar.active_days || 0);
        if (achievementsTotal) achievementsTotal.innerHTML = '<strong>' + total + '</strong><span>' + (total === 1 ? 'achievement' : 'achievements') + '</span>';
        if (achievementsStatus) achievementsStatus.innerHTML = '<strong>' + activeDays + '</strong> <span>' + (activeDays === 1 ? 'active day' : 'active days') + '</span>';
        achievementsPanel.classList.remove('is-loading', 'has-error');
        achievementsPanel.setAttribute('aria-busy', 'false');
        achievementsScroll.setAttribute('aria-label', 'Achievement calendar for the past 12 months. ' + total + (total === 1 ? ' achievement.' : ' achievements.'));
        window.requestAnimationFrame(function() { achievementsScroll.scrollLeft = achievementsScroll.scrollWidth; });
    }

    function achievementTypeLabel(type) {
        if (type === 'bbc') return 'BBC';
        if (type === 'vocabulary') return 'VOCABULARY';
        if (type === 'writing') return 'WRITING';
        if (type === 'speaking') return 'SPEAKING';
        return 'ACHIEVEMENT';
    }

    function loadAchievementCalendar() {
        if (!achievementsPanel) return Promise.resolve(null);
        if (!state.session || state.session.mode !== 'student') {
            renderAchievementCalendar(emptyAchievementCalendar());
            return Promise.resolve(null);
        }
        return window.MrCatCloud.callFunction('getDashboard', { action: 'getAchievementCalendar' }).then(function(result) {
            if (!result || !result.success || !result.achievement_calendar) throw new Error('ACHIEVEMENTS_UNAVAILABLE');
            renderAchievementCalendar(result.achievement_calendar);
            return result.achievement_calendar;
        }).catch(function() {
            achievementsPanel.classList.remove('is-loading');
            achievementsPanel.classList.add('has-error');
            achievementsPanel.setAttribute('aria-busy', 'false');
            if (achievementsTotal) achievementsTotal.innerHTML = '<strong>—</strong><span>achievements</span>';
            if (achievementsStatus) achievementsStatus.innerHTML = '<button type="button" id="student-achievements-retry">Retry loading</button>';
            var retry = document.getElementById('student-achievements-retry');
            if (retry) retry.addEventListener('click', loadAchievementCalendar);
            return null;
        });
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

    function shanghaiWeekKeys(offset) {
        var start = addUtcDays(currentShanghaiWeekStart(), Number(offset || 0) * 7);
        return {
            start: keyFromUtcDate(start),
            end: keyFromUtcDate(addUtcDays(start, 6))
        };
    }

    function legacyAssignmentDueDate(item) {
        var source = item && (item.assigned_at || item.created_at);
        var parts = shanghaiDateParts(source);
        if (!parts) return null;
        var sourceDay = utcDateFromShanghaiParts(parts);
        var sunday = addUtcDays(sourceDay, 6 - mondayIndexFromUtcDate(sourceDay));
        return new Date(keyFromUtcDate(sunday) + 'T23:59:59+08:00');
    }

    function assignmentDueDate(item) {
        var dueDate = item && item.due_at ? new Date(item.due_at) : null;
        if (dueDate && !isNaN(dueDate.getTime())) return dueDate;
        return legacyAssignmentDueDate(item);
    }

    function assignmentDueParts(item) {
        var dueDate = assignmentDueDate(item);
        return dueDate ? shanghaiDateParts(dueDate) : null;
    }

    function isUpcomingAssignment(item) {
        if (!isRealAssignment(item)) return false;
        var parts = assignmentDueParts(item);
        return Boolean(parts && parts.key > shanghaiWeekKeys(0).end);
    }

    function isOverdueAssignment(item) {
        if (!isRealAssignment(item) || normalizedStatus(item.status) !== 'to_do') return false;
        var dueDate = assignmentDueDate(item);
        return Boolean(dueDate && !isNaN(dueDate.getTime()) && dueDate.getTime() < Date.now());
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
        var hourPart = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            hour: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(new Date()).find(function(part) {
            return part.type === 'hour';
        });
        return Number(hourPart ? hourPart.value : 12);
    }

    function greetingFor(name) {
        var hour = shanghaiHour();
        var greetings = hour < 12
            ? ['Good morning, {name}.', 'Morning, {name}.']
            : hour < 18
                ? ['Good afternoon, {name}.', 'Welcome back, {name}.']
                : ['Good evening, {name}.', 'Welcome back, {name}.'];
        return randomItem(greetings).replace('{name}', name);
    }

    function setStudentGreeting(greetingText) {
        var motivation = randomItem(motivationalQuotes);
        var message = [greetingText, motivation].filter(Boolean).join(' ');
        if (studentGreetingPrimary) studentGreetingPrimary.textContent = greetingText;
        if (studentGreetingMotivation) studentGreetingMotivation.textContent = motivation;
        if (studentGreetingAccessible) studentGreetingAccessible.textContent = message;
        scheduleStudentGreetingOverflow();
    }

    function updateStudentGreetingOverflow() {
        if (!studentGreetingLine || !studentGreetingPrimary) return;
        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var overflow = Math.ceil(studentGreetingPrimary.scrollWidth - studentGreetingLine.clientWidth);
        var shouldScroll = !reduceMotion && studentGreetingLine.clientWidth > 0 && overflow > 2;
        studentGreetingLine.classList.toggle('is-overflowing', shouldScroll || (reduceMotion && overflow > 2));
        if (!shouldScroll) {
            studentGreetingLine.style.removeProperty('--student-greeting-shift');
            studentGreetingLine.style.removeProperty('--student-greeting-duration');
            return;
        }
        studentGreetingLine.style.setProperty('--student-greeting-shift', (-overflow) + 'px');
        studentGreetingLine.style.setProperty('--student-greeting-duration', Math.max(7, Math.min(12, 6 + (overflow / 30))) + 's');
    }

    function scheduleStudentGreetingOverflow() {
        window.requestAnimationFrame(updateStudentGreetingOverflow);
    }

    if (studentGreetingLine && window.ResizeObserver) {
        studentGreetingResizeObserver = new ResizeObserver(scheduleStudentGreetingOverflow);
        studentGreetingResizeObserver.observe(studentGreetingLine);
    } else {
        window.addEventListener('resize', scheduleStudentGreetingOverflow);
    }

    if (window.matchMedia) {
        var studentGreetingMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
        if (studentGreetingMotionPreference.addEventListener) {
            studentGreetingMotionPreference.addEventListener('change', scheduleStudentGreetingOverflow);
        }
    }

    function updateStudentSkillSentenceOverflow() {
        if (!studentSkillEntries) return;
        var phoneLayout = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        var sentences = studentSkillEntries.querySelectorAll('.student-skill-sentence');
        sentences.forEach(function(sentence) {
            var viewport = sentence.closest('.student-skill-copy');
            sentence.classList.remove('is-scrolling');
            sentence.style.removeProperty('--student-skill-shift');
            sentence.style.removeProperty('--student-skill-duration');
            if (!phoneLayout || reduceMotion || !viewport || viewport.clientWidth <= 0) return;
            var overflow = Math.ceil(sentence.scrollWidth - viewport.clientWidth);
            if (overflow <= 2) return;
            sentence.style.setProperty('--student-skill-shift', (-(overflow + 10)) + 'px');
            sentence.style.setProperty('--student-skill-duration', Math.max(7, Math.min(13, 6.5 + (overflow / 34))) + 's');
            sentence.classList.add('is-scrolling');
        });
    }

    function scheduleStudentSkillSentenceOverflow() {
        window.requestAnimationFrame(updateStudentSkillSentenceOverflow);
    }

    if (studentSkillEntries && window.ResizeObserver) {
        studentSkillSentenceResizeObserver = new ResizeObserver(scheduleStudentSkillSentenceOverflow);
        studentSkillSentenceResizeObserver.observe(studentSkillEntries);
    } else {
        window.addEventListener('resize', scheduleStudentSkillSentenceOverflow);
    }

    if (window.matchMedia) {
        var studentSkillMotionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
        var studentSkillPhoneLayout = window.matchMedia('(max-width: 640px)');
        if (studentSkillMotionPreference.addEventListener) studentSkillMotionPreference.addEventListener('change', scheduleStudentSkillSentenceOverflow);
        if (studentSkillPhoneLayout.addEventListener) studentSkillPhoneLayout.addEventListener('change', scheduleStudentSkillSentenceOverflow);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleStudentSkillSentenceOverflow).catch(function() {});
    scheduleStudentSkillSentenceOverflow();

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
        if (/^IL-/i.test(id)) return 'intensive-listening.html?set=' + encodeURIComponent(id);
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

    function replyStatusLabel(reply) {
        return reply.status === 'approved' ? 'Approved' : reply.status === 'rejected' ? 'Rejected' : 'Pending';
    }

    function teacherReplyTime(value) {
        if (!value) return null;
        var date = value instanceof Date ? value : new Date(value);
        if (isNaN(date.getTime())) return null;
        var parts = new Intl.DateTimeFormat('en-GB', {
            timeZone: 'Asia/Shanghai',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        }).formatToParts(date);
        var values = {};
        parts.forEach(function(part) {
            if (part.type !== 'literal') values[part.type] = part.value;
        });
        if (!values.year || !values.month || !values.day || values.hour == null || values.minute == null) return null;
        return {
            label: values.year + '-' + values.month + '-' + values.day + ' ' + values.hour + ':' + values.minute,
            datetime: date.toISOString()
        };
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
        if (starCounter) {
            starCounter.textContent = '★ ' + availableYellowStars();
            starCounter.classList.toggle('pop', animate === true);
            if (animate) window.setTimeout(function() { starCounter.classList.remove('pop'); }, 700);
        }
    }

    function availableYellowStars() {
        var wallet = state.starRewards && state.starRewards.wallet;
        return wallet ? Number(wallet.available_yellow_stars || 0) : 0;
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
            .filter(function(item) {
                return normalizedStatus(item.status) === 'to_do' && !isUpcomingAssignment(item);
            })
            .sort(function(left, right) {
                var leftOverdue = isOverdueAssignment(left) ? 0 : 1;
                var rightOverdue = isOverdueAssignment(right) ? 0 : 1;
                if (leftOverdue !== rightOverdue) return leftOverdue - rightOverdue;
                if (!leftOverdue) return assignmentDueDate(left).getTime() - assignmentDueDate(right).getTime();
                return newestFirst(left, right);
            });
    }

    function upcomingAssignments() {
        return (state.assignments || [])
            .filter(isUpcomingAssignment)
            .sort(function(left, right) {
                return assignmentDueDate(left).getTime() - assignmentDueDate(right).getTime();
            });
    }

    function openTodoAssignments() {
        return todoAssignments().concat(upcomingAssignments().filter(function(item) {
            return normalizedStatus(item.status) === 'to_do';
        }));
    }

    function finishedAssignments() {
        return (state.assignments || [])
            .filter(function(item) {
                return isFinishedStatus(item.status);
            })
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

    function finishedCompletionValue(item) {
        if (!item) return null;
        if (item.source === 'self_study') {
            return item.completed_at || item.mastered_at || item.updated_at || item.latest_submitted_at || null;
        }
        return item.mastered_at || item.completed_at || item.updated_at || item.latest_submitted_at || null;
    }

    function finishedSortValue(item) {
        if (!item) return null;
        return item.best_improved_at || item.progress_updated_at || finishedCompletionValue(item);
    }

    function studentCalendarMonthSerial(year, month) {
        return (Number(year) * 12) + Number(month) - 1;
    }

    function studentCalendarMonthParts(serial) {
        var year = Math.floor(serial / 12);
        return { year: year, month: serial - (year * 12) + 1 };
    }

    function studentCalendarDateKey(year, month, day) {
        return year + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }

    function studentCalendarAchievementDays() {
        return state.achievementCalendar && Array.isArray(state.achievementCalendar.days)
            ? state.achievementCalendar.days
            : [];
    }

    function studentCalendarBounds(nowValue) {
        var fallbackToday = shanghaiDateParts(nowValue || new Date());
        var calendar = state.achievementCalendar || {};
        var todayDate = achievementDate(calendar.today_date);
        var startDate = achievementDate(calendar.start_date);
        var today = todayDate ? {
            year: todayDate.getUTCFullYear(),
            month: todayDate.getUTCMonth() + 1,
            day: todayDate.getUTCDate(),
            key: achievementDateKey(todayDate)
        } : fallbackToday;
        var currentSerial = studentCalendarMonthSerial(today.year, today.month);
        var earliestSerial = startDate
            ? studentCalendarMonthSerial(startDate.getUTCFullYear(), startDate.getUTCMonth() + 1)
            : currentSerial;
        return { earliest: earliestSerial, current: currentSerial, today: today };
    }

    function studentCalendarModel(year, month, selectedKey, nowValue) {
        var bounds = studentCalendarBounds(nowValue);
        var monthSerial = Math.max(bounds.earliest, Math.min(bounds.current, studentCalendarMonthSerial(year, month)));
        var monthParts = studentCalendarMonthParts(monthSerial);
        var firstDate = new Date(Date.UTC(monthParts.year, monthParts.month - 1, 1));
        var firstWeekday = mondayIndexFromUtcDate(firstDate);
        var dayCount = new Date(Date.UTC(monthParts.year, monthParts.month, 0)).getUTCDate();
        var itemsByKey = {};

        studentCalendarAchievementDays().forEach(function(day) {
            if (!day || typeof day.date !== 'string') return;
            var date = achievementDate(day.date);
            if (!date || date.getUTCFullYear() !== monthParts.year || date.getUTCMonth() + 1 !== monthParts.month) return;
            itemsByKey[day.date] = Array.isArray(day.items) ? day.items.slice() : [];
        });

        var days = [];
        for (var blankIndex = 0; blankIndex < firstWeekday; blankIndex++) days.push(null);
        for (var dayNumber = 1; dayNumber <= dayCount; dayNumber++) {
            var dayKey = studentCalendarDateKey(monthParts.year, monthParts.month, dayNumber);
            var dayItems = itemsByKey[dayKey] || [];
            days.push({
                key: dayKey,
                day: dayNumber,
                items: dayItems,
                level: Math.min(4, dayItems.length),
                isToday: dayKey === bounds.today.key,
                isFuture: dayKey > bounds.today.key
            });
        }
        while (days.length % 7) days.push(null);

        var selected = selectedKey ? days.find(function(day) {
            return day && !day.isFuture && day.key === selectedKey;
        }) : null;
        if (!selected) {
            var activeDays = days.filter(function(day) { return day && day.items.length; });
            selected = activeDays.length ? activeDays[activeDays.length - 1] : days.find(function(day) { return day && day.isToday; }) || days.find(Boolean);
        }

        return {
            year: monthParts.year,
            month: monthParts.month,
            days: days,
            selected: selected,
            canGoPrevious: monthSerial > bounds.earliest,
            canGoNext: monthSerial < bounds.current
        };
    }

    function studentCalendarMonthLabel(model) {
        return new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC',
            year: 'numeric',
            month: 'long'
        }).format(new Date(Date.UTC(model.year, model.month - 1, 1)));
    }

    function studentCalendarDayLabel(day) {
        return new Intl.DateTimeFormat('en-US', {
            timeZone: 'UTC',
            month: 'short',
            day: 'numeric',
            weekday: 'short'
        }).format(new Date(day.key + 'T12:00:00Z'));
    }

    function studentCalendarAchievementHref(item) {
        if (!item) return '';
        if (String(item.type || '').toLowerCase() === 'writing') {
            var compositionId = String(item.composition_id || '').trim();
            return compositionId
                ? withReturnParam('ai-tutor.html?composition=' + encodeURIComponent(compositionId), dashboardReturnUrl('resources'))
                : '';
        }
        var setId = String(item.set_id || '').trim();
        if (!setId) return '';
        var set = {
            set_id: setId,
            id: setId,
            title: item.title || setId,
            section_id: item.type || '',
            link: defaultPracticeLink(setId)
        };
        return assignmentOpenHref({
            assignment_id: item.assignment_id || null,
            source: item.assignment_id ? 'assignment' : 'self_study',
            status: 'passed',
            best_percentage: item.percentage,
            history_attempt_id: item.attempt_id || null,
            prefill_attempt_id: item.attempt_id || null,
            set: set
        });
    }

    function renderStudentCalendarAchievement(item) {
        var type = achievementTypeLabel(item && item.type);
        var title = item && item.title || 'Completed task';
        var result = item && item.result || 'COMPLETED';
        var href = studentCalendarAchievementHref(item);
        var hideStatus = String(item && item.type || '').toLowerCase() === 'writing';
        return '<article class="student-message-task finished student-calendar-achievement"' +
            ' data-entry-kind="' + escapeHtml(type) + '" data-entry-title="' + escapeHtml(title) + '"' +
            ' data-entry-status="passed" data-entry-best="' + escapeHtml(item && item.percentage != null ? item.percentage : '') + '"' +
            ' data-entry-locked="false" data-calendar-hide-status="' + (hideStatus ? 'true' : 'false') + '"' +
            (href ? ' data-open-href="' + escapeHtml(href) + '" role="link" tabindex="0" aria-label="Review before opening ' + escapeHtml(title) + '"' : '') + '>' +
            '<div class="student-message-task-main">' +
                '<span class="student-message-kicker">' + escapeHtml(type) + '</span>' +
                '<span class="student-message-title-window">' +
                    '<strong class="student-message-title-track"><span>' + escapeHtml(title) + '</span></strong>' +
                '</span>' +
            '</div>' +
            '<div class="student-message-task-meta" aria-hidden="true">' +
                '<span class="student-message-score">' + escapeHtml(result) + '</span>' +
                (href ? '<svg viewBox="0 0 24 24" focusable="false"><path d="m9 5 7 7-7 7"></path></svg>' : '') +
            '</div>' +
        '</article>';
    }

    function openStudentCalendarAchievement(card, event) {
        if (!card || !calendarOverlay) return;
        if (event && event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
        var href = card.dataset.openHref;
        if (!href) return;
        if (event) {
            event.preventDefault();
            event.stopPropagation();
        }
        calendarOverlay.hidden = true;
        showPracticeEntryDialog(card, href, {
            hideStatus: card.dataset.calendarHideStatus === 'true',
            onDismiss: function() {
                calendarOverlay.hidden = false;
                window.requestAnimationFrame(function() {
                    if (card.isConnected) card.focus({ preventScroll: true });
                });
            },
            onCommit: function() {
                setStudentCalendarPanel(false);
            }
        });
    }

    function renderStudentCalendar() {
        if (!calendarContent) return;
        var bounds = studentCalendarBounds();
        if (state.calendarYear == null || state.calendarMonth == null) {
            var current = studentCalendarMonthParts(bounds.current);
            state.calendarYear = current.year;
            state.calendarMonth = current.month;
        }
        var model = studentCalendarModel(state.calendarYear, state.calendarMonth, state.calendarSelectedDay);
        state.calendarYear = model.year;
        state.calendarMonth = model.month;
        state.calendarSelectedDay = model.selected ? model.selected.key : '';
        var selectedItems = model.selected ? model.selected.items : [];
        var dayButtons = model.days.map(function(day) {
            if (!day) return '<span class="student-calendar-day-empty" aria-hidden="true"></span>';
            var aria = studentCalendarDayLabel(day) + ', ' + day.items.length + (day.items.length === 1 ? ' achievement' : ' achievements');
            return '<button class="student-calendar-day' +
                (day.isToday ? ' is-today' : '') +
                (model.selected && day.key === model.selected.key ? ' is-selected' : '') +
                '" type="button" data-calendar-date="' + escapeHtml(day.key) + '" data-level="' + day.level + '"' +
                (day.isFuture ? ' disabled' : '') + ' aria-label="' + escapeHtml(aria) + '"' +
                (model.selected && day.key === model.selected.key ? ' aria-pressed="true"' : ' aria-pressed="false"') + '>' +
                '<span>' + day.day + '</span>' +
            '</button>';
        }).join('');
        var detailTitle = model.selected ? studentCalendarDayLabel(model.selected) : 'Completed work';
        var detailCount = selectedItems.length + ' achievement' + (selectedItems.length === 1 ? '' : 's');

        calendarContent.innerHTML =
            '<div class="student-calendar-toolbar">' +
                '<button class="student-calendar-month-button" type="button" data-calendar-month="previous" aria-label="Previous month"' + (model.canGoPrevious ? '' : ' disabled') + '>' +
                    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12.5 4.5-5 5.5 5 5.5"></path></svg>' +
                '</button>' +
                '<h3 class="student-calendar-month-title">' + escapeHtml(studentCalendarMonthLabel(model)) + '</h3>' +
                '<button class="student-calendar-month-button" type="button" data-calendar-month="next" aria-label="Next month"' + (model.canGoNext ? '' : ' disabled') + '>' +
                    '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="m7.5 4.5 5 5.5-5 5.5"></path></svg>' +
                '</button>' +
            '</div>' +
            '<div class="student-calendar-weekdays" aria-hidden="true"><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span><span>Sun</span></div>' +
            '<div class="student-calendar-grid" role="grid" aria-label="' + escapeHtml(studentCalendarMonthLabel(model)) + '">' + dayButtons + '</div>' +
            '<section class="student-calendar-detail" aria-live="polite">' +
                '<div class="student-calendar-detail-head"><h3>' + escapeHtml(detailTitle) + '</h3><span>' + escapeHtml(detailCount) + '</span></div>' +
                (selectedItems.length ? '<div class="student-calendar-task-list">' + selectedItems.map(renderStudentCalendarAchievement).join('') + '</div>' : '<p class="student-calendar-empty">No achievements on this day.</p>') +
            '</section>';
        if (studentCalendarTitleObserver) studentCalendarTitleObserver.disconnect();
        studentCalendarTitleObserver = setupStudentMessageTitleTracks(calendarContent);
    }

    function shiftStudentCalendarMonth(offset) {
        var next = studentCalendarMonthParts(studentCalendarMonthSerial(state.calendarYear, state.calendarMonth) + offset);
        state.calendarYear = next.year;
        state.calendarMonth = next.month;
        state.calendarSelectedDay = '';
        renderStudentCalendar();
        if (calendarScroll) calendarScroll.scrollTop = 0;
    }

    function setStudentCalendarPanel(open, trigger) {
        state.calendarPanelOpen = open === true;
        if (!calendarOverlay) return;
        if (state.calendarPanelOpen && trigger) calendarTrigger = trigger;
        calendarOverlay.hidden = !state.calendarPanelOpen;
        if (!state.calendarPanelOpen) {
            if (studentCalendarTitleObserver) {
                studentCalendarTitleObserver.disconnect();
                studentCalendarTitleObserver = null;
            }
            unlockStudentMessageBackground();
            if (calendarTrigger && calendarTrigger.isConnected) calendarTrigger.focus({ preventScroll: true });
            calendarTrigger = null;
            return;
        }
        setWordsPanel(false);
        setAccountPanel(false);
        renderStudentCalendar();
        lockStudentMessageBackground();
        window.requestAnimationFrame(function() {
            var close = document.getElementById('student-calendar-close');
            if (close) close.focus({ preventScroll: true });
        });
    }

    function openStudentCalendarDate(key, trigger) {
        var date = achievementDate(key);
        if (!date || !state.achievementCalendar || key > state.achievementCalendar.today_date) return;
        state.calendarYear = date.getUTCFullYear();
        state.calendarMonth = date.getUTCMonth() + 1;
        state.calendarSelectedDay = key;
        setStudentCalendarPanel(true, trigger);
        if (calendarScroll) calendarScroll.scrollTop = 0;
    }

    function studentMessageKind(item) {
        var set = assignmentSet(item);
        var sectionId = String(set.sectionId || set.section_id || '').toLowerCase();
        var setId = String(set.set_id || set.id || '');
        var kind = assignmentKind(item);
        if (sectionId === 'bbc-six-minute-english' || /^BBC-/i.test(setId) || /\bBBC\b/i.test(kind)) return 'BBC';
        if (sectionId === 'ielts-reading' || sectionId === 'ielts-listening' || /^C\d+-T\d+-(?:P|S)\d+/i.test(setId) || /\bIELTS\b/i.test(kind)) return 'IELTS';
        return kind;
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
        var opener = document.activeElement;

        var overlay = document.createElement('div');
        overlay.className = 'password-dialog-overlay';
        overlay.innerHTML =
            '<div class="password-dialog-stack" role="dialog" aria-modal="true" aria-labelledby="password-dialog-title">' +
                '<section class="password-dialog">' +
                    '<div class="password-dialog-title-row">' +
                        '<button class="account-star-back password-dialog-back" type="button" data-dialog-back aria-label="Back to Personal Center">‹</button>' +
                        '<p class="eyebrow accent" id="password-dialog-title">Change Password</p>' +
                        '<span class="password-dialog-title-spacer" aria-hidden="true"></span>' +
                    '</div>' +
                    '<form class="password-form" id="password-form">' +
                        '<label for="new-password">New password</label>' +
                        '<input id="new-password" name="new-password" type="password" autocomplete="new-password" required>' +
                        '<label for="confirm-password">Confirm password</label>' +
                        '<input id="confirm-password" name="confirm-password" type="password" autocomplete="new-password" required>' +
                        '<p class="password-hint">Minimum 6 characters with uppercase, lowercase, number, and symbol. Avoid repeated digits like 88888888.</p>' +
                        '<p class="password-message" id="password-message" aria-live="polite"></p>' +
                        '<div class="dialog-actions password-dialog-actions">' +
                            '<button class="primary-button" type="submit">Save Password</button>' +
                        '</div>' +
                    '</form>' +
                '</section>' +
                '<button class="student-message-close password-dialog-outside-close" type="button" data-dialog-close>Close</button>' +
            '</div>';
        document.body.appendChild(overlay);
        if (accountPanel) accountPanel.hidden = true;
        if (identityChip) identityChip.setAttribute('aria-expanded', 'false');

        var form = overlay.querySelector('#password-form');
        var passwordInput = overlay.querySelector('#new-password');
        var confirmInput = overlay.querySelector('#confirm-password');
        var message = overlay.querySelector('#password-message');
        var submitButton = form.querySelector('button[type="submit"]');
        var backButton = overlay.querySelector('[data-dialog-back]');
        var closeButton = overlay.querySelector('[data-dialog-close]');

        function close(closeAccount) {
            overlay.remove();
            if (closeAccount) {
                setAccountPanel(false);
                if (identityChip) identityChip.focus({ preventScroll: true });
                return;
            }
            if (accountPanel) accountPanel.hidden = false;
            if (identityChip) identityChip.setAttribute('aria-expanded', 'true');
            if (opener && opener.isConnected && typeof opener.focus === 'function') {
                opener.focus({ preventScroll: true });
            }
        }

        function setMessage(text, kind) {
            message.textContent = text || '';
            message.classList.toggle('success', kind === 'success');
            message.classList.toggle('error', kind === 'error');
        }

        backButton.addEventListener('click', function() { close(false); });
        closeButton.addEventListener('click', function() { close(true); });

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
                        close(false);
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

    function setLogoutConfirmOpen(open, closeAccount) {
        if (!logoutConfirmOverlay) return;
        logoutConfirmOverlay.hidden = open !== true;
        if (open === true) {
            if (accountPanel) accountPanel.hidden = true;
            if (identityChip) identityChip.setAttribute('aria-expanded', 'false');
            window.requestAnimationFrame(function() {
                var cancelButton = document.getElementById('logout-confirm-cancel');
                if (cancelButton) cancelButton.focus({ preventScroll: true });
            });
            return;
        }
        if (closeAccount) {
            setAccountPanel(false);
            if (identityChip) identityChip.focus({ preventScroll: true });
            return;
        }
        if (accountPanel) accountPanel.hidden = false;
        if (identityChip) identityChip.setAttribute('aria-expanded', 'true');
        var logoutButton = document.getElementById('logout-button');
        if (logoutButton) logoutButton.focus({ preventScroll: true });
    }

    function openLogoutConfirmDialog() {
        setLogoutConfirmOpen(true, false);
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
        var dueDate = assignmentDueDate(item);
        return dueDate ? dueDate.getTime() : new Date(item.updated_at || 0).getTime();
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
                    '<div class="practice-entry-editions" id="practice-entry-editions" aria-label="Choose a version" hidden></div>' +
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
        overlay.querySelector('#practice-entry-editions').addEventListener('click', function(event) {
            var button = event.target.closest('[data-practice-edition-index]');
            if (!button) return;
            selectPracticeEdition(overlay, Number(button.dataset.practiceEditionIndex));
        });
        return overlay;
    }

    function practiceEntryItemModel(item) {
        return {
            item: item,
            href: practiceHref(item, null),
            kind: item && (item.course || item.sectionTitle || item.type) || 'Practice',
            title: item && (item.title || item.set_id || item.id) || 'Practice',
            status: practiceEntryStatus({ dataset: { entryStatus: item && item.status || '' } }),
            best: item && item.best_percentage,
            locked: Boolean(item && (item.answer_revealed === true || item.mastery_locked === true))
        };
    }

    function selectPracticeEdition(overlay, index) {
        var models = overlay.practiceEditionModels || [];
        var model = models[index];
        if (!model) return;
        overlay.dataset.href = model.href || '';
        overlay.querySelector('#practice-entry-kind').textContent = model.kind;
        overlay.querySelector('#practice-entry-title').textContent = model.title;
        overlay.querySelector('#practice-entry-ribbon').className = 'practice-entry-ribbon ' + model.status;
        overlay.querySelector('#practice-entry-status').innerHTML = practiceEntryScoreHtml(model.best, model.locked);
        overlay.querySelector('#practice-entry-enter').disabled = false;
        overlay.querySelectorAll('[data-practice-edition-index]').forEach(function(button) {
            var selected = Number(button.dataset.practiceEditionIndex) === index;
            button.classList.toggle('selected', selected);
            button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
    }

    function closePracticeEntryDialog(options) {
        var overlay = document.getElementById('practice-entry-overlay');
        if (!overlay) return;
        var restoreSource = !options || options.restoreSource !== false;
        var onDismiss = restoreSource ? overlay.practiceEntryOnDismiss : null;
        overlay.hidden = true;
        delete overlay.dataset.href;
        overlay.practiceEditionModels = null;
        overlay.practiceEntryOnDismiss = null;
        overlay.practiceEntryOnCommit = null;
        if (typeof onDismiss === 'function') onDismiss();
    }

    window.addEventListener('pageshow', function() {
        closePracticeEntryDialog({ restoreSource: false });
    });

    function showPracticeEntryDialog(element, href, options) {
        var overlay = ensurePracticeEntryDialog();
        var status = practiceEntryStatus(element);
        var best = element && element.dataset && element.dataset.entryBest;
        var locked = practiceEntryLocked(element);
        options = options || {};
        var editionItems = Array.isArray(options.editions) ? options.editions : [];
        var editionRoot = overlay.querySelector('#practice-entry-editions');
        var enterButton = overlay.querySelector('#practice-entry-enter');
        var entryCard = overlay.querySelector('.practice-entry-card');
        var statusRibbon = overlay.querySelector('#practice-entry-ribbon');
        overlay.practiceEditionModels = editionItems.map(practiceEntryItemModel);
        editionRoot.hidden = editionItems.length < 2;
        editionRoot.innerHTML = editionItems.length < 2 ? '' : overlay.practiceEditionModels.map(function(model, index) {
            var label = window.MrCatEditions ? window.MrCatEditions.tag(model.item) : 'V' + (index + 1);
            var score = model.best == null || model.best === '' ? 'Not yet' : formatEntryPercent(model.best);
            return '<button class="practice-entry-edition" type="button" data-practice-edition-index="' + index + '" aria-pressed="false">' +
                '<strong>' + escapeHtml(label) + '</strong><small>' + escapeHtml(score) + '</small></button>';
        }).join('');
        overlay.dataset.href = editionItems.length > 1 ? '' : (href || '');
        overlay.practiceEntryOnDismiss = typeof options.onDismiss === 'function' ? options.onDismiss : null;
        overlay.practiceEntryOnCommit = typeof options.onCommit === 'function' ? options.onCommit : null;
        entryCard.classList.toggle('is-question-confirmation', options.hideStatus === true);
        entryCard.setAttribute('aria-label', options.dialogLabel || 'Practice entry confirmation');
        enterButton.querySelector('span').textContent = options.enterLabel || 'Enter';
        overlay.querySelector('#practice-entry-kind').textContent = practiceEntryKind(element);
        overlay.querySelector('#practice-entry-title').textContent = practiceEntryTitle(element);
        statusRibbon.className = 'practice-entry-ribbon ' + status;
        statusRibbon.hidden = options.hideStatus === true;
        overlay.querySelector('#practice-entry-status').innerHTML = practiceEntryScoreHtml(best, locked);
        enterButton.disabled = editionItems.length > 1;
        overlay.hidden = false;
        if (editionItems.length > 1) {
            overlay.querySelector('#practice-entry-status').textContent = 'Choose a version above';
            var firstEdition = editionRoot.querySelector('button');
            if (firstEdition) firstEdition.focus();
        } else {
            enterButton.focus();
        }
    }

    function libraryEditionsForCard(card) {
        var family = String(card && card.dataset && card.dataset.editionFamily || '').trim();
        if (!family || !window.MrCatEditions) return [];
        return window.MrCatEditions.editionsFor((state.resources || []).filter(function(item) {
            return item.visible !== false;
        }), family);
    }

    function openHrefCard(card, event) {
        if (!card) return;
        if (event && event.target && event.target.closest('button, a')) return;
        var href = card.dataset.openHref;
        if (href) showPracticeEntryDialog(card, href, {
            editions: libraryEditionsForCard(card),
            onDismiss: function() {
                if (card.isConnected) card.focus({ preventScroll: true });
            }
        });
    }

    function newestFirst(left, right) {
        return assignmentTime(right) - assignmentTime(left);
    }

    function teacherReplyTotal() {
        return (state.teacherReplies || []).length;
    }

    function teacherReplyUnreadTotal() {
        if (!state.teacherRepliesComplete) return Number(state.teacherReplyUnreadCount || 0);
        return (state.teacherReplies || []).filter(function(reply) {
            return reply && reply.student_seen !== true;
        }).length;
    }

    function initialTeacherReplyVisibleCount(replies) {
        var lastUnreadIndex = -1;
        (replies || []).forEach(function(reply, index) {
            if (reply && reply.student_seen !== true) lastUnreadIndex = index;
        });
        return Math.min((replies || []).length, Math.max(5, lastUnreadIndex + 1));
    }

    function studentMessageTotal() {
        if (!state.assignmentsComplete && state.assignmentCounts) return Number(state.assignmentCounts.todo || 0);
        return todoAssignments().length;
    }

    function syncTeacherRepliesButton(button) {
        if (!button) return;
        var unreadReplies = teacherReplyUnreadTotal();
        var count = button.querySelector('.notice-dot');
        if (count) {
            count.textContent = unreadReplies ? (unreadReplies > 9 ? '9+' : String(unreadReplies)) : '';
            count.hidden = unreadReplies <= 0;
        }
        button.classList.toggle('has-updates', unreadReplies > 0);
        button.setAttribute('aria-label', unreadReplies
            ? unreadReplies + ' unread teacher ' + (unreadReplies === 1 ? 'reply' : 'replies')
            : 'Teacher replies');
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
            messageButton.setAttribute('aria-label', messageTotal
                ? messageTotal + ' item' + (messageTotal === 1 ? '' : 's') + ' in To Do List'
                : 'To Do List');
            messageButton.setAttribute('aria-expanded', 'false');
        }
        syncTeacherRepliesButton(document.querySelector('[data-message-tab="replies"]'));
    }

    function setTeacherRepliesSeen(seenIds) {
        var idSet = new Set(seenIds || []);
        if (!idSet.size) return;
        (state.teacherReplies || []).forEach(function(reply) {
            if (idSet.has(reply.dispute_id)) reply.student_seen = true;
        });
        (state.assignments || []).forEach(function(item) {
            if (!Array.isArray(item.teacher_replies)) return;
            item.teacher_replies.forEach(function(reply) {
                if (idSet.has(reply.dispute_id)) reply.student_seen = true;
            });
        });
        updateDashboardTabNotices();
    }

    function markTeacherRepliesSeen(replies) {
        var ids = replyIds((replies || []).filter(function(reply) {
            return reply && reply.student_seen !== true;
        }));
        if (!ids.length) return Promise.resolve();
        setTeacherRepliesSeen(ids);
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
        var questionText = String(reply.question_text || '').trim() || 'Question text unavailable. Open the exercise to review it.';
        var expected = answerText(reply.answer_snapshot, 'Not shown');
        var submitted = answerText(reply.submitted_answer, 'Not shown');
        var href = hrefForTeacherReply(reply);
        var arguedAt = teacherReplyTime(reply.created_at);
        return '<article class="teacher-reply-item ' + escapeHtml(statusClass) + '" role="button" tabindex="0"' +
            ' data-open-href="' + escapeHtml(href) + '" data-entry-kind="' + escapeHtml(title) + '" data-entry-title="' + escapeHtml(questionText) + '"' +
            ' aria-label="Go to question: ' + escapeHtml(questionText) + '">' +
            '<div class="teacher-reply-head">' +
                '<div class="teacher-reply-question">' +
                    '<div class="student-message-title-window teacher-reply-title-window"><strong class="student-message-title-track teacher-reply-title-track">' + escapeHtml(title) + '</strong></div>' +
                    '<p>' + escapeHtml(questionText) + '</p>' +
                '</div>' +
            '</div>' +
            '<div class="teacher-reply-flow">' +
                '<div class="teacher-reply-answer"><b>Expected</b><span>' + escapeHtml(expected) + '</span></div>' +
                '<div class="teacher-reply-answer submitted">' +
                    '<b>Submitted</b>' +
                    '<span>' + escapeHtml(submitted) + '</span>' +
                '</div>' +
            '</div>' +
            (statusClass === 'rejected' && reply.teacher_note ? '<div class="teacher-reply-note"><b>Teacher note</b><span>' + escapeHtml(reply.teacher_note) + '</span></div>' : '') +
            '<div class="teacher-reply-footer">' +
                (arguedAt ? '<time class="teacher-reply-timestamp" datetime="' + escapeHtml(arguedAt.datetime) + '">Argued &middot; ' + escapeHtml(arguedAt.label) + '</time>' : '<span></span>') +
                '<span class="teacher-reply-status ' + escapeHtml(statusClass) + '"><span>' + statusIcon + '</span>' + escapeHtml(statusLabel) + '</span>' +
            '</div>' +
        '</article>';
    }

    function renderStudentMessageTask(item, type) {
        var status = normalizedStatus(item.status);
        var finished = isFinishedStatus(status);
        var href = assignmentOpenHref(item);
        var title = assignmentTitle(item);
        var kind = studentMessageKind(item);
        var safeTitle = escapeHtml(title);
        var bestPercentage = item.best_percentage == null ? item.latest_percentage : item.best_percentage;
        var dueDate = assignmentDueDate(item);
        var score = finished && bestPercentage != null
            ? '<span class="student-message-score">' + escapeHtml(formatEntryPercent(bestPercentage)) + '</span>'
            : type === 'upcoming' && dueDate
                ? '<span class="student-message-score is-upcoming">DUE ' + escapeHtml(formatShortDate(dueDate).toUpperCase()) + '</span>'
            : !finished && bestPercentage != null
                ? '<span class="student-message-score is-todo">' + escapeHtml(formatEntryPercent(bestPercentage)) + '</span>'
                : '<span class="student-message-score is-todo">0%</span>';
        var entryStatus = finished ? status : 'not-passed';
        var entryLocked = item.answer_revealed === true || item.mastery_locked === true;
        return '<article class="student-message-task ' + escapeHtml(type) + '"' +
            ' data-entry-kind="' + escapeHtml(kind) + '" data-entry-title="' + escapeHtml(title) + '"' +
            ' data-entry-status="' + escapeHtml(entryStatus) + '" data-entry-best="' + escapeHtml(item.best_percentage == null ? '' : item.best_percentage) + '"' +
            ' data-entry-locked="' + (entryLocked ? 'true' : 'false') + '" data-open-href="' + escapeHtml(href) + '"' +
            ' role="link" tabindex="0" aria-label="Review before opening ' + safeTitle + '">' +
            '<div class="student-message-task-main">' +
                '<span class="student-message-kicker">' + escapeHtml(kind) + '</span>' +
                '<span class="student-message-title-window">' +
                    '<strong class="student-message-title-track"><span>' + safeTitle + '</span></strong>' +
                '</span>' +
            '</div>' +
            '<div class="student-message-task-meta" aria-hidden="true">' +
                score +
                '<svg viewBox="0 0 24 24" focusable="false"><path d="m9 5 7 7-7 7"></path></svg>' +
            '</div>' +
        '</article>';
    }

    function renderStudentMessageSection(title, count, body, emptyText, extraClass, collapsible, openByDefault) {
        var content = body
            ? '<div class="student-message-list">' + body + '</div>'
            : emptyText
                ? '<div class="student-message-empty">' + escapeHtml(emptyText) + '</div>'
                : '';
        var head = '<h3>' + escapeHtml(title) + '</h3>' +
            '<span class="student-message-section-head-meta">' +
                (count == null ? '' : '<span class="student-message-section-count">' + escapeHtml(count) + '</span>') +
                (collapsible ? '<svg class="student-message-section-toggle" viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 7.5 4.5 4.5 4.5-4.5"></path></svg>' : '') +
            '</span>';
        if (collapsible) {
            return '<details class="student-message-section is-collapsible ' + escapeHtml(extraClass || '') + '"' + (openByDefault ? ' open' : '') + '>' +
                '<summary class="student-message-section-head">' + head + '</summary>' +
                content +
            '</details>';
        }
        return '<section class="student-message-section ' + escapeHtml(extraClass || '') + '">' +
            '<div class="student-message-section-head">' + head + '</div>' + content +
        '</section>';
    }

    function renderStudentMessageFlatList(body, emptyText) {
        return '<section class="student-message-flat-list">' +
            (body ? '<div class="student-message-list">' + body + '</div>' : '<div class="student-message-empty">' + escapeHtml(emptyText) + '</div>') +
        '</section>';
    }

    function renderDefaultStudentMessageSections(todos, finished) {
        var counts = state.assignmentCounts || {
            todo: todos.length,
            upcoming: 0,
            finished: finished.length
        };
        var replies = state.teacherReplies || [];
        var unreadReplies = teacherReplyUnreadTotal();
        var visibleReplyCount = initialTeacherReplyVisibleCount(replies);
        var tabs = [
            { id: 'todo', label: 'To-Do', count: Number(counts.todo || 0) + Number(counts.upcoming || 0) },
            { id: 'finished', label: 'Finished', count: Number(counts.finished || 0) },
            { id: 'replies', label: 'Teacher replies', iconOnly: true }
        ];
        var tabMarkup = tabs.map(function(tab, index) {
            return '<button class="student-message-tab" id="student-message-tab-' + tab.id + '" type="button" role="tab"' +
                ' aria-selected="' + (index === 0 ? 'true' : 'false') + '" aria-controls="student-message-panel-' + tab.id + '"' +
                ' tabindex="' + (index === 0 ? '0' : '-1') + '" data-message-tab="' + tab.id + '"' +
                (tab.iconOnly ? ' aria-label="' + escapeHtml(unreadReplies ? unreadReplies + ' unread teacher ' + (unreadReplies === 1 ? 'reply' : 'replies') : tab.label) + '"' : '') + '>' +
                (tab.iconOnly
                    ? '<svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M21 11.5c0 4.4-4 8-9 8-1.4 0-2.8-.3-4-.8l-5 1.8 1.8-4.1A7.4 7.4 0 0 1 3 11.5c0-4.4 4-8 9-8s9 3.6 9 8Z"></path><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01"></path></svg>' +
                        '<span class="notice-dot danger"' + (unreadReplies ? '' : ' hidden') + '>' + escapeHtml(unreadReplies > 9 ? '9+' : unreadReplies) + '</span>'
                    : '<span>' + escapeHtml(tab.label) + '</span><span class="student-message-tab-count">' + escapeHtml(tab.count) + '</span>') +
            '</button>';
        }).join('');
        var panels = [
            '<section class="student-message-tab-panel" id="student-message-panel-todo" role="tabpanel" aria-labelledby="student-message-tab-todo" data-message-panel="todo" tabindex="0">' +
                renderStudentMessageFlatList(
                    todos.map(function(item) {
                        return renderStudentMessageTask(item, isOverdueAssignment(item)
                            ? 'overdue'
                            : isUpcomingAssignment(item) ? 'upcoming' : 'todo');
                    }).join(''),
                    'No unfinished assignments.'
                ) +
            '</section>',
            '<section class="student-message-tab-panel" id="student-message-panel-finished" role="tabpanel" aria-labelledby="student-message-tab-finished" data-message-panel="finished" tabindex="0" hidden>' +
                renderStudentMessageFlatList(
                    finished.map(function(item) { return renderStudentMessageTask(item, 'finished'); }).join(''),
                    'Finished assignments will appear here.'
                ) +
            '</section>',
            '<section class="student-message-tab-panel student-message-replies-panel" id="student-message-panel-replies" role="tabpanel" aria-labelledby="student-message-tab-replies" data-message-panel="replies" tabindex="0" hidden>' +
                '<div class="teacher-replies-list">' + (replies.length
                    ? replies.slice(0, visibleReplyCount).map(renderTeacherReplyItem).join('')
                    : '<div class="teacher-replies-empty">No teacher replies yet.</div>') + '</div>' +
            '</section>'
        ].join('');
        return '<div class="student-message-tabs" role="tablist" aria-label="Assignment sections">' + tabMarkup + '</div>' + panels;
    }

    function setupStudentMessageTitleTracks(overlay) {
        var windows = Array.prototype.slice.call(overlay.querySelectorAll('.student-message-title-window'));
        var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        function updateTitleWindow(titleWindow) {
            var track = titleWindow.querySelector('.student-message-title-track');
            if (!track) return;
            var overflow = Math.ceil(track.scrollWidth - titleWindow.clientWidth);
            var shouldScroll = !reduceMotion && titleWindow.clientWidth > 0 && overflow > 2;
            titleWindow.classList.toggle('is-overflowing', shouldScroll);
            if (!shouldScroll) {
                titleWindow.style.removeProperty('--student-message-title-shift');
                titleWindow.style.removeProperty('--student-message-title-duration');
                return;
            }
            titleWindow.style.setProperty('--student-message-title-shift', (-overflow) + 'px');
            titleWindow.style.setProperty('--student-message-title-duration', Math.max(7, Math.min(14, 6 + (overflow / 28))) + 's');
        }

        windows.forEach(updateTitleWindow);
        if (!window.ResizeObserver) return null;
        var observer = new ResizeObserver(function(entries) {
            entries.forEach(function(entry) { updateTitleWindow(entry.target); });
        });
        windows.forEach(function(titleWindow) { observer.observe(titleWindow); });
        return observer;
    }

    function setupTeacherRepliesPagination(options) {
        var host = options.host;
        var scrollContainer = options.scrollContainer;
        var replyList = options.replyList;
        var replies = options.replies || [];
        var visibleReplyCount = Number(options.visibleReplyCount || 0);
        var loadingMoreReplies = false;

        if (!scrollContainer || !replyList) return null;

        function revealNextTeacherReplies() {
            if (!host.isConnected || !replyList || loadingMoreReplies || visibleReplyCount >= replies.length) return;
            loadingMoreReplies = true;
            var previousCount = visibleReplyCount;
            visibleReplyCount = Math.min(replies.length, visibleReplyCount + 5);
            replyList.insertAdjacentHTML('beforeend', replies.slice(previousCount, visibleReplyCount).map(renderTeacherReplyItem).join(''));
            Array.prototype.slice.call(replyList.children, previousCount).forEach(function(card) {
                card.classList.add('is-revealing');
            });
            if (typeof options.onAppend === 'function') options.onAppend();
            loadingMoreReplies = false;
        }

        function revealWhenNearEdge() {
            if (scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight <= 96) {
                revealNextTeacherReplies();
            }
        }

        scrollContainer.addEventListener('scroll', revealWhenNearEdge, { passive: true });
        return revealWhenNearEdge;
    }

    function openStudentMessageCenter(scope) {
        var existing = document.querySelector('.student-message-overlay');
        if (existing && typeof existing.studentMessageClose === 'function') {
            existing.studentMessageClose(false);
        } else if (existing) {
            existing.remove();
            unlockStudentMessageBackground();
        }

        var todos = state.session && state.session.mode === 'student' ? openTodoAssignments() : [];
        var upcoming = state.session && state.session.mode === 'student' ? upcomingAssignments() : [];
        var finished = state.session && state.session.mode === 'student' ? finishedAssignments() : [];
        var dialogTitle = 'Assignments';
        var summaryHtml = '';
        var sectionsHtml = '';

        if (scope === 'week' || scope === 'upcoming' || scope === 'finished') {
            var focusModel = weeklyFocusModel();
            if (scope === 'week') {
                dialogTitle = 'This Week';
                todos = focusModel.thisWeek.filter(function(item) {
                    return normalizedStatus(item.status) === 'to_do';
                }).sort(newestFirst);
                finished = focusModel.thisWeek.filter(function(item) {
                    return isFinishedStatus(item.status);
                }).sort(function(left, right) { return finishedDate(right) - finishedDate(left); });
                summaryHtml = '';
                sectionsHtml = renderStudentMessageFlatList(
                    focusModel.overdue.map(function(item) { return renderStudentMessageTask(item, 'overdue'); }).join('') +
                    todos.map(function(item) { return renderStudentMessageTask(item, 'todo'); }).join('') +
                    finished.map(function(item) { return renderStudentMessageTask(item, 'finished'); }).join(''),
                    'No assignments this week.'
                );
            } else if (scope === 'upcoming') {
                dialogTitle = 'Upcoming';
                upcoming = focusModel.nextWeek.slice().sort(function(left, right) {
                    var leftFinished = isFinishedStatus(left.status) ? 1 : 0;
                    var rightFinished = isFinishedStatus(right.status) ? 1 : 0;
                    return leftFinished - rightFinished || newestFirst(left, right);
                });
                summaryHtml = '';
                sectionsHtml = renderStudentMessageFlatList(
                    upcoming.map(function(item) { return renderStudentMessageTask(item, 'upcoming'); }).join(''),
                    'No assignments are due next week.'
                );
            } else {
                dialogTitle = 'Finished';
                finished = (state.assignments || []).filter(function(item) {
                    return isFinishedStatus(item.status);
                }).sort(function(left, right) { return finishedDate(right) - finishedDate(left); });
                sectionsHtml = renderStudentMessageFlatList(
                    finished.slice(0, 10).map(function(item) { return renderStudentMessageTask(item, 'finished'); }).join(''),
                    'Finished assignments will appear here.'
                );
            }
        } else {
            summaryHtml = '';
            sectionsHtml = renderDefaultStudentMessageSections(
                todos.slice(0, 10),
                finished.slice(0, 10)
            );
        }
        var overlay = document.createElement('div');
        var isAccountFinishedFlow = scope === 'finished';
        overlay.className = 'teacher-replies-overlay student-message-overlay' + (isAccountFinishedFlow ? ' is-account-finished' : '');
        overlay.innerHTML =
            '<div class="student-message-shell' + (isAccountFinishedFlow ? ' is-account-finished' : '') + '" role="dialog" aria-modal="true"' +
                (scope ? ' aria-labelledby="student-message-title"' : ' aria-label="Assignments"') + '>' +
                '<div class="teacher-replies-dialog student-message-dialog' + (scope ? ' is-focused-scope' : '') + (isAccountFinishedFlow ? ' is-account-finished' : '') + '">' +
                    (scope ? '<div class="teacher-replies-dialog-head student-message-dialog-head">' +
                        '<div class="student-message-dialog-title-row' + (scope === 'finished' ? ' has-account-back' : '') + '">' +
                            (scope === 'finished' ? '<button class="account-star-back student-message-account-back" type="button" data-student-message-account-back aria-label="Back to Personal Center">‹</button>' : '') +
                            '<h2 id="student-message-title">' + escapeHtml(dialogTitle) + '</h2>' +
                            (scope === 'finished' ? '<span class="student-message-title-spacer" aria-hidden="true"></span>' : '') +
                        '</div>' +
                        (summaryHtml ? '<div class="student-message-summary">' + summaryHtml + '</div>' : '') +
                    '</div>' : '') +
                    '<div class="student-message-sections">' +
                        sectionsHtml +
                    '</div>' +
                '</div>' +
                '<button class="student-message-close" id="student-message-close" type="button" aria-label="Close To Do List">Close</button>' +
            '</div>';
        document.body.appendChild(overlay);
        lockStudentMessageBackground();
        var messageTitleObserver = setupStudentMessageTitleTracks(overlay);
        updateDashboardTabNotices();
        if (messageButton) messageButton.setAttribute('aria-expanded', 'true');

        var teacherRepliesViewed = false;
        var closed = false;
        function close(markSeen) {
            if (closed) return Promise.resolve();
            closed = true;
            var shouldMarkRepliesSeen = markSeen !== false && teacherRepliesViewed;
            if (messageTitleObserver) messageTitleObserver.disconnect();
            overlay.remove();
            unlockStudentMessageBackground();
            if (messageButton) messageButton.setAttribute('aria-expanded', 'false');
            if (scope === 'finished' && markSeen !== false && identityChip) {
                identityChip.focus({ preventScroll: true });
            }
            return shouldMarkRepliesSeen ? markTeacherRepliesSeen(state.teacherReplies || []) : Promise.resolve();
        }
        overlay.studentMessageClose = close;

        function suspend() {
            overlay.hidden = true;
            if (messageButton) messageButton.setAttribute('aria-expanded', 'false');
        }

        function resume(card) {
            overlay.hidden = false;
            if (messageButton) messageButton.setAttribute('aria-expanded', 'true');
            if (card && card.isConnected) card.focus();
        }
        overlay.querySelector('#student-message-close').addEventListener('click', function() { close(true); });
        var accountBackButton = overlay.querySelector('[data-student-message-account-back]');
        if (accountBackButton) {
            accountBackButton.addEventListener('click', function(event) {
                event.stopPropagation();
                close(false).then(function() {
                    setAccountPanel(true);
                    window.requestAnimationFrame(function() {
                        var finishedButton = document.getElementById('account-finished');
                        if (finishedButton) finishedButton.focus({ preventScroll: true });
                    });
                });
            });
        }
        var messageTabs = Array.prototype.slice.call(overlay.querySelectorAll('[data-message-tab]'));
        var messagePanelScrollPositions = Object.create(null);
        var checkTeacherRepliesEdge = null;
        function selectMessageTab(tab, moveFocus) {
            if (!tab) return;
            var tabId = tab.dataset.messageTab;
            var selectedPanel = null;
            if (tabId === 'replies') teacherRepliesViewed = true;
            messageTabs.forEach(function(candidate) {
                var selected = candidate === tab;
                candidate.setAttribute('aria-selected', selected ? 'true' : 'false');
                candidate.tabIndex = selected ? 0 : -1;
            });
            overlay.querySelectorAll('[data-message-panel]').forEach(function(panel) {
                var panelId = panel.dataset.messagePanel;
                if (!panel.hidden) messagePanelScrollPositions[panelId] = panel.scrollTop;
                panel.hidden = panelId !== tabId;
                if (panelId === tabId) selectedPanel = panel;
            });
            if (moveFocus) tab.focus();
            if (selectedPanel) {
                window.requestAnimationFrame(function() {
                    selectedPanel.scrollTop = Number(messagePanelScrollPositions[tabId] || 0);
                    if (tabId === 'replies' && checkTeacherRepliesEdge) checkTeacherRepliesEdge();
                });
            }
        }
        messageTabs.forEach(function(tab, index) {
            tab.addEventListener('click', function() { selectMessageTab(tab, false); });
            tab.addEventListener('keydown', function(event) {
                var nextIndex = null;
                if (event.key === 'ArrowRight') nextIndex = (index + 1) % messageTabs.length;
                if (event.key === 'ArrowLeft') nextIndex = (index - 1 + messageTabs.length) % messageTabs.length;
                if (event.key === 'Home') nextIndex = 0;
                if (event.key === 'End') nextIndex = messageTabs.length - 1;
                if (nextIndex == null) return;
                event.preventDefault();
                selectMessageTab(messageTabs[nextIndex], true);
            });
        });
        function bindStudentMessageCard(card) {
            if (!card || card.dataset.messageBound === 'true') return;
            card.dataset.messageBound = 'true';
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
        }
        overlay.querySelectorAll('.student-message-task[data-open-href]').forEach(bindStudentMessageCard);

        function bindIntegratedTeacherReplyCards() {
            overlay.querySelectorAll('.teacher-reply-item[data-open-href]').forEach(function(card) {
                if (card.dataset.replyBound === 'true') return;
                card.dataset.replyBound = 'true';
                function openQuestion(event) {
                    if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    event.stopPropagation();
                    var href = card.dataset.openHref;
                    if (!href || href === '#') return;
                    suspend();
                    showPracticeEntryDialog(card, href, {
                        dialogLabel: 'Go to question confirmation',
                        enterLabel: 'Go to question',
                        hideStatus: true,
                        onDismiss: function() { resume(card); },
                        onCommit: function() { close(true); }
                    });
                }
                card.addEventListener('click', openQuestion);
                card.addEventListener('keydown', openQuestion);
            });
        }
        bindIntegratedTeacherReplyCards();

        function assignmentItemsForPanel(panelName) {
            if (panelName === 'finished') return finishedAssignments();
            return openTodoAssignments();
        }

        function appendNextAssignmentBatch(activePanel) {
            if (scope && scope !== 'finished') return;
            activePanel = activePanel || (scope === 'finished'
                ? overlay.querySelector('.student-message-sections')
                : overlay.querySelector('[data-message-panel]:not([hidden])'));
            if (!activePanel) return;
            var list = activePanel.querySelector('.student-message-list');
            if (!list) return;
            var panelName = scope === 'finished' ? 'finished' : activePanel.dataset.messagePanel || 'todo';
            if (panelName === 'replies') return;
            var items = assignmentItemsForPanel(panelName);
            var rendered = list.querySelectorAll('.student-message-task').length;
            var nextItems = items.slice(rendered, rendered + 10);
            if (!nextItems.length) return;
            list.insertAdjacentHTML('beforeend', nextItems.map(function(item) {
                return renderStudentMessageTask(item, panelName === 'finished'
                    ? 'finished'
                    : isOverdueAssignment(item)
                        ? 'overdue'
                        : isUpcomingAssignment(item) ? 'upcoming' : 'todo');
            }).join(''));
            list.querySelectorAll('.student-message-task[data-open-href]').forEach(bindStudentMessageCard);
            if (messageTitleObserver) messageTitleObserver.disconnect();
            messageTitleObserver = setupStudentMessageTitleTracks(overlay);
        }

        var messageDialog = overlay.querySelector('.student-message-dialog');
        if (!scope) {
            overlay.querySelectorAll('[data-message-panel="todo"], [data-message-panel="finished"]').forEach(function(panel) {
                panel.addEventListener('scroll', function() {
                    if (panel.scrollHeight - panel.scrollTop - panel.clientHeight <= 96) {
                        appendNextAssignmentBatch(panel);
                    }
                }, { passive: true });
            });
        } else if (messageDialog && scope === 'finished') {
            messageDialog.addEventListener('scroll', function() {
                if (messageDialog.scrollHeight - messageDialog.scrollTop - messageDialog.clientHeight <= 96) {
                    appendNextAssignmentBatch();
                }
            }, { passive: true });
        }
        if (!scope && messageDialog) {
            var repliesPanel = overlay.querySelector('#student-message-panel-replies');
            checkTeacherRepliesEdge = setupTeacherRepliesPagination({
                host: overlay,
                scrollContainer: repliesPanel,
                replyList: overlay.querySelector('#student-message-panel-replies .teacher-replies-list'),
                replies: state.teacherReplies || [],
                visibleReplyCount: initialTeacherReplyVisibleCount(state.teacherReplies || []),
                onAppend: function() {
                    if (messageTitleObserver) messageTitleObserver.disconnect();
                    messageTitleObserver = setupStudentMessageTitleTracks(overlay);
                    bindIntegratedTeacherReplyCards();
                }
            });
        }
    }

    function openTeacherRepliesDialog(replyItems, options) {
        options = options || {};
        var replies = Array.isArray(replyItems) ? replyItems : (state.teacherReplies || []);
        var lastUnreadIndex = -1;
        replies.forEach(function(reply, index) {
            if (reply && reply.student_seen !== true) lastUnreadIndex = index;
        });
        var visibleReplyCount = Math.min(replies.length, Math.max(5, lastUnreadIndex + 1));
        var opener = options.opener || null;
        var manageScrollLock = options.manageScrollLock !== false;
        var overlay = document.createElement('div');
        overlay.className = 'teacher-replies-overlay';
        overlay.innerHTML =
            '<div class="teacher-replies-stack" role="dialog" aria-modal="true" aria-labelledby="teacher-replies-title">' +
                '<section class="teacher-replies-dialog">' +
                    '<div class="teacher-replies-dialog-head">' +
                        '<h2 class="eyebrow accent" id="teacher-replies-title">Teacher Replies</h2>' +
                    '</div>' +
                    '<div class="teacher-replies-list">' + (replies.length
                        ? replies.slice(0, visibleReplyCount).map(renderTeacherReplyItem).join('')
                        : '<div class="teacher-replies-empty">No teacher replies yet.</div>') + '</div>' +
                '</section>' +
                '<button class="student-message-close teacher-replies-outside-close" id="teacher-replies-close" type="button" aria-label="Close Teacher Replies">Close</button>' +
            '</div>';
        document.body.appendChild(overlay);
        if (manageScrollLock) lockStudentMessageBackground();
        if (opener) opener.setAttribute('aria-expanded', 'true');
        var replyTitleObserver = setupStudentMessageTitleTracks(overlay);

        var didMarkSeen = false;
        var closed = false;
        function close(markSeen) {
            if (closed) return Promise.resolve();
            closed = true;
            if (replyTitleObserver) replyTitleObserver.disconnect();
            overlay.remove();
            if (manageScrollLock) unlockStudentMessageBackground();
            if (opener) opener.setAttribute('aria-expanded', 'false');
            var seenPromise = Promise.resolve();
            if (markSeen && !didMarkSeen) {
                didMarkSeen = true;
                seenPromise = markTeacherRepliesSeen(replies);
            }
            return seenPromise.then(function() {
                if (typeof options.onClose === 'function') options.onClose();
                else if (opener && opener.isConnected) opener.focus();
            });
        }

        function suspend() {
            overlay.hidden = true;
            if (opener) opener.setAttribute('aria-expanded', 'false');
        }

        function resume(card) {
            overlay.hidden = false;
            if (opener) opener.setAttribute('aria-expanded', 'true');
            if (card && card.isConnected) card.focus({ preventScroll: true });
        }
        var closeButton = overlay.querySelector('#teacher-replies-close');
        closeButton.addEventListener('click', function() { close(true); });
        var replyDialog = overlay.querySelector('.teacher-replies-dialog');
        var replyList = overlay.querySelector('.teacher-replies-list');
        var checkTeacherRepliesEdge = setupTeacherRepliesPagination({
            host: overlay,
            scrollContainer: replyDialog,
            replyList: replyList,
            replies: replies,
            visibleReplyCount: visibleReplyCount,
            onAppend: function() {
                if (replyTitleObserver) replyTitleObserver.disconnect();
                replyTitleObserver = setupStudentMessageTitleTracks(overlay);
                bindTeacherReplyCards();
            }
        });
        if (checkTeacherRepliesEdge) window.requestAnimationFrame(checkTeacherRepliesEdge);
        window.setTimeout(function() { closeButton.focus(); }, 0);
        function bindTeacherReplyCards() {
            overlay.querySelectorAll('.teacher-reply-item[data-open-href]').forEach(function(card) {
                if (card.dataset.replyBound === 'true') return;
                card.dataset.replyBound = 'true';
            function openQuestion(event) {
                if (event.type === 'keydown' && event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                event.stopPropagation();
                var href = card.dataset.openHref;
                if (!href || href === '#') return;
                suspend();
                showPracticeEntryDialog(card, href, {
                    dialogLabel: 'Go to question confirmation',
                    enterLabel: 'Go to question',
                    hideStatus: true,
                    onDismiss: function() { resume(card); },
                    onCommit: function() { close(true); }
                });
            }
            card.addEventListener('click', openQuestion);
            card.addEventListener('keydown', openQuestion);
            });
        }
        bindTeacherReplyCards();
    }

    function finishedDate(item) {
        return new Date(finishedSortValue(item) || 0).getTime();
    }

    function isRealAssignment(item) {
        return Boolean(item && item.assignment_id && normalizedStatus(item.status) !== 'cancelled');
    }

    function weeklyFocusModel() {
        var currentWeek = shanghaiWeekKeys(0);
        var nextWeek = shanghaiWeekKeys(1);
        var assignments = (state.assignments || []).filter(isRealAssignment);
        var overdue = assignments.filter(isOverdueAssignment).sort(function(left, right) {
            return assignmentDueDate(left).getTime() - assignmentDueDate(right).getTime();
        });
        var thisWeek = assignments.filter(function(item) {
            var parts = assignmentDueParts(item);
            return parts && parts.key >= currentWeek.start && parts.key <= currentWeek.end;
        });
        var nextWeekAssignments = assignments.filter(function(item) {
            var parts = assignmentDueParts(item);
            return parts && parts.key >= nextWeek.start && parts.key <= nextWeek.end;
        });
        var weekFinished = thisWeek.filter(function(item) {
            return isFinishedStatus(item.status);
        });
        var nextWeekFinished = nextWeekAssignments.filter(function(item) {
            return isFinishedStatus(item.status);
        });

        return {
            overdue: overdue,
            thisWeek: thisWeek,
            weekFinished: weekFinished,
            nextWeek: nextWeekAssignments,
            nextWeekFinished: nextWeekFinished
        };
    }

    function renderWeeklyProgressRow(options) {
        var value = Math.max(0, Math.min(100, Number(options.percent || 0)));
        var scope = String(options.scope || '');
        var emptyStatus = String(options.emptyStatus || '');
        var tag = scope ? 'button' : 'section';
        return '<' + tag + ' class="weekly-progress-row ' + escapeHtml(options.kind || '') + '"' +
            (scope ? ' type="button" data-weekly-focus-scope="' + escapeHtml(scope) + '"' : '') +
            ' aria-label="' + escapeHtml(options.ariaLabel || options.label || '') + '">' +
                '<div class="weekly-progress-heading">' +
                    '<span class="weekly-progress-label">' + escapeHtml(options.label || '') + '</span>' +
                    (emptyStatus
                        ? '<span class="weekly-progress-empty-status"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="15" rx="3"></rect><path d="M8 3.5v4M16 3.5v4M3.5 10h17"></path><path d="m8.8 15.4 2.1 2.1 4.5-4.5"></path></svg><span>' + escapeHtml(emptyStatus) + '</span></span>'
                        : '<span class="weekly-progress-track" role="progressbar" aria-label="' + escapeHtml(options.progressLabel || options.label || '') + '" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + escapeHtml(value) + '">' +
                            '<i style="--weekly-progress-scale:' + escapeHtml(value / 100) + '"></i>' +
                        '</span>' +
                        '<span class="weekly-progress-percent" aria-hidden="true">' + escapeHtml(value) + '%</span>') +
                '</div>' +
            '</' + tag + '>';
    }

    function setWeeklyFocusHtml(html) {
        if (weeklyFocusTitleObserver) weeklyFocusTitleObserver.disconnect();
        weeklyFocusProgress.innerHTML = html;
        weeklyFocusTitleObserver = setupStudentMessageTitleTracks(weeklyFocusProgress);
        weeklyFocusProgress.querySelectorAll('[data-weekly-focus-scope]').forEach(function(button) {
            button.addEventListener('click', function() {
                openStudentMessageCenter(button.dataset.weeklyFocusScope || '');
            });
        });
    }

    function renderWeeklyFocusProgress() {
        if (!weeklyFocusProgress) return;
        weeklyFocusProgress.classList.remove('is-loading');
        weeklyFocusProgress.setAttribute('aria-busy', 'false');

        if (!state.session || state.session.mode !== 'student') {
            setWeeklyFocusHtml(renderWeeklyProgressRow({
                kind: 'this-week is-static',
                label: 'THIS WEEK',
                ariaLabel: 'Sign in to track weekly assignment progress.',
                progressLabel: 'Weekly assignment progress',
                percent: 0,
                items: []
            }));
            return;
        }

        var model = weeklyFocusModel();
        var summary = !state.assignmentsComplete && state.weeklySummary ? state.weeklySummary : null;
        var html = '';
        var weekTotal = summary ? Number(summary.this_week_total || 0) : model.thisWeek.length + model.overdue.length;
        var weekFinished = summary ? Number(summary.this_week_finished || 0) : model.weekFinished.length;
        var overdueCount = summary ? Number(summary.overdue_count || 0) : model.overdue.length;
        var weekPercent = weekTotal ? Math.round((weekFinished / weekTotal) * 100) : 0;
        html += renderWeeklyProgressRow({
            kind: 'this-week' + (overdueCount ? ' has-overdue' : '') + (weekTotal && weekFinished === weekTotal ? ' is-complete' : '') + (!weekTotal ? ' is-empty' : ''),
            label: 'THIS WEEK',
            scope: 'week',
            ariaLabel: weekTotal
                ? 'This week assignments include ' + overdueCount + ' overdue. ' + weekFinished + ' of ' + weekTotal + ' assignments are finished. Open this week task list.'
                : 'No assignments are scheduled for this week. Open this week task list.',
            progressLabel: 'This week assignment completion',
            percent: weekPercent
        });
        setWeeklyFocusHtml(html);
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
        if (todo.length) html += '<div class="task-list">' + todo.slice(0, 10).map(taskCard).join('') + '</div>';
        if (!assignments.length) {
            html += '<div class="empty-card"><strong>No assignments yet</strong>Your teacher has not assigned any work to this account.</div>';
        } else if (!todo.length) {
            html += '<div class="empty-card"><strong>No new work is waiting.</strong>Open To Do List to review finished work, or explore the Library.</div>';
        }
        assignmentContent.innerHTML = html;
        updateDashboardTabNotices();

        document.querySelectorAll('[data-teacher-replies-key]').forEach(function(button) {
            button.addEventListener('click', function() {
                var key = button.dataset.teacherRepliesKey;
                var item = assignments.find(function(candidate) {
                    return replyKeyForItem(candidate) === key;
                });
                openTeacherRepliesDialog(item && item.teacher_replies || [], { opener: button });
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
                    if (result.star_achievement) {
                        var claimedAchievement = Object.assign({}, result.star_achievement, {
                            set: item && item.set || result.star_achievement.set
                        });
                        state.starAchievements = (state.starAchievements || []).filter(function(achievement) {
                            return achievement.achievement_id !== claimedAchievement.achievement_id;
                        });
                        state.starAchievements.push(claimedAchievement);
                    }
                    playStarSound();
                    animateStarToCounter(button);
                    renderWeeklyFocusProgress();
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
    var libraryActiveSubTab = 'bbc-2026';
    var libraryCategoryMenuOpen = false;
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
        var setId = item && item._edition_items && item._edition_items.length > 1
            ? item.edition_family
            : vocabularyLibraryRangeLabel(item) || item.set_id || item.id || item.displayValue || '';
        return {
            badge: badge,
            sectionLabel: sectionLabel,
            setId: setId
        };
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
        var article = '<article class="resource-card library-task-card student-library-card' + (extraClass ? ' ' + extraClass : '') + '"' +
            (itemYear ? ' data-year="' + escapeHtml(itemYear) + '"' : '') +
            (item.edition_family && item._edition_items && item._edition_items.length > 1
                ? ' data-edition-family="' + escapeHtml(item.edition_family) + '"'
                : '') +
            ' data-entry-kind="' + escapeHtml(meta.sectionLabel) + '" data-entry-title="' + escapeHtml(item.title || meta.setId || 'Practice') + '"' +
            ' data-entry-status="' + escapeHtml(itemStatus) + '" data-entry-best="' + escapeHtml(item.best_percentage == null ? '' : item.best_percentage) + '"' +
            ' data-entry-locked="' + (itemLocked ? 'true' : 'false') + '"' +
            ' data-open-href="' + escapeHtml(href) + '"' +
            ' role="link" tabindex="0" aria-label="Open ' + escapeHtml(item.title || meta.setId) + '">';
        var copy = '<div class="library-task-copy">' +
                '<div class="resource-card-head">' +
                    '<p class="eyebrow accent">' + escapeHtml(meta.sectionLabel) + '</p>' +
                    '<span>' + escapeHtml(meta.setId) + '</span>' +
                '</div>' +
                '<h3>' + escapeHtml(item.title || meta.setId) + '</h3>' +
            '</div>';
        article += copy;
        return article + '</article>';
    }

    function libraryDisplayItems(items) {
        if (!window.MrCatEditions) return (items || []).slice();
        return window.MrCatEditions.group(items || []).map(function(group) {
            if (!group.versioned) return group.representative;
            var representative = Object.assign({}, group.representative);
            representative.edition_family = group.family;
            representative._edition_items = group.editions;
            representative.edition_search_text = group.editions.map(function(item) {
                return [item.set_id, item.id, item.edition_label].filter(Boolean).join(' ');
            }).join(' ');
            return representative;
        });
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

    function librarySectionById(sectionId) {
        var sections = libraryCatalog && libraryCatalog.sections || [];
        for (var i = 0; i < sections.length; i++) {
            if (sections[i].id === sectionId) return sections[i];
        }
        return null;
    }

    function librarySearchHaystack(item) {
        var section = librarySectionById(item && (item.sectionId || item.section_id));
        return [
            item && item.title,
            item && item.id,
            item && item.set_id,
            item && item.topic,
            item && item.displayValue,
            item && item.course,
            item && item.type,
            item && item.sourceName,
            item && item.source_name,
            item && item.note,
            item && item.edition_search_text,
            section && section.id,
            section && section.title,
            (item && item.tags || []).join(' ')
        ].join(' ').toLowerCase();
    }

    function libraryItemMatchesSearch(item, searchText) {
        return !searchText || librarySearchHaystack(item).indexOf(searchText) !== -1;
    }

    function librarySubTabConfig(tabId, subTabId) {
        var configs = LIBRARY_SUB_TABS[tabId] || [];
        if (!configs.length) return null;
        if (!subTabId) return configs[0];
        for (var i = 0; i < configs.length; i++) {
            if (configs[i].id === subTabId) return configs[i];
        }
        return configs[0];
    }

    function librarySyncCategoryMenu() {
        if (!studentLibraryCategoryTrigger || !studentLibraryCategoryLabel || !studentLibraryCategoryPopover) return;
        var config = librarySubTabConfig(libraryActiveTab, libraryActiveSubTab);
        var label = config && config.label || 'Categories';
        studentLibraryCategoryLabel.textContent = label;
        studentLibraryCategoryTrigger.setAttribute('aria-label', 'Choose Library category. Current category: ' + label);
        studentLibraryCategoryTrigger.setAttribute('aria-expanded', libraryCategoryMenuOpen ? 'true' : 'false');
        studentLibraryCategoryPopover.hidden = !libraryCategoryMenuOpen;
        studentLibraryCategoryPopover.setAttribute('aria-hidden', libraryCategoryMenuOpen ? 'false' : 'true');
        if (studentLibraryCategoryMenu) studentLibraryCategoryMenu.classList.toggle('is-open', libraryCategoryMenuOpen);
    }

    function setLibraryCategoryMenuOpen(open, restoreFocus) {
        libraryCategoryMenuOpen = open === true;
        librarySyncCategoryMenu();
        if (!libraryCategoryMenuOpen && restoreFocus && studentLibraryCategoryTrigger) {
            studentLibraryCategoryTrigger.focus({ preventScroll: true });
        }
    }

    function libraryTabForSection(section) {
        if (!section) return '';
        var tabIds = Object.keys(LIBRARY_GROUP_IDS);
        for (var i = 0; i < tabIds.length; i++) {
            if ((LIBRARY_GROUP_IDS[tabIds[i]] || []).indexOf(section.groupId || 'general') !== -1) {
                return tabIds[i];
            }
        }
        return '';
    }

    function libraryDestinationForItem(item) {
        var section = librarySectionById(item && (item.sectionId || item.section_id));
        var tabId = libraryTabForSection(section);
        if (!tabId) return null;
        var configs = LIBRARY_SUB_TABS[tabId] || [];
        var fallback = null;
        for (var i = 0; i < configs.length; i++) {
            if (!librarySubTabMatchesSection(configs[i], section) || !librarySubTabMatchesItem(configs[i], item)) continue;
            if (configs[i].id) {
                return { tabId: tabId, subTabId: configs[i].id };
            }
            fallback = configs[i];
        }
        return fallback ? { tabId: tabId, subTabId: fallback.id } : null;
    }

    function librarySearchRank(item, searchText) {
        var identity = libraryItemIdentity(item).toLowerCase();
        var title = String(item && item.title || '').toLowerCase();
        if (identity === searchText) return 0;
        if (title === searchText) return 1;
        if (identity.indexOf(searchText) === 0) return 2;
        if (title.indexOf(searchText) === 0) return 3;
        return 4;
    }

    function librarySelectionContainsItem(item) {
        var section = librarySectionById(item && (item.sectionId || item.section_id));
        var config = librarySubTabConfig(libraryActiveTab, libraryActiveSubTab);
        if (!section || !config) return false;
        if ((LIBRARY_GROUP_IDS[libraryActiveTab] || []).indexOf(section.groupId || 'general') === -1) return false;
        return librarySubTabMatchesSection(config, section) && librarySubTabMatchesItem(config, item);
    }

    function librarySyncTabButtons() {
        var bar = document.getElementById('student-library-tab-bar');
        if (!bar) return;
        var tabs = bar.querySelectorAll('.library-tab-btn');
        for (var i = 0; i < tabs.length; i++) {
            tabs[i].classList.toggle('active', tabs[i].getAttribute('data-tab') === libraryActiveTab);
        }
    }

    function libraryApplyGlobalSearchDestination(searchText) {
        if (!searchText) return false;
        var matches = (state.resources || []).filter(function(item) {
            return item.visible !== false && libraryItemMatchesSearch(item, searchText);
        });
        if (!matches.length) return false;
        for (var i = 0; i < matches.length; i++) {
            if (librarySelectionContainsItem(matches[i])) return false;
        }
        matches = matches.map(function(item, index) {
            return { item: item, index: index, rank: librarySearchRank(item, searchText) };
        }).sort(function(left, right) {
            return left.rank - right.rank || left.index - right.index;
        });
        for (var i = 0; i < matches.length; i++) {
            var destination = libraryDestinationForItem(matches[i].item);
            if (!destination) continue;
            var changed = libraryActiveTab !== destination.tabId || libraryActiveSubTab !== destination.subTabId;
            libraryActiveTab = destination.tabId;
            libraryActiveSubTab = destination.subTabId;
            librarySyncTabButtons();
            return changed;
        }
        return false;
    }

    function handleLibrarySearchKeydown(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        setLibrarySearchOpen(false);
    }

    function setLibrarySearchOpen(open) {
        if (!studentLibraryDock || !resourceSearch || !resourceSearchToggle) return;
        var shouldOpen = open === true;
        if (shouldOpen) setLibraryCategoryMenuOpen(false, false);
        studentLibraryDock.classList.toggle('is-searching', shouldOpen);
        resourceSearchToggle.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        resourceSearch.disabled = !shouldOpen;
        if (resourceSearchClose) resourceSearchClose.disabled = !shouldOpen;
        if (studentLibrarySearchPanel) studentLibrarySearchPanel.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
        document.removeEventListener('keydown', handleLibrarySearchKeydown);
        if (shouldOpen) {
            document.addEventListener('keydown', handleLibrarySearchKeydown);
            window.requestAnimationFrame(function() {
                resourceSearch.focus({ preventScroll: true });
            });
            return;
        }
        resourceSearch.value = '';
        libraryLoadTabContent(libraryActiveTab);
        resourceSearchToggle.focus({ preventScroll: true });
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
            subTabHtml += '<button class="sub-tab-btn' + (isActive ? ' active' : '') + '" type="button" data-subtab="' + escapeHtml(subTabs[si].id) + '" aria-pressed="' + (isActive ? 'true' : 'false') + '">' + escapeHtml(subTabs[si].label) + '</button>';
        }
        subTabBar.innerHTML = subTabHtml;
        librarySyncCategoryMenu();

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
        var visibleItems = libraryDisplayItems((state.resources || []).filter(function(item) {
            return item.visible !== false;
        }));
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
                return libraryItemMatchesSearch(item, searchText);
            });

            if (!searchText && section.id === yearSectionId && !sectionItems.length) {
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
            } else if (!searchText && !targetSectionId && !section.yearFilter) {
                cardsHtml += libraryBuildPlaceholderCard(section);
            }
        }

        if (!searchText && targetSectionId && !cardsHtml && !activeSubTabConfig.vocabularySource) {
            for (var i = 0; i < libraryCatalog.sections.length; i++) {
                if (libraryCatalog.sections[i].id === targetSectionId) {
                    cardsHtml = libraryBuildPlaceholderCard(libraryCatalog.sections[i]);
                    break;
                }
            }
        }

        if (!cardsHtml) {
            cardsHtml = searchText
                ? '<p class="section-description">No Library tasks match &ldquo;' + escapeHtml(resourceSearch.value.trim()) + '&rdquo;.</p>'
                : '<p class="section-description">No content yet.</p>';
        }

        root.innerHTML = '<div class="resource-list library-task-list student-library-list">' + cardsHtml + '</div>';
    }

    function librarySwitchTab(tabId) {
        if (tabId === libraryActiveTab) return;
        libraryActiveTab = tabId;
        libraryActiveSubTab = tabId === 'general' ? 'bbc-2026' : '';
        setLibraryCategoryMenuOpen(false, false);
        librarySyncTabButtons();
        libraryLoadTabContent(tabId);
    }

    function wordSourceLabel(word) {
        return word.source_title || word.source_set_id || word.source_path || 'Saved from Mr. Cat Academy';
    }

    function wordTimeLabel(word) {
        return formatShortDate(word.last_added_at || word.updated_at || word.created_at);
    }

    function wordPrimaryHtml(word) {
        var dictionary = word && word.dictionary;
        if (!dictionary) {
            var status = word && word.lookup_status || 'pending';
            return '<span class="my-word-primary-copy">' +
                '<span class="my-word-pos">—</span>' +
                '<span class="my-word-chinese">' + (status === 'not_found' ? '暂未找到中文释义' : '正在查找释义…') + '</span>' +
            '</span>';
        }
        return '<span class="my-word-primary-copy">' +
            '<span class="my-word-pos">' + escapeHtml(dictionary.part_of_speech || '—') + '</span>' +
            '<span class="my-word-chinese">' + escapeHtml(wordChineseMeaning(dictionary)) + '</span>' +
        '</span>';
    }

    function wordChineseMeaning(dictionary) {
        var meaning = String(dictionary && dictionary.chinese_meaning || '').trim();
        if (!meaning) return '暂无中文释义';
        var partOfSpeech = String(dictionary && dictionary.part_of_speech || '').trim();
        if (partOfSpeech) {
            var escapedPartOfSpeech = partOfSpeech.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            meaning = meaning.replace(new RegExp('^\\s*' + escapedPartOfSpeech + '\\s*[.:：、，,;；\\-]?\\s*', 'i'), '');
        }
        meaning = meaning.replace(/(^|[;；、]\s*)(?:(?:n(?:oun)?|v(?:erb)?|vt|vi|adj(?:ective)?|adv(?:erb)?|prep(?:osition)?|pron(?:oun)?|conj(?:unction)?|det(?:erminer)?|aux(?:iliary)?|modal|num(?:eral)?|art(?:icle)?|int(?:erjection)?)\.?\s*(?:[/,&+]\s*)?)+(?=[\u3400-\u9fff])/gi, '$1');
        meaning = meaning.replace(/^\s*[.:：、，,;；\-]+\s*/, '').trim();
        return meaning || '暂无中文释义';
    }

    function wordSpeechButtonHtml(word, spokenWord) {
        return '<button class="my-word-speak" type="button" data-speak-word="' + escapeHtml(spokenWord) + '" aria-label="Pronounce ' + escapeHtml(spokenWord) + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
                '<path d="M5 10v4h3l4 3V7l-4 3H5Z"></path>' +
                '<path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10"></path>' +
            '</svg>' +
        '</button>';
    }

    function wordArchiveButtonHtml(word) {
        var text = word && word.text || 'word';
        return '<button class="my-word-archive" type="button" data-archive-word="' + escapeHtml(word && word.vocab_id || '') + '" aria-label="Remove ' + escapeHtml(text) + '">' +
            '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">' +
                '<path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5"></path>' +
            '</svg>' +
        '</button>';
    }

    function wordDetailHtml(word) {
        var dictionary = word && word.dictionary;
        var spokenWord = dictionary && dictionary.word || word.text || '';
        var source = wordSourceLabel(word);
        var date = wordTimeLabel(word);
        var examples = Array.isArray(word && word.saved_examples) ? word.saved_examples : [];
        var examplesHtml = examples.length ? '<div class="my-word-examples"><strong>Saved examples</strong>' + examples.slice(0, 8).map(function(example) {
            return '<div><span>' + escapeHtml(example.form || word.text || '') + '</span>' +
                (example.context ? '<blockquote>' + escapeHtml(example.context) + '</blockquote>' : '') +
                '<small>' + escapeHtml(example.source_title || example.source_set_id || '') + '</small></div>';
        }).join('') + '</div>' : (word.context ? '<blockquote>' + escapeHtml(word.context) + '</blockquote>' : '');
        var noteHtml = state.vocabNoteEditingId === word.vocab_id
            ? '<form class="my-word-note-form" data-note-form="' + escapeHtml(word.vocab_id) + '"><textarea maxlength="500" placeholder="Add a personal note">' + escapeHtml(word.personal_note || '') + '</textarea><div><button class="outline-button" type="button" data-cancel-note>Cancel</button><button class="primary-button" type="submit">Done</button></div></form>'
            : '<div class="my-word-note"><strong>Note</strong><p>' + escapeHtml(word.personal_note || 'No personal note yet.') + '</p></div>';
        var editHtml = state.vocabEditingId === word.vocab_id
            ? '<form class="my-word-edit-form" data-edit-form="' + escapeHtml(word.vocab_id) + '"><input name="text" maxlength="120" value="' + escapeHtml(word.text || '') + '" required><div><button class="outline-button" type="button" data-cancel-word-edit>Cancel</button><button class="primary-button" type="submit">Done</button></div></form>'
            : '';
        var recommendation = word.recommended_headword
            ? '<button class="my-word-recommendation" type="button" data-use-headword="' + escapeHtml(word.recommended_headword) + '" data-vocab-id="' + escapeHtml(word.vocab_id) + '">' +
                ((word.merge_candidate_ids || []).length ? 'Merge with ' : 'Use ') + escapeHtml(word.recommended_headword) + '</button>'
            : '';
        var actions = '<div class="my-word-actions">' +
            '<button type="button" data-edit-word="' + escapeHtml(word.vocab_id) + '">Edit word</button>' +
            '<button type="button" data-edit-note="' + escapeHtml(word.vocab_id) + '">' + (word.personal_note ? 'Edit Note' : 'Add Note') + '</button>' +
            (!dictionary && (word.lookup_status === 'not_found') ? '<button type="button" data-ai-word="' + escapeHtml(word.vocab_id) + '">Ask AI</button>' : '') +
            (dictionary ? '<button type="button" data-report-word="' + escapeHtml(word.vocab_id) + '">Report issue</button>' : '') +
            '</div>';
        if (!dictionary) {
            var lookupStatus = word && word.lookup_status || 'pending';
            return '<div class="my-word-detail-copy muted">' +
                editHtml + recommendation +
                '<div class="my-word-phonetic-row"><p class="my-word-phonetic">Pronunciation pending</p>' + wordSpeechButtonHtml(word, spokenWord) + '</div>' +
                '<p>' + (lookupStatus === 'not_found' ? 'Dictionary entry not found yet.' : 'Finding dictionary details...') + '</p>' +
                (lookupStatus === 'not_found' ? '<button class="my-word-lookup" type="button" data-lookup-word="' + escapeHtml(word.vocab_id || '') + '">Retry</button>' : '') +
                examplesHtml + noteHtml + actions +
                '<p class="my-word-detail-meta">' + escapeHtml(source) + (date ? ' · ' + escapeHtml(date) : '') + '</p>' +
                wordArchiveButtonHtml(word) +
            '</div>';
        }
        var dictionaryStatus = dictionary.review_status === 'ai_draft'
            ? '<p class="my-word-dictionary-status">AI-generated · Not reviewed by teacher</p>'
            : (dictionary.verified ? '<p class="my-word-dictionary-status">Teacher reviewed</p>' : '');
        return '<div class="my-word-detail-copy">' +
            editHtml + recommendation +
            dictionaryStatus +
            '<div class="my-word-phonetic-row"><p class="my-word-phonetic">' + escapeHtml(dictionary.phonetic || 'Pronunciation') + '</p>' + wordSpeechButtonHtml(word, spokenWord) + '</div>' +
            (dictionary.english_definition ? '<p class="my-word-definition">' + escapeHtml(dictionary.english_definition) + '</p>' : '') +
            (dictionary.word_forms ? '<p><strong>Forms:</strong> ' + escapeHtml(dictionary.word_forms) + '</p>' : '') +
            examplesHtml + noteHtml + actions +
            '<p class="my-word-detail-meta">' + escapeHtml(source) + (date ? ' · ' + escapeHtml(date) : '') + '</p>' +
            wordArchiveButtonHtml(word) +
        '</div>';
    }

    function wordCardHtml(word) {
        var detailId = 'my-word-detail-' + escapeHtml(word.vocab_id || 'word');
        var detailOpen = Boolean(state.vocabExpanded[word.vocab_id]);
        return '<article class="my-word-item">' +
            '<div class="my-word-summary">' +
                (state.vocabExportOpen ? '<label class="my-word-select"><input type="checkbox" data-select-word="' + escapeHtml(word.vocab_id || '') + '"' + (state.vocabSelected[word.vocab_id] ? ' checked' : '') + '><span></span></label>' : '') +
                '<button class="my-word-toggle" type="button" data-toggle-word="' + escapeHtml(word.vocab_id || '') + '" aria-expanded="' + (detailOpen ? 'true' : 'false') + '" aria-controls="' + detailId + '">' +
                    '<span class="my-word-name">' + escapeHtml(word.text || '') + (word.recommended_headword ? '<small>Base: ' + escapeHtml(word.recommended_headword) + '</small>' : '') + (word.personal_note ? '<small>Note</small>' : '') + '</span>' +
                    wordPrimaryHtml(word) +
                '</button>' +
            '</div>' +
            '<div class="my-word-detail" id="' + detailId + '"' + (detailOpen ? '' : ' hidden') + '>' + wordDetailHtml(word) + '</div>' +
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
                (state.vocabSearch ? 'No saved words match this search.' : 'Select a word or short phrase anywhere in the site to save it here.') +
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

    function replaceVocabItem(oldId, word) {
        var wasExpanded = Boolean(state.vocabExpanded[oldId]);
        state.vocabItems = (state.vocabItems || []).filter(function(item) {
            return item.vocab_id !== oldId && (!word || item.vocab_id !== word.vocab_id);
        });
        if (word) state.vocabItems.unshift(word);
        if (oldId !== (word && word.vocab_id)) {
            delete state.vocabSelected[oldId];
            delete state.vocabExpanded[oldId];
            if (word && wasExpanded) state.vocabExpanded[word.vocab_id] = true;
        }
    }

    function vocabWord(vocabId) {
        return (state.vocabItems || []).find(function(item) { return item.vocab_id === vocabId; }) || null;
    }

    function callStudentVocabulary(payload) {
        return window.MrCatCloud.callFunction('studentVocabulary', payload).then(function(result) {
            if (!result || !result.success) {
                var error = new Error(result && result.message || 'Unable to update My Words.');
                error.result = result;
                throw error;
            }
            return result;
        });
    }

    function reloadMyWords() {
        return callStudentVocabulary({ action: 'list', status: 'active', limit: 200 }).then(function(result) {
            state.vocabItems = result.words || [];
            renderMyWordsList();
            return result.words || [];
        });
    }

    function showMergeUndo(vocabId) {
        var toast = document.createElement('div');
        toast.className = 'my-words-undo-toast';
        toast.innerHTML = '<span>Words merged.</span><button type="button">Undo</button>';
        document.body.appendChild(toast);
        window.requestAnimationFrame(function() { toast.classList.add('show'); });
        var timer = window.setTimeout(function() {
            toast.classList.remove('show');
            window.setTimeout(function() { toast.remove(); }, 180);
        }, 10000);
        toast.querySelector('button').addEventListener('click', function() {
            window.clearTimeout(timer);
            callStudentVocabulary({ action: 'undoMerge', vocab_id: vocabId }).then(function() {
                toast.remove();
                return reloadMyWords();
            }).catch(function(error) { alert(error.message); });
        });
    }

    function mergeWordGroup(word, headword, ids) {
        var groupIds = Array.from(new Set([word.vocab_id].concat(ids || word.merge_candidate_ids || [])));
        var selected = groupIds.map(vocabWord).filter(Boolean);
        if (selected.length < 2) {
            state.vocabEditingId = word.vocab_id;
            state.vocabExpanded[word.vocab_id] = true;
            renderMyWordsList();
            var input = myWordsContent.querySelector('[data-edit-form] input');
            if (input) { input.value = headword; input.focus(); }
            return;
        }
        var modal = document.createElement('section');
        modal.className = 'my-word-merge-modal';
        modal.innerHTML = '<div class="my-word-merge-card" role="dialog" aria-modal="true" aria-labelledby="my-word-merge-title">' +
            '<p class="eyebrow accent">MERGE WORD FORMS</p><h2 id="my-word-merge-title">Keep ' + escapeHtml(headword) + '</h2>' +
            '<p>Select the forms to combine. Notes and saved examples will be kept.</p>' +
            '<div class="my-word-merge-options">' + selected.map(function(item) {
                return '<label><input type="checkbox" value="' + escapeHtml(item.vocab_id) + '" checked><span>' + escapeHtml(item.text) + '</span></label>';
            }).join('') + '</div>' +
            '<p class="my-word-merge-status" role="status"></p><div class="my-word-merge-actions"><button class="outline-button" type="button" data-cancel-merge>Cancel</button><button class="primary-button" type="button" data-confirm-merge>Merge selected</button></div></div>';
        document.body.appendChild(modal);
        var cancel = function() { modal.remove(); };
        modal.querySelector('[data-cancel-merge]').addEventListener('click', cancel);
        modal.addEventListener('click', function(event) { if (event.target === modal) cancel(); });
        modal.querySelector('[data-confirm-merge]').addEventListener('click', function() {
            var checkedIds = Array.from(modal.querySelectorAll('input:checked')).map(function(input) { return input.value; });
            var status = modal.querySelector('.my-word-merge-status');
            if (checkedIds.length < 2) { status.textContent = 'Choose at least two word forms.'; return; }
            var button = modal.querySelector('[data-confirm-merge]');
            button.disabled = true;
            status.textContent = 'Merging...';
            callStudentVocabulary({ action: 'mergeWords', vocab_ids: checkedIds, headword: headword }).then(function(result) {
            checkedIds.forEach(function(id) { replaceVocabItem(id, null); });
            upsertVocabItem(result.word);
            modal.remove();
            renderMyWordsList();
            showMergeUndo(result.word.vocab_id);
            }).catch(function(error) { button.disabled = false; status.textContent = error.message; });
        });
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
        var form = wordsAddForm;
        if (!form || form.dataset.bound === 'true') return;
        form.dataset.bound = 'true';
        var textInput = wordsAddInput;
        var status = wordsAddStatus;
        var submit = document.getElementById('my-words-manual-submit');
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            var text = String(textInput && textInput.value || '').replace(/\s+/g, ' ').trim();
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
                context: ''
            }).then(function(result) {
                if (!result || !result.success) throw new Error(result && result.message || 'Unable to add this word.');
                upsertVocabItem(result.word);
                if (textInput) textInput.value = '';
                renderMyWordsList();
                setMyWordsToolOpen('add', false);
                if (wordsScroll) wordsScroll.scrollTop = 0;
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
        if (!myWordsContent) return;
        myWordsContent.querySelectorAll('[data-toggle-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                var detail = document.getElementById(button.getAttribute('aria-controls'));
                if (!detail) return;
                var open = detail.hidden;
                state.vocabExpanded[button.dataset.toggleWord] = open;
                detail.hidden = !open;
                button.setAttribute('aria-expanded', open ? 'true' : 'false');
            });
        });
        myWordsContent.querySelectorAll('[data-archive-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                var vocabId = button.dataset.archiveWord;
                if (!vocabId) return;
                button.disabled = true;
                button.setAttribute('aria-label', 'Removing word...');
                window.MrCatCloud.callFunction('studentVocabulary', {
                    action: 'archive',
                    vocab_id: vocabId
                }).then(function(result) {
                    if (!result || !result.success) throw new Error(result && result.message || 'Unable to archive this word.');
                    state.vocabItems = (state.vocabItems || []).filter(function(word) {
                        return word.vocab_id !== vocabId;
                    });
                    delete state.vocabExpanded[vocabId];
                    renderMyWordsList();
                }).catch(function(error) {
                    button.disabled = false;
                    button.setAttribute('aria-label', 'Remove word');
                    alert(error.message || 'Unable to archive this word.');
                });
            });
        });
        myWordsContent.querySelectorAll('[data-speak-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                var value = button.dataset.speakWord || '';
                if (!value || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
                window.speechSynthesis.cancel();
                var utterance = new SpeechSynthesisUtterance(value);
                utterance.lang = 'en-GB';
                window.speechSynthesis.speak(utterance);
            });
        });
        myWordsContent.querySelectorAll('[data-lookup-word]').forEach(function(button) {
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
        myWordsContent.querySelectorAll('[data-select-word]').forEach(function(input) {
            input.addEventListener('change', function() {
                state.vocabSelected[input.dataset.selectWord] = input.checked;
                updateExportSelectionCount();
            });
        });
        myWordsContent.querySelectorAll('[data-edit-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.vocabExpanded[button.dataset.editWord] = true;
                state.vocabEditingId = button.dataset.editWord;
                state.vocabNoteEditingId = '';
                renderMyWordsList();
                var input = myWordsContent.querySelector('[data-edit-form] input');
                if (input) { input.focus(); input.select(); }
            });
        });
        myWordsContent.querySelectorAll('[data-edit-note]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.vocabExpanded[button.dataset.editNote] = true;
                state.vocabNoteEditingId = button.dataset.editNote;
                state.vocabEditingId = '';
                renderMyWordsList();
                var textarea = myWordsContent.querySelector('[data-note-form] textarea');
                if (textarea) textarea.focus();
            });
        });
        myWordsContent.querySelectorAll('[data-cancel-word-edit]').forEach(function(button) {
            button.addEventListener('click', function() { state.vocabEditingId = ''; renderMyWordsList(); });
        });
        myWordsContent.querySelectorAll('[data-cancel-note]').forEach(function(button) {
            button.addEventListener('click', function() { state.vocabNoteEditingId = ''; renderMyWordsList(); });
        });
        myWordsContent.querySelectorAll('[data-edit-form]').forEach(function(form) {
            form.addEventListener('submit', function(event) {
                event.preventDefault();
                var oldId = form.dataset.editForm;
                var word = vocabWord(oldId);
                callStudentVocabulary({ action: 'updateWord', vocab_id: oldId, text: form.elements.text.value }).then(function(result) {
                    state.vocabEditingId = '';
                    replaceVocabItem(oldId, result.word);
                    renderMyWordsList();
                    if (window.MrCatPersonalVocab) window.MrCatPersonalVocab.enrichWord(result.word, false);
                }).catch(function(error) {
                    if (error.result && error.result.code === 'MERGE_REQUIRED' && word) {
                        mergeWordGroup(word, error.result.recommended_headword, error.result.merge_vocab_ids);
                        return;
                    }
                    alert(error.message);
                });
            });
        });
        myWordsContent.querySelectorAll('[data-note-form]').forEach(function(form) {
            form.addEventListener('submit', function(event) {
                event.preventDefault();
                var vocabId = form.dataset.noteForm;
                callStudentVocabulary({ action: 'updateNote', vocab_id: vocabId, personal_note: form.querySelector('textarea').value }).then(function(result) {
                    state.vocabNoteEditingId = '';
                    replaceVocabItem(vocabId, result.word);
                    renderMyWordsList();
                }).catch(function(error) { alert(error.message); });
            });
        });
        myWordsContent.querySelectorAll('[data-use-headword]').forEach(function(button) {
            button.addEventListener('click', function() {
                var word = vocabWord(button.dataset.vocabId);
                if (!word) return;
                if ((word.merge_candidate_ids || []).length) {
                    mergeWordGroup(word, button.dataset.useHeadword, word.merge_candidate_ids);
                    return;
                }
                state.vocabEditingId = word.vocab_id;
                state.vocabExpanded[word.vocab_id] = true;
                renderMyWordsList();
                var input = myWordsContent.querySelector('[data-edit-form] input');
                if (input) { input.value = button.dataset.useHeadword; input.focus(); }
            });
        });
        myWordsContent.querySelectorAll('[data-ai-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                var vocabId = button.dataset.aiWord;
                button.disabled = true;
                button.textContent = 'Asking AI...';
                callStudentVocabulary({ action: 'requestAiDraft', vocab_id: vocabId }).then(function(result) {
                    if (result.already_available && result.word) {
                        replaceVocabItem(vocabId, result.word);
                        renderMyWordsList();
                        return;
                    }
                    var draft = result.draft || {};
                    var preview = [draft.word, draft.part_of_speech, draft.chinese_meaning, draft.english_definition].filter(Boolean).join('\n\n');
                    if (!window.confirm(preview + '\n\nUse this shared AI draft? It has not been reviewed by a teacher.')) return;
                    return callStudentVocabulary({ action: 'confirmAiDraft', vocab_id: vocabId, draft_token: result.draft_token }).then(function(saved) {
                        replaceVocabItem(vocabId, saved.word);
                        renderMyWordsList();
                    });
                }).catch(function(error) {
                    button.disabled = false;
                    button.textContent = 'Ask AI';
                    alert(error.result && error.result.code === 'AI_NOT_CONFIGURED'
                        ? 'AI dictionary lookup is under development.'
                        : error.message);
                });
            });
        });
        myWordsContent.querySelectorAll('[data-report-word]').forEach(function(button) {
            button.addEventListener('click', function() {
                var reason = window.prompt('What seems wrong? You may leave this blank.');
                if (reason === null) return;
                callStudentVocabulary({ action: 'reportDictionaryIssue', vocab_id: button.dataset.reportWord, reason: reason }).then(function() {
                    button.textContent = 'Reported';
                    button.disabled = true;
                }).catch(function(error) { alert(error.message); });
            });
        });
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
            count.textContent = activeCount + (activeCount === 1 ? ' word' : ' words');
        }
        if (!list) return;
        list.innerHTML = myWordsListHtml();
        bindMyWordActions();
        updateExportSelectionCount();
    }

    function shanghaiCalendarParts(value) {
        var parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short'
        }).formatToParts(value instanceof Date ? value : new Date(value));
        var output = {};
        parts.forEach(function(part) { if (part.type !== 'literal') output[part.type] = part.value; });
        return output;
    }

    function wordMatchesExportRange(word, range) {
        if (!range || range === 'all') return true;
        var source = word && (word.activity_updated_at || word.last_added_at || word.created_at);
        var date = source ? new Date(source) : null;
        if (!date || isNaN(date.getTime())) return false;
        var now = shanghaiCalendarParts(new Date());
        var item = shanghaiCalendarParts(date);
        if (range === 'year') return item.year === now.year;
        if (range === 'month') return item.year === now.year && item.month === now.month;
        if (range === 'week') {
            var weekdayIndex = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
            var todayUtc = Date.UTC(Number(now.year), Number(now.month) - 1, Number(now.day));
            var startUtc = todayUtc - (weekdayIndex[now.weekday] || 0) * 86400000;
            var itemUtc = Date.UTC(Number(item.year), Number(item.month) - 1, Number(item.day));
            return itemUtc >= startUtc && itemUtc <= todayUtc;
        }
        return true;
    }

    function exportRangeItems() {
        return filteredVocabItems().filter(function(word) { return wordMatchesExportRange(word, state.vocabExportRange); });
    }

    function selectedExportItems() {
        return (state.vocabItems || []).filter(function(word) {
            return (word.status || 'active') === 'active' && state.vocabSelected[word.vocab_id];
        });
    }

    function selectedExportFields() {
        var fields = ['english'];
        var root = document.getElementById('my-words-export-fields');
        if (!root) return fields;
        root.querySelectorAll('input[data-export-field]:checked').forEach(function(input) { fields.push(input.dataset.exportField); });
        return fields;
    }

    function updateExportSelectionCount() {
        var count = document.getElementById('my-words-selected-count');
        var selected = selectedExportItems().length;
        if (count) count.textContent = selected + ' selected';
        ['my-words-export-excel', 'my-words-export-pdf'].forEach(function(id) {
            var button = document.getElementById(id);
            if (button) button.disabled = selected === 0;
        });
    }

    function selectExportRange(range) {
        state.vocabExportRange = range || 'all';
        state.vocabSelected = {};
        exportRangeItems().forEach(function(word) { state.vocabSelected[word.vocab_id] = true; });
        document.querySelectorAll('[data-export-range]').forEach(function(button) {
            button.classList.toggle('active', button.dataset.exportRange === state.vocabExportRange);
        });
        renderMyWordsList();
    }

    function renderExportFields() {
        var root = document.getElementById('my-words-export-fields');
        if (!root || !window.MrCatMyWordsExport) return;
        var defaults = { chinese: true, part_of_speech: true, phonetic: true };
        root.innerHTML = Object.keys(window.MrCatMyWordsExport.FIELD_DEFINITIONS).filter(function(field) { return field !== 'english'; }).map(function(field) {
            return '<label><input type="checkbox" data-export-field="' + escapeHtml(field) + '"' + (defaults[field] ? ' checked' : '') + '><span>' + escapeHtml(window.MrCatMyWordsExport.FIELD_DEFINITIONS[field].label) + '</span></label>';
        }).join('');
    }

    function setExportOpen(open) {
        state.vocabExportOpen = Boolean(open);
        if (!wordsExportTrigger || !wordsExportPanel) return;
        if (open) {
            setMyWordsToolOpen('add', false);
            setMyWordsToolOpen('search', false);
            selectExportRange(state.vocabExportRange || 'all');
        }
        wordsExportPanel.classList.toggle('open', open);
        wordsExportPanel.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (open) wordsExportPanel.removeAttribute('inert');
        else wordsExportPanel.setAttribute('inert', '');
        wordsExportTrigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        renderMyWordsList();
    }

    function setMyWordsToolOpen(tool, open) {
        var isAdd = tool === 'add';
        var trigger = isAdd ? wordsAddTrigger : wordsSearchTrigger;
        var panel = isAdd ? wordsAddPanel : wordsSearchPanel;
        var input = isAdd ? wordsAddInput : wordsSearchInput;
        if (!trigger || !panel) return;
        if (open) {
            setMyWordsToolOpen(isAdd ? 'search' : 'add', false);
            if (state.vocabExportOpen) setExportOpen(false);
        }
        panel.classList.toggle('open', open);
        panel.setAttribute('aria-hidden', open ? 'false' : 'true');
        if (open) panel.removeAttribute('inert');
        else panel.setAttribute('inert', '');
        trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
        trigger.setAttribute('aria-label', open ? (isAdd ? 'Cancel adding a word' : 'Close search') : (isAdd ? 'Add a word' : 'Search words'));
        if (open) {
            window.setTimeout(function() {
                if (input) input.focus();
            }, 170);
            return;
        }
        if (input) input.value = '';
        if (isAdd) {
            if (wordsAddStatus) wordsAddStatus.textContent = '';
        } else if (state.vocabSearch) {
            state.vocabSearch = '';
            renderMyWordsList();
        }
    }

    function closeMyWordsTools() {
        setMyWordsToolOpen('add', false);
        setMyWordsToolOpen('search', false);
        setExportOpen(false);
    }

    function setMyWordsToolbarAvailable(available) {
        [wordsSearchTrigger, wordsAddTrigger, wordsExportTrigger, wordsSearchInput, wordsAddInput].forEach(function(control) {
            if (control) control.disabled = !available;
        });
        if (!available) closeMyWordsTools();
    }

    function bindMyWordsToolbar() {
        if (wordsSearchTrigger) wordsSearchTrigger.addEventListener('click', function() {
            setMyWordsToolOpen('search', wordsSearchTrigger.getAttribute('aria-expanded') !== 'true');
        });
        if (wordsAddTrigger) wordsAddTrigger.addEventListener('click', function() {
            setMyWordsToolOpen('add', wordsAddTrigger.getAttribute('aria-expanded') !== 'true');
        });
        if (wordsExportTrigger) wordsExportTrigger.addEventListener('click', function() {
            setExportOpen(wordsExportTrigger.getAttribute('aria-expanded') !== 'true');
        });
        renderExportFields();
        document.querySelectorAll('[data-export-range]').forEach(function(button) {
            button.addEventListener('click', function() { selectExportRange(button.dataset.exportRange); });
        });
        var selectAll = document.getElementById('my-words-select-all');
        if (selectAll) selectAll.addEventListener('click', function() {
            var items = exportRangeItems();
            var allSelected = items.length && items.every(function(word) { return state.vocabSelected[word.vocab_id]; });
            items.forEach(function(word) { state.vocabSelected[word.vocab_id] = !allSelected; });
            renderMyWordsList();
        });
        var excel = document.getElementById('my-words-export-excel');
        if (excel) excel.addEventListener('click', function() {
            window.MrCatMyWordsExport.downloadExcel(selectedExportItems(), selectedExportFields());
        });
        var pdf = document.getElementById('my-words-export-pdf');
        if (pdf) pdf.addEventListener('click', function() {
            try { window.MrCatMyWordsExport.printPdf(selectedExportItems(), selectedExportFields()); }
            catch (error) { alert(error.message); }
        });
        if (wordsSearchInput) wordsSearchInput.addEventListener('input', function() {
            state.vocabSearch = wordsSearchInput.value;
            renderMyWordsList();
        });
        bindManualWordAdd();
    }

    function renderMyWordsCard() {
        return '<section class="my-words-card">' +
            '<div class="my-words-list" id="my-words-list">' + myWordsListHtml() + '</div>' +
        '</section>';
    }

    function renderMyWordsView() {
        if (!myWordsContent) return;
        if (!state.session) {
            setMyWordsToolbarAvailable(false);
            myWordsContent.innerHTML = '<div class="my-words-message loading-card">Loading My Words...</div>';
            return;
        }
        if (state.session.mode === 'visitor') {
            setMyWordsToolbarAvailable(false);
            myWordsContent.innerHTML =
                '<div class="my-words-message"><p class="muted">Log in as a student to save words and phrases.</p>' +
                '<div class="profile-actions"><button class="primary-button" id="words-login">Log In</button></div></div>';
            document.getElementById('words-login').addEventListener('click', function() {
                window.location.href = window.MrCatLoginNavigation.loginHref(window.location.href, 'dashboard.html');
            });
            return;
        }
        setMyWordsToolbarAvailable(true);
        myWordsContent.innerHTML = renderMyWordsCard();
        renderMyWordsList();
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

    function myWordsPreviewItemHtml(word) {
        var dictionary = word && word.dictionary;
        var spokenWord = dictionary && dictionary.word || word && word.text || '';
        var partOfSpeech = dictionary && dictionary.part_of_speech || '—';
        var meaning = dictionary
            ? wordChineseMeaning(dictionary)
            : ((word && word.lookup_status) === 'not_found' ? '暂未找到中文释义' : '正在查找释义…');
        return '<article class="student-words-preview-item">' +
            '<div class="student-words-preview-copy">' +
                '<strong>' + escapeHtml(word && word.text || '') + '</strong>' +
                '<span><b>' + escapeHtml(partOfSpeech) + '</b><span>' + escapeHtml(meaning) + '</span></span>' +
            '</div>' +
            '<button class="student-words-preview-speak" type="button" data-preview-speak="' + escapeHtml(spokenWord) + '" aria-label="Pronounce ' + escapeHtml(spokenWord) + '">' +
                '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 10v4h3l4 3V7l-4 3H5Z"></path><path d="M15 9.5a4 4 0 0 1 0 5M17.5 7a7 7 0 0 1 0 10"></path></svg>' +
            '</button>' +
        '</article>';
    }

    function bindMyWordsPreviewActions() {
        if (!wordsPreview) return;
        wordsPreview.querySelectorAll('[data-preview-speak]').forEach(function(button) {
            button.addEventListener('click', function() {
                var value = button.dataset.previewSpeak || '';
                if (!value || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
                window.speechSynthesis.cancel();
                var utterance = new SpeechSynthesisUtterance(value);
                utterance.lang = 'en-GB';
                window.speechSynthesis.speak(utterance);
            });
        });
        var retry = wordsPreview.querySelector('[data-preview-retry]');
        if (retry) retry.addEventListener('click', loadMyWordsPreview);
    }

    function renderMyWordsPreview() {
        if (!wordsPreview) return;
        var activeWords = sortedVocabItems(state.vocabItems || []).filter(function(word) {
            return (word.status || 'active') === 'active';
        });
        var visibleWords = activeWords.slice(0, 7);
        wordsPreview.setAttribute('aria-busy', 'false');

        if (!visibleWords.length) {
            wordsPreview.innerHTML = '<div class="student-words-preview-empty"><strong>Your notebook is ready.</strong><p>Select a word or short phrase in a learning page to save it here.</p></div>';
        } else {
            wordsPreview.innerHTML = '<div class="student-words-preview-list" aria-label="Seven most recently saved words">' +
                visibleWords.map(myWordsPreviewItemHtml).join('') +
            '</div>';
        }

        bindMyWordsPreviewActions();
    }

    function setWordsPreviewAddOpen(open) {
        if (!wordsPreviewAddTrigger || !wordsPreviewAddMenu) return;
        var shouldOpen = open === true;
        wordsPreviewAddMenu.hidden = !shouldOpen;
        wordsPreviewAddMenu.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
        if (shouldOpen) wordsPreviewAddMenu.removeAttribute('inert');
        else wordsPreviewAddMenu.setAttribute('inert', '');
        wordsPreviewAddTrigger.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
        wordsPreviewAddTrigger.setAttribute('aria-label', shouldOpen ? 'Close manual word entry' : 'Enter a word manually');
        if (!shouldOpen) {
            if (wordsPreviewAddInput) wordsPreviewAddInput.value = '';
            if (wordsPreviewContextInput) wordsPreviewContextInput.value = '';
            if (wordsPreviewAddStatus) wordsPreviewAddStatus.textContent = '';
        }
    }

    function saveWordsPreviewInput(event) {
        event.preventDefault();
        if (!wordsPreviewAddInput || !wordsPreviewAddForm) return;
        var text = String(wordsPreviewAddInput.value || '').replace(/\s+/g, ' ').trim();
        var context = String(wordsPreviewContextInput && wordsPreviewContextInput.value || '').replace(/\s+/g, ' ').trim();
        var validation = manualWordValidation(text);
        if (validation) {
            if (wordsPreviewAddStatus) wordsPreviewAddStatus.textContent = validation;
            wordsPreviewAddInput.focus();
            return;
        }
        var submit = wordsPreviewAddForm.querySelector('button[type="submit"]');
        if (submit) {
            submit.disabled = true;
            submit.textContent = 'Adding…';
        }
        if (wordsPreviewAddStatus) wordsPreviewAddStatus.textContent = '';
        callStudentVocabulary({
            action: 'add',
            text: text,
            source_set_id: null,
            source_title: 'My Words',
            source_path: 'dashboard.html?view=words',
            context: context
        }).then(function(result) {
            if (!result.word) throw new Error('Unable to add this word.');
            upsertVocabItem(result.word);
            if (result.created) state.vocabTotalCount = Math.max(Number(state.vocabTotalCount || 0) + 1, state.vocabItems.length);
            renderMyWordsPreview();
            setWordsPreviewAddOpen(false);
            wordsPreviewAddTrigger.focus({ preventScroll: true });
            if (wordsScroll) wordsScroll.scrollTop = 0;
            if (window.MrCatPersonalVocab && window.MrCatPersonalVocab.enrichWord) {
                window.MrCatPersonalVocab.enrichWord(result.word, false);
            }
        }).catch(function(error) {
            if (wordsPreviewAddStatus) wordsPreviewAddStatus.textContent = error.message || 'Unable to add this word.';
        }).finally(function() {
            if (submit) {
                submit.disabled = false;
                submit.textContent = 'Add to My Words';
            }
        });
    }

    function loadMyWordsPreview() {
        if (!wordsPreview) return Promise.resolve();
        if (!state.session) return Promise.resolve();
        if (state.session.mode === 'visitor') {
            state.vocabItems = [];
            state.vocabTotalCount = 0;
            wordsPreview.setAttribute('aria-busy', 'false');
            wordsPreview.innerHTML = '<div class="student-words-preview-empty"><strong>Sign in to use My Words.</strong><p>Your saved vocabulary is available from a student account.</p></div>';
            return Promise.resolve();
        }
        if (state.vocabItems.length) renderMyWordsPreview();
        else {
            wordsPreview.setAttribute('aria-busy', 'true');
            wordsPreview.innerHTML = '<div class="student-words-preview-loading">Loading your recent words…</div>';
        }
        return warmMyWordsFirstPage().then(function(result) {
            if (!result || !result.success) throw new Error('Unable to load My Words.');
            state.vocabItems = result.words || [];
            state.vocabTotalCount = result.total_count != null ? Number(result.total_count) : state.vocabItems.length;
            renderMyWordsPreview();
        }).catch(function() {
            if (state.vocabItems.length) return;
            wordsPreview.setAttribute('aria-busy', 'false');
            wordsPreview.innerHTML = '<div class="student-words-preview-empty"><strong>Unable to load My Words.</strong><p>Please check your connection and try again.</p><button class="outline-button" type="button" data-preview-retry>Retry</button></div>';
            bindMyWordsPreviewActions();
        });
    }

    function setWordsPanel(open) {
        var wasOpen = state.wordsPanelOpen;
        state.wordsPanelOpen = open === true;
        if (!wordsOverlay) return;
        wordsOverlay.hidden = !state.wordsPanelOpen;
        if (wordsButton) {
            wordsButton.classList.toggle('active', state.wordsPanelOpen);
            wordsButton.setAttribute('aria-expanded', state.wordsPanelOpen ? 'true' : 'false');
        }
        if (!state.wordsPanelOpen) {
            setWordsPreviewAddOpen(false);
            if (wasOpen) unlockStudentMessageBackground();
            return;
        }
        setAccountPanel(false);
        lockStudentMessageBackground();
        if (wordsPreviewAddTrigger) wordsPreviewAddTrigger.disabled = !state.session || state.session.mode !== 'student';
        if (wordsPreviewScan) {
            var scanAvailable = Boolean(state.session && state.session.mode === 'student');
            wordsPreviewScan.disabled = !scanAvailable;
            wordsPreviewScan.setAttribute('aria-disabled', scanAvailable ? 'false' : 'true');
            wordsPreviewScan.tabIndex = scanAvailable ? 0 : -1;
        }
        if (wordsScroll) wordsScroll.scrollTop = 0;
        loadMyWordsPreview();
        window.requestAnimationFrame(function() {
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
                window.location.href = window.MrCatLoginNavigation.loginHref(window.location.href, 'dashboard.html');
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
                        '<button class="star-counter assignment-star-counter account-row-star" id="star-counter" type="button" aria-label="Open STAR Wallet. ' + escapeHtml(availableYellowStars()) + ' yellow STARs available">★ ' + escapeHtml(availableYellowStars()) + '</button>' +
                    '</div>' +
                    '<button class="profile-row account-feedback-row" type="button" data-account-feedback aria-label="Student ID ' + escapeHtml(profile.student_id) + '"><span>Student ID</span><strong>' + escapeHtml(profile.student_id) + '</strong></button>' +
                    '<button class="profile-row account-feedback-row" type="button" data-account-feedback aria-label="Class ' + escapeHtml(profile.class_group || 'Not set') + '"><span>Class</span><strong>' + escapeHtml(profile.class_group || 'Not set') + '</strong></button>' +
                    '<button class="profile-row account-feedback-row" type="button" data-account-feedback aria-label="System ' + escapeHtml(profile.curriculum_track || 'Not set') + '"><span>System</span><strong>' + escapeHtml(profile.curriculum_track || 'Not set') + '</strong></button>' +
                    '<button class="profile-row account-final-row account-finished-row" type="button" id="account-finished" aria-label="Open finished assignments. ' + escapeHtml(finishedCount) + ' finished"><span>Finished</span><span class="account-finished-value"><strong>' + escapeHtml(finishedCount) + '</strong><svg viewBox="0 0 20 20" aria-hidden="true" focusable="false"><path d="m7 4 6 6-6 6"></path></svg></span></button>' +
                    '<div class="account-quiet-footer">' +
                        '<div class="account-quiet-actions">' +
                            '<button class="text-button" id="change-password" type="button">Change password</button>' +
                            '<button class="text-button danger-text-button" id="logout-button" type="button">Log out</button>' +
                        '</div>' +
                    '</div>' +
                '</section>' +
            '</div>';
        starCounter = document.getElementById('star-counter');
        updateStarCounter(false);
        starCounter.addEventListener('click', function() {
            openAccountStarHistory();
        });
        profileContent.querySelectorAll('[data-account-feedback]').forEach(function(row) {
            row.addEventListener('click', function() {
                window.clearTimeout(row.accountFeedbackTimer);
                row.classList.remove('is-responding');
                void row.offsetWidth;
                row.classList.add('is-responding');
                row.accountFeedbackTimer = window.setTimeout(function() {
                    row.classList.remove('is-responding');
                }, 420);
            });
            row.addEventListener('animationend', function() {
                row.classList.remove('is-responding');
            });
        });
        document.getElementById('account-finished').addEventListener('click', function() {
            setAccountPanel(false);
            openStudentMessageCenter('finished');
        });
        document.getElementById('logout-button').addEventListener('click', openLogoutConfirmDialog);
        document.getElementById('change-password').addEventListener('click', function() {
            openChangePasswordDialog();
        });
    }

    function accountStarItems(starType) {
        return (state.starAchievements || []).filter(function(item) {
            return item && (starType === 'all' || item.star_type === starType);
        }).sort(function(left, right) {
            return new Date(right.earned_at || 0).getTime() - new Date(left.earned_at || 0).getTime();
        });
    }

    function accountStarHistoryRow(item) {
        var set = assignmentSet(item);
        var title = set.title || set.set_id || item.set_id || 'Practice';
        var earned = formatShortDate(item.earned_at);
        var isBlue = item.star_type === 'blue';
        var converted = isBlue && item.status === 'converted';
        return '<article class="account-star-history-row ' + (isBlue ? 'is-self-study' : 'is-assignment') + '" aria-label="STAR source for ' + escapeHtml(title) + '">' +
                '<span class="account-star-history-icon" aria-hidden="true">★</span>' +
                '<span class="account-star-history-copy">' +
                    '<strong>' + escapeHtml(title) + '</strong>' +
                    '<span class="account-star-history-meta">' +
                        (earned ? '<span>Earned ' + escapeHtml(earned) + '</span>' : '<span>Earned STAR</span>') +
                        '<span>Best ' + escapeHtml(formatEntryPercent(item.best_percentage)) + '</span>' +
                        (converted ? '<span>Converted to Yellow</span>' : '') +
                    '</span>' +
                '</span>' +
            '</article>';
    }

    function safeAccountStarHistoryRow(item) {
        try {
            return accountStarHistoryRow(item || {});
        } catch (error) {
            console.error('Unable to render STAR history item.', error, item);
            return '<article class="account-star-history-row is-unavailable" aria-label="STAR history item unavailable">' +
                '<span class="account-star-history-icon" aria-hidden="true">☆</span>' +
                '<span class="account-star-history-copy"><span class="account-star-history-kind">STAR RECORD</span>' +
                '<strong>History item unavailable</strong><span class="account-star-history-meta">This STAR is still saved in your account.</span></span>' +
            '</article>';
        }
    }

    function rewardRequestStatus(status) {
        return ({ awaiting_proof: 'Upload proof', awaiting_teacher: 'Waiting for teacher', completed: 'Completed', rejected: 'Rejected', cancelled: 'Cancelled', expired: 'Expired', refunded: 'Refunded' })[status] || status;
    }

    function openCashRequest() {
        var requests = state.starRewards && state.starRewards.cash_requests || [];
        return requests.find(function(item) { return item.status === 'awaiting_proof' || item.status === 'awaiting_teacher'; }) || null;
    }

    function cashRequestCard(request) {
        var open = request.status === 'awaiting_proof' || request.status === 'awaiting_teacher';
        return '<article class="account-cash-request" data-request-id="' + escapeHtml(request.request_id) + '">' +
            '<div><strong>' + escapeHtml(request.star_count) + ' Yellow STAR' + (request.star_count === 1 ? '' : 's') + '</strong><span class="account-request-status">' + escapeHtml(rewardRequestStatus(request.status)) + '</span></div>' +
            '<small>' + escapeHtml(formatShortDate(request.created_at) || '') + (request.decision_reason ? ' · ' + escapeHtml(request.decision_reason) : '') + '</small>' +
            '<div class="account-request-actions">' +
                '<button type="button" class="text-button" data-cash-evidence="' + escapeHtml(request.request_id) + '">View proof (' + escapeHtml(request.evidence_count || 0) + ')</button>' +
                (open && Number(request.evidence_count || 0) < 3 ? '<label class="account-proof-upload">Add photo<input type="file" accept="image/jpeg,image/png,image/webp" data-cash-upload="' + escapeHtml(request.request_id) + '" hidden></label>' : '') +
                (open ? '<button type="button" class="text-button danger-text-button" data-cash-cancel="' + escapeHtml(request.request_id) + '">Cancel</button>' : '') +
            '</div><p class="account-upload-status" id="cash-upload-status-' + escapeHtml(request.request_id) + '" role="status" aria-live="polite" hidden></p>' +
            '<div class="account-evidence-list" id="cash-evidence-' + escapeHtml(request.request_id) + '"></div></article>';
    }

    function cashComposerHtml() {
        var available = availableYellowStars();
        if (!state.starRewards || !state.starRewards.available) return '<p class="muted">Cash requests are temporarily unavailable.</p>';
        if (openCashRequest()) return '<div class="account-wallet-message"><strong>You already have an open Cash request.</strong><p>Track it, add proof, or cancel it in History.</p><button class="account-wallet-inline-link" type="button" data-wallet-view="history">Open History</button></div>';
        if (!available) return '<p class="muted">Earn a Yellow STAR before making a Cash request.</p>';
        return '<form class="account-cash-form" id="cash-request-form">' +
            '<p>Choose how many Yellow STARs to redeem. Confirm the Cash exchange with your teacher in person.</p>' +
            '<output id="cash-star-output">1 STAR</output>' +
            '<input id="cash-star-slider" type="range" min="1" max="' + escapeHtml(available) + '" step="1" value="1">' +
            '<button class="primary-button account-cash-submit" type="submit">Request Cash</button>' +
        '</form>';
    }

    function starWalletHeader(title, backTarget, backLabel) {
        return '<div class="account-star-history-head">' +
            '<button class="account-star-back" type="button" data-wallet-back="' + escapeHtml(backTarget) + '" aria-label="' + escapeHtml(backLabel) + '">‹</button>' +
            '<p class="eyebrow accent" id="student-star-title">' + escapeHtml(title) + '</p>' +
        '</div>';
    }

    function starSourceSection(type, label, redeemability) {
        var items = accountStarItems(type);
        return '<section class="account-star-source-group" data-star-source="' + escapeHtml(type) + '">' +
            '<div class="account-star-source-heading"><span>' + escapeHtml(label) + '<em>' + escapeHtml(redeemability) + '</em></span><strong>' + escapeHtml(items.length) + '</strong></div>' +
            '<div class="account-star-history-list">' +
                (items.length ? items.map(safeAccountStarHistoryRow).join('') : '<div class="account-star-history-empty compact"><span aria-hidden="true">☆</span><p>No ' + escapeHtml(type) + ' STARs yet.</p></div>') +
            '</div>' +
        '</section>';
    }

    function renderStarWalletHome() {
        return '<section class="account-star-history account-wallet-home">' +
            starWalletHeader('STAR WALLET', 'account', 'Back to Personal Center') +
            '<div class="account-wallet-pass" aria-label="' + escapeHtml(availableYellowStars()) + ' yellow STARs available">' +
                '<span class="account-wallet-pass-star" aria-hidden="true">★</span>' +
                '<strong>' + escapeHtml(availableYellowStars()) + '</strong>' +
            '</div>' +
            '<button class="primary-button account-wallet-redeem" type="button" data-wallet-view="redeem">Redeem</button>' +
            '<nav class="account-wallet-destinations" aria-label="STAR Wallet sections">' +
                '<button type="button" data-wallet-view="source"><span>STAR Source</span></button>' +
                '<button type="button" data-wallet-view="history"><span>History</span></button>' +
            '</nav>' +
        '</section>';
    }

    function renderStarSource() {
        return '<section class="account-star-history account-wallet-detail">' +
            starWalletHeader('STAR SOURCE', 'wallet', 'Back to STAR Wallet') +
            starSourceSection('yellow', 'YELLOW STAR', 'REDEEMABLE') +
            starSourceSection('blue', 'BLUE STAR', 'NOT REDEEMABLE') +
        '</section>';
    }

    function renderStarRedeem() {
        return '<section class="account-star-history account-wallet-detail">' +
            starWalletHeader('REDEEM', 'wallet', 'Back to STAR Wallet') +
            '<div class="account-wallet-redeem-balance"><span aria-hidden="true">★</span><strong>' + escapeHtml(availableYellowStars()) + '</strong><small>available</small></div>' +
            '<section class="account-cash-panel">' + cashComposerHtml() + '</section>' +
        '</section>';
    }

    function renderRedemptionHistory() {
        var requests = (state.starRewards && state.starRewards.cash_requests || []).slice().sort(function(left, right) {
            return new Date(right.created_at || 0).getTime() - new Date(left.created_at || 0).getTime();
        });
        return '<section class="account-star-history account-wallet-detail">' +
            starWalletHeader('HISTORY', 'wallet', 'Back to STAR Wallet') +
            '<p class="account-wallet-detail-intro">Every Cash request and its proof stays here.</p>' +
            '<div class="account-cash-history">' +
                (requests.length ? requests.map(cashRequestCard).join('') : '<div class="account-star-history-empty"><span aria-hidden="true">☆</span><strong>No redemption history</strong><p>Your Cash requests will appear here.</p></div>') +
            '</div>' +
        '</section>';
    }

    function renderAccountStarHistory() {
        if (!starContent) return;
        var view = state.accountStarView || 'wallet';
        if (view === 'source') starContent.innerHTML = renderStarSource();
        else if (view === 'redeem') starContent.innerHTML = renderStarRedeem();
        else if (view === 'history') starContent.innerHTML = renderRedemptionHistory();
        else starContent.innerHTML = renderStarWalletHome();
        bindStarWalletActions();
    }

    function openAccountStarHistory() {
        state.accountStarView = 'wallet';
        state.starPanelOpen = true;
        state.accountPanelOpen = false;
        if (accountPanel) accountPanel.hidden = true;
        if (identityChip) identityChip.setAttribute('aria-expanded', 'false');
        if (starOverlay) starOverlay.hidden = false;
        lockStudentMessageBackground();
        try {
            renderAccountStarHistory();
        } catch (error) {
            console.error('Unable to open STAR Wallet.', error);
            starContent.innerHTML =
                '<section class="account-star-history account-star-error" role="alert">' +
                    '<div class="account-star-history-head"><button class="account-star-back" type="button" data-wallet-back="account" aria-label="Back to Personal Center">‹</button>' +
                    '<p class="eyebrow accent" id="student-star-title">STAR WALLET</p>' +
                    '</div>' +
                    '<div class="account-star-history-empty"><span aria-hidden="true">☆</span><strong>Unable to display STAR history</strong><p>Your STARs are safe. Close and reopen Personal Center to try again.</p></div>' +
                '</section>';
            bindStarWalletActions();
        }
        window.requestAnimationFrame(function() {
            var backButton = starContent.querySelector('[data-wallet-back]');
            if (backButton) backButton.focus({ preventScroll: true });
        });
    }

    function closeStarPanel(reopenAccount) {
        if (!state.starPanelOpen) return;
        state.starPanelOpen = false;
        state.accountStarView = '';
        if (starOverlay) starOverlay.hidden = true;
        if (reopenAccount) {
            state.accountPanelOpen = true;
            if (accountPanel) accountPanel.hidden = false;
            if (identityChip) identityChip.setAttribute('aria-expanded', 'true');
            renderProfile();
            window.requestAnimationFrame(function() {
                var returnButton = document.getElementById('star-counter');
                if (returnButton) returnButton.focus({ preventScroll: true });
            });
            return;
        }
        unlockStudentMessageBackground();
        if (identityChip) identityChip.focus({ preventScroll: true });
    }

    function refreshStarWallet() {
        return window.MrCatCloud.callFunction('getDashboard').then(function(result) {
            if (!result || result.success === false) throw new Error(result && result.message || 'Unable to refresh STARs.');
            state.assignmentStarCount = Number(result.assignment_star_count || 0);
            state.selfStudyStarCount = Number(result.self_study_star_count || 0);
            state.starAchievements = result.star_achievements || [];
            state.starRewards = result.star_rewards || state.starRewards;
            updateStarCounter(false);
            if (state.starPanelOpen) renderAccountStarHistory();
            else renderProfile();
        });
    }

    function dashboardAction(action, data) {
        return window.MrCatCloud.callFunction('getDashboard', Object.assign({ action: action }, data || {})).then(function(result) {
            if (!result || result.success === false) throw new Error(result && result.message || 'Unable to complete this STAR action.');
            return result;
        });
    }

    function setCashUploadStatus(requestId, message, status) {
        var target = document.getElementById('cash-upload-status-' + requestId);
        var input = starContent && starContent.querySelector('[data-cash-upload="' + CSS.escape(String(requestId)) + '"]');
        var label = input && input.closest('.account-proof-upload');
        var uploading = status === 'uploading';
        if (target) {
            target.textContent = message || '';
            target.hidden = !message;
            target.classList.toggle('is-success', status === 'success');
            target.classList.toggle('is-error', status === 'error');
        }
        if (input) {
            input.disabled = uploading;
            if (!uploading) input.value = '';
        }
        if (label) {
            label.classList.toggle('is-uploading', uploading);
            label.setAttribute('aria-disabled', uploading ? 'true' : 'false');
        }
    }

    function uploadCashEvidence(requestId, file) {
        setCashUploadStatus(requestId, 'Preparing photo...', 'uploading');
        return window.MrCatCloud.prepareEvidenceImage(file).then(function(prepared) {
            setCashUploadStatus(requestId, 'Preparing secure upload...', 'uploading');
            return dashboardAction('beginCashEvidenceUpload', { request_id: requestId, file_name: file.name, mime_type: file.type, size_bytes: file.size }).then(function(start) {
                setCashUploadStatus(requestId, 'Uploading photo...', 'uploading');
                return Promise.all([
                    window.MrCatCloud.uploadWithMetadata(start.original_upload, prepared.original),
                    window.MrCatCloud.uploadWithMetadata(start.display_upload, prepared.display)
                ]).then(function() {
                    setCashUploadStatus(requestId, 'Checking photo...', 'uploading');
                    return dashboardAction('finishCashEvidenceUpload', { evidence_id: start.evidence_id });
                });
            });
        }).then(refreshStarWallet).then(function() {
            setCashUploadStatus(requestId, 'Photo uploaded successfully.', 'success');
            return loadCashEvidence(requestId);
        }).catch(function(error) {
            setCashUploadStatus(requestId, error && error.message || 'Unable to upload photo.', 'error');
            throw error;
        });
    }

    function loadCashEvidence(requestId) {
        var target = document.getElementById('cash-evidence-' + requestId);
        if (!target) return Promise.resolve();
        target.innerHTML = '<p class="muted">Loading photos...</p>';
        return dashboardAction('getCashEvidence', { request_id: requestId }).then(function(result) {
            target.innerHTML = (result.evidence || []).map(function(item) {
                return '<figure class="account-evidence-item ' + (item.status === 'superseded' ? 'is-superseded' : '') + '"><img src="' + escapeHtml(item.url) + '" alt="Cash exchange proof"><figcaption>' + escapeHtml(item.uploader_role === 'teacher' ? 'Teacher' : 'Student') + (item.status === 'superseded' ? ' · Replaced' : '') + '</figcaption>' + (item.status === 'active' && item.uploader_role === 'student' ? '<button type="button" class="text-button" data-evidence-supersede="' + escapeHtml(item.evidence_id) + '">Replace this photo</button>' : '') + '</figure>';
            }).join('') || '<p class="muted">No proof photo yet.</p>';
            target.querySelectorAll('[data-evidence-supersede]').forEach(function(button) {
                button.addEventListener('click', function() {
                    if (!window.confirm('Mark this photo as replaced? It will stay in the permanent record.')) return;
                    dashboardAction('supersedeCashEvidence', { evidence_id: button.dataset.evidenceSupersede }).then(refreshStarWallet).catch(function(error) { window.alert(error.message); });
                });
            });
        }).catch(function(error) { target.textContent = error.message || 'Unable to load photos.'; });
    }

    function bindStarWalletActions() {
        if (!starContent) return;
        starContent.querySelectorAll('[data-wallet-back]').forEach(function(button) {
            button.addEventListener('click', function(event) {
                event.stopPropagation();
                if (button.dataset.walletBack === 'account') closeStarPanel(true);
                else {
                    state.accountStarView = 'wallet';
                    renderAccountStarHistory();
                }
            });
        });
        starContent.querySelectorAll('[data-wallet-view]').forEach(function(button) {
            button.addEventListener('click', function() {
                state.accountStarView = button.dataset.walletView;
                renderAccountStarHistory();
                window.requestAnimationFrame(function() {
                    var backButton = starContent.querySelector('[data-wallet-back="wallet"]');
                    if (backButton) backButton.focus({ preventScroll: true });
                });
                if (state.accountStarView === 'history') {
                    var requests = state.starRewards && Array.isArray(state.starRewards.cash_requests) ? state.starRewards.cash_requests : [];
                    var unseen = requests.filter(function(item) { return item && item.student_seen === false; }).map(function(item) { return item.request_id; });
                    if (unseen.length) window.MrCatCloud.callFunction('getDashboard', { action: 'markCashRequestsSeen', request_ids: unseen }).catch(function() {});
                }
            });
        });
        var slider = document.getElementById('cash-star-slider');
        var output = document.getElementById('cash-star-output');
        if (slider && output) slider.addEventListener('input', function() { output.textContent = slider.value + (slider.value === '1' ? ' STAR' : ' STARs'); });
        var form = document.getElementById('cash-request-form');
        if (form) form.addEventListener('submit', function(event) {
            event.preventDefault();
            if (!window.confirm('Please confirm this Cash exchange with your teacher in person. Create the request now?')) return;
            form.querySelector('button[type="submit"]').disabled = true;
            dashboardAction('createCashRequest', { star_count: Number(slider.value) }).then(function() {
                state.accountStarView = 'history';
                return refreshStarWallet();
            }).catch(function(error) { window.alert(error.message || 'Unable to create request.'); renderAccountStarHistory(); });
        });
        starContent.querySelectorAll('[data-cash-upload]').forEach(function(input) {
            input.addEventListener('change', function() { if (input.files && input.files[0]) uploadCashEvidence(input.dataset.cashUpload, input.files[0]).catch(function(error) { window.alert(error.message || 'Unable to upload photo.'); }); });
        });
        starContent.querySelectorAll('[data-cash-evidence]').forEach(function(button) { button.addEventListener('click', function() { loadCashEvidence(button.dataset.cashEvidence); }); });
        starContent.querySelectorAll('[data-cash-cancel]').forEach(function(button) {
            button.addEventListener('click', function() { if (window.confirm('Cancel this Cash request and release its STARs?')) dashboardAction('cancelCashRequest', { request_id: button.dataset.cashCancel }).then(refreshStarWallet).catch(function(error) { window.alert(error.message); }); });
        });
    }

    function setAccountPanel(open) {
        var wasOpen = state.accountPanelOpen;
        if (open === true) setWordsPanel(false);
        state.accountPanelOpen = open === true;
        if (accountPanel) accountPanel.hidden = !state.accountPanelOpen;
        if (identityChip) identityChip.setAttribute('aria-expanded', state.accountPanelOpen ? 'true' : 'false');
        if (!state.accountPanelOpen) {
            state.accountStarView = '';
            if (wasOpen) unlockStudentMessageBackground();
            return;
        }
        renderProfile();
        lockStudentMessageBackground();
        window.requestAnimationFrame(function() {
            var close = document.getElementById('student-account-close');
            if (close) close.focus({ preventScroll: true });
        });
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

    function mergeProtectedCatalogResources(resources, publicItems) {
        var publicById = {};
        (publicItems || []).forEach(function(item) {
            var id = item && (item.set_id || item.id);
            if (id) publicById[id] = item;
        });
        var merged = (resources || []).map(function(item) {
            var publicItem = publicById[item && (item.set_id || item.id)];
            return publicItem ? Object.assign({}, publicItem, item) : item;
        });
        var seen = {};
        merged.forEach(function(item) {
            seen[libraryItemIdentity(item)] = true;
        });
        (publicItems || []).forEach(function(item) {
            if (item.access !== 'student-preview') return;
            var key = libraryItemIdentity(item);
            if (!key || seen[key]) return;
            seen[key] = true;
            merged.push(item);
        });
        return merged;
    }

    function applyLibraryProgress(resources, progressItems) {
        var progressBySet = {};
        (progressItems || []).forEach(function(item) {
            if (item && item.set_id) progressBySet[item.set_id] = item;
        });
        return (resources || []).map(function(item) {
            var progress = progressBySet[item.set_id || item.id];
            return progress ? Object.assign({}, item, progress) : item;
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

    function assignmentIdentity(item) {
        if (!item) return '';
        if (item.assignment_id) return 'assignment:' + item.assignment_id;
        return 'self:' + assignmentSetId(item);
    }

    function mergeAssignmentItems(items) {
        var byIdentity = new Map();
        (state.assignments || []).concat(items || []).forEach(function(item) {
            var key = assignmentIdentity(item);
            if (key) byIdentity.set(key, item);
        });
        state.assignments = Array.from(byIdentity.values());
    }

    function deriveAssignmentCounts() {
        state.assignmentCounts = {
            todo: todoAssignments().length,
            upcoming: upcomingAssignments().length,
            finished: finishedAssignments().length
        };
    }

    function applyDashboardCache(snapshot) {
        if (!snapshot) return false;
        state.assignments = (snapshot.assignments || []).map(safeCachedAssignment).filter(Boolean);
        state.assignmentCounts = Object.assign({ todo: 0, upcoming: 0, finished: 0 }, snapshot.assignment_counts || {});
        state.weeklySummary = snapshot.weekly_summary || null;
        state.assignmentStarCount = Number(snapshot.assignment_star_count || 0);
        state.selfStudyStarCount = Number(snapshot.self_study_star_count || 0);
        state.starCount = state.assignmentStarCount + state.selfStudyStarCount;
        state.teacherReplyUnreadCount = Number(snapshot.teacher_reply_unread_count || 0);
        state.assignmentsComplete = false;
        updateStarCounter(false);
        return state.assignments.length > 0 || state.assignmentCounts.todo > 0 || state.assignmentCounts.finished > 0;
    }

    function applyDashboardBootstrap(dashboard) {
        if (!dashboard.bootstrap) {
            applyFullDashboard(dashboard);
            return;
        }
        state.assignments = dashboard.assignments || [];
        state.assignmentCounts = Object.assign({ todo: 0, upcoming: 0, finished: 0 }, dashboard.assignment_counts || {});
        state.weeklySummary = dashboard.weekly_summary || null;
        state.assignmentsComplete = false;
        ['todo', 'finished'].forEach(function(kind) {
            var page = dashboard.assignment_pages && dashboard.assignment_pages[kind] || {};
            state.assignmentPages[kind] = {
                nextCursor: page.next_cursor == null ? null : Number(page.next_cursor),
                hasMore: page.has_more === true,
                loading: false
            };
        });
        state.assignmentStarCount = Number(dashboard.assignment_star_count || 0);
        state.selfStudyStarCount = Number(dashboard.self_study_star_count || 0);
        state.starCount = Number(dashboard.star_count == null
            ? state.assignmentStarCount + state.selfStudyStarCount
            : dashboard.star_count);
        state.teacherReplyUnreadCount = Number(dashboard.teacher_reply_unread_count || 0);
        state.teacherReplies = dashboard.teacher_replies || [];
        state.teacherRepliesComplete = Number(dashboard.teacher_reply_count || 0) === state.teacherReplies.length;
        updateStarCounter(false);
        saveStudentDashboardCache();
    }

    function applyFullDashboard(dashboard) {
        state.assignments = dashboard.assignments || [];
        state.assignmentsComplete = true;
        state.weeklySummary = null;
        deriveAssignmentCounts();
        state.libraryProgress = dashboard.library_progress || [];
        state.starCount = Number(dashboard.star_count || 0);
        state.assignmentStarCount = Number(dashboard.assignment_star_count == null ? state.starCount : dashboard.assignment_star_count);
        state.selfStudyStarCount = Number(dashboard.self_study_star_count || 0);
        state.starAchievements = dashboard.star_achievements || [];
        state.starRewards = dashboard.star_rewards || state.starRewards;
        state.teacherReplies = dashboard.teacher_replies || state.teacherReplies || [];
        state.teacherReplyUnreadCount = state.teacherReplies.filter(function(reply) {
            return reply && reply.student_seen !== true;
        }).length;
        state.teacherRepliesComplete = true;
        updateStarCounter(false);
        saveStudentDashboardCache();
    }

    function renderStudentDashboardState() {
        if (!state.session) return;
        renderWeeklyFocusProgress();
        renderAssignments();
        libraryLoadTabContent(libraryActiveTab);
        renderProfile();
        updateDashboardTabNotices();
    }

    function publicExerciseDataUrl(item) {
        var setId = assignmentSetId(item);
        if (!setId) return '';
        if (/^(BBC-|C\d+-T\d+-(?:P|S)\d+)/i.test(setId)) return 'data/' + encodeURIComponent(setId) + '.json';
        var set = assignmentSet(item);
        var category = String(set.section_id || set.sectionId || set.course || set.type || '').toLowerCase();
        if (category === 'vocabulary' || /^(?:NGSL|NAWL)-/i.test(setId)) {
            return 'content/vocabulary/' + encodeURIComponent(setId) + '.json';
        }
        return '';
    }

    function prefetchFirstTodoContent() {
        var urls = openTodoAssignments().slice(0, 10).map(publicExerciseDataUrl).filter(Boolean);
        var cursor = 0;
        function worker() {
            var url = urls[cursor++];
            if (!url) return Promise.resolve();
            return fetch(url, { credentials: 'same-origin' }).catch(function() {}).then(worker);
        }
        return Promise.all([worker(), worker()]);
    }

    function prefetchAssignmentPages(kind) {
        var pageState = state.assignmentPages[kind];
        if (!pageState || pageState.loading || !pageState.hasMore || pageState.nextCursor == null) return Promise.resolve();
        pageState.loading = true;
        return window.MrCatCloud.callFunction('getDashboard', {
            action: 'listAssignmentPage',
            kind: kind,
            cursor: pageState.nextCursor,
            page_size: 10
        }).then(function(result) {
            if (!result || result.success === false) return;
            var page = result.page || {};
            mergeAssignmentItems(page.items || []);
            pageState.nextCursor = page.next_cursor == null ? null : Number(page.next_cursor);
            pageState.hasMore = page.has_more === true;
            saveStudentDashboardCache();
        }).catch(function() {}).then(function() {
            pageState.loading = false;
            if (pageState.hasMore) return prefetchAssignmentPages(kind);
        });
    }

    function prefetchTeacherReplies() {
        return window.MrCatCloud.callFunction('getDashboard', {
            action: 'listTeacherReplies'
        }).then(function(result) {
            if (!result || result.success === false) return;
            state.teacherReplies = result.teacher_replies || [];
            state.teacherReplyUnreadCount = state.teacherReplies.filter(function(reply) {
                return reply && reply.student_seen !== true;
            }).length;
            state.teacherRepliesComplete = true;
            updateDashboardTabNotices();
            saveStudentDashboardCache();
        }).catch(function() {});
    }

    function refreshFullStudentDashboard() {
        return Promise.all([
            window.MrCatCloud.callFunction('getDashboard'),
            window.MrCatCloud.callFunction('getResources').catch(function() {
                return { success: false, resources: [] };
            })
        ]).then(function(results) {
            var dashboard = results[0] || {};
            if (dashboard.success === false) return;
            applyFullDashboard(dashboard);
            var cloudResources = results[1] && results[1].resources || [];
            return loadPublicCatalog().then(function(items) {
                state.resources = cloudResources.length
                    ? mergeProtectedCatalogResources(cloudResources, items)
                    : items;
                state.resources = applyLibraryProgress(state.resources, state.libraryProgress);
            }).catch(function() {
                if (cloudResources.length) state.resources = applyLibraryProgress(cloudResources, state.libraryProgress);
            }).then(renderStudentDashboardState);
        }).catch(function() {});
    }

    function warmStudentDashboard() {
        if (studentDashboardWarmPromise) return studentDashboardWarmPromise;
        studentDashboardWarmPromise = prefetchFirstTodoContent()
            .then(function() { return prefetchAssignmentPages('todo'); })
            .then(prefetchTeacherReplies)
            .then(function() { return prefetchAssignmentPages('finished'); })
            .then(refreshFullStudentDashboard);
        return studentDashboardWarmPromise;
    }

    function loadStudentData() {
        return Promise.all([
            window.MrCatCloud.callFunction('getDashboard', { action: 'dashboardBootstrap' }).catch(function(error) {
                return {
                    success: false,
                    code: error && error.code || 'DASHBOARD_REQUEST_FAILED',
                    message: error && error.message || 'Unable to load assignments.'
                };
            }),
            loadPublicCatalog().catch(function() { return []; })
        ]).then(function(results) {
            var dashboard = results[0] || {};
            if (dashboard.success === false) {
                var dashboardError = new Error(dashboard.message || 'Unable to load assignments.');
                dashboardError.code = dashboard.code || 'DASHBOARD_LOAD_FAILED';
                throw dashboardError;
            }
            applyDashboardBootstrap(dashboard);
            state.resources = applyLibraryProgress(results[1] || [], state.libraryProgress);
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
            if (identityChip) identityChip.focus();
        });
    }
    var starClose = document.getElementById('student-star-close');
    if (starClose) starClose.addEventListener('click', function() { closeStarPanel(false); });
    var logoutConfirmCancel = document.getElementById('logout-confirm-cancel');
    var logoutConfirmSubmit = document.getElementById('logout-confirm-submit');
    if (logoutConfirmCancel) logoutConfirmCancel.addEventListener('click', function() { setLogoutConfirmOpen(false, false); });
    if (logoutConfirmSubmit) {
        logoutConfirmSubmit.addEventListener('click', function() {
            logoutConfirmSubmit.disabled = true;
            logoutConfirmSubmit.textContent = 'Logging out...';
            logoutConfirmOverlay.setAttribute('aria-busy', 'true');
            window.MrCatAuth.logout();
        });
    }
    if (messageButton) {
        messageButton.addEventListener('click', function() {
            openStudentMessageCenter();
        });
    }
    var calendarClose = document.getElementById('student-calendar-close');
    if (calendarClose) {
        calendarClose.addEventListener('click', function() {
            setStudentCalendarPanel(false);
        });
    }
    if (achievementsScroll) {
        achievementsScroll.addEventListener('click', function(event) {
            var cell = event.target.closest('[data-achievement-date]');
            if (cell && !cell.disabled) openStudentCalendarDate(cell.dataset.achievementDate, cell);
        });
    }
    if (calendarOverlay) {
        calendarOverlay.addEventListener('click', function(event) {
            if (event.target === calendarOverlay) setStudentCalendarPanel(false);
        });
    }
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Escape' && calendarOverlay && !calendarOverlay.hidden) {
            event.preventDefault();
            setStudentCalendarPanel(false);
        }
    });
    if (calendarContent) {
        calendarContent.addEventListener('click', function(event) {
            var taskCard = event.target.closest('.student-calendar-achievement[data-open-href]');
            if (taskCard) {
                openStudentCalendarAchievement(taskCard, event);
                return;
            }
            var monthButton = event.target.closest('[data-calendar-month]');
            if (monthButton && !monthButton.disabled) {
                shiftStudentCalendarMonth(monthButton.dataset.calendarMonth === 'next' ? 1 : -1);
                return;
            }
            var dayButton = event.target.closest('[data-calendar-date]');
            if (!dayButton || dayButton.disabled) return;
            state.calendarSelectedDay = dayButton.dataset.calendarDate || '';
            renderStudentCalendar();
        });
        calendarContent.addEventListener('keydown', function(event) {
            var taskCard = event.target.closest('.student-calendar-achievement[data-open-href]');
            if (taskCard) openStudentCalendarAchievement(taskCard, event);
        });
    }
    bindMyWordsToolbar();
    if (wordsButton) {
        ['pointerenter', 'focus', 'touchstart'].forEach(function(eventName) {
            wordsButton.addEventListener(eventName, warmMyWordsFirstPage, { passive: true, once: eventName !== 'focus' });
        });
        wordsButton.addEventListener('pointerdown', function() { wordsButton.classList.add('is-pressing'); }, { passive: true });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach(function(eventName) {
            wordsButton.addEventListener(eventName, function() { wordsButton.classList.remove('is-pressing'); }, { passive: true });
        });
        wordsButton.addEventListener('click', function(event) {
            if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            event.preventDefault();
            setWordsPanel(true);
        });
    }
    if (wordsOpenLink) {
        wordsOpenLink.addEventListener('click', function(event) {
            if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            setWordsPanel(false);
            if (useMyWordsFallbackTransition(event)) event.preventDefault();
        });
    }
    if (wordsPreviewAddTrigger) {
        wordsPreviewAddTrigger.addEventListener('click', function() {
            var open = wordsPreviewAddTrigger.getAttribute('aria-expanded') !== 'true';
            setWordsPreviewAddOpen(open);
            if (open && wordsPreviewAddInput) wordsPreviewAddInput.focus();
        });
    }
    if (wordsPreviewScan) {
        wordsPreviewScan.addEventListener('click', function(event) {
            if (event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
            if (!state.session || state.session.mode !== 'student') {
                event.preventDefault();
                return;
            }
            setWordsPreviewAddOpen(false);
        });
    }
    window.addEventListener('mrcat:scan-opened', function() {
        if (wordsOverlay) wordsOverlay.inert = true;
    });
    window.addEventListener('mrcat:scan-closed', function() {
        if (wordsOverlay) wordsOverlay.inert = false;
    });
    window.addEventListener('mrcat:scan-committed', function() {
        if (!state.session || state.session.mode !== 'student' || !state.wordsPanelOpen) return;
        loadMyWordsPreview();
    });
    if (wordsPreviewAddForm) wordsPreviewAddForm.addEventListener('submit', saveWordsPreviewInput);
    if (wordsOverlay) {
        wordsOverlay.addEventListener('click', function(event) {
            if (!wordsPreviewAddMenu || wordsPreviewAddMenu.hidden) return;
            if (wordsPreviewAddMenu.contains(event.target) || wordsPreviewAddTrigger.contains(event.target)) return;
            setWordsPreviewAddOpen(false);
        });
    }
    document.addEventListener('keydown', function(event) {
        if (event.key !== 'Escape' || !wordsPreviewAddMenu || wordsPreviewAddMenu.hidden) return;
        event.preventDefault();
        setWordsPreviewAddOpen(false);
        wordsPreviewAddTrigger.focus();
    });
    var wordsClose = document.getElementById('student-words-close');
    if (wordsClose) {
        wordsClose.addEventListener('click', function() {
            setWordsPanel(false);
            if (wordsButton) wordsButton.focus();
        });
    }
    resourceSearchToggle.addEventListener('click', function() {
        setLibrarySearchOpen(!studentLibraryDock.classList.contains('is-searching'));
    });
    if (resourceSearchClose) {
        resourceSearchClose.addEventListener('click', function() {
            setLibrarySearchOpen(false);
        });
    }
    resourceSearch.addEventListener('input', function() {
        var searchText = String(resourceSearch.value || '').trim().toLowerCase();
        libraryApplyGlobalSearchDestination(searchText);
        libraryLoadTabContent(libraryActiveTab);
    });

    document.addEventListener('click', function(e) {
        var workspaceCard = e.target.closest('.student-skill-card');
        if (workspaceCard) {
            if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            openWorkspaceConfirm(workspaceCard);
            return;
        }
        var categoryTrigger = e.target.closest('#student-library-category-trigger');
        if (categoryTrigger) {
            setLibraryCategoryMenuOpen(!libraryCategoryMenuOpen, false);
            return;
        }
        if (libraryCategoryMenuOpen && !e.target.closest('#student-library-category-menu')) {
            setLibraryCategoryMenuOpen(false, false);
        }
        var openCard = e.target.closest('[data-open-href]');
        if (openCard) {
            openHrefCard(openCard, e);
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
            if (subTab !== libraryActiveSubTab) {
                libraryActiveSubTab = subTab;
                libraryLoadTabContent(libraryActiveTab);
            }
            setLibraryCategoryMenuOpen(false, true);
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

    if (workspaceConfirmCancel) {
        workspaceConfirmCancel.addEventListener('click', function() {
            closeWorkspaceConfirm(true);
        });
    }
    if (workspaceConfirmSubmit) {
        workspaceConfirmSubmit.addEventListener('click', function() {
            if (workspaceConfirmHref) window.location.assign(workspaceConfirmHref);
        });
    }
    if (workspaceConfirmOverlay) {
        workspaceConfirmOverlay.addEventListener('click', function(e) {
            if (e.target === workspaceConfirmOverlay) closeWorkspaceConfirm(true);
        });
        workspaceConfirmOverlay.addEventListener('keydown', function(e) {
            if (e.key === 'Escape') {
                e.preventDefault();
                closeWorkspaceConfirm(true);
                return;
            }
            if (e.key !== 'Tab' || !workspaceConfirmCancel || !workspaceConfirmSubmit) return;
            if (e.shiftKey && document.activeElement === workspaceConfirmCancel) {
                e.preventDefault();
                workspaceConfirmSubmit.focus();
            } else if (!e.shiftKey && document.activeElement === workspaceConfirmSubmit) {
                e.preventDefault();
                workspaceConfirmCancel.focus();
            }
        });
    }

    document.addEventListener('keydown', function(e) {
        if (workspaceConfirmOverlay && !workspaceConfirmOverlay.hidden) return;
        var practiceOverlay = document.getElementById('practice-entry-overlay');
        if (e.key === 'Escape' && practiceOverlay && !practiceOverlay.hidden) return;
        var passwordOverlay = document.querySelector('.password-dialog-overlay');
        if (e.key === 'Escape' && passwordOverlay) return;
        if (e.key === 'Escape' && libraryCategoryMenuOpen) {
            e.preventDefault();
            setLibraryCategoryMenuOpen(false, true);
            return;
        }
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var openCard = e.target.closest('[data-open-href]');
        if (!openCard) return;
        if (e.target.closest('button, a')) return;
        e.preventDefault();
        openHrefCard(openCard, e);
    });

    window.MrCatAuth.getSession()
        .then(function(session) {
            if (session.mode === 'none') {
                window.location.replace(window.MrCatLoginNavigation.loginHref(window.location.href, 'dashboard.html'));
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
                setStudentGreeting('Welcome, Visitor.');
                loadAchievementCalendar();
                return loadPublicCatalog().then(function(items) {
                    state.resources = items;
                });
            }

            var preferredName = englishName(session.profile);
            identityChip.textContent = preferredName;
            setStudentGreeting(greetingFor(preferredName));
            loadAchievementCalendar();
            return readStudentDashboardCache().then(function(snapshot) {
                if (applyDashboardCache(snapshot)) {
                    renderWeeklyFocusProgress();
                    renderAssignments();
                    renderProfile();
                    activateView(initialDashboardView(), true);
                }
                return loadStudentData();
            });
        })
        .then(function() {
            if (!state.session) return;
            renderWeeklyFocusProgress();
            renderAssignments();
            libraryLoadTabContent(libraryActiveTab);
            renderProfile();
            activateView(initialDashboardView(), true);
            window.requestAnimationFrame(function() {
                window.setTimeout(warmStudentDashboard, 0);
            });
            var warm = function() { warmMyWordsFirstPage(); };
            if (window.requestIdleCallback) window.requestIdleCallback(warm, { timeout: 2400 });
            else window.setTimeout(warm, 900);
            if (new URLSearchParams(window.location.search).get('view') === 'words') {
                setWordsPanel(true);
            }
        })
        .catch(function(error) {
            var message = error && error.message || 'Please refresh and try again.';
            assignmentContent.innerHTML = '<div class="empty-card"><strong>Unable to load the dashboard</strong>' +
                escapeHtml(message) +
                '<button class="btn btn-secondary" id="dashboard-retry-button" type="button">Retry</button></div>';
            if (weeklyFocusProgress) {
                weeklyFocusProgress.classList.remove('is-loading');
                weeklyFocusProgress.setAttribute('aria-busy', 'false');
                setWeeklyFocusHtml(renderWeeklyProgressRow({
                    kind: 'this-week is-empty has-empty-status',
                    label: 'THIS WEEK',
                    emptyStatus: 'UNAVAILABLE',
                    ariaLabel: 'Weekly assignment progress is unavailable. Refresh to retry.'
                }));
            }
            if (messageButton) messageButton.disabled = true;
            var retryButton = document.getElementById('dashboard-retry-button');
            if (retryButton) retryButton.addEventListener('click', function() { window.location.reload(); });
        });
})();
