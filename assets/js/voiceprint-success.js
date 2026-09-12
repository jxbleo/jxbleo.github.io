(function () {
    'use strict';
    var activeDialog = null;

    function lockBackground() {
        // Teacher owns a shared lock across all modal layers, including this one.
        if (document.body.classList.contains('teacher-page')) return function () {};
        var body = document.body, root = document.documentElement;
        var x = window.scrollX, y = window.scrollY;
        var properties = ['position', 'top', 'left', 'width', 'overflow'];
        var before = properties.map(function (key) { return body.style[key]; });
        var rootOverflow = root.style.overflow;
        body.style.position = 'fixed';
        body.style.top = -y + 'px';
        body.style.left = -x + 'px';
        body.style.width = '100%';
        body.style.overflow = 'hidden';
        root.style.overflow = 'hidden';
        return function () {
            properties.forEach(function (key, index) { body.style[key] = before[index]; });
            root.style.overflow = rootOverflow;
            window.scrollTo(x, y);
        };
    }

    function show(options) {
        if (activeDialog) return;
        options = options || {};
        var previousFocus = document.activeElement;
        var dialog = document.createElement('dialog');
        if (typeof dialog.showModal !== 'function') return;
        dialog.className = 'speaking-dialog voiceprint-success';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'voiceprint-success-title');
        dialog.setAttribute('aria-describedby', 'voiceprint-success-description');
        dialog.innerHTML = '<div class="success-symbol" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="m7 16 6 6L25 10"/></svg></div>' +
            '<h2 id="voiceprint-success-title">Voiceprint recorded</h2>' +
            '<p id="voiceprint-success-description">Your voiceprint has been saved successfully.</p>' +
            '<form method="dialog"><button class="primary-button success-done" autofocus>Done</button></form>';
        var unlock = lockBackground();
        activeDialog = dialog;
        dialog.addEventListener('close', function () {
            dialog.remove();
            activeDialog = null;
            unlock();
            window.requestAnimationFrame(function () {
                if (activeDialog) return;
                var target = options.returnFocus ? options.returnFocus() : previousFocus;
                if (target && target.isConnected && !target.disabled) target.focus({ preventScroll: true });
            });
        }, { once: true });
        document.body.appendChild(dialog);
        dialog.showModal();
    }

    window.MrCatVoiceprintSuccess = { show: show };
})();
