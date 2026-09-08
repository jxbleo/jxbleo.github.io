(function(window, document) {
  'use strict';

  // Shadowing is a separate client controller so the legacy Dictation URL can
  // keep its tested keyboard and correction behaviour. It only receives safe
  // segment metadata; transcript/reference words arrive after the server's
  // reveal boundary.
  var oldCard = document.getElementById('practice-card');
  var workspace = document.getElementById('shadowing-workspace');
  var list = document.getElementById('shadowing-list');
  var statusBox = document.getElementById('shadowing-status');
  var audio = document.getElementById('audio');
  var selfAudio = document.getElementById('shadowing-self-audio');
  var video = document.getElementById('shadowing-video');
  var params = new URLSearchParams(window.location.search);
  var state = {
    setId: String(params.get('set') || '').trim(),
    assignmentId: String(params.get('assignment') || '').trim(),
    material: null,
    progress: null,
    segments: [],
    track: 'dictation',
    current: null,
    stopAt: 0,
    recording: null,
    mediaStream: null,
    submitting: false,
    activePlayToken: '',
    activeIndex: 0,
    autoAdvanceTimer: null,
    autoAdvancePending: false,
    autoAdvanceConsumeUntil: 0,
    countdownTimer: null,
    countdownValue: 0,
    autoStopTimer: null,
    recordStartedAt: 0,
    replayUrls: {},
    replayBlobs: {},
    failedBlobs: {},
    temporaryReplayUrl: '',
    replaySegmentId: '',
    teacherMode: false,
  };

  function $(id) { return document.getElementById(id); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
    });
  }
  function functionCall(action, payload) {
    return window.MrCatCloud.callAuthenticatedFunction('intensiveListening', Object.assign({
      action: action, set_id: state.setId, assignment_id: state.assignmentId || null
    }, payload || {})).then(function(result) {
      if (!result || !result.success) {
        var error = new Error(result && result.message || 'Unable to continue Shadowing.');
        error.code = result && result.code || 'SHADOWING_ERROR';
        throw error;
      }
      return result;
    });
  }
  function seconds(value) { return Math.max(0, Number(value) || 0); }
  function formatRange(segment) {
    return seconds(segment.start_seconds).toFixed(1) + '–' + seconds(segment.end_seconds).toFixed(1) + 's';
  }
  function segmentState(segment) {
    return state.progress && state.progress.segment_states && state.progress.segment_states[segment.segment_id] || {};
  }
  function percent() { return Math.max(0, Math.min(100, Number(state.progress && state.progress.percentage) || 0)); }
  function setStatus(message, kind) {
    statusBox.textContent = message || '';
    statusBox.className = 'shadowing-status' + (kind ? ' ' + kind : '');
  }
  function clientTakeId(segment) {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return 'take-' + window.crypto.randomUUID();
    return 'take-' + segment.segment_id + '-' + Date.now().toString(36);
  }
  function hasMedia() { return Boolean(window.navigator.mediaDevices && window.navigator.mediaDevices.getUserMedia && window.MediaRecorder); }
  function renderProgress() {
    var qualified = Number(state.progress && state.progress.qualified_segment_count) || 0;
    var total = Number(state.progress && state.progress.segment_count) || state.segments.length;
    $('shadowing-progress-percent').textContent = percent() + '%';
    $('shadowing-progress-copy').textContent = qualified + ' of ' + total + ' lines qualified';
  }
  function segmentText(segment, current) {
    var revealed = current.transcript_revealed === true;
    return revealed
      ? '<p class="shadowing-segment-text">' + escapeHtml(segment.text || '') + '</p>'
      : '<p class="shadowing-segment-text is-hidden">Transcript stays hidden until your complete listens are done.</p>';
  }
  function wordStates(current, segment) {
    if (current.transcript_revealed !== true || !Array.isArray(segment.reference_words) || !segment.reference_words.length) return '';
    var states = new Map((current.latest_word_states || []).map(function(word) { return [word.word_id, word.state]; }));
    return '<div class="shadowing-word-states" aria-label="Latest attempt feedback">' + segment.reference_words.map(function(word) {
      var stateName = states.get(word.word_id) || (word.unscored ? 'unscored' : 'normal');
      var label = stateName === 'yellow' ? 'Nearly there' : stateName === 'red' ? 'To improve' : stateName === 'unscored' ? 'Not scored' : 'On track';
      return '<span class="shadowing-word-state ' + escapeHtml(stateName) + '" title="' + escapeHtml(label) + '">' + escapeHtml(word.text || '') + '</span>';
    }).join('') + '</div>';
  }
  function listenCountBadge(count) {
    return '<span class="shadowing-listen-count" aria-label="' + count + ' complete ' + (count === 1 ? 'listen' : 'listens') + '">' +
      '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M4 13v-1a8 8 0 0 1 16 0v1M5 13h2v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 2-2Zm14 0h-2v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2Z"></path></svg>' +
      '<b>' + count + '</b></span>';
  }
  function actionButton(label, action, segment, disabled, extra) {
    return '<button type="button" data-shadow-action="' + action + '" data-segment-id="' + escapeHtml(segment.segment_id) + '"' + (disabled ? ' disabled' : '') + (extra ? ' class="' + extra + '"' : '') + '>' + escapeHtml(label) + '</button>';
  }
  function cancelAutoAdvance() {
    if (state.autoAdvanceTimer) window.clearTimeout(state.autoAdvanceTimer);
    state.autoAdvanceTimer = null;
    state.autoAdvancePending = false;
  }
  function firstUnqualifiedIndex() {
    var index = state.segments.findIndex(function(segment) { return segmentState(segment).qualified !== true; });
    return index < 0 ? 0 : index;
  }
  function clearCountdown() {
    if (state.countdownTimer) window.clearInterval(state.countdownTimer);
    state.countdownTimer = null;
    state.countdownValue = 0;
  }
  function clearAutoStop() {
    if (state.autoStopTimer) window.clearTimeout(state.autoStopTimer);
    state.autoStopTimer = null;
  }
  function replaceReplay(segmentId, blob) {
    var previous = state.replayUrls[segmentId];
    if (previous) URL.revokeObjectURL(previous);
    state.replayBlobs[segmentId] = blob;
    state.replayUrls[segmentId] = URL.createObjectURL(blob);
    delete state.failedBlobs[segmentId];
  }
  function retainFailedReplay(segmentId, blob, retryable) {
    state.failedBlobs[segmentId] = { blob: blob, retryable: retryable === true };
  }
  function revokeReplays() {
    if (window.MrCatLearningActivity && state.replaySegmentId) {
      window.MrCatLearningActivity.setContinuous('replay', false, state.replaySegmentId);
    }
    if (selfAudio) selfAudio.pause();
    if (state.temporaryReplayUrl) URL.revokeObjectURL(state.temporaryReplayUrl);
    state.temporaryReplayUrl = '';
    state.replaySegmentId = '';
    Object.keys(state.replayUrls).forEach(function(segmentId) { URL.revokeObjectURL(state.replayUrls[segmentId]); });
    state.replayUrls = {};
    state.replayBlobs = {};
    state.failedBlobs = {};
    if (selfAudio) selfAudio.removeAttribute('src');
  }
  function hasReplayBlobs() { return Object.keys(state.replayUrls).length > 0 || Object.keys(state.failedBlobs).length > 0; }
  function render() {
    renderProgress();
    var mediaReady = hasMedia();
    if (!state.segments.length) { list.innerHTML = '<p class="shadowing-status">No Shadowing lines are available in this material yet.</p>'; return; }
    state.activeIndex = Math.max(0, Math.min(state.activeIndex, state.segments.length - 1));
    list.innerHTML = state.segments.map(function(segment, index) {
      if (index !== state.activeIndex) return '';
      var current = segmentState(segment);
      var qualified = current.qualified === true;
      var count = Number(current.complete_listen_count) || 0;
      var latestScore = current.latest_score == null ? (current.best_score == null ? '' : Math.round(Number(current.best_score)) + '%') : Math.round(Number(current.latest_score)) + '%';
      var bestScore = current.best_score == null ? '' : Math.round(Number(current.best_score)) + '%';
      var counting = state.countdownTimer && state.current && state.current.segment_id === segment.segment_id;
      var listenDisabled = state.recording !== null || Boolean(state.countdownTimer) || state.submitting;
      var recordDisabled = state.teacherMode || state.submitting || (!state.recording && !counting && (!mediaReady || count < 1));
      var recordLabel = state.teacherMode ? 'Student recording only' : !mediaReady ? 'Record unavailable' : state.recording ? 'Stop recording' : counting ? 'Cancel · ' + state.countdownValue : qualified ? 'Record again' : 'Record take';
      var replayAvailable = Boolean(state.replayUrls[segment.segment_id] || state.failedBlobs[segment.segment_id]);
      var retryAvailable = Boolean(state.failedBlobs[segment.segment_id] && state.failedBlobs[segment.segment_id].retryable) && !state.submitting;
      var replayingSelf = Boolean(selfAudio && !selfAudio.paused && state.replaySegmentId === segment.segment_id);
      var listenLabel = latestScore ? 'Listen Again' : 'Listen';
      var recordActionLabel = latestScore && !qualified ? 'Try Again' : recordLabel;
      var recordClass = state.recording || counting ? 'recording' : (latestScore && !qualified ? 'primary' : (qualified ? '' : 'primary'));
      var bestCopy = bestScore && latestScore && bestScore !== latestScore ? '<span class="shadowing-best-score">Best ' + escapeHtml(bestScore) + '</span>' : '';
      var autoAdvance = state.autoAdvancePending && qualified
        ? '<div class="shadowing-auto-advance" role="status"><span>Next line</span><i aria-hidden="true"></i></div>'
        : '';
      return '<div class="shadowing-step-nav"><button type="button" data-shadow-nav="previous" aria-label="Previous line"' + (index === 0 ? ' disabled' : '') + '>‹</button><span>Line ' + (index + 1) + ' of ' + state.segments.length + '</span><button type="button" data-shadow-nav="next" aria-label="Next line"' + (index === state.segments.length - 1 ? ' disabled' : '') + '>›</button></div>' +
        '<article class="shadowing-segment is-active' + (qualified ? ' is-qualified' : '') + '" data-segment-id="' + escapeHtml(segment.segment_id) + '">' +
        '<div class="shadowing-segment-number" aria-hidden="true">' + String(index + 1).padStart(2, '0') + '</div>' +
        '<div class="shadowing-segment-copy"><div class="shadowing-segment-meta"><span class="shadowing-segment-speaker">' + escapeHtml(segment.speaker || 'Speaker') + '</span><span class="shadowing-segment-time">' + escapeHtml(formatRange(segment)) + '</span>' + listenCountBadge(count) + '</div>' +
        segmentText(segment, current) + wordStates(current, segment) + '</div>' +
        '<div class="shadowing-score' + (latestScore ? '' : ' is-empty') + '"><strong>' + (latestScore || '—') + '</strong><span>' + (qualified ? 'Qualified' : latestScore ? 'Keep going' : 'Latest take') + '</span>' + bestCopy + '</div>' +
        '<div class="shadowing-segment-actions">' + actionButton(listenLabel, 'listen', segment, listenDisabled, '') + (!current.transcript_revealed ? actionButton('Show Script', 'show-script', segment, false, '') : '') + actionButton(recordActionLabel, 'record', segment, recordDisabled, recordClass) + (replayAvailable ? actionButton(replayingSelf ? 'Stop Replay' : 'Replay My Voice', 'replay-self', segment, false, '') : '') + (retryAvailable ? actionButton('Retry score', 'retry-score', segment, false, '') : '') + (latestScore && !qualified ? actionButton('Continue', 'continue', segment, false, '') : '') + '</div>' + autoAdvance + '</article>';
    }).join('');
  }
  function goTo(index) {
    if (state.recording || state.countdownTimer || state.submitting) {
      setStatus(state.submitting ? 'Thinking… Please wait for this score.' : 'Finish or cancel the current recording first.', 'error');
      return;
    }
    cancelAutoAdvance();
    state.activeIndex = Math.max(0, Math.min(Number(index) || 0, state.segments.length - 1));
    if (window.MrCatLearningActivity && state.current) {
      window.MrCatLearningActivity.setContinuous('playback', false, state.current.segment_id);
    }
    state.current = null;
    state.activePlayToken = '';
    audio.pause();
    video.pause();
    if (selfAudio) selfAudio.pause();
    render();
    var active = list.querySelector('.shadowing-segment');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function mediaElement() {
    return state.material && state.material.media && state.material.media.kind === 'video' ? video : audio;
  }
  function mediaSource() {
    var media = state.material && state.material.media || {};
    if (media.kind === 'video') return String(media.src || media.video_src || '');
    return String(state.material && (state.material.audio_src || media.audio_src || media.src) || '');
  }
  function switchTrack(track) {
    var wasShadowing = state.track === 'shadowing';
    state.track = track === 'shadowing' ? 'shadowing' : 'dictation';
    document.querySelectorAll('[data-practice-listening-mode]').forEach(function(button) {
      button.classList.toggle('is-selected', button.getAttribute('data-practice-listening-mode') === state.track);
      button.setAttribute('aria-checked', button.getAttribute('data-practice-listening-mode') === state.track ? 'true' : 'false');
    });
    var label = $('il-practice-mode-label');
    if (label) label.textContent = state.track === 'shadowing' ? 'Shadowing' : 'Dictation';
    var shadow = state.track === 'shadowing';
    if (!shadow) {
      cancelAutoAdvance();
      audio.pause();
      video.pause();
      if (selfAudio) selfAudio.pause();
    }
    workspace.hidden = !shadow;
    oldCard.hidden = shadow;
    if (shadow) {
      if (!wasShadowing) state.activeIndex = firstUnqualifiedIndex();
      document.dispatchEvent(new CustomEvent('mrcat:listening-shadowing-progress', { detail: { completed: Boolean(state.progress && state.progress.completed), percentage: percent() } }));
      setStatus('Listen through a line, then make a private take.');
      render();
    } else {
      setStatus('');
    }
  }
  function bootstrap() {
    if (!state.setId || !window.MrCatCloud || !window.MrCatCloud.callAuthenticatedFunction) return;
    functionCall('bootstrap').then(function(result) {
      state.material = result.material || {};
      state.teacherMode = result.teacher_mode === true;
      var tracks = result.tracks || {};
      var shadowEnabled = Boolean(tracks.shadowing && tracks.shadowing.enabled);
      state.progress = result.shadowing_progress || { percentage: 0, segment_states: {}, segment_count: 0 };
      state.segments = Array.isArray(result.shadowing_segments)
        ? result.shadowing_segments.filter(function(segment) { return segment && segment.practice_mode === 'dictation'; })
        : [];
      var dictationEnabled = Boolean(tracks.dictation && tracks.dictation.enabled);
      if (!shadowEnabled || !state.segments.length) return;
      var requestedMode = String(params.get('mode') || result.preferred_mode || '').toLowerCase();
      // The header mode menu owns the mode choice. A material still opens on
      // the account preference (or Dictation), with no intermediate chooser.
      state.activeIndex = firstUnqualifiedIndex();
      document.dispatchEvent(new CustomEvent('mrcat:listening-shadowing-progress', { detail: { completed: Boolean(state.progress && state.progress.completed), percentage: percent() } }));
      switchTrack(requestedMode === 'shadowing' && shadowEnabled ? 'shadowing' : (dictationEnabled ? 'dictation' : 'shadowing'));
      var threshold = state.progress.reveal_threshold;
      if ([1, 2, 3, 5, 'off'].indexOf(threshold) >= 0) $('shadowing-reveal-threshold').value = threshold;
      if (state.teacherMode) {
        $('shadowing-reveal-threshold').disabled = true;
        setStatus('Teacher preview · playback and reviewed script only. Student recording and scoring are disabled.');
      }
    }).catch(function() { /* The legacy Dictation controller owns the error UI. */ });
  }
  function updateFromResult(result) {
    if (result && result.progress) state.progress = result.progress;
    if (result && result.segment) {
      state.segments = state.segments.map(function(segment) { return segment.segment_id === result.segment.segment_id ? Object.assign({}, segment, result.segment) : segment; });
    }
    document.dispatchEvent(new CustomEvent('mrcat:listening-shadowing-progress', { detail: { completed: Boolean(state.progress && state.progress.completed), percentage: percent() } }));
    render();
  }
  function listen(segment) {
    if (state.recording) return;
    cancelAutoAdvance();
    if (!state.teacherMode && window.MrCatLearningActivity && window.MrCatLearningActivity.pause) {
      window.MrCatLearningActivity.pause('network').catch(function() {});
    }
    setStatus('Preparing the line…');
    if (state.teacherMode) {
      var previewMedia = mediaElement();
      state.current = segment;
      state.stopAt = seconds(segment.end_seconds);
      state.activePlayToken = '';
      previewMedia.src = mediaSource();
      previewMedia.muted = false;
      video.hidden = previewMedia !== video;
      previewMedia.currentTime = seconds(segment.start_seconds);
      Promise.resolve(previewMedia.play()).then(function() {
        setStatus('Teacher preview · playing line ' + (state.segments.indexOf(segment) + 1) + '.');
      }).catch(function() { setStatus('Press Listen again to start playback.', 'error'); });
      return;
    }
    function playIssuedListen() {
      var media = mediaElement();
      state.current = segment;
      state.stopAt = seconds(segment.end_seconds);
      media.src = mediaSource();
      media.muted = false;
      video.hidden = media !== video;
      media.currentTime = seconds(segment.start_seconds);
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('audio', segment.segment_id);
      if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('playback', true, segment.segment_id);
      return Promise.resolve(media.play()).then(function() {
        setStatus('Listening to line ' + (state.segments.indexOf(segment) + 1) + '…');
      }).catch(function(error) {
        if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('playback', false, segment.segment_id);
        if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', segment.segment_id);
        if (error && error.name === 'NotAllowedError') {
          setStatus('Tap Listen again to play this line.', 'error');
          return;
        }
        state.activePlayToken = '';
        setStatus('This audio could not be played. Check your connection and try again.', 'error');
      });
    }
    if (state.activePlayToken && state.current && state.current.segment_id === segment.segment_id) {
      playIssuedListen();
      return;
    }
    functionCall('startListen', { segment_id: segment.segment_id }).then(function(result) {
      state.activePlayToken = result.play_token;
      return playIssuedListen();
    }).catch(function(error) {
      state.activePlayToken = '';
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', segment.segment_id);
      setStatus(error && error.message || 'This line is unavailable. Please try again.', 'error');
    });
  }
  function completeListen() {
    var segment = state.current;
    if (!segment || !state.activePlayToken) return;
    var playToken = state.activePlayToken;
    state.activePlayToken = '';
    if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('playback', false, segment.segment_id);
    if (window.MrCatLearningActivity && window.MrCatLearningActivity.pause) window.MrCatLearningActivity.pause('network').catch(function() {});
    functionCall('completeListen', { segment_id: segment.segment_id, complete_play_token: playToken }).then(function(result) {
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', segment.segment_id);
      updateFromResult(result);
      var current = segmentState(segment);
      setStatus(current.transcript_revealed ? 'Transcript unlocked. You can now record a take.' : 'Complete listen saved. Keep listening until the transcript unlocks.', 'success');
    }).catch(function(error) {
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', segment.segment_id);
      setStatus(error.message, 'error');
    });
  }
  function mediaEndedAtSegment(event) {
    var media = event && event.currentTarget || mediaElement();
    if (state.current && state.track === 'shadowing' && state.stopAt && Number(media.currentTime) >= state.stopAt - .02) {
      media.pause();
      media.currentTime = state.stopAt;
      if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('playback', false, state.current.segment_id);
      if (state.recording || state.countdownTimer) return;
      else completeListen();
    }
  }
  function trimBounds(samples, sampleRate) {
    var frame = Math.max(1, Math.round(sampleRate * .02));
    var threshold = .012;
    var first = -1;
    var last = -1;
    for (var start = 0; start < samples.length; start += frame) {
      var sum = 0;
      var end = Math.min(samples.length, start + frame);
      for (var i = start; i < end; i++) sum += samples[i] * samples[i];
      if (Math.sqrt(sum / Math.max(1, end - start)) >= threshold) { first = start; break; }
    }
    for (var tail = samples.length; tail > 0; tail -= frame) {
      var tailStart = Math.max(0, tail - frame);
      var tailSum = 0;
      for (var j = tailStart; j < tail; j++) tailSum += samples[j] * samples[j];
      if (Math.sqrt(tailSum / Math.max(1, tail - tailStart)) >= threshold) { last = tail; break; }
    }
    if (first < 0 || last <= first) return { start: 0, end: samples.length };
    var pad = Math.round(sampleRate * .16);
    return { start: Math.max(0, first - pad), end: Math.min(samples.length, last + pad) };
  }
  function audioDataToWav(blob) {
    if (!window.AudioContext && !window.webkitAudioContext) return Promise.reject(new Error('This browser cannot prepare a WAV recording.'));
    var Context = window.AudioContext || window.webkitAudioContext;
    var context = new Context();
    return blob.arrayBuffer().then(function(buffer) { return context.decodeAudioData(buffer); }).then(function(decoded) {
      var channels = decoded.numberOfChannels;
      var length = decoded.length;
      var sampleRate = decoded.sampleRate;
      var mono = new Float32Array(length);
      for (var channel = 0; channel < channels; channel++) {
        var data = decoded.getChannelData(channel);
        for (var index = 0; index < length; index++) mono[index] += data[index] / channels;
      }
      var bounds = trimBounds(mono, sampleRate);
      mono = mono.slice(bounds.start, bounds.end);
      length = mono.length;
      var targetRate = 16000;
      var targetLength = Math.max(1, Math.round(length * targetRate / sampleRate));
      var pcm = new ArrayBuffer(44 + targetLength * 2);
      var view = new DataView(pcm);
      function write(offset, text) { for (var i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i)); }
      write(0, 'RIFF'); view.setUint32(4, 36 + targetLength * 2, true); write(8, 'WAVE'); write(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, targetRate, true); view.setUint32(28, targetRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, targetLength * 2, true);
      for (var sample = 0; sample < targetLength; sample++) { var source = mono[Math.min(length - 1, Math.floor(sample * sampleRate / targetRate))]; var value = Math.max(-1, Math.min(1, source)); view.setInt16(44 + sample * 2, value < 0 ? value * 32768 : value * 32767, true); }
      if (context.close) context.close();
      return new Blob([pcm], { type: 'audio/wav' });
    });
  }
  function stopRecording() {
    clearCountdown();
    clearAutoStop();
    if (!state.recording) {
      if (state.mediaStream) state.mediaStream.getTracks().forEach(function(track) { track.stop(); });
      state.mediaStream = null;
      if (window.MrCatLearningActivity && state.current) window.MrCatLearningActivity.setContinuous('recording', false, state.current.segment_id);
      if (!video.hidden) video.pause();
      render();
      return;
    }
    if (window.MrCatLearningActivity && state.current) window.MrCatLearningActivity.setContinuous('recording', false, state.current.segment_id);
    state.recording.stop();
    if (state.mediaStream) state.mediaStream.getTracks().forEach(function(track) { track.stop(); });
    state.mediaStream = null;
    if (!video.hidden) video.pause();
  }
  function startRecorder(segment, stream) {
    var chunks = [];
    var recorder = new MediaRecorder(stream);
    state.recording = recorder;
    state.recordStartedAt = Date.now();
    state.countdownValue = 0;
    if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('recording', true, segment.segment_id);
    recorder.ondataavailable = function(event) { if (event.data && event.data.size) chunks.push(event.data); };
    recorder.onerror = function() {
      clearAutoStop();
      state.recording = null;
      if (state.mediaStream) state.mediaStream.getTracks().forEach(function(track) { track.stop(); });
      state.mediaStream = null;
      if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('recording', false, segment.segment_id);
      setStatus('Recording failed. Please try again.', 'error');
      render();
    };
    recorder.onstop = function() {
      clearAutoStop();
      state.recording = null;
      if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('recording', false, segment.segment_id);
      render();
      var blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
      submitTake(segment, blob);
    };
    recorder.start();
    var sourceDuration = Math.max(0, seconds(segment.end_seconds) - seconds(segment.start_seconds));
    // Stop just inside the server limit so recorder scheduling/codec rounding
    // cannot turn an otherwise valid take into an over-limit upload.
    var maxDurationMs = Math.max(1900, Math.min(300, Math.max(2, sourceDuration * 1.8 + 3)) * 1000 - 100);
    state.autoStopTimer = window.setTimeout(function() { if (state.recording === recorder) stopRecording(); }, maxDurationMs);
    render();
    setStatus('Recording line ' + (state.segments.indexOf(segment) + 1) + '… Press the button again when you finish.');
  }
  function record(segment) {
    if (state.submitting) return;
    if (!hasMedia()) { setStatus('This browser does not provide microphone recording.', 'error'); return; }
    if (state.recording) { stopRecording(); return; }
    if (state.countdownTimer) {
      stopRecording();
      setStatus('Recording cancelled.');
      return;
    }
    cancelAutoAdvance();
    if (window.MrCatLearningActivity && window.MrCatLearningActivity.pause) {
      window.MrCatLearningActivity.pause('permission').catch(function() {});
    }
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function(stream) {
      state.mediaStream = stream;
      state.current = segment;
      state.stopAt = seconds(segment.end_seconds);
      state.countdownValue = 3;
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) {
        window.MrCatLearningActivity.resume('recording', segment.segment_id);
      }
      if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('recording', true, segment.segment_id);
      if (state.material && state.material.media && state.material.media.kind === 'video') {
        video.src = mediaSource(); video.hidden = false; video.muted = true; video.currentTime = seconds(segment.start_seconds);
        Promise.resolve(video.play()).catch(function() { /* Recording remains usable without the silent video. */ });
      }
      render();
      setStatus('Get ready… 3');
      state.countdownTimer = window.setInterval(function() {
        state.countdownValue -= 1;
        if (state.countdownValue <= 0) {
          clearCountdown();
          startRecorder(segment, stream);
          return;
        }
        setStatus('Get ready… ' + state.countdownValue);
        render();
      }, 1000);
    }).catch(function(error) {
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) {
        window.MrCatLearningActivity.resume('review', segment.segment_id);
      }
      setStatus(error && error.name === 'NotAllowedError' ? 'Microphone access is needed for a Shadowing take.' : 'Microphone could not be started.', 'error');
    });
  }
  function submitTake(segment, blob) {
    state.submitting = true; render(); setStatus('Thinking…');
    var pauseLearning = window.MrCatLearningActivity && window.MrCatLearningActivity.pause
      ? window.MrCatLearningActivity.pause('thinking').catch(function() {}) : Promise.resolve();
    var activeReservation = null;
    var uploadedFileId = '';
    pauseLearning.then(function() { return audioDataToWav(blob); }).then(function(wav) {
      return functionCall('reserveShadowingTake', { segment_id: segment.segment_id, client_take_id: clientTakeId(segment) }).then(function(reservation) {
        activeReservation = reservation;
        return window.MrCatCloud.uploadCloudFile(reservation.upload_path, wav).then(function(upload) {
          uploadedFileId = upload.file_id;
          return functionCall('registerShadowingUpload', { take_id: reservation.take_id, file_id: upload.file_id }).then(function() {
            return functionCall('finishShadowingTake', { take_id: reservation.take_id, file_id: upload.file_id });
          });
        });
      });
    }).then(function(result) {
      state.submitting = false;
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', segment.segment_id);
      replaceReplay(segment.segment_id, blob);
      updateFromResult(result);
      var retryCopy = result.transcript_revealed
        ? 'Take saved. Coloured words show where to focus next.'
        : 'Take saved. Listen again or record another take.';
      if (result.qualified && state.activeIndex < state.segments.length - 1) {
        cancelAutoAdvance();
        state.autoAdvancePending = true;
        render();
        setStatus('Qualified. Tap anywhere to stay on this line.', 'success');
        if (window.MrCatLearningActivity && window.MrCatLearningActivity.pause) {
          window.MrCatLearningActivity.pause('auto-advance').catch(function() {});
        }
        state.autoAdvanceTimer = window.setTimeout(function() {
          state.autoAdvanceTimer = null;
          state.autoAdvancePending = false;
          goTo(state.activeIndex + 1);
        }, 1500);
      } else setStatus(result.qualified ? 'Qualified. This is the final line.' : retryCopy, result.qualified ? 'success' : '');
    }).catch(function(error) {
      var retryable = error && error.code !== 'SHADOWING_OUTCOME_UNKNOWN'
        && !/^AUDIO_|^WAV_|SCORING_POLICY|SCORING_NOT_AVAILABLE|SHADOWING_.*QUOTA|SHADOWING_RATE_LIMITED/.test(String(error && error.code || ''));
      retainFailedReplay(segment.segment_id, blob, retryable);
      var release = activeReservation && activeReservation.take_id
        ? functionCall('cancelShadowingTake', { take_id: activeReservation.take_id, file_id: uploadedFileId || null }).catch(function() {})
        : Promise.resolve();
      return release.then(function() {
        state.submitting = false;
        if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', segment.segment_id);
        render(); setStatus((error.message || 'This take could not be scored.') + (retryable ? ' You can replay it and retry scoring.' : ' You can still replay this take.'), 'error');
      });
    });
  }
  function chooseReveal(event) {
    var value = event.target.value === 'off' ? 'off' : Number(event.target.value);
    if (window.MrCatLearningActivity && window.MrCatLearningActivity.pause) window.MrCatLearningActivity.pause('network').catch(function() {});
    functionCall('setRevealThreshold', { reveal_threshold: value }).then(function(result) {
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', state.segments[state.activeIndex] && state.segments[state.activeIndex].segment_id);
      updateFromResult(result);
    }).catch(function(error) {
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', state.segments[state.activeIndex] && state.segments[state.activeIndex].segment_id);
      setStatus(error.message, 'error');
    });
  }
  function showScript(segment) {
    if (window.MrCatLearningActivity && window.MrCatLearningActivity.pause) window.MrCatLearningActivity.pause('network').catch(function() {});
    functionCall('revealShadowingTranscript', { segment_id: segment.segment_id }).then(function(result) {
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', segment.segment_id);
      updateFromResult(result);
      setStatus('Script shown. Your next qualified take will count as assisted.', 'success');
    }).catch(function(error) {
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', segment.segment_id);
      setStatus(error.message, 'error');
    });
  }
  function replaySelf(segment) {
    if (selfAudio && !selfAudio.paused && state.replaySegmentId === segment.segment_id) {
      selfAudio.pause();
      if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('replay', false, segment.segment_id);
      state.replaySegmentId = '';
      render();
      setStatus('Replay stopped.');
      return;
    }
    var failed = state.failedBlobs[segment.segment_id];
    if (state.temporaryReplayUrl) URL.revokeObjectURL(state.temporaryReplayUrl);
    state.temporaryReplayUrl = failed && failed.blob ? URL.createObjectURL(failed.blob) : '';
    var source = state.temporaryReplayUrl || state.replayUrls[segment.segment_id];
    if (!source || !selfAudio) return;
    selfAudio.pause();
    state.replaySegmentId = segment.segment_id;
    selfAudio.src = source;
    if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('replay', true, segment.segment_id);
    Promise.resolve(selfAudio.play()).then(function() { render(); setStatus('Replaying your latest take…'); }).catch(function() {
      if (window.MrCatLearningActivity) window.MrCatLearningActivity.setContinuous('replay', false, segment.segment_id);
      setStatus('Your take could not be replayed.', 'error');
    });
  }
  list.addEventListener('click', function(event) {
    var nav = event.target.closest('[data-shadow-nav]');
    if (nav) { goTo(state.activeIndex + (nav.getAttribute('data-shadow-nav') === 'next' ? 1 : -1)); return; }
    var button = event.target.closest('[data-shadow-action]');
    if (!button) return;
    var segment = state.segments.find(function(item) { return item.segment_id === button.getAttribute('data-segment-id'); });
    if (!segment) return;
    var action = button.getAttribute('data-shadow-action');
    if (action === 'listen') listen(segment);
    if (action === 'show-script') showScript(segment);
    if (action === 'record') record(segment);
    if (action === 'replay-self') replaySelf(segment);
    if (action === 'retry-score' && state.failedBlobs[segment.segment_id] && state.failedBlobs[segment.segment_id].retryable) submitTake(segment, state.failedBlobs[segment.segment_id].blob);
    if (action === 'continue') {
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.pause) window.MrCatLearningActivity.pause('network').catch(function() {});
      functionCall('continueShadowingSegment', { segment_id: segment.segment_id }).then(function(result) {
        updateFromResult(result); goTo(state.activeIndex + 1);
      }).catch(function(error) {
        if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) window.MrCatLearningActivity.resume('review', segment.segment_id);
        setStatus(error.message, 'error');
      });
    }
  });
  document.addEventListener('mrcat:listening-mode-change', function(event) {
    var mode = event.detail && event.detail.mode;
    if (mode === 'shadowing' && state.segments.length) switchTrack('shadowing');
    if (mode === 'dictation') switchTrack('dictation');
  });
  $('shadowing-reveal-threshold').addEventListener('change', chooseReveal);
  audio.addEventListener('timeupdate', mediaEndedAtSegment);
  audio.addEventListener('ended', mediaEndedAtSegment);
  video.addEventListener('timeupdate', mediaEndedAtSegment);
  video.addEventListener('ended', mediaEndedAtSegment);
  if (selfAudio) selfAudio.addEventListener('ended', function() {
    if (window.MrCatLearningActivity && state.replaySegmentId) window.MrCatLearningActivity.setContinuous('replay', false, state.replaySegmentId);
    if (state.temporaryReplayUrl) URL.revokeObjectURL(state.temporaryReplayUrl);
    state.temporaryReplayUrl = '';
    state.replaySegmentId = '';
    render();
    setStatus('Your take is ready to replay again.');
  });
  if (selfAudio) selfAudio.addEventListener('pause', function() {
    if (window.MrCatLearningActivity && state.replaySegmentId) {
      window.MrCatLearningActivity.setContinuous('replay', false, state.replaySegmentId);
    }
    if (!selfAudio.ended) render();
  });
  function cancelAdvanceFromPage(event) {
    if (state.autoAdvancePending) {
      state.autoAdvanceConsumeUntil = Date.now() + 500;
      cancelAutoAdvance();
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      render();
      if (window.MrCatLearningActivity && window.MrCatLearningActivity.resume) {
        var segment = state.segments[state.activeIndex];
        window.MrCatLearningActivity.resume('review', segment && segment.segment_id);
      }
      setStatus('Staying on this qualified line.', 'success');
      return;
    }
    if (event.type === 'click' && Date.now() < state.autoAdvanceConsumeUntil) {
      if (event.cancelable) event.preventDefault();
      event.stopPropagation();
      if (event.stopImmediatePropagation) event.stopImmediatePropagation();
      state.autoAdvanceConsumeUntil = 0;
    }
  }
  document.addEventListener('pointerdown', cancelAdvanceFromPage, true);
  document.addEventListener('keydown', cancelAdvanceFromPage, true);
  document.addEventListener('click', cancelAdvanceFromPage, true);
  window.addEventListener('beforeunload', function(event) {
    if (!hasReplayBlobs()) return;
    event.preventDefault();
    event.returnValue = '';
  });
  window.addEventListener('pagehide', revokeReplays);
  window.MrCatShadowingController = {
    canSwitchMode: function() { return !state.recording && !state.countdownTimer && !state.submitting; },
    explainSwitchBlock: function() { setStatus(state.submitting ? 'Thinking… Please wait for this score.' : 'Finish or cancel the current recording before switching modes.', 'error'); },
    pauseForModal: function() {
      audio.pause();
      video.pause();
      if (selfAudio) selfAudio.pause();
      if (window.MrCatLearningActivity && state.current) {
        window.MrCatLearningActivity.setContinuous('playback', false, state.current.segment_id);
        window.MrCatLearningActivity.setContinuous('replay', false, state.current.segment_id);
      }
    },
    hasReplayBlobs: hasReplayBlobs,
    revokeReplays: revokeReplays
  };
  window.__MRCAT_LISTENING_SHADOWING_TEST__ = {
    escapeHtml: escapeHtml,
    formatRange: formatRange,
    hasMedia: hasMedia,
    clientTakeId: clientTakeId,
    audioDataToWav: audioDataToWav,
    trimBounds: trimBounds,
    firstUnqualifiedIndex: firstUnqualifiedIndex
  };
  bootstrap();
})(window, document);
