(function(window, document) {
  'use strict';

  // Generic, transcript-free effective-learning-time tracker. The tracker only
  // knows about activity metadata and emits bounded monotonic spans; the
  // server remains responsible for authentication, leases, midnight splits,
  // and accepted totals.
  var IDLE_AFTER_MS = 20000;
  var SESSION_CLOSE_AFTER_MS = 180000;
  var MAX_SPANS_PER_FLUSH = 30;
  var MAX_SPAN_SECONDS = 60;
  var MAX_PENDING_SPANS = 120;
  var AUTO_FLUSH_SECONDS = 60;
  var state = {
    configured: false, config: {}, sessionId: '', sequence: 0,
    lastTick: null, lastInteraction: 0, continuous: {}, blocked: false, blockedReason: '',
    visible: document.visibilityState !== 'hidden', focused: true,
    pending: [], localSeconds: 0, sessionLastActive: 0, closed: false,
    timer: null, flushing: null, starting: null, remoteStarted: false,
    superseded: false, inFlushTick: false, closing: false, serverSeconds: 0
  };

  function now() {
    if (window.performance && typeof window.performance.now === 'function') return window.performance.now();
    return Date.now();
  }
  function id() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return 'activity-' + window.crypto.randomUUID();
    return 'activity-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  function validReason(reason) {
    return String(reason || '').trim().slice(0, 40) || 'interaction';
  }
  function eligible(at) {
    if (!state.configured || state.closed || state.superseded || state.blocked || !state.visible || !state.focused) return false;
    var hasContinuous = Object.keys(state.continuous).some(function(key) { return state.continuous[key] && key !== 'thinking' && key !== 'network' && key !== 'permission' && key !== 'modal' && key !== 'auto-advance'; });
    return hasContinuous || at - state.lastInteraction <= IDLE_AFTER_MS;
  }
  function currentUnit() { return state.config.currentUnitId || null; }
  function storageKey() {
    if (!state.configured) return '';
    return ['mrcat', 'learning-activity', state.config.accountKey, state.config.activityType, state.config.materialId, state.config.mode, state.config.contentRevision].join(':');
  }
  function persist() {
    var key = storageKey();
    if (!key || !window.localStorage) return;
    try {
      if (!state.pending.length) { window.localStorage.removeItem(key); return; }
      window.localStorage.setItem(key, JSON.stringify({
        session_id: state.sessionId, sequence: state.sequence,
        pending: state.pending.slice(0, 120), local_seconds: state.localSeconds,
        saved_at: Date.now()
      }));
    } catch (error) { /* The live in-memory queue still works. */ }
  }
  function restore() {
    var key = storageKey();
    if (!key || !window.localStorage) return;
    try {
      var saved = JSON.parse(window.localStorage.getItem(key) || 'null');
      if (!saved || Date.now() - Number(saved.saved_at || 0) > 7 * 86400000 || !Array.isArray(saved.pending)) {
        window.localStorage.removeItem(key); return;
      }
      state.sessionId = String(saved.session_id || '');
      state.sequence = Math.max(0, Math.floor(Number(saved.sequence) || 0));
      state.pending = saved.pending.slice(0, 120);
      state.localSeconds = Math.max(0, Math.floor(Number(saved.local_seconds) || 0));
    } catch (error) { window.localStorage.removeItem(key); }
  }
  function purgeOtherAccounts() {
    if (!window.localStorage || !state.config.accountKey) return;
    var ownPrefix = 'mrcat:learning-activity:' + state.config.accountKey + ':';
    try {
      for (var index = window.localStorage.length - 1; index >= 0; index--) {
        var key = window.localStorage.key(index);
        if (key && key.indexOf('mrcat:learning-activity:') === 0 && key.indexOf(ownPrefix) !== 0) window.localStorage.removeItem(key);
      }
    } catch (error) { /* Storage privacy cleanup retries on the next configure. */ }
  }
  function appendSpan(start, end, reason, unitId) {
    var seconds = Math.max(0, Math.min(MAX_SPAN_SECONDS, Math.floor((end - start) / 1000)));
    if (!seconds) return;
    var span = {
      client_start_ms: Math.round(start),
      client_end_ms: Math.round(start + seconds * 1000),
      effective_seconds: seconds,
      reason: validReason(reason),
      unit_id: unitId || currentUnit()
    };
    var previous = state.pending[state.pending.length - 1];
    if (previous && previous.reason === span.reason && previous.unit_id === span.unit_id
        && previous.client_end_ms === span.client_start_ms
        && previous.effective_seconds + span.effective_seconds <= MAX_SPAN_SECONDS) {
      previous.client_end_ms = span.client_end_ms;
      previous.effective_seconds += span.effective_seconds;
    } else {
      // Do not create an unbounded offline claim. Once the durable queue is
      // full, accrual resumes only after a successful flush frees capacity.
      if (state.pending.length >= MAX_PENDING_SPANS) return;
      state.pending.push(span);
    }
    state.localSeconds += seconds;
    persist();
  }
  function tick() {
    if (!state.configured) return;
    var at = now();
    if (state.lastTick == null) { state.lastTick = at; return; }
    if (eligible(at)) {
      appendSpan(state.lastTick, at, Object.keys(state.continuous).find(function(key) { return state.continuous[key]; }) || 'interaction', currentUnit());
      state.sessionLastActive = at;
    }
    state.lastTick = at;
    var pendingSeconds = state.pending.reduce(function(sum, span) { return sum + (Number(span.effective_seconds) || 0); }, 0);
    if ((pendingSeconds >= AUTO_FLUSH_SECONDS || state.pending.length >= MAX_SPANS_PER_FLUSH) && !state.flushing && !state.inFlushTick) flush('flush').catch(function() {});
    if (!eligible(at) && state.sessionId && state.sessionLastActive && at - state.sessionLastActive >= SESSION_CLOSE_AFTER_MS && !state.closed && !state.closing) close('idle').catch(function() {});
  }
  function ensureSession() {
    if (!state.sessionId || state.closed) {
      state.sessionId = id();
      state.sequence = 0;
      state.closed = false;
      state.remoteStarted = false;
      state.sessionLastActive = now();
    }
    return state.sessionId;
  }
  function startServerSession() {
    if (!state.configured || !state.config.send || state.superseded) return Promise.resolve({ success: true, superseded: state.superseded });
    if (!state.sessionId) ensureSession();
    if (state.remoteStarted) return Promise.resolve({ success: true });
    if (state.starting) return state.starting;
    var request = {
      action: 'startLearningActivity', session_id: state.sessionId, sequence: state.sequence,
      activity_type: state.config.activityType, material_id: state.config.materialId,
      set_id: state.config.materialId, mode: state.config.mode,
      content_revision: state.config.contentRevision, reason: 'interaction'
    };
    state.starting = Promise.resolve().then(function() { return state.config.send(request); }).then(function(result) {
      if (result && result.superseded) {
        state.superseded = true;
        state.pending = [];
        persist();
        return result;
      }
      state.remoteStarted = true;
      return result || { success: true };
    }).finally(function() { state.starting = null; });
    return state.starting;
  }
  function configure(options) {
    options = options || {};
    stop();
    state.configured = Boolean(options.activityType && options.materialId && options.mode);
    state.config = {
      activityType: String(options.activityType || '').trim(),
      materialId: String(options.materialId || '').trim(),
      mode: String(options.mode || '').trim(),
      contentRevision: String(options.contentRevision || '').trim(),
      currentUnitId: options.unitId || null,
      accountKey: String(options.accountKey || 'default'),
      send: typeof options.send === 'function' ? options.send : null
    };
    state.sessionId = '';
    state.sequence = 0;
    state.lastTick = now();
    state.lastInteraction = 0;
    state.continuous = {};
    state.blocked = false;
    state.blockedReason = '';
    state.visible = document.visibilityState !== 'hidden';
    state.focused = document.hasFocus ? document.hasFocus() : true;
    state.pending = [];
    state.localSeconds = 0;
    state.serverSeconds = 0;
    state.closed = false;
    state.closing = false;
    state.starting = null;
    state.remoteStarted = false;
    state.superseded = false;
    purgeOtherAccounts();
    restore();
    if (state.configured) state.timer = window.setInterval(tick, 1000);
    return api;
  }
  function markInteraction(reason, unitId) {
    if (!state.configured || state.superseded || state.blocked || !state.visible || !state.focused) return api;
    state.config.currentUnitId = unitId || state.config.currentUnitId || null;
    state.lastInteraction = now();
    state.sessionLastActive = state.lastInteraction;
    ensureSession();
    startServerSession().catch(function() { /* The first bounded flush retries the handshake. */ });
    return api;
  }
  function setContinuous(reason, active, unitId) {
    if (!state.configured) return api;
    state.config.currentUnitId = unitId || state.config.currentUnitId || null;
    state.continuous[validReason(reason)] = Boolean(active);
    if (active) markInteraction(reason, unitId);
    else tick();
    return api;
  }
  function pause(reason) {
    tick();
    state.continuous = {};
    state.lastInteraction = 0;
    state.blocked = true;
    state.blockedReason = validReason(reason || 'pause');
    return flush(reason || 'pause').then(function() { return sendControl('pauseLearningActivity', reason || 'pause'); });
  }
  function resume(reason, unitId) {
    if (state.closed) {
      state.sessionId = '';
      state.sequence = 0;
      state.remoteStarted = false;
    }
    state.blocked = false;
    state.blockedReason = '';
    state.closed = false;
    state.lastTick = now();
    return markInteraction(reason || 'resume', unitId);
  }
  function flush(reason) {
    state.inFlushTick = true;
    tick();
    state.inFlushTick = false;
    if (!state.configured || state.superseded || !state.pending.length || !state.config.send) return Promise.resolve({ accepted_seconds: 0, local_seconds: state.localSeconds, superseded: state.superseded });
    if (!state.remoteStarted) return startServerSession().then(function(result) {
      return result && result.superseded ? result : flush(reason);
    });
    if (state.flushing) return state.flushing.then(function() { return flush(reason); });
    var spans = state.pending.slice(0, MAX_SPANS_PER_FLUSH);
    var nextSequence = state.sequence + 1;
    var request = {
      action: 'recordLearningActivity', session_id: ensureSession(), sequence: nextSequence,
      activity_type: state.config.activityType, material_id: state.config.materialId,
      set_id: state.config.materialId, mode: state.config.mode,
      content_revision: state.config.contentRevision, reason: validReason(reason || 'flush'), spans: spans
    };
    var send = Promise.resolve().then(function() { return state.config.send(request); }).then(function(result) {
      state.pending.splice(0, spans.length);
      state.sequence = nextSequence;
      if (result && Number.isFinite(Number(result.accepted_seconds))) state.serverSeconds = Math.max(state.serverSeconds, Number(result.accepted_seconds));
      if (result && result.superseded) {
        state.closed = true;
        state.pending = [];
      }
      persist();
      return result || { accepted_seconds: 0 };
    }).catch(function(error) { persist(); throw error; });
    state.flushing = send.finally(function() { state.flushing = null; });
    return state.flushing;
  }
  function sendControl(action, reason) {
    if (!state.configured || !state.sessionId || !state.config.send) return Promise.resolve({ success: true });
    return startServerSession().then(function(result) {
      if (result && result.superseded) return result;
      return state.config.send({
        action: action, session_id: state.sessionId, sequence: state.sequence,
        activity_type: state.config.activityType, material_id: state.config.materialId,
        set_id: state.config.materialId, mode: state.config.mode,
        content_revision: state.config.contentRevision, reason: validReason(reason)
      });
    }).catch(function() { /* The bounded pending queue is still durable. */ });
  }
  function close(reason) {
    if (state.closing) return state.flushing || Promise.resolve({ success: true });
    state.closing = true;
    tick();
    var result = flush(reason || 'close').then(function() { return sendControl('closeLearningActivity', reason || 'close'); });
    state.closed = true;
    state.continuous = {};
    state.lastInteraction = 0;
    return result.finally(function() { state.closing = false; });
  }
  function summary() {
    return {
      session_id: state.sessionId || null,
      local_seconds: Math.max(0, Math.floor(state.localSeconds)),
      server_seconds: Math.max(0, Math.floor(state.serverSeconds)),
      unsynced_seconds: Math.max(0, Math.floor(state.localSeconds - state.serverSeconds)),
      pending_span_count: state.pending.length,
      active: eligible(now())
    };
  }
  function stop() {
    if (state.timer) window.clearInterval(state.timer);
    state.timer = null;
  }
  function onVisibility() {
    state.visible = document.visibilityState !== 'hidden';
    if (!state.visible) pause('hidden');
    else {
      state.lastTick = now();
      if (state.blockedReason === 'hidden') { state.blocked = false; state.blockedReason = ''; }
    }
  }
  function onFocus() {
    state.focused = true;
    state.lastTick = now();
    if (state.blockedReason === 'blur') { state.blocked = false; state.blockedReason = ''; }
  }
  function onBlur() { state.focused = false; pause('blur'); }
  function onPageHide() { close('pagehide'); }
  function onOnline() { if (state.configured) flush('interaction').catch(function() {}); }
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('focus', onFocus);
  window.addEventListener('blur', onBlur);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('online', onOnline);
  var api = {
    configure: configure, markInteraction: markInteraction, setContinuous: setContinuous,
    flush: flush, pause: pause, close: close, summary: summary, resume: resume,
    constants: { IDLE_AFTER_MS: IDLE_AFTER_MS, SESSION_CLOSE_AFTER_MS: SESSION_CLOSE_AFTER_MS }
  };
  window.MrCatLearningActivity = api;
  window.__MRCAT_LEARNING_ACTIVITY_TEST__ = { eligible: eligible, appendSpan: appendSpan, tick: tick, state: state };
})(window, document);
