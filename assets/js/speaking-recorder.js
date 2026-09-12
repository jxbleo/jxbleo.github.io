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
    function timeline(elapsed, target) {
        var ending = elapsed >= target;
        var remaining = Math.max(0, (ending ? target + 5 : target) - elapsed);
        var minute = !ending && remaining <= 60;
        return { ending: ending, remaining: remaining, fraction: remaining / (ending ? 5 : minute ? 60 : target),
            tick: ending ? Math.ceil(remaining) : null, minute: minute, finished: elapsed >= target + 5 };
    }
    function liveMarkup() {
        return '<dialog class="speaking-recording-state speaking-recording-live" id="recording-live" hidden role="dialog" aria-modal="true" aria-label="Discussion recording">' +
            '<div class="speaking-recording-live-label"><span aria-hidden="true"></span><strong id="recording-live-status">Recording</strong></div>' +
            '<div class="speaking-recording-live-content"><div class="speaking-recording-dial" id="recording-dial">' +
            '<svg viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="recording-ring-gradient" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#7ecddd"/><stop offset="1" stop-color="#62bfae"/></linearGradient></defs><circle class="speaking-recording-ring-inner" cx="100" cy="100" r="92"/><circle class="speaking-recording-ring-track" cx="100" cy="100" r="97"/><circle class="speaking-recording-ring-progress" id="recording-ring-progress" cx="100" cy="100" r="97" pathLength="1" stroke-dasharray="1"/></svg>' +
            '<div class="speaking-recording-dial-center"><div class="speaking-recording-countdown" id="recording-countdown" role="timer" aria-label="Countdown" hidden>5</div><div class="speaking-recording-time" id="recording-time" role="timer" aria-label="Time remaining">08:00</div>' +
            '<div class="speaking-recording-waveform" id="recording-waveform" aria-hidden="true">' + Array.from({ length: 48 }, function (_, index) {
                var colors = ['#f26769', '#f59b50', '#e3bd39', '#8dc653', '#44bba0', '#42bbd4', '#5c95e8', '#8079da', '#b675d5'];
                return '<i class="speaking-recording-wave-bar" style="--wave-color:' + colors[Math.floor(index / 48 * colors.length)] + '"></i>';
            }).join('') + '</div></div></div>' +
            '<button class="speaking-finish-recording" id="stop-recording" type="button">Finish</button></div>' +
            '<p class="speaking-quality-warning" id="quality-warning" role="status" aria-live="polite"></p></dialog>';
    }
    function markup(options) {
        options = options || {};
        var item = { duration_seconds: normaliseTarget(options.targetSeconds), discussion_date: options.date || shanghaiToday() };
        var canRecord = true;
        var targetMinutes = item.duration_seconds / 60;
        var recording = canRecord ? '<section class="speaking-section-card speaking-recording-card" data-recording-state="idle"><header><div><h3>Record the Discussion</h3><p>Record here or choose one audio file. Nothing is uploaded until you confirm.</p></div><span class="speaking-pill" id="recording-target-pill">Target ' + esc(targetMinutes % 1 ? targetMinutes.toFixed(1) : targetMinutes) + ' min</span></header>' +
            '<div class="speaking-recording-state" id="recording-ready"><div class="speaking-recording-settings"><label>Target length<div class="speaking-duration-field"><input id="recording-duration" type="number" min="3" max="30" step="0.5" value="' + esc(targetMinutes) + '" inputmode="decimal"><span>minutes</span></div></label></div><div class="speaking-recording-choice"><button class="primary-button" type="button" id="record-now">Record on this device</button><label class="outline-button speaking-file-button" id="audio-file-label">Choose audio file<input type="file" accept="audio/*" hidden id="audio-file"></label><label class="speaking-audio-date"><span>Audio date</span><input id="recording-date" type="date" value="' + esc(item.discussion_date || shanghaiToday()) + '"></label></div><p class="speaking-recording-note">Device recordings use today. For an existing audio file, choose the date it was recorded.</p><p class="speaking-quality-warning" id="recording-message" role="status" aria-live="polite"></p></div>' +
            liveMarkup() +
            '<div class="speaking-recording-state speaking-recording-review" id="recording-review" hidden><div class="speaking-recording-ready-mark" aria-hidden="true">✓</div><h4>Recording ready</h4><p id="recording-review-copy">Listen once if you want to check it, then upload and start the analysis.</p><div class="speaking-detail-actions"><button class="outline-button" type="button" id="preview-recording">Play recording</button><button class="outline-button" type="button" id="replace-recording">Replace recording</button><button class="primary-button" type="button" id="upload-recording">Upload &amp; analyse</button></div></div>' +
            '<div class="speaking-recording-state speaking-recording-uploading" id="recording-uploading" hidden aria-live="polite" aria-busy="true"><span class="speaking-upload-spinner" aria-hidden="true"></span><h4>Uploading securely</h4><p>Keep this page open. Analysis will begin automatically.</p><div class="speaking-upload-progress-track" role="progressbar" aria-label="Secure upload in progress"><span></span></div></div></section>' : '';
        return recording;
    }
    function create(root, options) {
        options = options || {};
        var state = 'idle', blob = null, operationId = '', target = 480;
        var stream = null, recorder = null, chunks = [], generation = 0;
        var timer = 0, startedAt = 0, countdownAt = 0, lastTick = -1, minutePlayed = false;
        var audioContext = null, analyser = null, frame = 0, speechTimeout = 0, speechResolve = null;
        var previewAudio = null, previewUrl = '', qualityIssue = '', badSince = 0, recoverySince = 0;
        var destroyed = false, previousFocus = null;
        function node(id) { return root.querySelector('#' + id); }
        function snapshot() { return { state: state, blob: blob, operationId: operationId, targetSeconds: target, date: node('recording-date').value }; }
        function locked() { return ['requesting', 'countdown', 'recording', 'ending', 'stopping', 'uploading'].indexOf(state) !== -1; }
        function notify() { if (options.onStateChange) options.onStateChange(snapshot()); }
        function warning(copy) { node('quality-warning').textContent = copy || ''; }
        function message(copy) { node('recording-message').textContent = copy || ''; }
        function setState(next, copy) {
            var wasLive = !node('recording-live').hidden;
            state = next;
            root.setAttribute('data-recording-state', next);
            node('recording-ready').hidden = next !== 'idle';
            node('recording-live').hidden = ['requesting', 'countdown', 'recording', 'ending', 'stopping'].indexOf(next) < 0;
            if (!wasLive && !node('recording-live').hidden) node('recording-live').showModal();
            else if (wasLive && node('recording-live').hidden && node('recording-live').open) node('recording-live').close();
            node('recording-review').hidden = next !== 'review' && next !== 'analysis_retry';
            node('recording-uploading').hidden = next !== 'uploading';
            node('recording-countdown').hidden = next !== 'countdown' && next !== 'ending';
            node('recording-time').hidden = next === 'countdown' || next === 'ending';
            node('recording-waveform').hidden = next !== 'recording';
            node('recording-live-status').textContent = { requesting: 'Starting microphone', countdown: 'Get ready', recording: 'Recording', ending: 'Finishing', stopping: 'Finishing recording' }[next] || 'Recording';
            node('recording-dial').classList.toggle('is-countdown', next === 'countdown' || next === 'ending');
            node('recording-dial').classList.toggle('is-ending', next === 'ending');
            node('recording-live').classList.toggle('is-ending', next === 'ending');
            if (next !== 'recording') {
                node('recording-dial').classList.remove('is-minute');
                node('recording-live').classList.remove('is-minute');
            }
            node('stop-recording').textContent = 'Finish';
            node('stop-recording').disabled = next === 'stopping';
            node('preview-recording').hidden = next === 'analysis_retry';
            node('replace-recording').hidden = next === 'analysis_retry';
            node('upload-recording').textContent = next === 'analysis_retry' ? 'Retry analysis' : 'Upload & analyse';
            node('upload-recording').disabled = next === 'uploading';
            if (copy != null) {
                if (next === 'idle') message(copy);
                else if (next === 'review' || next === 'analysis_retry') node('recording-review-copy').textContent = copy;
                else if (next === 'uploading') node('recording-uploading').querySelector('p').textContent = copy;
                else warning(copy);
            }
            if (!wasLive && !node('recording-live').hidden) {
                previousFocus = document.activeElement;
                node('stop-recording').focus({ preventScroll: true });
            } else if (wasLive && node('recording-live').hidden && next !== 'uploading') {
                var focusTarget = next === 'review' ? node('preview-recording') : node('record-now');
                focusTarget.focus({ preventScroll: true });
            }
            notify();
        }
        function currentTarget() {
            target = normaliseTarget(Number(node('recording-duration').value || 8) * 60);
            node('recording-duration').value = String(target / 60);
            node('recording-target-pill').textContent = 'Target ' + (target / 60) + ' min';
            return target;
        }
        function stopPreview() {
            if (previewAudio) { previewAudio.pause(); previewAudio.removeAttribute('src'); previewAudio.load(); }
            previewAudio = null;
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = '';
            node('preview-recording').textContent = 'Play recording';
        }
        function cancelSpeech() {
            if (speechTimeout) window.clearTimeout(speechTimeout);
            speechTimeout = 0;
            if (speechResolve) {
                var resolve = speechResolve; speechResolve = null;
                if (window.speechSynthesis) window.speechSynthesis.cancel();
                resolve(false);
            }
        }
        function stopHardware() {
            if (timer) window.clearInterval(timer);
            timer = 0;
            cancelSpeech();
            if (frame) window.cancelAnimationFrame(frame);
            frame = 0;
            var oldRecorder = recorder; recorder = null;
            if (oldRecorder && oldRecorder.state !== 'inactive') { try { oldRecorder.stop(); } catch (_error) {} }
            var oldStream = stream; stream = null;
            if (oldStream) oldStream.getTracks().forEach(function (track) { track.stop(); });
            analyser = null;
            if (audioContext && audioContext.close) audioContext.close().catch(function () {});
            audioContext = null;
        }
        function discard() {
            generation += 1;
            stopHardware(); stopPreview();
            blob = null; chunks = []; operationId = ''; startedAt = 0;
            setState('idle', '');
        }
        function failure(copy) {
            generation += 1;
            stopHardware(); blob = null; chunks = []; operationId = '';
            setState('idle', copy);
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
                oscillator.onended = function () { oscillator.disconnect(); gain.disconnect(); };
            } catch (_error) {}
        }
        function speakOpening(captureGeneration) {
            return new Promise(function (resolve) {
                if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { resolve(true); return; }
                speechResolve = resolve;
                function finishSpeech() {
                    if (captureGeneration !== generation || speechResolve !== resolve) return;
                    var done = speechResolve; speechResolve = null;
                    window.clearTimeout(speechTimeout); speechTimeout = 0;
                    done(captureGeneration === generation && !destroyed);
                }
                try {
                    var speech = new window.SpeechSynthesisUtterance('The discussion will begin in five seconds.');
                    speech.lang = 'en-GB'; speech.rate = 0.95;
                    var voices = window.speechSynthesis.getVoices();
                    speech.voice = voices.find(function (voice) { return voice.lang === 'en-GB'; }) || voices.find(function (voice) { return /^en[-_]/i.test(voice.lang); }) || null;
                    speech.onend = finishSpeech; speech.onerror = finishSpeech;
                    speechTimeout = window.setTimeout(function () { window.speechSynthesis.cancel(); finishSpeech(); }, 6500);
                    window.speechSynthesis.speak(speech);
                } catch (_error) { finishSpeech(); }
            });
        }
        function paintRing(fraction) { node('recording-ring-progress').style.strokeDashoffset = String(1 - Math.max(0, Math.min(1, fraction))); }
        function monitorQuality(captureGeneration) {
            if (!audioContext) return;
            try {
                analyser = audioContext.createAnalyser(); analyser.fftSize = 2048;
                audioContext.createMediaStreamSource(stream).connect(analyser);
                var samples = new Float32Array(analyser.fftSize), bars = root.querySelectorAll('.speaking-recording-wave-bar');
                var qualityReadyAt = performance.now() + 5000;
                qualityIssue = ''; badSince = 0; recoverySince = 0;
                function draw(now) {
                    if (!analyser || captureGeneration !== generation) return;
                    analyser.getFloatTimeDomainData(samples);
                    var sum = 0, clipped = 0;
                    for (var i = 0; i < samples.length; i += 1) { sum += samples[i] * samples[i]; if (Math.abs(samples[i]) >= 0.98) clipped += 1; }
                    var rms = Math.sqrt(sum / samples.length);
                    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                    bars.forEach(function (bar, index) {
                        var sample = samples[Math.min(samples.length - 1, Math.floor((index + 0.5) * samples.length / bars.length))];
                        var input = reduced ? rms * 3.2 : Math.max(Math.abs(sample) * 5.5, rms * 4.2);
                        var centre = 0.7 + 0.3 * Math.sin(Math.PI * (index + 1) / (bars.length + 1));
                        bar.style.transform = 'scaleY(' + Math.max(0.1, Math.min(1, (0.1 + input) * centre)).toFixed(3) + ')';
                    });
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
            if (state === 'requesting' || state === 'countdown') { discard(); return; }
            if (!recorder || recorder.state === 'inactive' || (state !== 'recording' && state !== 'ending')) return;
            if ((performance.now() - startedAt) / 1000 < Math.min(60, target / 2) && !window.confirm('Finish this recording early?')) return;
            stopTake();
        }
        function stopTake() {
            if (!recorder || recorder.state === 'inactive') return;
            setState('stopping', '');
            try { if (recorder.requestData) recorder.requestData(); recorder.stop(); }
            catch (_error) { failure('The browser could not finish this recording. Please try again.'); }
        }
        function runTake(captureGeneration, device) {
            if (captureGeneration !== generation || recorder !== device) return;
            try { device.start(1000); } catch (_error) { failure('This browser could not begin recording. Choose an audio file instead.'); return; }
            startedAt = performance.now(); minutePlayed = false; lastTick = -1;
            setState('recording', '');
            function tick() {
                if (captureGeneration !== generation || recorder !== device) return;
                var current = timeline((performance.now() - startedAt) / 1000, target);
                if (current.finished) { stopTake(); return; }
                if (current.ending) {
                    if (state !== 'ending') setState('ending', '');
                    node('recording-countdown').textContent = String(current.tick);
                    if (current.tick > 0 && current.tick !== lastTick) { beep(current.tick === 1); lastTick = current.tick; }
                } else {
                    node('recording-time').textContent = timeText(current.remaining);
                    node('recording-dial').classList.toggle('is-minute', current.minute);
                    node('recording-live').classList.toggle('is-minute', current.minute);
                    if (current.minute && !minutePlayed) {
                        minutePlayed = true;
                        for (var cue = 0; cue < 3; cue += 1) beep(false, 2, cue * 0.55);
                    }
                }
                paintRing(current.fraction);
            }
            tick(); timer = window.setInterval(tick, 50);
        }
        function startRecording() {
            if (state !== 'idle' || destroyed) return;
            if (options.canStart && !options.canStart()) return;
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { message('Recording is unavailable here. Choose an audio file instead.'); return; }
            stopPreview(); currentTarget();
            blob = null; operationId = ''; chunks = [];
            node('recording-date').value = shanghaiToday();
            if (options.onDateChange) options.onDateChange(node('recording-date').value);
            if (options.onTargetChange) options.onTargetChange(target);
            message(''); warning(''); paintRing(1); node('recording-time').textContent = timeText(target);
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
                    if (!blob.size) { blob = null; setState('idle', 'No audio was captured. Check the microphone and try again.'); return; }
                    operationId = 'speaking-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
                    setState('review', 'Listen once if you want to check it, then upload and start the analysis.');
                };
                input.getTracks().forEach(function (track) { track.addEventListener('ended', function () {
                    if (captureGeneration !== generation || recorder !== device) return;
                    if (state === 'requesting' || state === 'countdown') failure('The microphone signal ended before recording began. Please try again.');
                    else stopTake();
                }); });
                monitorQuality(captureGeneration);
                node('recording-countdown').textContent = '5'; paintRing(1); setState('countdown');
                speakOpening(captureGeneration).then(function (ready) {
                    if (!ready || captureGeneration !== generation || state !== 'countdown') return;
                    countdownAt = performance.now(); lastTick = -1;
                    function tick() {
                        if (captureGeneration !== generation) return;
                        var remaining = Math.max(0, 5 - (performance.now() - countdownAt) / 1000);
                        if (!remaining) { window.clearInterval(timer); timer = 0; runTake(captureGeneration, device); return; }
                        var second = Math.ceil(remaining);
                        node('recording-countdown').textContent = String(second); paintRing(remaining / 5);
                        if (second !== lastTick) { beep(second === 1); lastTick = second; }
                    }
                    tick(); timer = window.setInterval(tick, 50);
                });
            }).catch(function (error) {
                if (captureGeneration !== generation) return;
                var denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
                failure(denied ? 'Microphone access was not allowed. You can still choose an audio file.' : 'The microphone could not start. Check the input or choose an audio file.');
            });
        }
        function prepareFile(file) {
            if (!file || state !== 'idle') return;
            if ((file.type && !/^audio\//i.test(file.type)) || file.size < 1 || file.size > 120 * 1024 * 1024) { message('Choose an audio file no larger than 120 MB.'); return; }
            currentTarget(); stopPreview(); blob = file;
            operationId = 'speaking-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
            setState('review', (file.name || 'Your audio file') + ' is ready. Play it to check it, then upload and start the analysis.');
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
        node('recording-live').addEventListener('cancel', function (event) { event.preventDefault(); });
        node('record-now').addEventListener('click', startRecording);
        node('stop-recording').addEventListener('click', finishRecording);
        node('recording-duration').addEventListener('change', function () { currentTarget(); });
        node('recording-date').addEventListener('change', function () { if (options.onDateChange) options.onDateChange(node('recording-date').value); });
        node('audio-file').addEventListener('change', function () { var file = node('audio-file').files[0]; node('audio-file').value = ''; prepareFile(file); });
        node('preview-recording').addEventListener('click', togglePreview);
        node('replace-recording').addEventListener('click', function () { if (window.confirm('Replace this recording? The current copy has not been uploaded.')) discard(); });
        node('upload-recording').addEventListener('click', function () { if (state !== 'review' && state !== 'analysis_retry') return; stopPreview(); currentTarget(); if (options.onUpload) options.onUpload(snapshot()); });
        function keepFocus(event) {
            if (!node('recording-live').hidden && event.key === 'Tab') { event.preventDefault(); node('stop-recording').focus(); }
        }
        root.addEventListener('keydown', keepFocus);
        currentTarget(); setState('idle');
        return { start: startRecording, finish: finishRecording, discard: discard, prepareFile: prepareFile, stopPreview: stopPreview,
            snapshot: snapshot, locked: locked, target: currentTarget, setState: setState,
            clear: function () { discard(); },
            destroy: function () { if (node('recording-live').open) node('recording-live').close(); destroyed = true; generation += 1; stopHardware(); stopPreview(); root.removeEventListener('keydown', keepFocus); if (previousFocus && previousFocus.isConnected) previousFocus.focus({ preventScroll: true }); } };
    }
    window.MrCatSpeakingRecorder = { markup: markup, create: create, normaliseTarget: normaliseTarget, timeline: timeline, timeText: timeText };
})(window);
