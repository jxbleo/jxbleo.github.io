(function (window) {
    'use strict';

    var panel = document.getElementById('view-speaking');
    if (!panel || !window.MrCatCloud || !window.MrCatAuth) return;
    var list = document.getElementById('teacher-speaking-list');
    var detail = document.getElementById('teacher-speaking-detail');
    var message = document.getElementById('teacher-speaking-message');
    var voiceprintTargetPanel = document.getElementById('teacher-voiceprint-target');
    var selected = '';
    var voiceprintTarget = null;
    var voiceprintLocator = null;
    var voiceprintController = null;
    var voiceprintSaving = false;
    var speakingSetsPanel = document.getElementById('teacher-speaking-sets');
    var speakingSetList = document.getElementById('teacher-speaking-set-list');
    var speakingSetEditor = document.getElementById('teacher-speaking-set-editor');
    var speakingSets = [];
    var speakingSetDetails = {};
    var speakingSetRenderLimit = 50;

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
        });
    }
    function call(action, data) {
        return window.MrCatCloud.callAuthenticatedFunction('speakingLab', Object.assign({ action: action }, data || {})).then(function (result) {
            if (!result || result.success === false) {
                var error = new Error(result && result.message || 'Speaking request failed.');
                error.code = result && result.code;
                throw error;
            }
            return result;
        });
    }
    function setMessage(value, error) {
        message.textContent = value || '';
        message.classList.toggle('is-error', Boolean(error));
    }
    function voiceprintTime(seconds) {
        var value = Math.max(0, Math.min(20, Math.floor(Number(seconds || 0))));
        return '00:' + String(value).padStart(2, '0') + ' / 00:20';
    }
    function voiceprintUpdatedAt(value) {
        if (!value) return '';
        var date = new Date(value);
        if (Number.isNaN(date.getTime())) return '';
        try {
            return new Intl.DateTimeFormat('en-GB', {
                timeZone: 'Asia/Shanghai',
                day: '2-digit',
                month: 'short',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            }).format(date);
        } catch (_error) {
            return date.toLocaleString();
        }
    }
    function cancelVoiceprintRecorder() {
        if (voiceprintController) voiceprintController.cancel();
        voiceprintController = null;
    }
    function renderVoiceprintTarget(result, locator) {
        cancelVoiceprintRecorder();
        voiceprintTarget = result && result.target || null;
        voiceprintLocator = locator || null;
        if (!voiceprintTarget) { voiceprintTargetPanel.hidden = true; return; }
        var active = voiceprintTarget.voiceprint && voiceprintTarget.voiceprint.status === 'active';
        var revision = Math.max(0, Number(voiceprintTarget.voiceprint && voiceprintTarget.voiceprint.enrollment_revision || 0));
        var updatedAt = voiceprintUpdatedAt(voiceprintTarget.voiceprint && voiceprintTarget.voiceprint.updated_at);
        var voiceprintState = active ? 'Active · Revision ' + revision + (updatedAt ? ' · Updated ' + updatedAt : '') : 'Not set up';
        var unavailable = result.provider_configured === false;
        var label = voiceprintTarget.display_name + (voiceprintTarget.name_not_verified ? ' · Non-VIP · Name not verified' : ' · VIP');
        voiceprintTargetPanel.hidden = false;
        voiceprintTargetPanel.innerHTML = '<p class="eyebrow accent">VOICEPRINT TARGET</p><h3>' + esc(label) + '</h3><p><strong>' + esc(voiceprintState) + '</strong></p><p>' + (active ? 'Reusable voiceprint ready. A new recording will replace it.' : 'No reusable voiceprint has been registered.') + '</p><blockquote>' + esc(voiceprintTarget.passage || '') + '</blockquote><label class="speaking-consent"><input type="checkbox" id="teacher-voiceprint-consent"> I confirm that this person is present and agrees to register or replace this reusable voiceprint.</label><div class="speaking-recording-time" id="teacher-voiceprint-time">00:00 / 00:20</div><p class="speaking-quality-warning" id="teacher-voiceprint-status">' + (unavailable ? 'Tencent voiceprint registration is not configured yet.' : 'Record in a quiet place and ask the person to read the full passage.') + '</p><div class="speaking-detail-actions"><button class="primary-button" id="teacher-voiceprint-record" type="button"' + (unavailable ? ' disabled' : '') + '>' + (active ? 'Record replacement' : 'Start recording') + '</button><button class="outline-button" id="teacher-voiceprint-stop" type="button" disabled>Finish recording</button>' + (active ? '<button class="danger-button" id="teacher-voiceprint-remove" type="button">Remove voiceprint</button>' : '') + '<button class="outline-button" id="teacher-voiceprint-close" type="button">Close</button></div>';
        document.getElementById('teacher-voiceprint-record').addEventListener('click', startTeacherVoiceprintRecording);
        document.getElementById('teacher-voiceprint-stop').addEventListener('click', stopTeacherVoiceprintRecording);
        document.getElementById('teacher-voiceprint-close').addEventListener('click', function () { if (voiceprintSaving) { document.getElementById('teacher-voiceprint-status').textContent = 'Wait until Tencent finishes saving this voiceprint.'; return; } cancelVoiceprintRecorder(); voiceprintTargetPanel.hidden = true; });
        var remove = document.getElementById('teacher-voiceprint-remove');
        if (remove) remove.addEventListener('click', deleteTeacherVoiceprint);
        voiceprintTargetPanel.scrollIntoView({ behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'nearest' });
    }
    function reloadVoiceprintTarget() {
        return call('teacherGetVoiceprintTarget', voiceprintLocator).then(function (result) { renderVoiceprintTarget(result, voiceprintLocator); return result; });
    }
    function saveTeacherVoiceprintRecording(result) {
        if (!result || !result.base64 || voiceprintSaving) return;
        voiceprintSaving = true;
        document.getElementById('teacher-voiceprint-record').disabled = true;
        document.getElementById('teacher-voiceprint-stop').disabled = true;
        var remove = document.getElementById('teacher-voiceprint-remove'); if (remove) remove.disabled = true;
        document.getElementById('teacher-voiceprint-status').textContent = 'Saving the reusable voiceprint with Tencent…';
        call('teacherSaveVoiceprint', Object.assign({}, voiceprintLocator, {
            operation_id: 'teacher-voiceprint-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
            consent_confirmed: true,
            audio_base64: result.base64
        })).then(function () {
            setMessage('Reusable voiceprint saved.');
            return reloadVoiceprintTarget();
        }).then(function () { if (selected) return open(selected); }).catch(function (error) {
            document.getElementById('teacher-voiceprint-status').textContent = error.message || 'Could not save this voiceprint.';
            document.getElementById('teacher-voiceprint-record').disabled = false;
            var remove = document.getElementById('teacher-voiceprint-remove'); if (remove) remove.disabled = false;
        }).finally(function () { voiceprintSaving = false; voiceprintController = null; });
    }
    function startTeacherVoiceprintRecording() {
        if (voiceprintController || voiceprintSaving) return;
        if (!document.getElementById('teacher-voiceprint-consent').checked) {
            document.getElementById('teacher-voiceprint-status').textContent = 'Confirm the person’s consent before recording.';
            return;
        }
        var record = document.getElementById('teacher-voiceprint-record');
        var stop = document.getElementById('teacher-voiceprint-stop');
        record.disabled = true;
        var remove = document.getElementById('teacher-voiceprint-remove'); if (remove) remove.disabled = true;
        document.getElementById('teacher-voiceprint-status').textContent = 'Recording… ask the person to read the full passage naturally.';
        window.MrCatVoiceprintRecorder.start({
            maxSeconds: 20,
            onProgress: function (seconds) { document.getElementById('teacher-voiceprint-time').textContent = voiceprintTime(seconds); stop.disabled = seconds < 8; },
            onReady: saveTeacherVoiceprintRecording,
            onError: function (error) { voiceprintController = null; record.disabled = false; stop.disabled = true; if (remove) remove.disabled = false; document.getElementById('teacher-voiceprint-status').textContent = error.message || 'Recording failed.'; }
        }).then(function (controller) { voiceprintController = controller; }).catch(function () {
            record.disabled = false;
            if (remove) remove.disabled = false;
            document.getElementById('teacher-voiceprint-status').textContent = 'Microphone access was denied or this browser cannot create a voiceprint recording.';
        });
    }
    function stopTeacherVoiceprintRecording() {
        if (!voiceprintController || voiceprintController.elapsedSeconds() < 8) return;
        var current = voiceprintController;
        document.getElementById('teacher-voiceprint-stop').disabled = true;
        current.stop().then(saveTeacherVoiceprintRecording).catch(function (error) {
            document.getElementById('teacher-voiceprint-status').textContent = error.message || 'Recording failed.';
            document.getElementById('teacher-voiceprint-record').disabled = false;
            var remove = document.getElementById('teacher-voiceprint-remove'); if (remove) remove.disabled = false;
        });
    }
    function deleteTeacherVoiceprint() {
        if (voiceprintSaving || voiceprintController) return;
        if (!window.confirm('Remove this reusable voiceprint from Tencent?')) return;
        var button = document.getElementById('teacher-voiceprint-remove');
        button.disabled = true;
        call('teacherDeleteVoiceprint', Object.assign({}, voiceprintLocator, { operation_id: 'teacher-voiceprint-delete-' + Date.now().toString(36) })).then(function () {
            setMessage('Reusable voiceprint removed.');
            return reloadVoiceprintTarget();
        }).then(function () { if (selected) return open(selected); }).catch(function (error) {
            setMessage(error.message || 'Could not remove this voiceprint.', true);
            button.disabled = false;
        });
    }
    function loadDiscussionPages(offset, collected) {
        return call('listDiscussions', { page_size: 50, offset: offset || 0 }).then(function (result) {
            var rows = collected.concat(result.discussions || []);
            return result.next_offset != null ? loadDiscussionPages(result.next_offset, rows) : rows;
        });
    }
    function speakingSetLabel(set) { return set.display_label || [String(set.exam_year || '') + ' ' + String(set.source_kind || 'mock').toUpperCase(), set.paper_version ? 'Set ' + set.paper_version : '', set.title || 'Speaking Set'].filter(Boolean).join(' · '); }
    function speakingSetMetaLabel(set) { return [String(set.exam_year || '') + ' ' + String(set.source_kind || 'mock').toUpperCase(), set.paper_version ? 'Set ' + set.paper_version : ''].filter(Boolean).join(' · '); }
    function renderTeacherSetResults() {
        var query = String(document.getElementById('teacher-speaking-set-search').value || '').trim().toLowerCase();
        var year = document.getElementById('teacher-speaking-set-year').value;
        var source = document.getElementById('teacher-speaking-set-source').value;
        var visibility = document.getElementById('teacher-speaking-set-visibility').value;
        var filtered = speakingSets.filter(function (set) {
            var haystack = [set.exam_year, set.paper_version, set.title, set.display_label].join(' ').toLowerCase();
            var shown = set.visible_to_students !== false;
            return (!query || haystack.indexOf(query) !== -1) && (!year || String(set.exam_year) === year) && (!source || set.source_kind === source) && (!visibility || (visibility === 'shown' ? shown : !shown));
        });
        var visible = filtered.slice(0, speakingSetRenderLimit);
        speakingSetList.innerHTML = visible.map(function (set) {
            return '<article class="teacher-speaking-set-row"><div><small>' + esc(speakingSetMetaLabel(set)) + '</small><h3>' + esc(set.title) + '</h3><small>Revision ' + esc(set.content_revision || 1) + ' · ' + (set.visible_to_students ? 'Shown to students' : 'Hidden from students') + '</small></div><button class="outline-button" type="button" data-speaking-set-edit="' + esc(set.set_id) + '">Edit</button><button class="outline-button" type="button" data-speaking-set-preview="' + esc(set.set_id) + '">Preview</button><button class="danger-button" type="button" data-speaking-set-delete="' + esc(set.set_id) + '">Delete</button></article>';
        }).join('') || '<div class="speaking-detail-card">No Speaking Sets match these filters.</div>';
        speakingSetList.querySelectorAll('[data-speaking-set-edit]').forEach(function (button) { button.addEventListener('click', function () { openSpeakingSetEditor(button.getAttribute('data-speaking-set-edit')); }); });
        speakingSetList.querySelectorAll('[data-speaking-set-preview]').forEach(function (button) { button.addEventListener('click', function () { openSpeakingSetEditor(button.getAttribute('data-speaking-set-preview'), true); }); });
        speakingSetList.querySelectorAll('[data-speaking-set-delete]').forEach(function (button) { button.addEventListener('click', function () { if (!window.confirm('Delete this Set? Historical Sessions prevent deletion.')) return; button.disabled = true; call('teacherDeleteSpeakingSet', { set_id: button.getAttribute('data-speaking-set-delete') }).then(loadSets).catch(function (error) { setMessage(error.message || 'This Set could not be deleted.', true); button.disabled = false; }); }); });
        var more = document.getElementById('teacher-speaking-set-more');
        more.hidden = visible.length >= filtered.length;
        more.textContent = 'Show more · ' + String(filtered.length - visible.length) + ' remaining';
    }
    function renderTeacherSetList(rows) {
        speakingSets = Array.isArray(rows) ? rows : [];
        speakingSetRenderLimit = 50;
        var yearInput = document.getElementById('teacher-speaking-set-year');
        var selectedYear = yearInput.value;
        var years = Array.from(new Set(speakingSets.map(function (set) { return String(set.exam_year || ''); }).filter(Boolean))).sort(function (a, b) { return Number(b) - Number(a); });
        yearInput.innerHTML = '<option value="">All years</option>' + years.map(function (value) { return '<option value="' + esc(value) + '">' + esc(value) + '</option>'; }).join('');
        if (years.indexOf(selectedYear) !== -1) yearInput.value = selectedYear;
        renderTeacherSetResults();
    }
    function editorRowMarkup(kind, row, index) {
        var isPoint = kind === 'point';
        var id = row[isPoint ? 'point_id' : 'question_id'];
        return '<div class="teacher-speaking-set-editor-row" data-editor-row="' + esc(kind) + '" data-' + (isPoint ? 'point' : 'question') + '-id="' + esc(id) + '"><input value="' + esc(id) + '" aria-label="Stable ' + esc(kind) + ' ID" readonly><textarea data-editor-text aria-label="' + esc(kind) + ' text">' + esc(row.text || '') + '</textarea><span class="teacher-speaking-editor-row-actions"><button type="button" class="outline-button" data-row-up="' + esc(kind) + '"' + (index === 0 ? ' disabled' : '') + '>↑</button><button type="button" class="outline-button" data-row-down="' + esc(kind) + '">↓</button><button type="button" class="outline-button" data-row-remove="' + esc(kind) + '">Remove</button></span></div>';
    }
    function editorMarkup(set, preview) {
        var context = set && set.context || { source_line: '', title: '', body: [''] };
        var partA = set && set.part_a || { instruction: 'You may want to talk about:', discussion_points: [] };
        var partB = set && set.part_b || { instruction: 'The examiner will ask you one or more questions based on Part A. You will have up to 1 minute to respond.', questions: [] };
        return '<div class="teacher-speaking-set-editor-grid"><label>Set ID<input id="teacher-set-id" value="' + esc(set && set.set_id || '') + '" required' + (set ? ' readonly' : '') + '></label><label>Source kind<select id="teacher-set-source"><option value="mock"' + (!set || set.source_kind === 'mock' ? ' selected' : '') + '>MOCK</option><option value="pp"' + (set && set.source_kind === 'pp' ? ' selected' : '') + '>PP</option></select></label><label>Exam year<input id="teacher-set-year" type="number" min="2000" max="2100" value="' + esc(set && set.exam_year || '') + '" required></label><label>Paper version<input id="teacher-set-version" placeholder="e.g. 1.1" value="' + esc(set && set.paper_version || '') + '"></label><label>Title<input id="teacher-set-title" maxlength="160" value="' + esc(set && set.title || '') + '" required></label><label>Source note<textarea id="teacher-set-source-note">' + esc(set && set.source_note || '') + '</textarea></label></div><h3>Context</h3><label>Source line<input id="teacher-set-source-line" value="' + esc(context.source_line || '') + '"></label><label>Context title<input id="teacher-set-context-title" value="' + esc(context.title || '') + '" required></label><div class="teacher-speaking-set-editor-list" id="teacher-set-context-body">' + (context.body || ['']).map(function (paragraph) { return '<label>Paragraph<textarea data-context-paragraph>' + esc(paragraph) + '</textarea></label>'; }).join('') + '</div><div class="teacher-speaking-set-editor-actions"><button type="button" class="outline-button" id="teacher-set-add-paragraph">Add paragraph</button></div><h3>Part A · Group Discussion</h3><label>Task<textarea id="teacher-set-part-a-task" maxlength="1600">' + esc(partA.task || '') + '</textarea></label><label>Instruction<input id="teacher-set-part-a-instruction" value="' + esc(partA.instruction || '') + '"></label><div class="teacher-speaking-set-editor-list" id="teacher-set-points">' + (partA.discussion_points || []).map(function (row, index) { return editorRowMarkup('point', row, index); }).join('') + '</div><div class="teacher-speaking-set-editor-actions"><button type="button" class="outline-button" id="teacher-set-add-point">Add discussion point</button></div><h3>Part B · Individual Response</h3><label>Instruction<input id="teacher-set-part-b-instruction" value="' + esc(partB.instruction || '') + '"></label><div class="teacher-speaking-set-editor-list" id="teacher-set-questions">' + (partB.questions || []).map(function (row, index) { return editorRowMarkup('question', row, index); }).join('') + '</div><div class="teacher-speaking-set-editor-actions"><button type="button" class="outline-button" id="teacher-set-add-question">Add question</button></div><label><input type="checkbox" id="teacher-set-visible"' + (!set || set.visible_to_students !== false ? ' checked' : '') + '> Show to students</label><div class="teacher-speaking-set-editor-actions"><button type="button" class="outline-button" id="teacher-set-editor-close">Close</button>' + (preview ? '' : '<button type="button" class="primary-button" id="teacher-set-editor-save">Save Set</button>') + '</div>';
    }
    function bindEditor(set, preview) {
        var nextPointSequence = Math.max(1, Number(set && set.next_point_sequence) || 1);
        var nextQuestionSequence = Math.max(1, Number(set && set.next_question_sequence) || 1);
        var move = function (kind, direction, row) { var listEl = document.getElementById(kind === 'point' ? 'teacher-set-points' : 'teacher-set-questions'); var rows = Array.prototype.slice.call(listEl.querySelectorAll('[data-editor-row]')); var index = rows.indexOf(row); var next = index + direction; if (next < 0 || next >= rows.length) return; if (direction < 0) listEl.insertBefore(row, rows[next]); else listEl.insertBefore(rows[next], row); bindEditorButtons(); };
        function bindEditorButtons() { speakingSetEditor.querySelectorAll('[data-row-up]').forEach(function (button) { button.onclick = function () { move(button.getAttribute('data-row-up'), -1, button.closest('[data-editor-row]')); }; }); speakingSetEditor.querySelectorAll('[data-row-down]').forEach(function (button) { button.onclick = function () { move(button.getAttribute('data-row-down'), 1, button.closest('[data-editor-row]')); }; }); speakingSetEditor.querySelectorAll('[data-row-remove]').forEach(function (button) { button.onclick = function () { var row = button.closest('[data-editor-row]'); row.remove(); }; }); }
        bindEditorButtons();
        document.getElementById('teacher-set-add-paragraph').onclick = function () { var label = document.createElement('label'); label.innerHTML = 'Paragraph<textarea data-context-paragraph></textarea>'; document.getElementById('teacher-set-context-body').appendChild(label); };
        document.getElementById('teacher-set-add-point').onclick = function () { var id = 'pa_' + String(nextPointSequence++).padStart(2, '0'); var index = document.querySelectorAll('#teacher-set-points [data-editor-row]').length; document.getElementById('teacher-set-points').insertAdjacentHTML('beforeend', editorRowMarkup('point', { point_id: id, text: '' }, index)); bindEditorButtons(); };
        document.getElementById('teacher-set-add-question').onclick = function () { var id = 'ir_' + String(nextQuestionSequence++).padStart(2, '0'); var index = document.querySelectorAll('#teacher-set-questions [data-editor-row]').length; document.getElementById('teacher-set-questions').insertAdjacentHTML('beforeend', editorRowMarkup('question', { question_id: id, text: '' }, index)); bindEditorButtons(); };
        document.getElementById('teacher-set-editor-close').onclick = function () { speakingSetEditor.hidden = true; };
        var save = document.getElementById('teacher-set-editor-save'); if (save) save.onclick = function () { var rows = function (id, key) { return Array.prototype.slice.call(document.querySelectorAll('#' + id + ' [data-editor-row]')).map(function (row, index) { return { [key]: row.getAttribute('data-' + (key === 'point_id' ? 'point' : 'question') + '-id'), order: index + 1, text: row.querySelector('[data-editor-text]').value }; }); }; var payload = { set_id: document.getElementById('teacher-set-id').value, source_kind: document.getElementById('teacher-set-source').value, exam_year: Number(document.getElementById('teacher-set-year').value), paper_version: document.getElementById('teacher-set-version').value, title: document.getElementById('teacher-set-title').value, source_note: document.getElementById('teacher-set-source-note').value, context: { source_line: document.getElementById('teacher-set-source-line').value, title: document.getElementById('teacher-set-context-title').value, body: Array.prototype.slice.call(document.querySelectorAll('[data-context-paragraph]')).map(function (input) { return input.value; }) }, part_a: { task: document.getElementById('teacher-set-part-a-task').value, instruction: document.getElementById('teacher-set-part-a-instruction').value, discussion_points: rows('teacher-set-points', 'point_id') }, part_b: { instruction: document.getElementById('teacher-set-part-b-instruction').value, questions: rows('teacher-set-questions', 'question_id') }, visible_to_students: document.getElementById('teacher-set-visible').checked }; save.disabled = true; var action = set ? 'teacherUpdateSpeakingSet' : 'teacherCreateSpeakingSet'; var data = set ? { set_id: set.set_id, expected_content_revision: Number(set.content_revision || 1), set: payload } : { set: payload }; call(action, data).then(function () { setMessage('Speaking Set saved.'); speakingSetEditor.hidden = true; return loadSets(); }).catch(function (error) { setMessage(error.message || 'Could not save Speaking Set.', true); }).finally(function () { save.disabled = false; }); };
        if (preview) speakingSetEditor.querySelectorAll('input,textarea,select,button:not(#teacher-set-editor-close)').forEach(function (control) { control.disabled = true; });
    }
    function renderSpeakingSetEditor(set, preview) { speakingSetEditor.hidden = false; speakingSetEditor.innerHTML = '<p class="eyebrow accent">' + (preview ? 'PREVIEW' : set ? 'EDIT SET' : 'CREATE SET') + '</p><h2>' + esc(preview ? speakingSetLabel(set) : set ? 'Edit Speaking Set' : 'Create Speaking Set') + '</h2>' + editorMarkup(set, preview); bindEditor(set, preview); }
    function openSpeakingSetEditor(setId, preview) {
        if (!setId) { renderSpeakingSetEditor(null, false); return Promise.resolve(); }
        var summary = speakingSets.find(function (item) { return item.set_id === setId; });
        speakingSetEditor.hidden = false;
        speakingSetEditor.innerHTML = '<p class="eyebrow accent">' + (preview ? 'PREVIEW' : 'EDIT SET') + '</p><h2>' + esc(summary ? speakingSetLabel(summary) : 'Speaking Set') + '</h2><p>Loading Set content…</p>';
        var request = speakingSetDetails[setId] ? Promise.resolve({ set: speakingSetDetails[setId] }) : call('teacherGetSpeakingSet', { set_id: setId });
        return request.then(function (result) { speakingSetDetails[setId] = result.set; renderSpeakingSetEditor(result.set, preview); }).catch(function (error) { speakingSetEditor.innerHTML = '<p class="eyebrow accent">SET UNAVAILABLE</p><h2>Could not load this Set</h2><p>' + esc(error.message || 'Please try again.') + '</p>'; });
    }
    function loadSets() { return call('teacherListSpeakingSets').then(function (result) { speakingSetDetails = {}; renderTeacherSetList(result.sets || []); return result; }); }
    function load() {
        return loadDiscussionPages(0, []).then(function (discussions) {
            list.innerHTML = discussions.map(function (item) {
                var status = item.analysis_status === 'ready' ? 'Full report ready' : item.analysis_status;
                return '<button class="speaking-card" type="button" data-speaking-teacher-id="' + esc(item.discussion_id) + '"><span><strong>' + esc(item.title) + '</strong><small>' + esc(item.discussion_date || 'No date') + ' · ' + esc(item.participant_count) + ' participants · ' + esc(status) + '</small></span><span class="speaking-pill" data-tone="' + (item.analysis_status === 'ready' ? 'ready' : 'working') + '">' + (item.analysis_status === 'ready' ? 'View report' : 'Open') + '</span></button>';
            }).join('') || '<div class="speaking-detail-card">No Discussions yet.</div>';
            list.querySelectorAll('[data-speaking-teacher-id]').forEach(function (button) {
                button.addEventListener('click', function () { open(button.getAttribute('data-speaking-teacher-id')); });
            });
        });
    }
    function timeLabel(value) {
        var seconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
        return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }
    function initials(value) {
        var parts = String(value || 'Speaker').trim().split(/\s+/).filter(Boolean);
        return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : String(parts[0] || 'S').slice(0, 2)).toUpperCase();
    }
    function reportList(title, items) {
        if (!Array.isArray(items) || !items.length) return '';
        return '<section class="speaking-report-list"><h4>' + esc(title) + '</h4><ul>' + items.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul></section>';
    }
    function teacherDomainCards(candidate) {
        var labels = {
            communication_strategies: ['CS', 'Communication Strategies'],
            ideas_organisation: ['IO', 'Ideas & Organisation'],
            vocabulary_language_patterns: ['VL', 'Vocabulary & Language Pattern']
        };
        var cards = Object.keys(labels).map(function (key) {
            var domain = candidate.domains && candidate.domains[key] || {};
            var score = Number.isFinite(Number(domain.score)) ? Math.max(0, Math.min(7, Number(domain.score))) : null;
            return '<article class="speaking-score-card" style="--score:' + esc(score == null ? 0 : score) + '"><div class="speaking-score-head"><span><b>' + esc(labels[key][0]) + '</b>' + esc(labels[key][1]) + '</span><strong>' + esc(score == null ? '—' : score) + (score == null ? '' : '<small>/7</small>') + '</strong></div><p>' + esc(domain.commentary_zh || 'No commentary is available for this dimension.') + '</p></article>';
        }).join('');
        return cards + '<article class="speaking-score-card speaking-score-card-pd"><div class="speaking-score-head"><span><b>PD</b>Pronunciation &amp; Delivery</span><strong>—</strong></div><p>Not assessed · 暂不评论</p></article>';
    }
    function turnCoachingDetailsMarkup(coaching) {
        var item = coaching || {};
        if (!(item.strength_zh && item.limitation_zh && item.improvement_zh)) return '<div class="speaking-turn-feedback speaking-turn-feedback-legacy"><article><span>Review</span><p>' + esc(item.commentary_zh || '') + '</p></article></div>';
        return '<div class="speaking-turn-feedback">' +
            '<article data-feedback="strength"><span>What worked</span><p>' + esc(item.strength_zh) + '</p></article>' +
            '<article data-feedback="limitation"><span>What could be stronger</span><p>' + esc(item.limitation_zh) + '</p></article>' +
            '<article data-feedback="improvement"><span>How to improve</span><p>' + esc(item.improvement_zh) + '</p></article>' +
            '</div>';
    }
    function teacherTurnReviewsMarkup(candidate) {
        var reviews = Array.isArray(candidate.turn_reviews) ? candidate.turn_reviews : [];
        if (!reviews.length) return '';
        return '<details class="teacher-speaking-turns"><summary><span><strong>Turn-by-turn review</strong><small>CS &amp; IO coaching for every speaking turn</small></span><span class="speaking-pill">' + esc(reviews.length) + ' turn' + (reviews.length === 1 ? '' : 's') + '</span></summary><div class="speaking-turn-list">' + reviews.map(function (review, index) {
            var cs = review.communication_strategies || {};
            var io = review.ideas_organisation || {};
            var caution = review.asr_text_status === 'higher_confidence' ? '' : '<span class="speaking-turn-caution">Possible ASR error</span>';
            return '<article class="speaking-turn-card"><header><div><p>Turn ' + esc(index + 1) + ' · ' + esc(timeLabel(review.start_ms)) + '–' + esc(timeLabel(review.end_ms)) + '</p></div>' + caution + '</header><blockquote>' + esc(review.transcript_text || '') + '</blockquote><div class="speaking-turn-coaching"><section data-domain="cs"><p class="speaking-turn-domain">CS · Communication Strategies</p>' + turnCoachingDetailsMarkup(cs) + '<div class="speaking-turn-sample"><span>Try saying</span><q>' + esc(cs.sample_en || '') + '</q></div></section><section data-domain="io"><p class="speaking-turn-domain">IO · Ideas &amp; Organisation</p>' + turnCoachingDetailsMarkup(io) + '<div class="speaking-turn-sample"><span>Try saying</span><q>' + esc(io.sample_en || '') + '</q></div></section></div></article>';
        }).join('') + '</div></details>';
    }
    function teacherCandidateReportMarkup(candidate) {
        var label = candidate.speaker_label || 'Speaker';
        var turnCount = candidate.interaction_summary && Number.isInteger(candidate.interaction_summary.turn_count) ? candidate.interaction_summary.turn_count : (candidate.turn_reviews || []).length;
        return '<section class="speaking-report-card teacher-speaking-candidate-report"><header class="speaking-report-card-header teacher-speaking-candidate-header"><span class="speaking-avatar" aria-hidden="true">' + esc(initials(label)) + '</span><div><p class="eyebrow accent">CANDIDATE REPORT</p><h2>' + esc(label) + '</h2><p>' + esc(candidate.summary_zh || 'No individual summary is available.') + '</p></div><span class="speaking-pill">' + esc(turnCount) + ' turn' + (turnCount === 1 ? '' : 's') + '</span></header><div class="speaking-score-grid speaking-score-grid-four">' + teacherDomainCards(candidate) + '</div><div class="speaking-coaching-grid">' + reportList('Strengths', candidate.strengths) + reportList('Priority actions', candidate.priority_actions) + reportList('Language suggestions', candidate.language_suggestions) + '</div>' + teacherTurnReviewsMarkup(candidate) + '</section>';
    }
    function teacherTranscriptMarkup(report) {
        if (!Array.isArray(report.transcript) || !report.transcript.length) return '';
        return '<details class="speaking-report-card speaking-transcript teacher-speaking-transcript"><summary><span><strong>Complete script</strong><small>Full Discussion transcript with the teacher-visible Speaker names</small></span></summary><div class="speaking-transcript-lines">' + report.transcript.map(function (line) {
            return '<article class="speaking-transcript-line"><header><strong>' + esc(line.speaker_label || 'Speaker') + '</strong><small>' + esc(timeLabel(line.start_ms)) + '–' + esc(timeLabel(line.end_ms)) + '</small></header><p>' + esc(line.text || '') + '</p></article>';
        }).join('') + '</div></details>';
    }
    function reportMarkup(report, shareBuilder) {
        if (!report) return '<section class="speaking-report-card teacher-speaking-report-empty"><p class="eyebrow accent">TEACHER REPORT</p><h2>No report has been generated</h2><p>Upload and analyse the Discussion before reviewing or sharing group performance.</p></section>';
        var candidates = Array.isArray(report.candidates) ? report.candidates : [];
        return '<div class="teacher-speaking-report-stack"><section class="speaking-report-card teacher-speaking-group-report"><header class="speaking-report-card-header"><div><p class="eyebrow accent">GROUP REPORT</p><h2>Overall performance</h2><p>' + esc(report.group_summary_zh || 'No group summary is available.') + '</p></div><button class="primary-button" id="teacher-speaking-share" type="button">Share group report</button></header><div class="teacher-speaking-group-analysis">' + reportList('Group strengths', report.group_strengths) + reportList('Group priorities', report.group_priorities) + reportList('Discussion flow', report.discussion_flow) + '</div></section>' + shareBuilder + '<div class="teacher-speaking-candidate-section"><div class="teacher-speaking-section-heading"><div><p class="eyebrow accent">ALL CANDIDATE REPORTS</p><h2>Individual performance</h2></div><span class="speaking-pill">' + esc(candidates.length) + ' Candidates</span></div>' + (candidates.map(teacherCandidateReportMarkup).join('') || '<section class="speaking-report-card"><p>No Candidate reports are available.</p></section>') + '</div>' + teacherTranscriptMarkup(report) + '</div>';
    }
    function shareSectionCheckbox(key, label, checked) {
        return '<label><input type="checkbox" data-share-content="' + esc(key) + '"' + (checked ? ' checked' : '') + '> ' + esc(label) + '</label>';
    }
    function open(id) {
        selected = id;
        return call('getDiscussion', { discussion_id: id }).then(function (result) {
            var item = result.discussion;
            var speakerKeys = (item.report && item.report.transcript || []).map(function (line) { return line.speaker_key; }).filter(function (key, index, all) { return key && all.indexOf(key) === index; });
            var roster = (item.participants || []).map(function (participant) {
                var reopen = participant.kind === 'vip' ? '<button class="outline-button" type="button" data-reopen-reference="' + esc(participant.participant_id) + '">Reopen sample</button>' : '';
                var playback = participant.voice_reference_status && participant.voice_reference_status !== 'missing' && participant.voice_reference_status !== 'deleted' ? '<button class="outline-button" type="button" data-teacher-playback="reference" data-participant-id="' + esc(participant.participant_id) + '">Play sample</button>' : '';
                if (participant.matched_speaker_key) playback += '<button class="outline-button" type="button" data-teacher-playback="formal_excerpt" data-participant-id="' + esc(participant.participant_id) + '">Play matched excerpt</button>';
                var voiceprint = '<button class="outline-button" type="button" data-teacher-voiceprint="' + esc(participant.participant_id) + '">' + (participant.reusable_voiceprint_status === 'active' ? 'Update voiceprint' : 'Record voiceprint') + '</button>';
                return '<li class="speaking-participant"><span><strong>' + esc(participant.roster_display_name || participant.display_name) + '</strong><small>Report label: ' + esc(participant.display_name) + ' · ' + esc(participant.kind) + ' · ' + esc(participant.identity_status) + ' · voiceprint ' + esc(participant.reusable_voiceprint_status || 'missing') + '</small></span><select data-mapping-participant="' + esc(participant.participant_id) + '"><option value="">Unassigned</option>' + speakerKeys.map(function (key) {
                    return '<option value="' + esc(key) + '"' + (participant.matched_speaker_key === key ? ' selected' : '') + '>' + esc(key) + '</option>';
                }).join('') + '</select>' + voiceprint + playback + reopen + '</li>';
            }).join('');
            var nameSelection = (item.participants || []).map(function (participant) {
                return '<label><input type="checkbox" checked data-share-participant="' + esc(participant.participant_id) + '"> ' + esc(participant.roster_display_name || participant.display_name) + '</label>';
            }).join('');
            var contentSelection = [
                shareSectionCheckbox('group_summary', 'Group summary', true),
                shareSectionCheckbox('group_analysis', 'Group strengths, priorities, and flow', true),
                shareSectionCheckbox('individual_analysis', 'Individual analysis', true),
                shareSectionCheckbox('language_suggestions', 'Language suggestions', true),
                shareSectionCheckbox('turn_reviews', 'Turn-by-turn CS and IO coaching', true),
                shareSectionCheckbox('evidence', 'Evidence excerpts', true),
                shareSectionCheckbox('transcript', 'Transcript', true)
            ].join('');
            var shareBuilder = '<section id="teacher-speaking-share-builder" class="speaking-report-card teacher-speaking-share-builder" hidden><header class="speaking-report-card-header"><div><p class="eyebrow accent">SHARE GROUP REPORT</p><h2>Choose what the group can see</h2><p>Every Candidate and every report section is selected by default. Clear a name to keep that Candidate anonymous without removing their analysis.</p></div></header><div class="teacher-speaking-share-options"><section><h3>Candidate names</h3><div id="teacher-speaking-name-selection" class="teacher-speaking-checkbox-grid">' + nameSelection + '</div><div class="speaking-detail-actions"><button class="outline-button" type="button" id="teacher-speaking-select-all">Select all</button><button class="outline-button" type="button" id="teacher-speaking-clear-all">Clear all</button></div></section><section><h3>Report content</h3><div id="teacher-speaking-content-selection" class="teacher-speaking-checkbox-grid">' + contentSelection + '</div></section></div><div class="teacher-speaking-share-footer"><button class="primary-button" type="button" id="teacher-speaking-create-share">Create private group link</button><p id="teacher-speaking-share-result"></p></div></section>';
            var disputeHistory = (item.identity_disputes || []).length ? '<section class="speaking-upload-panel"><h3>Student voice concerns</h3>' + item.identity_disputes.map(function (dispute) { var participant = (item.participants || []).find(function (row) { return row.participant_id === dispute.participant_id; }); return '<p><strong>' + esc(participant && (participant.roster_display_name || participant.display_name) || 'Participant') + '</strong> disputed ' + esc(dispute.speaker_key || 'the current match') + ' · revision ' + esc(dispute.mapping_revision) + '</p>'; }).join('') + '</section>' : '';
            detail.hidden = false;
            detail.innerHTML = '<div class="teacher-speaking-report-workspace"><section class="speaking-report-card teacher-speaking-session-card"><div><button class="outline-button" type="button" id="teacher-speaking-back">← Discussions</button><p class="eyebrow accent">TEACHER SPEAKING REPORT</p><h2>' + esc(item.title) + '</h2><p>' + esc(item.recording_status) + ' · ' + esc(item.analysis_status) + ' · ' + esc(item.participant_count) + ' participants</p></div><button class="danger-button" type="button" id="teacher-speaking-delete">Delete Discussion</button></section><details class="speaking-report-card teacher-speaking-roster-card"><summary><span><strong>Roster &amp; voice mapping</strong><small>Teacher-only identity and voiceprint controls</small></span><span class="speaking-pill">' + esc(item.participant_count) + ' participants</span></summary><div class="teacher-speaking-roster-body"><p>Only Candidate Speaker tracks from the server report can be assigned.</p><ul class="speaking-participants">' + roster + '</ul>' + disputeHistory + '<div class="speaking-detail-actions"><button class="primary-button" type="button" id="teacher-speaking-save-mapping">Save voice mapping</button></div></div></details>' + reportMarkup(item.report, shareBuilder) + '</div>';
            bindDetail(item);
        }).catch(function (error) {
            setMessage(error.message || 'Could not load Discussion.', true);
        });
    }
    function bindDetail(item) {
        document.getElementById('teacher-speaking-back').addEventListener('click', function () { detail.hidden = true; });
        document.getElementById('teacher-speaking-save-mapping').addEventListener('click', function () {
            var pairs = Array.prototype.slice.call(detail.querySelectorAll('[data-mapping-participant]')).map(function (select) {
                return { participant_id: select.getAttribute('data-mapping-participant'), speaker_key: select.value };
            }).filter(function (pair) { return pair.speaker_key; });
            call('teacherUpdateVoiceMapping', { discussion_id: selected, mapping_revision: Number(item.mapping_revision || 0), mapping: pairs }).then(function () {
                setMessage('Voice mapping saved.');
                return open(selected);
            }).catch(function (error) { setMessage(error.message || 'Could not save mapping.', true); });
        });
        detail.querySelectorAll('[data-reopen-reference]').forEach(function (button) {
            button.addEventListener('click', function () {
                if (!window.confirm('Reopen this Voice Reference and clear its current match?')) return;
                call('teacherReopenVoiceReference', { discussion_id: selected, participant_id: button.getAttribute('data-reopen-reference') }).then(function () { return open(selected); }).catch(function (error) { setMessage(error.message || 'Could not reopen sample.', true); });
            });
        });
        detail.querySelectorAll('[data-teacher-voiceprint]').forEach(function (button) {
            button.addEventListener('click', function () {
                var locator = { discussion_id: selected, participant_id: button.getAttribute('data-teacher-voiceprint') };
                button.disabled = true;
                call('teacherGetVoiceprintTarget', locator).then(function (result) {
                    renderVoiceprintTarget(result, locator);
                }).catch(function (error) {
                    setMessage(error.message || 'Could not open this voiceprint target.', true);
                }).finally(function () { button.disabled = false; });
            });
        });
        detail.querySelectorAll('[data-teacher-playback]').forEach(function (button) {
            button.addEventListener('click', function () {
                button.disabled = true;
                call('getVoiceConfirmationPlayback', { discussion_id: selected, participant_id: button.getAttribute('data-participant-id'), playback_kind: button.getAttribute('data-teacher-playback') }).then(function (result) {
                    var audio = new Audio(result.url);
                    audio.currentTime = Number(result.start_ms || 0) / 1000;
                    audio.addEventListener('timeupdate', function () { if (audio.currentTime * 1000 >= Number(result.end_ms || 0)) { audio.pause(); audio.src = ''; } });
                    return audio.play();
                }).catch(function (error) { setMessage(error.message || 'Could not play this private excerpt.', true); }).finally(function () { button.disabled = false; });
            });
        });
        var shareToggle = document.getElementById('teacher-speaking-share');
        var selectAll = document.getElementById('teacher-speaking-select-all');
        var clearAll = document.getElementById('teacher-speaking-clear-all');
        var createShare = document.getElementById('teacher-speaking-create-share');
        if (shareToggle) shareToggle.addEventListener('click', function () {
            var builder = document.getElementById('teacher-speaking-share-builder');
            builder.hidden = false;
            builder.scrollIntoView({ behavior: window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
        });
        if (selectAll) selectAll.addEventListener('click', function () { detail.querySelectorAll('[data-share-participant]').forEach(function (box) { box.checked = true; }); });
        if (clearAll) clearAll.addEventListener('click', function () { detail.querySelectorAll('[data-share-participant]').forEach(function (box) { box.checked = false; }); });
        if (createShare) createShare.addEventListener('click', function () {
            var button = document.getElementById('teacher-speaking-create-share');
            button.disabled = true;
            var ids = Array.prototype.slice.call(detail.querySelectorAll('[data-share-participant]:checked')).map(function (box) { return box.getAttribute('data-share-participant'); });
            var selection = { visible_participant_ids: ids };
            detail.querySelectorAll('[data-share-content]').forEach(function (box) { selection[box.getAttribute('data-share-content')] = box.checked; });
            call('createTeacherShare', { discussion_id: selected, selection: selection }).then(function (share) {
                var url = new URL(share.share_url, window.location.href).href;
                document.getElementById('teacher-speaking-share-result').innerHTML = '<a href="' + esc(url) + '" target="_blank" rel="noopener">Open shared group report</a> · expires ' + esc(share.expires_at || 'in 7 days');
            }).catch(function (error) { setMessage(error.message || 'Could not create snapshot.', true); }).finally(function () { button.disabled = false; });
        });
        document.getElementById('teacher-speaking-delete').addEventListener('click', function () {
            if (!window.confirm('Delete this Discussion, its private audio, and its share links?')) return;
            call('deleteDiscussion', { discussion_id: selected }).then(load).then(function () { detail.hidden = true; }).catch(function (error) { setMessage(error.message || 'Could not delete Discussion.', true); });
        });
    }

    document.addEventListener('click', function (event) {
        var tab = event.target.closest && event.target.closest('[data-view="speaking"]');
        if (tab) load().catch(function (error) { setMessage(error.message || 'Speaking Lab is unavailable.', true); });
    });
    panel.querySelectorAll('[data-speaking-workspace]').forEach(function (tab) {
        tab.addEventListener('click', function () {
            panel.querySelectorAll('[data-speaking-workspace]').forEach(function (item) { item.classList.toggle('is-active', item === tab); });
            var sets = tab.getAttribute('data-speaking-workspace') === 'sets';
            speakingSetsPanel.hidden = !sets;
            list.hidden = sets;
            detail.hidden = sets || !selected;
            if (sets) loadSets().catch(function (error) { setMessage(error.message || 'Could not load Speaking Sets.', true); });
        });
    });
    document.getElementById('teacher-speaking-create-set').addEventListener('click', function () { openSpeakingSetEditor('', false); });
    ['teacher-speaking-set-search', 'teacher-speaking-set-year', 'teacher-speaking-set-source', 'teacher-speaking-set-visibility'].forEach(function (id) {
        var control = document.getElementById(id);
        control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', function () { speakingSetRenderLimit = 50; renderTeacherSetResults(); });
    });
    document.getElementById('teacher-speaking-set-more').addEventListener('click', function () { speakingSetRenderLimit += 50; renderTeacherSetResults(); });
    document.getElementById('teacher-voiceprint-find').addEventListener('click', function () {
        var studentId = document.getElementById('teacher-voiceprint-student-id').value.trim();
        if (!studentId) { setMessage('Enter a Student ID first.', true); return; }
        var button = document.getElementById('teacher-voiceprint-find');
        var locator = { student_id: studentId };
        button.disabled = true;
        call('teacherGetVoiceprintTarget', locator).then(function (result) {
            renderVoiceprintTarget(result, locator);
            setMessage('Ask the student to read the passage on this device.');
        }).catch(function (error) {
            setMessage(error.message || 'Student not found.', true);
        }).finally(function () { button.disabled = false; });
    });
    document.getElementById('teacher-voiceprint-student-id').addEventListener('keydown', function (event) {
        if (event.key === 'Enter') { event.preventDefault(); document.getElementById('teacher-voiceprint-find').click(); }
    });
    window.addEventListener('pagehide', cancelVoiceprintRecorder);
    window.MrCatTeacherSpeaking = { load: load, open: open };
})(window);
