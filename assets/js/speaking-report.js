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
            return '<div class="speaking-report-domain"><strong>' + domainNames[name] + '</strong><span class="speaking-report-score">' + esc(domain.score) + '/7</span><p>' + esc(domain.commentary_zh || '') + '</p></div>';
        }).join('') + '<div class="speaking-report-domain"><strong>Pronunciation &amp; Delivery</strong><span>Not assessed</span></div>';
    }
    function timeLabel(value) {
        var seconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
        return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }
    function turnReviewsMarkup(candidate, ownReport) {
        var reviews = Array.isArray(candidate && candidate.turn_reviews) ? candidate.turn_reviews : [];
        if (!reviews.length) return '';
        return '<section class="speaking-shared-turn-review"><h3>' + (ownReport ? 'My turn-by-turn review' : 'Turn-by-turn review') + '</h3><p class="speaking-shared-turn-note">Each speaking turn is reviewed for CS and IO. VL support is included in the English samples below.</p>' + reviews.map(function (review, index) {
            var cs = review.communication_strategies || {};
            var io = review.ideas_organisation || {};
            var caution = review.asr_text_status === 'higher_confidence' ? '' : '<span class="speaking-shared-turn-caution">AI transcript may contain recognition errors</span>';
            return '<article class="speaking-shared-turn"><header><strong>Turn ' + esc(index + 1) + '</strong><span>' + esc(timeLabel(review.start_ms)) + '–' + esc(timeLabel(review.end_ms)) + '</span>' + caution + '</header><blockquote><span>What you said · AI transcript</span>' + esc(review.transcript_text || '') + '</blockquote><div class="speaking-shared-turn-grid"><section><h4>CS · Communication Strategies</h4><p>' + esc(cs.commentary_zh || '') + '</p><div class="speaking-shared-sample"><span>Try saying</span><q>' + esc(cs.sample_en || '') + '</q></div></section><section><h4>IO · Ideas &amp; Organisation</h4><p>' + esc(io.commentary_zh || '') + '</p><div class="speaking-shared-sample"><span>Try saying</span><q>' + esc(io.sample_en || '') + '</q></div></section></div></article>';
        }).join('') + '</section>';
    }
    function candidateMarkup(candidate, ownReport) {
        if (!candidate) return '';
        var evidence = Array.isArray(candidate.evidence) && candidate.evidence.length ? '<h3>Evidence</h3><ul>' + candidate.evidence.map(function (item) { return '<li>' + esc(Math.floor(Number(item.start_ms || 0) / 1000)) + 's — ' + esc(item.text || '') + '</li>'; }).join('') + '</ul>' : '';
        return '<section class="speaking-report-candidate"><h2>' + esc(candidate.speaker_label || 'Speaker') + '</h2><p>' + esc(candidate.summary_zh || '') + '</p>' +
            domainMarkup(candidate) + list('Strengths', candidate.strengths) + list('Priority actions', candidate.priority_actions) + list('Language suggestions', candidate.language_suggestions) + turnReviewsMarkup(candidate, ownReport) + evidence + '</section>';
    }
    function studentPeerMarkup(snapshot) {
        var peers = (snapshot.participant_summaries || []).filter(function (item) { return !item.is_self; });
        if (!peers.length) return '';
        return '<section class="speaking-report-candidate"><h2>Group interaction</h2>' + peers.map(function (peer) {
            var turns = peer.interaction_summary && peer.interaction_summary.turn_count;
            return '<p><strong>' + esc(peer.speaker_label || 'Speaker') + '</strong>' + (Number.isInteger(turns) ? ' · ' + esc(turns) + ' turns' : '') + '</p>';
        }).join('') + '</section>';
    }
    function render(snapshot, result) {
        if (!snapshot) return failure();
        var candidateSection = snapshot.share_kind === 'student'
            ? candidateMarkup(snapshot.self, true) + studentPeerMarkup(snapshot)
            : (Array.isArray(snapshot.candidates) ? snapshot.candidates : []).map(function (candidate) { return candidateMarkup(candidate, false); }).join('');
        var transcript = Array.isArray(snapshot.transcript) && snapshot.transcript.length
            ? '<h2>Transcript</h2><div class="speaking-report-transcript">' + snapshot.transcript.map(function (line) { return '<div class="speaking-report-line"><strong>' + esc(line.speaker_label || 'Speaker') + '</strong> ' + esc(line.text) + '</div>'; }).join('') + '</div>'
            : '';
        root.innerHTML = '<article class="speaking-report-card"><h1>' + esc(snapshot.title || 'DSE Group Discussion Report') + '</h1><p>Private share · Report generated ' + esc(snapshot.generated_at || 'recently') + ' · Expires ' + esc(result.expires_at || 'soon') + '</p>' +
            (snapshot.group_summary_zh ? '<h2>Group summary</h2><p>' + esc(snapshot.group_summary_zh) + '</p>' : '') +
            list('Group strengths', snapshot.group_strengths) + list('Group priorities', snapshot.group_priorities) + list('Discussion flow', snapshot.discussion_flow) +
            candidateSection + transcript +
            '<p class="speaking-report-privacy">Names are hidden according to this share\'s settings. People familiar with the discussion may still infer identity from its content.</p></article>';
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
