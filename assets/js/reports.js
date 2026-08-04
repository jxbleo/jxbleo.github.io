(function() {
    'use strict';

    var state = {
        session: null,
        role: '',
        reports: [],
        classes: [],
        selectedReportId: '',
        reportResponse: null,
        reportRequestVersion: 0,
        loadingReport: false,
        loadingList: false
    };

    var reportList = document.getElementById('reports-list');
    var reportsContent = document.getElementById('reports-content');
    var reportsFeedback = document.getElementById('reports-feedback');
    var latestButton = document.getElementById('reports-latest-button');
    var refreshButton = document.getElementById('reports-refresh-button');
    var closeButton = document.getElementById('reports-close-button');
    var printButton = document.getElementById('reports-print-button');
    var logoutButton = document.getElementById('reports-logout-button');
    var returnLink = document.getElementById('reports-return-link');
    var subtitle = document.getElementById('reports-subtitle');

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function valueAt(object, keys) {
        if (!object || typeof object !== 'object') return undefined;
        for (var index = 0; index < keys.length; index++) {
            var key = keys[index];
            if (Object.prototype.hasOwnProperty.call(object, key)
                && object[key] !== undefined && object[key] !== null && object[key] !== '') {
                return object[key];
            }
        }
        return undefined;
    }

    function numberAt(object, keys) {
        var value = valueAt(object, keys);
        if (value === undefined || value === null || value === '') return null;
        var number = Number(value);
        return isFinite(number) ? number : null;
    }

    function textAt(object, keys, fallback) {
        var value = valueAt(object, keys);
        return value === undefined ? (fallback || '') : String(value);
    }

    function asArray(value) {
        return Array.isArray(value) ? value : [];
    }

    function reportIdFromUrl() {
        return String(new URLSearchParams(window.location.search).get('report') || '').trim();
    }

    function updateUrl(reportId, replace) {
        var url = new URL(window.location.href);
        if (reportId) url.searchParams.set('report', reportId);
        else url.searchParams.delete('report');
        var method = replace ? 'replaceState' : 'pushState';
        window.history[method]({}, '', url.pathname + url.search + url.hash);
    }

    function reportCall(action, payload) {
        var data = Object.assign({ action: action }, payload || {});
        return window.MrCatCloud.callFunction('learningReports', data).then(function(result) {
            if (!result || result.success === false) {
                var error = new Error(result && result.message || 'The report service could not complete that request.');
                if (result && result.code) error.code = result.code;
                throw error;
            }
            return result;
        });
    }

    function isTeacher() {
        return state.role === 'teacher' || (state.session && state.session.mode === 'teacher');
    }

    function isPreview(report) {
        return String(report && report.status || '').toLowerCase() === 'preview';
    }

    function setFeedback(message, type) {
        reportsFeedback.textContent = message || '';
        reportsFeedback.classList.toggle('is-error', type === 'error');
    }

    function clearFeedback() {
        setFeedback('', '');
    }

    function showLoading(message) {
        reportsContent.innerHTML = '<section class="reports-loading-card" aria-busy="true">' +
            '<span class="reports-spinner" aria-hidden="true"></span>' +
            '<p>' + escapeHtml(message || 'Loading report…') + '</p>' +
            '</section>';
        printButton.disabled = true;
    }

    function formatDate(value, withTime) {
        if (!value) return '';
        var date = new Date(value);
        if (isNaN(date.getTime())) return String(value);
        try {
            return new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Asia/Shanghai',
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: withTime ? '2-digit' : undefined,
                minute: withTime ? '2-digit' : undefined,
                hour12: false
            }).format(date);
        } catch (error) {
            return date.toLocaleDateString();
        }
    }

    function periodLabel(report) {
        var type = String(report && report.period_type || '').toLowerCase();
        if (type === 'monthly' || type === 'month') return 'Monthly report';
        if (type === 'weekly' || type === 'week') return 'Weekly report';
        return 'Learning report';
    }

    function periodRange(report) {
        var start = formatDate(report && report.period_start, false);
        var end = formatDate(report && report.period_end, false);
        if (start && end) return start + ' – ' + end;
        if (report && report.period_key) return String(report.period_key);
        return 'Report period';
    }

    function statusLabel(status) {
        return String(status || '').toLowerCase() === 'published' ? 'Published' : 'Preview';
    }

    function statusBadge(status) {
        var published = String(status || '').toLowerCase() === 'published';
        return '<span class="reports-status-badge' + (published ? ' is-published' : '') + '">' +
            escapeHtml(statusLabel(status)) + '</span>';
    }

    function numberLabel(value) {
        var number = Number(value);
        return isFinite(number) ? String(number) : '—';
    }

    function completedLabel(completed, expected) {
        if (completed === null && expected === null) return '—';
        if (expected === null) return numberLabel(completed);
        return numberLabel(completed === null ? 0 : completed) + ' / ' + numberLabel(expected);
    }

    function changeLabel(value) {
        if (value === undefined || value === null || value === '') {
            return { text: 'New / no prior period', className: 'is-neutral' };
        }
        var number = Number(value);
        if (!isFinite(number)) return { text: 'New / no prior period', className: 'is-neutral' };
        if (number > 0) return { text: '+' + number + ' items', className: '' };
        if (number < 0) return { text: String(number) + ' items', className: 'is-negative' };
        return { text: 'No change', className: 'is-neutral' };
    }

    function sortReports(reports) {
        return reports.slice().sort(function(left, right) {
            var leftTime = new Date(left && (left.period_end || left.updated_at || left.published_at) || 0).getTime() || 0;
            var rightTime = new Date(right && (right.period_end || right.updated_at || right.published_at) || 0).getTime() || 0;
            return rightTime - leftTime;
        });
    }

    function reportEntryId(entry) {
        return String(valueAt(entry, ['report_id', 'id', '_id']) || '');
    }

    function renderReportList() {
        var reports = state.reports;
        reportList.setAttribute('aria-busy', state.loadingList ? 'true' : 'false');
        latestButton.disabled = !reports.length;
        if (!reports.length) {
            reportList.innerHTML = '<div class="reports-list-empty">No reports are available yet.</div>';
            return;
        }
        reportList.innerHTML = reports.map(function(entry) {
            var id = reportEntryId(entry);
            var active = id && id === state.selectedReportId;
            return '<button class="reports-list-item' + (active ? ' is-active' : '') + '" type="button" data-report-id="' + escapeHtml(id) + '" aria-current="' + (active ? 'page' : 'false') + '">' +
                '<span class="reports-list-item-top">' +
                    '<strong>' + escapeHtml(periodLabel(entry)) + '</strong>' +
                    statusBadge(entry.status) +
                '</span>' +
                '<small>' + escapeHtml(periodRange(entry)) + '</small>' +
                '<span class="reports-list-item-bottom">' +
                    '<span class="reports-list-item-class">' + escapeHtml(textAt(entry, ['class_name', 'className'], 'Class')) + '</span>' +
                    '<span class="reports-list-item-class">' + escapeHtml(formatDate(entry.published_at || entry.updated_at, false)) + '</span>' +
                '</span>' +
            '</button>';
        }).join('');
    }

    function leaderboardRows(response, report) {
        return asArray(response && response.leaderboard).length
            ? asArray(response.leaderboard)
            : asArray(report && report.leaderboard);
    }

    function studentName(student) {
        var chinese = textAt(student, ['chinese_name', 'name_zh', 'chineseName']);
        var english = textAt(student, ['english_name', 'name_en', 'englishName']);
        var display = textAt(student, ['display_name', 'name', 'student_name']);
        return {
            chinese: chinese || display || 'Student',
            english: english
        };
    }

    function renderLeaderboard(rows) {
        if (!rows.length) {
            return '<div class="reports-empty-card"><div><h2>No ranking data yet</h2><p>The published snapshot does not contain class-task results for this period.</p></div></div>';
        }
        return '<div class="reports-table-wrap">' +
            '<table class="reports-table">' +
                '<caption class="sr-only">Class leaderboard</caption>' +
                '<thead><tr><th>Rank</th><th>Student</th><th>Class tasks</th><th>Change</th><th>Self-study</th></tr></thead>' +
                '<tbody>' + rows.map(function(student) {
                    var name = studentName(student);
                    var completed = numberAt(student, ['completed_class_item_count', 'completed_count', 'completed']);
                    var expected = numberAt(student, ['assigned_class_item_count', 'expected_class_item_count', 'expected_count', 'class_task_expected_count']);
                    var delta = numberAt(student, ['delta_completed_class_item_count', 'delta_count', 'change_count']);
                    var selfStudy = numberAt(student, ['self_study_completed_count', 'self_study_count', 'self_study_completed']);
                    var change = changeLabel(delta);
                    return '<tr>' +
                        '<td class="reports-rank">' + escapeHtml(numberLabel(valueAt(student, ['rank', 'position']))) + '</td>' +
                        '<td class="reports-student-name"><strong>' + escapeHtml(name.chinese) + '</strong>' + (name.english ? '<span>' + escapeHtml(name.english) + '</span>' : '') + '</td>' +
                        '<td class="reports-number">' + escapeHtml(completedLabel(completed, expected)) + '</td>' +
                        '<td class="reports-change ' + change.className + '">' + escapeHtml(change.text) + '</td>' +
                        '<td class="reports-number">' + escapeHtml(numberLabel(selfStudy)) + '</td>' +
                    '</tr>';
                }).join('') + '</tbody>' +
            '</table>' +
        '</div>';
    }

    function summaryMetric(summary, completeKeys, expectedKeys) {
        var completed = numberAt(summary, completeKeys);
        var expected = numberAt(summary, expectedKeys || []);
        return {
            completed: completed,
            expected: expected,
            label: completedLabel(completed, expected)
        };
    }

    function detailMetrics(detail) {
        detail = detail || {};
        var classTasks = detail.class_task_summary || detail.class_tasks || detail;
        var actual = detail.actual_activity || detail.activity || {};
        var selfStudy = detail.self_study || detail.selfStudy || {};
        return {
            classTasks: summaryMetric(classTasks,
                ['completed_class_item_count', 'completed_count', 'completed', 'passed_count'],
                ['assigned_class_item_count', 'expected_class_item_count', 'expected_count', 'assigned_count', 'total_count']),
            actual: summaryMetric(actual,
                ['countable_attempt_count', 'completed_count', 'count', 'attempt_count', 'activity_count'],
                []),
            selfStudy: summaryMetric(selfStudy,
                ['completed_self_study_item_count', 'completed_count', 'completed', 'count', 'passed_count'],
                ['expected_count', 'total_count'])
        };
    }

    function formatCategoryValue(value) {
        if (value && typeof value === 'object') {
            var completed = numberAt(value, ['completed_count', 'completed', 'count', 'passed_count', 'passed_attempt_count']);
            var expected = numberAt(value, ['expected_count', 'expected', 'total_count', 'attempt_count']);
            var score = numberAt(value, ['average_score', 'score', 'percentage']);
            if (completed !== null || expected !== null) return completedLabel(completed, expected);
            if (score !== null) return String(score) + '%';
        }
        if (typeof value === 'number') return String(value);
        return '';
    }

    function categoryRowsForDetail(detail) {
        var candidates = [
            detail && detail.category_counts,
            detail && detail.category_performance,
            detail && detail.class_task_summary && detail.class_task_summary.category_counts,
            detail && detail.actual_activity && detail.actual_activity.category_counts,
            detail && detail.actual_activity && detail.actual_activity.families,
            detail && detail.self_study && detail.self_study.category_counts,
            detail && detail.self_study && detail.self_study.families
        ];
        var found = [];
        var seen = {};
        candidates.forEach(function(candidate) {
            if (!candidate) return;
            if (Array.isArray(candidate)) {
                candidate.forEach(function(item) {
                    var name = textAt(item, ['category', 'category_name', 'name', 'label', 'type', 'family']);
                    var value = formatCategoryValue(item);
                    if (name && value && !seen[name]) {
                        seen[name] = true;
                        found.push({ name: name, value: value });
                    }
                });
            } else if (typeof candidate === 'object') {
                Object.keys(candidate).forEach(function(key) {
                    var value = formatCategoryValue(candidate[key]);
                    if (value && !seen[key]) {
                        seen[key] = true;
                        found.push({ name: key, value: value });
                    }
                });
            }
        });
        return found;
    }

    function commentForDetail(detail) {
        return textAt(detail, ['teacher_comment', 'comment', 'teacherComment']);
    }

    function goalsForDetail(detail) {
        var goals = valueAt(detail, ['teacher_goals', 'goals', 'teacherGoals']);
        if (Array.isArray(goals)) return goals.filter(Boolean).map(function(goal) { return String(goal); });
        if (typeof goals === 'string' && goals.trim()) return [goals.trim()];
        return [];
    }

    function renderComment(detail, emptyText) {
        var comment = commentForDetail(detail);
        var goals = goalsForDetail(detail);
        return '<section class="reports-comment-block">' +
            '<div class="reports-comment-head"><h3>Teacher comment</h3><span>For this report period</span></div>' +
            '<p class="reports-comment-copy">' + escapeHtml(comment || emptyText || 'No comment has been added yet.') + '</p>' +
            (goals.length ? '<ul class="reports-goals">' + goals.map(function(goal) { return '<li>' + escapeHtml(goal) + '</li>'; }).join('') + '</ul>' : '') +
        '</section>';
    }

    function metricCard(label, metric, note) {
        return '<div class="reports-metric"><span>' + escapeHtml(label) + '</span><strong>' + escapeHtml(metric.label) + '</strong>' +
            (note ? '<em>' + escapeHtml(note) + '</em>' : '') + '</div>';
    }

    function detailSummaryHtml(detail) {
        var metrics = detailMetrics(detail);
        var categories = categoryRowsForDetail(detail);
        return '<div class="reports-metric-strip">' +
            metricCard('Class tasks', metrics.classTasks, metrics.classTasks.expected !== null ? 'completed / assigned' : 'completed') +
            metricCard('Learning activity', metrics.actual, metrics.actual.expected !== null ? 'completed / planned' : 'recorded in this period') +
            metricCard('Self-study', metrics.selfStudy, 'does not affect rank') +
        '</div>' +
        (categories.length ? '<div class="reports-category-list">' + categories.map(function(item) {
            return '<div class="reports-category-item"><span>' + escapeHtml(item.name) + '</span><strong>' + escapeHtml(item.value) + '</strong></div>';
        }).join('') + '</div>' : '');
    }

    function renderStudentDetail(detail) {
        if (!detail) return '';
        var rankingNotice = detail.ranking_eligible === false
            ? '<p class="reports-ranking-notice">Joined or transferred during this period · not ranked.</p>'
            : '';
        return '<section class="reports-personal-section">' +
            '<div class="reports-section-heading"><div><p class="eyebrow accent">YOUR REPORT</p><h2>Your learning</h2></div>' +
            '<p>Only this student account can view these personal learning details.</p></div>' +
            '<article class="reports-personal-card">' +
                '<div class="reports-detail-head"><div><h2>Personal progress</h2><p>Class tasks, learning activity and self-study are shown separately.</p></div></div>' +
                rankingNotice +
                detailSummaryHtml(detail) +
                renderComment(detail) +
            '</article>' +
        '</section>';
    }

    function teacherStudentId(detail) {
        return String(valueAt(detail, ['student_uid', 'auth_uid', 'studentUid']) || '');
    }

    function renderTeacherCommentEditor(detail, report) {
        var studentUid = teacherStudentId(detail);
        var canEdit = isPreview(report) && Boolean(studentUid);
        var comment = commentForDetail(detail);
        var goals = goalsForDetail(detail);
        if (!canEdit) {
            return renderComment(detail, isPreview(report)
                ? 'This student record is not available for editing.'
                : 'Comments and goals were frozen when this report was published.') +
                '<p class="reports-readonly-note">' + (isPreview(report)
                    ? 'The comment editor needs a student account reference.'
                    : 'Published report comments are read-only.') + '</p>';
        }
        return '<form class="reports-comment-form" data-report-comment-form data-student-uid="' + escapeHtml(studentUid) + '">' +
            '<label>Teacher comment<textarea name="comment" maxlength="2000" placeholder="Add a short, helpful comment for this student…">' + escapeHtml(comment) + '</textarea></label>' +
            '<div class="reports-goal-fields">' + [0, 1, 2].map(function(index) {
                return '<label>Goal ' + (index + 1) + '<input name="goal" type="text" maxlength="240" value="' + escapeHtml(goals[index] || '') + '" placeholder="Optional next step"></label>';
            }).join('') + '</div>' +
            '<div class="reports-comment-form-actions"><span class="reports-comment-form-status" aria-live="polite"></span><button class="reports-save-button" type="submit">Save comment</button></div>' +
        '</form>';
    }

    function renderTeacherDetails(details, report) {
        if (!details.length) {
            return '<section class="reports-personal-section"><div class="reports-section-heading"><div><p class="eyebrow accent">TEACHER VIEW</p><h2>Student details</h2></div></div>' +
                '<article class="reports-empty-card"><div><h2>No student detail records</h2><p>The class snapshot is available, but it has no individual detail records yet.</p></div></article></section>';
        }
        return '<section class="reports-personal-section">' +
            '<div class="reports-section-heading"><div><p class="eyebrow accent">TEACHER VIEW</p><h2>Student details &amp; comments</h2></div>' +
            '<p>' + (isPreview(report) ? 'Add optional comments and up to three next-step goals before publication.' : 'This is the frozen published snapshot.') + '</p></div>' +
            '<div class="reports-teacher-details">' + details.map(function(detail) {
                var name = studentName(detail);
                return '<article class="reports-teacher-student-card">' +
                    '<div class="reports-student-head"><div><h3>' + escapeHtml(name.chinese) + '</h3>' +
                    (name.english ? '<p>' + escapeHtml(name.english) + '</p>' : '') + '</div>' +
                    (isPreview(report) ? statusBadge('preview') : statusBadge('published')) + '</div>' +
                    detailSummaryHtml(detail) +
                    renderTeacherCommentEditor(detail, report) +
                '</article>';
            }).join('') + '</div>' +
        '</section>';
    }

    function classOptionsHtml(selectedClassId) {
        var classes = state.classes;
        if (!classes.length && selectedClassId) {
            classes = [{ class_id: selectedClassId, name: 'Current class' }];
        }
        if (!classes.length) return '<option value="">No active class available</option>';
        return classes.map(function(item) {
            var id = String(valueAt(item, ['class_id', 'id', '_id']) || '');
            var active = id && id === String(selectedClassId || '');
            return '<option value="' + escapeHtml(id) + '"' + (active ? ' selected' : '') + '>' +
                escapeHtml(textAt(item, ['name', 'class_name', 'label'], id || 'Class')) + '</option>';
        }).join('');
    }

    function reportLink(report) {
        var id = reportEntryId(report);
        var supplied = String(report && report.report_url || '');
        if (supplied) {
            try {
                var url = new URL(supplied, window.location.href);
                if (url.origin === window.location.origin) return url.href;
            } catch (error) {}
        }
        var local = new URL('reports.html', window.location.href);
        local.searchParams.set('report', id);
        return local.href;
    }

    function wechatMessage(report) {
        var className = textAt(report, ['class_name', 'className'], 'Class');
        return className + ' ' + periodLabel(report) + ' 已发布。请登录学生账号查看：\n' + reportLink(report);
    }

    function renderTeacherToolbar(report) {
        if (!isTeacher()) return '';
        var canPublish = isPreview(report);
        var selectedClassId = valueAt(report, ['class_id', 'classId']);
        return '<section class="reports-teacher-toolbar">' +
            '<p>Teacher controls</p>' +
            '<div class="reports-action-row">' +
                '<button class="reports-action-button primary" type="button" data-report-action="toggle-generate">Generate preview</button>' +
                '<button class="reports-action-button publish" type="button" data-report-action="publish"' + (canPublish ? '' : ' disabled') + '>Publish report</button>' +
            '</div>' +
            '<div class="reports-generation-panel" id="reports-generation-panel" hidden>' +
                '<form class="reports-generation-form" data-report-generate-form>' +
                    '<label>Class<select name="class_id" required>' + classOptionsHtml(selectedClassId) + '</select></label>' +
                    '<label>Report type<select name="period_type"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>' +
                    '<button class="reports-action-button primary" type="submit">Create preview</button>' +
                '</form>' +
            '</div>' +
            '<div class="reports-copy-actions">' +
                '<button class="reports-copy-button" type="button" data-report-action="copy-link"><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M10 13.5a4.2 4.2 0 0 0 6 0l2.5-2.5a4.2 4.2 0 0 0-6-6L11 6.4"></path><path d="M14 10.5a4.2 4.2 0 0 0-6 0L5.5 13a4.2 4.2 0 0 0 6 6l1.5-1.5"></path></svg><span>Copy report link</span></button>' +
                '<button class="reports-copy-button" type="button" data-report-action="copy-wechat"><svg aria-hidden="true" viewBox="0 0 24 24" focusable="false"><path d="M20.5 11c0 4-4 7.2-8.8 7.2-1.2 0-2.4-.2-3.4-.7L4 19l1.2-3.3A6.5 6.5 0 0 1 3.1 11c0-4 4-7.2 8.8-7.2s8.6 3.2 8.6 7.2Z"></path><path d="M8.5 11h.01M12 11h.01M15.5 11h.01"></path></svg><span>Copy WeChat message</span></button>' +
            '</div>' +
        '</section>';
    }

    function renderReport() {
        var response = state.reportResponse || {};
        var report = response.report || response;
        if (!report || !reportEntryId(report)) {
            renderError('This report could not be loaded.');
            return;
        }
        var rows = leaderboardRows(response, report);
        var studentDetail = response.student_detail || report.student_detail || null;
        var studentDetails = asArray(response.student_details).length
            ? asArray(response.student_details)
            : asArray(report.student_details);
        var reportTitle = textAt(report, ['class_name', 'className'], 'Class') + ' · ' + periodLabel(report);
        document.title = reportTitle + ' | Mr. Cat Academy';
        reportsContent.innerHTML = '<article class="reports-card">' +
            '<header class="reports-report-head">' +
                '<div><p class="eyebrow accent">' + escapeHtml(periodLabel(report).toUpperCase()) + '</p><h2>' + escapeHtml(textAt(report, ['class_name', 'className'], 'Class learning report')) + '</h2><p class="reports-period-copy">' + escapeHtml(periodRange(report)) + '</p></div>' +
                '<div class="reports-report-meta">' + statusBadge(report.status) +
                    (report.published_at ? '<span>Published ' + escapeHtml(formatDate(report.published_at, true)) + '</span>' : '') +
                    (report.period_key ? '<span>' + escapeHtml(String(report.period_key)) + '</span>' : '') + '</div>' +
            '</header>' +
            renderTeacherToolbar(report) +
            '<section class="reports-personal-section">' +
                '<div class="reports-section-heading"><div><p class="eyebrow accent">CLASS VIEW</p><h2>Class leaderboard</h2></div>' +
                '<p>Ranking is based on class tasks due in this period and passed by the report cutoff. Self-study is shown separately.</p></div>' +
                renderLeaderboard(rows) +
            '</section>' +
            (isTeacher() ? renderTeacherDetails(studentDetails, report) : renderStudentDetail(studentDetail)) +
        '</article>';
        closeButton.hidden = false;
        printButton.disabled = false;
    }

    function renderReportChooser() {
        document.title = 'Learning Reports | Mr. Cat Academy';
        reportsContent.innerHTML = '<section class="reports-empty-card"><div><h2>Choose a learning report</h2>' +
            '<p>Select another weekly or monthly report from the report list.</p></div></section>';
        closeButton.hidden = true;
        printButton.disabled = true;
    }

    function renderEmpty() {
        document.title = 'Learning Reports | Mr. Cat Academy';
        reportsContent.innerHTML = '<section class="reports-empty-card"><div><h2>No learning reports yet</h2><p>' +
            (isTeacher()
                ? 'Choose Generate preview to prepare the current weekly or monthly report for an active class.'
                : 'Your teacher has not published a learning report for this account yet.') +
            '</p>' +
            (isTeacher() ? '<div class="reports-teacher-toolbar"><p>Teacher controls</p><div class="reports-action-row"><button class="reports-action-button primary" type="button" data-report-action="toggle-generate">Generate preview</button></div><div class="reports-generation-panel" id="reports-generation-panel" hidden><form class="reports-generation-form" data-report-generate-form><label>Class<select name="class_id" required>' + classOptionsHtml('') + '</select></label><label>Report type<select name="period_type"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><button class="reports-action-button primary" type="submit">Create preview</button></form></div></div>' : '') +
            '</div></section>';
        closeButton.hidden = true;
        printButton.disabled = true;
    }

    function renderError(message) {
        reportsContent.innerHTML = '<section class="reports-error-card"><div><h2>Unable to open this report</h2><p>' + escapeHtml(message || 'Please refresh and try again.') + '</p><p><button class="reports-action-button" type="button" data-report-action="retry">Try again</button></p></div></section>';
        printButton.disabled = true;
    }

    function selectReport(reportId, options) {
        var id = String(reportId || '');
        var requestVersion = ++state.reportRequestVersion;
        if (!id) {
            state.selectedReportId = '';
            state.reportResponse = null;
            updateUrl('', Boolean(options && options.replaceUrl));
            renderReportList();
            if (state.reports.length) renderReportChooser();
            else renderEmpty();
            if (options && options.focus) {
                var firstReport = reportList.querySelector('[data-report-id]');
                if (firstReport) firstReport.focus();
                else latestButton.focus();
            }
            return Promise.resolve();
        }
        state.selectedReportId = id;
        state.reportResponse = null;
        state.loadingReport = true;
        closeButton.hidden = false;
        updateUrl(id, Boolean(options && options.replaceUrl));
        renderReportList();
        clearFeedback();
        showLoading('Loading report…');
        return reportCall('getReport', { report_id: id }).then(function(result) {
            if (requestVersion !== state.reportRequestVersion || state.selectedReportId !== id) return null;
            state.loadingReport = false;
            state.reportResponse = result;
            state.role = result.role || state.role;
            renderReportList();
            renderReport();
            if (options && options.focus) reportsContent.focus({ preventScroll: false });
            return result;
        }).catch(function(error) {
            if (requestVersion !== state.reportRequestVersion || state.selectedReportId !== id) return null;
            state.loadingReport = false;
            setFeedback(error.message || 'Unable to load that report.', 'error');
            renderError(error.message || 'Unable to load that report.');
            throw error;
        });
    }

    function loadReports(options) {
        options = options || {};
        state.loadingList = true;
        renderReportList();
        return reportCall('listReports').then(function(result) {
            state.loadingList = false;
            state.role = result.role || state.role;
            state.reports = sortReports(asArray(result.reports));
            state.classes = asArray(result.classes);
            renderReportList();
            var id = String(options.selectReportId || state.selectedReportId || reportIdFromUrl() || '');
            if (!id && state.reports.length) id = reportEntryId(state.reports[0]);
            if (!id) {
                state.selectedReportId = '';
                state.reportResponse = null;
                updateUrl('', true);
                renderEmpty();
                return result;
            }
            return selectReport(id, { replaceUrl: true, focus: options.focus }).then(function() { return result; });
        }).catch(function(error) {
            state.loadingList = false;
            reportList.setAttribute('aria-busy', 'false');
            reportList.innerHTML = '<div class="reports-list-empty">Unable to load reports.</div>';
            setFeedback(error.message || 'Unable to load reports.', 'error');
            renderError(error.message || 'Unable to load reports.');
            throw error;
        });
    }

    function currentReport() {
        var response = state.reportResponse || {};
        return response.report || response || null;
    }

    function copyText(text) {
        if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
            return navigator.clipboard.writeText(text);
        }
        return new Promise(function(resolve, reject) {
            var area = document.createElement('textarea');
            area.value = text;
            area.setAttribute('readonly', '');
            area.style.position = 'fixed';
            area.style.opacity = '0';
            document.body.appendChild(area);
            area.select();
            try {
                if (!document.execCommand('copy')) throw new Error('Copy is not available in this browser.');
                resolve();
            } catch (error) {
                reject(error);
            } finally {
                area.remove();
            }
        });
    }

    function copyReportValue(button, value, successMessage) {
        copyText(value).then(function() {
            var label = button && button.querySelector('span');
            if (label) {
                var original = label.textContent;
                label.textContent = 'Copied';
                window.setTimeout(function() { label.textContent = original; }, 1600);
            }
            setFeedback(successMessage || 'Copied to clipboard.');
        }).catch(function(error) {
            setFeedback(error.message || 'Unable to copy. Select the text manually instead.', 'error');
        });
    }

    function updateCommentInMemory(studentUid, comment, goals) {
        var response = state.reportResponse || {};
        var report = response.report || response;
        function update(detail) {
            if (String(teacherStudentId(detail)) !== String(studentUid)) return detail;
            return Object.assign({}, detail, { teacher_comment: comment, teacher_goals: goals });
        }
        if (Array.isArray(response.student_details)) response.student_details = response.student_details.map(update);
        if (report && Array.isArray(report.student_details)) report.student_details = report.student_details.map(update);
    }

    function saveComment(form) {
        var report = currentReport();
        var reportId = reportEntryId(report);
        var studentUid = String(form.getAttribute('data-student-uid') || '');
        if (!reportId || !studentUid) return;
        var submit = form.querySelector('button[type="submit"]');
        var status = form.querySelector('.reports-comment-form-status');
        var comment = String(form.elements.comment && form.elements.comment.value || '').trim();
        var goalInputs = form.querySelectorAll('input[name="goal"]');
        var goals = Array.prototype.map.call(goalInputs, function(input) { return String(input.value || '').trim(); }).filter(Boolean).slice(0, 3);
        if (submit) submit.disabled = true;
        if (status) status.textContent = 'Saving…';
        reportCall('saveComment', {
            report_id: reportId,
            student_uid: studentUid,
            comment: comment,
            goals: goals
        }).then(function() {
            updateCommentInMemory(studentUid, comment, goals);
            if (status) status.textContent = 'Saved.';
            setFeedback('Teacher comment saved.');
            window.setTimeout(function() {
                if (status) status.textContent = '';
            }, 1800);
        }).catch(function(error) {
            if (status) status.textContent = error.message || 'Unable to save.';
            setFeedback(error.message || 'Unable to save the comment.', 'error');
        }).finally(function() {
            if (submit) submit.disabled = false;
        });
    }

    function generatePreview(form) {
        var submit = form.querySelector('button[type="submit"]');
        var classId = String(form.elements.class_id && form.elements.class_id.value || '');
        var periodType = String(form.elements.period_type && form.elements.period_type.value || 'weekly');
        if (!classId) {
            setFeedback('Choose an active class before generating a preview.', 'error');
            return;
        }
        if (submit) submit.disabled = true;
        setFeedback('Generating preview…');
        reportCall('generatePreview', { class_id: classId, period_type: periodType }).then(function(result) {
            var report = result.report || result;
            var reportId = reportEntryId(report);
            setFeedback('Preview generated. You can now add comments and goals.');
            return loadReports({ selectReportId: reportId, focus: true });
        }).catch(function(error) {
            setFeedback(error.message || 'Unable to generate a preview.', 'error');
        }).finally(function() {
            if (submit) submit.disabled = false;
        });
    }

    function publishCurrentReport() {
        var report = currentReport();
        var reportId = reportEntryId(report);
        if (!reportId || !isPreview(report)) return;
        if (!window.confirm('Publish this report now? Students and parents using their student account will be able to view it.')) return;
        var button = reportsContent.querySelector('[data-report-action="publish"]');
        if (button) button.disabled = true;
        setFeedback('Publishing report…');
        reportCall('publishReport', { report_id: reportId }).then(function() {
            setFeedback('Report published. The shared link is ready to send.');
            return loadReports({ selectReportId: reportId });
        }).catch(function(error) {
            setFeedback(error.message || 'Unable to publish this report.', 'error');
        }).finally(function() {
            if (button) button.disabled = false;
        });
    }

    function toggleGeneratePanel() {
        var panel = document.getElementById('reports-generation-panel');
        if (!panel) return;
        panel.hidden = !panel.hidden;
        if (!panel.hidden) {
            var select = panel.querySelector('select');
            if (select) select.focus();
        }
    }

    function handleContentClick(event) {
        var button = event.target.closest('[data-report-action]');
        if (!button) return;
        var action = button.getAttribute('data-report-action');
        if (action === 'toggle-generate') {
            toggleGeneratePanel();
        } else if (action === 'publish') {
            publishCurrentReport();
        } else if (action === 'copy-link') {
            copyReportValue(button, reportLink(currentReport()), 'Report link copied.');
        } else if (action === 'copy-wechat') {
            copyReportValue(button, wechatMessage(currentReport()), 'WeChat message copied.');
        } else if (action === 'retry') {
            loadReports({ selectReportId: state.selectedReportId || reportIdFromUrl() }).catch(function() {});
        }
    }

    function configureHeader() {
        var teacher = isTeacher();
        returnLink.href = teacher ? 'teacher.html' : 'dashboard.html';
        returnLink.setAttribute('aria-label', teacher ? 'Return to Teacher desk' : 'Return to Dashboard');
        returnLink.querySelector('span').textContent = teacher ? 'Teacher desk' : 'Dashboard';
        subtitle.textContent = teacher
            ? 'Prepare class previews, add personal comments, publish, and share one secure report link.'
            : 'See your class report and your own personal learning details.';
    }

    function requireAuthenticatedSession() {
        return window.MrCatAuth.getSession().then(function(session) {
            if (!session || session.mode === 'none' || session.mode === 'visitor') {
                if (session && session.mode === 'visitor') {
                    try { window.MrCatAuth.setVisitor(false); } catch (error) {}
                }
                var target = 'reports.html' + window.location.search + window.location.hash;
                window.location.replace('index.html?return=' + encodeURIComponent(target));
                return null;
            }
            state.session = session;
            state.role = session.mode;
            configureHeader();
            return session;
        });
    }

    reportList.addEventListener('click', function(event) {
        var item = event.target.closest('[data-report-id]');
        if (!item) return;
        var id = item.getAttribute('data-report-id');
        if (id && id !== state.selectedReportId) selectReport(id, { focus: true }).catch(function() {});
    });

    latestButton.addEventListener('click', function() {
        var latest = state.reports[0];
        var id = reportEntryId(latest);
        if (id) selectReport(id, { focus: true }).catch(function() {});
    });

    refreshButton.addEventListener('click', function() {
        refreshButton.disabled = true;
        setFeedback('Refreshing reports…');
        loadReports({ selectReportId: state.selectedReportId || reportIdFromUrl() })
            .then(function() { setFeedback('Reports refreshed.'); })
            .catch(function() {})
            .finally(function() { refreshButton.disabled = false; });
    });

    printButton.addEventListener('click', function() {
        if (!state.reportResponse) return;
        window.print();
    });

    closeButton.addEventListener('click', function() {
        selectReport('', { focus: true }).catch(function() {});
    });

    logoutButton.addEventListener('click', function() {
        window.MrCatAuth.logout();
    });

    reportsContent.addEventListener('click', handleContentClick);
    reportsContent.addEventListener('submit', function(event) {
        var commentForm = event.target.closest('[data-report-comment-form]');
        var generateForm = event.target.closest('[data-report-generate-form]');
        if (!commentForm && !generateForm) return;
        event.preventDefault();
        if (commentForm) saveComment(commentForm);
        if (generateForm) generatePreview(generateForm);
    });

    window.addEventListener('popstate', function() {
        var id = reportIdFromUrl();
        if (id && id !== state.selectedReportId) selectReport(id, { replaceUrl: true }).catch(function() {});
        if (!id && state.selectedReportId) {
            selectReport('', { replaceUrl: true }).catch(function() {});
        }
    });

    requireAuthenticatedSession().then(function(session) {
        if (!session) return;
        state.selectedReportId = reportIdFromUrl();
        return loadReports({ selectReportId: state.selectedReportId, focus: false });
    }).catch(function(error) {
        setFeedback(error.message || 'Unable to start learning reports.', 'error');
        renderError(error.message || 'Unable to start learning reports.');
    });
})();
