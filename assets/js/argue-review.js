(function() {
    'use strict';
    var disputeId = new URLSearchParams(window.location.search).get('dispute');
    var card = document.getElementById('argue-card');
    var message = document.getElementById('argue-message');
    var recovery = document.getElementById('argue-recovery');
    var login = document.getElementById('argue-login');
    var retry = document.getElementById('argue-retry');
    var switchAccount = document.getElementById('argue-switch');
    var current = null;
    var busy = false;
    var labels = { keep: 'Keep Original Ruling', add: 'Add as Accepted Answer', replace: 'Replace Correct Answer', provide: 'Approve Provided Word' };
    var errors = {
        DISPUTE_NOT_AVAILABLE: 'This request is no longer available.',
        DISPUTE_ALREADY_RESOLVED: 'This Argue has already been processed. The saved result is shown below.',
        DISPUTE_PROCESSING: 'This request is being processed. Please wait, then refresh the request.',
        DISPUTE_DECISION_COMMITTED: 'A decision has already been saved. Refresh to continue that decision.',
        DISPUTE_REVIEW_CHANGED: 'The answer rule changed while this card was open. Review the updated card before submitting again.',
        DISPUTE_DECISION_REQUIRED: 'Choose one decision before submitting.',
        TEACHER_REQUIRED: 'Please use an active teacher account to review this request.',
        MATERIAL_NOT_FOUND: 'This version of the Listening material is no longer available.',
        GRADING_KEY_NOT_FOUND: 'The answer rule is unavailable. Please try again later.'
    };

    function escapeHtml(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function(c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function answer(value) { return Array.isArray(value) ? value.join(' / ') : String(value == null ? '—' : value); }
    function status(text, tone) { message.textContent = text; message.dataset.tone = tone || ''; }
    function loginUrl() { return window.MrCatLoginNavigation.loginHref(window.location.href, 'argue-review.html'); }
    function isAuthError(error) { return /AUTH_REQUIRED|LOGIN_REQUIRED|UNAUTHENTICATED|LOGIN_EXPIRED/i.test((error.code || '') + ' ' + error.message); }
    function call(action, fields) {
        return window.MrCatCloud.callFunction('teacherAdmin', Object.assign({ action: action, dispute_id: disputeId }, fields)).then(function(result) {
            if (!result || !result.success) {
                var error = new Error(result && result.message || 'Unable to complete this request.');
                error.code = result && result.code;
                throw error;
            }
            return result;
        });
    }
    function showError(error) {
        status(errors[error.code] || 'The request could not be completed. Please check your connection and try again.', 'error');
        recovery.hidden = false;
        retry.hidden = error.code === 'DISPUTE_NOT_AVAILABLE';
        login.hidden = !isAuthError(error);
        login.href = loginUrl();
        if (isAuthError(error)) status('Your session expired. Sign in again to return to this question.', 'error');
        switchAccount.hidden = error.code !== 'TEACHER_REQUIRED';
    }
    function render(item, draft) {
        current = item;
        var intensive = item.dispute_type === 'intensive_spelling_exemption';
        var pending = item.status === 'pending';
        var committed = item.resolution_decision;
        var decisions = intensive ? ['keep', 'provide'] : ['keep', 'add', 'replace'];
        var selected = committed || draft && draft.decision || '';
        var note = committed ? item.resolution_note : draft && draft.note || '';
        var date = new Date(item.created_at);
        document.getElementById('argue-title').textContent = item.set_title || item.set_id;
        document.getElementById('argue-student').textContent = item.student_name + (item.student_id ? ' · ' + item.student_id : '');
        card.innerHTML = '<article class="dispute-detail">' +
            '<div class="dispute-detail-head"><div><strong>Question ' + escapeHtml(item.question_id) + '</strong><small>' +
            escapeHtml(isNaN(date.getTime()) ? '' : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })) +
            '</small></div><span class="badge dispute-status">' + escapeHtml(pending ? 'Pending' : item.status === 'approved' ? 'Approved' : 'Rejected') + '</span></div>' +
            '<p class="dispute-question-text" id="argue-question">' + escapeHtml(item.question_text_snapshot || 'Question text is unavailable.') + '</p>' +
            '<div class="dispute-comparison"><div><span>' + (intensive ? 'Requested Provided Word' : 'Submitted answer') + '</span><strong>' + escapeHtml(answer(item.submitted_answer)) + '</strong></div>' +
            (!intensive ? '<div><span>Correct answer snapshot</span><strong>' + escapeHtml(answer(item.answer_snapshot)) + '</strong></div>' : '') + '</div>' +
            (!intensive && item.current_answer != null && answer(item.current_answer) !== answer(item.answer_snapshot)
                ? '<p class="dispute-explanation"><strong>Current accepted answers</strong>' + escapeHtml(answer(item.current_answer)) + '</p>' : '') +
            (!intensive ? '<p class="dispute-explanation"><strong>Explanation</strong>' + escapeHtml(item.explanation || item.explanation_snapshot || 'No explanation is stored for this question.') + '</p>' : '') +
            '<p class="dispute-reason"><strong>Student’s Argue</strong><br>' + escapeHtml(item.student_reason || 'No note provided.') + '</p>' +
            (pending ? '<form id="argue-form"><fieldset class="argue-choices"' + (committed ? ' disabled' : '') + '><legend>Decision</legend>' +
                decisions.map(function(decision) {
                    return '<label class="argue-choice"><input type="radio" name="decision" value="' + decision + '" required' + (selected === decision ? ' checked' : '') + '><span>' + escapeHtml(labels[decision]) + '</span></label>';
                }).join('') + '</fieldset>' +
                '<label class="argue-note-label" for="argue-note">Teachers’ Note <span>(optional)</span></label>' +
                '<textarea class="dispute-note" id="argue-note" maxlength="1000" placeholder="Add a note for the student…"' + (committed ? ' readonly' : '') + '>' + escapeHtml(note) + '</textarea>' +
                '<p class="argue-impact">' + (committed ? 'The decision is saved. Continue to finish applying it.' : intensive
                    ? 'Approval makes this a Provided Word for all students.'
                    : 'Add and Replace update the answer rule for this question and improve matching historical results.') + '</p>' +
                '<div class="argue-replace-confirm" id="argue-replace-confirm" hidden><p>Replace the correct answer for future submissions? The previous rule will remain in history.</p><button class="danger-button" id="argue-confirm" type="button">Confirm Replace</button> <button class="outline-button" id="argue-cancel" type="button">Cancel</button></div>' +
                '<button class="primary-button argue-submit" type="submit" id="argue-submit"' + (item.resolution_processing ? ' disabled' : '') + '>' + (item.resolution_processing ? 'Processing…' : committed ? 'Continue processing' : 'Submit') + '</button></form>'
                : '<div class="argue-result"><strong>✓ ' + escapeHtml(labels[item.decision] || item.status) + '</strong>' +
                  (item.teacher_note ? '<p><strong>Teachers’ Note</strong><br>' + escapeHtml(item.teacher_note) + '</p>' : '') + '</div>') + '</article>';
        if (pending) bindForm();
        if (item.resolution_processing) { recovery.hidden = false; retry.hidden = false; retry.textContent = 'Refresh request'; }
        if (!item.question_text_snapshot && !intensive) loadQuestionText(item);
    }
    function readDraft() {
        var selected = card.querySelector('input[name="decision"]:checked');
        var note = document.getElementById('argue-note');
        return { decision: selected && selected.value || '', note: note && note.value || '' };
    }
    function bindForm() {
        var form = document.getElementById('argue-form');
        var confirm = document.getElementById('argue-replace-confirm');
        var submit = document.getElementById('argue-submit');
        form.addEventListener('input', function() { confirm.hidden = true; submit.hidden = false; });
        form.addEventListener('submit', function(event) {
            event.preventDefault();
            if (busy) return;
            if (readDraft().decision === 'replace' && !current.resolution_decision) {
                confirm.hidden = false; submit.hidden = true; document.getElementById('argue-confirm').focus(); return;
            }
            save();
        });
        document.getElementById('argue-confirm').addEventListener('click', save);
        document.getElementById('argue-cancel').addEventListener('click', function() { confirm.hidden = true; submit.hidden = false; submit.focus(); });
    }
    function refresh(draft) {
        return call('getDispute').then(function(result) {
            recovery.hidden = true;
            login.hidden = true;
            switchAccount.hidden = true;
            render(result.dispute, draft);
            return result.dispute;
        });
    }
    function save() {
        if (busy || !current) return;
        var draft = readDraft();
        if (!draft.decision) { status(errors.DISPUTE_DECISION_REQUIRED, 'error'); return; }
        busy = true;
        card.querySelectorAll('button, input, textarea').forEach(function(el) { el.disabled = true; });
        status('Processing…');
        call('resolveDispute', { decision: draft.decision, teacher_note: draft.note, expected_revision: current.review_revision }).then(function() {
            // Do not depend on a second network request to display the saved result.
            render(Object.assign({}, current, { status: draft.decision === 'keep' ? 'rejected' : 'approved', decision: draft.decision, teacher_note: draft.note.trim() }));
            recovery.hidden = true;
            status('✓ Argue processed. The student can now see your reply.', 'success');
        }).catch(function(error) {
            return refresh(draft).then(function(item) {
                if (item.status !== 'pending') status('This Argue has been processed. The saved result is shown below.', 'success');
                else showError(error);
            }).catch(function() { render(current, draft); showError(error); });
        }).finally(function() { busy = false; });
    }
    function loadQuestionText(item) {
        var setId = encodeURIComponent(item.set_id);
        fetch('data/' + setId + '.json').then(function(response) {
            return response.ok ? response.json() : fetch('content/vocabulary/' + setId + '.json').then(function(r) { return r.ok ? r.json() : null; });
        }).then(function(data) {
            if (!data || current !== item) return;
            var found = '';
            (data.blanks || []).concat(data.multipleChoice || [], data.matching || []).forEach(function(q) {
                if (String(q.id) === String(item.question_id)) found = q.sentence || q.question || q.text || q.title;
                (q.pairs || []).forEach(function(pair, index) { if (q.id + '-' + index === String(item.question_id)) found = pair.left || pair.text || pair.question; });
            });
            (data.quizGroups || []).forEach(function(group) { (group.questions || []).forEach(function(q) {
                if (String(q.questionKey || group.id + ':' + q.number) === String(item.question_id)) found = q.prompt || q.text || q.question || q.sentence;
            }); });
            if (found) document.getElementById('argue-question').textContent = found;
        }).catch(function() {});
    }
    function start() {
        if (busy) return;
        if (!disputeId) { status('The email link is incomplete. Please reopen the original Argue email.', 'error'); return; }
        var draft = readDraft();
        recovery.hidden = true;
        status('Loading…');
        window.MrCatAuth.getSession().then(function(session) {
            if (session.mode === 'none' || session.mode === 'visitor') { window.location.replace(loginUrl()); return null; }
            if (session.mode !== 'teacher' || session.profile.active === false) {
                var error = new Error('Teacher access required.'); error.code = 'TEACHER_REQUIRED'; throw error;
            }
            document.getElementById('argue-identity').textContent = session.profile.name || session.profile.student_id || 'Teacher';
            return refresh(draft).then(function(item) { status(item.resolution_processing && item.status === 'pending' ? errors.DISPUTE_PROCESSING : ''); });
        }).catch(showError);
    }
    retry.addEventListener('click', start);
    switchAccount.addEventListener('click', function() {
        window.MrCatCloud.signOut().then(function() { window.MrCatAuth.clearLocalIdentity(); window.location.replace(loginUrl()); }).catch(showError);
    });
    start();
})();
