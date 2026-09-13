(function (window, document) {
    'use strict';

    // Reuse Writing's actual runner and material/ice styles; never simulate AI progress.
    function stages(state) {
        return ['Uploaded', 'Finished'].map(function (label, index) {
            var done = index === 0 || state === 'ready';
            var status = state === 'failed' ? (index ? 'is-interrupted' : 'is-interrupted-complete') : done ? 'is-complete' : 'is-upcoming';
            var connector = index ? '' : '<span class="ai-waiting-connector ' + (state === 'ready' ? 'is-complete' : state === 'failed' ? 'is-interrupted' : 'is-transmitting') + '" aria-hidden="true"><span class="ai-waiting-connector-track"></span><span class="ai-waiting-connector-label"' + (state === 'failed' ? '' : ' hidden') + '>Interrupted</span></span>';
            return '<li class="ai-waiting-stage ' + status + '"><span class="ai-waiting-stage-node" aria-hidden="true"><svg class="ai-waiting-stage-check" viewBox="0 0 20 20"><path d="M4.5 10.2 8.2 14l7.4-8"></path></svg></span><span class="ai-waiting-stage-label">' + label + '</span>' + connector + '</li>';
        }).join('');
    }

    function markup() {
        return '<section class="ai-waiting-experience speaking-waiting-experience" aria-label="Speaking report progress">' +
            '<ol class="ai-waiting-progress" role="status" aria-live="polite">' + stages('queued') + '</ol>' +
            '<div class="ai-waiting-interruption" role="alert" hidden><strong>Analysis interrupted</strong><p>Your recording is safe. Retry without uploading again.</p></div>' +
            '<div class="runner-shell" aria-label="Mr. Cat Runner waiting activity"><div class="runner-canvas-frame"><p class="runner-score" aria-live="polite">Score 0</p><canvas class="runner-canvas" tabindex="0" role="img" aria-label="Interactive Mr. Cat Runner waiting game."></canvas></div></div>' +
            '<p class="ai-waiting-status" data-speaking-wait-status role="status">Your recording is saved. Checking for your report automatically…</p>' +
            '<div class="ai-waiting-retry-action" hidden><button class="primary-button" type="button" data-retry-waiting>Retry analysis</button></div>' +
            '<div class="ai-waiting-ready-action" hidden><button class="primary-button" type="button" data-view-waiting-result>View Report</button></div></section>';
    }

    function mount(root, config) {
        var card = root.querySelector('.speaking-waiting-experience');
        if (!card) return null;
        var canvas = card.querySelector('.runner-canvas');
        var status = card.querySelector('[data-speaking-wait-status]');
        var retry = card.querySelector('[data-retry-waiting]');
        var view = card.querySelector('[data-view-waiting-result]');
        var runner = null, timer = 0, deadline = 0, finishTimer = 0;
        var destroyed = false, inFlight = false, wakePending = false, retrying = false, opened = false;
        var failures = 0, state = '', result = null, audio = null;
        var started = Date.now();

        function active() { return !destroyed && config.isActive(); }
        function sound(kind) {
            if (!audio || audio.state !== 'running' || document.hidden) return;
            var tones = kind === 'ready' ? [[784,.34,.2,'sine',0],[1568,.25,.055,'triangle',.01],[1175,.88,.295,'sine',.33],[2350,.72,.085,'triangle',.34]] : kind === 'collect' ? [[1047,.15,.07,'triangle',0,920]] : [[330,.2,.062,'sine',0,150],[165,.13,.025,'triangle',.08]];
            try { tones.forEach(function (t) { var at = audio.currentTime + t[4], oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.type = t[3]; oscillator.frequency.setValueAtTime(t[0], at); if (t[5]) oscillator.frequency.exponentialRampToValueAtTime(t[5], at+t[1]); gain.gain.setValueAtTime(.0001,at); gain.gain.exponentialRampToValueAtTime(t[2],at+.015); gain.gain.exponentialRampToValueAtTime(.0001,at+t[1]); oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(at); oscillator.stop(at+t[1]+.03); }); } catch (_error) {}
        }
        function unlockSound() {
            try { var Audio = window.AudioContext || window.webkitAudioContext; if (!audio && Audio) audio = new Audio(); if (audio && audio.state === 'suspended') audio.resume().catch(function () {}); } catch (_error) {}
        }
        function update(next) {
            if (state === next) return;
            state = next;
            card.querySelector('.ai-waiting-progress').innerHTML = stages(next);
            card.classList.toggle('is-ready', next === 'ready');
            card.classList.toggle('is-ready-announced', next === 'ready');
            card.classList.toggle('is-interrupted', next === 'failed');
            card.querySelector('.ai-waiting-interruption').hidden = next !== 'failed';
            retry.parentElement.hidden = next !== 'failed';
            view.parentElement.hidden = next !== 'ready';
            if (runner) { runner.setTaskState(next === 'processing' ? 'analysing' : next); if (next === 'ready' || next === 'failed') runner.pause(); else if (!document.hidden) runner.resume(); }
            canvas.setAttribute('aria-disabled', String(next === 'ready' || next === 'failed'));
            canvas.setAttribute('tabindex', next === 'ready' || next === 'failed' ? '-1' : '0');
            if (next === 'ready') canvas.setAttribute('aria-label', 'Mr. Cat Runner paused. Your report is ready.');
        }
        function openResult() {
            if (!active() || state !== 'ready' || opened) return;
            opened = true;
            var readyResult = result;
            destroy();
            config.onReady(readyResult);
        }
        function accept(item) {
            if (!active()) return;
            if (!item) throw new Error('Missing report status');
            if (config.onSnapshot) config.onSnapshot(item);
            if (item.analysis_status === 'ready' && item.report) {
                result = item; update('ready'); sound('ready');
                status.textContent = 'Your report is ready. Opening automatically…';
                var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                finishTimer = window.setTimeout(openResult, reduced ? 0 : 1800);
            } else if (item.analysis_status === 'failed' || item.analysis_status === 'not_ready') {
                update('failed');
                var notStarted = item.analysis_status === 'not_ready';
                card.querySelector('.ai-waiting-interruption strong').textContent = notStarted ? 'Analysis has not started' : 'Analysis interrupted';
                retry.textContent = notStarted ? 'Start analysis' : 'Retry analysis';
                status.textContent = notStarted ? 'Your recording is saved. Start the analysis when you are ready.' : 'Your recording is safe. You can retry the analysis.';
            } else {
                update(item.analysis_status === 'processing' ? 'processing' : 'queued');
                status.textContent = Date.now() - started > 90000 ? 'This is taking longer than usual. We are still checking automatically; your recording is safe.' : 'Your recording is saved. Checking for your report automatically…';
            }
        }
        function schedule() {
            window.clearTimeout(timer);
            if (!active() || state === 'ready' || state === 'failed') return;
            timer = window.setTimeout(poll, failures ? Math.min(30000, 3000 * Math.pow(2, failures)) : document.hidden ? 10000 : 3000);
        }
        function poll() {
            if (!active() || state === 'ready' || retrying) return;
            window.clearTimeout(timer);
            if (inFlight) { wakePending = true; return; }
            inFlight = true;
            // The gateway also times out reads; this guard prevents a hung adapter from stopping polling.
            var timeout = new Promise(function (_, reject) { deadline = window.setTimeout(function () { reject(new Error('Status query timed out')); }, 25000); });
            Promise.race([Promise.resolve().then(config.request), timeout]).then(function (item) {
                if (!active()) return;
                failures = 0; accept(item);
            }).catch(function (error) {
                if (!active()) return;
                failures = Math.min(4, failures + 1);
                if (/AUTH_REQUIRED|FORBIDDEN|NOT_FOUND|PERMISSION/.test(String(error.code || ''))) {
                    update('failed'); retry.parentElement.hidden = true;
                    status.textContent = 'This session is no longer accessible. Return to Speaking Lab or sign in again.';
                } else status.textContent = 'Temporarily unable to check. We will retry automatically when the connection recovers.';
            }).finally(function () {
                window.clearTimeout(deadline); deadline = 0; inFlight = false;
                if (!active()) return;
                if (wakePending && state !== 'ready' && state !== 'failed') { wakePending = false; poll(); } else schedule();
            });
        }
        function wake() { if (!document.hidden && active()) poll(); }
        function retryAnalysis() {
            if (!active() || retrying || state !== 'failed') return;
            retrying = true; retry.disabled = true;
            Promise.resolve().then(config.retry).then(function () { if (active()) { failures = 0; update('queued'); } }).catch(function () { if (active()) status.textContent = 'The retry could not start. Your recording is safe; please try again.'; }).finally(function () { retrying = false; retry.disabled = false; if (active() && state !== 'failed') poll(); });
        }
        function destroy() {
            if (destroyed) return;
            destroyed = true; window.clearTimeout(timer); window.clearTimeout(deadline); window.clearTimeout(finishTimer);
            if (runner) runner.destroy();
            if (audio) audio.close().catch(function () {});
            view.removeEventListener('click', openResult); retry.removeEventListener('click', retryAnalysis);
            card.removeEventListener('pointerdown', unlockSound); card.removeEventListener('keydown', unlockSound);
            document.removeEventListener('visibilitychange', wake);
            ['focus', 'online', 'pageshow'].forEach(function (event) { window.removeEventListener(event, wake); });
        }
        try { if (window.MrCatWaitingRunner) runner = window.MrCatWaitingRunner.mount(canvas, { jumpSurface: card, onScore: function (value) { card.querySelector('.runner-score').textContent = 'Score ' + value.score; }, onEvent: function (event) { if (event.type === 'hit' || event.type === 'collect') sound(event.type); } }); } catch (_error) {}
        if (!runner || (runner.snapshot && runner.snapshot().supported === false)) card.querySelector('.runner-shell').hidden = true;
        view.addEventListener('click', openResult); retry.addEventListener('click', retryAnalysis);
        card.addEventListener('pointerdown', unlockSound); card.addEventListener('keydown', unlockSound);
        document.addEventListener('visibilitychange', wake);
        ['focus', 'online', 'pageshow'].forEach(function (event) { window.addEventListener(event, wake); });
        accept(config.initial);
        if (state !== 'ready' && state !== 'failed') poll();
        return { destroy: destroy, wake: wake };
    }
    window.MrCatSpeakingWaiting = { markup: markup, mount: mount };
})(window, document);
