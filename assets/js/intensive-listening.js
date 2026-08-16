(function(window, document) {
  'use strict';

  var params = new URLSearchParams(window.location.search);
  var state = {
    setId: String(params.get('set') || '').trim(),
    assignmentId: String(params.get('assignment') || '').trim(),
    material: null,
    progress: null,
    replayId: '',
    currentIndex: 0,
    started: false,
    playing: false,
    stopAt: 0,
    busy: false,
    localUnits: {},
  };

  function $(selector) { return document.querySelector(selector); }

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>'"]/g, function(character) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
    });
  }

  function safeReturnUrl() {
    var requested = params.get('return');
    if (!requested) return 'dashboard.html';
    try {
      var url = new URL(requested, window.location.href);
      return url.origin === window.location.origin ? url.href : 'dashboard.html';
    } catch (error) {
      return 'dashboard.html';
    }
  }

  function studentIdentity() {
    try {
      var profile = JSON.parse(localStorage.getItem('mrcat_student_profile') || 'null');
      return String(profile && profile.student_id || 'student');
    } catch (error) {
      return 'student';
    }
  }

  function draftKey() {
    return ['mrcat', 'intensive-listening', studentIdentity(), state.setId, state.replayId ? 'temporary' : 'best', 'v1'].join(':');
  }

  function saveDraft() {
    if (!state.material) return;
    var units = {};
    Object.keys(state.localUnits).forEach(function(unitId) {
      var local = state.localUnits[unitId];
      units[unitId] = { entries: local.entries, marks: local.marks, answerVisible: local.answerVisible, answerText: local.answerVisible ? local.answerText : '' };
    });
    try {
      localStorage.setItem(draftKey(), JSON.stringify({
        currentIndex: state.currentIndex,
        contentVersion: state.material.content_version,
        units: units,
        savedAt: new Date().toISOString(),
      }));
    } catch (error) {
      // Server progress remains authoritative when local storage is unavailable.
    }
  }

  function readDraft() {
    try {
      var draft = JSON.parse(localStorage.getItem(draftKey()) || 'null');
      if (!draft || String(draft.contentVersion) !== String(state.material.content_version) || !draft.units) return null;
      return draft;
    } catch (error) {
      return null;
    }
  }

  function clearDraft() {
    try { localStorage.removeItem(draftKey()); } catch (error) { /* no-op */ }
  }

  function emptyLocalUnit(unit, serverUnit) {
    var slotCount = unit.slots.length;
    return {
      entries: Array(slotCount).fill(''),
      marks: Array(slotCount).fill(''),
      answerVisible: false,
      answerText: '',
      replayDelta: 0,
      checks: Number(serverUnit && serverUnit.checks) || 0,
    };
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
        local.answerVisible = saved.answerVisible === true && serverUnit.assisted === true;
        local.answerText = local.answerVisible ? String(saved.answerText || '') : '';
      }
      (serverUnit.correct_positions || []).forEach(function(correct, index) {
        if (correct) local.marks[index] = 'correct';
      });
      local.checks = Number(serverUnit.checks) || 0;
      state.localUnits[unit.unit_id] = local;
    });
    var requestedIndex = Number(draft && draft.currentIndex);
    var firstIncomplete = state.material.units.findIndex(function(unit) {
      return !(state.progress.unit_progress[unit.unit_id] || {}).completed;
    });
    if (Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < state.material.units.length) {
      var requestedUnit = state.material.units[requestedIndex];
      if (!(state.progress.unit_progress[requestedUnit.unit_id] || {}).completed) state.currentIndex = requestedIndex;
      else state.currentIndex = firstIncomplete < 0 ? state.material.units.length - 1 : firstIncomplete;
    } else {
      state.currentIndex = firstIncomplete < 0 ? state.material.units.length - 1 : firstIncomplete;
    }
  }

  function call(action, payload) {
    return window.MrCatCloud.callAuthenticatedFunction('intensiveListening', Object.assign({
      action: action,
      set_id: state.setId,
      assignment_id: state.assignmentId || null,
      replay_id: state.replayId || null,
    }, payload || {})).then(function(result) {
      if (!result || !result.success) {
        var error = new Error(result && result.message || 'Unable to continue this practice.');
        error.code = result && result.code || 'INTENSIVE_LISTENING_ERROR';
        throw error;
      }
      return result;
    });
  }

  function formatTime(value) {
    var seconds = Math.max(0, Number(value) || 0);
    return Math.floor(seconds / 60) + ':' + String(Math.floor(seconds % 60)).padStart(2, '0');
  }

  function currentUnit() { return state.material.units[state.currentIndex]; }
  function currentLocal() { return state.localUnits[currentUnit().unit_id]; }
  function currentServer() { return state.progress.unit_progress[currentUnit().unit_id] || {}; }

  function applyProgress(progress) {
    if (!progress) return;
    state.progress = progress;
    state.material.units.forEach(function(unit) {
      var serverUnit = progress.unit_progress[unit.unit_id] || {};
      var local = state.localUnits[unit.unit_id] || emptyLocalUnit(unit, serverUnit);
      local.checks = Number(serverUnit.checks) || 0;
      (serverUnit.correct_positions || []).forEach(function(correct, index) {
        if (correct) local.marks[index] = 'correct';
      });
      state.localUnits[unit.unit_id] = local;
    });
    renderProgress();
  }

  function renderProgress() {
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
        var index = Number(input.getAttribute('data-slot-index'));
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
          var index = Number(input.getAttribute('data-slot-index'));
          var next = Array.from(document.querySelectorAll('.il-word-slot:not(:disabled)')).find(function(candidate) {
            return Number(candidate.getAttribute('data-slot-index')) > index;
          });
          if (next) next.focus();
        } else if (event.key === 'Tab') {
          event.preventDefault();
          replayUnit(true);
        } else if (event.key === 'Enter') {
          event.preventDefault();
          checkUnit();
        }
      });
    });
  }

  function renderUnit() {
    var unit = currentUnit();
    var local = currentLocal();
    var server = currentServer();
    $('#unit-label').textContent = 'UNIT ' + String(state.currentIndex + 1).padStart(2, '0');
    $('#speaker-label').textContent = unit.speaker || '';
    $('#unit-position').textContent = (state.currentIndex + 1) + ' / ' + state.material.units.length;
    $('#time-range').textContent = formatTime(unit.start_seconds) + ' – ' + formatTime(unit.end_seconds);
    $('#word-slots').innerHTML = unit.slots.map(function(slot, index) {
      var disabled = (server.correct_positions || [])[index] === true || local.answerVisible;
      return '<span class="il-word-token">' +
        '<span class="il-punctuation">' + escapeHtml(slot.prefix || '') + '</span>' +
        '<input class="il-word-slot ' + escapeHtml(local.marks[index] || '') + '" data-slot-index="' + index + '" aria-label="Word ' + (index + 1) + '" autocomplete="off" autocapitalize="off" spellcheck="false" value="' + escapeHtml(local.entries[index]) + '" ' + (disabled ? 'disabled' : '') + '>' +
        '<span class="il-punctuation">' + escapeHtml(slot.suffix || '') + '</span>' +
      '</span>';
    }).join('');
    $('#check-count').textContent = Math.min(Number(server.checks) || 0, 3) + ' / 3 checks';
    $('#answer-panel').hidden = !local.answerVisible;
    $('#answer-text').textContent = local.answerText;
    $('#continue-button').textContent = state.currentIndex === state.material.units.length - 1 ? 'Finish' : 'Continue';
    $('#check-button').disabled = state.busy || server.completed === true;
    $('#answer-button').disabled = state.busy || local.answerVisible;
    bindSlots();
    if (state.started) window.setTimeout(function() {
      var first = $('#word-slots .il-word-slot:not(:disabled)');
      if (first) first.focus();
    }, 0);
    saveDraft();
  }

  function setBusy(busy, message) {
    state.busy = busy;
    $('#check-button').disabled = busy || currentServer().completed === true;
    $('#answer-button').disabled = busy || currentLocal().answerVisible;
    if (message) {
      $('#feedback').className = 'il-feedback';
      $('#feedback').textContent = message;
    }
  }

  function checkUnit() {
    if (state.busy || currentServer().completed) return;
    var unit = currentUnit();
    var local = currentLocal();
    setBusy(true, 'Checking this unit…');
    call('check', {
      unit_id: unit.unit_id,
      entries: local.entries,
      replay_delta: local.replayDelta,
    }).then(function(result) {
      local.replayDelta = 0;
      local.marks = result.marks.map(function(mark) { return mark ? 'correct' : 'incorrect'; });
      applyProgress(result.progress);
      setBusy(false);
      if (result.completed) {
        $('#feedback').className = 'il-feedback success';
        $('#feedback').textContent = 'Perfect. Moving to the next unit…';
        renderUnit();
        window.setTimeout(advanceUnit, 650);
        return;
      }
      renderUnit();
      var firstWrong = result.marks.findIndex(function(mark) { return !mark; });
      $('#feedback').className = 'il-feedback error';
      $('#feedback').textContent = result.effective_check
        ? result.marks.filter(function(mark) { return !mark; }).length + ' word slots need another listen.'
        : 'Change at least one incorrect word before checking again.';
      var firstWrongInput = document.querySelector('[data-slot-index="' + firstWrong + '"]');
      if (firstWrongInput) firstWrongInput.focus();
      saveDraft();
    }).catch(function(error) {
      setBusy(false);
      $('#feedback').className = 'il-feedback error';
      $('#feedback').textContent = error.message + ' Your words are still here.';
    });
  }

  function showAnswer() {
    if (state.busy || currentLocal().answerVisible) return;
    var unit = currentUnit();
    var local = currentLocal();
    setBusy(true, 'Checking whether the answer is available…');
    call('reveal', { unit_id: unit.unit_id, replay_delta: local.replayDelta }).then(function(result) {
      setBusy(false);
      if (!result.answer_available) {
        $('#feedback').className = 'il-feedback';
        $('#feedback').textContent = result.remaining_checks === 1
          ? 'Try harder — one more effective check.'
          : 'Try harder — ' + result.remaining_checks + ' more effective checks.';
        return;
      }
      local.replayDelta = 0;
      local.answerVisible = true;
      local.answerText = result.answer_text;
      applyProgress(result.progress);
      $('#feedback').className = 'il-feedback';
      $('#feedback').textContent = 'Compare every position with the correct answer.';
      renderUnit();
    }).catch(function(error) {
      setBusy(false);
      $('#feedback').className = 'il-feedback error';
      $('#feedback').textContent = error.message;
    });
  }

  function advanceUnit() {
    if (state.currentIndex >= state.material.units.length - 1) {
      finishSession();
      return;
    }
    state.currentIndex += 1;
    $('#feedback').className = 'il-feedback';
    $('#feedback').textContent = 'Listen once, then type one word in each slot.';
    renderUnit();
    replayUnit(false);
  }

  function replayUnit(countReplay) {
    if (!state.material || state.busy) return;
    var audio = $('#audio');
    var unit = currentUnit();
    if (countReplay) {
      currentLocal().replayDelta += 1;
      renderProgress();
      saveDraft();
    }
    audio.pause();
    try { audio.currentTime = Number(unit.start_seconds) || 0; } catch (error) { /* metadata will settle before play */ }
    state.stopAt = Number(unit.end_seconds) || 0;
    audio.play().then(function() {
      state.playing = true;
      $('#replay-button').textContent = 'Ⅱ';
      $('#audio-status').textContent = 'Listening…';
    }).catch(function() {
      state.playing = false;
      $('#replay-button').textContent = '▶';
      $('#audio-status').textContent = 'Press Replay to hear this unit';
    });
  }

  function stopAudio() {
    var audio = $('#audio');
    audio.pause();
    state.playing = false;
    $('#replay-button').textContent = '▶';
    $('#audio-status').textContent = 'Unit finished · type what you heard';
    var first = $('#word-slots .il-word-slot:not(:disabled)');
    if (first) first.focus();
  }

  function startRitual() {
    var button = $('#start-button');
    button.disabled = true;
    button.classList.add('counting');
    var remaining = 3;
    $('#start-button-label').textContent = remaining;
    var timer = window.setInterval(function() {
      remaining -= 1;
      if (remaining > 0) {
        $('#start-button-label').textContent = remaining;
        return;
      }
      window.clearInterval(timer);
      $('#start-button-label').textContent = 'Listen';
      window.setTimeout(function() {
        state.started = true;
        $('#start-screen').hidden = true;
        $('#practice-shell').hidden = false;
        renderUnit();
        replayUnit(false);
      }, 380);
    }, 1000);
  }

  function finishSession() {
    stopAudio();
    var progress = state.progress;
    $('#completion-percent').textContent = (Number(progress.percentage) || 0) + '%';
    $('#completion-summary').textContent = progress.independent_count + ' completed independently · ' + progress.assisted_count + ' completed with answer';
    $('#completion-screen').hidden = false;
    clearDraft();
  }

  function startTemporaryReplay() {
    if (state.busy) return;
    state.busy = true;
    $('#restart-button').disabled = true;
    $('#restart-button').textContent = 'Preparing…';
    call('startReplay').then(function(result) {
      state.replayId = result.replay_id;
      state.progress = result.progress;
      state.currentIndex = 0;
      state.started = false;
      state.busy = false;
      try { localStorage.removeItem(draftKey()); } catch (error) { /* no-op */ }
      hydrateLocalUnits();
      renderProgress();
      $('#completion-screen').hidden = true;
      $('#practice-shell').hidden = true;
      $('#start-screen').hidden = false;
      $('#start-title').textContent = state.material.title;
      $('#start-copy').textContent = 'Temporary practice is ready. Your best record stays at 100%.';
      $('#start-button').disabled = false;
      $('#start-button').classList.remove('counting');
      $('#start-button-label').textContent = 'Start';
      $('#restart-button').disabled = false;
      $('#restart-button').textContent = 'Clear & Start Again';
    }).catch(function(error) {
      state.busy = false;
      $('#restart-button').disabled = false;
      $('#restart-button').textContent = 'Clear & Start Again';
      $('#completion-summary').textContent = error.message;
    });
  }

  function showLoadError(error) {
    $('#start-title').textContent = 'Practice unavailable';
    $('#start-copy').textContent = error.message || 'Unable to load this listening material.';
    $('#start-button').hidden = true;
    $('#start-note').textContent = error.code === 'AUTH_REQUIRED' ? 'Return to the login page and sign in first.' : 'Please return to the Dashboard and try again.';
  }

  function initialize() {
    if (!state.setId) {
      showLoadError(new Error('No listening material was selected.'));
      return;
    }
    call('bootstrap').then(function(result) {
      state.material = result.material;
      state.progress = result.progress;
      $('#material-title').textContent = state.material.title;
      $('#start-title').textContent = state.material.title;
      $('#start-copy').textContent = 'The first unit waits for you. Later units play once when you enter them.';
      $('#audio').src = state.material.audio_src;
      hydrateLocalUnits();
      renderProgress();
      if (Number(state.progress.best_percentage) >= 100 && Number(state.progress.percentage) >= 100) {
        $('#start-screen').hidden = true;
        $('#completion-screen').hidden = false;
        $('#completion-percent').textContent = state.progress.best_percentage + '%';
        $('#completion-summary').textContent = state.progress.independent_count + ' completed independently · ' + state.progress.assisted_count + ' completed with answer';
        return;
      }
      renderUnit();
      $('#start-button').disabled = false;
      $('#start-button-label').textContent = 'Start';
    }).catch(function(error) {
      if (error.code === 'AUTH_REQUIRED' || /Please log in/i.test(error.message || '')) {
        var returnUrl = encodeURIComponent(window.location.href);
        window.location.replace('index.html?return=' + returnUrl);
        return;
      }
      showLoadError(error);
    });
  }

  $('#start-button').addEventListener('click', startRitual);
  $('#replay-button').addEventListener('click', function() { state.playing ? stopAudio() : replayUnit(true); });
  $('#check-button').addEventListener('click', checkUnit);
  $('#answer-button').addEventListener('click', showAnswer);
  $('#continue-button').addEventListener('click', advanceUnit);
  $('#restart-button').addEventListener('click', startTemporaryReplay);
  $('#audio').addEventListener('timeupdate', function() {
    if (state.playing && $('#audio').currentTime >= state.stopAt) stopAudio();
  });
  $('#audio').addEventListener('ended', stopAudio);

  $('#back-button').addEventListener('click', function() {
    stopAudio();
    $('#leave-modal').hidden = false;
    $('#leave-cancel').focus();
  });
  $('#leave-cancel').addEventListener('click', function() { $('#leave-modal').hidden = true; });
  $('#leave-confirm').addEventListener('click', function() { window.location.href = safeReturnUrl(); });
  $('#leave-modal').addEventListener('click', function(event) { if (event.target === $('#leave-modal')) $('#leave-modal').hidden = true; });
  document.addEventListener('keydown', function(event) {
    if (event.key === 'Escape' && !$('#leave-modal').hidden) $('#leave-modal').hidden = true;
  });

  window.__MRCAT_INTENSIVE_LISTENING_TEST__ = {
    escapeHtml: escapeHtml,
    formatTime: formatTime,
  };

  initialize();
})(window, document);
