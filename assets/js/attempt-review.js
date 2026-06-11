(function() {
    'use strict';

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    var attemptId = new URLSearchParams(window.location.search).get('attempt');
    var title = document.getElementById('review-title');
    var summary = document.getElementById('review-summary');
    var list = document.getElementById('review-list');

    window.MrCatAuth.getSession().then(function(session) {
        if (session.mode !== 'student') {
            window.location.replace('index.html');
            return null;
        }
        if (!attemptId) throw new Error('Attempt not specified.');
        return window.MrCatCloud.callFunction('getDashboard', {
            action: 'getAttemptReview',
            attempt_id: attemptId
        });
    }).then(function(result) {
        if (!result) return;
        if (!result.success) throw new Error(result.message || result.code || 'Unable to load this attempt.');
        var review = result.review;
        title.textContent = review.set_title;
        summary.textContent = 'Best score: ' + review.percentage +
            '%. This page shows only your original answers and whether each was correct.';
        list.innerHTML = (review.answers || []).map(function(item) {
            return '<article class="review-answer ' + (item.correct ? 'correct' : 'wrong') + '">' +
                '<span class="review-status">' + (item.correct ? 'Correct' : 'Incorrect') + '</span>' +
                '<h2>Question ' + escapeHtml(item.question_id) + '</h2>' +
                '<p>' + escapeHtml(item.submitted_answer || 'No answer') + '</p>' +
            '</article>';
        }).join('') || '<div class="empty-card">No answer details are available.</div>';
    }).catch(function(error) {
        title.textContent = 'Unable to load review';
        list.innerHTML = '<div class="empty-card">' + escapeHtml(error.message || 'Please return to Dashboard.') + '</div>';
    });
})();
