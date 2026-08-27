(function(window, document) {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var state = {
    setId: String(params.get('set') || '').trim(),
    assignmentId: String(params.get('assignment') || '').trim(),
    teacherMode: params.get('teacher') === '1',
    visitorMode: params.get('visitor') === '1' || localStorage.getItem('mrcat_visitor') === 'true',
    material: null,
    progress: null,
    replayId: '',
    currentIndex: 0,
    playbackEndIndex: 0,
    started: false,
    playing: false,
    stopAt: 0,
    visitorFullAudio: false,
    busy: false,
    autoAdvancing: false,
    localUnits: {},
    slotDisputes: {},
    selectedArgue: null,
    linkedPractice: null,
    assignmentContext: null,
    lastAudioTime: null,
    lastActivitySentAt: 0,
    activityInFlight: false,
    activityPending: ''
  };

  function $(selector) { return document.querySelector(selector); }
  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function(character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }
  function unitMode(unit) {
    var mode = String(unit && unit.practice_mode || '').trim();
    if (['dictation', 'listen_only', 'skip'].indexOf(mode) >= 0) return mode;
    return unit && Array.isArray(unit.slots) && unit.slots.length === 0 ? 'skip' : 'dictation';
  }
  function isDictation(unit) { return unitMode(unit) === 'dictation'; }
  function isProvided(slot) { return String(slot && slot.spelling_requirement || 'required') === 'provided'; }
  function disputeKey(unitId, slotId) { return String(unitId) + '::' + String(slotId); }
  function currentUnit() { return state.material.units[state.currentIndex]; }
  function currentLocal() { return state.localUnits[currentUnit().unit_id]; }
  function currentServer() { return state.progress.unit_progress[currentUnit().unit_id] || {}; }

  function safeReturnUrl() {
    var fallback = state.teacherMode ? 'teacher.html' : 'intensive-listening-library.html';
    var requested = params.get('return');
    if (!requested) return fallback;
    try {
      var url = new URL(requested, window.location.href);
      return url.origin === window.location.origin ? url.href : fallback;
    } catch (error) { return fallback; }
  }

  function studentIdentity() {
    try {
      var profile = JSON.parse(localStorage.getItem('mrcat_student_profile') || 'null');
      return String(profile && profile.student_id || 'student');
    } catch (error) { return 'student'; }
  }
  function draftKey() {
    return ['mrcat', 'intensive-listening', studentIdentity(), state.setId, state.replayId ? 'temporary' : 'best', 'v2'].join(':');
  }
  function saveDraft() {
    if (!state.material || state.teacherMode || state.visitorMode) return;
    var units = {};
    Object.keys(state.localUnits).forEach(function(unitId) {
      var local = state.localUnits[unitId];
      if (!local.entries.length) return;
      units[unitId] = {
        entries: local.entries,
        marks: local.marks,
        answerVisible: local.answerVisible,
        answerText: local.answerVisible ? local.answerText : '',
        answers: local.answerVisible ? local.answers : []
      };
    });
    try {
      localStorage.setItem(draftKey(), JSON.stringify({
        currentIndex: state.currentIndex,
        contentVersion: state.material.content_version,
        units: units,
        savedAt: new Date().toISOString()
      }));
    } catch (error) { /* Server progress remains authoritative. */ }
  }
  function readDraft() {
    if (state.teacherMode || state.visitorMode) return null;
    try {
      var draft = JSON.parse(localStorage.getItem(draftKey()) || 'null');
      if (!draft || String(draft.contentVersion) !== String(state.material.content_version) || !draft.units) return null;
      return draft;
    } catch (error) { return null; }
  }
  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch (error) { /* no-op */ }
  }
  function emptyLocalUnit(unit, serverUnit) {
    var slotCount = Array.isArray(unit.slots) ? unit.slots.length : 0;
    return {
      entries: Array(slotCount).fill(''), marks: Array(slotCount).fill(''),
      answerVisible: false, answerText: '', answers: [], replayDelta: 0,
      checks: Number(serverUnit && serverUnit.checks) || 0
    };
  }
  function firstPlayableIndex() {
    return 0;
  }
  function applyServerMarks(local, serverUnit) {
    if (serverUnit.correct_positions_reliable === false) {
      local.marks = local.marks.map(function(mark) { return mark === 'correct' ? '' : mark; });
      return;
    }
    (serverUnit.correct_positions || []).forEach(function(correct, index) {
      if (correct) local.marks[index] = 'correct';
    });
  }
  function hydrateLocalUnits() {
    var draft = readDraft();
    state.localUnits = {};
    state.material.units.forEach(function(unit) {
      var serverUnit = state.progress.unit_progress[unit.unit_id] || {};
      var local = emptyLocalUnit(unit, serverUnit);
      var saved = draft && draft.units[unit.unit_id];
      if (saved && Array.isArray(saved.entries) && saved.entries.length === unit.slots.length) {
        local.entries = saved.entries.map(function(value) { return String(value || '').replace(/\s+/g, ''); });
        local.marks = Array.isArray(saved.marks) && saved.marks.length === unit.slots.length ? saved.marks : local.marks;
        local.answerVisible = saved.answerVisible === true && (serverUnit.assisted === true || state.teacherMode);
        local.answerText = local.answerVisible ? String(saved.answerText || '') : '';
        local.answers = local.answerVisible && Array.isArray(saved.answers) ? saved.answers.map(String) : [];
      }
      applyServerMarks(local, serverUnit);
      unit.slots.forEach(function(slot, index) { if (isProvided(slot)) local.marks[index] = 'correct'; });
      local.checks = Number(serverUnit.checks) || 0;
      state.localUnits[unit.unit_id] = local;
    });
    if (state.teacherMode || Number(state.progress.completed_count || 0) === 0) {
      state.currentIndex = firstPlayableIndex();
      return;
    }
    var requestedIndex = Number(draft && draft.currentIndex);
    var firstIncomplete = state.material.units.findIndex(function(unit) {
      return isDictation(unit) && !(state.progress.unit_progress[unit.unit_id] || {}).completed;
    });
    if (Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < state.material.units.length) {
      var requestedUnit = state.material.units[requestedIndex];
      if (isDictation(requestedUnit) && !(state.progress.unit_progress[requestedUnit.unit_id] || {}).completed) {
        state.currentIndex = requestedIndex;
        return;
      }
    }
    state.currentIndex = firstIncomplete < 0 ? firstPlayableIndex() : firstIncomplete;
  }

  function applyMaterialUpdate(material) {
    if (!material || !state.material) return;
    var currentId = currentUnit() && currentUnit().unit_id;
    var previousLocals = state.localUnits;
    state.material = material;
    state.localUnits = {};
    state.material.units.forEach(function(unit) {
      var existing = previousLocals[unit.unit_id];
      var serverUnit = state.progress.unit_progress[unit.unit_id] || {};
      var local = existing && existing.entries.length === unit.slots.length ? existing : emptyLocalUnit(unit, serverUnit);
      unit.slots.forEach(function(slot, index) { if (isProvided(slot)) local.marks[index] = 'correct'; });
      state.localUnits[unit.unit_id] = local;
    });
    var nextIndex = state.material.units.findIndex(function(unit) { return unit.unit_id === currentId; });
    state.currentIndex = nextIndex < 0 ? firstPlayableIndex() : nextIndex;
    renderUnit();
  }

  function call(action, payload) {
    if (state.visitorMode) {
      return Promise.reject(new Error('Visitor Mode is listen-only.'));
    }
    return window.MrCatCloud.callAuthenticatedFunction('intensiveListening', Object.assign({
      action: action, set_id: state.setId, assignment_id: state.assignmentId || null,
      replay_id: state.replayId || null, teacher_mode: state.teacherMode,
      policy_revision: state.material ? state.material.policy_revision : null
    }, payload || {})).then(function(result) {
      if (!result || !result.success) {
        var error = new Error(result && result.message || 'Unable to continue this practice.');
        error.code = result && result.code || 'INTENSIVE_LISTENING_ERROR';
        throw error;
      }
      if (result.material_update) applyMaterialUpdate(result.material_update);
      return result;
    });
  }
  function activity(kind) {
    if (state.visitorMode || state.teacherMode) return Promise.resolve(null);
    if (state.activityInFlight) {
      state.activityPending = kind || 'playback';
      return Promise.resolve(null);
    }
    var now = Date.now();
    if (now - state.lastActivitySentAt < 5000) return Promise.resolve(null);
    state.lastActivitySentAt = now;
    state.activityInFlight = true;
    var payload = {
      action: 'recordActivity',
      set_id: state.setId,
      activity_type: kind === 'replay' ? 'replay' : kind === 'navigation' ? 'unit_navigation' : kind === 'seek' ? 'seek' : 'audio_progress'
    };
    if (state.assignmentId) payload.assignment_id = state.assignmentId;
    if (state.replayId) payload.replay_id = state.replayId;
    return window.MrCatCloud.callAuthenticatedFunction('intensiveListening', payload).then(function(result) {
      if (!result || !result.success) throw new Error(result && result.message || 'Unable to sync listening activity.');
      // Navigation/seek is allowed to refresh an existing session but must not
      // consume the five-second coalescing window before the first real audio
      // movement can establish a new one.
      if (!result.session_id) state.lastActivitySentAt = 0;
      if (result.progress) applyProgress(result.progress);
      var syncStatus = $('#activity-sync-status');
      if (syncStatus) syncStatus.hidden = true;
      return result;
    }).catch(function() {
      var syncStatus = $('#activity-sync-status');
      if (syncStatus) syncStatus.hidden = false;
      return null;
    }).then(function(result) {
      state.activityInFlight = false;
      var pending = state.activityPending;
      state.activityPending = '';
      if (pending) window.setTimeout(function() { activity(pending); }, 0);
      return result;
    });
  }
  function linkedHref(link, returnUrl) {
    if (!link || !link.href) return '';
    try {
      var url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return '';
      url.searchParams.set('return', returnUrl || window.location.href);
      return url.pathname.split('/').pop() + (url.search ? url.search : '') + (url.hash || '');
    } catch (error) { return ''; }
  }
  function renderMaterialContext() {
    var source = String(state.material && state.material.source_label || '').trim();
    var series = String(state.material && state.material.series_label || '').trim();
    $('#material-source').textContent = source ? source + (series ? ' · ' + series : '') : 'LISTEN · TYPE · CHECK';
    var assignment = state.assignmentContext;
    var context = $('#assignment-context');
    if (assignment && assignment.assignment_id) {
      var due = assignment.due_at ? new Date(assignment.due_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      context.textContent = 'Assignment' + (due ? ' · Due ' + due : '') + ' · Completion target ' + (Number(assignment.completion_target) || 100) + '%';
      context.hidden = false;
    } else {
      context.hidden = true;
    }
    var linked = linkedHref(state.linkedPractice, window.location.href);
    var headerLink = $('#linked-practice-header');
    var finish = $('#completion-finish');
    if (linked) {
      headerLink.href = linked;
      headerLink.hidden = false;
      if (finish) { finish.href = linked; finish.textContent = 'Continue to Listening Practice'; }
    } else {
      headerLink.hidden = true;
      if (finish) { finish.href = safeReturnUrl(); finish.textContent = 'Back to Intensive Listening'; }
    }
  }
  function formatTime(value) {
    var seconds = Math.max(0, Number(value) || 0);
    return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  }
  function dictationPosition(index) {
    var count = 0;
    state.material.units.forEach(function(unit, unitIndex) { if (unitIndex <= index && isDictation(unit)) count += 1; });
    return count;
  }
  function applyProgress(progress) {
    if (!progress) return;
    state.progress = progress;
    state.material.units.forEach(function(unit) {
      if (!isDictation(unit)) return;
      var serverUnit = progress.unit_progress[unit.unit_id] || {};
      var local = state.localUnits[unit.unit_id] || emptyLocalUnit(unit, serverUnit);
      local.checks = Number(serverUnit.checks) || 0;
      applyServerMarks(local, serverUnit);
      state.localUnits[unit.unit_id] = local;
    });
    renderProgress();
  }
  function renderProgress() {
    if (state.visitorMode) return;
    var progress = state.progress || {};
    var percentage = Number(progress.percentage) || 0;
    $('#header-progress').value = percentage;
    $('#header-progress-label').textContent = percentage + '%';
    $('#completed-count').textContent = Number(progress.completed_count) || 0;
    $('#independent-count').textContent = Number(progress.independent_count) || 0;
    $('#assisted-count').textContent = Number(progress.assisted_count) || 0;
    $('#replay-count').textContent = Number(progress.replay_count || 0) + Object.keys(state.localUnits).reduce(function(sum, unitId) {
      return sum + (Number(state.localUnits[unitId].replayDelta) || 0);
    }, 0);
  }

  function bindSlots() {
    document.querySelectorAll('.il-word-slot').forEach(function(input) {
      input.addEventListener('input', function() {
        var index = Number(input.dataset.slotIndex);
        var local = currentLocal();
        local.entries[index] = input.value.replace(/\s+/g, '');
        local.marks[index] = '';
        input.value = local.entries[index];
        input.classList.remove('incorrect');
        $('#feedback').className = 'il-feedback';
        $('#feedback').textContent = 'Keep listening. Enter checks the complete unit.';
        saveDraft();
      });
      input.addEventListener('keydown', function(event) {
        if (event.key === ' ') {
          event.preventDefault();
          var index = Number(input.dataset.slotIndex);
          var next = Array.from(document.querySelectorAll('.il-word-slot:not(:disabled)')).find(function(candidate) {
            return Number(candidate.dataset.slotIndex) > index;
          });
          if (next) next.focus();
        } else if (event.key === 'Tab') {
          event.preventDefault(); replayUnit(true);
        } else if (event.key === 'Enter') {
          event.preventDefault(); checkUnit();
        }
      });
    });
  }
  function renderAnswerTokens() {
    var unit = currentUnit();
    var local = currentLocal();
    if (!local.answerVisible || !local.answers.length) {
      $('#answer-tokens').innerHTML = local.answerVisible ? escapeHtml(local.answerText) : '';
      return;
    }
    $('#answer-tokens').innerHTML = unit.slots.map(function(slot, index) {
      var dispute = state.slotDisputes[disputeKey(unit.unit_id, slot.slot_id)];
      var classes = ['il-answer-token'];
      if (isProvided(slot)) classes.push('provided');
      if (dispute && dispute.status) classes.push(dispute.status);
      var content = escapeHtml((slot.prefix || '') + String(local.answers[index] || '') + (slot.suffix || ''));
      if (isProvided(slot)) return '<span class="' + classes.join(' ') + '" title="Provided word">' + content + '</span>';
      return '<button class="' + classes.join(' ') + '" type="button" data-argue-slot-index="' + index + '">' + content + '</button>';
    }).join('');
    document.querySelectorAll('[data-argue-slot-index]').forEach(function(button) {
      button.addEventListener('click', function() { openArgue(Number(button.dataset.argueSlotIndex)); });
    });
  }
  function adjacentPlayableIndex(offset) {
    var index = state.currentIndex + offset;
    return index >= 0 && index < state.material.units.length ? index : -1;
  }
  function updateUnitNavigation() {
    var locked = state.busy || state.autoAdvancing;
    $('#previous-unit-button').disabled = locked || adjacentPlayableIndex(-1) < 0;
    $('#next-unit-button').disabled = locked || adjacentPlayableIndex(1) < 0;
  }
  function renderUnit() {
    var unit = currentUnit();
    if (!unit) return;
    var mode = unitMode(unit);
    var local = currentLocal();
    var server = currentServer();
    var position = dictationPosition(state.currentIndex);
    $('#unit-label').textContent = state.visitorMode
      ? 'FULL PROGRAMME'
      : mode === 'dictation' ? 'UNIT ' + String(position).padStart(2, '0') : 'JUST LISTEN';
    $('#speaker-label').textContent = unit.speaker || '';
    $('#unit-position').textContent = state.visitorMode
      ? 'LISTEN ONLY'
      : mode === 'dictation' ? position + ' / ' + state.material.unit_count : 'LISTEN';
    updateUnitNavigation();
    $('#time-range').textContent = state.visitorFullAudio ? 'Full audio' : formatTime(unit.start_seconds) + ' – ' + formatTime(unit.end_seconds);
    $('#practice-card').dataset.mode = mode;
    var passiveListening = state.visitorMode || mode !== 'dictation';
    $('#listen-only-panel').hidden = !passiveListening;
    $('#word-slots').hidden = passiveListening;
    $('#feedback').hidden = passiveListening;
    $('#practice-card .il-actions').hidden = passiveListening;
    $('#answer-panel').hidden = passiveListening || !local.answerVisible;
    if (passiveListening) {
      $('#audio-status').textContent = state.playing ? 'Listening…' : 'Press Replay to hear this part';
      if (state.visitorMode) {
        $('#listen-only-panel strong').textContent = 'VISITOR · JUST LISTEN';
        $('#listen-only-panel input').value = 'Visitor Mode is listening-only. Sign in to practise dictation.';
      }
      saveDraft();
      return;
    }
    $('#word-slots').innerHTML = unit.slots.map(function(slot, index) {
      if (isProvided(slot)) {
        return '<span class="il-word-token"><span class="il-punctuation">' + escapeHtml(slot.prefix || '') + '</span>' +
          '<span class="il-provided-word" aria-label="Provided word">' + escapeHtml(slot.provided_text || '') + '</span>' +
          '<span class="il-punctuation">' + escapeHtml(slot.suffix || '') + '</span></span>';
      }
      var disabled = server.completed === true || (server.correct_positions || [])[index] === true || local.answerVisible || state.teacherMode;
      return '<span class="il-word-token"><span class="il-punctuation">' + escapeHtml(slot.prefix || '') + '</span>' +
        '<input class="il-word-slot ' + escapeHtml(local.marks[index] || '') + '" data-slot-index="' + index + '" aria-label="Word ' + (index + 1) + '" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + escapeHtml(local.entries[index]) + '" ' + (disabled ? 'disabled' : '') + '>' +
        '<span class="il-punctuation">' + escapeHtml(slot.suffix || '') + '</span></span>';
    }).join('');
    $('#check-count').textContent = state.teacherMode ? 'TEACHER PREVIEW' : Math.min(Number(server.checks) || 0, 3) + ' / 3 checks';
    $('#continue-button').textContent = state.currentIndex === state.material.units.length - 1 ? 'Finish' : 'Continue';
    $('#check-button').hidden = state.teacherMode;
    $('#check-button').disabled = state.busy || server.completed === true;
    $('#answer-button').disabled = state.busy || local.answerVisible;
    renderAnswerTokens();
    bindSlots();
    if (state.started && !state.teacherMode && !state.playing) window.setTimeout(function() {
      var first = $('#word-slots .il-word-slot:not(:disabled)'); if (first) first.focus();
    }, 0);
    saveDraft();
  }

  function setBusy(busy, message) {
    state.busy = busy;
    updateUnitNavigation();
    if (currentUnit() && isDictation(currentUnit())) {
      $('#check-button').disabled = busy || state.teacherMode || currentServer().completed === true;
      $('#answer-button').disabled = busy || currentLocal().answerVisible;
    }
    if (message) { $('#feedback').className = 'il-feedback'; $('#feedback').textContent = message; }
  }
  function checkUnit() {
    if (state.teacherMode || state.visitorMode || state.busy || !isDictation(currentUnit()) || currentServer().completed) return;
    var unit = currentUnit(); var local = currentLocal();
    setBusy(true, 'Checking this unit…');
    call('check', { unit_id: unit.unit_id, entries: local.entries, replay_delta: local.replayDelta }).then(function(result) {
      local.replayDelta = 0;
      local.marks = result.marks.map(function(mark) { return mark ? 'correct' : 'incorrect'; });
      applyProgress(result.progress); setBusy(false);
      if (result.completed) {
        $('#feedback').className = 'il-feedback success';
        $('#feedback').textContent = 'Perfect. Moving to the next unit…';
        state.autoAdvancing = true;
        renderUnit();
        window.setTimeout(function() { state.autoAdvancing = false; advanceUnit(); }, 650);
        return;
      }
      renderUnit();
      var firstWrong = result.marks.findIndex(function(mark, index) { return !mark && !isProvided(unit.slots[index]); });
      $('#feedback').className = 'il-feedback error';
      $('#feedback').textContent = result.effective_check
        ? result.marks.filter(function(mark, index) { return !mark && !isProvided(unit.slots[index]); }).length + ' word slots need another listen.'
        : 'Change at least one incorrect word before checking again.';
      var firstWrongInput = document.querySelector('[data-slot-index="' + firstWrong + '"]');
      if (firstWrongInput) firstWrongInput.focus(); saveDraft();
    }).catch(function(error) {
      setBusy(false); $('#feedback').className = 'il-feedback error';
      $('#feedback').textContent = error.message + ' Your words are still here.';
    });
  }
  function showAnswer() {
    if (state.visitorMode || state.busy || !isDictation(currentUnit()) || currentLocal().answerVisible) return;
    var unit = currentUnit(); var local = currentLocal();
    setBusy(true, state.teacherMode ? 'Opening the reviewed answer…' : 'Checking whether the answer is available…');
    call('reveal', { unit_id: unit.unit_id, replay_delta: local.replayDelta }).then(function(result) {
      setBusy(false);
      if (!result.answer_available) {
        $('#feedback').className = 'il-feedback';
        $('#feedback').textContent = result.remaining_checks === 1 ? 'Try harder — one more effective check.' : 'Try harder — ' + result.remaining_checks + ' more effective checks.';
        return;
      }
      local.replayDelta = 0; local.answerVisible = true; local.answerText = result.answer_text;
      local.answers = Array.isArray(result.answers) ? result.answers.map(String) : [];
      if (result.progress) applyProgress(result.progress);
      $('#feedback').className = 'il-feedback';
      $('#feedback').textContent = state.teacherMode ? 'Click a word to request a spelling exemption.' : 'Compare every position. Click a word if you think it should be provided.';
      renderUnit();
    }).catch(function(error) {
      setBusy(false); $('#feedback').className = 'il-feedback error'; $('#feedback').textContent = error.message;
    });
  }

  function nextPlaybackEndIndex(startIndex) {
    return startIndex;
  }
  function pauseAudio(message) {
    $('#audio').pause(); state.playing = false; $('#replay-button').textContent = '▶';
    if (message) $('#audio-status').textContent = message;
  }
  function finishPlayback() {
    pauseAudio('');
    if (!currentUnit()) return;
    if (state.visitorMode) {
      $('#audio-status').textContent = 'Full programme finished';
      return;
    }
    if (!isDictation(currentUnit())) {
      $('#audio-status').textContent = 'Listening part finished'; advanceUnit(); return;
    }
    $('#audio-status').textContent = state.teacherMode ? 'Unit finished · show the reviewed answer' : 'Unit finished · type what you heard';
    var first = $('#word-slots .il-word-slot:not(:disabled)'); if (first) first.focus();
  }
  function advanceUnit() {
    if (state.currentIndex >= state.material.units.length - 1) { finishSession(); return; }
    state.currentIndex += 1;
    $('#feedback').className = 'il-feedback';
    $('#feedback').textContent = isDictation(currentUnit()) ? 'Listen once, then type one word in each slot.' : '';
    renderUnit(); replayUnit(false);
  }
  function moveToUnit(offset) {
    if (!state.material || state.busy || state.autoAdvancing) return;
    var targetIndex = adjacentPlayableIndex(offset);
    if (targetIndex < 0) return;
    pauseAudio('');
    state.currentIndex = targetIndex;
    $('#feedback').className = 'il-feedback';
    $('#feedback').textContent = isDictation(currentUnit()) ? 'Listen once, then type one word in each slot.' : '';
    renderUnit();
    activity('navigation');
    replayUnit(false);
  }
  function replayUnit(countReplay) {
    if (!state.material || state.busy) return;
    var audio = $('#audio'); var unit = currentUnit();
    if (countReplay && isDictation(unit) && !state.teacherMode) {
      currentLocal().replayDelta += 1; renderProgress(); saveDraft();
    }
    pauseAudio('');
    // Each unit starts a fresh playhead window. Without resetting this
    // baseline, moving from a long unit back to an earlier timestamp could
    // suppress every subsequent 30-second heartbeat until the old timestamp
    // was reached again.
    state.lastAudioTime = null;
    state.playbackEndIndex = nextPlaybackEndIndex(state.currentIndex);
    var endUnit = state.material.units[state.playbackEndIndex];
    try { audio.currentTime = Number(unit.start_seconds) || 0; } catch (error) { /* metadata settles before play */ }
    state.stopAt = state.visitorFullAudio ? Infinity : Number(endUnit.end_seconds) || 0;
    audio.play().then(function() {
      state.playing = true; $('#replay-button').textContent = 'Ⅱ'; $('#audio-status').textContent = 'Listening…';
    }).catch(function() {
      state.playing = false; $('#replay-button').textContent = '▶'; $('#audio-status').textContent = 'Press Replay to hear this unit';
    });
  }
  function startRitual() {
    var button = $('#start-button'); button.disabled = true; button.classList.add('counting');
    var remaining = 3; $('#start-button-label').textContent = remaining;
    var timer = window.setInterval(function() {
      remaining -= 1;
      if (remaining > 0) { $('#start-button-label').textContent = remaining; return; }
      window.clearInterval(timer); $('#start-button-label').textContent = 'Listen';
      window.setTimeout(function() {
        state.started = true; $('#start-screen').hidden = true; $('#practice-shell').hidden = false;
        renderUnit(); replayUnit(false);
      }, 380);
    }, 1000);
  }
  function finishSession() {
    pauseAudio('');
    if (state.teacherMode) { window.location.href = safeReturnUrl(); return; }
    if (state.visitorMode) {
      state.currentIndex = firstPlayableIndex();
      $('#feedback').className = 'il-feedback';
      $('#feedback').textContent = 'Listening complete. Replay any sentence, or return when you are ready.';
      renderUnit();
      return;
    }
    var firstIncomplete = state.material.units.findIndex(function(unit) {
      return isDictation(unit) && !(state.progress.unit_progress[unit.unit_id] || {}).completed;
    });
    if (firstIncomplete >= 0) {
      state.currentIndex = firstIncomplete;
      $('#feedback').className = 'il-feedback';
      $('#feedback').textContent = 'This unit still needs your answer.';
      renderUnit(); replayUnit(false);
      return;
    }
    var progress = state.progress;
    $('#completion-percent').textContent = (Number(progress.percentage) || 0) + '%';
    $('#completion-summary').textContent = progress.independent_count + ' completed independently · ' + progress.assisted_count + ' completed with answer';
    $('#completion-screen').hidden = false; clearDraft();
  }
  function startTemporaryReplay() {
    if (state.busy || state.teacherMode) return;
    state.busy = true; $('#restart-button').disabled = true; $('#restart-button').textContent = 'Preparing…';
    call('startReplay').then(function(result) {
      state.replayId = result.replay_id; state.progress = result.progress; state.currentIndex = firstPlayableIndex();
      state.started = false; state.busy = false; hydrateLocalUnits(); renderProgress();
      $('#completion-screen').hidden = true; $('#practice-shell').hidden = true; $('#start-screen').hidden = false;
      $('#start-title').textContent = state.material.title;
      $('#start-copy').textContent = 'Temporary practice is ready. Your best record stays at 100%.';
      $('#start-button').disabled = false; $('#start-button').classList.remove('counting'); $('#start-button-label').textContent = 'Start';
      $('#restart-button').disabled = false; $('#restart-button').textContent = 'Clear & Start Again';
    }).catch(function(error) {
      state.busy = false; $('#restart-button').disabled = false; $('#restart-button').textContent = 'Clear & Start Again';
      $('#completion-summary').textContent = error.message;
    });
  }

  function openArgue(slotIndex) {
    var unit = currentUnit(); var local = currentLocal(); var slot = unit.slots[slotIndex];
    if (!slot || isProvided(slot) || !local.answerVisible) return;
    var existing = state.slotDisputes[disputeKey(unit.unit_id, slot.slot_id)];
    state.selectedArgue = { unit: unit, slot: slot, answer: local.answers[slotIndex] || '' };
    $('#argue-word').textContent = state.selectedArgue.answer; $('#argue-reason').value = '';
    $('#argue-title').textContent = state.teacherMode ? 'Provide this word for every student?' : 'Should this word be provided?';
    $('#argue-copy').textContent = state.teacherMode
      ? 'Confirming makes this word provided in the live material for every student.'
      : 'This asks the teacher to show the word automatically instead of requiring students to spell it.';
    $('#argue-reason').hidden = state.teacherMode;
    $('#argue-status').textContent = existing
      ? (existing.status === 'pending' ? 'Waiting for teacher review.' : existing.status === 'approved' ? 'Approved — this word is now provided.' : 'The teacher kept spelling required.') : '';
    $('#argue-reason').disabled = Boolean(existing); $('#argue-submit').hidden = Boolean(existing);
    $('#argue-submit').textContent = state.teacherMode ? 'Approve' : 'Send Argue';
    var sentTitle = document.querySelector('#argue-modal .il-argue-sent-message strong');
    var sentCopy = document.querySelector('#argue-modal .il-argue-sent-message span:not(.il-argue-heart)');
    if (sentTitle) sentTitle.textContent = state.teacherMode ? 'Provided to every student.' : 'Sent to teacher.';
    if (sentCopy) sentCopy.textContent = state.teacherMode ? 'This spelling exemption is now live.' : 'Thanks for your feedback.';
    $('#argue-submit').disabled = false;
    $('#argue-box').classList.remove('sent');
    $('#argue-modal').hidden = false; if (!existing) $('#argue-reason').focus();
  }
  function closeArgue() {
    $('#argue-modal').hidden = true;
    $('#argue-box').classList.remove('sent');
    state.selectedArgue = null;
  }
  function submitArgue() {
    if (!state.selectedArgue || state.busy) return;
    var selected = state.selectedArgue; var button = $('#argue-submit');
    button.disabled = true; button.textContent = state.teacherMode ? 'Approving…' : 'Sending…';
    if (state.teacherMode) {
      call('provideWord', {
        unit_id: selected.unit.unit_id, slot_id: selected.slot.slot_id
      }).then(function(result) {
        if (result.material) applyMaterialUpdate(result.material);
        $('#argue-status').textContent = result.already_applied ? 'This word was already provided.' : 'Provided to every student.';
        button.hidden = true;
        $('#argue-box').classList.add('sent');
        window.setTimeout(function() { if (!$('#argue-modal').hidden) $('#argue-sent-close').focus(); }, 450);
      }).catch(function(error) {
        $('#argue-status').textContent = error.message; button.disabled = false; button.textContent = 'Approve';
      });
      return;
    }
    call('submitSpellingDispute', {
      unit_id: selected.unit.unit_id, slot_id: selected.slot.slot_id, reason: $('#argue-reason').value.trim()
    }).then(function(result) {
      state.slotDisputes[disputeKey(selected.unit.unit_id, selected.slot.slot_id)] = { dispute_id: result.dispute_id || '', status: result.status || 'pending' };
      $('#argue-status').textContent = result.status === 'approved' ? 'Approved — this word is now provided.' : 'Sent to teacher.';
      $('#argue-reason').disabled = true; button.hidden = true; renderAnswerTokens();
      $('#argue-box').classList.add('sent');
      window.setTimeout(function() { if (!$('#argue-modal').hidden) $('#argue-sent-close').focus(); }, 450);
    }).catch(function(error) {
      $('#argue-status').textContent = error.message; button.disabled = false; button.textContent = 'Send Argue';
    });
  }
  function exportLatest() {
    var button = $('#export-button'); button.disabled = true; button.textContent = 'Exporting…';
    call('exportMaterial').then(function(result) {
      var blob = new Blob([JSON.stringify(result.material, null, 2) + '\n'], { type: 'application/json;charset=utf-8' });
      var href = URL.createObjectURL(blob); var link = document.createElement('a');
      link.href = href; link.download = result.filename || state.setId + '.json'; document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(function() { URL.revokeObjectURL(href); }, 1000);
      button.disabled = false; button.textContent = 'Export Latest JSON';
    }).catch(function(error) {
      button.disabled = false; button.textContent = 'Export failed';
      window.setTimeout(function() { button.textContent = 'Export Latest JSON'; }, 1800);
      $('#feedback').hidden = false; $('#feedback').className = 'il-feedback error'; $('#feedback').textContent = error.message;
    });
  }
  function refreshPolicy() {
    if (!state.material || state.visitorMode || document.hidden) return;
    call('policy').catch(function() { /* The next normal action retries. */ });
  }
  function showLoadError(error) {
    $('#start-title').textContent = 'Practice unavailable';
    $('#start-copy').textContent = error.message || 'Unable to load this listening material.';
    $('#start-button').hidden = true;
    $('#start-note').textContent = error.code === 'AUTH_REQUIRED' ? 'Return to the login page and sign in first.' : 'Please return and try again.';
  }
  function loadVisitorMaterial() {
    var sourceSetId = state.setId.replace(/^IL-/i, '');
    if (!/^BBC-[A-Za-z0-9-]+$/.test(sourceSetId)) {
      return Promise.reject(new Error('This listening audio is not available in Visitor Mode.'));
    }
    return window.fetch('data/' + encodeURIComponent(sourceSetId) + '.json', { credentials: 'same-origin' }).then(function(response) {
      if (!response.ok) throw new Error('This listening audio is not available right now.');
      return response.json();
    }).then(function(source) {
      var audioSrc = String(source && source.audioSrc || '').trim();
      if (!audioSrc) throw new Error('This listening audio is not available right now.');
      return {
        visitor_mode: true,
        material: {
          material_id: state.setId,
          set_id: state.setId,
          title: String(source.title || 'Intensive Listening'),
          audio_src: audioSrc,
          content_version: 'visitor-public-audio-v1',
          sequence_count: 1,
          units: [{
            unit_id: 'visitor-full-audio', speaker: '', start_seconds: 0, end_seconds: 0,
            practice_mode: 'listen_only', slots: []
          }]
        }
      };
    });
  }
  function initialize() {
    if (!state.setId) { showLoadError(new Error('No listening material was selected.')); return; }
    var bootstrap = state.visitorMode ? loadVisitorMaterial() : call('bootstrap');
    bootstrap.then(function(result) {
      state.visitorMode = result.visitor_mode === true || state.visitorMode;
      state.visitorFullAudio = state.visitorMode;
      state.teacherMode = result.teacher_mode === true || state.teacherMode;
      state.material = result.material;
      state.material.source_label = String(result.source_label || state.material.source_label || '');
      state.material.series_label = String(result.series_label || state.material.series_label || '');
      state.progress = result.progress || { percentage: 0, completed_count: 0, independent_count: 0, assisted_count: 0, replay_count: 0, best_percentage: 0, unit_progress: {} };
      state.linkedPractice = result.linked_practice || null;
      state.assignmentContext = result.assignment_context || null;
      state.slotDisputes = {};
      (result.slot_disputes || []).forEach(function(dispute) { state.slotDisputes[disputeKey(dispute.unit_id, dispute.slot_id)] = dispute; });
      $('#material-title').textContent = state.material.title; $('#start-title').textContent = state.material.title;
      renderMaterialContext();
      $('#start-copy').textContent = 'The first unit waits for you. Later units play once when you enter them.';
      $('#audio').src = state.material.audio_src; hydrateLocalUnits(); renderProgress();
      if (state.visitorMode) {
        document.body.classList.add('il-visitor-mode');
        $('#header-progress').parentElement.hidden = true;
        $('.il-stats').hidden = true;
        $('.il-mode').textContent = 'VISITOR · LISTEN ONLY';
        $('#start-copy').textContent = 'Listen to the full programme. Dictation, answers, and saved progress require a student account.';
        $('#start-note').textContent = 'Visitor Mode plays public audio only and never loads answer data.';
        $('#previous-unit-button').hidden = true; $('#next-unit-button').hidden = true;
        renderUnit(); $('#start-button').disabled = false; $('#start-button-label').textContent = 'Listen';
        return;
      }
      if (state.teacherMode) {
        state.started = true; $('#export-button').hidden = false; $('#start-screen').hidden = true; $('#practice-shell').hidden = false;
        renderUnit(); $('#feedback').textContent = 'Teacher preview · replay the unit, then open Show Answer to mark a word.'; return;
      }
      if (Number(state.progress.best_percentage) >= 100 && Number(state.progress.percentage) >= 100) {
        $('#start-screen').hidden = true; $('#completion-screen').hidden = false;
        $('#completion-percent').textContent = state.progress.best_percentage + '%';
        $('#completion-summary').textContent = state.progress.independent_count + ' completed independently · ' + state.progress.assisted_count + ' completed with answer'; return;
      }
      renderUnit(); $('#start-button').disabled = false; $('#start-button-label').textContent = 'Start';
    }).catch(function(error) {
      if (error.code === 'AUTH_REQUIRED' || /Please log in/i.test(error.message || '')) {
        window.location.replace('index.html?return=' + encodeURIComponent(window.location.href)); return;
      }
      showLoadError(error);
    });
  }

  $('#start-button').addEventListener('click', startRitual);
  $('#replay-button').addEventListener('click', function() { state.playing ? pauseAudio('Paused · press Replay to continue') : replayUnit(true); });
  $('#check-button').addEventListener('click', checkUnit);
  $('#answer-button').addEventListener('click', showAnswer);
  $('#continue-button').addEventListener('click', advanceUnit);
  $('#previous-unit-button').addEventListener('click', function() { moveToUnit(-1); });
  $('#next-unit-button').addEventListener('click', function() { moveToUnit(1); });
  $('#restart-button').addEventListener('click', startTemporaryReplay);
  $('#export-button').addEventListener('click', exportLatest);
  $('#audio').addEventListener('timeupdate', function() {
    if (!state.playing) return;
    var currentTime = Number($('#audio').currentTime) || 0;
    if (!state.visitorMode && !state.teacherMode && state.started && currentTime > 0) {
      var changed = state.lastAudioTime == null || currentTime > state.lastAudioTime + 0.08;
      var due = Date.now() - state.lastActivitySentAt >= 30000;
      if (changed && (state.lastAudioTime == null || due)) {
        activity('playback');
      }
      state.lastAudioTime = currentTime;
    }
    while (state.currentIndex < state.playbackEndIndex) {
      var next = state.material.units[state.currentIndex + 1];
      if (!next || $('#audio').currentTime < Number(next.start_seconds || 0)) break;
      state.currentIndex += 1; renderUnit();
    }
    if (Number.isFinite(state.stopAt) && $('#audio').currentTime >= state.stopAt) finishPlayback();
  });
  $('#audio').addEventListener('ended', finishPlayback);
  // The native seek bar is intentionally not exposed. Unit navigation may
  // refresh an already-active session, but only a moving playhead can create
  // one. Ignoring the programmatic `currentTime` seek here prevents a
  // Start/Replay click from notifying the teacher before audio really moves.
  window.setInterval(refreshPolicy, 30000);
  window.addEventListener('focus', refreshPolicy);
  $('#back-button').addEventListener('click', function() { pauseAudio(''); $('#leave-modal').hidden = false; $('#leave-cancel').focus(); });
  $('#leave-cancel').addEventListener('click', function() { $('#leave-modal').hidden = true; });
  $('#leave-confirm').addEventListener('click', function() { window.location.href = safeReturnUrl(); });
  $('#leave-modal').addEventListener('click', function(event) { if (event.target === $('#leave-modal')) $('#leave-modal').hidden = true; });
  $('#argue-close').addEventListener('click', closeArgue);
  $('#argue-cancel').addEventListener('click', closeArgue);
  $('#argue-sent-close').addEventListener('click', closeArgue);
  $('#argue-submit').addEventListener('click', submitArgue);
  $('#argue-modal').addEventListener('click', function(event) { if (event.target === $('#argue-modal')) closeArgue(); });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && !$('#argue-modal').hidden) { closeArgue(); return; }
    if (event.key === 'Escape' && !$('#leave-modal').hidden) $('#leave-modal').hidden = true;
    if (event.key === 'Tab' && state.started && !state.busy && !event.target.classList.contains('il-word-slot')) {
      event.preventDefault(); replayUnit(true);
    }
  });

  window.__MRCAT_INTENSIVE_LISTENING_TEST__ = { escapeHtml: escapeHtml, formatTime: formatTime, unitMode: unitMode };
  initialize();
})(window, document);
