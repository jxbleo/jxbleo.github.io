(function(window) {
    'use strict';
    var adapter, revision, drafts = {}, originals = {}, pendingSave = null, pendingAccept = {}, busy = false;
    var status, active = false, expanded = {}, editors = {}, notices = {}, acceptDialog = null;
    function token() { return window.crypto.randomUUID(); }
    function clone(value) { return JSON.parse(JSON.stringify(value)); }
    function rows(data) {
        var result = [];
        (data.blanks || []).forEach(function(item) { result.push({ id: item.id, field: 'sentence', item: item }); });
        (data.multipleChoice || []).forEach(function(item) { result.push({ id: item.id, field: 'question', item: item }); });
        (data.matching || []).forEach(function(group) {
            group.pairs.forEach(function(item, index) { result.push({ id: group.id + '-' + index, field: 'left', item: item }); });
        });
        return result;
    }
    function apply(data, overrides) {
        rows(data).forEach(function(row) {
            var patch = (overrides || {})[row.id];
            if (!patch) return;
            [row.field, 'options'].forEach(function(field) {
                if (field === 'options' && row.field !== 'question') return;
                if (!Object.prototype.hasOwnProperty.call(patch, field)) return;
                row.item[field] = clone(patch[field]);
                row.item._bbcEditedFields = row.item._bbcEditedFields || {};
                row.item._bbcEditedFields[field] = true;
            });
        });
        return data;
    }
    function questionDirty(id) { return JSON.stringify(drafts[id]) !== JSON.stringify(originals[id]); }
    function changes() {
        return Object.keys(drafts).filter(questionDirty)
            .map(function(id) { return drafts[id]; });
    }
    function dirty() { return active && changes().length > 0; }
    function message(text) { if (status) status.textContent = text; }
    function update() {
        Object.keys(editors).forEach(function(id) {
            var editor = editors[id], changed = questionDirty(id);
            editor.dot.hidden = !changed;
            editor.button.setAttribute('aria-expanded', String(!!expanded[id]));
            var label = (expanded[id] ? 'Collapse' : 'Edit') + ' question ' + editor.number + ' and explanation' + (changed ? ' · Unsaved changes' : '');
            editor.button.setAttribute('aria-label', label); editor.button.title = label;
            if (editor.panel) editor.panel.hidden = !expanded[id];
            if (editor.save) editor.save.disabled = busy || !changed;
            if (editor.status) editor.status.textContent = notices[id] || (changed ? 'Unsaved changes' : '');
        });
        document.querySelectorAll('.bbc-edit-field').forEach(function(input) { input.disabled = busy; });
    }
    function friendly(error) {
        var text = error.message || 'Unable to save. Please try again.';
        if (/BBC_EDIT_CONFLICT|DISPUTE_REVIEW_CHANGED/.test(text)) return 'This lesson changed in another window. Your edits are still here. Copy them before reloading the page.';
        if (/BBC_BLANK_REQUIRED/.test(text)) return 'Keep exactly one _____ in each fill-in-the-blank question.';
        if (/BBC_OPTIONS_INVALID/.test(text)) return 'Every choice needs text. Keep the existing choices in their original order.';
        return text;
    }
    function mount() {
        editors = {};
        rows(adapter.data()).forEach(function(row) {
            var input = document.querySelector('[name="' + CSS.escape(row.id) + '"]');
            var host = row.field === 'question' ? document.querySelector('[data-id="' + CSS.escape(row.id) + '"]')
                : input && input.closest(row.field === 'left' ? 'tr' : 'li');
            if (!host) return;
            if (row.field === 'left') host = host.cells[0];
            if (!drafts[row.id]) {
                var value = { question_id: row.id };
                value[row.field] = row.item[row.field] || '';
                if (row.field === 'question') value.options = (row.item.options || []).slice();
                value.explanation = (adapter.key().explanations || {})[row.id] || '';
                originals[row.id] = clone(value); drafts[row.id] = clone(value);
            }
            var button = document.createElement('button');
            button.type = 'button'; button.className = 'bbc-edit-question';
            button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m16 3 5 5L8 21H3v-5L16 3Z"/><path d="m13 6 5 5M3 16l5 5"/></svg><span class="bbc-edit-unsaved-dot" aria-hidden="true" hidden></span>';
            button.setAttribute('aria-controls', 'bbc-question-editor-' + row.id);
            (adapter.actionHost ? adapter.actionHost(host) : host).appendChild(button);
            var editor = editors[row.id] = { button: button, dot: button.querySelector('.bbc-edit-unsaved-dot'), number: row.item.number || row.id };
            function openPanel() {
                if (editor.panel) return;
                var value = drafts[row.id];
                var panel = document.createElement('div'); panel.className = 'bbc-question-editor';
                panel.id = 'bbc-question-editor-' + row.id; editor.panel = panel;
                function field(label, value, change) {
                    var wrap = document.createElement('label'); wrap.textContent = label;
                    var area = document.createElement('textarea'); area.className = 'bbc-edit-field'; area.value = value;
                    area.rows = label === 'Explanation' ? 4 : 3; area.disabled = busy;
                    area.addEventListener('input', function() { change(area.value); delete notices[row.id]; message(''); update(); });
                    wrap.appendChild(area); panel.appendChild(wrap);
                }
                field(row.field === 'sentence' ? 'Question · keep _____ for the blank' : 'Question', value[row.field], function(value) { drafts[row.id][row.field] = value; });
                (value.options || []).forEach(function(option, index) {
                    field('Choice ' + String.fromCharCode(65 + index), option, function(value) { drafts[row.id].options[index] = value; });
                });
                field('Explanation', value.explanation, function(value) { drafts[row.id].explanation = value; });
                var footer = document.createElement('div'); footer.className = 'bbc-question-editor-actions';
                var localStatus = document.createElement('span'); localStatus.className = 'bbc-question-editor-status'; localStatus.setAttribute('role', 'status');
                var saveButton = document.createElement('button'); saveButton.type = 'button'; saveButton.className = 'bbc-save-question'; saveButton.textContent = 'Save';
                saveButton.addEventListener('click', function() { save(row.id); });
                editor.save = saveButton; editor.status = localStatus;
                footer.appendChild(localStatus); footer.appendChild(saveButton); panel.appendChild(footer);
                host.classList.add('bbc-editing-question'); host.appendChild(panel);
            }
            button.addEventListener('click', function() {
                expanded[row.id] = !expanded[row.id];
                if (expanded[row.id]) openPanel();
                update();
                if (expanded[row.id]) editor.panel.querySelector('textarea').focus();
            });
            if (expanded[row.id]) openPanel();
        });
        update();
    }
    function save(questionId) {
        if (busy) return Promise.resolve(false);
        var patch = clone(changes().filter(function(change) { return !questionId || change.question_id === questionId; }));
        if (!patch.length) return Promise.resolve(true);
        var signature = JSON.stringify({ revision: revision, changes: patch });
        if (!pendingSave || pendingSave.signature !== signature) pendingSave = { signature: signature, id: token() };
        busy = true;
        patch.forEach(function(change) { notices[change.question_id] = 'Saving…'; });
        update(); if (!questionId) message('Saving…');
        return adapter.call('saveBbcContent', { set_id: adapter.setId, expected_revision: revision, request_id: pendingSave.id, changes: patch })
            .then(function(result) {
                revision = result.grading_version;
                var overrides = {};
                patch.forEach(function(change) {
                    overrides[change.question_id] = change;
                    adapter.key().explanations[change.question_id] = change.explanation;
                    originals[change.question_id] = clone(change);
                    notices[change.question_id] = 'Saved';
                });
                adapter.key().grading_version = revision;
                apply(adapter.data(), overrides); pendingSave = null;
                adapter.render(mount); message(questionId ? '' : 'Saved');
                if (questionId && editors[questionId]) editors[questionId].button.focus({ preventScroll: true });
                return true;
            }).catch(function(error) {
                var text = friendly(error);
                patch.forEach(function(change) { notices[change.question_id] = text; });
                message(questionId ? '' : text); return false;
            }).finally(function() { busy = false; update(); });
    }
    function accept(id, button) {
        if (busy || acceptDialog) return;
        if (dirty()) { message('Save your question and explanation changes before accepting an answer.'); return; }
        var answer = adapter.answers()[id] || '';
        if (!String(answer).trim()) { message('Enter or select an answer in this question first.'); return; }
        var row = rows(adapter.data()).find(function(row) { return row.id === id; });
        var answerLabel = String(answer);
        if (row && row.field === 'question') {
            var index = answerLabel.toUpperCase().charCodeAt(0) - 65;
            if (/^[A-Z]$/i.test(answerLabel) && row.item.options[index]) answerLabel += '. ' + row.item.options[index];
        }
        var questionText = adapter.questionText(id);
        var dialog = document.createElement('dialog'); dialog.className = 'bbc-save-dialog bbc-accept-dialog';
        acceptDialog = dialog;
        dialog.setAttribute('aria-labelledby', 'bbc-accept-dialog-title');
        dialog.innerHTML = '<h2 id="bbc-accept-dialog-title">Accept as correct answer?</h2><p class="bbc-accept-question"></p><p class="bbc-accept-answer"></p><p>This will add this answer to the accepted answers and regrade affected attempts.</p><p role="status"></p><div><button type="button" data-action="cancel">Cancel</button><button type="button" data-action="accept">Accept as correct answer</button></div>';
        dialog.querySelector('.bbc-accept-question').textContent = 'Question ' + (row && row.item.number || id);
        dialog.querySelector('.bbc-accept-answer').textContent = answerLabel;
        document.body.appendChild(dialog);
        var scrollY = window.scrollY, oldStyle = document.body.getAttribute('style');
        document.body.style.position = 'fixed'; document.body.style.top = -scrollY + 'px'; document.body.style.width = '100%';
        function close() {
            dialog.close(); dialog.remove(); acceptDialog = null;
            if (oldStyle == null) document.body.removeAttribute('style'); else document.body.setAttribute('style', oldStyle);
            window.scrollTo(0, scrollY);
            if (button.isConnected) button.focus({ preventScroll: true });
        }
        dialog.addEventListener('cancel', function(event) { event.preventDefault(); if (!busy) close(); });
        dialog.querySelector('[data-action="cancel"]').onclick = close;
        dialog.querySelector('[data-action="accept"]').onclick = function() {
            if (busy) return;
            if (!pendingAccept[id] || pendingAccept[id].answer !== answer) pendingAccept[id] = { answer: answer, id: token() };
            busy = true; update(); button.disabled = true;
            dialog.querySelectorAll('button').forEach(function(control) { control.disabled = true; });
            dialog.querySelector('[role="status"]').textContent = 'Accepting answer…';
            adapter.call('acceptBbcAnswer', { set_id: adapter.setId, question_id: id, submitted_answer: answer,
                question_text: questionText, expected_revision: revision, request_id: pendingAccept[id].id })
                .then(function(result) {
                    revision = result.grading_version;
                    var before = adapter.key().answers[id];
                    var accepted = Array.isArray(before) ? before.slice() : [before];
                    if (accepted.indexOf(answer) === -1) accepted.push(answer);
                    adapter.key().answers[id] = accepted; adapter.key().grading_version = revision;
                    delete pendingAccept[id]; close(); adapter.renderAnswers(); message('Accepted as correct answer');
                }).catch(function(error) {
                    dialog.querySelector('[role="status"]').textContent = friendly(error);
                }).finally(function() {
                    busy = false; button.disabled = false; update();
                    dialog.querySelectorAll('button').forEach(function(control) { control.disabled = false; });
                });
        };
        dialog.showModal(); dialog.querySelector('[data-action="cancel"]').focus();
    }
    function beforeNavigate(proceed) {
        if (busy) { message('Please wait until saving finishes.'); return; }
        if (!dirty()) { proceed(); return; }
        var dialog = document.createElement('dialog'); dialog.className = 'bbc-save-dialog';
        dialog.setAttribute('aria-labelledby', 'bbc-save-dialog-title');
        dialog.innerHTML = '<h2 id="bbc-save-dialog-title">Save changes before leaving?</h2><p>Your question and explanation edits have not been saved.</p><p class="bbc-leave-status" role="status"></p><div><button type="button" data-action="stay">Keep editing</button><button type="button" data-action="discard">Leave without saving</button><button type="button" data-action="save">Save and leave</button></div>';
        document.body.appendChild(dialog);
        var scrollY = window.scrollY;
        var oldStyle = document.body.getAttribute('style');
        document.body.style.position = 'fixed'; document.body.style.top = -scrollY + 'px'; document.body.style.width = '100%';
        function close() {
            dialog.close(); dialog.remove();
            if (oldStyle == null) document.body.removeAttribute('style'); else document.body.setAttribute('style', oldStyle);
            window.scrollTo(0, scrollY);
        }
        dialog.addEventListener('cancel', function(event) { event.preventDefault(); if (!busy) close(); });
        dialog.querySelector('[data-action="stay"]').onclick = close;
        dialog.querySelector('[data-action="discard"]').onclick = function() { drafts = {}; close(); proceed(); };
        dialog.querySelector('[data-action="save"]').onclick = function() {
            dialog.querySelectorAll('button').forEach(function(button) { button.disabled = true; });
            dialog.querySelector('[role="status"]').textContent = 'Saving…';
            save().then(function(saved) {
                if (saved) { close(); proceed(); }
                else {
                    dialog.querySelector('[role="status"]').textContent = status.textContent;
                    dialog.querySelectorAll('button').forEach(function(button) { button.disabled = false; });
                }
            });
        };
        dialog.showModal(); dialog.querySelector('[data-action="stay"]').focus();
    }
    function init(options) {
        adapter = options; revision = String(adapter.key().grading_version || '1'); active = true;
        var toolbar = document.getElementById('history-toolbar');
        toolbar.classList.add('bbc-teacher-toolbar');
        status = document.createElement('span'); status.className = 'bbc-editor-status'; status.setAttribute('role', 'status');
        toolbar.appendChild(status); mount(); update();
        window.addEventListener('beforeunload', function(event) { if (dirty() || busy) { event.preventDefault(); event.returnValue = ''; } });
        document.addEventListener('click', function(event) {
            var link = event.target.closest('a[href]');
            if (!link || link.target === '_blank' || link.hasAttribute('download') || (!dirty() && !busy) || link.getAttribute('href').charAt(0) === '#') return;
            event.preventDefault(); event.stopImmediatePropagation(); beforeNavigate(function() { window.location.href = link.href; });
        }, true);
    }
    window.MrCatBbcEditor = { apply: apply, init: init, accept: accept, beforeNavigate: function(proceed) { if (active) beforeNavigate(proceed); else proceed(); } };
})(window);
