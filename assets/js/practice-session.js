(function(window, document) {
    'use strict';

    var visitor = new URLSearchParams(window.location.search).get('visitor') === '1'
        || localStorage.getItem('mrcat_visitor') === 'true';
    var profile = null;

    window.addEventListener('pageshow', function(event) {
        if (event.persisted) window.location.reload();
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
            '.mrcat-back{position:fixed;z-index:9990;left:14px;bottom:14px;padding:10px 14px;border:1px solid rgba(15,118,110,.22);border-radius:999px;color:#0f5f57;background:rgba(255,255,255,.94);box-shadow:0 10px 28px rgba(15,76,71,.16);font:800 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-decoration:none;backdrop-filter:blur(12px)}' +
            '.mrcat-visitor-modal{position:fixed;z-index:10000;inset:0;display:none;place-items:center;padding:20px;background:rgba(10,35,32,.48);backdrop-filter:blur(7px)}' +
            '.mrcat-visitor-modal.show{display:grid}.mrcat-visitor-box{width:min(390px,100%);padding:26px;border-radius:22px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.22);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
            '.mrcat-visitor-box h2{margin:0 0 8px;color:#18332f;font-size:1.35rem}.mrcat-visitor-box p{margin:0 0 20px;color:#647b75;line-height:1.55}.mrcat-visitor-actions{display:grid;gap:9px}.mrcat-visitor-actions button{min-height:44px;border-radius:12px;font-weight:800}' +
            '.mrcat-login-action{border:0;color:#fff;background:#13766d}.mrcat-continue-action{border:1px solid #dce8e3;color:#18332f;background:#fff}' +
            '.mrcat-argue-panel{position:fixed;z-index:9992;right:16px;bottom:72px;width:min(420px,calc(100% - 32px));max-height:min(620px,72vh);overflow:auto;padding:18px;border:1px solid #dce8e3;border-radius:20px;background:rgba(255,255,255,.98);box-shadow:0 22px 70px rgba(10,52,47,.22);font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}' +
            '.mrcat-argue-panel h2{margin:0;color:#18332f;font-size:1.15rem}.mrcat-argue-panel>p{margin:6px 0 14px;color:#647b75;line-height:1.45}.mrcat-argue-close{position:absolute;right:12px;top:10px;border:0;background:transparent;color:#647b75;font-size:20px}' +
            '.mrcat-argue-item{padding:12px 0;border-top:1px solid #e6efeb}.mrcat-argue-item strong,.mrcat-argue-item small{display:block}.mrcat-argue-item small{margin-top:4px;color:#647b75}.mrcat-argue-item textarea{width:100%;min-height:66px;margin:9px 0;padding:9px;border:1px solid #dce8e3;border-radius:10px;resize:vertical}.mrcat-argue-item button{min-height:36px;padding:0 13px;border:0;border-radius:10px;color:#fff;background:#13766d;font-weight:800}.mrcat-argue-item button:disabled{opacity:.55}';
        document.head.appendChild(style);
    }

    function addBackLink() {
        var link = document.createElement('a');
        link.className = 'mrcat-back';
        link.href = 'dashboard.html';
        link.textContent = 'Back to Dashboard';
        document.body.appendChild(link);
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
        addBackLink();
        if (visitor) installVisitorGuard(buildVisitorModal());
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.MrCatPractice = {
        isVisitor: function() { return visitor; },
        profile: profile
    };
})(window, document);
