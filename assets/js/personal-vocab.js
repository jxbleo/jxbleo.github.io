(function(window, document) {
    'use strict';

    var dialog = null;
    var dialogSource = null;
    var returnFocus = null;
    var scrollLock = null;
    var saving = false;
    var selectionTimer = null;
    var mouseSelecting = false;
    var touchSelecting = false;
    var keyboardSelecting = false;
    var touchMoved = false;
    var touchSelectionChanged = false;
    var touchStart = null;
    var toast = null;
    var hideTimer = null;
    var BLOCKED_SELECTOR = [
        'input',
        'textarea',
        'select',
        'button',
        '[contenteditable="true"]',
        '.mrcat-vocab-dialog',
        '.mrcat-vocab-toast',
        '.mrcat-visitor-modal',
        '.password-dialog-overlay',
        '.teacher-replies-overlay',
        '.modal-overlay',
        '.login-modal',
        '.highlight-toolbar',
        '.teacher-argue-bar',
        '.teacher-reply-item',
        '.dispute-comparison'
    ].join(', ');

    function compactText(value, limit) {
        return String(value == null ? '' : value)
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, limit);
    }

    function hasWordCharacter(value) {
        return /[\p{L}\p{N}]/u.test(value);
    }

    function isTeacherMode() {
        return new URLSearchParams(window.location.search).get('teacher') === '1'
            || document.body.classList.contains('teacher-page');
    }

    function isVisitorMode() {
        return new URLSearchParams(window.location.search).get('visitor') === '1'
            || localStorage.getItem('mrcat_visitor') === 'true'
            || localStorage.getItem('opencode_visitor') === 'true'
            || Boolean(window.MrCatPractice
                && window.MrCatPractice.isVisitor
                && window.MrCatPractice.isVisitor());
    }

    function elementForNode(node) {
        return node && (node.nodeType === 1 ? node : node.parentElement);
    }

    function isBlockedNode(node) {
        var element = elementForNode(node);
        if (!element || !element.closest) return true;
        if (element.closest('button:disabled')) return false;
        return Boolean(element.closest(BLOCKED_SELECTOR));
    }

    function rangeTouchesBlockedContent(range) {
        if (!range || typeof range.intersectsNode !== 'function') return false;
        var root = elementForNode(range.commonAncestorContainer) || document.body;
        var scope = root.querySelectorAll ? root : document.body;
        var blocked = scope.querySelectorAll(BLOCKED_SELECTOR);
        for (var i = 0; i < blocked.length; i += 1) {
            if (range.intersectsNode(blocked[i])) return true;
        }
        return false;
    }

    function selectedRange() {
        var selection = window.getSelection && window.getSelection();
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
        if (isBlockedNode(selection.anchorNode) || isBlockedNode(selection.focusNode)) return null;
        var range = selection.getRangeAt(0);
        if (rangeTouchesBlockedContent(range)) return null;
        return range;
    }

    function selectedTextError(text) {
        if (!text) return 'Select a word or short phrase first.';
        if (!hasWordCharacter(text)) return 'Select a word or phrase with letters or numbers.';
        if (text.length > 120 || text.split(/\s+/).filter(Boolean).length > 16) {
            return 'Save one word or short phrase at a time.';
        }
        return '';
    }

    function textForRange(range, limit) {
        if (!range || typeof range.cloneContents !== 'function') {
            var fallbackSelection = window.getSelection && window.getSelection();
            return compactText(fallbackSelection ? fallbackSelection.toString() : '', limit);
        }
        try {
            var fragment = range.cloneContents();
            if (fragment.querySelectorAll) {
                fragment.querySelectorAll('[data-mrcat-vocab-ignore]').forEach(function(node) {
                    node.remove();
                });
            }
            return compactText(fragment.textContent || '', limit);
        } catch (error) {
            var currentSelection = window.getSelection && window.getSelection();
            return compactText(currentSelection ? currentSelection.toString() : '', limit);
        }
    }

    function contextForRange(range, text) {
        var node = range.commonAncestorContainer;
        var element = node && (node.nodeType === 1 ? node : node.parentElement);
        var container = element && element.closest && element.closest('p, li, td, th, article, section, blockquote, div');
        var full = compactText(container && container.textContent || element && element.textContent || '', 1200);
        if (!full) return '';
        var index = full.toLowerCase().indexOf(text.toLowerCase());
        if (index === -1) return compactText(full, 320);
        var start = Math.max(0, index - 120);
        var end = Math.min(full.length, index + text.length + 120);
        return compactText(full.slice(start, end), 320);
    }

    function sourceSetId() {
        return compactText(new URLSearchParams(window.location.search).get('set') || '', 80);
    }

    function sourceTitle() {
        var titleEl = document.querySelector('[data-lesson-title], .lesson-title, .exam-title, h1');
        return compactText(titleEl && titleEl.textContent || document.title || '', 160);
    }

    function sourcePath() {
        var url = new URL(window.location.href);
        var name = url.pathname.split('/').filter(Boolean).pop() || 'index.html';
        var set = url.searchParams.get('set');
        return set ? name + '?set=' + encodeURIComponent(set) : name;
    }

    function ensureStyles() {
        if (document.getElementById('mrcat-vocab-style')) return;
        var style = document.createElement('style');
        style.id = 'mrcat-vocab-style';
        style.textContent =
            '[data-mrcat-vocab-ignore]{-webkit-user-select:none;user-select:none}' +
            '.mrcat-vocab-dialog{position:fixed;inset:auto;left:50%;top:50%;transform:translate(-50%,-50%);width:min(430px,calc(100vw - 32px));max-width:none;max-height:calc(var(--mrcat-vocab-viewport-height,100dvh) - 32px);margin:0;padding:0;border:0;background:transparent;color:#18332f;font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;overflow:visible;outline:none}' +
            '.mrcat-vocab-dialog:not([open]){display:none}.mrcat-vocab-dialog[open]{display:grid;gap:11px;justify-items:stretch}' +
            '.mrcat-vocab-dialog::backdrop{background:rgba(26,57,50,.2);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px)}' +
            '.mrcat-vocab-dialog *{box-sizing:border-box}.mrcat-vocab-card{min-height:0;max-height:calc(var(--mrcat-vocab-viewport-height,100dvh) - 100px - env(safe-area-inset-top,0px) - env(safe-area-inset-bottom,0px));overflow:auto;overscroll-behavior:contain;padding:24px;border:1px solid rgba(255,255,255,.88);border-radius:26px;background:rgba(248,251,249,.76);box-shadow:0 24px 80px rgba(20,54,47,.24),0 3px 12px rgba(20,54,47,.08);-webkit-backdrop-filter:blur(30px) saturate(160%);backdrop-filter:blur(30px) saturate(160%);outline:none}' +
            '.mrcat-vocab-title{margin:0 0 18px;text-align:center;color:#0d5d56;font-size:12px;font-weight:850;letter-spacing:.1em;text-transform:uppercase}.mrcat-vocab-form{display:grid;gap:10px;margin:0}.mrcat-vocab-form label{display:grid;gap:6px}.mrcat-vocab-form label>span{color:#647b75;font-size:13px;font-weight:800}.mrcat-vocab-form small{margin-left:4px;font-size:11px;font-weight:650}' +
            '.mrcat-vocab-form input{display:block;min-width:0;width:100%;min-height:46px;padding:0 13px;border:1px solid #dce8e3;border-radius:12px;color:#18332f;background:#fff;font:inherit;font-size:16px;line-height:1.35}.mrcat-vocab-form input:focus{border-color:#13766d;box-shadow:0 0 0 4px rgba(19,118,109,.1);outline:none}.mrcat-vocab-status{min-height:1.2em;margin:0 2px;color:#b54747;font-size:12px;line-height:1.4}' +
            '.mrcat-vocab-dialog button{min-height:44px;border-radius:999px;font:inherit;font-size:13px;font-weight:800;cursor:pointer;touch-action:manipulation}.mrcat-vocab-confirm{justify-self:center;width:min(240px,100%);margin-top:4px;padding:10px 20px;border:1px solid #13766d;color:#fff;background:#13766d;box-shadow:0 8px 18px rgba(19,118,109,.18)}.mrcat-vocab-close{justify-self:center;width:132px;padding:0 22px;border:1px solid rgba(255,255,255,.84);color:#36574f;background:rgba(255,255,255,.9);box-shadow:0 10px 28px rgba(20,54,47,.16);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px)}' +
            '.mrcat-vocab-dialog button:active{transform:scale(.97)}.mrcat-vocab-dialog button:focus-visible{outline:3px solid #13766d;outline-offset:3px}.mrcat-vocab-dialog button:disabled{opacity:.56;cursor:wait}.mrcat-vocab-dialog[open]>.mrcat-vocab-card{animation:mrcat-vocab-enter 180ms ease-out}@keyframes mrcat-vocab-enter{from{opacity:0;transform:translateY(14px) scale(.96)}to{opacity:1;transform:none}}' +
            '.mrcat-vocab-toast{position:fixed;z-index:10021;left:50%;bottom:max(24px,env(safe-area-inset-bottom));max-width:min(420px,calc(100% - 32px));padding:12px 15px;border:1px solid rgba(19,118,109,.16);border-radius:14px;color:#18332f;background:rgba(255,255,255,.97);box-shadow:0 18px 52px rgba(10,52,47,.18);font:800 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:0;transform:translate(-50%,12px);transition:opacity 160ms ease,transform 160ms ease;pointer-events:none}.mrcat-vocab-toast.show{opacity:1;transform:translate(-50%,0)}' +
            '@media (prefers-reduced-motion:reduce){.mrcat-vocab-dialog[open]>.mrcat-vocab-card{animation:none}.mrcat-vocab-dialog button:active{transform:none}.mrcat-vocab-toast{transition:opacity 120ms linear;transform:translateX(-50%)}}' +
            '@media (prefers-reduced-transparency:reduce),(prefers-contrast:more){.mrcat-vocab-card,.mrcat-vocab-close{background:#f8fbf9;backdrop-filter:none;-webkit-backdrop-filter:none}.mrcat-vocab-card{border-color:#647b75}}';
        document.head.appendChild(style);
    }

    function ensureDialog() {
        if (dialog) return dialog;
        ensureStyles();
        dialog = document.createElement('dialog');
        dialog.className = 'mrcat-vocab-dialog';
        dialog.setAttribute('aria-labelledby', 'mrcat-vocab-title');
        dialog.innerHTML = '<section class="mrcat-vocab-card" tabindex="-1" autofocus>' +
            '<h2 class="mrcat-vocab-title" id="mrcat-vocab-title">Add to My Words</h2>' +
            '<form class="mrcat-vocab-form">' +
                '<label for="mrcat-vocab-text"><span>Word or phrase</span>' +
                '<input id="mrcat-vocab-text" type="text" maxlength="120" autocomplete="off" required></label>' +
                '<label for="mrcat-vocab-context"><span>Context <small>Optional</small></span>' +
                '<input id="mrcat-vocab-context" type="text" maxlength="320" autocomplete="off"></label>' +
                '<p class="mrcat-vocab-status" role="status" aria-live="polite"></p>' +
                '<button class="mrcat-vocab-confirm" type="submit">Confirm</button>' +
            '</form></section>' +
            '<button class="mrcat-vocab-close" type="button">Close</button>';
        dialog.querySelector('form').addEventListener('submit', saveSelection);
        dialog.querySelector('.mrcat-vocab-close').addEventListener('click', closeDialog);
        dialog.addEventListener('cancel', function(event) {
            if (event.target !== dialog) return;
            event.preventDefault();
            closeDialog();
        });
        dialog.addEventListener('keydown', function(event) {
            if (event.key !== 'Tab') return;
            var controls = dialog.querySelectorAll('input:not(:disabled), button:not(:disabled)');
            var first = controls[0];
            var last = controls[controls.length - 1];
            if (!first) {
                event.preventDefault();
                dialog.querySelector('.mrcat-vocab-card').focus({ preventScroll: true });
            } else if (event.shiftKey && (document.activeElement === first
                || document.activeElement === dialog.querySelector('.mrcat-vocab-card'))) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        });
        dialog.addEventListener('close', function() {
            cancelSelectionCheck();
            unlockBackground();
            dialogSource = null;
            dialog.querySelector('form').reset();
            if (returnFocus && returnFocus.isConnected && typeof returnFocus.focus === 'function') {
                returnFocus.focus({ preventScroll: true });
            }
            returnFocus = null;
        });
        ['wheel', 'touchmove'].forEach(function(type) {
            dialog.addEventListener(type, function(event) {
                if (!dialog.querySelector('.mrcat-vocab-card').contains(event.target)) event.preventDefault();
            }, { passive: false });
        });
        document.body.appendChild(dialog);
        return dialog;
    }

    function lockBackground() {
        if (scrollLock) return;
        var body = document.body;
        var root = document.documentElement;
        scrollLock = { x: window.scrollX, y: window.scrollY, styles: [] };
        function setStyle(element, property, value) {
            scrollLock.styles.push([element, property, element.style.getPropertyValue(property), element.style.getPropertyPriority(property)]);
            element.style.setProperty(property, value);
        }
        setStyle(root, 'scroll-behavior', 'auto');
        setStyle(root, 'overflow', 'hidden');
        setStyle(body, 'position', 'fixed');
        setStyle(body, 'top', -scrollLock.y + 'px');
        setStyle(body, 'left', -scrollLock.x + 'px');
        setStyle(body, 'width', '100%');
        setStyle(body, 'overflow', 'hidden');
    }

    function unlockBackground() {
        if (!scrollLock) return;
        var lock = scrollLock;
        scrollLock = null;
        // Restore scroll-behavior last so a site's smooth scrolling cannot move the reading position.
        lock.styles.slice(1).forEach(function(saved) {
            saved[0].style.setProperty(saved[1], saved[2], saved[3]);
        });
        window.scrollTo(lock.x, lock.y);
        var saved = lock.styles[0];
        saved[0].style.setProperty(saved[1], saved[2], saved[3]);
    }

    function updateDialogViewport() {
        if (!dialog || !dialog.open) return;
        var viewport = window.visualViewport;
        var width = viewport ? viewport.width : window.innerWidth;
        var height = viewport ? viewport.height : window.innerHeight;
        dialog.style.left = ((viewport ? viewport.offsetLeft : 0) + width / 2) + 'px';
        dialog.style.top = ((viewport ? viewport.offsetTop : 0) + height / 2) + 'px';
        dialog.style.width = Math.min(430, Math.max(0, width - 32)) + 'px';
        dialog.style.setProperty('--mrcat-vocab-viewport-height', height + 'px');
    }

    function closeDialog() {
        if (!dialog || !dialog.open || saving) return;
        dialog.close();
    }

    function showToast(message) {
        ensureStyles();
        if (!toast) {
            toast = document.createElement('div');
            toast.className = 'mrcat-vocab-toast';
            toast.setAttribute('role', 'status');
            toast.setAttribute('aria-live', 'polite');
            document.body.appendChild(toast);
        }
        toast.textContent = message;
        toast.classList.add('show');
        window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(function() {
            toast.classList.remove('show');
        }, 2600);
    }

    function openDialogForSelection() {
        if (isTeacherMode() || mouseSelecting || touchSelecting || keyboardSelecting || (dialog && dialog.open)) return;
        var range = selectedRange();
        if (!range) return;
        var text = textForRange(range, 140);
        if (selectedTextError(text)) return;
        var context = contextForRange(range, text);
        var modal = ensureDialog();
        if (typeof modal.showModal !== 'function') return;
        dialogSource = {
            source_set_id: sourceSetId(),
            source_title: sourceTitle(),
            source_path: sourcePath()
        };
        returnFocus = document.activeElement;
        modal.querySelector('#mrcat-vocab-text').value = text;
        modal.querySelector('#mrcat-vocab-context').value = context;
        modal.querySelector('.mrcat-vocab-status').textContent = '';
        // Capture first, then dismiss native selection before opening the independent form.
        // No long-press handler prevents the browser from determining the selected word.
        window.getSelection().removeAllRanges();
        cancelSelectionCheck();
        lockBackground();
        modal.showModal();
        updateDialogViewport();
        modal.querySelector('.mrcat-vocab-card').scrollTop = 0;
        modal.querySelector('.mrcat-vocab-card').focus({ preventScroll: true });
    }

    function saveSelection(event) {
        event.preventDefault();
        if (saving || !dialog || !dialog.open || !dialogSource) return;
        var input = dialog.querySelector('#mrcat-vocab-text');
        var text = compactText(input.value, 140);
        var status = dialog.querySelector('.mrcat-vocab-status');
        var validation = selectedTextError(text);
        if (validation) {
            status.textContent = validation;
            input.focus();
            return;
        }
        if (isTeacherMode() || isVisitorMode()) {
            status.textContent = 'Log in as a student to save words to your personal list.';
            return;
        }
        if (!window.MrCatCloud || typeof window.MrCatCloud.callFunction !== 'function') {
            status.textContent = 'Word saving is not available on this page yet.';
            return;
        }
        var payload = {
            action: 'add',
            text: text,
            source_set_id: dialogSource.source_set_id,
            source_title: dialogSource.source_title,
            source_path: dialogSource.source_path,
            context: compactText(dialog.querySelector('#mrcat-vocab-context').value, 320)
        };
        var submit = dialog.querySelector('.mrcat-vocab-confirm');
        saving = true;
        dialog.setAttribute('aria-busy', 'true');
        dialog.querySelectorAll('input, button').forEach(function(control) { control.disabled = true; });
        submit.textContent = 'Adding…';
        status.textContent = '';
        Promise.resolve().then(function() {
            return window.MrCatCloud.callFunction('studentVocabulary', payload);
        }).then(function(result) {
            if (!result || !result.success || !result.word) throw new Error(result && result.message || 'Unable to save this word.');
            window.dispatchEvent(new CustomEvent('mrcat:vocab-saved', { detail: result.word }));
            saving = false;
            closeDialog();
            showToast(result.word.dictionary
                ? (result.created ? 'Saved with dictionary details.' : 'Already saved. Dictionary details are ready.')
                : (result.created ? 'Saved. Finding dictionary details...' : 'Already saved. Checking dictionary details...'));
            enrichWord(result.word, true);
        }).catch(function(error) {
            status.textContent = error.message || 'Unable to save this word.';
        }).finally(function() {
            saving = false;
            dialog.removeAttribute('aria-busy');
            dialog.querySelectorAll('input, button').forEach(function(control) { control.disabled = false; });
            submit.textContent = 'Confirm';
        });
    }

    function enrichWord(word, announce) {
        if (!word || !word.vocab_id || word.dictionary) return Promise.resolve(word || null);
        if (!window.MrCatCloud || typeof window.MrCatCloud.callFunction !== 'function') return Promise.resolve(word);
        return window.MrCatCloud.callFunction('studentVocabulary', {
            action: 'enrich',
            vocab_id: word.vocab_id
        }).then(function(result) {
            if (!result || !result.success || !result.word) return word;
            window.dispatchEvent(new CustomEvent('mrcat:vocab-saved', { detail: result.word }));
            if (announce && result.word.dictionary) showToast('Dictionary details are ready in My Words.');
            return result.word;
        }).catch(function() {
            return word;
        });
    }

    function cancelSelectionCheck() {
        window.clearTimeout(selectionTimer);
        selectionTimer = null;
    }

    function scheduleSelectionCheck() {
        cancelSelectionCheck();
        if (mouseSelecting || touchSelecting || keyboardSelecting || (dialog && dialog.open)) return;
        selectionTimer = window.setTimeout(openDialogForSelection, 180);
    }

    document.addEventListener('selectionchange', function() {
        if (touchSelecting) touchSelectionChanged = true;
        scheduleSelectionCheck();
    });
    document.addEventListener('mousedown', function(event) {
        if (event.button !== 0 || (dialog && dialog.open)) return;
        mouseSelecting = true;
        cancelSelectionCheck();
    });
    document.addEventListener('mouseup', function() {
        mouseSelecting = false;
        scheduleSelectionCheck();
    });
    document.addEventListener('touchstart', function(event) {
        if (dialog && dialog.open) return;
        touchSelecting = true;
        touchMoved = event.touches.length !== 1;
        touchSelectionChanged = false;
        touchStart = event.touches[0] && { x: event.touches[0].clientX, y: event.touches[0].clientY, at: Date.now() };
        cancelSelectionCheck();
    }, { passive: true });
    document.addEventListener('touchmove', function(event) {
        var touch = event.touches[0];
        if (!touchStart || !touch || event.touches.length !== 1
            || Math.abs(touch.clientX - touchStart.x) + Math.abs(touch.clientY - touchStart.y) > 12) touchMoved = true;
    }, { passive: true });
    document.addEventListener('touchend', function(event) {
        if (event.touches.length) return;
        touchSelecting = false;
        mouseSelecting = false;
        if (touchSelectionChanged || (!touchMoved && touchStart && Date.now() - touchStart.at >= 350)) scheduleSelectionCheck();
        touchStart = null;
    }, { passive: true });
    document.addEventListener('touchcancel', function() {
        touchSelecting = false;
        mouseSelecting = false;
        touchStart = null;
        cancelSelectionCheck();
    }, { passive: true });
    document.addEventListener('keydown', function(event) {
        if (event.key === 'Shift') {
            keyboardSelecting = true;
            cancelSelectionCheck();
        }
    });
    document.addEventListener('keyup', function(event) {
        if (event.key === 'Shift') keyboardSelecting = false;
        if (event.key === 'Shift' || (!event.shiftKey && event.key.indexOf('Arrow') !== -1)) scheduleSelectionCheck();
    });
    window.addEventListener('scroll', cancelSelectionCheck, true);
    window.addEventListener('blur', function() {
        mouseSelecting = false;
        touchSelecting = false;
        keyboardSelecting = false;
        cancelSelectionCheck();
    });
    window.addEventListener('resize', updateDialogViewport);
    if (window.visualViewport) {
        window.visualViewport.addEventListener('scroll', updateDialogViewport);
        window.visualViewport.addEventListener('resize', updateDialogViewport);
    }

    ensureStyles();

    window.MrCatPersonalVocab = {
        showToast: showToast,
        enrichWord: enrichWord
    };
})(window, document);
