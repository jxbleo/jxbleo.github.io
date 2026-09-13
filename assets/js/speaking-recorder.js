(function (window) {
    'use strict';

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
        });
    }
    function normaliseTarget(value) {
        var seconds = value == null || value === '' ? 480 : Number(value);
        return Math.round(Math.max(180, Math.min(1800, Number.isFinite(seconds) ? seconds : 480)) / 30) * 30;
    }
    function timeText(seconds) {
        var value = Math.max(0, Math.ceil(seconds));
        return String(Math.floor(value / 60)).padStart(2, '0') + ':' + String(value % 60).padStart(2, '0');
    }
    function shanghaiToday() {
        var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce(function (result, part) { result[part.type] = part.value; return result; }, {});
        return parts.year + '-' + parts.month + '-' + parts.day;
    }
    var OPENING_SECONDS = 3, ENDING_SECONDS = 3;
    function timeline(elapsed, target) {
        var ending = elapsed >= target;
        var remaining = Math.max(0, (ending ? target + ENDING_SECONDS : target) - elapsed);
        var minute = !ending && remaining <= 60;
        return { ending: ending, remaining: remaining, fraction: remaining / (ending ? ENDING_SECONDS : minute ? 60 : target),
            tick: ending ? Math.ceil(remaining) : null, minute: minute, finished: elapsed >= target + ENDING_SECONDS };
    }
    function liveMarkup(date) {
        var options = Array.from({ length: 55 }, function (_, index) { var minutes = 3 + index / 2; return '<div class="speaking-duration-wheel-item" data-duration-index="' + index + '" aria-hidden="true"><span>' + minutes + '</span><small>min</small></div>'; }).join('');
        return '<dialog class="speaking-recording-state speaking-recording-live" id="recording-live" tabindex="-1" hidden aria-label="Discussion recording">' +
            '<button class="speaking-recording-back" id="recording-back" type="button" aria-label="Back to recording and file options"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m12 5-5 5 5 5"/></svg></button>' +
            '<div class="speaking-recording-live-label"><span aria-hidden="true"></span><strong id="recording-live-status"></strong></div>' +
            '<div class="speaking-recording-live-content"><div class="speaking-recording-dial" id="recording-dial">' +
            '<svg class="speaking-recording-outer-wave" viewBox="-20 -20 240 240" aria-hidden="true"><defs><linearGradient id="recording-outer-spectrum" x1="0" y1="0.25" x2="1" y2="0.75"><stop stop-color="#ee8180"/><stop offset=".14" stop-color="#f3ac70"/><stop offset=".28" stop-color="#d8bd65"/><stop offset=".42" stop-color="#9bc96e"/><stop offset=".57" stop-color="#5cbba4"/><stop offset=".71" stop-color="#6abbd0"/><stop offset=".85" stop-color="#799ddc"/><stop offset="1" stop-color="#9b8acb"/></linearGradient></defs><path id="recording-outer-glow" class="speaking-recording-outer-wave-glow"/><path id="recording-outer-fill" class="speaking-recording-outer-wave-fill"/><path id="recording-outer-line" class="speaking-recording-outer-wave-line"/></svg>' +
            '<svg class="speaking-recording-ring" viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="recording-ring-gradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7ecddd"/><stop offset="1" stop-color="#62bfae"/></linearGradient></defs><circle class="speaking-recording-ring-track" cx="100" cy="100" r="97"/><circle class="speaking-recording-ring-progress" id="recording-ring-progress" cx="100" cy="100" r="97" pathLength="1" stroke-dasharray="1"/></svg>' +
            '<button class="speaking-recording-dial-center" id="stop-recording" type="button" aria-label="Start three-second countdown"><span class="speaking-recording-mic-icon" id="recording-mic-icon" aria-hidden="true"><svg viewBox="0 0 32 32" aria-hidden="true"><rect x="11" y="4" width="10" height="16" rx="5"/><path d="M7.5 16a8.5 8.5 0 0 0 17 0M16 24.5V28M12 28h8"/></svg></span><span class="speaking-recording-center-indicator" id="recording-center-indicator" hidden><span class="speaking-recording-center-dot" aria-hidden="true"></span><span>Recording</span></span><span class="speaking-recording-finished-icon" id="recording-finished-icon" aria-hidden="true" hidden><svg viewBox="0 0 32 32" aria-hidden="true"><path d="m7 16 6 6L25 10"/></svg></span><span class="speaking-recording-countdown" id="recording-countdown" role="timer" aria-label="Countdown" hidden>3</span><span class="speaking-recording-time" id="recording-time" role="timer" aria-label="Time remaining">08:00</span><span class="speaking-recording-start-hint" id="recording-start-hint">Tap to Start</span></button>' +
            '</div><div class="speaking-recording-clock-slot"><button class="speaking-duration-adjust" id="recording-adjust-duration" type="button" aria-haspopup="dialog" aria-label="Adjust discussion time"><span id="recording-duration-label">08:00</span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button><span class="speaking-recording-clock" id="recording-clock" role="timer" aria-label="Time remaining" hidden>08:00</span></div></div>' +
            '<div class="speaking-recording-footer"><button class="speaking-recording-upload-option" id="recording-upload-option" type="button"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 13V3m-3.5 3.5L10 3l3.5 3.5M4 12v4a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-4"/></svg><span>Upload</span></button><input type="file" accept="audio/*" id="live-audio-file" hidden>' +
            '<div class="speaking-recording-state speaking-recording-review" id="recording-review" hidden><button class="primary-button" type="button" id="upload-recording">Submit</button><div class="speaking-recording-review-tools"><button type="button" id="preview-recording">Play recording</button><button type="button" id="replace-recording">Record again</button></div><label class="speaking-audio-date" id="recording-file-date" hidden><span>Audio date</span><input id="recording-date" type="date" value="' + esc(date || shanghaiToday()) + '"></label><p id="recording-review-copy" role="status"></p></div>' +
            '<div class="speaking-recording-state speaking-recording-uploading" id="recording-uploading" hidden aria-live="polite" aria-busy="true"><span class="speaking-upload-spinner" aria-hidden="true"></span><p>Uploading securely…</p></div></div>' +
            '<p class="speaking-quality-warning" id="quality-warning" role="status" aria-live="polite"></p></dialog>' +
            '<dialog class="speaking-duration-dialog" id="recording-duration-dialog" aria-label="Discussion time"><div class="speaking-duration-wheel-shell"><div class="speaking-duration-wheel" id="recording-duration-wheel" tabindex="0" role="spinbutton" aria-label="Duration in minutes" aria-valuemin="3" aria-valuemax="30" aria-valuenow="8" aria-valuetext="8 minutes">' + options + '</div></div><div class="speaking-duration-actions"><button id="recording-duration-cancel" type="button">Cancel</button><button id="recording-duration-done" type="button">Done</button></div></dialog>';
    }
    function markup(options) {
        options = options || {};
        var item = { duration_seconds: normaliseTarget(options.targetSeconds), discussion_date: options.date || shanghaiToday() };
        var canRecord = true;
        var targetMinutes = item.duration_seconds / 60;
        var recording = canRecord ? '<section class="speaking-section-card speaking-recording-card" data-recording-state="idle"><header><div><h3>Record the Discussion</h3><p>Record here or choose one audio file. Nothing is uploaded until you confirm.</p></div><span class="speaking-pill" id="recording-target-pill">Target ' + esc(targetMinutes % 1 ? targetMinutes.toFixed(1) : targetMinutes) + ' min</span></header>' +
            '<div class="speaking-recording-state" id="recording-ready"><input id="recording-duration" type="hidden" value="' + esc(targetMinutes) + '"><div class="speaking-recording-choice"><button class="primary-button" type="button" id="record-now">Record on this device</button><label class="outline-button speaking-file-button" id="audio-file-label">Choose audio file<input type="file" accept="audio/*" hidden id="audio-file"></label></div><p class="speaking-recording-note">Device recordings use today. For an existing audio file, choose the date it was recorded.</p><p class="speaking-quality-warning" id="recording-message" role="status" aria-live="polite"></p></div>' +
            liveMarkup(item.discussion_date) +
            '</section>' : '';
        return recording;
    }
    function create(root, options) {
        options = options || {};
        var state = 'idle', blob = null, operationId = '', target = 480, fileSelected = false, recordedSeconds = 0;
        var stream = null, recorder = null, chunks = [], generation = 0;
        var timer = 0, startedAt = 0, countdownAt = 0, minutePlayed = false;
        var audioContext = null, analyser = null, frame = 0, cueNodes = [], wheelTickBuffer = null;
        var wheelSoundEnabled = false, wheelIndex = 10, lastWaveAt = 0, waveLevels = Array(40).fill(0);
        var previewAudio = null, previewUrl = '', qualityIssue = '', badSince = 0, recoverySince = 0;
        var wakeLock = window.MrCatScreenWakeLock.create();
        var destroyed = false, previousFocus = null, returnToOrigin = null;
        function node(id) { return root.querySelector('#' + id); }
        function snapshot() { return { state: state, blob: blob, operationId: operationId, targetSeconds: target, date: node('recording-date').value }; }
        function locked() { return ['ready', 'requesting', 'countdown', 'recording', 'ending', 'stopping', 'uploading'].indexOf(state) !== -1; }
        function notify() { if (options.onStateChange) options.onStateChange(snapshot()); }
        function warning(copy) { node('quality-warning').textContent = copy || ''; }
        function message(copy) { node('recording-message').textContent = copy || ''; }
        function setState(next, copy) {
            var wasLive = !node('recording-live').hidden;
            state = next;
            wakeLock.setActive(['countdown', 'recording', 'ending', 'stopping'].indexOf(next) >= 0);
            root.setAttribute('data-recording-state', next);
            node('recording-ready').hidden = next !== 'idle';
            node('recording-live').hidden = ['ready', 'requesting', 'countdown', 'recording', 'ending', 'stopping', 'review', 'analysis_retry', 'uploading'].indexOf(next) < 0;
            if (!wasLive && !node('recording-live').hidden) { previousFocus = document.activeElement; node('recording-live').showModal(); }
            else if (wasLive && node('recording-live').hidden && node('recording-live').open) node('recording-live').close();
            node('recording-review').hidden = next !== 'review' && next !== 'analysis_retry';
            node('recording-uploading').hidden = next !== 'uploading';
            node('recording-countdown').hidden = next !== 'countdown' && next !== 'ending';
            node('recording-time').hidden = true;
            node('recording-mic-icon').hidden = next !== 'ready' && next !== 'requesting';
            node('recording-center-indicator').hidden = next !== 'recording' && next !== 'ending';
            node('recording-finished-icon').hidden = ['review', 'analysis_retry', 'uploading'].indexOf(next) < 0;
            node('recording-clock').hidden = ['recording', 'stopping', 'review', 'analysis_retry', 'uploading'].indexOf(next) < 0;
            node('recording-adjust-duration').hidden = next !== 'ready';
            node('recording-start-hint').hidden = next !== 'ready';
            node('recording-back').hidden = ['ready', 'requesting', 'countdown', 'review'].indexOf(next) < 0;
            node('recording-upload-option').hidden = next !== 'ready';
            node('recording-file-date').hidden = next !== 'review' || !fileSelected;
            node('recording-live').classList.toggle('is-review', next === 'review' || next === 'analysis_retry');
            if (next === 'review') { paintRing(1); node('recording-clock').textContent = fileSelected ? '' : timeText(recordedSeconds); node('recording-clock').setAttribute('aria-label', fileSelected ? 'Audio ready' : 'Recorded duration'); }
            node('recording-live').classList.toggle('is-ready', next === 'ready');
            node('recording-live').classList.toggle('is-opening', next === 'countdown');
            node('recording-live').classList.toggle('is-recording', next === 'recording');
            node('recording-live-status').textContent = { requesting: 'Starting microphone', recording: '', stopping: 'Finishing recording', review: 'Finished', analysis_retry: 'Finished', uploading: 'Submitting' }[next] || '';
            node('recording-dial').classList.toggle('is-countdown', next === 'countdown' || next === 'ending');
            node('recording-dial').classList.toggle('is-ending', next === 'ending');
            node('recording-live').classList.toggle('is-ending', next === 'ending');
            if (next !== 'recording') {
                node('recording-dial').classList.remove('is-minute');
                node('recording-live').classList.remove('is-minute');
            }
            node('stop-recording').setAttribute('aria-label', next === 'ready' ? 'Start three-second countdown' : next === 'countdown' ? 'Cancel countdown' : next === 'review' ? 'Recording complete' : next === 'recording' || next === 'ending' ? 'Recording — Tap to stop' : 'Finish discussion recording');
            node('stop-recording').disabled = ['stopping', 'requesting', 'review', 'analysis_retry', 'uploading'].indexOf(next) >= 0;
            node('preview-recording').hidden = next === 'analysis_retry';
            node('replace-recording').hidden = next === 'analysis_retry';
            node('upload-recording').textContent = next === 'analysis_retry' ? 'Retry' : 'Submit';
            node('upload-recording').disabled = next === 'uploading';
            if (copy != null) {
                if (next === 'idle') message(copy);
                else if (next === 'review' || next === 'analysis_retry') node('recording-review-copy').textContent = copy;
                else if (next === 'uploading') node('recording-uploading').querySelector('p').textContent = copy;
                else warning(copy);
            }
            if (!wasLive && !node('recording-live').hidden) {
                node('recording-live').focus({ preventScroll: true });
            } else if (wasLive && node('recording-live').hidden && next !== 'uploading') {
                var focusTarget = next === 'review' ? node('preview-recording') : node('record-now');
                focusTarget.focus({ preventScroll: true });
            }
            if (next === 'review' || next === 'analysis_retry') node('upload-recording').focus({ preventScroll: true });
            notify();
        }
        function currentTarget() {
            target = normaliseTarget(Number(node('recording-duration').value || 8) * 60);
            node('recording-duration').value = String(target / 60);
            node('recording-target-pill').textContent = 'Target ' + (target / 60) + ' min';
            node('recording-duration-label').textContent = timeText(target);
            node('recording-adjust-duration').setAttribute('aria-label', 'Adjust discussion time, ' + (target / 60) + ' minutes');
            if (state === 'idle' || state === 'ready') node('recording-clock').textContent = timeText(target);
            return target;
        }
        function stopPreview() {
            if (previewAudio) { previewAudio.pause(); previewAudio.removeAttribute('src'); previewAudio.load(); }
            previewAudio = null;
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = '';
            node('preview-recording').textContent = 'Play recording';
        }
        function cancelCues() {
            cueNodes.forEach(function (cue) { try { cue.oscillator.stop(); } catch (_error) {} cue.oscillator.disconnect(); cue.gain.disconnect(); });
            cueNodes = [];
        }
        function stopHardware() {
            wakeLock.setActive(false);
            if (timer) window.clearInterval(timer);
            timer = 0;
            cancelCues();
            if (frame) window.cancelAnimationFrame(frame);
            frame = 0;
            var oldRecorder = recorder; recorder = null;
            if (oldRecorder && oldRecorder.state !== 'inactive') { try { oldRecorder.stop(); } catch (_error) {} }
            var oldStream = stream; stream = null;
            if (oldStream) oldStream.getTracks().forEach(function (track) { track.stop(); });
            analyser = null;
            if (audioContext && audioContext.close) audioContext.close().catch(function () {});
            audioContext = null; wheelTickBuffer = null;
        }
        function discard() {
            generation += 1;
            stopHardware(); stopPreview();
            blob = null; chunks = []; operationId = ''; startedAt = 0; fileSelected = false; recordedSeconds = 0;
            setState('idle', '');
        }
        function failure(copy) {
            generation += 1;
            stopHardware(); blob = null; chunks = []; operationId = '';
            currentTarget(); paintRing(1); setState('ready', copy);
        }
        function ensureAudioContext() {
            var Ctor = window.AudioContext || window.webkitAudioContext;
            if (!Ctor) return;
            try {
                if (!audioContext) audioContext = new Ctor();
                if (audioContext.state === 'suspended') audioContext.resume().catch(function () {});
            } catch (_error) { audioContext = null; }
        }
        function beep(urgent, multiplier, delay) {
            if (!audioContext) return;
            multiplier = multiplier || 1;
            try {
                var oscillator = audioContext.createOscillator(), gain = audioContext.createGain(), at = audioContext.currentTime + (delay || 0);
                oscillator.type = 'sine';
                oscillator.frequency.setValueAtTime(urgent ? 1046 : 784, at);
                gain.gain.setValueAtTime(0.0001, at);
                gain.gain.exponentialRampToValueAtTime(urgent ? 0.2 : 0.13, at + 0.012 * multiplier);
                gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16 * multiplier);
                oscillator.connect(gain).connect(audioContext.destination);
                oscillator.start(at); oscillator.stop(at + 0.18 * multiplier);
                cueNodes.push({ oscillator: oscillator, gain: gain });
                oscillator.onended = function () { oscillator.disconnect(); gain.disconnect(); };
            } catch (_error) {}
        }
        function scheduleCountdownCues() {
            if (!audioContext || audioContext.state !== 'running') return;
            var baseTime = audioContext.currentTime;
            [0, 1, 2].forEach(function (second, index) {
                try {
                    var last = index === 2, length = last ? 0.4 : 0.18, at = baseTime + second;
                    var oscillator = audioContext.createOscillator(), gain = audioContext.createGain();
                    oscillator.type = 'sine'; oscillator.frequency.setValueAtTime(last ? 1320 : 880, at);
                    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(0.14, at + 0.012);
                    gain.gain.exponentialRampToValueAtTime(0.001, at + length - 0.02);
                    oscillator.connect(gain); gain.connect(audioContext.destination); oscillator.start(at); oscillator.stop(at + length);
                    cueNodes.push({ oscillator: oscillator, gain: gain });
                } catch (_error) {}
            });
        }
        function paintOuterWave(samples, rms, reduced) {
            var energy = Math.min(1, Math.max(0, rms - 0.002) * 18), points = [];
            for (var band = 0; band < 40; band += 1) {
                var at = Math.floor((band + 0.5) * samples.length / 40);
                var input = Math.min(1, Math.max(0, Math.abs(samples[at]) - 0.002) * 11 + energy * 0.65);
                waveLevels[band] += (input - waveLevels[band]) * (input > waveLevels[band] ? 0.65 : 0.22);
            }
            for (var index = 0; index < 180; index += 1) {
                var angle = index / 180 * Math.PI * 2, position = (0.5 - 0.5 * Math.cos(angle)) * 39;
                var lo = Math.floor(position), mix = position - lo;
                var level = waveLevels[lo] * (1 - mix) + waveLevels[Math.min(39, lo + 1)] * mix;
                var radius = reduced ? 102 : 101.2 + level * 12 + energy * 2.5;
                points.push((100 + Math.cos(angle) * radius).toFixed(2) + ',' + (100 + Math.sin(angle) * radius).toFixed(2));
            }
            var contour = 'M' + points.join(' L') + ' Z';
            node('recording-outer-line').setAttribute('d', contour); node('recording-outer-glow').setAttribute('d', contour);
            node('recording-outer-fill').setAttribute('d', contour + ' M200,100 A100,100 0 1 0 0,100 A100,100 0 1 0 200,100 Z');
            node('recording-outer-glow').style.opacity = reduced ? '0.24' : String(0.12 + energy * 0.4);
        }
        function paintRing(fraction) { node('recording-ring-progress').style.strokeDashoffset = String(1 - Math.max(0, Math.min(1, fraction))); }
        function monitorQuality(captureGeneration) {
            if (!audioContext) return;
            try {
                analyser = audioContext.createAnalyser(); analyser.fftSize = 2048;
                audioContext.createMediaStreamSource(stream).connect(analyser);
                var samples = new Float32Array(analyser.fftSize);
                waveLevels.fill(0); lastWaveAt = 0;
                var qualityReadyAt = performance.now() + 5000;
                qualityIssue = ''; badSince = 0; recoverySince = 0;
                function draw(now) {
                    if (!analyser || captureGeneration !== generation) return;
                    analyser.getFloatTimeDomainData(samples);
                    var sum = 0, clipped = 0;
                    for (var i = 0; i < samples.length; i += 1) { sum += samples[i] * samples[i]; if (Math.abs(samples[i]) >= 0.98) clipped += 1; }
                    var rms = Math.sqrt(sum / samples.length);
                    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    if (state === 'recording' && now - lastWaveAt >= (reduced ? 100 : 16)) { paintOuterWave(samples, rms, reduced); lastWaveAt = now; }
                    if (state === 'recording' && now >= qualityReadyAt) {
                        var dbfs = rms ? 20 * Math.log10(rms) : -Infinity;
                        var muted = stream.getTracks().some(function (track) { return track.readyState === 'ended' || track.muted; });
                        var issue = muted || dbfs === -Infinity ? 'input' : clipped / samples.length >= 0.01 ? 'clipping' : dbfs < -45 ? 'low' : '';
                        var copy = { input: 'Microphone signal lost. Check the input.', clipping: 'Sound is clipping. Move the device slightly farther away.', low: 'Move the device closer so everyone can be heard.' };
                        var delay = { input: 3000, clipping: 1000, low: 4000 };
                        if (issue) {
                            recoverySince = 0;
                            if (qualityIssue !== issue) { qualityIssue = issue; badSince = now; }
                            if (now - badSince >= delay[issue]) warning(copy[issue]);
                        } else if (qualityIssue) {
                            if (!recoverySince) recoverySince = now;
                            if (now - recoverySince >= 2000) { qualityIssue = ''; warning(''); }
                        }
                    }
                    frame = window.requestAnimationFrame(draw);
                }
                frame = window.requestAnimationFrame(draw);
            } catch (_error) { analyser = null; }
        }
        function finishRecording() {
            if (state === 'requesting' || state === 'countdown') { generation += 1; stopHardware(); chunks = []; currentTarget(); paintRing(1); setState('ready', ''); return; }
            if (!recorder || recorder.state === 'inactive' || (state !== 'recording' && state !== 'ending')) return;
            if ((performance.now() - startedAt) / 1000 < Math.min(60, target / 2) && !window.confirm('Finish this recording early?')) return;
            stopTake();
        }
        function stopTake() {
            if (!recorder || recorder.state === 'inactive') return;
            recordedSeconds = Math.min(target + ENDING_SECONDS, Math.max(0, (performance.now() - startedAt) / 1000));
            setState('stopping', '');
            try { if (recorder.requestData) recorder.requestData(); recorder.stop(); }
            catch (_error) { failure('The browser could not finish this recording. Please try again.'); }
        }
        function runTake(captureGeneration, device) {
            if (captureGeneration !== generation || recorder !== device) return;
            try { device.start(1000); } catch (_error) { failure('This browser could not begin recording. Choose an audio file instead.'); return; }
            startedAt = performance.now(); minutePlayed = false;
            setState('recording', '');
            function tick() {
                if (captureGeneration !== generation || recorder !== device) return;
                var current = timeline((performance.now() - startedAt) / 1000, target);
                if (current.finished) { stopTake(); return; }
                if (current.ending) {
                    if (state !== 'ending') { setState('ending', ''); cancelCues(); scheduleCountdownCues(); }
                    node('recording-countdown').textContent = String(current.tick);
                } else {
                    node('recording-time').hidden = !current.minute;
                    node('recording-clock').hidden = current.minute;
                    node('recording-clock').textContent = timeText(current.remaining);
                    node('recording-time').textContent = current.minute ? String(Math.ceil(current.remaining)).padStart(2, '0') : timeText(current.remaining);
                    node('recording-time').setAttribute('aria-label', current.minute ? 'Seconds remaining: ' + Math.ceil(current.remaining) : 'Time remaining');
                    node('recording-dial').classList.toggle('is-minute', current.minute);
                    node('recording-live').classList.toggle('is-minute', current.minute);
                    if (current.minute && !minutePlayed) {
                        minutePlayed = true;
                        for (var cue = 0; cue < 3; cue += 1) beep(false, 2, cue * 0.55);
                    }
                }
                if (!current.ending) paintRing(current.fraction);
            }
            tick(); timer = window.setInterval(tick, 50);
        }
        function startRecording() {
            if (state !== 'ready' || destroyed) return;
            if (options.canStart && !options.canStart()) return;
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { warning('Recording is unavailable here. Use Upload to choose an audio file.'); return; }
            stopPreview(); currentTarget();
            blob = null; operationId = ''; chunks = []; fileSelected = false;
            node('recording-date').value = shanghaiToday();
            if (options.onDateChange) options.onDateChange(node('recording-date').value);
            if (options.onTargetChange) options.onTargetChange(target);
            message(''); warning(''); paintRing(1); node('recording-clock').textContent = timeText(target); node('recording-clock').setAttribute('aria-label', 'Time remaining');
            setState('requesting');
            var captureGeneration = ++generation;
            ensureAudioContext();
            navigator.mediaDevices.getUserMedia({ audio: true }).then(function (input) {
                if (captureGeneration !== generation || destroyed || state !== 'requesting') { input.getTracks().forEach(function (track) { track.stop(); }); return; }
                stream = input;
                var preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(function (mime) { return window.MediaRecorder.isTypeSupported && window.MediaRecorder.isTypeSupported(mime); });
                try { recorder = new window.MediaRecorder(input, preferred ? { mimeType: preferred } : undefined); }
                catch (_error) { failure('This browser could not start a compatible recorder. Choose an audio file instead.'); return; }
                var device = recorder;
                device.ondataavailable = function (event) { if (captureGeneration === generation && event.data && event.data.size) chunks.push(event.data); };
                device.onerror = function () { if (captureGeneration === generation) failure('The browser recorder stopped unexpectedly. Please try again.'); };
                device.onstop = function () {
                    if (captureGeneration !== generation) return;
                    blob = new Blob(chunks, { type: device.mimeType || 'audio/webm' });
                    stopHardware(); chunks = [];
                    if (!blob.size) { failure('No audio was captured. Check the microphone and try again.'); return; }
                    operationId = 'speaking-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
                    setState('review', '');
                };
                input.getTracks().forEach(function (track) { track.addEventListener('ended', function () {
                    if (captureGeneration !== generation || recorder !== device) return;
                    if (state === 'requesting' || state === 'countdown') failure('The microphone signal ended before recording began. Please try again.');
                    else stopTake();
                }); });
                monitorQuality(captureGeneration);
                node('recording-countdown').textContent = '3'; paintRing(1); setState('countdown');
                countdownAt = performance.now(); scheduleCountdownCues();
                function tick() {
                    if (captureGeneration !== generation || state !== 'countdown') return;
                    var remaining = Math.max(0, OPENING_SECONDS - (performance.now() - countdownAt) / 1000);
                    if (!remaining) { window.clearInterval(timer); timer = 0; runTake(captureGeneration, device); return; }
                    node('recording-countdown').textContent = String(Math.ceil(remaining));
                }
                tick(); timer = window.setInterval(tick, 50);
            }).catch(function (error) {
                if (captureGeneration !== generation) return;
                var denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
                failure(denied ? 'Microphone access was not allowed. You can still choose an audio file.' : 'The microphone could not start. Check the input or choose an audio file.');
            });
        }
        function prepareFile(file) {
            if (!file || (state !== 'idle' && state !== 'ready')) return;
            if ((file.type && !/^audio\//i.test(file.type)) || file.size < 1 || file.size > 120 * 1024 * 1024) { if (state === 'ready') warning('Choose an audio file no larger than 120 MB.'); else message('Choose an audio file no larger than 120 MB.'); return; }
            currentTarget(); stopPreview(); warning(''); blob = file; fileSelected = true;
            operationId = 'speaking-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
            setState('review', file.name || 'Audio ready');
        }
        function togglePreview() {
            if (!blob || state !== 'review') return;
            if (previewAudio && !previewAudio.paused) { previewAudio.pause(); node('preview-recording').textContent = 'Play recording'; return; }
            if (!previewAudio) {
                previewUrl = URL.createObjectURL(blob); previewAudio = new window.Audio(previewUrl);
                previewAudio.addEventListener('ended', function () { node('preview-recording').textContent = 'Play recording'; });
                previewAudio.addEventListener('error', function () { stopPreview(); node('recording-review-copy').textContent = 'This browser could not play the preview. You can replace the recording or upload it.'; });
            }
            previewAudio.play().then(function () { node('preview-recording').textContent = 'Pause preview'; }).catch(function () { stopPreview(); node('recording-review-copy').textContent = 'This browser could not play the preview. You can replace the recording or upload it.'; });
        }
        function openReady(entry) {
            if (state !== 'idle' || destroyed) return;
            returnToOrigin = entry && typeof entry.onBack === 'function' ? entry.onBack : null;
            node('recording-back').setAttribute('aria-label', returnToOrigin ? 'Back to Set task' : 'Back to recording and file options');
            currentTarget(); paintRing(1); setState('ready', '');
        }
        function backBeforeRecording() {
            if (['ready', 'requesting', 'countdown', 'review'].indexOf(state) < 0) return;
            if (state === 'review' && !window.confirm('Discard this recording and go back?')) return;
            var restore = returnToOrigin;
            returnToOrigin = null;
            discard();
            if (restore) restore();
        }
        function prepareWheelAudio() {
            try {
                ensureAudioContext();
                if (!audioContext || wheelTickBuffer) return;
                var size = Math.ceil(audioContext.sampleRate * 0.024);
                wheelTickBuffer = audioContext.createBuffer(1, size, audioContext.sampleRate);
                var samples = wheelTickBuffer.getChannelData(0), seed = 173;
                for (var i = 0; i < size; i += 1) {
                    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
                    var t = i / audioContext.sampleRate;
                    // A dry impact with a rapidly decaying spring resonance.
                    var impact = (seed / 4294967296 * 2 - 1) * Math.exp(-t * 390);
                    var spring = Math.sin(2 * Math.PI * 1850 * t) * Math.exp(-t * 230);
                    samples[i] = (impact * 0.75 + spring * 0.25) * Math.min(1, t / 0.0008);
                }
            } catch (_error) { wheelTickBuffer = null; }
        }
        function playWheelTick() {
            if (!wheelSoundEnabled || !node('recording-duration-dialog').open || !audioContext || audioContext.state !== 'running' || !wheelTickBuffer) return;
            try {
                var source = audioContext.createBufferSource(), filter = audioContext.createBiquadFilter(), gain = audioContext.createGain();
                source.buffer = wheelTickBuffer; filter.type = 'bandpass'; filter.frequency.value = 2400; filter.Q.value = 0.65; gain.gain.value = 0.28;
                source.connect(filter).connect(gain).connect(audioContext.destination);
                source.onended = function () { source.disconnect(); filter.disconnect(); gain.disconnect(); };
                source.start();
            } catch (_error) {}
        }
        var wheel = node('recording-duration-wheel');
        function updateWheel() {
            var previous = wheelIndex;
            wheelIndex = Math.max(0, Math.min(54, Math.round(wheel.scrollTop / 44)));
            root.querySelectorAll('[data-duration-index]').forEach(function (row) { row.classList.toggle('is-selected', Number(row.getAttribute('data-duration-index')) === wheelIndex); });
            var minutes = 3 + wheelIndex / 2;
            wheel.setAttribute('aria-valuenow', String(minutes)); wheel.setAttribute('aria-valuetext', minutes + ' minutes');
            if (previous !== wheelIndex) playWheelTick();
        }
        function moveWheel(index) {
            var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            wheel.scrollTo({ top: Math.max(0, Math.min(54, index)) * 44, behavior: reduced ? 'instant' : 'smooth' });
        }
        function closePicker() {
            wheelSoundEnabled = false; if (node('recording-duration-dialog').open) node('recording-duration-dialog').close();
            if (!destroyed) node('recording-adjust-duration').focus({ preventScroll: true });
        }
        node('recording-adjust-duration').addEventListener('click', function () {
            if (state !== 'ready') return;
            wheelSoundEnabled = false; prepareWheelAudio(); node('recording-duration-dialog').showModal();
            wheel.scrollTop = (currentTarget() / 60 - 3) * 88; updateWheel(); wheel.focus({ preventScroll: true });
            window.requestAnimationFrame(function () { wheelSoundEnabled = !destroyed && node('recording-duration-dialog').open; });
        });
        wheel.addEventListener('scroll', updateWheel, { passive: true });
        wheel.addEventListener('keydown', function (event) {
            var jumps = { ArrowDown: 1, ArrowUp: -1, PageDown: 5, PageUp: -5 };
            if (event.key in jumps) { event.preventDefault(); moveWheel(wheelIndex + jumps[event.key]); }
            else if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); moveWheel(event.key === 'Home' ? 0 : 54); }
            else if (event.key === 'Enter') { event.preventDefault(); saveDuration(); }
        });
        root.querySelectorAll('[data-duration-index]').forEach(function (row) { row.addEventListener('click', function () { moveWheel(Number(row.getAttribute('data-duration-index'))); }); });
        function saveDuration() { updateWheel(); node('recording-duration').value = String(3 + wheelIndex / 2); currentTarget(); closePicker(); }
        node('recording-duration-done').addEventListener('click', saveDuration);
        node('recording-duration-cancel').addEventListener('click', closePicker);
        node('recording-duration-dialog').addEventListener('cancel', function (event) { if (event.target !== node('recording-duration-dialog')) return; event.preventDefault(); closePicker(); });
        node('recording-live').addEventListener('cancel', function (event) {
            if (event.target !== node('recording-live')) return;
            event.preventDefault();
            if (returnToOrigin || state === 'ready' || state === 'review') backBeforeRecording();
            else if (state === 'countdown' || state === 'requesting') finishRecording();
        });
        node('recording-back').addEventListener('click', backBeforeRecording);
        node('record-now').addEventListener('click', openReady);
        node('stop-recording').addEventListener('click', function () { if (state === 'ready') startRecording(); else finishRecording(); });
        node('recording-duration').addEventListener('change', function () { currentTarget(); });
        node('recording-date').addEventListener('change', function () { if (options.onDateChange) options.onDateChange(node('recording-date').value); });
        node('audio-file').addEventListener('change', function () { var file = node('audio-file').files[0]; node('audio-file').value = ''; prepareFile(file); });
        node('recording-upload-option').addEventListener('click', function () { if (state === 'ready') node('live-audio-file').click(); });
        node('live-audio-file').addEventListener('change', function () { var file = node('live-audio-file').files[0]; node('live-audio-file').value = ''; prepareFile(file); });
        node('preview-recording').addEventListener('click', togglePreview);
        node('replace-recording').addEventListener('click', function () { if (window.confirm('Replace this recording? The current copy has not been uploaded.')) { var restore = returnToOrigin; discard(); openReady({ onBack: restore }); } });
        node('upload-recording').addEventListener('click', function () { if (state !== 'review' && state !== 'analysis_retry') return; stopPreview(); currentTarget(); if (options.onUpload) options.onUpload(snapshot()); });
        currentTarget(); setState('idle');
        return { start: openReady, finish: finishRecording, discard: discard, prepareFile: prepareFile, stopPreview: stopPreview,
            snapshot: snapshot, locked: locked, target: currentTarget, setState: setState,
            clear: function () { discard(); },
            destroy: function () { if (node('recording-live').open) node('recording-live').close(); destroyed = true; wakeLock.destroy(); generation += 1; stopHardware(); stopPreview(); wheelSoundEnabled = false; if (node('recording-duration-dialog').open) node('recording-duration-dialog').close(); if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true }); } };
    }
    window.MrCatSpeakingRecorder = { markup: markup, create: create, normaliseTarget: normaliseTarget, timeline: timeline, timeText: timeText };
})(window);
