(function(window, document) {
  'use strict';

  // Shadowing is a separate client controller so the legacy Dictation URL can
  // keep its tested keyboard and correction behaviour. It only receives safe
  // segment metadata; transcript/reference words arrive after the server's
  // reveal boundary.
  var chooser = document.getElementById('listening-track-chooser');
  var oldCard = document.getElementById('practice-card');
  var workspace = document.getElementById('shadowing-workspace');
  var list = document.getElementById('shadowing-list');
  var statusBox = document.getElementById('shadowing-status');
  var audio = document.getElementById('audio');
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
    var states = new Map((current.best_word_states || []).map(function(word) { return [word.word_id, word.state]; }));
    return '<div class="shadowing-word-states" aria-label="Best word feedback">' + segment.reference_words.map(function(word) {
      var stateName = states.get(word.word_id) || (word.unscored ? 'unscored' : 'normal');
      var label = stateName === 'yellow' ? 'Nearly there' : stateName === 'red' ? 'To improve' : stateName === 'unscored' ? 'Not scored' : 'On track';
      return '<span class="shadowing-word-state ' + escapeHtml(stateName) + '" title="' + escapeHtml(label) + '">' + escapeHtml(word.text || '') + '</span>';
    }).join('') + '</div>';
  }
  function actionButton(label, action, segment, disabled, extra) {
    return '<button type="button" data-shadow-action="' + action + '" data-segment-id="' + escapeHtml(segment.segment_id) + '"' + (disabled ? ' disabled' : '') + (extra ? ' class="' + extra + '"' : '') + '>' + escapeHtml(label) + '</button>';
  }
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
      var score = current.best_score == null ? '' : Math.round(Number(current.best_score)) + '%';
      var listenDisabled = state.recording !== null;
      var recordDisabled = state.submitting || (!state.recording && (!mediaReady || count < 1));
      var recordLabel = !mediaReady ? 'Recording unavailable' : state.recording ? 'Stop recording' : count < 1 ? 'Listen first' : qualified ? 'Record to improve' : 'Record take';
      return '<div class="shadowing-step-nav"><button type="button" data-shadow-nav="previous" aria-label="Previous line"' + (index === 0 ? ' disabled' : '') + '>‹</button><span>Line ' + (index + 1) + ' of ' + state.segments.length + '</span><button type="button" data-shadow-nav="next" aria-label="Next line"' + (index === state.segments.length - 1 ? ' disabled' : '') + '>›</button></div>' +
        '<article class="shadowing-segment is-active' + (qualified ? ' is-qualified' : '') + '" data-segment-id="' + escapeHtml(segment.segment_id) + '">' +
        '<div class="shadowing-segment-number" aria-hidden="true">' + String(index + 1).padStart(2, '0') + '</div>' +
        '<div class="shadowing-segment-copy"><div class="shadowing-segment-meta"><span class="shadowing-segment-speaker">' + escapeHtml(segment.speaker || 'Speaker') + '</span><span class="shadowing-segment-time">' + escapeHtml(formatRange(segment)) + '</span><span>' + count + ' complete ' + (count === 1 ? 'listen' : 'listens') + (score ? ' · Best ' + escapeHtml(score) : '') + '</span></div>' +
        segmentText(segment, current) + wordStates(current, segment) + '</div>' +
        '<div class="shadowing-score' + (score ? '' : ' is-empty') + '"><strong>' + (score || '—') + '</strong><span>' + (qualified ? 'Qualified' : score ? 'Keep going' : 'Best take') + '</span></div>' +
        '<div class="shadowing-segment-actions">' + actionButton('Listen', 'listen', segment, listenDisabled, '') + actionButton(recordLabel, 'record', segment, recordDisabled, state.recording ? 'recording' : 'primary') + (score && !qualified ? actionButton('Continue', 'continue', segment, false, '') : '') + '</div></article>';
    }).join('');
  }
  function goTo(index) {
    state.activeIndex = Math.max(0, Math.min(Number(index) || 0, state.segments.length - 1));
    state.current = null;
    state.activePlayToken = '';
    audio.pause();
    video.pause();
    render();
    var active = list.querySelector('.shadowing-segment');
    if (active) active.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  function mediaElement() {
    return state.material && state.material.media && state.material.media.kind === 'video' ? video : audio;
  }
  function mediaSource() {
    return String(state.material && (state.material.audio_src || state.material.media && (state.material.media.src || state.material.media.audio_src)) || '');
  }
  function switchTrack(track) {
    state.track = track === 'shadowing' ? 'shadowing' : 'dictation';
    document.querySelectorAll('[data-listening-track]').forEach(function(button) {
      button.classList.toggle('is-selected', button.getAttribute('data-listening-track') === state.track);
      button.setAttribute('aria-pressed', button.getAttribute('data-listening-track') === state.track ? 'true' : 'false');
    });
    var shadow = state.track === 'shadowing';
    workspace.hidden = !shadow;
    oldCard.hidden = shadow;
    if (shadow) {
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
      var tracks = result.tracks || {};
      var shadowEnabled = Boolean(tracks.shadowing && tracks.shadowing.enabled);
      state.progress = result.shadowing_progress || { percentage: 0, segment_states: {}, segment_count: 0 };
      state.segments = Array.isArray(result.shadowing_segments) ? result.shadowing_segments : [];
      var dictationEnabled = Boolean(tracks.dictation && tracks.dictation.enabled);
      if (!shadowEnabled || !state.segments.length) return;
      chooser.hidden = dictationEnabled === false;
      // A single-track material opens directly. A dual-track material keeps
      // the chooser visible and starts on the established Dictation view.
      switchTrack(dictationEnabled ? 'dictation' : 'shadowing');
      var threshold = state.progress.reveal_threshold;
      if ([1, 2, 3, 5, 'off'].indexOf(threshold) >= 0) $('shadowing-reveal-threshold').value = threshold;
    }).catch(function() { /* The legacy Dictation controller owns the error UI. */ });
  }
  function updateFromResult(result) {
    if (result && result.progress) state.progress = result.progress;
    if (result && result.segment) {
      state.segments = state.segments.map(function(segment) { return segment.segment_id === result.segment.segment_id ? Object.assign({}, segment, result.segment) : segment; });
    }
    document.dispatchEvent(new CustomEvent('mrcat:listening-shadowing-progress', { detail: { completed: Boolean(state.progress && state.progress.completed) } }));
    render();
  }
  function listen(segment) {
    if (state.recording) return;
    setStatus('Preparing the line…');
    functionCall('startListen', { segment_id: segment.segment_id }).then(function(result) {
      var media = mediaElement();
      state.current = segment;
      state.stopAt = seconds(segment.end_seconds);
      state.activePlayToken = result.play_token;
      media.src = mediaSource();
      media.muted = false;
      video.hidden = media !== video;
      media.currentTime = seconds(segment.start_seconds);
      return Promise.resolve(media.play());
    }).then(function() { setStatus('Listening to line ' + (state.segments.indexOf(segment) + 1) + '…'); }).catch(function() { state.activePlayToken = ''; setStatus('Press Listen again to start audio.', 'error'); });
  }
  function completeListen() {
    var segment = state.current;
    if (!segment || !state.activePlayToken) return;
    var playToken = state.activePlayToken;
    state.activePlayToken = '';
    functionCall('completeListen', { segment_id: segment.segment_id, complete_play_token: playToken }).then(function(result) {
      updateFromResult(result);
      var current = segmentState(segment);
      setStatus(current.transcript_revealed ? 'Transcript unlocked. You can now record a take.' : 'Complete listen saved. Keep listening until the transcript unlocks.', 'success');
    }).catch(function(error) { setStatus(error.message, 'error'); });
  }
  function mediaEndedAtSegment(event) {
    var media = event && event.currentTarget || mediaElement();
    if (state.current && state.track === 'shadowing' && state.stopAt && Number(media.currentTime) >= state.stopAt - .02) {
      media.pause();
      media.currentTime = state.stopAt;
      if (state.recording) stopRecording();
      else completeListen();
    }
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
    if (!state.recording) return;
    state.recording.stop();
    if (state.mediaStream) state.mediaStream.getTracks().forEach(function(track) { track.stop(); });
    state.mediaStream = null;
    if (!video.hidden) video.pause();
  }
  function record(segment) {
    if (state.submitting) return;
    if (!hasMedia()) { setStatus('This browser does not provide microphone recording.', 'error'); return; }
    if (state.recording) { stopRecording(); return; }
    navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } }).then(function(stream) {
      state.mediaStream = stream;
      var chunks = [];
      var recorder = new MediaRecorder(stream);
      state.recording = recorder;
      state.current = segment;
      state.stopAt = seconds(segment.end_seconds);
      if (state.material && state.material.media && state.material.media.kind === 'video') {
        video.src = mediaSource(); video.hidden = false; video.muted = true; video.currentTime = seconds(segment.start_seconds);
        Promise.resolve(video.play()).catch(function() { /* Recording remains usable without the silent video. */ });
      }
      render();
      setStatus('Recording line ' + (state.segments.indexOf(segment) + 1) + '… Press the button again to finish.');
      recorder.ondataavailable = function(event) { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onerror = function() { state.recording = null; setStatus('Recording failed. Please try again.', 'error'); render(); };
      recorder.onstop = function() {
        state.recording = null; render();
        var blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        submitTake(segment, blob);
      };
      recorder.start();
    }).catch(function(error) { setStatus(error && error.name === 'NotAllowedError' ? 'Microphone access is needed for a Shadowing take.' : 'Microphone could not be started.', 'error'); });
  }
  function submitTake(segment, blob) {
    state.submitting = true; render(); setStatus('Preparing your private take…');
    var activeReservation = null;
    var uploadedFileId = '';
    audioDataToWav(blob).then(function(wav) {
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
      updateFromResult(result);
      var retryCopy = result.transcript_revealed
        ? 'Take saved. Coloured words show where to focus next.'
        : 'Take saved. Listen again or record another take.';
      setStatus(result.qualified ? 'Qualified. Moving to the next line…' : retryCopy, result.qualified ? 'success' : '');
      if (result.qualified && state.activeIndex < state.segments.length - 1) window.setTimeout(function() { goTo(state.activeIndex + 1); }, 900);
    }).catch(function(error) {
      var release = activeReservation && activeReservation.take_id
        ? functionCall('cancelShadowingTake', { take_id: activeReservation.take_id, file_id: uploadedFileId || null }).catch(function() {})
        : Promise.resolve();
      return release.then(function() { state.submitting = false; render(); setStatus(error.message || 'This take could not be scored.', 'error'); });
    });
  }
  function chooseReveal(event) {
    var value = event.target.value === 'off' ? 'off' : Number(event.target.value);
    functionCall('setRevealThreshold', { reveal_threshold: value }).then(function(result) { updateFromResult(result); }).catch(function(error) { setStatus(error.message, 'error'); });
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
    if (action === 'record') record(segment);
    if (action === 'continue') functionCall('continueShadowingSegment', { segment_id: segment.segment_id }).then(function(result) { updateFromResult(result); goTo(state.activeIndex + 1); }).catch(function(error) { setStatus(error.message, 'error'); });
  });
  document.querySelectorAll('[data-listening-track]').forEach(function(button) { button.addEventListener('click', function() { switchTrack(button.getAttribute('data-listening-track')); }); });
  $('shadowing-reveal-threshold').addEventListener('change', chooseReveal);
  audio.addEventListener('timeupdate', mediaEndedAtSegment);
  audio.addEventListener('ended', mediaEndedAtSegment);
  video.addEventListener('timeupdate', mediaEndedAtSegment);
  video.addEventListener('ended', mediaEndedAtSegment);
  window.__MRCAT_LISTENING_SHADOWING_TEST__ = {
    escapeHtml: escapeHtml,
    formatRange: formatRange,
    hasMedia: hasMedia,
    clientTakeId: clientTakeId,
    audioDataToWav: audioDataToWav
  };
  bootstrap();
})(window, document);
