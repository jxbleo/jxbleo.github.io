'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
async function run() {
  for (const teacher of [false, true]) {
    for (const outcome of ['pending', 'failure', 'success', 'refresh-failure']) {
      let resolve, reject, shown = 0;
      const request = new Promise((yes, no) => { resolve = yes; reject = no; });
      const nodes = new Map();
      const node = (id) => { if (!nodes.has(id)) nodes.set(id, { disabled: false, hidden: false, textContent: '', classList: { add() {}, remove() {} } }); return nodes.get(id); };
      const context = {
        document: { getElementById: node }, window: { MrCatVoiceprintSuccess: { show: () => shown++ } },
        voiceprintSaving: false, voiceprintController: {}, voiceprintPendingResult: {}, voiceprintLocator: {},
        voiceprintProviderConfigured: true, voiceprintRegistrationAvailable: true, selected: null,
        renderMyVoiceprint() {}, voiceprintTime: () => '00:00', friendlyError: (e) => e.message,
        call: () => request, setMessage: (s) => node('message').textContent = s,
        reloadVoiceprintTarget: async () => { if (outcome === 'refresh-failure') throw Error('Refresh failed'); node('teacher-voiceprint-record').disabled = false; },
      };
      const file = teacher ? 'assets/js/teacher-speaking.js' : 'assets/js/speaking-lab.js';
      const name = teacher ? 'saveTeacherVoiceprintRecording' : 'saveVoiceprintRecording';
      const next = teacher ? 'startTeacherVoiceprintRecording' : 'voiceprintRecordingReady';
      const source = read(file);
      vm.createContext(context);
      vm.runInContext(source.slice(source.indexOf('    function ' + name + '('), source.indexOf('    function ' + next + '(')), context);
      const saved = context[name]({ base64: 'test-only' });
      assert.equal(shown, 0, 'pending saves must not report success');
      context[name]({ base64: 'duplicate' });
      assert.equal(shown, 0);
      if (outcome === 'failure') reject(Error('Capacity reached'));
      else resolve({ target: { voiceprint: { status: 'active' } } });
      await saved;
      assert.equal(shown, outcome === 'failure' ? 0 : 1);
      assert.equal(context.voiceprintSaving, false);
      assert.equal(node(teacher ? 'teacher-voiceprint-record' : 'voiceprint-record').disabled, teacher && outcome === 'refresh-failure');
      if (outcome === 'failure') assert.match(node(teacher ? 'teacher-voiceprint-status' : 'voiceprint-message').textContent, /Capacity reached/);
      if (teacher && outcome === 'refresh-failure') assert.match(node('message').textContent, /Voiceprint saved.*refresh/);
    }
  }
  // Actual shared dialog lifecycle: singleton, styles/scroll/focus restoration,
  // and no competing body lock on Teacher's existing modal stack.
  for (const teacher of [false, true]) {
    let dialogs = [], focused = false, restored;
    const style = { position: teacher ? 'fixed' : 'relative', top: '-25px', left: '2px', width: '99%', overflow: 'clip' };
    const original = { ...style };
    const body = { style, classList: { contains: () => teacher }, appendChild: (d) => dialogs.push(d) };
    const document = { body, documentElement: { style: { overflow: 'auto' } }, activeElement: { isConnected: true, focus: () => focused = true }, createElement: () => {
      const listeners = {};
      return { setAttribute() {}, addEventListener: (event, f) => listeners[event] = f, showModal() {}, remove() { dialogs = dialogs.filter(d => d !== this); }, close() { listeners.close(); } };
    } };
    const window = { scrollX: 2, scrollY: 25, scrollTo: (x, y) => restored = [x, y], requestAnimationFrame: (f) => f() };
    vm.runInNewContext(read('assets/js/voiceprint-success.js'), { window, document });
    window.MrCatVoiceprintSuccess.show(); window.MrCatVoiceprintSuccess.show();
    assert.equal(dialogs.length, 1);
    if (teacher) assert.deepEqual(style, original);
    else assert.equal(style.position, 'fixed');
    dialogs[0].close();
    assert.equal(dialogs.length, 0); assert.equal(focused, true); assert.deepEqual(style, original);
    assert.deepEqual(restored, teacher ? undefined : [2, 25]);
    window.MrCatVoiceprintSuccess.show(); assert.equal(dialogs.length, 1); dialogs[0].close();
  }
  for (const page of ['speaking-lab.html', 'teacher.html']) {
    const html = read(page);
    assert.match(html, /voiceprint-success\.css\?v=20260912-1/);
    assert.match(html, /voiceprint-success\.js\?v=20260912-1/);
    assert.ok(html.indexOf('voiceprint-success.js') < html.indexOf(page === 'teacher.html' ? 'assets/js/teacher-speaking.js' : 'assets/js/speaking-lab.js'));
  }
  console.log('Voiceprint success: server confirmation, errors, refresh failures, singleton, scroll and focus passed.');
}
module.exports = run;
if (require.main === module) run().catch(e => { console.error(e); process.exitCode = 1; });
