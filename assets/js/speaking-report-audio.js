(function (window) {
    'use strict';
    var active = null;
    function esc(value) { return String(value || '').replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function markup(reportId, compact) {
        return '<div class="speaking-report-audio' + (compact ? ' speaking-report-audio-compact' : '') + '" data-report-audio="' + esc(reportId) + '"><button type="button" class="outline-button speaking-report-play" aria-label="Play original recording" title="Play recording">' + (compact ? '▶' : '<span aria-hidden="true">▶</span> Play recording') + '</button><audio' + (compact ? '' : ' controls') + ' preload="none" hidden aria-label="Original recording"></audio><span class="speaking-report-audio-status" role="status"></span></div>';
    }
    function setButton(item, playing) {
        item.button.textContent = item.root.classList && item.root.classList.contains('speaking-report-audio-compact') ? (playing ? '❚❚' : '▶') : (playing ? '❚❚ Pause recording' : '▶ Play recording');
        item.button.setAttribute('aria-label', playing ? 'Pause original recording' : 'Play original recording');
        item.button.setAttribute('title', playing ? 'Pause recording' : 'Play recording');
    }
    function visible(item) {
        var dialog = item.root.closest('dialog');
        return item.root.isConnected && !item.root.closest('[hidden]') && (!dialog || dialog.open);
    }
    function clear() {
        if (!active) return;
        var previous = active; active = null;
        previous.audio.pause(); previous.audio.removeAttribute('src'); previous.audio.load(); previous.audio.hidden = true;
        previous.button.disabled = false; setButton(previous, false); previous.status.textContent = '';
    }
    document.addEventListener('click', function (event) {
        var button = event.target.closest('.speaking-report-play');
        if (!button) return;
        event.preventDefault(); event.stopPropagation();
        var root = button.closest('[data-report-audio]');
        if (active && active.root === root) {
            if (!active.audio.paused) { active.audio.pause(); return; }
            if (!active.audio.error) { active.audio.play().catch(function () {}); return; }
        }
        clear();
        var item = { root: root, button: button, audio: root.querySelector('audio'), status: root.querySelector('[role="status"]') };
        active = item;
        button.disabled = true; item.status.textContent = 'Loading recording…';
        item.audio.onplay = function () { setButton(item, true); };
        item.audio.onpause = item.audio.onended = function () { setButton(item, false); };
        item.audio.onerror = function () { if (active === item) item.status.textContent = 'Recording could not be loaded. Tap Play to retry.'; };
        window.MrCatCloud.callFunction('speakingLab', { action: 'getSpeakingReportAudio', report_id: root.getAttribute('data-report-audio') }).then(function (result) {
            if (active !== item || !visible(item)) return;
            if (!result || !result.success) throw new Error('Recording unavailable');
            var url = new URL(result.audio_url);
            if (url.protocol !== 'https:') throw new Error('Invalid audio URL');
            item.audio.src = url.href; item.audio.hidden = false; item.status.textContent = '';
            return item.audio.play().catch(function () { item.status.textContent = 'Press play to listen.'; });
        }).catch(function () {
            if (active !== item) return;
            clear(); item.status.textContent = 'Recording is unavailable. Tap Play to retry.';
        }).finally(function () { button.disabled = false; });
    });
    new MutationObserver(function () { if (active && !visible(active)) clear(); }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden', 'open'] });
    window.addEventListener('pagehide', clear);
    window.MrCatSpeakingReportAudio = { markup: markup, clear: clear };
})(window);
