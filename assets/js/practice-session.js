(function(window, document) {
    'use strict';

    function storageGet(key) {
        try { return window.localStorage && window.localStorage.getItem(key); }
        catch (error) { return null; }
    }

    function storageSet(key, value) {
        try { if (window.localStorage) window.localStorage.setItem(key, value); }
        catch (error) { /* Navigation remains available when storage is restricted. */ }
    }

    function storageRemove(key) {
        try { if (window.localStorage) window.localStorage.removeItem(key); }
        catch (error) { /* Navigation remains available when storage is restricted. */ }
    }

    var params = new URLSearchParams(window.location.search);
    var visitor = params.get('visitor') === '1'
        || storageGet('mrcat_visitor') === 'true';
    var teacherMode = params.get('teacher') === '1';
    var profile = null;
    var leaveDialogOpener = null;
    var leaveDialogScrollY = 0;

    window.addEventListener('pageshow', function(event) {
        if (!event.persisted) return;
        document.querySelectorAll('.mrcat-back-modal.show,.mrcat-visitor-modal.show').forEach(function(modal) {
            modal.classList.remove('show');
        });
        unlockLeaveDialogBackground();
        leaveDialogOpener = null;
    });

    try {
        profile = JSON.parse(storageGet('mrcat_student_profile') || 'null');
    } catch (error) {
        profile = null;
    }

    if (visitor) {
        storageSet('mrcat_visitor', 'true');
        storageRemove('opencode_user');
        storageSet('opencode_visitor', 'true');
    } else if (profile && profile.student_id) {
        storageSet('opencode_user', profile.student_id);
        storageRemove('opencode_visitor');
    }

    function addStyles() {
        var style = document.createElement('style');
        style.textContent =
            '.mrcat-practice-nav{position:fixed;z-index:9990;left:14px;bottom:14px;display:flex;gap:8px;align-items:center}' +
            '.mrcat-practice-nav button{min-height:38px;padding:0 14px;border:1px solid rgba(15,118,110,.22);border-radius:999px;color:#0f5f57;background:rgba(255,255,255,.94);box-shadow:0 10px 28px rgba(15,76,71,.16);font:800 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;text-decoration:none;backdrop-filter:blur(12px);cursor:pointer}' +
            '.mrcat-practice-nav button:hover{color:#0b4f49;border-color:rgba(15,118,110,.36);transform:translateY(-1px)}' +
            '.mrcat-back-modal{position:fixed;z-index:10001;inset:0;display:none;place-items:center;padding:max(18px,env(safe-area-inset-top)) 18px max(18px,env(safe-area-inset-bottom));background:rgba(17,38,34,.3);-webkit-backdrop-filter:blur(8px) saturate(118%);backdrop-filter:blur(8px) saturate(118%)}' +
            '.mrcat-back-modal.show{display:grid}.mrcat-back-box{width:min(320px,calc(100% - 32px));overflow:hidden;border:1px solid rgba(255,255,255,.88);border-radius:22px;color:#18312b;background:rgba(247,249,248,.82);-webkit-backdrop-filter:blur(32px) saturate(165%);backdrop-filter:blur(32px) saturate(165%);box-shadow:0 22px 64px rgba(20,54,47,.24),0 2px 8px rgba(20,54,47,.08);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;animation:mrcat-alert-materialize 260ms cubic-bezier(.2,.8,.2,1) both}' +
            '.mrcat-back-copy{padding:24px 22px 20px;text-align:center}.mrcat-back-box h2{margin:0;color:#18312b;font-size:1.2rem;line-height:1.25;letter-spacing:-.018em}.mrcat-back-box p{max-width:270px;margin:8px auto 0;color:#697b76;font-size:.88rem;line-height:1.45}.mrcat-back-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));border-top:.5px solid rgba(24,49,43,.16)}' +
            '.mrcat-back-actions button{min-height:48px;padding:0 10px;border:0;border-radius:0;background:transparent;box-shadow:none;font:650 .93rem -apple-system,BlinkMacSystemFont,"SF Pro Text","Segoe UI",sans-serif;transition:background 100ms ease-out,opacity 100ms ease-out,transform 100ms ease-out}.mrcat-back-actions button+button{border-left:.5px solid rgba(24,49,43,.16)}' +
            '.mrcat-back-confirm{color:#c9403a}.mrcat-back-cancel{color:#0f766e}.mrcat-back-actions button:hover{background:rgba(24,49,43,.06)}.mrcat-back-actions button:active{transform:scale(.98);background:rgba(24,49,43,.1)}.mrcat-back-actions button:focus-visible{position:relative;z-index:1;outline:3px solid rgba(15,118,110,.26);outline-offset:-3px}' +
            '@keyframes mrcat-alert-materialize{from{opacity:0;transform:scale(.965);filter:blur(4px)}to{opacity:1;transform:scale(1);filter:blur(0)}}@keyframes mrcat-alert-fade{from{opacity:0}to{opacity:1}}' +
            '@media(prefers-reduced-motion:reduce){.mrcat-back-box{animation:mrcat-alert-fade 160ms ease-out both;transform:none!important;filter:none!important}.mrcat-back-actions button{transition:background 100ms ease-out,opacity 100ms ease-out}}' +
            '@media(prefers-reduced-transparency:reduce){.mrcat-back-modal{background:rgba(17,38,34,.52);-webkit-backdrop-filter:none;backdrop-filter:none}.mrcat-back-box{background:#f9fbfa;-webkit-backdrop-filter:none;backdrop-filter:none}}' +
            '@media(prefers-contrast:more){.mrcat-back-box{border-color:#56746c;background:#fff}.mrcat-back-actions{border-top-color:#56746c}.mrcat-back-actions button+button{border-left-color:#56746c}}' +
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
        modal.innerHTML =
            '<div class="mrcat-back-box">' +
                '<div class="mrcat-back-copy">' +
                    '<h2 id="mrcat-leave-title">Leave this page?</h2>' +
                    '<p id="mrcat-leave-copy">Unsaved answers on this page may be lost.</p>' +
                '</div>' +
                '<div class="mrcat-back-actions">' +
                    '<button class="mrcat-back-cancel" type="button">Cancel</button>' +
                    '<button class="mrcat-back-confirm" type="button">Back</button>' +
                '</div>' +
            '</div>';
        var box = modal.querySelector('.mrcat-back-box');
        box.setAttribute('role', 'alertdialog');
        box.setAttribute('aria-modal', 'true');
        box.setAttribute('aria-labelledby', 'mrcat-leave-title');
        box.setAttribute('aria-describedby', 'mrcat-leave-copy');
        modal.querySelector('.mrcat-back-confirm').addEventListener('click', function() {
            var action = modal.getAttribute('data-leave-action');
            if (action === 'home') goHome();
            else goBack();
        });
        modal.querySelector('.mrcat-back-cancel').addEventListener('click', function() {
            closeLeaveModal(modal);
        });
        modal.addEventListener('keydown', function(event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeLeaveModal(modal);
                return;
            }
            if (event.key !== 'Tab') return;
            var controls = Array.prototype.slice.call(modal.querySelectorAll('button:not([disabled])'));
            if (!controls.length) return;
            var first = controls[0];
            var last = controls[controls.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        document.body.appendChild(modal);
        return modal;
    }

    function lockLeaveDialogBackground() {
        if (document.documentElement.classList.contains('mrcat-leave-locked')) return;
        leaveDialogScrollY = window.scrollY || 0;
        document.documentElement.classList.add('mrcat-leave-locked');
        document.documentElement.style.overflow = 'hidden';
        document.body.style.position = 'fixed';
        document.body.style.top = (-leaveDialogScrollY) + 'px';
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
    }

    function unlockLeaveDialogBackground() {
        if (!document.documentElement.classList.contains('mrcat-leave-locked')) return;
        document.documentElement.classList.remove('mrcat-leave-locked');
        document.documentElement.style.overflow = '';
        document.body.style.position = '';
        document.body.style.top = '';
        document.body.style.left = '';
        document.body.style.right = '';
        document.body.style.width = '';
        window.scrollTo(0, leaveDialogScrollY);
    }

    function closeLeaveModal(modal) {
        modal.classList.remove('show');
        unlockLeaveDialogBackground();
        if (leaveDialogOpener && leaveDialogOpener.focus) leaveDialogOpener.focus({ preventScroll: true });
        leaveDialogOpener = null;
    }

    function showLeaveModal(action, label, copy) {
        var modal = document.querySelector('.mrcat-back-modal') || buildBackModal();
        leaveDialogOpener = document.activeElement;
        modal.setAttribute('data-leave-action', action);
        var title = modal.querySelector('#mrcat-leave-title');
        var text = modal.querySelector('#mrcat-leave-copy');
        var confirm = modal.querySelector('.mrcat-back-confirm');
        if (title) title.textContent = 'Leave this page?';
        if (text) text.textContent = copy;
        if (confirm) confirm.textContent = label;
        lockLeaveDialogBackground();
        modal.classList.add('show');
        window.requestAnimationFrame(function() {
            var cancel = modal.querySelector('.mrcat-back-cancel');
            if (cancel) cancel.focus({ preventScroll: true });
        });
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
