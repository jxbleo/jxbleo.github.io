(function (window) {
    'use strict';

    var TARGET_SAMPLE_RATE = 16000;
    var DEFAULT_MAX_SECONDS = 20;

    function mergeBuffers(buffers, length) {
        var output = new Float32Array(length);
        var offset = 0;
        buffers.forEach(function (buffer) {
            output.set(buffer, offset);
            offset += buffer.length;
        });
        return output;
    }

    function downsample(input, inputRate, outputRate) {
        if (inputRate === outputRate) return input;
        if (outputRate > inputRate) throw new Error('VOICEPRINT_SAMPLE_RATE_UNSUPPORTED');
        var ratio = inputRate / outputRate;
        var length = Math.max(1, Math.round(input.length / ratio));
        var output = new Float32Array(length);
        for (var index = 0; index < length; index += 1) {
            var start = Math.floor(index * ratio);
            var end = Math.min(input.length, Math.floor((index + 1) * ratio));
            var total = 0;
            var count = 0;
            for (var sourceIndex = start; sourceIndex < end; sourceIndex += 1) {
                total += input[sourceIndex];
                count += 1;
            }
            output[index] = count ? total / count : input[Math.min(start, input.length - 1)] || 0;
        }
        return output;
    }

    function writeAscii(view, offset, value) {
        for (var index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
    }

    function encodeWav(samples) {
        var buffer = new ArrayBuffer(44 + samples.length * 2);
        var view = new DataView(buffer);
        writeAscii(view, 0, 'RIFF');
        view.setUint32(4, 36 + samples.length * 2, true);
        writeAscii(view, 8, 'WAVE');
        writeAscii(view, 12, 'fmt ');
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, 1, true);
        view.setUint32(24, TARGET_SAMPLE_RATE, true);
        view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
        view.setUint16(32, 2, true);
        view.setUint16(34, 16, true);
        writeAscii(view, 36, 'data');
        view.setUint32(40, samples.length * 2, true);
        var offset = 44;
        for (var index = 0; index < samples.length; index += 1) {
            var sample = Math.max(-1, Math.min(1, samples[index]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
        return new Blob([view], { type: 'audio/wav' });
    }

    function blobToBase64(blob) {
        return new Promise(function (resolve, reject) {
            var reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result || '').split(',').pop()); };
            reader.onerror = function () { reject(new Error('VOICEPRINT_AUDIO_ENCODING_FAILED')); };
            reader.readAsDataURL(blob);
        });
    }

    function start(options) {
        options = options || {};
        var AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !AudioContextClass) {
            return Promise.reject(new Error('VOICEPRINT_RECORDER_UNAVAILABLE'));
        }
        var maxSeconds = Math.min(30, Math.max(8, Number(options.maxSeconds || DEFAULT_MAX_SECONDS)));
        return navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } }).then(function (stream) {
            var context = new AudioContextClass();
            var source = context.createMediaStreamSource(stream);
            var processor = context.createScriptProcessor(4096, 1, 1);
            var buffers = [];
            var length = 0;
            var startedAt = performance.now();
            var timer = 0;
            var stopped = false;
            var stopping = null;

            processor.onaudioprocess = function (event) {
                if (stopped) return;
                var input = event.inputBuffer.getChannelData(0);
                var copy = new Float32Array(input.length);
                copy.set(input);
                buffers.push(copy);
                length += copy.length;
                var output = event.outputBuffer && event.outputBuffer.getChannelData(0);
                if (output) output.fill(0);
            };
            source.connect(processor);
            processor.connect(context.destination);

            function elapsedSeconds() {
                return Math.max(0, (performance.now() - startedAt) / 1000);
            }

            function cleanup() {
                if (timer) window.clearInterval(timer);
                timer = 0;
                try { processor.disconnect(); } catch (_error) {}
                try { source.disconnect(); } catch (_error) {}
                stream.getTracks().forEach(function (track) { track.stop(); });
            }

            var controller = {
                elapsedSeconds: elapsedSeconds,
                cancel: function () {
                    if (stopped) return;
                    stopped = true;
                    buffers = [];
                    length = 0;
                    cleanup();
                    if (context.close) context.close().catch(function () {});
                },
                stop: function () {
                    if (stopping) return stopping;
                    if (stopped) return Promise.reject(new Error('VOICEPRINT_RECORDER_STOPPED'));
                    stopped = true;
                    var durationMs = Math.round(elapsedSeconds() * 1000);
                    var inputRate = context.sampleRate;
                    cleanup();
                    var merged = mergeBuffers(buffers, length);
                    buffers = [];
                    length = 0;
                    var samples = downsample(merged, inputRate, TARGET_SAMPLE_RATE);
                    var blob = encodeWav(samples);
                    stopping = blobToBase64(blob).then(function (base64) {
                        if (context.close) context.close().catch(function () {});
                        return { blob: blob, base64: base64, duration_ms: durationMs, sample_rate: TARGET_SAMPLE_RATE, mime_type: 'audio/wav' };
                    });
                    return stopping;
                }
            };

            timer = window.setInterval(function () {
                var elapsed = elapsedSeconds();
                if (typeof options.onProgress === 'function') options.onProgress(elapsed, maxSeconds);
                if (elapsed >= maxSeconds) {
                    controller.stop().then(function (result) {
                        if (typeof options.onReady === 'function') options.onReady(result);
                    }).catch(function (error) {
                        if (typeof options.onError === 'function') options.onError(error);
                    });
                }
            }, 200);
            if (context.state === 'suspended' && context.resume) context.resume().catch(function () {});
            return controller;
        });
    }

    window.MrCatVoiceprintRecorder = {
        start: start,
        targetSampleRate: TARGET_SAMPLE_RATE,
        _test: { downsample: downsample, encodeWav: encodeWav }
    };
})(window);
