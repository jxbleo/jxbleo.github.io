(function (window) {
    'use strict';

    var root = document.getElementById('speaking-report-state');
    var token = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('share') || new URLSearchParams(window.location.search).get('share') || '';
    var domains = ['communication_strategies', 'vocabulary_language_patterns', 'ideas_organisation'];
    var reportAuthPromise = null;
    var domainNames = {
        communication_strategies: 'Communication strategies',
        vocabulary_language_patterns: 'Vocabulary & language',
        ideas_organisation: 'Ideas & organisation'
    };

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
        });
    }
    function failure() {
        root.innerHTML = '<div class="speaking-report-card"><h1>Report unavailable</h1><p class="speaking-report-error">This private share link is expired, revoked, or unavailable.</p></div>';
    }
    function ensureReportAuth() {
        if (reportAuthPromise) return reportAuthPromise;
        reportAuthPromise = window.MrCatCloud.getLoginState().then(function (loginState) {
            if (loginState) return loginState;
            return window.MrCatCloud.signInAnonymously();
        }).catch(function (error) {
            reportAuthPromise = null;
            throw error;
        });
        return reportAuthPromise;
    }
    function list(title, items) {
        if (!Array.isArray(items) || !items.length) return '';
        return '<h3>' + esc(title) + '</h3><ul>' + items.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>';
    }
    function domainMarkup(candidate) {
        if (!candidate || !candidate.domains) return '';
        return domains.map(function (name) {
            var domain = candidate.domains[name];
            if (!domain) return '';
            return '<div class="speaking-report-domain"><strong>' + domainNames[name] + '</strong><span class="speaking-report-score">' + esc(domain.score == null ? '—' : domain.score) + '/7</span><div class="speaking-report-domain-copy"><p>' + esc(domain.commentary_zh || '') + '</p>' +
                list('Strengths', domain.strengths) + list('Priority actions', domain.priority_actions) + list('Language suggestions', domain.language_suggestions) + '</div></div>';
        }).join('');
    }
    function timeLabel(value) {
        var seconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
        return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }
    function turnCoachingDetailsMarkup(coaching) {
        var item = coaching || {};
        if (!(item.strength_zh && item.limitation_zh && item.improvement_zh)) return '<div class="speaking-shared-turn-feedback speaking-shared-turn-feedback-legacy"><article><span>Review</span><p>' + esc(item.commentary_zh || '') + '</p></article></div>';
        return '<div class="speaking-shared-turn-feedback">' +
            '<article data-feedback="strength"><span>What worked</span><p>' + esc(item.strength_zh) + '</p></article>' +
            '<article data-feedback="limitation"><span>What could be stronger</span><p>' + esc(item.limitation_zh) + '</p></article>' +
            '<article data-feedback="improvement"><span>How to improve</span><p>' + esc(item.improvement_zh) + '</p></article>' +
            '</div>';
    }
    function turnReviewsMarkup(candidate) {
        var reviews = Array.isArray(candidate && candidate.turn_reviews) ? candidate.turn_reviews : [];
        var evidence = Array.isArray(candidate && candidate.evidence) ? candidate.evidence : [];
        if (!reviews.length && !evidence.length) return '';
        return '<details class="speaking-shared-turn-review"><summary>See more details</summary>' + (reviews.length ? '<p class="speaking-shared-turn-note">Each speaking turn is reviewed for CS and IO. VL support is included in the English samples below.</p>' : '') + reviews.map(function (review, index) {
            var cs = review.communication_strategies || {};
            var io = review.ideas_organisation || {};
            var caution = review.asr_text_status === 'higher_confidence' ? '' : '<span class="speaking-shared-turn-caution">AI transcript may contain recognition errors</span>';
            return '<article class="speaking-shared-turn"><header><strong>Turn ' + esc(index + 1) + '</strong><span>' + esc(timeLabel(review.start_ms)) + '–' + esc(timeLabel(review.end_ms)) + '</span>' + caution + '</header><blockquote><span>What you said · AI transcript</span>' + esc(review.transcript_text || '') + '</blockquote><div class="speaking-shared-turn-grid"><section><h4>CS · Communication Strategies</h4>' + turnCoachingDetailsMarkup(cs) + '<div class="speaking-shared-sample"><span>Try saying</span><q>' + esc(cs.sample_en || '') + '</q></div></section><section><h4>IO · Ideas &amp; Organisation</h4>' + turnCoachingDetailsMarkup(io) + '<div class="speaking-shared-sample"><span>Try saying</span><q>' + esc(io.sample_en || '') + '</q></div></section></div></article>';
        }).join('') + (evidence.length ? '<h3>Evidence</h3><ul>' + evidence.map(function (item) { return '<li>' + esc(Math.floor(Number(item.start_ms || 0) / 1000)) + 's — ' + esc(item.text || '') + '</li>'; }).join('') + '</ul>' : '') + '</details>';
    }
    function candidateMarkup(candidate) {
        if (!candidate) return '';
        return '<section class="speaking-report-candidate"><h2>' + esc(candidate.speaker_label || 'Speaker') + '</h2><p>' + esc(candidate.summary_zh || '') + '</p>' +
            domainMarkup(candidate) + list('Strengths', candidate.strengths) + list('Priority actions', candidate.priority_actions) + list('Language suggestions', candidate.language_suggestions) + turnReviewsMarkup(candidate) + '</section>';
    }
    function render(snapshot, result) {
        if (!snapshot) return failure();
        var metadata = result.metadata || {};
        var title = snapshot.title || 'DSE Group Discussion Report';
        var titleDate = title.match(/ · (\d{4}-\d{2}-\d{2})$/);
        var discussionDate = metadata.discussion_date || (titleDate ? titleDate[1] : 'Not recorded');
        if (titleDate && titleDate[1] === discussionDate) title = title.slice(0, titleDate.index);
        var candidates = (snapshot.share_kind === 'student' ? [snapshot.self] : Array.isArray(snapshot.candidates) ? snapshot.candidates : []).filter(Boolean);
        var selector = candidates.length > 1 ? '<nav class="speaking-report-students" aria-label="Select a student">' + candidates.map(function (candidate, index) {
            return '<button type="button" class="speaking-report-student" data-candidate-index="' + index + '" aria-controls="speaking-selected-report" aria-pressed="' + (index === 0 ? 'true' : 'false') + '">' + esc(candidate.speaker_label || 'Speaker ' + (index + 1)) + '</button>';
        }).join('') + '</nav>' : '';
        root.innerHTML = '<article class="speaking-report-card"><h1>' + esc(title) + '</h1><dl class="speaking-report-meta"><div><dt>Source</dt><dd>' + esc(metadata.source_label || 'Not recorded') + '</dd></div><div><dt>Discussion Date</dt><dd>' + esc(discussionDate) + '</dd></div></dl>' +
            selector + '<div id="speaking-selected-report" aria-live="polite">' + (candidates.length ? candidateMarkup(candidates[0]) : '<p>No student report is included in this share.</p>') + '</div>' +
            '</article>';
        var buttons = root.querySelectorAll('[data-candidate-index]');
        var selectedIndex = 0;
        Array.prototype.forEach.call(buttons, function (button) {
            button.addEventListener('click', function () {
                var index = Number(button.getAttribute('data-candidate-index'));
                if (!Number.isInteger(index) || !candidates[index] || index === selectedIndex) return;
                selectedIndex = index;
                Array.prototype.forEach.call(buttons, function (item) { item.setAttribute('aria-pressed', item === button ? 'true' : 'false'); });
                // Keep only the chosen student's report in the DOM. Each switch
                // starts with its detail disclosure closed, including on return.
                root.querySelector('#speaking-selected-report').innerHTML = candidateMarkup(candidates[index]);
            });
        });
    }

    if (!token || token.length > 300 || !window.MrCatCloud || typeof window.MrCatCloud.callFunction !== 'function') {
        failure();
        return;
    }
    ensureReportAuth().then(function () {
        return window.MrCatCloud.callFunction('speakingLab', { action: 'getSharedReport', share: token });
    }).then(function (result) {
        if (!result || result.success === false) throw new Error('SHARE_NOT_AVAILABLE');
        render(result.snapshot, result);
    }).catch(failure);
})(window);
