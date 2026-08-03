(function(window, document) {
    'use strict';

    var params = new URLSearchParams(window.location.search);
    var visitor = params.get('visitor') === '1'
        || localStorage.getItem('mrcat_visitor') === 'true';
    var teacherMode = params.get('teacher') === '1';
    var bbcPractice = /(?:^|\/)bbc\.html$/.test(window.location.pathname);
    var profile = null;

    window.addEventListener('pageshow', function(event) {
        if (!event.persisted) return;
        document.querySelectorAll('.mrcat-back-modal.show,.mrcat-visitor-modal.show').forEach(function(modal) {
            modal.classList.remove('show');
        });
    });

    try {
        profile = JSON.parse(localStorage.getItem('mrcat_student_profile') || 'null');
    } catch (error) {
        profile = null;
    }

    if (visitor) {
        localStorage.setItem('mrcat_visitor', 'true');
        localStorage.removeItem('opencode_user');
        localStorage.setItem('opencode_visitor', 'true');
    } else if (profile && profile.student_id) {
        localStorage.setItem('opencode_user', profile.student_id);
        localStorage.removeItem('opencode_visitor');
    }

    function addStyles() {
        var style = document.createElement('style');
        style.textContent =
            '.mrcat-practice-nav{position:fixed;z-index:9990;left:14px;bottom:14px;display:flex;gap:8px;align-items:center}' +
            '.mrcat-practice-nav button{min-height:38px;padding:0 14px;border:1px solid rgba(15,118,110,.22);border-radius:999px;color:#0f5f57;background:rgba(255,255,255,.94);box-shadow:0 10px 28px rgba(15,76,71,.16);font:800 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-decoration:none;backdrop-filter:blur(12px);cursor:pointer}' +
            '.mrcat-practice-nav button:hover{color:#0b4f49;border-color:rgba(15,118,110,.36);transform:translateY(-1px)}' +
            '.mrcat-back-modal{position:fixed;z-index:10001;inset:0;display:none;place-items:center;padding:20px;background:rgba(10,35,32,.48);backdrop-filter:blur(7px)}' +
            '.mrcat-back-modal.show{display:grid}.mrcat-back-box{width:min(390px,100%);padding:26px;border-radius:22px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.22);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
            '.mrcat-back-box h2{margin:0 0 8px;color:#18332f;font-size:1.35rem}.mrcat-back-box p{margin:0 0 20px;color:#647b75;line-height:1.55}.mrcat-back-actions{display:grid;gap:9px}.mrcat-back-actions button{min-height:44px;border-radius:12px;font-weight:800}' +
            '.mrcat-back-confirm{border:0;color:#fff;background:#13766d}.mrcat-back-cancel{border:1px solid #dce8e3;color:#18332f;background:#fff}' +
            '.mrcat-bbc-leave-modal .mrcat-back-dialog{display:grid;gap:12px;width:min(390px,100%)}' +
            '.mrcat-bbc-leave-modal .mrcat-back-box{box-sizing:border-box;width:100%}' +
            '.mrcat-bbc-leave-modal .mrcat-back-close{justify-self:center;min-width:112px;min-height:42px;padding:0 22px;border:1px solid rgba(255,255,255,.7);border-radius:999px;color:#18332f;background:rgba(255,255,255,.96);box-shadow:0 12px 30px rgba(0,0,0,.18);font:800 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}' +
            '.mrcat-bbc-leave-modal .mrcat-back-close:hover{transform:translateY(-1px);background:#fff}' +
            '.mrcat-visitor-modal{position:fixed;z-index:10000;inset:0;display:none;place-items:center;padding:20px;background:rgba(10,35,32,.48);backdrop-filter:blur(7px)}' +
            '.mrcat-visitor-modal.show{display:grid}.mrcat-visitor-box{width:min(390px,100%);padding:26px;border-radius:22px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.22);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
            '.mrcat-visitor-box h2{margin:0 0 8px;color:#18332f;font-size:1.35rem}.mrcat-visitor-box p{margin:0 0 20px;color:#647b75;line-height:1.55}.mrcat-visitor-actions{display:grid;gap:9px}.mrcat-visitor-actions button{min-height:44px;border-radius:12px;font-weight:800}' +
            '.mrcat-login-action{border:0;color:#fff;background:#13766d}.mrcat-continue-action{border:1px solid #dce8e3;color:#18332f;background:#fff}' +
            '.mrcat-argue-panel{position:fixed;z-index:9992;right:16px;bottom:72px;width:min(420px,calc(100% - 32px));max-height:min(620px,72vh);overflow:auto;padding:18px;border:1px solid #dce8e3;border-radius:20px;background:rgba(255,255,255,.98);box-shadow:0 22px 70px rgba(10,52,47,.22);font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
            '.mrcat-argue-panel h2{margin:0;color:#18332f;font-size:1.15rem}.mrcat-argue-panel>p{margin:6px 0 14px;color:#647b75;line-height:1.45}.mrcat-argue-close{position:absolute;right:12px;top:10px;border:0;background:transparent;color:#647b75;font-size:20px}' +
            '.mrcat-argue-item{padding:12px 0;border-top:1px solid #e6efeb}.mrcat-argue-item strong,.mrcat-argue-item small{display:block}.mrcat-argue-item small{margin-top:4px;color:#647b75}.mrcat-argue-item textarea{width:100%;min-height:66px;margin:9px 0;padding:9px;border:1px solid #dce8e3;border-radius:10px;resize:vertical}.mrcat-argue-item button{min-height:36px;padding:0 13px;border:0;border-radius:10px;color:#fff;background:#13766d;font-weight:800}.mrcat-argue-item button:disabled{opacity:.55}';
        document.head.appendChild(style);
    }

    function safeLocalUrl(value) {
        if (!value) return '';
        try {
            var url = new URL(value, window.location.href);
            if (url.origin !== window.location.origin) return '';
            return url.href;
        } catch (error) {
            return '';
        }
    }

    function samePage(url) {
        if (!url) return false;
        try {
            var target = new URL(url, window.location.href);
            return target.origin === window.location.origin
                && target.pathname === window.location.pathname
                && target.search === window.location.search;
        } catch (error) {
            return false;
        }
    }

    function homeUrl() {
        return teacherMode ? 'teacher.html?view=library' : 'dashboard.html';
    }

    function returnUrl() {
        var explicit = safeLocalUrl(params.get('return'));
        if (explicit && !samePage(explicit)) return explicit;
        var referrer = safeLocalUrl(document.referrer);
        if (referrer && !samePage(referrer)) return referrer;
        return homeUrl();
    }

    function addPracticeNav() {
        if (document.body && document.body.getAttribute('data-practice-nav') === 'manual') return;
        if (document.getElementById('mrcat-practice-nav')) return;
        var nav = document.createElement('nav');
        nav.className = 'mrcat-practice-nav';
        nav.id = 'mrcat-practice-nav';
        nav.setAttribute('aria-label', 'Practice navigation');
        nav.innerHTML =
            '<button class="mrcat-back" type="button" aria-label="Back">Back</button>' +
            '<button class="mrcat-home" type="button" aria-label="Home">Home</button>';
        nav.querySelector('.mrcat-back').addEventListener('click', function(event) {
            event.preventDefault();
            confirmBack();
        });
        nav.querySelector('.mrcat-home').addEventListener('click', function(event) {
            event.preventDefault();
            confirmHome();
        });
        document.body.appendChild(nav);
    }

    function goTo(url) {
        document.querySelectorAll('.mrcat-back-modal.show').forEach(function(modal) {
            modal.classList.remove('show');
        });
        window.location.href = url;
    }

    function canReturnThroughHistory(targetUrl) {
        if (!window.history || typeof window.history.back !== 'function' || window.history.length <= 1) return false;
        var referrer = safeLocalUrl(document.referrer);
        if (!referrer || samePage(referrer)) return false;
        try {
            var expected = new URL(targetUrl, window.location.href);
            var previous = new URL(referrer, window.location.href);
            return previous.origin === expected.origin && previous.pathname === expected.pathname;
        } catch (error) {
            return false;
        }
    }

    function goBack() {
        var target = returnUrl();
        document.querySelectorAll('.mrcat-back-modal.show').forEach(function(modal) {
            modal.classList.remove('show');
        });
        if (canReturnThroughHistory(target)) {
            window.history.back();
            return;
        }
        window.location.href = target;
    }

    function goHome() {
        goTo(homeUrl());
    }

    function buildBackModal() {
        var modal = document.createElement('div');
        modal.className = 'mrcat-back-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        if (bbcPractice) {
            modal.classList.add('mrcat-bbc-leave-modal');
            modal.innerHTML =
                '<div class="mrcat-back-dialog">' +
                    '<div class="mrcat-back-box">' +
                        '<h2 id="mrcat-leave-title">Leave this page?</h2>' +
                        '<p id="mrcat-leave-copy">Unsaved answers on this page may be lost.</p>' +
                        '<div class="mrcat-back-actions">' +
                            '<button class="mrcat-back-confirm" type="button">Back</button>' +
                        '</div>' +
                    '</div>' +
                    '<button class="mrcat-back-cancel mrcat-back-close" type="button">Close</button>' +
                '</div>';
        } else {
            modal.innerHTML =
            '<div class="mrcat-back-box">' +
                '<h2 id="mrcat-leave-title">Leave this page?</h2>' +
                '<p id="mrcat-leave-copy">Unsaved answers on this page may be lost.</p>' +
                '<div class="mrcat-back-actions">' +
                    '<button class="mrcat-back-confirm" type="button">Back</button>' +
                    '<button class="mrcat-back-cancel" type="button">Stay here</button>' +
                '</div>' +
            '</div>';
        }
        modal.querySelector('.mrcat-back-confirm').addEventListener('click', function() {
            var action = modal.getAttribute('data-leave-action');
            if (action === 'home') goHome();
            else goBack();
        });
        modal.querySelector('.mrcat-back-cancel').addEventListener('click', function() {
            modal.classList.remove('show');
        });
        document.body.appendChild(modal);
        return modal;
    }

    function showLeaveModal(action, label, copy) {
        var modal = document.querySelector('.mrcat-back-modal') || buildBackModal();
        modal.setAttribute('data-leave-action', action);
        var title = modal.querySelector('#mrcat-leave-title');
        var text = modal.querySelector('#mrcat-leave-copy');
        var confirm = modal.querySelector('.mrcat-back-confirm');
        if (title) title.textContent = 'Leave this page?';
        if (text) text.textContent = copy;
        if (confirm) confirm.textContent = label;
        modal.classList.add('show');
    }

    function confirmBack() {
        showLeaveModal('back', 'Back', 'You will return to the page that opened this practice. Unsaved answers on this page may be lost.');
    }

    function confirmHome() {
        showLeaveModal('home', 'Home', 'You will go to your main learning page. Unsaved answers on this page may be lost.');
    }

    function buildVisitorModal() {
        var modal = document.createElement('div');
        modal.className = 'mrcat-visitor-modal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.innerHTML =
            '<div class="mrcat-visitor-box">' +
                '<h2>Log in to answer</h2>' +
                '<p>Visitor Mode lets you browse resources, but answers and submissions are not available.</p>' +
                '<div class="mrcat-visitor-actions">' +
                    '<button class="mrcat-login-action" type="button">Log In</button>' +
                    '<button class="mrcat-continue-action" type="button">Continue as Visitor</button>' +
                '</div>' +
            '</div>';
        modal.querySelector('.mrcat-login-action').addEventListener('click', function() {
            window.location.href = 'index.html';
        });
        modal.querySelector('.mrcat-continue-action').addEventListener('click', function() {
            modal.classList.remove('show');
        });
        document.body.appendChild(modal);
        return modal;
    }

    function isAnswerControl(target) {
        if (!target || !target.closest) return false;
        var control = target.closest('input, select, textarea, button');
        if (!control) return false;
        if (control.closest('.mrcat-visitor-modal')) return false;
        if (control.id === 'exam-review-checkbox' || control.id === 'review-checkbox') return false;
        if (control.type === 'button' && (
            control.id.indexOf('play') !== -1
            || control.id.indexOf('back') !== -1
            || control.classList.contains('font-btn')
            || control.classList.contains('switch-btn')
            || control.id === 'start-test-btn'
            || control.id === 'dictation-build-btn'
        )) return false;
        return control.matches('input, select, textarea')
            || /submit|check|answer/i.test(control.id + ' ' + control.className + ' ' + control.textContent);
    }

    function installVisitorGuard(modal) {
        function block(event) {
            if (!isAnswerControl(event.target)) return;
            event.preventDefault();
            event.stopImmediatePropagation();
            if (event.target.blur) event.target.blur();
            modal.classList.add('show');
        }
        document.addEventListener('pointerdown', block, true);
        document.addEventListener('keydown', function(event) {
            if (!isAnswerControl(event.target)) return;
            block(event);
        }, true);
        document.addEventListener('change', block, true);
    }

    function init() {
        addStyles();
        addPracticeNav();
        if (visitor) installVisitorGuard(buildVisitorModal());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.MrCatPractice = {
        isVisitor: function() { return visitor; },
        profile: profile,
        confirmBack: confirmBack,
        confirmHome: confirmHome,
        goBack: goBack,
        goHome: goHome,
        returnUrl: returnUrl,
        homeUrl: homeUrl
    };
})(window, document);
