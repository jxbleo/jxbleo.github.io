(function(window, document) {
    'use strict';

    var button = null;
    var toast = null;
    var selectedText = '';
    var selectedContext = '';
    var hideTimer = null;
    var BLOCKED_SELECTOR = [
        'input',
        'textarea',
        'select',
        'button',
        '[contenteditable="true"]',
        '.mrcat-vocab-popover',
        '.mrcat-vocab-toast',
        '.mrcat-visitor-modal',
        '.password-dialog-overlay',
        '.teacher-replies-overlay',
        '.modal-overlay',
        '.login-modal',
        '.highlight-toolbar',
        '.inline-explanation',
        '.feedback',
        '.feedback-bar',
        '.result-overlay',
        '.result-card',
        '.result-bar',
        '.reveal.show',
        '[data-answer-reveal="1"]',
        '[data-teacher-answer="1"]',
        '[data-feedback]',
        '[data-history-dispute]',
        '.history-dispute-note',
        '.teacher-answer',
        '.teacher-argue-bar',
        '.teacher-reply-item',
        '.review-answer',
        '.dispute-explanation',
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
        if (text.length < 2) return 'Select a longer word or phrase.';
        if (!hasWordCharacter(text)) return 'Select a word or phrase with letters or numbers.';
        if (text.length > 120 || text.split(/\s+/).filter(Boolean).length > 16) {
            return 'Save one word or short phrase at a time.';
        }
        return '';
    }

    function selectionRect(range) {
        var rect = range.getBoundingClientRect();
        if (rect && (rect.width || rect.height)) return rect;
        var rects = range.getClientRects();
        return rects && rects[0] || null;
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
            '.mrcat-vocab-popover{position:fixed;z-index:10020;display:none;min-height:38px;padding:0 13px;border:1px solid rgba(19,118,109,.2);border-radius:999px;color:#fff;background:#13766d;box-shadow:0 14px 38px rgba(10,52,47,.22);font:850 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;white-space:nowrap}' +
            '.mrcat-vocab-popover.show{display:inline-flex;align-items:center;justify-content:center}.mrcat-vocab-popover:disabled{opacity:.72;cursor:wait}' +
            '.mrcat-vocab-toast{position:fixed;z-index:10021;left:50%;bottom:24px;max-width:min(420px,calc(100% - 32px));padding:12px 15px;border:1px solid rgba(19,118,109,.16);border-radius:14px;color:#18332f;background:rgba(255,255,255,.97);box-shadow:0 18px 52px rgba(10,52,47,.18);font:800 13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;opacity:0;transform:translate(-50%,12px);transition:opacity 160ms ease,transform 160ms ease;pointer-events:none}' +
            '.mrcat-vocab-toast.show{opacity:1;transform:translate(-50%,0)}';
        document.head.appendChild(style);
    }

    function ensureButton() {
        if (button) return button;
        ensureStyles();
        button = document.createElement('button');
        button.className = 'mrcat-vocab-popover';
        button.type = 'button';
        button.textContent = 'Add to My Words';
        button.addEventListener('pointerdown', function(event) {
            event.preventDefault();
        });
        button.addEventListener('click', saveSelection);
        document.body.appendChild(button);
        return button;
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

    function hideButton() {
        if (button) button.classList.remove('show');
    }

    function showButtonForSelection() {
        if (isTeacherMode()) return;
        var range = selectedRange();
        if (!range) {
            hideButton();
            return;
        }
        var text = compactText(window.getSelection().toString(), 140);
        if (selectedTextError(text)) {
            hideButton();
            return;
        }
        var rect = selectionRect(range);
        if (!rect) {
            hideButton();
            return;
        }
        selectedText = text;
        selectedContext = contextForRange(range, text);
        var popover = ensureButton();
        popover.disabled = false;
        popover.textContent = 'Add to My Words';
        var left = Math.min(window.innerWidth - 18, Math.max(18, rect.left + rect.width / 2));
        var top = Math.max(12, rect.top - 46);
        popover.style.left = left + 'px';
        popover.style.top = top + 'px';
        popover.style.transform = 'translateX(-50%)';
        popover.classList.add('show');
    }

    function saveSelection() {
        var text = compactText(selectedText, 140);
        var validation = selectedTextError(text);
        if (validation) {
            showToast(validation);
            hideButton();
            return;
        }
        if (isVisitorMode()) {
            showToast('Log in to save words to your personal list.');
            hideButton();
            return;
        }
        if (!window.MrCatCloud || typeof window.MrCatCloud.callFunction !== 'function') {
            showToast('Word saving is not available on this page yet.');
            hideButton();
            return;
        }
        button.disabled = true;
        button.textContent = 'Saving...';
        window.MrCatCloud.callFunction('studentVocabulary', {
            action: 'add',
            text: text,
            source_set_id: sourceSetId(),
            source_title: sourceTitle(),
            source_path: sourcePath(),
            context: selectedContext
        }).then(function(result) {
            if (!result || !result.success) throw new Error(result && result.message || 'Unable to save this word.');
            window.dispatchEvent(new CustomEvent('mrcat:vocab-saved', {
                detail: result.word
            }));
            showToast(result.created ? 'Saved to My Words.' : 'Already saved. Updated in My Words.');
            hideButton();
        }).catch(function(error) {
            showToast(error.message || 'Unable to save this word.');
        }).finally(function() {
            if (!button) return;
            button.disabled = false;
            button.textContent = 'Add to My Words';
        });
    }

    function scheduleSelectionCheck() {
        window.setTimeout(showButtonForSelection, 60);
    }

    document.addEventListener('selectionchange', scheduleSelectionCheck);
    document.addEventListener('mouseup', scheduleSelectionCheck);
    document.addEventListener('keyup', function(event) {
        if (event.key === 'Shift' || event.key.indexOf('Arrow') !== -1) scheduleSelectionCheck();
    });
    document.addEventListener('pointerdown', function(event) {
        if (button && event.target !== button) hideButton();
    }, true);
    window.addEventListener('scroll', hideButton, true);
    window.addEventListener('resize', hideButton);

    window.MrCatPersonalVocab = {
        showToast: showToast
    };
})(window, document);
