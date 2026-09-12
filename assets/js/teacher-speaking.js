(function (window) {
    'use strict';

    var panel = document.getElementById('view-speaking');
    if (!panel || !window.MrCatCloud || !window.MrCatAuth) return;
    var home = document.getElementById('teacher-speaking-home');
    var resultsPanel = document.getElementById('teacher-speaking-results');
    var list = document.getElementById('teacher-speaking-list');
    var detail = document.getElementById('teacher-speaking-detail');
    var message = document.getElementById('teacher-speaking-message');
    var voiceprintTargetPanel = document.getElementById('teacher-voiceprint-target');
    var topicSelect = document.getElementById('teacher-speaking-topic');
    var yearSelect = document.getElementById('teacher-speaking-year');
    var topicLabel = document.getElementById('teacher-speaking-topic-label');
    var setPicker = document.getElementById('teacher-speaking-set-picker');
    var setSearch = document.getElementById('teacher-speaking-set-search');
    var setOptions = document.getElementById('teacher-speaking-set-options');
    var setCount = document.getElementById('teacher-speaking-set-count');
    var setScope = document.getElementById('teacher-speaking-set-scope');
    var setClose = document.getElementById('teacher-speaking-set-close');
    var setPickerRows = [];
    var setActiveIndex = -1;
    var setPickerModal = false;
    var audioFileInput = document.getElementById('teacher-speaking-audio-file');
    var audioFileButton = document.getElementById('teacher-speaking-file-button');
    var recordButton = document.getElementById('teacher-speaking-record');
    var recordLabel = document.getElementById('teacher-speaking-record-label');
    var recorderDialog = document.getElementById('teacher-speaking-recorder-dialog');
    var recorderHost = document.getElementById('teacher-speaking-recorder-host');
    var discardButton = document.getElementById('teacher-speaking-recorder-close');
    var teacherRecorder = null;
    var captureMessage = null;
    var reportCount = document.getElementById('teacher-speaking-report-count');
    var selected = '';
    var voiceprintTarget = null;
    var voiceprintLocator = null;
    var voiceprintController = null;
    var voiceprintSaving = false;
    var speakingSets = [];
    var discussions = [];
    var loadInFlight = null;
    var captureState = 'idle';
    var localRecording = null;
    var teacherAudioOperationId = '';
    var draftCreateOperationId = '';
    var draftUploadOperationId = '';
    var draftDiscussionId = '';
    var pendingAnalysisDiscussionId = '';
    var FILE_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;

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
        var unavailable = result.provider_configured === false || Boolean(result.registration && result.registration.available === false);
        var unavailableMessage = result.registration && result.registration.message || 'Tencent voiceprint registration is not configured yet.';
        var label = voiceprintTarget.display_name + (voiceprintTarget.name_not_verified ? ' · Non-VIP · Name not verified' : ' · VIP');
        voiceprintTargetPanel.hidden = false;
        voiceprintTargetPanel.innerHTML = '<p class="eyebrow accent">VOICEPRINT TARGET</p><h3>' + esc(label) + '</h3><p><strong>' + esc(voiceprintState) + '</strong></p><p>' + (active ? 'Reusable voiceprint ready. A new recording will replace it.' : 'No reusable voiceprint has been registered.') + '</p><blockquote>' + esc(voiceprintTarget.passage || '') + '</blockquote><label class="speaking-consent"><input type="checkbox" id="teacher-voiceprint-consent"> I confirm that this person is present and agrees to register or replace this reusable voiceprint.</label><div class="speaking-recording-time" id="teacher-voiceprint-time">00:00 / 00:20</div><p class="speaking-quality-warning" id="teacher-voiceprint-status">' + (unavailable ? esc(unavailableMessage) : 'Record in a quiet place and ask the person to read the full passage.') + '</p><div class="speaking-detail-actions"><button class="primary-button" id="teacher-voiceprint-record" type="button"' + (unavailable ? ' disabled' : '') + '>' + (active ? 'Record replacement' : 'Start recording') + '</button><button class="outline-button" id="teacher-voiceprint-stop" type="button" disabled>Finish recording</button>' + (active ? '<button class="danger-button" id="teacher-voiceprint-remove" type="button">Remove voiceprint</button>' : '') + '<button class="outline-button" id="teacher-voiceprint-close" type="button">Close</button></div>';
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
    function speakingSetLabel(set) {
        return set.display_label || [String(set.exam_year || ''), set.paper_version ? 'Set ' + set.paper_version : '', set.title || 'Speaking topic'].filter(Boolean).join(' · ');
    }
    function shanghaiToday() {
        try {
            return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
        } catch (_error) {
            return new Date().toISOString().slice(0, 10);
        }
    }
    function syncTeacherCapture(snapshot) {
        captureState = snapshot.state === 'review' ? 'ready' : snapshot.state;
        localRecording = snapshot.blob;
        if (teacherAudioOperationId !== snapshot.operationId) {
            teacherAudioOperationId = snapshot.operationId;
            draftUploadOperationId = '';
        }
        var active = teacherCaptureLocked();
        topicSelect.disabled = !speakingSets.length || active || Boolean(draftDiscussionId);
        yearSelect.disabled = topicSelect.disabled;
        audioFileButton.disabled = active;
        recordButton.disabled = active;
        recordLabel.textContent = localRecording ? 'Review recording' : 'Record';
        discardButton.hidden = active;
        discardButton.textContent = captureState === 'analysis_retry' ? 'View reports' : 'Back';
        recorderDialog.classList.toggle('is-capturing', ['requesting', 'countdown', 'recording', 'ending', 'stopping'].indexOf(captureState) !== -1);
        document.getElementById('teacher-speaking-open-results').disabled = active || captureState === 'ready';
    }
    function teacherCaptureLocked() { return ['requesting', 'countdown', 'recording', 'ending', 'stopping', 'uploading'].indexOf(captureState) !== -1; }
    function setCaptureState(nextState, copy) {
        teacherRecorder.setState(nextState === 'ready' ? 'review' : nextState, copy);
    }
    function clearLocalRecording() {
        teacherRecorder.clear();
        localRecording = null;
        draftUploadOperationId = '';
    }
    function resetTeacherDraft() {
        clearLocalRecording();
        draftCreateOperationId = '';
        draftDiscussionId = '';
        pendingAnalysisDiscussionId = '';
        setCaptureState('idle', '');
        topicSelect.disabled = false;
        yearSelect.disabled = false;
        if (recorderDialog.open) recorderDialog.close();
    }
    function openTeacherRecorder() {
        if (!topicSelect.value) { setMessage('Choose a Speaking topic first.', true); topicSelect.focus(); return false; }
        closeSetPicker(false);
        if (!recorderDialog.open) { recorderDialog.hidden = false; recorderDialog.showModal(); }
        return true;
    }
    function normaliseAudioMime(blob) {
        var mime = String(blob && blob.type || '').split(';')[0].toLowerCase();
        if (/^audio\/(webm|mp4|mpeg|wav|x-m4a|aac)$/.test(mime)) return mime;
        var name = String(blob && blob.name || '').toLowerCase();
        if (/\.mp3$/.test(name)) return 'audio/mpeg';
        if (/\.m4a$/.test(name)) return 'audio/x-m4a';
        if (/\.wav$/.test(name)) return 'audio/wav';
        if (/\.aac$/.test(name)) return 'audio/aac';
        if (/\.mp4$/.test(name)) return 'audio/mp4';
        return 'audio/webm';
    }
    function prepareAudioFile(file) {
        if (!file || !openTeacherRecorder()) return;
        teacherRecorder.prepareFile(file);
    }
    function uploadWithTimeout(request) {
        var timer;
        var timeout = new Promise(function (_resolve, reject) {
            timer = window.setTimeout(function () { reject(new Error('The upload took too long. Your recording is still ready to retry.')); }, FILE_UPLOAD_TIMEOUT_MS);
        });
        return Promise.race([request, timeout]).finally(function () { if (timer) window.clearTimeout(timer); });
    }
    function ensureDraftDiscussion() {
        var recording = teacherRecorder.snapshot();
        if (draftDiscussionId) return call('updateDiscussionDate', { discussion_id: draftDiscussionId, discussion_date: recording.date }).then(function () {
            return call('updateDiscussionDuration', { discussion_id: draftDiscussionId, duration_seconds: recording.targetSeconds });
        }).then(function () { return draftDiscussionId; });
        if (!topicSelect.value) return Promise.reject(new Error('Choose a Speaking topic first.'));
        draftCreateOperationId = draftCreateOperationId || ('teacher-discussion-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9));
        return call('createDiscussion', {
            set_id: topicSelect.value,
            discussion_date: recording.date,
            duration_seconds: recording.targetSeconds,
            operation_id: draftCreateOperationId
        }).then(function (result) {
            draftDiscussionId = result.discussion.discussion_id;
            topicSelect.disabled = true;
            yearSelect.disabled = true;
            return draftDiscussionId;
        });
    }
    function finishTeacherAnalysis(discussionId) {
        setCaptureState('uploading', 'The recording is safe. Starting the result analysis…');
        return call('startAnalysis', { discussion_id: discussionId, operation_id: 'analysis-' + discussionId }).then(function () {
            resetTeacherDraft();
            setMessage('Recording uploaded. The result report is being prepared.');
            return refreshDiscussionList().then(showResults);
        }).catch(function (error) {
            clearLocalRecording();
            pendingAnalysisDiscussionId = discussionId;
            setCaptureState('analysis_retry', (error.message || 'The analysis could not start.') + ' Retry without uploading the audio again.');
            throw error;
        });
    }
    function uploadTeacherRecording() {
        if (captureState === 'analysis_retry' && pendingAnalysisDiscussionId) {
            finishTeacherAnalysis(pendingAnalysisDiscussionId).catch(function () {});
            return;
        }
        if (!localRecording || captureState !== 'ready') return;
        var blob = localRecording;
        var mime = normaliseAudioMime(blob);
        draftUploadOperationId = draftUploadOperationId || ('teacher-upload-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9));
        setCaptureState('uploading', 'Creating a private upload for this recording…');
        ensureDraftDiscussion().then(function (discussionId) {
            return call('startAudioUpload', { discussion_id: discussionId, operation_id: draftUploadOperationId, mime_type: mime, size_bytes: blob.size }).then(function (result) {
                if (result.status === 'uploaded') return { discussionId: discussionId, assetId: result.asset_id, uploadedFileId: null };
                captureMessage.textContent = 'Uploading the recording securely…';
                return uploadWithTimeout(window.MrCatCloud.uploadCloudFile(result.upload.cloud_path, blob)).then(function (uploaded) {
                    return { discussionId: discussionId, assetId: result.asset_id, uploadedFileId: uploaded.file_id };
                });
            });
        }).then(function (upload) {
            if (!upload.uploadedFileId) return upload;
            captureMessage.textContent = 'Verifying the private upload…';
            return call('finishAudioUpload', { discussion_id: upload.discussionId, operation_id: draftUploadOperationId, asset_id: upload.assetId, uploaded_file_id: upload.uploadedFileId }).then(function () { return upload; });
        }).then(function (upload) {
            clearLocalRecording();
            return finishTeacherAnalysis(upload.discussionId);
        }).catch(function (error) {
            if (captureState !== 'analysis_retry') setCaptureState(localRecording ? 'ready' : 'idle', localRecording ? (error.message || 'The upload could not finish.') + ' Your recording is still ready to retry.' : '');
            setMessage(error.message || 'The recording could not be uploaded.', true);
        });
    }
    function discardTeacherRecording() {
        if (teacherCaptureLocked()) return;
        if (captureState === 'analysis_retry') { recorderDialog.close(); showResults(); return; }
        if (localRecording && !window.confirm('Discard this recording and leave?')) return;
        if (!draftDiscussionId) { resetTeacherDraft(); return; }
        if (!window.confirm('Discard this recording draft and remove its empty report record?')) return;
        discardButton.disabled = true;
        call('deleteDiscussion', { discussion_id: draftDiscussionId }).then(function () {
            resetTeacherDraft();
            return refreshDiscussionList();
        }).catch(function (error) {
            setMessage(error.message || 'The draft could not be discarded.', true);
        }).finally(function () { discardButton.disabled = false; });
    }
    function renderTopicOptions(rows) {
        speakingSets = Array.isArray(rows) ? rows : [];
        var previousYear = yearSelect.value;
        var years = speakingSets.map(function (set) { return String(set.exam_year || ''); }).filter(function (year, index, all) { return year && all.indexOf(year) === index; }).sort(function (a, b) { return Number(b) - Number(a); });
        yearSelect.innerHTML = '<option value="">All years</option>' + years.map(function (year) { return '<option value="' + esc(year) + '">' + esc(year) + '</option>'; }).join('');
        if (years.indexOf(previousYear) !== -1) yearSelect.value = previousYear;
        renderFilteredTopicOptions();
    }
    function matchingSpeakingSets(rows, year, query) {
        var terms = String(query || '').normalize('NFKC').toLowerCase().trim().split(/\s+/).filter(Boolean);
        return rows.filter(function (set) {
            if (year && String(set.exam_year || '') !== String(year)) return false;
            var text = [set.title, set.display_label, set.set_id, set.exam_year, set.paper_version ? 'Set ' + set.paper_version : '', set.source_kind].filter(function (part) { return part != null; }).join(' ').normalize('NFKC').toLowerCase();
            return terms.every(function (term) { return text.indexOf(term) !== -1; });
        });
    }
    function renderFilteredTopicOptions() {
        var filtered = matchingSpeakingSets(speakingSets, yearSelect.value, '');
        var selectedSet = filtered.find(function (set) { return set.set_id === topicSelect.value; });
        if (!selectedSet) topicSelect.value = '';
        topicLabel.textContent = selectedSet ? speakingSetLabel(selectedSet) : (filtered.length ? 'Choose…' : 'No sets available');
        topicSelect.title = selectedSet ? speakingSetLabel(selectedSet) : '';
        yearSelect.disabled = !speakingSets.length || Boolean(draftDiscussionId) || teacherCaptureLocked();
        topicSelect.disabled = yearSelect.disabled || !filtered.length;
        if (!setPicker.hidden) {
            if (topicSelect.disabled) closeSetPicker();
            else renderSetSearchResults();
        }
    }
    function setActiveOption(index, scroll) {
        setActiveIndex = index >= 0 && index < setPickerRows.length ? index : -1;
        setOptions.querySelectorAll('[data-set-index]').forEach(function (option, position) {
            option.classList.toggle('is-active', position === setActiveIndex);
        });
        var active = setActiveIndex >= 0 ? document.getElementById('teacher-speaking-option-' + setActiveIndex) : null;
        if (active) {
            setSearch.setAttribute('aria-activedescendant', active.id);
            if (scroll) active.scrollIntoView({ block: 'nearest' });
        } else setSearch.removeAttribute('aria-activedescendant');
    }
    function renderSetSearchResults() {
        setPickerRows = matchingSpeakingSets(speakingSets, yearSelect.value, setSearch.value);
        setScope.textContent = yearSelect.value || 'All years';
        setCount.textContent = setPickerRows.length ? setPickerRows.length + (setPickerRows.length === 1 ? ' set' : ' sets') : 'No sets found';
        setOptions.innerHTML = setPickerRows.map(function (set, index) {
            var meta = [set.exam_year, set.paper_version ? 'Set ' + set.paper_version : '', set.visible_to_students === false ? 'Hidden' : ''].filter(Boolean).join(' · ');
            return '<div class="teacher-speaking-set-option" id="teacher-speaking-option-' + index + '" role="option" aria-selected="' + (set.set_id === topicSelect.value ? 'true' : 'false') + '" data-set-index="' + index + '"><span><small>' + esc(meta) + '</small><strong>' + esc(set.title || speakingSetLabel(set)) + '</strong></span><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5 12 4 4L19 6"></path></svg></div>';
        }).join('') || '<p class="teacher-speaking-set-empty">Try another name or set number.</p>';
        setOptions.scrollTop = 0;
        var selectedIndex = setPickerRows.findIndex(function (set) { return set.set_id === topicSelect.value; });
        setActiveOption(selectedIndex >= 0 ? selectedIndex : 0, false);
    }
    function positionSetPicker() {
        if (setPicker.hidden) return;
        var mobile = window.matchMedia('(max-width: 760px)').matches;
        if (mobile !== setPickerModal) { closeSetPicker(); return; }
        var viewport = window.visualViewport;
        var width = viewport ? viewport.width : window.innerWidth;
        var height = viewport ? viewport.height : window.innerHeight;
        var offsetTop = viewport ? viewport.offsetTop : 0;
        var offsetLeft = viewport ? viewport.offsetLeft : 0;
        var rect = topicSelect.getBoundingClientRect();
        var pickerWidth = Math.min(mobile ? 440 : Math.max(340, rect.width), width - 32);
        var pickerHeight = Math.min(mobile ? 520 : 420, height - 32);
        var top;
        var left;
        if (mobile) {
            top = offsetTop + (height - pickerHeight) / 2;
            left = offsetLeft + (width - pickerWidth) / 2;
        } else {
            var below = height + offsetTop - rect.bottom - 24;
            var above = rect.top - offsetTop - 24;
            var openBelow = below >= Math.min(260, pickerHeight) || below >= above;
            pickerHeight = Math.max(120, Math.min(pickerHeight, openBelow ? below : above));
            top = openBelow ? rect.bottom + 8 : rect.top - pickerHeight - 8;
            top = Math.max(offsetTop + 16, top);
            left = Math.max(offsetLeft + 16, Math.min(rect.left, offsetLeft + width - pickerWidth - 16));
        }
        setPicker.style.width = pickerWidth + 'px';
        setPicker.style.height = pickerHeight + 'px';
        setPicker.style.left = left + 'px';
        setPicker.style.top = top + 'px';
    }
    function openSetPicker() {
        if (topicSelect.disabled) return;
        if (!setPicker.hidden) { closeSetPicker(); return; }
        setPickerModal = window.matchMedia('(max-width: 760px)').matches;
        setPicker.setAttribute('aria-modal', setPickerModal ? 'true' : 'false');
        setPicker.hidden = false;
        setSearch.value = '';
        renderSetSearchResults();
        positionSetPicker();
        if (setPickerModal) setPicker.showModal();
        else setPicker.show();
        topicSelect.setAttribute('aria-expanded', 'true');
        setSearch.setAttribute('aria-expanded', 'true');
        setSearch.focus({ preventScroll: true });
        setActiveOption(setActiveIndex, true);
    }
    function closeSetPicker(restoreFocus) {
        if (setPicker.hidden) return;
        setPicker.hidden = true;
        setPicker.close();
        topicSelect.setAttribute('aria-expanded', 'false');
        setSearch.setAttribute('aria-expanded', 'false');
        setSearch.removeAttribute('aria-activedescendant');
        if (restoreFocus !== false) topicSelect.focus({ preventScroll: true });
    }
    function chooseSetResult(index) {
        var set = setPickerRows[index];
        if (!set || topicSelect.disabled) return;
        topicSelect.value = set.set_id;
        closeSetPicker();
        renderFilteredTopicOptions();
        setMessage('');
    }
    function renderDiscussionList(rows) {
        discussions = Array.isArray(rows) ? rows : [];
        var ready = discussions.filter(function (item) { return item.analysis_status === 'ready'; }).length;
        var working = discussions.filter(function (item) { return ['queued', 'processing'].indexOf(item.analysis_status) !== -1; }).length;
        reportCount.textContent = ready ? ready + ' ready' + (working ? ' · ' + working + ' preparing' : '') : (working ? working + ' preparing' : 'No reports yet');
        list.innerHTML = discussions.map(function (item) {
            var status = item.analysis_status === 'ready' ? 'Full report ready' : (['queued', 'processing'].indexOf(item.analysis_status) !== -1 ? 'Preparing report' : item.analysis_status === 'failed' ? 'Analysis interrupted' : 'Recording not analysed');
            var participants = Number(item.participant_count || 0);
            return '<button class="speaking-card" type="button" data-speaking-teacher-id="' + esc(item.discussion_id) + '"><span><strong>' + esc(item.title) + '</strong><small>' + esc(item.discussion_date || 'No date') + ' · ' + esc(participants) + ' matched participant' + (participants === 1 ? '' : 's') + ' · ' + esc(status) + '</small></span><span class="speaking-pill" data-tone="' + (item.analysis_status === 'ready' ? 'ready' : 'working') + '">' + (item.analysis_status === 'ready' ? 'View report' : 'Open') + '</span></button>';
        }).join('') || '<div class="speaking-detail-card">No result reports yet. Start with the recording card.</div>';
        list.querySelectorAll('[data-speaking-teacher-id]').forEach(function (button) {
            button.addEventListener('click', function () { open(button.getAttribute('data-speaking-teacher-id')); });
        });
    }
    function refreshDiscussionList() {
        return loadDiscussionPages(0, []).then(function (rows) { renderDiscussionList(rows); return rows; });
    }
    function showHome() {
        closeSetPicker(false);
        home.hidden = false;
        resultsPanel.hidden = true;
        detail.hidden = true;
        voiceprintTargetPanel.hidden = true;
        selected = '';
    }
    function showResults() {
        closeSetPicker(false);
        if (teacherCaptureLocked() || captureState === 'ready') {
            setMessage('Finish this recording or discard it before opening reports.', true);
            return;
        }
        home.hidden = true;
        resultsPanel.hidden = false;
        detail.hidden = true;
        voiceprintTargetPanel.hidden = true;
        selected = '';
        setMessage('');
    }
    function load() {
        if (loadInFlight) return loadInFlight;
        loadInFlight = call('teacherListSpeakingSets').then(function (result) {
            renderTopicOptions(result.sets || []);
            return refreshDiscussionList();
        }).finally(function () { loadInFlight = null; });
        return loadInFlight;
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
        home.hidden = true;
        resultsPanel.hidden = true;
        voiceprintTargetPanel.hidden = true;
        detail.hidden = true;
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
            showResults();
            setMessage(error.message || 'Could not load Discussion.', true);
        });
    }
    function bindDetail(item) {
        document.getElementById('teacher-speaking-back').addEventListener('click', showResults);
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
            var deletingId = selected;
            call('deleteDiscussion', { discussion_id: deletingId }).then(function () {
                if (deletingId === draftDiscussionId) resetTeacherDraft();
                return refreshDiscussionList();
            }).then(showResults).catch(function (error) { setMessage(error.message || 'Could not delete Discussion.', true); });
        });
    }

    document.addEventListener('click', function (event) {
        var tab = event.target.closest && event.target.closest('[data-view="speaking"]');
        if (tab) {
            showHome();
            load().catch(function (error) { setMessage(error.message || 'Speaking Lab is unavailable.', true); });
        }
    });
    document.getElementById('teacher-speaking-open-results').addEventListener('click', showResults);
    document.getElementById('teacher-speaking-results-back').addEventListener('click', showHome);
    recorderHost.innerHTML = window.MrCatSpeakingRecorder.markup({ targetSeconds: 480, date: shanghaiToday() });
    teacherRecorder = window.MrCatSpeakingRecorder.create(recorderHost.querySelector('.speaking-recording-card'), {
        onStateChange: syncTeacherCapture,
        onUpload: uploadTeacherRecording,
        canStart: function () { return Boolean(topicSelect.value); }
    });
    captureMessage = recorderHost.querySelector('#recording-uploading p');
    recorderDialog.addEventListener('close', function () { if (!recorderDialog.open) recorderDialog.hidden = true; });
    recorderDialog.addEventListener('cancel', function (event) { event.preventDefault(); discardTeacherRecording(); });
    recordButton.addEventListener('click', openTeacherRecorder);
    audioFileButton.addEventListener('click', function () {
        if (!topicSelect.value) { setMessage('Choose a Speaking topic first.', true); topicSelect.focus(); return; }
        if (!openTeacherRecorder()) return;
        if (captureState === 'idle') recorderHost.querySelector('#audio-file').click();
    });
    audioFileInput.addEventListener('change', function () {
        var file = audioFileInput.files && audioFileInput.files[0];
        audioFileInput.value = '';
        if (!topicSelect.value) { setMessage('Choose a Speaking topic first.', true); topicSelect.focus(); return; }
        prepareAudioFile(file);
    });
    discardButton.addEventListener('click', discardTeacherRecording);
    topicSelect.addEventListener('click', openSetPicker);
    setClose.addEventListener('click', function () { closeSetPicker(); });
    setSearch.addEventListener('input', renderSetSearchResults);
    setSearch.addEventListener('keydown', function (event) {
        if (event.isComposing) return;
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            var next = setActiveIndex + (event.key === 'ArrowDown' ? 1 : -1);
            setActiveOption(Math.max(0, Math.min(setPickerRows.length - 1, next)), true);
        } else if (event.key === 'Enter') {
            event.preventDefault();
            chooseSetResult(setActiveIndex);
        }
    });
    setOptions.addEventListener('click', function (event) {
        var option = event.target.closest('[data-set-index]');
        if (option) chooseSetResult(Number(option.getAttribute('data-set-index')));
    });
    setPicker.addEventListener('cancel', function (event) { event.preventDefault(); closeSetPicker(); });
    setPicker.addEventListener('click', function (event) {
        if (!setPickerModal || event.target !== setPicker) return;
        var rect = setPicker.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeSetPicker();
    });
    document.addEventListener('keydown', function (event) {
        if (!setPicker.hidden && event.key === 'Escape') { event.preventDefault(); closeSetPicker(); }
    });
    document.addEventListener('pointerdown', function (event) {
        if (!setPicker.hidden && !setPickerModal && !setPicker.contains(event.target) && !topicSelect.contains(event.target)) closeSetPicker(false);
    });
    document.addEventListener('focusin', function (event) {
        if (!setPicker.hidden && !setPickerModal && !setPicker.contains(event.target) && !topicSelect.contains(event.target)) closeSetPicker(false);
    });
    window.addEventListener('resize', positionSetPicker);
    window.addEventListener('scroll', positionSetPicker, { passive: true });
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', positionSetPicker);
        window.visualViewport.addEventListener('scroll', positionSetPicker);
    }
    new MutationObserver(function () { if (panel.hidden) closeSetPicker(false); }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
    yearSelect.addEventListener('change', function () { renderFilteredTopicOptions(); setMessage(''); });
    window.addEventListener('pagehide', function () {
        closeSetPicker(false);
        cancelVoiceprintRecorder();
        if (teacherRecorder) teacherRecorder.discard();
        if (recorderDialog.open) recorderDialog.close();
    });
    window.addEventListener('beforeunload', function (event) {
        if (!localRecording && !teacherCaptureLocked()) return;
        event.preventDefault();
        event.returnValue = '';
    });
    window.MrCatTeacherSpeaking = { load: load, open: open };
})(window);
