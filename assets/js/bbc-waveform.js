(function(global) {
    'use strict';

    var DEFAULT_ZOOM_LEVELS = [1, 2, 4, 8];
    var MAX_PEAKS = 12000;
    var TOUCH_SEEK_THRESHOLD = 10;

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function formatTime(seconds) {
        if (!isFinite(seconds) || seconds < 0) seconds = 0;
        var rounded = Math.floor(seconds);
        var minutes = Math.floor(rounded / 60);
        var secs = rounded % 60;
        return minutes + ':' + String(secs).padStart(2, '0');
    }

    function makePeaks(audioBuffer, peakCount) {
        var length = audioBuffer && audioBuffer.length || 0;
        var channelCount = audioBuffer && audioBuffer.numberOfChannels || 0;
        var count = Math.max(1, Math.min(MAX_PEAKS, peakCount || MAX_PEAKS, length || 1));
        var peaks = new Float32Array(count);
        if (!length || !channelCount) return peaks;

        var bucketSize = length / count;
        for (var peakIndex = 0; peakIndex < count; peakIndex++) {
            var start = Math.floor(peakIndex * bucketSize);
            var end = Math.min(length, Math.max(start + 1, Math.floor((peakIndex + 1) * bucketSize)));
            var stride = Math.max(1, Math.floor((end - start) / 64));
            var peak = 0;
            for (var channelIndex = 0; channelIndex < channelCount; channelIndex++) {
                var channel = audioBuffer.getChannelData(channelIndex);
                for (var sampleIndex = start; sampleIndex < end; sampleIndex += stride) {
                    var amplitude = Math.abs(channel[sampleIndex] || 0);
                    if (amplitude > peak) peak = amplitude;
                }
            }
            peaks[peakIndex] = peak;
        }
        return peaks;
    }

    function waveformTimeFromClientX(clientX, contentRect, duration) {
        if (!contentRect || !contentRect.width || !duration) return 0;
        var ratio = clamp((clientX - contentRect.left) / contentRect.width, 0, 1);
        return ratio * duration;
    }

    function BbcWaveform(options) {
        options = options || {};
        this.audio = options.audio;
        this.viewport = options.viewport;
        this.content = options.content;
        this.baseCanvas = options.baseCanvas;
        this.playedCanvas = options.playedCanvas;
        this.playedClip = options.playedClip;
        this.playhead = options.playhead;
        this.status = options.status;
        this.zoomOutButton = options.zoomOutButton;
        this.zoomInButton = options.zoomInButton;
        this.zoomLabel = options.zoomLabel;
        this.onSeekStart = options.onSeekStart || function() {};
        this.onSeekEnd = options.onSeekEnd || function() {};
        this.zoomLevels = options.zoomLevels || DEFAULT_ZOOM_LEVELS.slice();
        this.zoomIndex = 0;
        this.peaks = null;
        this.destroyed = false;
        this.abortController = null;
        this.resizeObserver = null;
        this.draggingPointerId = null;
        this.touchStart = null;
        this.lastManualScrollAt = 0;
        this.renderFrame = 0;
        this.playbackFrame = 0;
        this.bound = {};
    }

    BbcWaveform.prototype.init = function() {
        if (!this.audio || !this.viewport || !this.content) return;
        this.bindEvents();
        this.setZoom(0, false);
        this.sync();
    };

    BbcWaveform.prototype.bindEvents = function() {
        var self = this;
        this.bound.pointerDown = function(event) { self.handlePointerDown(event); };
        this.bound.pointerMove = function(event) { self.handlePointerMove(event); };
        this.bound.pointerUp = function(event) { self.handlePointerUp(event); };
        this.bound.keyDown = function(event) { self.handleKeyDown(event); };
        this.bound.scroll = function() { self.lastManualScrollAt = Date.now(); };
        this.bound.zoomOut = function() { self.changeZoom(-1); };
        this.bound.zoomIn = function() { self.changeZoom(1); };
        this.bound.play = function() { self.startPlaybackSync(); };
        this.bound.pause = function() { self.stopPlaybackSync(); self.sync(); };

        this.viewport.addEventListener('pointerdown', this.bound.pointerDown);
        this.viewport.addEventListener('pointermove', this.bound.pointerMove);
        this.viewport.addEventListener('pointerup', this.bound.pointerUp);
        this.viewport.addEventListener('pointercancel', this.bound.pointerUp);
        this.viewport.addEventListener('keydown', this.bound.keyDown);
        this.viewport.addEventListener('scroll', this.bound.scroll, { passive: true });
        if (this.zoomOutButton) this.zoomOutButton.addEventListener('click', this.bound.zoomOut);
        if (this.zoomInButton) this.zoomInButton.addEventListener('click', this.bound.zoomIn);
        this.audio.addEventListener('play', this.bound.play);
        this.audio.addEventListener('pause', this.bound.pause);
        this.audio.addEventListener('ended', this.bound.pause);

        if (global.ResizeObserver) {
            this.resizeObserver = new ResizeObserver(function() { self.scheduleRender(); });
            this.resizeObserver.observe(this.viewport);
        } else {
            this.bound.resize = function() { self.scheduleRender(); };
            global.addEventListener('resize', this.bound.resize);
        }
    };

    BbcWaveform.prototype.load = function(sourceUrl) {
        var self = this;
        if (!sourceUrl || !global.fetch) {
            this.setStatus('Waveform unavailable');
            return Promise.resolve(false);
        }
        if (this.abortController) this.abortController.abort();
        this.abortController = global.AbortController ? new AbortController() : null;
        this.peaks = null;
        this.setStatus('Loading waveform…');
        this.scheduleRender();

        var fetchOptions = { credentials: 'same-origin' };
        if (this.abortController) fetchOptions.signal = this.abortController.signal;

        return global.fetch(sourceUrl, fetchOptions)
            .then(function(response) {
                if (!response.ok) throw new Error('Audio request failed: ' + response.status);
                return response.arrayBuffer();
            })
            .then(function(encodedAudio) {
                var AudioContextClass = global.AudioContext || global.webkitAudioContext;
                if (!AudioContextClass) throw new Error('Web Audio is unavailable');
                var context = new AudioContextClass();
                return context.decodeAudioData(encodedAudio)
                    .then(function(decodedAudio) {
                        if (self.destroyed) return false;
                        self.peaks = makePeaks(decodedAudio, MAX_PEAKS);
                        self.setStatus('');
                        self.scheduleRender();
                        return true;
                    })
                    .finally(function() {
                        if (context.close) context.close().catch(function() {});
                    });
            })
            .catch(function(error) {
                if (error && error.name === 'AbortError') return false;
                self.setStatus('Waveform unavailable — timeline still works');
                self.scheduleRender();
                return false;
            });
    };

    BbcWaveform.prototype.setStatus = function(message) {
        if (!this.status) return;
        this.status.textContent = message || '';
        this.status.hidden = !message;
    };

    BbcWaveform.prototype.scheduleRender = function() {
        var self = this;
        if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
        this.renderFrame = requestAnimationFrame(function() {
            self.renderFrame = 0;
            self.render();
        });
    };

    BbcWaveform.prototype.startPlaybackSync = function() {
        var self = this;
        if (this.playbackFrame) return;
        function tick() {
            self.playbackFrame = 0;
            if (self.destroyed || self.audio.paused || self.audio.ended) return;
            self.sync();
            self.playbackFrame = requestAnimationFrame(tick);
        }
        this.playbackFrame = requestAnimationFrame(tick);
    };

    BbcWaveform.prototype.stopPlaybackSync = function() {
        if (!this.playbackFrame) return;
        cancelAnimationFrame(this.playbackFrame);
        this.playbackFrame = 0;
    };

    BbcWaveform.prototype.render = function() {
        if (!this.viewport || !this.content) return;
        var width = Math.max(1, Math.round(this.viewport.clientWidth * this.zoomLevels[this.zoomIndex]));
        var height = Math.max(1, Math.round(this.viewport.clientHeight));
        this.content.style.width = width + 'px';
        this.drawCanvas(this.baseCanvas, width, height, false);
        this.drawCanvas(this.playedCanvas, width, height, true);
        this.sync();
    };

    BbcWaveform.prototype.drawCanvas = function(canvas, width, height, played) {
        if (!canvas) return;
        var pixelRatio = Math.min(2, global.devicePixelRatio || 1);
        canvas.width = Math.round(width * pixelRatio);
        canvas.height = Math.round(height * pixelRatio);
        canvas.style.width = width + 'px';
        canvas.style.height = height + 'px';
        var context = canvas.getContext('2d');
        if (!context) return;
        context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
        context.clearRect(0, 0, width, height);

        var style = getComputedStyle(this.content);
        var color = style.getPropertyValue(played ? '--waveform-played' : '--waveform-base').trim();
        context.fillStyle = color || (played ? '#ffffff' : 'rgba(255,255,255,0.42)');
        var center = height / 2;
        var maxHalfHeight = Math.max(2, center - 4);
        var barWidth = width < 520 ? 1 : 1.5;
        var gap = width < 520 ? 1 : 1.25;
        var step = barWidth + gap;
        var barCount = Math.max(1, Math.floor(width / step));

        for (var index = 0; index < barCount; index++) {
            var amplitude;
            if (this.peaks && this.peaks.length) {
                var peakStart = Math.floor(index / barCount * this.peaks.length);
                var peakEnd = Math.max(peakStart + 1, Math.floor((index + 1) / barCount * this.peaks.length));
                amplitude = 0;
                for (var peakIndex = peakStart; peakIndex < peakEnd && peakIndex < this.peaks.length; peakIndex++) {
                    if (this.peaks[peakIndex] > amplitude) amplitude = this.peaks[peakIndex];
                }
                amplitude = Math.pow(clamp(amplitude, 0, 1), 0.68);
            } else {
                amplitude = 0.10;
            }
            var halfHeight = Math.max(1.5, amplitude * maxHalfHeight);
            var x = Math.round(index * step);
            context.fillRect(x, center - halfHeight, barWidth, halfHeight * 2);
        }
    };

    BbcWaveform.prototype.changeZoom = function(direction) {
        this.setZoom(this.zoomIndex + direction, true);
    };

    BbcWaveform.prototype.setZoom = function(index, keepPlayheadVisible) {
        this.zoomIndex = clamp(index, 0, this.zoomLevels.length - 1);
        var zoom = this.zoomLevels[this.zoomIndex];
        if (this.zoomLabel) this.zoomLabel.textContent = zoom + '×';
        if (this.zoomOutButton) this.zoomOutButton.disabled = this.zoomIndex === 0;
        if (this.zoomInButton) this.zoomInButton.disabled = this.zoomIndex === this.zoomLevels.length - 1;
        this.scheduleRender();
        if (keepPlayheadVisible) {
            var self = this;
            requestAnimationFrame(function() { self.centerCurrentTime(); });
        }
    };

    BbcWaveform.prototype.centerCurrentTime = function() {
        var duration = this.audio.duration || 0;
        if (!duration || !this.content) return;
        var playheadX = this.audio.currentTime / duration * this.content.offsetWidth;
        this.viewport.scrollLeft = clamp(playheadX - this.viewport.clientWidth / 2, 0, this.content.offsetWidth - this.viewport.clientWidth);
    };

    BbcWaveform.prototype.seekFromClientX = function(clientX) {
        var duration = this.audio.duration || 0;
        if (!duration) return;
        var nextTime = waveformTimeFromClientX(clientX, this.content.getBoundingClientRect(), duration);
        this.audio.currentTime = nextTime;
        this.sync();
    };

    BbcWaveform.prototype.handlePointerDown = function(event) {
        if (event.button != null && event.button !== 0) return;
        this.lastManualScrollAt = Date.now();
        if (event.pointerType === 'touch') {
            this.touchStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
            return;
        }
        this.draggingPointerId = event.pointerId;
        if (this.viewport.setPointerCapture) this.viewport.setPointerCapture(event.pointerId);
        this.onSeekStart();
        this.seekFromClientX(event.clientX);
        event.preventDefault();
    };

    BbcWaveform.prototype.handlePointerMove = function(event) {
        if (this.draggingPointerId !== event.pointerId) return;
        this.seekFromClientX(event.clientX);
        event.preventDefault();
    };

    BbcWaveform.prototype.handlePointerUp = function(event) {
        if (this.touchStart && this.touchStart.id === event.pointerId) {
            var distance = Math.hypot(event.clientX - this.touchStart.x, event.clientY - this.touchStart.y);
            if (distance <= TOUCH_SEEK_THRESHOLD) {
                this.onSeekStart();
                this.seekFromClientX(event.clientX);
                this.onSeekEnd();
            }
            this.touchStart = null;
        }
        if (this.draggingPointerId === event.pointerId) {
            this.draggingPointerId = null;
            this.onSeekEnd();
        }
    };

    BbcWaveform.prototype.handleKeyDown = function(event) {
        var duration = this.audio.duration || 0;
        if (!duration) return;
        var nextTime = this.audio.currentTime || 0;
        if (event.key === 'ArrowLeft') nextTime -= event.shiftKey ? 10 : 5;
        else if (event.key === 'ArrowRight') nextTime += event.shiftKey ? 10 : 5;
        else if (event.key === 'Home') nextTime = 0;
        else if (event.key === 'End') nextTime = duration;
        else return;
        event.preventDefault();
        this.onSeekStart();
        this.audio.currentTime = clamp(nextTime, 0, duration);
        this.sync();
        this.centerCurrentTime();
        this.onSeekEnd();
    };

    BbcWaveform.prototype.sync = function() {
        if (!this.audio || !this.content) return;
        var duration = this.audio.duration || 0;
        var current = clamp(this.audio.currentTime || 0, 0, duration || 0);
        var ratio = duration ? current / duration : 0;
        if (this.playedClip) this.playedClip.style.width = (ratio * 100) + '%';
        if (this.playhead) this.playhead.style.left = (ratio * 100) + '%';
        this.viewport.setAttribute('aria-valuemax', String(Math.max(0, Math.round(duration))));
        this.viewport.setAttribute('aria-valuenow', String(Math.max(0, Math.round(current))));
        this.viewport.setAttribute('aria-valuetext', formatTime(current) + ' of ' + formatTime(duration));

        if (!this.audio.paused && Date.now() - this.lastManualScrollAt > 1800 && this.zoomIndex > 0) {
            var playheadX = ratio * this.content.offsetWidth;
            var left = this.viewport.scrollLeft;
            var right = left + this.viewport.clientWidth;
            if (playheadX > right - 32 || playheadX < left + 8) {
                this.viewport.scrollLeft = clamp(playheadX - this.viewport.clientWidth * 0.25, 0, this.content.offsetWidth - this.viewport.clientWidth);
            }
        }
    };

    BbcWaveform.prototype.destroy = function() {
        this.destroyed = true;
        if (this.abortController) this.abortController.abort();
        if (this.renderFrame) cancelAnimationFrame(this.renderFrame);
        this.stopPlaybackSync();
        if (this.resizeObserver) this.resizeObserver.disconnect();
        if (this.bound.resize) global.removeEventListener('resize', this.bound.resize);
        this.audio.removeEventListener('play', this.bound.play);
        this.audio.removeEventListener('pause', this.bound.pause);
        this.audio.removeEventListener('ended', this.bound.pause);
    };

    global.MrCatBbcWaveform = {
        BbcWaveform: BbcWaveform,
        makePeaks: makePeaks,
        waveformTimeFromClientX: waveformTimeFromClientX,
        formatTime: formatTime
    };
})(window);
