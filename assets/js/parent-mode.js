(function() {
    'use strict';

    var SESSION_KEY = 'mrcat_parent_mode_session_v1';
    var state = {
        session: null,
        overview: null,
        matrix: null,
        personalTab: 'this_week',
        classScope: 'week',
        historyMonth: '',
        taskDetail: null,
        previousBodyOverflow: '',
        previousScrollY: 0
    };

    var loginShell = document.getElementById('parent-login-shell');
    var appShell = document.getElementById('parent-app');
    var loginForm = document.getElementById('parent-login-form');
    var chineseName = document.getElementById('parent-chinese-name');
    var englishName = document.getElementById('parent-english-name');
    var loginButton = document.getElementById('parent-login-button');
    var loginMessage = document.getElementById('parent-login-message');
    var pageMessage = document.getElementById('parent-page-message');
    var taskList = document.getElementById('parent-task-list');
    var personalTabs = document.getElementById('personal-tabs');
    var classTabs = document.getElementById('class-tabs');
    var historyLabel = document.getElementById('parent-history-label');
    var historyMonth = document.getElementById('parent-history-month');
    var matrixShell = document.getElementById('parent-matrix-shell');
    var modal = document.getElementById('parent-task-modal');
    var modalContent = document.getElementById('parent-task-dialog-content');
    var lastFocused = null;
    var parentAuthPromise = null;

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function numberValue(value) {
        var number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

    function percent(value) {
        var number = numberValue(value);
        if (number == null) return '';
        return (Math.round(number * 100) / 100).toString().replace(/\.0+$/, '') + '%';
    }

    function formatDate(value, withTime) {
        if (!value) return '';
        var date = new Date(value);
        if (!Number.isFinite(date.getTime())) return '';
        return new Intl.DateTimeFormat('zh-CN', {
            timeZone: 'Asia/Shanghai',
            month: 'short',
            day: 'numeric',
            hour: withTime ? '2-digit' : undefined,
            minute: withTime ? '2-digit' : undefined,
            hour12: false
        }).format(date);
    }

    function formatDuration(value) {
        var seconds = Math.max(0, Math.round(Number(value || 0)));
        if (!seconds) return '';
        var minutes = Math.floor(seconds / 60);
        var remainder = seconds % 60;
        return minutes ? minutes + '分' + (remainder ? remainder + '秒' : '') : remainder + '秒';
    }

    function sessionFromStorage() {
        try {
            var parsed = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
            if (!parsed || !parsed.token || new Date(parsed.expires_at || 0).getTime() <= Date.now()) return null;
            return parsed;
        } catch (_error) {
            return null;
        }
    }

    function saveSession(token, expiresAt) {
        state.session = { token: token, expires_at: expiresAt };
        localStorage.setItem(SESSION_KEY, JSON.stringify(state.session));
    }

    function clearSession() {
        state.session = null;
        state.overview = null;
        state.matrix = null;
        localStorage.removeItem(SESSION_KEY);
    }

    function ensureParentAuth() {
        if (parentAuthPromise) return parentAuthPromise;
        parentAuthPromise = window.MrCatCloud.getLoginState().then(function(loginState) {
            if (loginState) return loginState;
            return window.MrCatCloud.signInAnonymously();
        }).catch(function(error) {
            parentAuthPromise = null;
            throw error;
        });
        return parentAuthPromise;
    }

    function parentCall(action, data) {
        var payload = Object.assign({}, data || {}, { action: action });
        if (state.session) payload.session_token = state.session.token;
        return ensureParentAuth().then(function() {
            return window.MrCatCloud.callFunction('parentMode', payload);
        }).then(function(result) {
            if (result && result.success) return result;
            var error = new Error(result && result.message || 'Parent Mode 暂时无法加载。');
            error.code = result && result.code || 'PARENT_MODE_UNAVAILABLE';
            throw error;
        });
    }

    function isSessionError(error) {
        return ['PARENT_SESSION_REQUIRED', 'PARENT_SESSION_INVALID', 'PARENT_SESSION_EXPIRED', 'PARENT_STUDENT_UNAVAILABLE']
            .indexOf(error && error.code) !== -1;
    }

    function showLogin(message) {
        appShell.hidden = true;
        loginShell.hidden = false;
        if (message) loginMessage.textContent = message;
    }

    function showApp() {
        loginShell.hidden = true;
        appShell.hidden = false;
    }

    function setPageMessage(message) {
        pageMessage.textContent = message || '';
    }

    function stateLabel(status) {
        if (status === 'qualified') return '已合格';
        if (status === 'not_qualified') return '未合格';
        return '未提交';
    }

    function stateBadge(status) {
        return '<span class="parent-state ' + escapeHtml(status || 'unsubmitted') + '">' +
            escapeHtml(stateLabel(status)) + '</span>';
    }

    function taskButton(task) {
        var score = task.status === 'unsubmitted' ? '' : percent(task.best_percentage);
        var meta = [];
        if (task.due_at) meta.push('截止 ' + formatDate(task.due_at, true));
        if (task.source === 'self_study') meta.push('自主学习');
        if (task.passing_percentage != null) meta.push('合格线：' + percent(task.passing_percentage));
        return '<button class="parent-task-card" type="button" data-parent-task' +
            ' data-assignment-id="' + escapeHtml(task.assignment_id || '') + '"' +
            ' data-set-id="' + escapeHtml(task.set_id || '') + '">' +
            '<span><strong>' + escapeHtml(task.title || task.set_id) + '</strong>' +
            '<small>' + escapeHtml(meta.join(' · ')) + '</small></span>' +
            '<span class="parent-task-score"><strong>' + escapeHtml(score || '—') +
            (task.mastered ? ' <span class="parent-star" aria-label="STAR">★</span>' : '') +
            '</strong>' + stateBadge(task.status) + '</span></button>';
    }

    function tasksForTab(tab) {
        var tasks = state.overview && state.overview.tasks || [];
        if (tab === 'completed') {
            return {
                assigned: tasks.filter(function(task) { return task.status === 'qualified'; }).sort(function(left, right) {
                    return new Date(right.completed_at || 0).getTime() - new Date(left.completed_at || 0).getTime();
                }),
                selfStudy: (state.overview && state.overview.self_study || []).slice()
            };
        }
        return {
            assigned: tasks.filter(function(task) { return (task.categories || []).indexOf(tab) !== -1; }),
            selfStudy: []
        };
    }

    function renderPersonal() {
        if (!state.overview) return;
        var tabs = ['overdue', 'this_week', 'upcoming', 'completed'];
        tabs.forEach(function(tab) {
            var button = personalTabs.querySelector('[data-personal-tab="' + tab + '"]');
            var collection = tasksForTab(tab);
            var count = collection.assigned.length + collection.selfStudy.length;
            button.setAttribute('aria-selected', tab === state.personalTab ? 'true' : 'false');
            button.querySelector('[data-personal-count]').textContent = count ? String(count) : '';
            if (tab === 'overdue') button.classList.toggle('has-overdue', count > 0);
        });
        var current = tasksForTab(state.personalTab);
        var all = current.assigned.concat(current.selfStudy);
        var qualified = all.filter(function(task) { return task.status === 'qualified'; }).length;
        var ratio = all.length ? qualified / all.length : 0;
        var progressFill = document.getElementById('personal-progress-fill');
        progressFill.style.width = Math.max(0, Math.min(100, ratio * 100)) + '%';
        progressFill.parentElement.setAttribute('aria-label', all.length
            ? '当前列表中 ' + qualified + ' 项已合格，共 ' + all.length + ' 项'
            : '当前列表没有任务');
        if (!all.length) {
            taskList.innerHTML = '<div class="parent-empty">这里暂时没有任务。</div>';
            return;
        }
        var html = current.assigned.map(taskButton).join('');
        if (current.selfStudy.length) {
            html += '<h3 class="parent-subsection-title">自主学习</h3>' + current.selfStudy.map(taskButton).join('');
        }
        taskList.innerHTML = html;
    }

    function classCell(cell, own) {
        var score = cell && cell.status !== 'unsubmitted' ? percent(cell.best_percentage) : '未提交';
        var content = '<span class="parent-score-cell"><strong>' + escapeHtml(score) +
            (cell && cell.mastered ? ' <span class="parent-star" aria-label="STAR">★</span>' : '') +
            '</strong>' + stateBadge(cell && cell.status || 'unsubmitted') + '</span>';
        if (own && cell && cell.assignment_id) {
            return '<button class="parent-score-button" type="button" data-parent-task data-assignment-id="' +
                escapeHtml(cell.assignment_id) + '" aria-label="查看自己孩子的任务详情">' + content + '</button>';
        }
        return content;
    }

    function renderMatrix() {
        var matrix = state.matrix;
        var className = document.getElementById('parent-class-name');
        if (!matrix || !matrix.class) {
            className.textContent = '';
            matrixShell.innerHTML = '<div class="parent-empty">孩子当前没有可比较的班级数据。</div>';
            return;
        }
        className.textContent = matrix.class.class_name || '';
        if (!matrix.tasks || !matrix.tasks.length) {
            matrixShell.innerHTML = '<div class="parent-empty">本周期暂无全班任务。</div>';
            return;
        }
        var head = '<thead><tr><th class="task-column">任务</th>' + matrix.students.map(function(student, index) {
            var completionWidth = student.completion_ratio == null ? 0 : Math.max(0, Math.min(100, student.completion_ratio * 100));
            var rank = student.ranking_eligible === false ? '本周期不参与排名' : student.rank ? '第 ' + student.rank + ' 名' : '';
            return '<th class="' + (index === 0 ? 'own-column' : '') + '">' +
                '<span class="parent-student-name">' + escapeHtml(student.chinese_name || student.display_name) + '</span>' +
                '<span class="parent-student-english">' + escapeHtml(student.english_name || (index === 0 ? '我的孩子' : '')) + '</span>' +
                '<span class="parent-rank">' + escapeHtml(index === 0 ? '我的孩子 · ' + rank : rank) + '</span>' +
                '<span class="parent-mini-progress" aria-label="任务完成进度"><span style="width:' + completionWidth + '%"></span></span>' +
                '</th>';
        }).join('') + '</tr></thead>';
        var body = '<tbody>' + matrix.tasks.map(function(task, taskIndex) {
            return '<tr><th scope="row" class="task-column"><span class="parent-task-title">' + escapeHtml(task.title) + '</span>' +
                '<span class="parent-task-meta">合格线：' + escapeHtml(percent(task.passing_percentage)) +
                (task.mastery_enabled ? ' · STAR ' + escapeHtml(percent(task.mastery_percentage)) : '') +
                '<br>截止 ' + escapeHtml(formatDate(task.due_at, false)) + '</span></th>' +
                matrix.students.map(function(student, studentIndex) {
                    return '<td class="' + (studentIndex === 0 ? 'own-column' : '') + '">' +
                        classCell(student.cells && student.cells[taskIndex], studentIndex === 0) + '</td>';
                }).join('') + '</tr>';
        }).join('') + '</tbody>';
        matrixShell.innerHTML = '<table class="parent-matrix">' + head + body + '</table>';
    }

    function updateHistoryOptions(months) {
        var previous = state.historyMonth;
        historyMonth.innerHTML = (months || []).map(function(month) {
            return '<option value="' + escapeHtml(month) + '">' + escapeHtml(month) + '</option>';
        }).join('');
        if (previous && (months || []).indexOf(previous) !== -1) historyMonth.value = previous;
        else if (months && months.length) state.historyMonth = historyMonth.value = months[0];
        else state.historyMonth = '';
    }

    function loadClassMatrix() {
        matrixShell.innerHTML = '<div class="parent-empty">正在加载同班数据…</div>';
        var data = { scope: state.classScope };
        if (state.classScope === 'history') data.month_key = state.historyMonth;
        return parentCall('classMatrix', data).then(function(result) {
            state.matrix = result;
            if (result.history_months) updateHistoryOptions(result.history_months);
            if (state.classScope === 'history' && state.historyMonth &&
                result.period && result.period.key !== state.historyMonth) {
                return loadClassMatrix();
            }
            renderMatrix();
        }).catch(handleRequestError);
    }

    function renderOverview() {
        var student = state.overview.student || {};
        document.getElementById('parent-student-name').textContent = [student.chinese_name, student.english_name].filter(Boolean).join(' ') || '学习进度';
        document.getElementById('parent-last-updated').textContent = '最近更新：' + formatDate(state.overview.generated_at, true);
        renderPersonal();
    }

    function loadAll() {
        setPageMessage('');
        showApp();
        taskList.innerHTML = '<div class="parent-empty">正在加载孩子的任务…</div>';
        return Promise.all([
            parentCall('overview').then(function(result) {
                state.overview = result;
                renderOverview();
            }),
            loadClassMatrix()
        ]).catch(handleRequestError);
    }

    function handleRequestError(error) {
        if (isSessionError(error)) {
            clearSession();
            showLogin(error.message);
            return;
        }
        setPageMessage(error && error.message || 'Parent Mode 暂时无法加载。');
    }

    function openModal() {
        lastFocused = document.activeElement;
        state.previousScrollY = window.scrollY;
        state.previousBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        modal.hidden = false;
        document.getElementById('parent-task-close').focus();
    }

    function closeModal() {
        modal.hidden = true;
        modalContent.innerHTML = '';
        state.taskDetail = null;
        document.body.style.overflow = state.previousBodyOverflow;
        window.scrollTo(0, state.previousScrollY);
        if (lastFocused && typeof lastFocused.focus === 'function') lastFocused.focus();
    }

    function attemptBar(attempt, task, best) {
        var score = Math.max(0, Math.min(100, Number(attempt.percentage || 0)));
        var scoreClass = score >= Number(task.mastery_percentage || 101) && task.mastery_enabled
            ? 'mastered' : score >= Number(task.passing_percentage || 0) ? 'qualified' : '';
        var isBest = Math.abs(score - Number(best || 0)) < 0.001;
        var meta = [formatDate(attempt.submitted_at, true), formatDuration(attempt.duration_seconds)].filter(Boolean).join(' · ');
        return '<button class="parent-attempt-bar' + (isBest ? ' is-best' : '') + '" type="button" data-attempt-id="' +
            escapeHtml(attempt.attempt_id) + '">' +
            '<span class="parent-attempt-value">' + escapeHtml(percent(score)) + '</span>' +
            '<span class="parent-attempt-track"><span class="parent-attempt-fill ' + scoreClass + '" style="height:' + Math.max(score, 4) + '%"></span></span>' +
            '<span class="parent-attempt-label">#' + escapeHtml(attempt.attempt_number) + '</span>' +
            '<span class="parent-attempt-meta">' + escapeHtml(meta) + '</span></button>';
    }

    function renderTaskDetail(result) {
        state.taskDetail = result;
        var task = result.task;
        var attempts = result.attempts || [];
        var threshold = function(label, value, className) {
            return '<span class="parent-threshold ' + className + '" style="bottom:' + (32 + Number(value || 0) * 1.5) + 'px"><span>' +
                escapeHtml(label + percent(value)) + '</span></span>';
        };
        modalContent.innerHTML = '<p class="parent-eyebrow">TASK DETAIL</p><h2 id="parent-task-dialog-title">' + escapeHtml(task.title) + '</h2>' +
            '<div class="parent-task-summary"><span>最好成绩：<strong>' + escapeHtml(percent(task.best_percentage) || '未提交') + '</strong></span>' +
            '<span>合格线：' + escapeHtml(percent(task.passing_percentage)) + '</span>' +
            (task.mastery_enabled ? '<span>STAR：' + escapeHtml(percent(task.mastery_percentage)) + '</span>' : '') +
            (task.due_at ? '<span>截止：' + escapeHtml(formatDate(task.due_at, true)) + '</span>' : '<span>自主学习</span>') +
            (task.score_locked ? '<span>答案已查看，最好成绩已锁定</span>' : '') + '</div>' +
            (attempts.length ? '<div class="parent-attempt-chart-shell"><div class="parent-attempt-chart">' +
                threshold('合格线：', task.passing_percentage, 'pass') +
                (task.mastery_enabled ? threshold('STAR：', task.mastery_percentage, 'star') : '') +
                attempts.map(function(attempt) { return attemptBar(attempt, task, task.best_percentage); }).join('') +
                '</div></div><div class="parent-review" id="parent-attempt-review"><div class="parent-empty">点击任意柱子查看该次提交的错题。</div></div>'
                : '<div class="parent-empty">这份任务还没有正式提交记录。</div>');
    }

    function openTask(target) {
        var assignmentId = target.getAttribute('data-assignment-id') || '';
        var setId = target.getAttribute('data-set-id') || '';
        openModal();
        modalContent.innerHTML = '<div class="parent-empty">正在加载全部提交成绩…</div>';
        parentCall('taskDetail', { assignment_id: assignmentId, set_id: setId }).then(renderTaskDetail).catch(function(error) {
            modalContent.innerHTML = '<div class="parent-empty">' + escapeHtml(error.message || '无法加载任务详情。') + '</div>';
        });
    }

    function loadAttemptReview(attemptId) {
        var review = document.getElementById('parent-attempt-review');
        if (!review || !state.taskDetail) return;
        review.innerHTML = '<div class="parent-empty">正在加载错题…</div>';
        parentCall('attemptReview', {
            attempt_id: attemptId,
            assignment_id: state.taskDetail.task.assignment_id || ''
        }).then(function(result) {
            var attempt = result.attempt;
            if (!attempt.wrong_answers || !attempt.wrong_answers.length) {
                review.innerHTML = '<h3>第 ' + escapeHtml(attempt.attempt_number || '') + ' 次提交</h3><div class="parent-empty">这次提交没有错题。</div>';
                return;
            }
            review.innerHTML = '<h3>第 ' + escapeHtml(attempt.attempt_number || '') + ' 次提交 · ' + escapeHtml(percent(attempt.percentage)) + '</h3>' +
                attempt.wrong_answers.map(function(item) {
                    return '<article class="parent-wrong-card"><strong>Q' + escapeHtml(item.question_id) +
                        (item.question_text ? ' · ' + escapeHtml(item.question_text) : '') + '</strong>' +
                        '<p><span class="parent-answer-label">孩子答案</span><br>' + escapeHtml(item.submitted_answer || '未作答') + '</p>' +
                        (attempt.feedback_available
                            ? '<p><span class="parent-answer-label">正确答案</span><br>' + escapeHtml(item.correct_answer == null ? '暂无' : item.correct_answer) + '</p>' +
                              (item.explanation ? '<p><span class="parent-answer-label">解析</span><br>' + escapeHtml(item.explanation) + '</p>' : '')
                            : '<p class="parent-answer-label">正确答案和解析尚未向学生揭晓。</p>') +
                        '</article>';
                }).join('');
        }).catch(function(error) {
            review.innerHTML = '<div class="parent-empty">' + escapeHtml(error.message || '无法加载错题。') + '</div>';
        });
    }

    loginForm.addEventListener('submit', function(event) {
        event.preventDefault();
        var chinese = chineseName.value.trim();
        var english = englishName.value.trim();
        loginMessage.textContent = '';
        if (!chinese || !english) {
            loginMessage.textContent = '请同时输入学生中文名和英文名。';
            return;
        }
        loginButton.disabled = true;
        loginButton.textContent = '正在验证…';
        parentCall('login', { chinese_name: chinese, english_name: english }).then(function(result) {
            saveSession(result.session_token, result.expires_at);
            loginForm.reset();
            return loadAll();
        }).catch(function(error) {
            loginMessage.textContent = error && error.message || '学生信息不匹配。';
        }).finally(function() {
            loginButton.disabled = false;
            loginButton.textContent = '进入 Parent Mode';
        });
    });

    personalTabs.addEventListener('click', function(event) {
        var button = event.target.closest('[data-personal-tab]');
        if (!button) return;
        state.personalTab = button.getAttribute('data-personal-tab');
        renderPersonal();
    });

    classTabs.addEventListener('click', function(event) {
        var button = event.target.closest('[data-class-scope]');
        if (!button) return;
        state.classScope = button.getAttribute('data-class-scope');
        classTabs.querySelectorAll('[data-class-scope]').forEach(function(item) {
            item.setAttribute('aria-selected', item === button ? 'true' : 'false');
        });
        historyLabel.hidden = state.classScope !== 'history';
        if (state.classScope === 'history' && !state.historyMonth && historyMonth.options.length) {
            state.historyMonth = historyMonth.value;
        }
        loadClassMatrix();
    });

    historyMonth.addEventListener('change', function() {
        state.historyMonth = historyMonth.value;
        if (state.classScope === 'history') loadClassMatrix();
    });

    document.addEventListener('click', function(event) {
        var taskTarget = event.target.closest('[data-parent-task]');
        if (taskTarget) openTask(taskTarget);
        var attempt = event.target.closest('[data-attempt-id]');
        if (attempt) loadAttemptReview(attempt.getAttribute('data-attempt-id'));
    });

    document.getElementById('parent-task-close').addEventListener('click', closeModal);
    modal.addEventListener('click', function(event) { if (event.target === modal) closeModal(); });
    document.addEventListener('keydown', function(event) { if (event.key === 'Escape' && !modal.hidden) closeModal(); });

    document.getElementById('parent-refresh-button').addEventListener('click', loadAll);
    document.getElementById('parent-logout-button').addEventListener('click', function() {
        parentCall('logout').catch(function() {}).finally(function() {
            clearSession();
            showLogin('已退出 Parent Mode。');
        });
    });

    state.session = sessionFromStorage();
    if (state.session) loadAll();
    else showLogin();
})();
