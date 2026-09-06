(function (window) {
    'use strict';

    var api = window.MrCatCloud;
    var auth = window.MrCatAuth;
    var list = document.getElementById('speaking-list');
    var detail = document.getElementById('speaking-detail');
    var initialLoading = document.getElementById('speaking-initial-loading');
    var status = document.getElementById('speaking-status');
    var sidebar = document.getElementById('speaking-sidebar');
    var backButton = document.getElementById('speaking-back-button');
    var sidebarToggle = document.getElementById('speaking-sidebar-toggle');
    var sidebarAlert = document.getElementById('speaking-sidebar-alert');
    var sidebarScrim = document.getElementById('speaking-sidebar-scrim');
    var sidebarNew = document.getElementById('speaking-sidebar-new');
    var sidebarVoiceprint = document.getElementById('speaking-sidebar-voiceprint');
    var sidebarPartA = document.getElementById('speaking-sidebar-part-a');
    var sidebarPartB = document.getElementById('speaking-sidebar-part-b');
    var sidebarDiscussions = document.getElementById('speaking-sidebar-discussions');
    var sidebarResponses = document.getElementById('speaking-sidebar-responses');
    var discussionSort = document.getElementById('speaking-discussion-sort');
    var toolbarTitleWindow = document.getElementById('speaking-toolbar-title-window');
    var toolbarTitle = document.getElementById('speaking-toolbar-title');
    var toolbarEdit = document.getElementById('speaking-toolbar-edit');
    var leaveDialog = document.getElementById('speaking-leave-dialog');
    var leaveDialogCancel = document.getElementById('speaking-leave-cancel');
    var leaveDialogConfirm = document.getElementById('speaking-leave-confirm');
    var titleDialog = document.getElementById('discussion-title-dialog');
    var titleForm = document.getElementById('discussion-title-form');
    var titleInput = document.getElementById('discussion-title-edit');
    var titleError = document.getElementById('discussion-title-error');
    var promptDialog = document.getElementById('discussion-prompt-dialog');
    var promptDialogTitle = document.getElementById('discussion-prompt-dialog-title');
    var promptDialogSubtitle = document.getElementById('discussion-prompt-dialog-subtitle');
    var promptDialogText = document.getElementById('discussion-prompt-dialog-text');
    var candidateDialog = document.getElementById('discussion-candidate-dialog');
    var candidateDialogContent = document.getElementById('discussion-candidate-dialog-content');
    var transcriptionDialog = document.getElementById('discussion-transcription-dialog');
    var transcriptionDialogContent = document.getElementById('discussion-transcription-dialog-content');
    var transcriptionDialogClose = document.getElementById('discussion-transcription-close');
    var responseDialog = document.getElementById('individual-response-dialog');
    var responseDialogContent = document.getElementById('individual-response-dialog-content');
    var invitationDialog = document.getElementById('invitation-dialog');
    var invitationDialogContent = document.getElementById('invitation-dialog-content');
    var selectedId = new URLSearchParams(window.location.search).get('discussion') || '';
    var activeStream = null;
    var recorder = null;
    var recordingChunks = [];
    var recordingStartedAt = 0;
    var recordingTimer = 0;
    var recordingBlob = null;
    var recordingTargetSeconds = 0;
    var recordingState = 'idle';
    var recordingCaptureGeneration = 0;
    var recordingUploadOperationId = '';
    var recordingPreviewAudio = null;
    var recordingPreviewUrl = '';
    var recordingTargetNoticeShown = false;
    var recordingCountdownTimer = 0;
    var recordingSpeech = null;
    var recordingLiveOrigin = null;
    var qualityFrame = 0;
    var qualityAnalyser = null;
    var qualityContext = null;
    var qualityIssue = '';
    var qualityBadSince = 0;
    var qualityRecoverySince = 0;
    var qualityReadyAt = 0;
    var qualityVisualState = 'listening';
    var qualityVisualCandidate = '';
    var qualityVisualSince = 0;
    var qualitySmoothedDbfs = -60;
    var LOW_VOLUME_DBFS = -45;
    var HIGH_VOLUME_DBFS = -10;
    var CLIPPING_AMPLITUDE = 0.98;
    var INPUT_LOSS_SECONDS = 3;
    var VOICE_REFERENCE_PASSAGE = 'Many people have different ideas. I will listen carefully, explain my view, and respond clearly to the group before we reach a conclusion.';
    var pollTimer = 0;
    var pollGeneration = 0;
    var voiceRecorder = null;
    var voiceStream = null;
    var voiceTimer = 0;
    var voiceStartedAt = 0;
    var voiceButton = null;
    var voiceDiscard = false;
    var voiceprintTarget = null;
    var voiceprintController = null;
    var voiceprintSaving = false;
    var voiceprintPendingResult = null;
    var voiceprintPressActive = false;
    var voiceprintPressToken = 0;
    var voiceprintPointerId = null;
    var voiceprintProviderConfigured = true;
    var sidebarMode = 'part-a';
    var expandedDiscussionSetIds = Object.create(null);
    var READ_TIMEOUT_MS = 20000;
    var MUTATION_TIMEOUT_MS = 90000;
    var FILE_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
    var READ_ACTIONS = {
        getMyVoiceprint: true,
        listDiscussions: true,
        getDiscussion: true,
        getVoiceConfirmationPlayback: true,
        listSpeakingSets: true,
        getSpeakingSet: true,
        listIndividualResponses: true,
        getIndividualResponse: true
    };
    var sidebarUpdateCount = 0;
    var discussionSortOrder = 'newest';
    var currentDiscussion = null;
    var toolbarTitleMeasureFrame = 0;
    var speakingSets = [];
    var speakingSetRenderLimit = 48;
    var selectedSpeakingSet = null;
    var speakingSetReadingSizes = { context: 1, 'part-a': 1, 'part-b': 1 };
    var selectedResponse = null;
    var responseRecorder = null;
    var responseStream = null;
    var responseChunks = [];
    var responseStartedAt = 0;
    var responseRecordedDurationSeconds = null;
    var responseTimer = 0;
    var responseBlob = null;
    var responseUploadOperationId = '';
    var responseUploadInProgress = false;

    function finishInitialLoading() {
        document.documentElement.classList.remove('speaking-direct-entry');
        if (initialLoading) initialLoading.setAttribute('aria-busy', 'false');
    }

    function esc(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, function (character) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character];
        });
    }
    function call(action, data) {
        // Page startup has already completed getSession(), and speakingLab
        // derives the caller from server-side context on every action. Avoid a
        // second browser-SDK login preflight here. Initial reads are also
        // sequenced below because concurrent SDK credential initialization can
        // leave both requests pending without invoking the function at all.
        var timeoutMs = READ_ACTIONS[action] ? READ_TIMEOUT_MS : MUTATION_TIMEOUT_MS;
        var timeoutId = 0;
        var request = api.callFunction('speakingLab', Object.assign({ action: action }, data || {}));
        var timeout = new Promise(function (_, reject) {
            timeoutId = window.setTimeout(function () {
                var error = new Error('Speaking Lab is taking too long to respond. Please refresh and try again.');
                error.code = 'SPEAKING_REQUEST_TIMEOUT';
                reject(error);
            }, timeoutMs);
        });
        return Promise.race([request, timeout]).finally(function () {
            if (timeoutId) window.clearTimeout(timeoutId);
        }).then(function (result) {
            if (!result || result.success === false) {
                var error = new Error(result && result.message || 'Speaking Lab request failed.');
                error.code = result && result.code || 'SPEAKING_LAB_ERROR';
                throw error;
            }
            return result;
        });
    }
    function setStatus(message, isError) {
        status.innerHTML = message ? '<span class="speaking-status-dot" aria-hidden="true"></span><span>' + esc(message) + '</span>' : '';
        status.classList.toggle('is-error', Boolean(isError));
    }
    function friendlyError(error) {
        if (error && error.code === 'SPEAKING_PROVIDER_NOT_CONFIGURED') return 'Speaking analysis is not enabled yet. Your recording is still private.';
        if (error && error.code === 'SPEAKING_UPLOAD_TIMEOUT') return 'The audio upload took too long. Check the connection and try again; the Discussion was not submitted for analysis.';
        if (error && error.message) return error.message;
        return 'The Speaking Lab request could not be completed. Please try again.';
    }
    function uploadWithTimeout(promise) {
        var timeoutId = 0;
        var timeout = new Promise(function (_, reject) {
            timeoutId = window.setTimeout(function () {
                var error = new Error('The audio upload took too long.');
                error.code = 'SPEAKING_UPLOAD_TIMEOUT';
                reject(error);
            }, FILE_UPLOAD_TIMEOUT_MS);
        });
        return Promise.race([promise, timeout]).finally(function () {
            if (timeoutId) window.clearTimeout(timeoutId);
        });
    }
    function formatDate(value) {
        if (!value) return 'Date not set';
        var date = new Date(value + (String(value).length === 10 ? 'T00:00:00+08:00' : ''));
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
    function shanghaiToday() {
        var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).reduce(function (result, part) { result[part.type] = part.value; return result; }, {});
        return parts.year + '-' + parts.month + '-' + parts.day;
    }
    function measureToolbarTitle() {
        toolbarTitleMeasureFrame = 0;
        toolbarTitleWindow.classList.remove('is-overflowing');
        toolbarTitleWindow.style.removeProperty('--speaking-toolbar-title-shift');
        toolbarTitleWindow.style.removeProperty('--speaking-toolbar-title-duration');
        var overflow = Math.ceil(toolbarTitle.scrollWidth - toolbarTitleWindow.clientWidth);
        if (overflow <= 1) return;
        toolbarTitleWindow.style.setProperty('--speaking-toolbar-title-shift', '-' + overflow + 'px');
        toolbarTitleWindow.style.setProperty('--speaking-toolbar-title-duration', Math.max(8, Math.min(22, 6 + overflow / 32)).toFixed(2) + 's');
        toolbarTitleWindow.classList.add('is-overflowing');
    }
    function scheduleToolbarTitleMeasure() {
        if (toolbarTitleMeasureFrame) window.cancelAnimationFrame(toolbarTitleMeasureFrame);
        toolbarTitleMeasureFrame = window.requestAnimationFrame(measureToolbarTitle);
    }
    function updateToolbar(item) {
        currentDiscussion = item && !item.invitation ? item : null;
        var title = item && item.title ? item.title : 'Speaking Lab';
        toolbarTitle.textContent = title;
        toolbarTitle.setAttribute('title', title);
        toolbarEdit.hidden = !(currentDiscussion && currentDiscussion.can_edit_title);
        toolbarEdit.disabled = recordingLocksPage();
        scheduleToolbarTitleMeasure();
        document.title = currentDiscussion ? title + ' | Speaking Lab' : 'Speaking Lab | Mr. Cat Academy';
    }
    function openTitleDialog() {
        if (!currentDiscussion || !currentDiscussion.can_edit_title || recordingLocksPage()) return;
        titleInput.value = currentDiscussion.title || '';
        titleError.textContent = '';
        if (typeof titleDialog.showModal === 'function') titleDialog.showModal();
        else titleDialog.setAttribute('open', '');
        window.setTimeout(function () { titleInput.focus(); titleInput.select(); }, 0);
    }
    function openPromptDialog() {
        if (!currentDiscussion || !promptDialog) return;
        promptDialogTitle.textContent = currentDiscussion.title || 'Discussion task';
        promptDialogSubtitle.textContent = formatDate(currentDiscussion.discussion_date) + ' · DSE Paper 4 Part A Group Discussion Task';
        promptDialogText.textContent = currentDiscussion.prompt_text || 'No Discussion Task is available.';
        if (typeof promptDialog.showModal === 'function') promptDialog.showModal();
        else promptDialog.setAttribute('open', '');
    }
    function studentShareMarkup(item) {
        var canShare = (item.participants || []).some(function (participant) { return participant.is_self && ['voiceprint_confirmed', 'student_confirmed', 'teacher_confirmed'].indexOf(participant.identity_status) >= 0; });
        return '<div class="speaking-report-share"><div><strong>Private report sharing</strong><p>' + (canShare ? 'Create a seven-day Student Share with your own confirmed name only.' : 'Confirm your voice before creating a Student Share.') + '</p></div>' + (canShare ? '<button class="primary-button" type="button" id="create-student-share">Create Student Share</button>' : '<span class="speaking-pill">Voice confirmation required</span>') + '</div><div id="student-share-result"></div>';
    }
    function openCandidateDialog() {
        if (!currentDiscussion || !candidateDialog || !candidateDialogContent) return;
        var controls = candidateControls(currentDiscussion);
        candidateDialogContent.innerHTML = '<div class="speaking-dialog-head"><p class="eyebrow accent">CANDIDATES</p><h2 id="discussion-candidate-dialog-title">Candidate matching</h2><p>Task · ' + esc(currentDiscussion.title || 'Discussion Task') + '</p></div><div class="speaking-candidate-dialog-actions">' + controls.voiceSearchButton + '<span class="speaking-pill">' + esc(controls.candidatePill) + '</span></div>' + (controls.voiceSearchNote ? '<p class="speaking-voice-search-note" role="status">' + esc(controls.voiceSearchNote) + '</p>' : '') + controls.candidateIntro + controls.identityAccess + studentShareMarkup(currentDiscussion) + '<div class="speaking-dialog-actions"><button class="primary-button" id="discussion-candidate-close" type="button">Done</button></div>';
        bindInvitationActions(candidateDialogContent);
        if (typeof candidateDialog.showModal === 'function') candidateDialog.showModal();
        else candidateDialog.setAttribute('open', '');
    }
    function openTranscriptionDialog() {
        var report = currentDiscussion && currentDiscussion.report;
        if (!report || !transcriptionDialog || !transcriptionDialogContent) return;
        var own = (report.candidates || []).find(function (candidate) { return candidate.is_self; });
        var lines = transcriptLinesMarkup(report, own && own.speaker_key, null);
        transcriptionDialogContent.innerHTML = lines ? '<div class="speaking-transcript-lines">' + lines + '</div>' : '<p class="speaking-report-empty">No transcription is available.</p>';
        if (typeof transcriptionDialog.showModal === 'function') transcriptionDialog.showModal();
        else transcriptionDialog.setAttribute('open', '');
    }
    function voiceprintTime(seconds) {
        var value = Math.max(0, Math.min(20, Math.floor(Number(seconds || 0))));
        return '00:' + String(value).padStart(2, '0');
    }
    function readableStatus(value) {
        var text = String(value || 'not ready').replace(/_/g, ' ').trim();
        return text ? text.charAt(0).toUpperCase() + text.slice(1) : 'Not ready';
    }
    function statusTone(value) {
        var state = String(value || '').toLowerCase();
        if (['ready', 'uploaded', 'accepted', 'voiceprint_confirmed', 'student_confirmed', 'teacher_confirmed'].indexOf(state) >= 0) return 'ready';
        if (['queued', 'processing', 'uploading', 'ai_matched'].indexOf(state) >= 0) return 'working';
        if (['pending', 'failed', 'quality_failed', 'disputed'].indexOf(state) >= 0) return 'attention';
        return 'neutral';
    }
    function initials(value) {
        var parts = String(value || 'Speaker').trim().split(/\s+/).filter(Boolean);
        return (parts.length > 1 ? parts[0].charAt(0) + parts[parts.length - 1].charAt(0) : parts[0].slice(0, 2)).toUpperCase();
    }
    function workflowMarkup(item) {
        var recordingDone = item.recording_status === 'uploaded';
        var reportDone = item.analysis_status === 'ready';
        var analysisWorking = ['queued', 'processing'].indexOf(item.analysis_status) >= 0;
        var steps = [
            { label: 'Prepare group', state: recordingDone ? 'is-done' : 'is-current' },
            { label: 'Record & analyse', state: reportDone ? 'is-done' : (recordingDone || analysisWorking ? 'is-current' : '') },
            { label: 'Review report', state: reportDone ? 'is-current' : '' }
        ];
        return '<div class="speaking-workflow" aria-label="Discussion progress">' + steps.map(function (step) { return '<span class="speaking-workflow-step ' + step.state + '">' + esc(step.label) + '</span>'; }).join('') + '</div>';
    }
    function renderMyVoiceprint(result) {
        voiceprintTarget = result && result.target || null;
        voiceprintProviderConfigured = Boolean(result && result.provider_configured !== false);
        var active = Boolean(voiceprintTarget && voiceprintTarget.voiceprint && voiceprintTarget.voiceprint.status === 'active');
        var main = document.getElementById('speaking-voiceprint-main');
        var button = document.getElementById('voiceprint-record');
        if (main) main.classList.toggle('has-voiceprint', active);
        if (button) button.disabled = !voiceprintProviderConfigured;
        document.getElementById('voiceprint-record-label').textContent = active ? 'Hold to update' : 'Hold to record';
        if (voiceprintTarget && voiceprintTarget.passage) document.getElementById('voiceprint-passage').textContent = voiceprintTarget.passage;
    }
    function loadMyVoiceprint() {
        return call('getMyVoiceprint').then(function (result) { renderMyVoiceprint(result); return result; }).catch(function (error) {
            voiceprintProviderConfigured = false;
            document.getElementById('voiceprint-record').disabled = true;
            document.getElementById('voiceprint-message').textContent = friendlyError(error);
        });
    }
    function resetVoiceprintPage(options) {
        if (voiceprintController) voiceprintController.cancel();
        voiceprintController = null;
        voiceprintPendingResult = null;
        voiceprintPressActive = false;
        voiceprintPressToken += 1;
        voiceprintPointerId = null;
        var recordButton = document.getElementById('voiceprint-record');
        var active = Boolean(voiceprintTarget && voiceprintTarget.voiceprint && voiceprintTarget.voiceprint.status === 'active');
        recordButton.disabled = !voiceprintProviderConfigured;
        recordButton.classList.remove('is-recording', 'is-valid', 'is-processing');
        document.getElementById('voiceprint-record-label').textContent = active ? 'Hold to update' : 'Hold to record';
        document.getElementById('voiceprint-time').textContent = voiceprintTime(0);
        document.getElementById('voiceprint-confirm').hidden = true;
        if (!options || !options.keepMessage) document.getElementById('voiceprint-message').textContent = voiceprintProviderConfigured ? 'Hold the microphone for at least 10 seconds. Release when you finish.' : 'Voiceprint registration is temporarily unavailable.';
    }
    function saveVoiceprintRecording(result) {
        if (!result || !result.base64 || voiceprintSaving) return;
        voiceprintSaving = true;
        var confirmButton = document.getElementById('voiceprint-confirm');
        var recordButton = document.getElementById('voiceprint-record');
        confirmButton.disabled = true;
        recordButton.disabled = true;
        recordButton.classList.add('is-processing');
        document.getElementById('voiceprint-message').textContent = 'Saving your reusable voiceprint…';
        call('saveMyVoiceprint', {
            operation_id: 'voiceprint-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
            consent_confirmed: true,
            audio_base64: result.base64
        }).then(function (saved) {
            renderMyVoiceprint({ target: saved.target, provider_configured: true });
            voiceprintPendingResult = null;
            confirmButton.hidden = true;
            document.getElementById('voiceprint-time').textContent = voiceprintTime(0);
            document.getElementById('voiceprint-message').textContent = 'Voiceprint saved. Hold the microphone again whenever you want to update it.';
        }).catch(function (error) {
            document.getElementById('voiceprint-message').textContent = friendlyError(error);
            confirmButton.disabled = false;
        }).finally(function () {
            voiceprintSaving = false;
            voiceprintController = null;
            recordButton.classList.remove('is-processing');
            recordButton.disabled = !voiceprintProviderConfigured;
        });
    }
    function voiceprintRecordingReady(result, token) {
        if (token !== voiceprintPressToken || !result || !result.base64) return;
        voiceprintController = null;
        voiceprintPressActive = false;
        voiceprintPendingResult = result;
        var recordButton = document.getElementById('voiceprint-record');
        var active = Boolean(voiceprintTarget && voiceprintTarget.voiceprint && voiceprintTarget.voiceprint.status === 'active');
        recordButton.classList.remove('is-recording', 'is-valid', 'is-processing');
        recordButton.disabled = !voiceprintProviderConfigured;
        document.getElementById('voiceprint-record-label').textContent = active ? 'Hold to record another update' : 'Hold to record again';
        document.getElementById('voiceprint-time').textContent = voiceprintTime(Number(result.duration_ms || 0) / 1000);
        document.getElementById('voiceprint-message').textContent = 'Recording ready. Confirm below to upload this voiceprint.';
        document.getElementById('voiceprint-confirm').hidden = false;
    }
    function voiceprintRecordingFailed(error, token) {
        if (token !== voiceprintPressToken) return;
        voiceprintController = null;
        voiceprintPressActive = false;
        var recordButton = document.getElementById('voiceprint-record');
        recordButton.classList.remove('is-recording', 'is-valid', 'is-processing');
        recordButton.disabled = !voiceprintProviderConfigured;
        document.getElementById('voiceprint-message').textContent = friendlyError(error);
    }
    function startMyVoiceprintRecording(event) {
        if (voiceprintSaving || voiceprintController || voiceprintPressActive || !voiceprintProviderConfigured) return;
        if (!document.getElementById('voiceprint-consent').checked) {
            document.getElementById('voiceprint-message').textContent = 'Confirm consent before recording a reusable voiceprint.';
            return;
        }
        var recordButton = document.getElementById('voiceprint-record');
        var token = ++voiceprintPressToken;
        voiceprintPressActive = true;
        voiceprintPendingResult = null;
        document.getElementById('voiceprint-confirm').hidden = true;
        if (event && Number.isInteger(event.pointerId)) {
            voiceprintPointerId = event.pointerId;
            try { recordButton.setPointerCapture(event.pointerId); } catch (_error) {}
        }
        recordButton.disabled = false;
        recordButton.classList.add('is-recording');
        document.getElementById('voiceprint-record-label').textContent = 'Starting microphone…';
        document.getElementById('voiceprint-time').textContent = voiceprintTime(0);
        document.getElementById('voiceprint-message').textContent = 'Keep holding and read the passage aloud.';
        window.MrCatVoiceprintRecorder.start({
            maxSeconds: 20,
            onProgress: function (seconds) {
                if (token !== voiceprintPressToken) return;
                document.getElementById('voiceprint-time').textContent = voiceprintTime(seconds);
                recordButton.classList.toggle('is-valid', seconds >= 10);
                document.getElementById('voiceprint-record-label').textContent = seconds >= 10 ? 'Release to finish' : 'Keep holding';
            },
            onReady: function (result) { voiceprintRecordingReady(result, token); },
            onError: function (error) { voiceprintRecordingFailed(error, token); }
        }).then(function (controller) {
            if (token !== voiceprintPressToken || !voiceprintPressActive) {
                controller.cancel();
                return;
            }
            voiceprintController = controller;
            recordButton.disabled = false;
        }).catch(function () {
            voiceprintRecordingFailed(new Error('Microphone access was denied or this browser cannot create a voiceprint recording.'), token);
        });
    }
    function stopMyVoiceprintRecording(cancelled) {
        if (!voiceprintPressActive) return;
        voiceprintPressActive = false;
        var token = voiceprintPressToken;
        var recordButton = document.getElementById('voiceprint-record');
        recordButton.classList.remove('is-recording', 'is-valid');
        recordButton.disabled = !voiceprintProviderConfigured;
        if (!voiceprintController) {
            voiceprintPressToken += 1;
            document.getElementById('voiceprint-record-label').textContent = 'Hold to record';
            document.getElementById('voiceprint-message').textContent = cancelled ? 'Recording cancelled.' : 'Hold until the microphone starts, then release after 10 seconds.';
            return;
        }
        var current = voiceprintController;
        var elapsed = current.elapsedSeconds();
        voiceprintController = null;
        if (cancelled || elapsed < 10) {
            current.cancel();
            voiceprintPendingResult = null;
            document.getElementById('voiceprint-time').textContent = voiceprintTime(elapsed);
            document.getElementById('voiceprint-record-label').textContent = 'Hold to try again';
            document.getElementById('voiceprint-message').textContent = cancelled ? 'Recording cancelled.' : 'That was too short. Hold the microphone for at least 10 seconds and try again.';
            return;
        }
        recordButton.disabled = true;
        recordButton.classList.add('is-processing');
        document.getElementById('voiceprint-record-label').textContent = 'Preparing recording…';
        current.stop().then(function (result) { voiceprintRecordingReady(result, token); }).catch(function (error) { voiceprintRecordingFailed(error, token); });
    }
    function discussionCardState(item) {
        if (item.practice_status === 'completed') return 'practised';
        if (item.analysis_status === 'failed') return 'failed';
        if (['queued', 'processing'].includes(item.analysis_status)) return 'processing';
        if (item.analysis_status === 'ready') return 'ready';
        return 'not-started';
    }
    function discussionCardIcon(state) {
        if (state === 'practised') return '<svg class="speaking-card-star" viewBox="0 0 24 24"><path d="m12 2.8 2.8 5.7 6.3.9-4.6 4.5 1.1 6.3-5.6-3-5.6 3 1.1-6.3-4.6-4.5 6.3-.9Z"/></svg>';
        if (state === 'failed') return '<span class="speaking-card-error">!</span>';
        return '';
    }
    function discussionCardStateLabel(state) {
        return { processing: 'Processing', ready: 'Report ready', practised: 'Practised', failed: 'Processing failed', 'not-started': 'Not uploaded' }[state] || 'Discussion';
    }
    function listCard(item) {
        var pending = item.invitation_pending === true || (item.participants || []).some(function (participant) { return participant.is_self && participant.invitation_status === 'pending'; });
        var voiceMatchNotice = (item.participants || []).some(function (participant) { return participant.is_self && participant.identity_notice_unread; });
        var state = discussionCardState(item);
        var current = String(item.discussion_id || '') === String(selectedId || '');
        var candidateCount = Number.isInteger(item.candidate_count) ? item.candidate_count : Number(item.participant_count || 0);
        var candidateLabel = candidateCount > 0 ? ' · ' + candidateCount + ' ' + (candidateCount === 1 ? 'Candidate' : 'Candidates') : '';
        var meta = (pending ? '<span class="speaking-pill" data-tone="attention">Invitation</span>' : '') + (voiceMatchNotice ? '<span class="speaking-pill" data-tone="attention">Voice matched</span>' : '');
        var accessibleStatus = discussionCardStateLabel(state) + (item.report_unread ? ', new report' : '');
        return '<button class="speaking-card' + (pending ? ' is-invitation' : '') + (current ? ' is-current' : '') + '" type="button" data-state="' + esc(state) + '" data-discussion-id="' + esc(item.discussion_id) + '"' + (current ? ' aria-current="page"' : '') + ' aria-label="' + esc((item.title || 'Untitled Discussion') + '. ' + candidateCount + ' ' + (candidateCount === 1 ? 'Candidate' : 'Candidates') + '. ' + accessibleStatus + '.') + '">' +
            '<span class="speaking-card-icon" aria-hidden="true">' + discussionCardIcon(state) + '</span>' +
            '<span class="speaking-card-copy"><span class="speaking-card-title"><h3>' + esc(item.title || 'Untitled Discussion') + '</h3>' + (item.report_unread ? '<span class="speaking-card-unread-dot" aria-hidden="true"></span>' : '') + '</span><span class="speaking-card-date">' + esc(formatDate(item.discussion_date) + candidateLabel) + '</span></span>' +
            (meta ? '<span class="speaking-card-meta">' + meta + '</span>' : '') +
            '<svg class="speaking-card-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>';
    }
    function sidebarToggleLabel(expanded) {
        var action = expanded ? 'Close Discussion sidebar' : 'Open Discussion sidebar';
        if (!sidebarUpdateCount) return action;
        return action + '. ' + sidebarUpdateCount + ' new Discussion update' + (sidebarUpdateCount === 1 ? '' : 's') + '.';
    }
    function updateSidebarUpdates(items) {
        sidebarUpdateCount = (items || []).filter(function (item) {
            return item.report_unread === true || item.invitation_pending === true || (item.participants || []).some(function (participant) {
                return participant.is_self && (participant.invitation_status === 'pending' || participant.identity_notice_unread);
            });
        }).length;
        sidebarAlert.hidden = sidebarUpdateCount === 0;
        sidebarToggle.classList.toggle('has-updates', sidebarUpdateCount > 0);
        sidebarToggle.setAttribute('aria-label', sidebarToggleLabel(sidebar.classList.contains('is-open')));
    }
    function openSidebar() {
        syncDiscussionSidebarSelection();
        sidebar.classList.add('is-open');
        sidebar.setAttribute('aria-hidden', 'false');
        sidebarToggle.setAttribute('aria-expanded', 'true');
        sidebarToggle.setAttribute('aria-label', sidebarToggleLabel(true));
        sidebarScrim.hidden = false;
        document.body.classList.add('speaking-sidebar-open');
    }
    function closeSidebar(options) {
        sidebar.classList.remove('is-open');
        sidebar.setAttribute('aria-hidden', 'true');
        sidebarToggle.setAttribute('aria-expanded', 'false');
        sidebarToggle.setAttribute('aria-label', sidebarToggleLabel(false));
        sidebarScrim.hidden = true;
        document.body.classList.remove('speaking-sidebar-open');
        if (options && options.restoreFocus) sidebarToggle.focus();
    }
    function openLeaveSpeakingDialog() {
        closeSidebar();
        if (typeof leaveDialog.showModal === 'function') leaveDialog.showModal();
        else leaveDialog.setAttribute('open', '');
    }
    function closeLeaveSpeakingDialog() {
        if (leaveDialog.open && leaveDialog.close) leaveDialog.close();
        else leaveDialog.removeAttribute('open');
    }
    function handleSpeakingBack() {
        if (sidebar.classList.contains('is-open')) {
            closeSidebar({ restoreFocus: false });
            return;
        }
        var voiceprintMain = document.getElementById('speaking-voiceprint-main');
        var insideSpeakingContent = Boolean(selectedId || selectedSpeakingSet || selectedResponse || !detail.hidden || (voiceprintMain && !voiceprintMain.hidden));
        if (insideSpeakingContent) {
            if (responseRecorder && responseRecorder.state !== 'inactive') {
                setStatus('Finish the Individual Response recording before leaving this page.', true);
                return;
            }
            stopResponseHardware();
            returnToSpeakingHome();
            return;
        }
        if (!allowRecordingNavigation()) return;
        openLeaveSpeakingDialog();
    }
    function setSidebarMode(mode) {
        sidebarMode = mode === 'part-b' ? 'part-b' : 'part-a';
        var showPartA = sidebarMode === 'part-a';
        sidebarPartA.classList.toggle('is-active', showPartA);
        sidebarPartA.setAttribute('aria-selected', String(showPartA));
        sidebarPartB.classList.toggle('is-active', !showPartA);
        sidebarPartB.setAttribute('aria-selected', String(!showPartA));
        sidebarDiscussions.hidden = !showPartA;
        sidebarResponses.hidden = showPartA;
    }
    function returnToSpeakingHome() {
        if (!allowRecordingNavigation()) return;
        document.body.classList.remove('speaking-detail-open');
        detail.hidden = true;
        document.getElementById('speaking-set-library').hidden = false;
        document.getElementById('speaking-voiceprint-main').hidden = true;
        selectedId = '';
        selectedSpeakingSet = null;
        selectedResponse = null;
        pollGeneration += 1;
        if (pollTimer) window.clearTimeout(pollTimer);
        window.history.replaceState(null, '', 'speaking-lab.html');
        voiceDiscard = true;
        stopVoiceReferenceRecording();
        closeSidebar();
        updateToolbar(null);
    }
    function createDiscussionFromSet(set) {
        if (!allowRecordingNavigation()) return;
        closeSidebar();
        if (!set || !set.set_id) return;
        var button = document.getElementById('start-set-discussion');
        if (button) { button.disabled = true; button.querySelector('span').textContent = 'Starting…'; }
        setStatus('Creating your Discussion…');
        return call('createDiscussion', {
            operation_id: 'create-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
            set_id: set.set_id,
            title: set.title + ' · ' + shanghaiToday(),
            discussion_date: shanghaiToday(),
            duration_seconds: 480
        }).then(function (result) {
            selectedId = result.discussion.discussion_id;
            selectedSpeakingSet = null;
            return loadList();
        }).catch(function (error) {
            setStatus(friendlyError(error), true);
            if (button) { button.disabled = false; button.querySelector('span').textContent = 'Start Discussion'; }
        });
    }
    function discussionSetIdentity(item) {
        var snapshot = item && item.set_snapshot || {};
        var sourceKind = String(snapshot.source_kind || '').toLowerCase();
        var source = sourceKind === 'pp' ? 'Past Paper' : sourceKind === 'mock' ? 'Mock' : '';
        var yearAndSource = [snapshot.exam_year || '', source].filter(Boolean).join(' ');
        var linkedSetId = String(item && item.set_id || '');
        return {
            key: linkedSetId || '__other_discussions__',
            set_id: linkedSetId,
            meta: [yearAndSource, snapshot.paper_version ? 'Set ' + snapshot.paper_version : ''].filter(Boolean).join(' · ') || (linkedSetId ? 'DSE Paper 4' : 'No linked Set'),
            title: snapshot.title || (linkedSetId ? linkedSetId : 'Other Discussions')
        };
    }
    function groupDiscussionsBySet(items) {
        var groups = [];
        var groupsById = Object.create(null);
        (Array.isArray(items) ? items : []).forEach(function (item) {
            var identity = discussionSetIdentity(item);
            if (!groupsById[identity.key]) {
                groupsById[identity.key] = {
                    key: identity.key,
                    set_id: identity.set_id,
                    meta: identity.meta,
                    title: identity.title,
                    discussions: []
                };
                groups.push(groupsById[identity.key]);
            }
            groupsById[identity.key].discussions.push(item);
        });
        return groups;
    }
    function latestDiscussion(items) {
        return (Array.isArray(items) ? items : []).reduce(function (latest, item) {
            if (!latest) return item;
            var latestDate = String(latest.discussion_date || '');
            var itemDate = String(item.discussion_date || '');
            if (itemDate !== latestDate) return itemDate > latestDate ? item : latest;
            var latestTime = new Date(latest.recording_uploaded_at || latest.created_at || 0).getTime() || 0;
            var itemTime = new Date(item.recording_uploaded_at || item.created_at || 0).getTime() || 0;
            return itemTime > latestTime ? item : latest;
        }, null);
    }
    function discussionSetGroup(group, index) {
        var count = group.discussions.length;
        var itemsId = 'speaking-discussion-set-items-' + String(index + 1);
        var containsCurrent = group.discussions.some(function (item) { return String(item.discussion_id || '') === String(selectedId || ''); });
        var expanded = containsCurrent || expandedDiscussionSetIds[group.key] === true;
        var latest = latestDiscussion(group.discussions) || {};
        var latestState = discussionCardState(latest);
        var unread = group.discussions.some(function (item) { return item.report_unread === true; });
        if (containsCurrent) expandedDiscussionSetIds[group.key] = true;
        return '<section class="speaking-response-set-group speaking-discussion-set-group' + (containsCurrent ? ' has-current' : '') + '" data-discussion-set-id="' + esc(group.set_id) + '" data-discussion-set-key="' + esc(group.key) + '">' +
            '<button class="speaking-response-set-header speaking-discussion-set-header" type="button" data-discussion-set-toggle data-discussion-set-key="' + esc(group.key) + '" aria-expanded="' + (expanded ? 'true' : 'false') + '" aria-controls="' + itemsId + '" aria-label="' + esc(group.title + '. ' + count + ' ' + (count === 1 ? 'Discussion' : 'Discussions') + '. Latest: ' + discussionCardStateLabel(latestState) + (unread ? '. New report' : '')) + '"><span class="speaking-response-set-copy"><small>' + esc(group.meta) + '</small><span class="speaking-discussion-set-title"><strong>' + esc(group.title) + '</strong>' + (unread ? '<span class="speaking-card-unread-dot" aria-hidden="true"></span>' : '') + '</span></span><span class="speaking-response-set-summary"><span class="speaking-discussion-set-state" data-state="' + esc(latestState) + '" aria-hidden="true">' + discussionCardIcon(latestState) + '</span><span class="speaking-response-set-count">' + esc(count) + ' ' + (count === 1 ? 'discussion' : 'discussions') + '</span><svg class="speaking-response-set-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></button>' +
            '<div class="speaking-response-set-items speaking-discussion-set-items" id="' + itemsId + '"' + (expanded ? '' : ' hidden') + '>' + group.discussions.map(listCard).join('') + '</div></section>';
    }
    function syncDiscussionSidebarSelection() {
        list.querySelectorAll('.speaking-discussion-set-group').forEach(function (group) { group.classList.remove('has-current'); });
        list.querySelectorAll('[data-discussion-id]').forEach(function (button) {
            var current = String(button.getAttribute('data-discussion-id') || '') === String(selectedId || '');
            button.classList.toggle('is-current', current);
            if (current) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
            if (!current) return;
            var group = button.closest('.speaking-discussion-set-group');
            if (!group) return;
            group.classList.add('has-current');
            var toggle = group.querySelector('[data-discussion-set-toggle]');
            var items = toggle && document.getElementById(toggle.getAttribute('aria-controls'));
            if (toggle) {
                toggle.setAttribute('aria-expanded', 'true');
                expandedDiscussionSetIds[toggle.getAttribute('data-discussion-set-key')] = true;
            }
            if (items) items.hidden = false;
        });
    }
    function renderList(items) {
        updateSidebarUpdates(items);
        if (!items.length) { list.innerHTML = '<div class="speaking-detail-card speaking-empty-state"><div class="speaking-empty-icon" aria-hidden="true">◎</div><h2>Start your first Discussion</h2><p>Add the DSE task and record when the group is ready. Candidates and invitations are created from the audio.</p></div>'; return; }
        list.innerHTML = groupDiscussionsBySet(items).map(discussionSetGroup).join('');
        list.querySelectorAll('[data-discussion-set-toggle]').forEach(function (button) {
            button.addEventListener('click', function () {
                var items = document.getElementById(button.getAttribute('aria-controls'));
                if (!items) return;
                var expanded = button.getAttribute('aria-expanded') === 'true';
                button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                items.hidden = expanded;
                expandedDiscussionSetIds[button.getAttribute('data-discussion-set-key')] = !expanded;
            });
        });
        list.querySelectorAll('[data-discussion-id]').forEach(function (button) {
            button.addEventListener('click', function () { if (!allowRecordingNavigation()) return; selectedId = button.getAttribute('data-discussion-id'); syncDiscussionSidebarSelection(); setSidebarMode('part-a'); closeSidebar(); openDiscussion(selectedId); });
        });
        syncDiscussionSidebarSelection();
    }
    function speakingSetLabel(set) {
        return set.display_label || [String(set.exam_year || '') + ' ' + String(set.source_kind || 'mock').toUpperCase(), set.paper_version ? 'Set ' + set.paper_version : '', set.title || 'Speaking Set'].filter(Boolean).join(' · ');
    }
    function speakingSetMetaLabel(set) {
        var source = String(set.source_kind || 'mock').toLowerCase() === 'pp' ? 'Past Paper' : 'Mock';
        return [String(set.exam_year || '') + ' ' + source, set.paper_version ? 'Set ' + set.paper_version : ''].filter(Boolean).join(' · ');
    }
    function renderSpeakingSetResults() {
        var target = document.getElementById('speaking-set-list');
        if (!target) return;
        var query = String(document.getElementById('speaking-set-search').value || '').trim().toLowerCase();
        var year = document.getElementById('speaking-set-year-filter').value;
        var source = document.getElementById('speaking-set-source-filter').value;
        var filtered = speakingSets.filter(function (set) {
            var haystack = [set.exam_year, set.paper_version, set.title, set.display_label].join(' ').toLowerCase();
            return (!query || haystack.indexOf(query) !== -1) && (!year || String(set.exam_year) === year) && (!source || String(set.source_kind) === source);
        });
        var visible = filtered.slice(0, speakingSetRenderLimit);
        if (!visible.length) { target.innerHTML = '<p class="speaking-set-empty">No Speaking Sets match these filters.</p>'; }
        else target.innerHTML = visible.map(function (set) {
            return '<button class="speaking-set-card" type="button" data-speaking-set-id="' + esc(set.set_id) + '"><span class="speaking-set-card-leading"><strong>' + esc(set.exam_year || 'DSE') + '</strong><small>' + esc(String(set.source_kind || 'mock').toUpperCase()) + '</small></span><span class="speaking-set-card-copy"><span class="speaking-set-card-meta">' + esc(set.paper_version ? 'Set ' + set.paper_version : 'Speaking Set') + '</span><h3>' + esc(set.title || 'Speaking Set') + '</h3></span><span class="speaking-set-card-arrow" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m7.5 4.5 5 5.5-5 5.5"/></svg></span></button>';
        }).join('');
        target.querySelectorAll('[data-speaking-set-id]').forEach(function (button) {
            button.addEventListener('click', function () { if (allowRecordingNavigation()) openSpeakingSet(button.getAttribute('data-speaking-set-id')); });
        });
        var more = document.getElementById('speaking-set-more');
        more.hidden = visible.length >= filtered.length;
        more.textContent = 'Show more · ' + String(filtered.length - visible.length) + ' remaining';
    }
    function renderSpeakingSetCards(items) {
        speakingSets = Array.isArray(items) ? items.slice() : [];
        speakingSetRenderLimit = 48;
        var yearInput = document.getElementById('speaking-set-year-filter');
        var selectedYear = yearInput.value;
        var years = Array.from(new Set(speakingSets.map(function (set) { return String(set.exam_year || ''); }).filter(Boolean))).sort(function (a, b) { return Number(b) - Number(a); });
        yearInput.innerHTML = '<option value="">All years</option>' + years.map(function (value) { return '<option value="' + esc(value) + '">' + esc(value) + '</option>'; }).join('');
        if (years.indexOf(selectedYear) !== -1) yearInput.value = selectedYear;
        renderSpeakingSetResults();
    }
    function loadSpeakingSets() {
        return call('listSpeakingSets').then(function (result) { renderSpeakingSetCards(result.sets || []); return result; }).catch(function (error) {
            var target = document.getElementById('speaking-set-list');
            if (target) target.innerHTML = '<p class="speaking-set-empty">' + esc(friendlyError(error)) + '</p>';
            throw error;
        });
    }
    function individualResponseState(response) {
        if (response.analysis_status === 'ready') return { label: 'Report ready', tone: 'ready' };
        if (response.analysis_status === 'failed') return { label: 'Retry analysis', tone: 'attention' };
        if (response.recording_status === 'uploaded') return { label: 'Analysis in progress', tone: 'working' };
        return { label: 'Not recorded', tone: 'quiet' };
    }
    function individualResponseSetMeta(response) {
        var snapshot = response.set_snapshot || {};
        var source = String(snapshot.source_kind || '').toLowerCase() === 'pp' ? 'Past Paper' : String(snapshot.source_kind || '').toLowerCase() === 'mock' ? 'Mock' : '';
        var yearAndSource = [snapshot.exam_year || '', source].filter(Boolean).join(' ');
        return [yearAndSource, snapshot.paper_version ? 'Set ' + snapshot.paper_version : ''].filter(Boolean).join(' · ') || 'DSE Paper 4';
    }
    function groupIndividualResponsesBySet(items) {
        var groups = [];
        var groupsById = Object.create(null);
        (Array.isArray(items) ? items : []).forEach(function (response, index) {
            var snapshot = response.set_snapshot || {};
            var key = String(response.set_id || snapshot.display_label || snapshot.title || 'response-' + index);
            if (!groupsById[key]) {
                groupsById[key] = {
                    set_id: response.set_id || '',
                    meta: individualResponseSetMeta(response),
                    title: snapshot.title || 'Individual Response Set',
                    responses: []
                };
                groups.push(groupsById[key]);
            }
            groupsById[key].responses.push(response);
        });
        return groups;
    }
    function individualResponseRow(response) {
        var question = response.question_snapshot || {};
        var state = individualResponseState(response);
        var questionNumber = question.order || '—';
        var questionText = question.text || 'Individual Response question';
        var date = formatDate(response.response_date || response.created_at);
        return '<button class="speaking-response-row" type="button" data-response-id="' + esc(response.response_session_id) + '" aria-label="Question ' + esc(questionNumber) + '. ' + esc(state.label) + '. ' + esc(questionText) + '">' +
            '<span class="speaking-response-row-number" aria-hidden="true">Q' + esc(questionNumber) + '</span>' +
            '<span class="speaking-response-row-copy"><strong>' + esc(questionText) + '</strong><small><i data-tone="' + esc(state.tone) + '" aria-hidden="true"></i>' + esc(date) + ' · ' + esc(state.label) + '</small></span>' +
            '<svg class="speaking-response-row-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>';
    }
    function individualResponseSetGroup(group, index) {
        var count = group.responses.length;
        var itemsId = 'speaking-response-set-items-' + String(index + 1);
        return '<section class="speaking-response-set-group" data-response-set-id="' + esc(group.set_id) + '">' +
            '<button class="speaking-response-set-header" type="button" data-response-set-toggle aria-expanded="false" aria-controls="' + itemsId + '"><span class="speaking-response-set-copy"><small>' + esc(group.meta) + '</small><strong>' + esc(group.title) + '</strong></span><span class="speaking-response-set-summary"><span class="speaking-response-set-count">' + esc(count) + ' ' + (count === 1 ? 'response' : 'responses') + '</span><svg class="speaking-response-set-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg></span></button>' +
            '<div class="speaking-response-set-items" id="' + itemsId + '" hidden>' + group.responses.map(individualResponseRow).join('') + '</div></section>';
    }
    function renderIndividualResponseList(items) {
        var target = document.getElementById('speaking-response-list');
        if (!target) return;
        var groups = groupIndividualResponsesBySet(items);
        target.innerHTML = groups.length ? groups.map(individualResponseSetGroup).join('') : '<p class="speaking-set-empty">No Individual Responses yet.</p>';
        target.querySelectorAll('[data-response-set-toggle]').forEach(function (button) {
            button.addEventListener('click', function () {
                var items = document.getElementById(button.getAttribute('aria-controls'));
                if (!items) return;
                var expanded = button.getAttribute('aria-expanded') === 'true';
                button.setAttribute('aria-expanded', expanded ? 'false' : 'true');
                items.hidden = expanded;
            });
        });
        target.querySelectorAll('[data-response-id]').forEach(function (button) { button.addEventListener('click', function () { if (!allowRecordingNavigation()) return; setSidebarMode('part-b'); closeSidebar(); selectedSpeakingSet = null; getIndividualResponseAndRender(button.getAttribute('data-response-id')); }); });
    }
    function loadIndividualResponses() {
        return call('listIndividualResponses', { page_size: 50 }).then(function (result) { renderIndividualResponseList(result.responses || []); return result; }).catch(function (error) {
            var target = document.getElementById('speaking-response-list');
            if (target) target.innerHTML = '<p class="speaking-set-empty">' + esc(friendlyError(error)) + '</p>';
            return null;
        });
    }
    function renderSpeakingSetDetail(set) {
        selectedSpeakingSet = set;
        selectedResponse = null;
        var library = document.getElementById('speaking-set-library');
        if (library) library.hidden = true;
        var main = document.getElementById('speaking-voiceprint-main');
        if (main) main.hidden = true;
        detail.hidden = false;
        document.body.classList.add('speaking-detail-open');
        var context = set.context || {};
        var partA = set.part_a || {};
        var partB = set.part_b || {};
        var setIdentity = [set.exam_year || '', set.paper_version ? 'Set ' + set.paper_version : ''].filter(Boolean).join(' · ');
        var points = (partA.discussion_points || []).map(function (point, index) { return '<li class="speaking-set-point"><span class="speaking-set-point-number">' + esc(index + 1) + '</span><span>' + esc(point.text) + '</span></li>'; }).join('');
        var questions = (partB.questions || []).map(function (question, index) { return '<li><button class="speaking-set-question" type="button" data-start-individual="' + esc(question.question_id) + '" aria-label="Open Individual Response question ' + esc(index + 1) + '"><span class="speaking-set-question-number">' + esc(index + 1) + '</span><span class="speaking-set-question-text">' + esc(question.text) + '</span><span class="speaking-set-question-disclosure" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="m7.5 4.5 5 5.5-5 5.5"/></svg></span></button></li>'; }).join('');
        detail.innerHTML = '<article class="speaking-set-detail">' +
            '<header class="speaking-set-overview-card speaking-report-card"><div class="speaking-set-overview-copy">' + (setIdentity ? '<p class="eyebrow accent">' + esc(setIdentity) + '</p>' : '') + '<h2>' + esc(set.title) + '</h2></div></header>' +
            '<section class="speaking-set-context speaking-report-card" data-speaking-reading-section="context"><header class="speaking-set-section-head speaking-set-section-head-centered speaking-set-section-head-with-controls"><p class="eyebrow accent">CONTEXT</p><h3 class="speaking-set-context-title">' + esc(context.title || '') + '</h3>' + speakingSetTextSizeMarkup('context', 'Context') + '</header><div class="speaking-set-context-body">' + (context.body || []).map(function (paragraph) { return '<p>' + esc(paragraph) + '</p>'; }).join('') + '</div></section>' +
            '<section class="speaking-set-part speaking-set-part-a speaking-report-card" data-speaking-reading-section="part-a"><header class="speaking-set-section-head speaking-set-section-head-centered speaking-set-section-head-with-controls"><p class="eyebrow accent">PART A - GROUP DISCUSSION</p>' + speakingSetTextSizeMarkup('part-a', 'Part A') + '</header>' + (partA.task ? '<p class="speaking-set-task"><strong>Task</strong><span>' + esc(partA.task) + '</span></p>' : '') + '<p class="speaking-set-instruction">' + esc(partA.instruction || 'You may want to talk about:') + '</p><ol class="speaking-set-points">' + points + '</ol><div class="speaking-detail-actions speaking-set-primary-action"><button class="primary-button" id="start-set-discussion" type="button"><span>Start Discussion</span><svg aria-hidden="true" viewBox="0 0 20 20"><path d="m7.5 4.5 5 5.5-5 5.5"/></svg></button></div></section>' +
            '<section class="speaking-set-part speaking-set-part-b speaking-report-card" data-speaking-reading-section="part-b"><header class="speaking-set-section-head speaking-set-section-head-centered speaking-set-section-head-with-controls"><p class="eyebrow accent">PART B - INDIVIDUAL RESPONSE</p>' + speakingSetTextSizeMarkup('part-b', 'Part B') + '</header><p class="speaking-set-instruction">' + esc(partB.instruction || '') + '</p><ol class="speaking-set-questions">' + questions + '</ol></section></article>';
        bindSpeakingSetTextSizeControls(detail);
        document.getElementById('start-set-discussion').addEventListener('click', function () { createDiscussionFromSet(set); });
        detail.querySelectorAll('[data-start-individual]').forEach(function (button) { button.addEventListener('click', function () { startIndividualResponse(set, button.getAttribute('data-start-individual'), button); }); });
        updateToolbar({ title: set.title, invitation: true });
    }
    function speakingSetTextSizeMarkup(section, label) {
        return '<span class="speaking-set-text-size" role="group" aria-label="' + esc(label) + ' text size"><button type="button" data-speaking-text-size="' + esc(section) + '" data-speaking-text-size-step="-1" aria-label="Make ' + esc(label) + ' text smaller">−</button><button type="button" data-speaking-text-size="' + esc(section) + '" data-speaking-text-size-step="1" aria-label="Make ' + esc(label) + ' text larger">+</button></span>';
    }
    function applySpeakingSetTextSize(section) {
        var card = detail.querySelector('[data-speaking-reading-section="' + section + '"]');
        if (!card) return;
        var size = Math.max(0, Math.min(2, Number(speakingSetReadingSizes[section] || 0)));
        speakingSetReadingSizes[section] = size;
        card.setAttribute('data-reading-size', ['small', 'medium', 'large'][size]);
        card.querySelectorAll('[data-speaking-text-size="' + section + '"]').forEach(function (button) {
            var step = Number(button.getAttribute('data-speaking-text-size-step'));
            button.disabled = (size === 0 && step < 0) || (size === 2 && step > 0);
        });
    }
    function bindSpeakingSetTextSizeControls(root) {
        ['context', 'part-a', 'part-b'].forEach(applySpeakingSetTextSize);
        root.querySelectorAll('[data-speaking-text-size]').forEach(function (button) {
            button.addEventListener('click', function () {
                var section = button.getAttribute('data-speaking-text-size');
                speakingSetReadingSizes[section] = Number(speakingSetReadingSizes[section] || 0) + Number(button.getAttribute('data-speaking-text-size-step'));
                applySpeakingSetTextSize(section);
            });
        });
    }
    function openSpeakingSet(setId) {
        return call('getSpeakingSet', { set_id: setId }).then(function (result) { renderSpeakingSetDetail(result.set); closeSidebar(); return result; }).catch(function (error) { setStatus(friendlyError(error), true); });
    }
    function returnToSpeakingSetLibrary() {
        if (!allowRecordingNavigation()) return;
        selectedSpeakingSet = null;
        selectedResponse = null;
        stopResponseHardware();
        detail.hidden = true;
        document.getElementById('speaking-set-library').hidden = false;
        document.getElementById('speaking-voiceprint-main').hidden = true;
        document.body.classList.remove('speaking-detail-open');
        updateToolbar(null);
        window.history.replaceState(null, '', 'speaking-lab.html');
    }
    function renderVoiceprintMain() {
        if (!allowRecordingNavigation()) return;
        document.getElementById('speaking-set-library').hidden = true;
        detail.hidden = true;
        var main = document.getElementById('speaking-voiceprint-main');
        main.hidden = false;
        document.body.classList.remove('speaking-detail-open');
        var active = voiceprintTarget && voiceprintTarget.voiceprint && voiceprintTarget.voiceprint.status === 'active';
        main.classList.toggle('has-voiceprint', Boolean(active));
        document.getElementById('voiceprint-consent').checked = false;
        resetVoiceprintPage();
        updateToolbar({ title: 'Voiceprint', invitation: true });
    }
    function hideSpeakingHomeCards() {
        var library = document.getElementById('speaking-set-library');
        var voiceprintMain = document.getElementById('speaking-voiceprint-main');
        if (library) library.hidden = true;
        if (voiceprintMain) voiceprintMain.hidden = true;
    }
    function participantRow(participant, item) {
        var rosterName = participant.roster_display_name || participant.display_name;
        var label = participant.kind === 'guest'
            ? rosterName + ' · Guest participant · Name not verified'
            : participant.is_self ? rosterName : participant.display_name || 'Candidate';
        var actions = '';
        if (participant.invitation_status === 'pending' && participant.is_self) {
            actions = '<button class="outline-button" type="button" data-invite-action="accept" data-participant-id="' + esc(participant.participant_id) + '">Accept</button><button class="outline-button" type="button" data-invite-action="decline" data-participant-id="' + esc(participant.participant_id) + '">Decline</button>';
        }
        if (participant.is_self && participant.matched_speaker_key && participant.identity_status !== 'disputed') {
            if (participant.requires_voice_confirmation) actions += '<span class="speaking-voice-confirmation-question">Listen to the clip. Is ' + esc(rosterName) + ' this Speaker?</span>';
            actions += '<button class="outline-button" type="button" data-playback-kind="formal_excerpt" data-participant-id="' + esc(participant.participant_id) + '">Listen to matched voice</button>';
            if (['ai_matched', 'unconfirmed', 'unmatched'].indexOf(participant.identity_status) >= 0) actions += '<button class="primary-button" type="button" data-confirm-voice="true" data-participant-id="' + esc(participant.participant_id) + '" data-speaker-key="' + esc(participant.matched_speaker_key) + '" data-mapping-revision="' + esc(participant.mapping_revision) + '">This is my voice</button>';
            actions += '<button class="outline-button" type="button" data-confirm-voice="false" data-participant-id="' + esc(participant.participant_id) + '" data-speaker-key="' + esc(participant.matched_speaker_key) + '" data-mapping-revision="' + esc(participant.mapping_revision) + '">This isn\'t my voice</button>';
        }
        if (participant.identity_status === 'voiceprint_confirmed') actions += '<span class="speaking-pill" data-tone="success">Auto-locked at 70%+</span>';
        if (participant.is_self && participant.identity_status === 'disputed') actions += '<span class="speaking-pill">Identity under teacher review</span>';
        if (item.can_edit_roster && participant.kind === 'guest') actions += '<button class="outline-button" type="button" data-rename-guest="' + esc(participant.participant_id) + '" data-current-name="' + esc(rosterName) + '">Rename</button>';
        if (item.can_edit_roster && !participant.is_self) actions += '<button class="outline-button" type="button" data-remove-participant="' + esc(participant.participant_id) + '">Remove</button>';
        var matchNote = participant.matched_speaker_key ? ' · ' + participant.matched_speaker_key.replace(/^spk_0*/, 'Speaker ') : ' · Waiting for a Speaker match';
        if (participant.voice_match_source === 'reusable_voiceprint_1_to_n' && Number.isFinite(Number(participant.voice_match_score))) matchNote += ' · ' + Math.round(Number(participant.voice_match_score)) + '% voice match';
        return '<li class="speaking-participant"><span class="speaking-participant-identity"><span class="speaking-avatar" aria-hidden="true">' + esc(initials(label)) + '</span><span><strong>' + esc(label) + '</strong><small>' + esc(readableStatus(participant.invitation_status || 'accepted') + matchNote) + '</small></span></span><span class="speaking-participant-actions">' + actions + '</span></li>';
    }
    function detectedCandidateMarkup(candidate) {
        var matched = candidate.proposed_name;
        var confirmed = ['voiceprint_confirmed', 'student_confirmed', 'teacher_confirmed'].indexOf(candidate.identity_status) >= 0;
        var displayLabel = confirmed && matched ? matched : candidate.speaker_label || 'Speaker';
        var statusText = confirmed && matched ? 'Identity confirmed' : 'Anonymous — no confirmed voiceprint match';
        if (candidate.identity_status === 'voiceprint_confirmed' && Number.isFinite(Number(candidate.automatic_match_score))) statusText = 'Voiceprint auto-locked · ' + Math.round(Number(candidate.automatic_match_score)) + '%';
        else if (candidate.identity_status === 'student_confirmed' || candidate.identity_status === 'teacher_confirmed') statusText = 'Confirmed';
        return '<article class="speaking-candidate-tile" data-match="' + (confirmed && matched ? 'matched' : 'anonymous') + '"><span class="speaking-candidate-orb" aria-hidden="true">' + esc(initials(displayLabel)) + '</span><div><strong>' + esc(displayLabel) + '</strong><small>' + esc(statusText) + '</small></div></article>';
    }
    function reportList(title, items) {
        if (!Array.isArray(items) || !items.length) return '';
        return '<div class="speaking-report-list"><h4>' + esc(title) + '</h4><ul>' + items.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul></div>';
    }
    function turnTime(value) {
        var seconds = Math.max(0, Math.floor(Number(value || 0) / 1000));
        return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }
    function groupConsecutiveTranscriptLines(report) {
        return (Array.isArray(report && report.transcript) ? report.transcript : []).reduce(function (groups, line) {
            var speakerIdentity = line.speaker_key ? 'key:' + String(line.speaker_key) : 'label:' + String(line.speaker_label || 'Speaker');
            var previous = groups[groups.length - 1];
            var textValue = String(line.text || '').trim();
            if (previous && previous.speaker_identity === speakerIdentity) {
                previous.end_ms = Math.max(Number(previous.end_ms || 0), Number(line.end_ms || 0));
                if (textValue) previous.text = [previous.text, textValue].filter(Boolean).join(' ');
                return groups;
            }
            groups.push({
                speaker_identity: speakerIdentity,
                speaker_key: line.speaker_key || '',
                speaker_label: line.speaker_label || 'Speaker',
                start_ms: Number(line.start_ms || 0),
                end_ms: Number(line.end_ms || 0),
                text: textValue
            });
            return groups;
        }, []);
    }
    function transcriptLinesMarkup(report, ownSpeakerKey, selectedReview) {
        var selectedStart = Number(selectedReview && selectedReview.start_ms);
        var selectedEnd = Number(selectedReview && selectedReview.end_ms);
        return groupConsecutiveTranscriptLines(report).map(function (line) {
            var isSelf = ownSpeakerKey && String(line.speaker_key) === String(ownSpeakerKey);
            var isCurrent = isSelf && Number.isFinite(selectedStart) && Number.isFinite(selectedEnd) && Number(line.end_ms || 0) >= selectedStart && Number(line.start_ms || 0) <= selectedEnd;
            return '<article class="speaking-transcript-line' + (isSelf ? ' is-self' : '') + (isCurrent ? ' is-current' : '') + '"><header><strong>' + esc(line.speaker_label || 'Speaker') + '</strong><small>' + esc(turnTime(line.start_ms)) + '–' + esc(turnTime(line.end_ms)) + '</small></header><p>' + esc(line.text || '') + '</p></article>';
        }).join('');
    }
    function turnCoachingDetailsMarkup(coaching) {
        var item = coaching || {};
        var rich = item.strength_zh && item.limitation_zh && item.improvement_zh;
        if (!rich) return '<div class="speaking-turn-feedback speaking-turn-feedback-legacy"><article><span>Review</span><p>' + esc(item.commentary_zh || '') + '</p></article></div>';
        return '<div class="speaking-turn-feedback">' +
            '<article data-feedback="strength"><span>What worked</span><p>' + esc(item.strength_zh) + '</p></article>' +
            '<article data-feedback="limitation"><span>What could be stronger</span><p>' + esc(item.limitation_zh) + '</p></article>' +
            '<article data-feedback="improvement"><span>How to improve</span><p>' + esc(item.improvement_zh) + '</p></article>' +
            '</div>';
    }
    function turnReviewPanelMarkup(candidate, report, index) {
        var reviews = Array.isArray(candidate && candidate.turn_reviews) ? candidate.turn_reviews : [];
        var review = reviews[index] || reviews[0];
        if (!review) return '';
        var cs = review.communication_strategies || {};
        var io = review.ideas_organisation || {};
        var caution = review.asr_text_status === 'higher_confidence' ? '' : '<span class="speaking-turn-caution">AI transcript may contain recognition errors</span>';
        return '<div class="speaking-turn-panel-heading"><div><span class="speaking-turn-number">Turn ' + esc(index + 1) + '</span><span class="speaking-turn-time">' + esc(turnTime(review.start_ms)) + '–' + esc(turnTime(review.end_ms)) + '</span></div>' + caution + '</div>' +
            '<div class="speaking-turn-context" tabindex="0" aria-label="Full Discussion context for Turn ' + esc(index + 1) + '"><div class="speaking-transcript-lines">' + transcriptLinesMarkup(report, candidate.speaker_key, review) + '</div></div>' +
            '<div class="speaking-turn-coaching"><section data-domain="cs"><p class="speaking-turn-domain">CS · Communication Strategies</p>' + turnCoachingDetailsMarkup(cs) + '<div class="speaking-turn-sample"><span>Try saying</span><q>' + esc(cs.sample_en || '') + '</q></div></section><section data-domain="io"><p class="speaking-turn-domain">IO · Ideas &amp; Organisation</p>' + turnCoachingDetailsMarkup(io) + '<div class="speaking-turn-sample"><span>Try saying</span><q>' + esc(io.sample_en || '') + '</q></div></section></div>';
    }
    function candidateControls(item) {
        var candidateTiles = (item.candidates || []).map(detectedCandidateMarkup).join('');
        var candidateIntro = candidateTiles ? '<div class="speaking-candidate-grid">' + candidateTiles + '</div>' : '<div class="speaking-candidate-empty"><span aria-hidden="true">◎</span><p><strong>Candidates appear after transcription.</strong><br>Reusable voiceprints are checked automatically; unclear matches remain Speaker 1, Speaker 2, and so on.</p></div>';
        var participantRows = (item.participants || []).map(function (participant) { return participantRow(participant, item); }).join('');
        var candidatePill = Number.isInteger(item.candidate_count) ? item.candidate_count + ' detected' : 'Waiting for audio';
        var voiceSearchWorking = ['queued', 'processing'].indexOf(item.voice_match_status) >= 0;
        var voiceSearchButton = item.can_search_voice_matches ? '<button class="outline-button speaking-voice-search' + (voiceSearchWorking ? ' is-searching' : '') + '" type="button" id="search-voice-matches"' + (voiceSearchWorking ? ' disabled aria-busy="true"' : '') + '><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5"></circle><path d="m15 15 4.25 4.25M7.5 10.5h1.3l1.1-2.2 1.6 4.4 1.2-2.2h.8"></path></svg><span>' + (voiceSearchWorking ? 'Searching voices…' : 'Search voice matches') + '</span></button>' : '';
        var voiceSearchNote = '';
        if (voiceSearchWorking) voiceSearchNote = 'Checking the Candidate clips against currently registered voiceprints.';
        else if (item.voice_match_status === 'failed') voiceSearchNote = 'The last voice search could not finish. You can try again.';
        else if (item.voice_match_last_run_at && item.voice_match_safe_error_code) voiceSearchNote = 'Search completed, but automatic matching was temporarily unavailable.';
        else if (item.voice_match_last_run_at && Number(item.voice_match_last_changed_count || 0) > 0) voiceSearchNote = Number(item.voice_match_last_changed_count) + ' voice match update' + (Number(item.voice_match_last_changed_count) === 1 ? '' : 's') + ' found. Matches at 70% or above are locked automatically; lower scores require the student to listen and confirm.';
        else if (item.voice_match_last_run_at) voiceSearchNote = 'Search complete. No new reliable voice matches were found.';
        return {
            candidateIntro: candidateIntro,
            candidatePill: candidatePill,
            voiceSearchButton: voiceSearchButton,
            voiceSearchNote: voiceSearchNote,
            identityAccess: participantRows ? '<div class="speaking-identity-access"><h4>Identity &amp; access</h4><ul class="speaking-participants">' + participantRows + '</ul></div>' : '',
            rosterEditor: ''
        };
    }
    function reportDuration(item, report) {
        var transcript = report && Array.isArray(report.transcript) ? report.transcript : [];
        var lastEnd = transcript.reduce(function (maximum, line) { return Math.max(maximum, Number(line.end_ms || 0)); }, 0);
        var seconds = lastEnd > 0 ? Math.round(lastEnd / 1000) : Number(item.duration_seconds || 0);
        if (!seconds) return 'Pending';
        return String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
    }
    function reportInfoCardMarkup(item, report) {
        var candidateCount = Number.isInteger(item.candidate_count) ? item.candidate_count : (report.candidates || []).length;
        return '<section class="speaking-report-card speaking-report-info-card" aria-label="Session details"><p class="eyebrow accent speaking-report-info-title">SESSION DETAILS</p><div class="speaking-report-ledger">' +
            '<div class="speaking-report-ledger-row"><span class="speaking-report-ledger-label">Date</span><span class="speaking-report-ledger-value">' + esc(formatDate(item.discussion_date)) + '</span></div>' +
            '<div class="speaking-report-ledger-row"><span class="speaking-report-ledger-label">Duration</span><span class="speaking-report-ledger-value">' + esc(reportDuration(item, report)) + '</span></div>' +
            '<button class="speaking-report-ledger-row" type="button" id="view-discussion-candidates"><span class="speaking-report-ledger-label">Candidates</span><span class="speaking-report-ledger-value">' + esc(candidateCount) + '</span></button>' +
            '<button class="speaking-report-ledger-row" type="button" id="view-discussion-prompt"><span class="speaking-report-ledger-label">Task</span><span class="speaking-report-ledger-value">' + esc(item.title || 'Discussion Task') + '</span></button>' +
            '<button class="speaking-report-ledger-row" type="button" id="view-discussion-transcriptions"><span class="speaking-report-ledger-label">Transcriptions</span><span class="speaking-report-ledger-value">View complete script</span></button>' +
            '</div></section>';
    }
    function dimensionCoachingMarkup(own, key, domain) {
        var hasDimensionFeedback = ['strengths', 'priority_actions', 'language_suggestions'].some(function (field) { return Array.isArray(domain && domain[field]) && domain[field].length; });
        if (hasDimensionFeedback) return '<div class="speaking-coaching-grid">' + reportList('Strengths', domain.strengths) + reportList('Priority actions', domain.priority_actions) + reportList('Language suggestions', domain.language_suggestions) + '</div>';
        var legacy = key === 'communication_strategies' ? reportList('Earlier report strengths', own.strengths)
            : key === 'ideas_organisation' ? reportList('Earlier report priorities', own.priority_actions)
                : key === 'vocabulary_language_patterns' ? reportList('Earlier language suggestions', own.language_suggestions) : '';
        return legacy ? '<div class="speaking-coaching-grid speaking-coaching-grid-legacy">' + legacy + '</div>' : '';
    }
    function domainPanelMarkup(own, key, shortLabel, fullLabel, selected) {
        if (key === 'pronunciation_delivery') return '<section class="speaking-domain-panel speaking-domain-panel-pd" id="speaking-domain-panel-pd" role="tabpanel" aria-labelledby="speaking-domain-tab-pd"' + (selected ? '' : ' hidden') + '><div class="speaking-domain-score"><span><b>PD</b>Pronunciation &amp; Delivery</span><strong>—</strong></div><p>Pronunciation &amp; Delivery is not assessed in this version of Speaking Lab.</p></section>';
        var domain = own.domains && own.domains[key] || {};
        var score = Number.isFinite(Number(domain.score)) ? Math.max(0, Math.min(7, Number(domain.score))) : 0;
        var id = shortLabel.toLowerCase();
        return '<section class="speaking-domain-panel" id="speaking-domain-panel-' + esc(id) + '" role="tabpanel" aria-labelledby="speaking-domain-tab-' + esc(id) + '"' + (selected ? '' : ' hidden') + '><div class="speaking-domain-score" style="--score:' + esc(score) + '"><span><b>' + esc(shortLabel) + '</b>' + esc(fullLabel) + '</span><strong>' + esc(score) + '<small>/7</small></strong></div><p class="speaking-domain-commentary">' + esc(domain.commentary_zh || 'No commentary is available for this dimension.') + '</p>' + dimensionCoachingMarkup(own, key, domain) + '</section>';
    }
    function personalAnalysisCardMarkup(report) {
        var own = (report.candidates || []).find(function (candidate) { return candidate.is_self; });
        if (!own) return '<section class="speaking-report-card speaking-personal-analysis"><header class="speaking-report-card-header"><div><p class="eyebrow accent">YOUR ANALYSIS</p><h2>Individual performance</h2></div></header><div class="speaking-report-empty"><span aria-hidden="true">◎</span><div><strong>Your voice is not connected to a Candidate yet.</strong><p>Use Candidate matching above. Your personal scores and coaching will appear only after your Speaker identity is confirmed.</p></div></div></section>';
        var domainTabs = [['cs', 'CS', 'communication_strategies'], ['io', 'IO', 'ideas_organisation'], ['vl', 'VL', 'vocabulary_language_patterns'], ['pd', 'PD', 'pronunciation_delivery']].map(function (row, index) {
            var domain = own.domains && own.domains[row[2]] || {};
            var score = row[0] === 'pd' ? '—' : Number.isFinite(Number(domain.score)) ? Math.max(0, Math.min(7, Number(domain.score))) : '—';
            return '<button class="speaking-report-tab' + (index === 0 ? ' is-active' : '') + '" id="speaking-domain-tab-' + row[0] + '" type="button" role="tab" aria-selected="' + (index === 0 ? 'true' : 'false') + '" aria-controls="speaking-domain-panel-' + row[0] + '" data-report-domain="' + row[0] + '"><span>' + row[1] + '</span><small>' + esc(score) + '</small></button>';
        }).join('');
        var panels = domainPanelMarkup(own, 'communication_strategies', 'CS', 'Communication Strategies', true) + domainPanelMarkup(own, 'ideas_organisation', 'IO', 'Ideas & Organisation', false) + domainPanelMarkup(own, 'vocabulary_language_patterns', 'VL', 'Vocabulary & Language Pattern', false) + domainPanelMarkup(own, 'pronunciation_delivery', 'PD', 'Pronunciation & Delivery', false);
        return '<section class="speaking-report-card speaking-personal-analysis"><header class="speaking-report-card-header speaking-personal-header"><span class="speaking-avatar" aria-hidden="true">' + esc(initials(own.speaker_label || 'You')) + '</span><div><p class="eyebrow accent">YOUR ANALYSIS</p><h2>' + esc(own.speaker_label || 'Your performance') + '</h2><p>' + esc(own.summary_zh || '') + '</p></div></header><div class="speaking-report-sticky speaking-domain-tabs" role="tablist" aria-label="Analysis dimension">' + domainTabs + '</div><div class="speaking-domain-panels">' + panels + '</div></section>';
    }
    function turnAdviceCardMarkup(report) {
        var own = (report.candidates || []).find(function (candidate) { return candidate.is_self; });
        var reviews = Array.isArray(own && own.turn_reviews) ? own.turn_reviews : [];
        var tabs = reviews.map(function (_review, index) { return '<button class="speaking-turn-tab' + (index === 0 ? ' is-active' : '') + '" type="button" role="tab" aria-selected="' + (index === 0 ? 'true' : 'false') + '" aria-controls="speaking-turn-review-panel" data-turn-index="' + index + '">Turn ' + (index + 1) + '</button>'; }).join('');
        var body = reviews.length ? '<div class="speaking-report-sticky speaking-turn-tabs" role="tablist" aria-label="Turn review">' + tabs + '</div><div class="speaking-turn-review-panel" id="speaking-turn-review-panel" role="tabpanel">' + turnReviewPanelMarkup(own, report, 0) + '</div>' : '<div class="speaking-report-empty"><span aria-hidden="true">◎</span><div><strong>No personal turns are connected yet.</strong><p>Once your Speaker identity is confirmed, this card will show advice for each of your turns.</p></div></div>';
        return '<section class="speaking-report-card speaking-turn-advice-card"><header class="speaking-report-card-header"><div><p class="eyebrow accent">TURN-BY-TURN REVIEW</p><h2>What you could say next time</h2><p>Replay the thinking behind every turn with a stronger CS or IO choice.</p></div><span class="speaking-pill">' + esc(reviews.length) + ' turn' + (reviews.length === 1 ? '' : 's') + '</span></header>' + body + '</section>';
    }
    function reportReadyMarkup(item) {
        var report = item.report;
        return '<article class="speaking-detail-card speaking-report-phase"><div class="speaking-report-layout">' + reportInfoCardMarkup(item, report) + personalAnalysisCardMarkup(report) + turnAdviceCardMarkup(report) + '</div></article>';
    }
    function reportProcessingMarkup(item) {
        var controls = candidateControls(item);
        var working = ['queued', 'processing'].indexOf(item.analysis_status) >= 0;
        var failed = item.analysis_status === 'failed';
        var stageTitle = item.analysis_status === 'queued' ? 'Your report is in the queue' : item.analysis_status === 'processing' ? 'AI is building your report' : failed ? 'The report needs another try' : 'Your recording is ready for analysis';
        var stageCopy = item.analysis_status === 'queued' ? 'The recording is secure. Speaking Lab will begin transcription as soon as the analysis worker is available.' : item.analysis_status === 'processing' ? 'Speaking Lab is transcribing the Discussion, detecting Candidates, checking voiceprints, and preparing personal coaching.' : failed ? 'Your recording is still here. Retry the analysis without uploading it again.' : 'Start the analysis to create the DSE report.';
        var action = working ? '<span class="speaking-pill speaking-stage" aria-live="polite">' + esc(item.analysis_status === 'queued' ? 'Waiting for analysis worker' : 'Transcribing · matching · coaching') + '</span>' : '<button class="primary-button" type="button" id="start-analysis">' + (failed ? 'Retry analysis' : 'Analyse Discussion') + '</button>';
        return '<article class="speaking-detail-card speaking-report-phase speaking-report-processing"><div class="speaking-report-nav"><span class="speaking-pill" data-tone="working">Report in progress</span></div><div class="speaking-report-layout"><section class="speaking-report-card speaking-report-progress-card"><span class="speaking-upload-spinner" aria-hidden="true"></span><p class="eyebrow accent">REPORT PROGRESS</p><h2>' + esc(stageTitle) + '</h2><p>' + esc(stageCopy) + '</p><ol class="speaking-report-stages"><li class="is-done"><span>1</span><strong>Recording uploaded</strong></li><li class="' + (working ? 'is-current' : '') + '"><span>2</span><strong>Transcript &amp; Candidates</strong></li><li class="' + (item.analysis_status === 'processing' ? 'is-current' : '') + '"><span>3</span><strong>Voice matching</strong></li><li><span>4</span><strong>Personal report</strong></li></ol><div class="speaking-detail-actions">' + action + '<button class="outline-button" type="button" id="view-discussion-prompt">View Set task</button></div></section><section class="speaking-report-card speaking-processing-candidates"><header class="speaking-report-card-header"><div><p class="eyebrow accent">CANDIDATE MATCHING</p><h2>Candidates</h2><p>Confirmed voiceprints are named automatically. Unclear or unmatched voices stay anonymous.</p></div><div class="speaking-report-card-actions">' + controls.voiceSearchButton + '<span class="speaking-pill">' + esc(controls.candidatePill) + '</span></div></header>' + (controls.voiceSearchNote ? '<p class="speaking-voice-search-note" role="status">' + esc(controls.voiceSearchNote) + '</p>' : '') + controls.candidateIntro + controls.identityAccess + '</section></div></article>';
    }
    function detailMarkup(item) {
        if (item.recording_status === 'uploaded') return item.analysis_status === 'ready' && item.report ? reportReadyMarkup(item) : reportProcessingMarkup(item);
        var canRecord = item.recording_status !== 'uploaded';
        var targetMinutes = Math.max(3, Math.min(30, Number(item.duration_seconds || 480) / 60));
        var recording = canRecord ? '<section class="speaking-section-card speaking-recording-card" data-recording-state="idle"><header><div><h3>Record the Discussion</h3><p>Record here or choose one audio file. Nothing is uploaded until you confirm.</p></div><span class="speaking-pill" id="recording-target-pill">Target ' + esc(targetMinutes % 1 ? targetMinutes.toFixed(1) : targetMinutes) + ' min</span></header>' +
            '<div class="speaking-recording-state" id="recording-ready"><div class="speaking-recording-settings"><label>Target length<div class="speaking-duration-field"><input id="recording-duration" type="number" min="3" max="30" step="0.5" value="' + esc(targetMinutes) + '" inputmode="decimal"><span>minutes</span></div></label></div><div class="speaking-recording-choice"><button class="primary-button" type="button" id="record-now">Record on this device</button><label class="outline-button speaking-file-button" id="audio-file-label">Choose audio file<input type="file" accept="audio/*" hidden id="audio-file"></label><label class="speaking-audio-date"><span>Audio date</span><input id="recording-date" type="date" value="' + esc(item.discussion_date || shanghaiToday()) + '"></label></div><p class="speaking-recording-note">Device recordings use today. For an existing audio file, choose the date it was recorded.</p><p class="speaking-quality-warning" id="recording-message" role="status" aria-live="polite"></p></div>' +
            '<div class="speaking-recording-state speaking-recording-live" id="recording-live" data-level="listening" data-recording-state="idle" hidden><div class="speaking-recording-live-content"><div class="speaking-recording-live-label"><span aria-hidden="true"></span><strong id="recording-live-status">Recording</strong></div><div class="speaking-recording-countdown" id="recording-countdown" aria-live="assertive" hidden>5</div><div class="speaking-recording-waveform" id="recording-waveform" aria-hidden="true">' + Array.from({ length: 36 }, function (_value, index) { return '<i class="speaking-recording-wave-bar" style="--wave-index:' + index + '"></i>'; }).join('') + '</div><div class="speaking-recording-level" id="recording-level-indicator"><span class="speaking-recording-level-icon" aria-hidden="true"></span><strong id="recording-level-label" role="status" aria-live="polite">Listening for the group…</strong></div><div class="speaking-recording-time" id="recording-time">00:00 / ' + esc(String(Math.floor((Number(item.duration_seconds || 480) + 5) / 60)).padStart(2, '0') + ':' + String((Number(item.duration_seconds || 480) + 5) % 60).padStart(2, '0')) + '</div><p class="speaking-quality-warning" id="quality-warning" role="status" aria-live="polite">Keep this page open and the screen awake.</p><button class="danger-button speaking-finish-recording" type="button" id="stop-recording">Finish recording</button></div></div>' +
            '<div class="speaking-recording-state speaking-recording-review" id="recording-review" hidden><div class="speaking-recording-ready-mark" aria-hidden="true">✓</div><h4>Recording ready</h4><p id="recording-review-copy">Listen once if you want to check it, then upload and start the analysis.</p><div class="speaking-detail-actions"><button class="outline-button" type="button" id="preview-recording">Play recording</button><button class="outline-button" type="button" id="replace-recording">Replace recording</button><button class="primary-button" type="button" id="upload-recording">Upload &amp; analyse</button></div></div>' +
            '<div class="speaking-recording-state speaking-recording-uploading" id="recording-uploading" hidden aria-live="polite" aria-busy="true"><span class="speaking-upload-spinner" aria-hidden="true"></span><h4>Uploading securely</h4><p>Keep this page open. Analysis will begin automatically.</p><div class="speaking-upload-progress-track" role="progressbar" aria-label="Secure upload in progress"><span></span></div></div></section>' : '';
        return '<article class="speaking-session-setup"><section class="speaking-report-card speaking-session-progress-card">' + workflowMarkup(item) + '</section>' + recording + '</article>';
    }
    function bindReportInteractions(root) {
        var report = currentDiscussion && currentDiscussion.report;
        root.querySelectorAll('[data-report-domain]').forEach(function (button) {
            button.addEventListener('click', function () {
                var target = button.getAttribute('aria-controls');
                root.querySelectorAll('[data-report-domain]').forEach(function (tab) { var active = tab === button; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', active ? 'true' : 'false'); });
                root.querySelectorAll('.speaking-domain-panel').forEach(function (panel) { panel.hidden = panel.id !== target; });
            });
        });
        var own = report && (report.candidates || []).find(function (candidate) { return candidate.is_self; });
        var turnPanel = root.querySelector('#speaking-turn-review-panel');
        root.querySelectorAll('[data-turn-index]').forEach(function (button) {
            button.addEventListener('click', function () {
                var index = Number(button.getAttribute('data-turn-index')) || 0;
                root.querySelectorAll('[data-turn-index]').forEach(function (tab) { var active = tab === button; tab.classList.toggle('is-active', active); tab.setAttribute('aria-selected', active ? 'true' : 'false'); });
                if (!turnPanel || !own || !report) return;
                turnPanel.innerHTML = turnReviewPanelMarkup(own, report, index);
                window.requestAnimationFrame(function () {
                    var context = turnPanel.querySelector('.speaking-turn-context');
                    var current = context && context.querySelector('.speaking-transcript-line.is-current');
                    if (context && current) context.scrollTop = Math.max(0, current.offsetTop - (context.clientHeight - current.offsetHeight) / 2);
                });
            });
        });
    }
    function bindInvitationActions(root) {
        root = root || detail;
        function refreshDiscussion() {
            if (root === candidateDialogContent && candidateDialog.open && candidateDialog.close) candidateDialog.close();
            return openDiscussion(selectedId);
        }
        var viewPrompt = root.querySelector('#view-discussion-prompt');
        if (viewPrompt) viewPrompt.addEventListener('click', openPromptDialog);
        var viewCandidates = root.querySelector('#view-discussion-candidates');
        if (viewCandidates) viewCandidates.addEventListener('click', openCandidateDialog);
        var viewTranscriptions = root.querySelector('#view-discussion-transcriptions');
        if (viewTranscriptions) viewTranscriptions.addEventListener('click', openTranscriptionDialog);
        var candidateClose = root.querySelector('#discussion-candidate-close');
        if (candidateClose) candidateClose.addEventListener('click', function () { if (candidateDialog.open && candidateDialog.close) candidateDialog.close(); else candidateDialog.removeAttribute('open'); });
        var voiceSearch = root.querySelector('#search-voice-matches');
        if (voiceSearch) voiceSearch.addEventListener('click', function () {
            voiceSearch.disabled = true;
            voiceSearch.classList.add('is-searching');
            voiceSearch.setAttribute('aria-busy', 'true');
            call('startVoiceRematch', { discussion_id: selectedId, operation_id: 'voice-rematch-' + selectedId + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) })
                .then(refreshDiscussion)
                .catch(function (error) { setStatus(friendlyError(error), true); voiceSearch.disabled = false; voiceSearch.classList.remove('is-searching'); voiceSearch.removeAttribute('aria-busy'); });
        });
        root.querySelectorAll('[data-remove-participant]').forEach(function (button) { button.addEventListener('click', function () { if (!window.confirm('Remove this participant from the Discussion?')) return; button.disabled = true; call('removeParticipant', { discussion_id: selectedId, participant_id: button.getAttribute('data-remove-participant') }).then(refreshDiscussion).catch(function (error) { setStatus(friendlyError(error), true); button.disabled = false; }); }); });
        root.querySelectorAll('[data-rename-guest]').forEach(function (button) { button.addEventListener('click', function () { var name = window.prompt('Guest name', button.getAttribute('data-current-name') || ''); if (!name) return; button.disabled = true; call('renameGuest', { discussion_id: selectedId, participant_id: button.getAttribute('data-rename-guest'), guest_name: name }).then(refreshDiscussion).catch(function (error) { setStatus(friendlyError(error), true); button.disabled = false; }); }); });
        root.querySelectorAll('[data-invite-action]').forEach(function (button) {
            button.addEventListener('click', function () {
                button.disabled = true;
                call('respondInvitation', { discussion_id: selectedId, participant_id: button.getAttribute('data-participant-id'), response: button.getAttribute('data-invite-action') }).then(refreshDiscussion).catch(function (error) { setStatus(friendlyError(error), true); button.disabled = false; });
            });
        });
        root.querySelectorAll('[data-confirm-voice]').forEach(function (button) {
            button.addEventListener('click', function () {
                button.disabled = true;
                call('confirmVoice', { discussion_id: selectedId, participant_id: button.getAttribute('data-participant-id'), speaker_key: button.getAttribute('data-speaker-key'), mapping_revision: Number(button.getAttribute('data-mapping-revision')), confirmed: button.getAttribute('data-confirm-voice') === 'true' }).then(refreshDiscussion).catch(function (error) { setStatus(friendlyError(error), true); button.disabled = false; });
            });
        });
        root.querySelectorAll('[data-playback-kind]').forEach(function (button) {
            button.addEventListener('click', function () {
                button.disabled = true;
                call('getVoiceConfirmationPlayback', { discussion_id: selectedId, participant_id: button.getAttribute('data-participant-id'), playback_kind: button.getAttribute('data-playback-kind') }).then(function (result) {
                    var audio = new Audio(result.url);
                    audio.currentTime = Number(result.start_ms || 0) / 1000;
                    audio.addEventListener('timeupdate', function () { if (audio.currentTime * 1000 >= Number(result.end_ms || 0)) { audio.pause(); audio.src = ''; } });
                    return audio.play();
                }).catch(function (error) { setStatus(friendlyError(error), true); }).finally(function () { button.disabled = false; });
            });
        });
        var share = root.querySelector('#create-student-share');
        if (share) share.addEventListener('click', function () { share.disabled = true; call('createStudentShare', { discussion_id: selectedId }).then(function (result) { var container = root.querySelector('#student-share-result'); var url = new URL(result.share_url, window.location.href).href; container.innerHTML = '<p><a href="' + esc(url) + '" target="_blank" rel="noopener">Open private snapshot</a> · expires ' + esc(result.expires_at || 'in 7 days') + '</p><div class="speaking-detail-actions"><button class="outline-button" type="button" id="copy-student-share">Copy link</button><button class="outline-button" type="button" id="revoke-student-share">Revoke link</button></div>'; root.querySelector('#copy-student-share').addEventListener('click', function () { if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { setStatus('Private link copied.'); }); }); root.querySelector('#revoke-student-share').addEventListener('click', function () { call('revokeShare', { share_id: result.share_id }).then(function () { container.innerHTML = '<p>Link revoked.</p>'; }); }); }).catch(function (error) { setStatus(friendlyError(error), true); share.disabled = false; }); });
        bindReportInteractions(root);
    }
    function invitationMarkup(invitation) {
        return '<form method="dialog"><div class="speaking-dialog-head"><p class="eyebrow accent">DISCUSSION INVITATION</p><h2 id="invitation-dialog-title">' + esc(invitation.title) + '</h2><p>' + esc(formatDate(invitation.discussion_date)) + ' · Invited by ' + esc(invitation.inviter_name || 'your teacher or group') + '</p></div><ul class="speaking-participants">' + (invitation.participants || []).map(function (participant) { var name = participant.display_name || 'Participant'; return '<li class="speaking-participant"><span class="speaking-participant-identity"><span class="speaking-avatar" aria-hidden="true">' + esc(initials(name)) + '</span><span><strong>' + esc(name) + '</strong><small>' + esc(participant.kind === 'guest' ? 'Guest participant · Name not verified' : readableStatus(participant.invitation_status)) + '</small></span></span></li>'; }).join('') + '</ul><div class="speaking-dialog-actions"><button class="primary-button" type="button" id="accept-invitation">Accept</button><button class="outline-button" type="button" id="decline-invitation">Decline</button><button class="outline-button" value="cancel">Close</button></div></form>';
    }
    function elapsedText() {
        var seconds = Math.max(0, Math.floor((performance.now() - recordingStartedAt) / 1000));
        var elapsed = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
        var stopAt = recordingTargetSeconds + 5;
        var target = String(Math.floor(stopAt / 60)).padStart(2, '0') + ':' + String(stopAt % 60).padStart(2, '0');
        return elapsed + ' / ' + target;
    }
    function recordingElapsedSeconds() {
        return recordingStartedAt ? Math.max(0, (performance.now() - recordingStartedAt) / 1000) : 0;
    }
    function recordingLocksPage() {
        return ['requesting', 'countdown', 'recording', 'ending', 'stopping', 'uploading'].indexOf(recordingState) >= 0;
    }
    function recordingNeedsDiscardConfirmation() {
        return recordingState === 'recording' || recordingState === 'review';
    }
    function setRecordingMessage(message) {
        var element = document.getElementById('recording-message');
        if (element) element.textContent = message || '';
    }
    function mountRecordingLiveToViewport(live) {
        if (!live || live.parentNode === document.body) return;
        recordingLiveOrigin = {
            parent: live.parentNode,
            nextSibling: live.nextSibling
        };
        document.body.appendChild(live);
    }
    function restoreRecordingLiveFromViewport(live) {
        if (!live || live.parentNode !== document.body) {
            if (!live) recordingLiveOrigin = null;
            return;
        }
        var origin = recordingLiveOrigin;
        recordingLiveOrigin = null;
        if (!origin || !origin.parent || !origin.parent.isConnected) {
            live.remove();
            return;
        }
        if (origin.nextSibling && origin.nextSibling.parentNode === origin.parent) origin.parent.insertBefore(live, origin.nextSibling);
        else origin.parent.appendChild(live);
    }
    function setRecordingState(nextState) {
        recordingState = nextState;
        var card = document.querySelector('.speaking-recording-card');
        if (card) card.setAttribute('data-recording-state', nextState);
        var ready = document.getElementById('recording-ready');
        var live = document.getElementById('recording-live');
        var review = document.getElementById('recording-review');
        var uploading = document.getElementById('recording-uploading');
        var liveState = ['requesting', 'countdown', 'recording', 'ending', 'stopping'].indexOf(nextState) >= 0;
        if (ready) ready.hidden = nextState !== 'idle';
        if (live && liveState) mountRecordingLiveToViewport(live);
        if (live) {
            live.hidden = !liveState;
            live.setAttribute('data-recording-state', nextState);
            if (!liveState) restoreRecordingLiveFromViewport(live);
        }
        if (review) review.hidden = nextState !== 'review';
        if (uploading) uploading.hidden = nextState !== 'uploading';
        var liveStatus = document.getElementById('recording-live-status');
        if (liveStatus) liveStatus.textContent = nextState === 'requesting' ? 'Starting microphone…' : nextState === 'countdown' ? 'Get ready' : nextState === 'ending' ? 'Discussion ending' : nextState === 'stopping' ? 'Finishing recording…' : 'Recording';
        var countdown = document.getElementById('recording-countdown');
        if (countdown) countdown.hidden = ['countdown', 'ending'].indexOf(nextState) < 0;
        var liveTimer = document.getElementById('recording-time');
        if (liveTimer) liveTimer.hidden = nextState === 'countdown';
        var finish = document.getElementById('stop-recording');
        if (finish) { finish.textContent = ['requesting', 'countdown'].indexOf(nextState) >= 0 ? 'Cancel' : 'Finish recording'; finish.disabled = nextState === 'stopping'; }
        var locked = recordingLocksPage();
        document.body.classList.toggle('speaking-recording-locked', locked);
        sidebarToggle.disabled = locked;
        sidebarNew.disabled = locked;
        toolbarEdit.disabled = locked || toolbarEdit.hidden;
        var closeDiscussion = document.getElementById('close-discussion');
        if (closeDiscussion) closeDiscussion.disabled = locked;
        var recordingFlowActive = nextState !== 'idle';
        document.body.classList.toggle('speaking-recording-flow-active', recordingFlowActive);
        detail.querySelectorAll('.speaking-detail-body > *').forEach(function (section) {
            if (section.classList.contains('speaking-recording-card')) return;
            section.inert = recordingFlowActive;
            section.setAttribute('aria-disabled', recordingFlowActive ? 'true' : 'false');
        });
        var hero = detail.querySelector('.speaking-detail-hero');
        if (hero) { hero.inert = locked; hero.setAttribute('aria-disabled', locked ? 'true' : 'false'); }
    }
    function stopRecordingPreview() {
        if (recordingPreviewAudio) {
            recordingPreviewAudio.pause();
            recordingPreviewAudio.removeAttribute('src');
            recordingPreviewAudio.load();
        }
        recordingPreviewAudio = null;
        if (recordingPreviewUrl) URL.revokeObjectURL(recordingPreviewUrl);
        recordingPreviewUrl = '';
        var button = document.getElementById('preview-recording');
        if (button) button.textContent = 'Play recording';
    }
    function stopRecordingHardware() {
        if (recordingTimer) window.clearInterval(recordingTimer);
        recordingTimer = 0;
        if (recordingCountdownTimer) window.clearTimeout(recordingCountdownTimer);
        recordingCountdownTimer = 0;
        if (recordingSpeech && window.speechSynthesis) window.speechSynthesis.cancel();
        recordingSpeech = null;
        if (activeStream) activeStream.getTracks().forEach(function (track) { track.stop(); });
        activeStream = null;
        recorder = null;
        if (qualityFrame) window.cancelAnimationFrame(qualityFrame);
        qualityFrame = 0;
        if (qualityContext && qualityContext.close) qualityContext.close().catch(function () {});
        qualityContext = null;
        qualityAnalyser = null;
        qualityIssue = '';
        qualityBadSince = 0;
        qualityRecoverySince = 0;
        qualityVisualState = 'listening';
        qualityVisualCandidate = '';
        qualityVisualSince = 0;
        qualitySmoothedDbfs = -60;
        setRecordingLevelVisual('listening');
    }
    function discardLocalRecording() {
        recordingCaptureGeneration += 1;
        var activeRecorder = recorder;
        if (activeRecorder && activeRecorder.state !== 'inactive') {
            try { activeRecorder.stop(); } catch (error) {}
        }
        stopRecordingHardware();
        stopRecordingPreview();
        recordingBlob = null;
        recordingChunks = [];
        recordingUploadOperationId = '';
        recordingStartedAt = 0;
        recordingTargetNoticeShown = false;
        setRecordingState('idle');
    }
    function allowRecordingNavigation() {
        if (voiceprintSaving) {
            document.getElementById('voiceprint-message').textContent = 'Wait until the voiceprint finishes uploading.';
            return false;
        }
        if (voiceprintPressActive || voiceprintController) {
            document.getElementById('voiceprint-message').textContent = 'Release the microphone before leaving Voiceprint.';
            return false;
        }
        if (voiceprintPendingResult && !window.confirm('Discard this voiceprint recording and leave?')) return false;
        if (voiceprintPendingResult) resetVoiceprintPage();
        if (responseUploadInProgress) {
            setStatus('Please wait for the Individual Response upload to finish.', true);
            return false;
        }
        if (responseRecorder && responseRecorder.state !== 'inactive') {
            setStatus('Finish the Individual Response recording before leaving this page.', true);
            return false;
        }
        if (responseBlob && !window.confirm('Discard this Individual Response recording and leave?')) return false;
        if (responseBlob) {
            responseBlob = null;
            responseChunks = [];
            responseRecordedDurationSeconds = null;
            responseUploadOperationId = '';
        }
        if (recordingLocksPage()) {
            if (recordingState === 'uploading') setStatus('Please wait for the secure upload to finish.', true);
            return false;
        }
        if (recordingNeedsDiscardConfirmation() && !window.confirm('Discard this recording and leave this Discussion?')) return false;
        if (recordingNeedsDiscardConfirmation()) discardLocalRecording();
        return true;
    }
    function showQualityWarning(message) { var warning = document.getElementById('quality-warning'); if (warning) warning.textContent = message || ''; }
    function setRecordingLevelVisual(state) {
        var live = document.getElementById('recording-live');
        var label = document.getElementById('recording-level-label');
        var messages = {
            listening: 'Listening for the group…',
            low: 'Speak a little louder or move the device closer',
            good: 'Sound level looks good',
            high: 'A little too loud · move the device farther away',
            input: 'Microphone signal needs attention'
        };
        qualityVisualState = messages[state] ? state : 'listening';
        if (live) live.setAttribute('data-level', qualityVisualState);
        if (label) label.textContent = messages[qualityVisualState];
    }
    function updateRecordingLevelVisual(nextState, now) {
        if (recordingState !== 'recording' && recordingState !== 'ending') {
            qualityVisualCandidate = '';
            qualityVisualSince = 0;
            if (qualityVisualState !== 'listening') setRecordingLevelVisual('listening');
            return;
        }
        if (nextState === qualityVisualState) {
            qualityVisualCandidate = '';
            qualityVisualSince = 0;
            return;
        }
        if (qualityVisualCandidate !== nextState) {
            qualityVisualCandidate = nextState;
            qualityVisualSince = now;
            return;
        }
        var settleMs = nextState === 'high' || nextState === 'input' ? 350 : nextState === 'low' ? 1200 : 500;
        if (now - qualityVisualSince < settleMs) return;
        qualityVisualCandidate = '';
        qualityVisualSince = 0;
        setRecordingLevelVisual(nextState);
    }
    function playRecordingBeep(urgent) {
        if (!qualityContext || !qualityContext.createOscillator || !qualityContext.createGain) return;
        try {
            var oscillator = qualityContext.createOscillator();
            var gain = qualityContext.createGain();
            var startsAt = qualityContext.currentTime;
            oscillator.type = 'sine';
            oscillator.frequency.setValueAtTime(urgent ? 1046 : 784, startsAt);
            gain.gain.setValueAtTime(0.0001, startsAt);
            gain.gain.exponentialRampToValueAtTime(urgent ? 0.2 : 0.13, startsAt + 0.012);
            gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + 0.16);
            oscillator.connect(gain).connect(qualityContext.destination);
            oscillator.start(startsAt);
            oscillator.stop(startsAt + 0.18);
        } catch (error) {}
    }
    function speakRecordingCue(text) {
        return new Promise(function (resolve) {
            if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { resolve(); return; }
            var settled = false;
            var timeout = window.setTimeout(done, 3500);
            function done() {
                if (settled) return;
                settled = true;
                window.clearTimeout(timeout);
                recordingSpeech = null;
                resolve();
            }
            try {
                window.speechSynthesis.cancel();
                recordingSpeech = new window.SpeechSynthesisUtterance(text);
                recordingSpeech.lang = 'zh-CN';
                recordingSpeech.rate = 0.92;
                recordingSpeech.onend = done;
                recordingSpeech.onerror = done;
                window.speechSynthesis.speak(recordingSpeech);
            } catch (error) { done(); }
        });
    }
    function runOpeningCountdown(captureGeneration) {
        setRecordingState('countdown');
        showQualityWarning('讨论将在 5 秒后开始');
        return speakRecordingCue('讨论将在五秒钟后开始。').then(function () {
            return new Promise(function (resolve) {
                var remaining = 5;
                function tick() {
                    if (captureGeneration !== recordingCaptureGeneration || recordingState !== 'countdown') { resolve(false); return; }
                    var countdown = document.getElementById('recording-countdown');
                    if (countdown) countdown.textContent = String(remaining);
                    playRecordingBeep(remaining === 1);
                    if (remaining === 1) {
                        recordingCountdownTimer = window.setTimeout(function () { recordingCountdownTimer = 0; resolve(true); }, 1000);
                        return;
                    }
                    remaining -= 1;
                    recordingCountdownTimer = window.setTimeout(tick, 1000);
                }
                tick();
            });
        }).then(function (ready) {
            if (!ready || captureGeneration !== recordingCaptureGeneration || recordingState !== 'countdown') return false;
            showQualityWarning('可以开始讨论了');
            return speakRecordingCue('可以开始讨论了。').then(function () { return captureGeneration === recordingCaptureGeneration && recordingState === 'countdown'; });
        });
    }
    function updateRecordingWaveform(samples, rms) {
        var bars = document.querySelectorAll('.speaking-recording-wave-bar');
        if (!bars.length) return;
        var reducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        bars.forEach(function (bar, index) {
            var sampleIndex = Math.min(samples.length - 1, Math.floor((index + 0.5) * samples.length / bars.length));
            var input = reducedMotion ? rms * 3.2 : Math.max(Math.abs(samples[sampleIndex]) * 5.5, rms * 4.2);
            var centreWeight = 0.7 + 0.3 * Math.sin(Math.PI * (index + 1) / (bars.length + 1));
            var level = Math.max(0.1, Math.min(1, (0.1 + input) * centreWeight));
            bar.style.transform = 'scaleY(' + level.toFixed(3) + ')';
        });
    }
    function persistDiscussionDate(value) {
        var date = String(value || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return Promise.resolve(null);
        return call('updateDiscussionDate', { discussion_id: selectedId, discussion_date: date }).catch(function (error) {
            setStatus('The audio date could not be saved. ' + friendlyError(error), true);
            return null;
        });
    }
    function monitorQuality(stream) {
        var AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return;
        try {
            qualityContext = new AudioContextCtor();
            qualityAnalyser = qualityContext.createAnalyser();
            qualityAnalyser.fftSize = 2048;
            qualityContext.createMediaStreamSource(stream).connect(qualityAnalyser);
            if (qualityContext.state === 'suspended' && qualityContext.resume) qualityContext.resume().catch(function () {});
            var samples = new Float32Array(qualityAnalyser.fftSize);
            qualityReadyAt = performance.now() + 5000;
            qualityIssue = '';
            qualityBadSince = 0;
            qualityRecoverySince = 0;
            qualityVisualState = 'listening';
            qualityVisualCandidate = '';
            qualityVisualSince = 0;
            qualitySmoothedDbfs = -60;
            setRecordingLevelVisual('listening');
            function frame() {
                if (!qualityAnalyser) return;
                qualityAnalyser.getFloatTimeDomainData(samples);
                var sum = 0; var clipped = 0;
                for (var index = 0; index < samples.length; index += 1) { var value = samples[index]; sum += value * value; if (Math.abs(value) >= CLIPPING_AMPLITUDE) clipped += 1; }
                var rms = Math.sqrt(sum / samples.length);
                updateRecordingWaveform(samples, rms);
                var dbfs = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
                var now = performance.now();
                var muted = stream.getTracks().some(function (track) { return track.readyState === 'ended' || track.muted; });
                if (Number.isFinite(dbfs)) qualitySmoothedDbfs = qualitySmoothedDbfs * 0.82 + dbfs * 0.18;
                else qualitySmoothedDbfs = -60;
                var clippingRatio = clipped / samples.length;
                var visualLevel = muted || dbfs === -Infinity ? 'input' : clippingRatio >= 0.01 || qualitySmoothedDbfs > HIGH_VOLUME_DBFS ? 'high' : qualitySmoothedDbfs < LOW_VOLUME_DBFS ? 'low' : 'good';
                updateRecordingLevelVisual(visualLevel, now);
                var issue = '';
                var thresholdSeconds = 0;
                var message = '';
                if (now >= qualityReadyAt && (muted || dbfs === -Infinity)) { issue = 'input'; thresholdSeconds = INPUT_LOSS_SECONDS; message = 'Microphone signal lost. Check that the phone can still hear the group.'; }
                else if (now >= qualityReadyAt && (clippingRatio >= 0.01 || qualitySmoothedDbfs > HIGH_VOLUME_DBFS)) { issue = 'clipping'; thresholdSeconds = 1; message = 'The sound is too loud. Move the phone slightly farther away.'; }
                else if (now >= qualityReadyAt && dbfs < LOW_VOLUME_DBFS) { issue = 'low'; thresholdSeconds = 4; message = 'Move the phone closer so the group can be heard.'; }
                if (issue) {
                    qualityRecoverySince = 0;
                    if (qualityIssue !== issue) { qualityIssue = issue; qualityBadSince = now; }
                    if ((now - qualityBadSince) / 1000 >= thresholdSeconds) showQualityWarning(message);
                } else if (qualityIssue) {
                    if (!qualityRecoverySince) qualityRecoverySince = now;
                    if (now - qualityRecoverySince >= 2000) { qualityIssue = ''; qualityBadSince = 0; qualityRecoverySince = 0; showQualityWarning('Sound level looks good. Keep this page open.'); }
                }
                qualityFrame = window.requestAnimationFrame(frame);
            }
            qualityFrame = window.requestAnimationFrame(frame);
        } catch (error) { qualityContext = null; qualityAnalyser = null; }
    }
    function currentRecordingTarget() {
        var field = document.getElementById('recording-duration');
        var minutes = Math.max(3, Math.min(30, Number(field && field.value || 8)));
        if (field) field.value = minutes % 1 ? minutes.toFixed(1) : String(minutes);
        return Math.round(minutes * 60);
    }
    function persistRecordingTarget() {
        var durationSeconds = currentRecordingTarget();
        var pill = document.getElementById('recording-target-pill');
        if (pill) pill.textContent = 'Target ' + (durationSeconds / 60) + ' min';
        call('updateDiscussionDuration', { discussion_id: selectedId, duration_seconds: durationSeconds }).catch(function (error) {
            setStatus('Recording started, but the target length could not be saved. ' + friendlyError(error), true);
        });
        return durationSeconds;
    }
    function recordingStartFailure(message) {
        stopRecordingHardware();
        setRecordingState('idle');
        setRecordingMessage(message);
    }
    function startRecording() {
        if (voiceRecorder && voiceRecorder.state !== 'inactive') { showQualityWarning('Finish the current Voice Reference first.'); return; }
        if (recordingState !== 'idle') return;
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { setRecordingMessage('Recording is unavailable here. Choose an audio file instead.'); return; }
        setRecordingMessage('');
        var dateField = document.getElementById('recording-date');
        if (dateField) dateField.value = shanghaiToday();
        persistDiscussionDate(shanghaiToday());
        setRecordingState('requesting');
        showQualityWarning('Allow microphone access to begin recording.');
        var captureGeneration = ++recordingCaptureGeneration;
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            if (captureGeneration !== recordingCaptureGeneration || recordingState !== 'requesting') { stream.getTracks().forEach(function (track) { track.stop(); }); return; }
            recordingBlob = null;
            stopRecordingPreview();
            recordingUploadOperationId = '';
            recordingTargetSeconds = persistRecordingTarget();
            activeStream = stream;
            var preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(function (mime) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime); });
            try { recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined); }
            catch (error) { recordingStartFailure('This browser could not start a compatible recorder. Choose an audio file instead.'); return; }
            var activeRecorder = recorder;
            recordingChunks = [];
            activeRecorder.ondataavailable = function (event) { if (captureGeneration === recordingCaptureGeneration && event.data && event.data.size) recordingChunks.push(event.data); };
            activeRecorder.onerror = function () {
                if (captureGeneration !== recordingCaptureGeneration) return;
                recordingCaptureGeneration += 1;
                stopRecordingHardware();
                recordingBlob = null;
                recordingChunks = [];
                setRecordingState('idle');
                setRecordingMessage('The browser recorder stopped unexpectedly. Choose an audio file or try recording again.');
            };
            activeRecorder.onstop = function () {
                if (captureGeneration !== recordingCaptureGeneration) return;
                var blob = new Blob(recordingChunks, { type: activeRecorder.mimeType || 'audio/webm' });
                stopRecordingHardware();
                recordingChunks = [];
                if (!blob.size) { recordingBlob = null; setRecordingState('idle'); setRecordingMessage('No audio was captured. Check the microphone or choose an audio file.'); return; }
                recordingBlob = blob;
                recordingUploadOperationId = 'speaking-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
                setRecordingState('review');
            };
            monitorQuality(stream);
            stream.getTracks().forEach(function (track) {
                track.addEventListener('ended', function () {
                    if (captureGeneration !== recordingCaptureGeneration || recorder !== activeRecorder) return;
                    if (recordingState === 'requesting' || recordingState === 'countdown') {
                        recordingStartFailure('The microphone signal ended before recording began. Check the input or choose an audio file.');
                        return;
                    }
                    if (activeRecorder.state !== 'inactive') {
                        showQualityWarning('Microphone signal ended. Finishing the recording safely…');
                        setRecordingState('stopping');
                        activeRecorder.stop();
                    }
                });
            });
            runOpeningCountdown(captureGeneration).then(function (ready) {
                if (!ready || captureGeneration !== recordingCaptureGeneration || recorder !== activeRecorder) return;
                try { activeRecorder.start(1000); }
                catch (error) { recordingStartFailure('This browser could not begin recording. Choose an audio file instead.'); return; }
                recordingStartedAt = performance.now();
                recordingTargetNoticeShown = false;
                setRecordingState('recording');
                showQualityWarning('Discussion in progress · keep this screen awake.');
                var timer = document.getElementById('recording-time');
                if (timer) timer.textContent = elapsedText();
                recordingTimer = window.setInterval(function () {
                    if (timer) timer.textContent = elapsedText();
                    var elapsed = recordingElapsedSeconds();
                    if (elapsed >= recordingTargetSeconds) {
                        var remaining = Math.max(0, Math.ceil(recordingTargetSeconds + 5 - elapsed));
                        if (recordingState === 'recording') setRecordingState('ending');
                        var countdown = document.getElementById('recording-countdown');
                        if (countdown) countdown.textContent = String(remaining);
                        if (remaining > 0 && recordingTargetNoticeShown !== remaining) {
                            recordingTargetNoticeShown = remaining;
                            playRecordingBeep(remaining <= 2);
                            showQualityWarning('Discussion ends automatically in ' + remaining + ' second' + (remaining === 1 ? '.' : 's.'));
                        }
                        if (elapsed >= recordingTargetSeconds + 5 && recorder === activeRecorder && activeRecorder.state !== 'inactive') {
                            playRecordingBeep(true);
                            showQualityWarning('Time is up. Finishing the recording safely…');
                            setRecordingState('stopping');
                            activeRecorder.stop();
                        }
                    }
                }, 250);
            });
        }).catch(function (error) {
            if (captureGeneration !== recordingCaptureGeneration) return;
            var denied = error && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
            recordingStartFailure(denied ? 'Microphone access was not allowed. You can still choose an audio file.' : 'The microphone could not start. Check the input or choose an audio file.');
        });
    }
    function uploadBlob(blob, kind, participantId, stableOperationId) {
        if (!blob || !blob.size) return Promise.reject(new Error('Choose an audio recording first.'));
        var operationId = stableOperationId || 'speaking-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        var mime = String(blob.type || 'audio/webm').toLowerCase().split(';')[0];
        var action = kind === 'voice_reference' ? 'startVoiceReferenceUpload' : 'startAudioUpload';
        return call(action, { discussion_id: selectedId, participant_id: participantId || null, operation_id: operationId, mime_type: mime, size_bytes: blob.size }).then(function (result) {
            if (!result.upload || result.upload.upload_mode !== 'cloudbase_js_sdk' || !result.upload.cloud_path) throw new Error('Upload information is incomplete.');
            return uploadWithTimeout(api.uploadCloudFile(result.upload.cloud_path, blob)).then(function (uploaded) {
                return call(kind === 'voice_reference' ? 'finishVoiceReferenceUpload' : 'finishAudioUpload', { discussion_id: selectedId, participant_id: participantId || null, operation_id: operationId, asset_id: result.asset_id, uploaded_file_id: uploaded.file_id });
            });
        });
    }
    function responseElapsedSeconds() { return responseStartedAt ? Math.max(0, (performance.now() - responseStartedAt) / 1000) : 0; }
    function responseTimeText(seconds) { var value = Math.max(0, Math.floor(Number(seconds || 0))); var minutes = Math.floor(value / 60); var remainder = value % 60; return String(minutes).padStart(2, '0') + ':' + String(remainder).padStart(2, '0') + ' / 01:05'; }
    function stopResponseHardware() {
        if (responseTimer) window.clearInterval(responseTimer);
        responseTimer = 0;
        if (responseStream) responseStream.getTracks().forEach(function (track) { track.stop(); });
        responseStream = null;
        responseRecorder = null;
    }
    function renderIndividualResponseReport(response) {
        var report = response.report || {};
        var domains = report.domains || {};
        function scoreCard(key, label) { var domain = domains[key] || {}; return '<article class="speaking-score-card"><div class="speaking-score-head"><span><b>' + esc(label.split(' · ')[0]) + '</b>' + esc(label.split(' · ')[1] || '') + '</span><strong>' + esc(domain.score == null ? '—' : domain.score) + '<small>/7</small></strong></div><p>' + esc(domain.commentary_zh || '') + '</p></article>'; }
        return '<section class="speaking-response-report"><section class="speaking-report-card"><p class="eyebrow accent">SESSION DETAILS</p><dl class="speaking-report-ledger"><div class="speaking-report-ledger-row"><dt>Date</dt><dd>' + esc(formatDate(response.response_date)) + '</dd></div><div class="speaking-report-ledger-row"><dt>Duration</dt><dd>' + esc(response.duration_seconds ? response.duration_seconds + ' seconds' : 'Up to 65 seconds') + '</dd></div><div class="speaking-report-ledger-row"><dt>Set</dt><dd>' + esc(response.set_snapshot && response.set_snapshot.display_label || response.set_id) + '</dd></div><div class="speaking-report-ledger-row"><dt>Question</dt><dd>' + esc(response.question_snapshot && response.question_snapshot.text || '') + '</dd></div></dl></section><section class="speaking-report-card"><p class="eyebrow accent">YOUR ANALYSIS</p><div class="speaking-score-grid speaking-score-grid-four">' + scoreCard('communication_strategies', 'CS · Communication Strategies') + scoreCard('ideas_organisation', 'IO · Ideas & Organisation') + scoreCard('vocabulary_language_patterns', 'VL · Vocabulary & Language Pattern') + '<article class="speaking-score-card speaking-score-card-pd"><div class="speaking-score-head"><span><b>PD</b>Pronunciation &amp; Delivery</span><strong>—</strong></div><p>Not assessed · 暂不评论</p></article></div><p>' + esc(report.summary_zh || '') + '</p><div class="speaking-coaching-grid">' + reportList('Strengths', report.strengths) + reportList('Priority actions', report.priority_actions) + reportList('Language suggestions', report.language_suggestions) + '</div><div class="speaking-response-sample"><p class="eyebrow accent">SAMPLE IMPROVED RESPONSE</p><p>' + esc(report.sample_response_en || '') + '</p></div></section><details class="speaking-report-card speaking-transcript"><summary><strong>Complete script</strong></summary><div class="speaking-transcript-lines">' + (report.transcript || []).map(function (line) { return '<article class="speaking-transcript-line"><p>' + esc(line.text || '') + '</p></article>'; }).join('') + '</div></details></section>';
    }
    function renderIndividualResponseWorkspace(response) {
        selectedResponse = response;
        document.getElementById('speaking-set-library').hidden = true;
        document.getElementById('speaking-voiceprint-main').hidden = true;
        detail.hidden = false;
        document.body.classList.add('speaking-detail-open');
        var ready = response.recording_status === 'uploaded';
        var reportReady = response.analysis_status === 'ready' && response.report;
        var analysisFailed = response.analysis_status === 'failed';
        var question = response.question_snapshot || {};
        var stateTone = reportReady ? 'ready' : analysisFailed ? 'attention' : 'working';
        var stateLabel = reportReady ? 'Report ready' : analysisFailed ? 'Analysis needs retry' : (ready ? 'Analysis in progress' : 'Not uploaded');
        var responseBody = reportReady ? renderIndividualResponseReport(response) : analysisFailed ? '<section class="speaking-report-card speaking-response-state-card"><span class="speaking-response-state-symbol" aria-hidden="true">!</span><p class="eyebrow accent">ANALYSIS INTERRUPTED</p><h3>Your recording is still safe.</h3><p>The last analysis could not finish. Retry it without uploading the audio again.</p><div class="speaking-detail-actions"><button class="primary-button" type="button" id="response-retry-analysis">Retry analysis</button><button class="outline-button" type="button" id="response-refresh">Refresh</button></div></section>' : ready ? '<section class="speaking-report-card speaking-response-state-card"><span class="speaking-upload-spinner" aria-hidden="true"></span><p class="eyebrow accent">REPORT PROGRESS</p><h3>Preparing your private analysis…</h3><p>The transcript and report are processed securely. You can leave and return later.</p><button class="outline-button" type="button" id="response-refresh">Refresh</button></section>' : '<section class="speaking-report-card speaking-response-recorder-card"><div class="speaking-response-timer" id="response-timer">00:00 / 01:05</div><p class="speaking-response-status" id="response-status" role="status" aria-live="polite">Record one uninterrupted response, or upload an audio file up to 65 seconds.</p><div class="speaking-detail-actions"><button class="primary-button" type="button" id="response-record">Start recording</button><label class="outline-button speaking-file-button">Upload existing audio<input type="file" id="response-file" accept="audio/*" hidden></label><button class="outline-button" type="button" id="response-upload" disabled>Upload and analyse</button></div><p class="speaking-response-upload-note" id="response-upload-note"></p></section>';
        detail.innerHTML = '<article class="speaking-response-workspace"><header class="speaking-response-overview-card speaking-report-card"><div class="speaking-set-overview-bar"><span class="speaking-pill" data-tone="' + stateTone + '">' + esc(stateLabel) + '</span></div><p class="eyebrow accent">PART B · INDIVIDUAL RESPONSE</p><h2>' + esc(response.title || 'Individual Response') + '</h2><p>One focused answer. You have up to 65 seconds.</p></header><section class="speaking-response-question-card speaking-report-card"><span class="speaking-set-section-symbol speaking-set-section-symbol-purple" aria-hidden="true">' + esc(question.order || '?') + '</span><div><p class="eyebrow accent">YOUR QUESTION</p><p class="speaking-response-question">' + esc(question.text || '') + '</p></div></section>' + responseBody + '</article>';
        updateToolbar({ title: 'Individual Response', invitation: true });
        var refresh = document.getElementById('response-refresh'); if (refresh) refresh.addEventListener('click', function () { getIndividualResponseAndRender(response.response_session_id); });
        var retry = document.getElementById('response-retry-analysis'); if (retry) retry.addEventListener('click', function () { retry.disabled = true; call('startIndividualResponseAnalysis', { response_session_id: response.response_session_id, operation_id: 'analysis-' + response.response_session_id }).then(function () { return getIndividualResponseAndRender(response.response_session_id); }).catch(function (error) { retry.disabled = false; setStatus(friendlyError(error), true); }); });
        if (!ready && !reportReady) bindIndividualResponseRecording(response);
    }
    function getIndividualResponseAndRender(responseId) { return call('getIndividualResponse', { response_session_id: responseId }).then(function (result) { renderIndividualResponseWorkspace(result.response); return result; }).catch(function (error) { setStatus(friendlyError(error), true); }); }
    function responseDialogRecorderMarkup() {
        return '<div class="speaking-response-dialog-recorder"><div class="speaking-response-timer" id="response-timer">00:00 / 01:05</div><button class="speaking-response-microphone" type="button" id="response-record" aria-describedby="response-status"><span class="speaking-response-microphone-icon" aria-hidden="true"><svg viewBox="0 0 32 32"><rect x="11" y="5" width="10" height="15" rx="5"/><path d="M7.5 16.5a8.5 8.5 0 0 0 17 0M16 25v3M12 28h8"/></svg></span><span class="speaking-response-microphone-label" data-response-record-label>Tap to record</span></button><p class="speaking-response-status" id="response-status" role="status" aria-live="polite">Record one uninterrupted response of up to 65 seconds.</p><label class="speaking-response-dialog-file">Choose existing audio<input type="file" id="response-file" accept="audio/*" hidden></label><button class="primary-button speaking-response-dialog-upload" type="button" id="response-upload" disabled hidden>Upload &amp; analyse</button></div>';
    }
    function renderIndividualResponseDialog(response) {
        selectedResponse = response;
        var question = response.question_snapshot || {};
        var uploaded = response.recording_status === 'uploaded';
        var reportReady = response.analysis_status === 'ready';
        var body = uploaded ? '<div class="speaking-response-dialog-state"><span class="speaking-upload-spinner" aria-hidden="true"></span><h3>' + (reportReady ? 'Your report is ready.' : 'Preparing your private analysis…') + '</h3><p>' + (reportReady ? 'Open Part B in the sidebar whenever you want to review it.' : 'You can close this window and return later. Your recording is safe.') + '</p></div>' : responseDialogRecorderMarkup();
        responseDialogContent.innerHTML = '<div class="speaking-response-dialog-header"><p class="eyebrow accent">PART B - INDIVIDUAL RESPONSE</p><h2 id="individual-response-dialog-title">Question ' + esc(question.order || '') + '</h2></div><p class="speaking-response-dialog-question">' + esc(question.text || '') + '</p>' + body + '<div class="speaking-dialog-actions"><button class="outline-button" type="button" id="individual-response-dialog-close">Done</button></div>';
        document.getElementById('individual-response-dialog-close').addEventListener('click', closeIndividualResponseDialog);
        if (!uploaded) bindIndividualResponseRecording(response);
        if (typeof responseDialog.showModal === 'function' && !responseDialog.open) responseDialog.showModal();
        else if (!responseDialog.open) responseDialog.setAttribute('open', '');
        var record = document.getElementById('response-record');
        if (record) window.requestAnimationFrame(function () { record.focus(); });
    }
    function individualResponseDraft(set, questionId) {
        var questions = set && set.part_b && Array.isArray(set.part_b.questions) ? set.part_b.questions : [];
        var question = questions.find(function (item) { return String(item.question_id || '') === String(questionId || ''); });
        if (!question) return null;
        var operation = 'response-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9);
        return {
            response_session_id: '',
            client_draft: true,
            set_id: set.set_id,
            set_snapshot: {
                display_label: speakingSetLabel(set),
                source_kind: set.source_kind || '',
                exam_year: set.exam_year || '',
                paper_version: set.paper_version || '',
                title: set.title || ''
            },
            question_snapshot: Object.assign({}, question),
            title: (set.title || 'Individual Response') + ' · IR Q' + (question.order || ''),
            response_date: shanghaiToday(),
            duration_limit_seconds: 65,
            recording_status: 'not_uploaded',
            analysis_status: 'not_ready',
            create_request: { set_id: set.set_id, question_id: question.question_id, operation_id: operation, response_date: shanghaiToday() }
        };
    }
    function ensureIndividualResponseCreated(response) {
        if (response && response.response_session_id) return Promise.resolve(response);
        if (!response || !response.create_request) return Promise.reject(new Error('INDIVIDUAL_RESPONSE_NOT_FOUND'));
        return call('createIndividualResponse', response.create_request).then(function (result) {
            if (!result || !result.response || !result.response.response_session_id) throw new Error('INDIVIDUAL_RESPONSE_NOT_FOUND');
            selectedResponse = result.response;
            return result.response;
        });
    }
    function closeIndividualResponseDialog() {
        if (responseUploadInProgress) {
            var statusNode = document.getElementById('response-status');
            if (statusNode) statusNode.textContent = 'Wait until the secure upload finishes.';
            return;
        }
        var recording = responseRecorder && responseRecorder.state !== 'inactive';
        if (recording && !window.confirm('Discard this Individual Response recording?')) return;
        if (responseBlob && !window.confirm('Discard this Individual Response recording?')) return;
        if (recording) {
            responseRecorder.ondataavailable = null;
            responseRecorder.onstop = null;
            try { responseRecorder.stop(); } catch (_error) {}
        }
        var responseToDiscard = selectedResponse;
        stopResponseHardware();
        responseBlob = null;
        responseChunks = [];
        responseRecordedDurationSeconds = null;
        responseUploadOperationId = '';
        selectedResponse = null;
        if (responseDialog.open && responseDialog.close) responseDialog.close();
        else responseDialog.removeAttribute('open');
        responseDialogContent.innerHTML = '';
        if (responseToDiscard && responseToDiscard.response_session_id && responseToDiscard.recording_status !== 'uploaded') {
            call('discardEmptyIndividualResponse', { response_session_id: responseToDiscard.response_session_id }).catch(function () { /* The backend list also hides uncommitted empty Responses. */ }).finally(loadIndividualResponses);
        } else loadIndividualResponses();
    }
    function startIndividualResponse(set, questionId, trigger) {
        var draft = individualResponseDraft(set, questionId);
        if (!draft) { setStatus('That Individual Response question is no longer available.', true); return; }
        renderIndividualResponseDialog(draft);
    }
    function finishResponseRecording() {
        if (!responseRecorder || responseRecorder.state === 'inactive') return;
        responseRecordedDurationSeconds = responseElapsedSeconds();
        try { responseRecorder.stop(); } catch (_error) { stopResponseHardware(); }
    }
    function bindIndividualResponseRecording(response) {
        var record = document.getElementById('response-record');
        var file = document.getElementById('response-file');
        var upload = document.getElementById('response-upload');
        function setRecordButton(label, isRecording) {
            if (!record) return;
            var labelNode = record.querySelector('[data-response-record-label]');
            if (labelNode) labelNode.textContent = label;
            else record.textContent = label;
            record.classList.toggle('is-recording', Boolean(isRecording));
            record.setAttribute('aria-label', label);
        }
        if (record) record.addEventListener('click', function () {
            if (responseRecorder && responseRecorder.state !== 'inactive') { finishResponseRecording(); return; }
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { document.getElementById('response-status').textContent = 'Recording is unavailable here. Choose an audio file instead.'; return; }
            record.disabled = true;
            responseBlob = null;
            responseUploadOperationId = '';
            responseRecordedDurationSeconds = null;
            if (upload) upload.disabled = true;
            navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
                responseStream = stream; responseChunks = []; responseStartedAt = performance.now(); responseRecordedDurationSeconds = null;
                var preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(function (mime) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime); });
                responseRecorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
                responseRecorder.ondataavailable = function (event) { if (event.data && event.data.size) responseChunks.push(event.data); };
                responseRecorder.onstop = function () { var mimeType = responseRecorder.mimeType || 'audio/webm'; responseBlob = new Blob(responseChunks, { type: mimeType }); stopResponseHardware(); responseStartedAt = 0; record.disabled = false; setRecordButton('Record again', false); if (responseBlob.size) { upload.disabled = false; upload.hidden = false; document.getElementById('response-status').textContent = 'Recording ready. Record again or upload it for analysis.'; } };
                responseRecorder.start(250);
                responseTimer = window.setInterval(function () { var seconds = responseElapsedSeconds(); var timer = document.getElementById('response-timer'); if (timer) { timer.textContent = responseTimeText(seconds); timer.classList.toggle('is-warning', seconds >= 60); } var status = document.getElementById('response-status'); if (status && seconds >= 60 && seconds < 65) status.textContent = 'Time is almost over.'; if (seconds >= 65) finishResponseRecording(); }, 100);
                setRecordButton('Stop recording', true);
                record.disabled = false;
            }).catch(function () { record.disabled = false; document.getElementById('response-status').textContent = 'Microphone access was denied. Choose an audio file instead.'; });
        });
        if (file) file.addEventListener('change', function () { var chosen = file.files && file.files[0]; file.value = ''; if (!chosen || (chosen.type && !/^audio\//i.test(chosen.type))) return; var objectUrl = URL.createObjectURL(chosen); var probe = document.createElement('audio'); probe.preload = 'metadata'; probe.onloadedmetadata = function () { URL.revokeObjectURL(objectUrl); var duration = Number(probe.duration); if (!Number.isFinite(duration) || duration <= 0 || duration > 65) { document.getElementById('response-status').textContent = 'Choose an audio file no longer than 65 seconds.'; return; } responseRecordedDurationSeconds = duration; responseBlob = chosen; responseUploadOperationId = ''; upload.disabled = false; upload.hidden = false; document.getElementById('response-status').textContent = chosen.name + ' is ready to upload.'; }; probe.onerror = function () { URL.revokeObjectURL(objectUrl); document.getElementById('response-status').textContent = 'This audio file duration could not be checked.'; }; probe.src = objectUrl; });
        if (upload) upload.addEventListener('click', function () {
            if (!responseBlob) return;
            upload.disabled = true;
            responseUploadInProgress = true;
            var blob = responseBlob;
            var activeResponse = response;
            var durationSeconds = Number.isFinite(Number(responseRecordedDurationSeconds)) ? Number(responseRecordedDurationSeconds) : undefined;
            var operation = responseUploadOperationId || ('response-upload-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9));
            responseUploadOperationId = operation;
            document.getElementById('response-status').textContent = 'Uploading securely…';
            ensureIndividualResponseCreated(response).then(function (createdResponse) {
                activeResponse = createdResponse;
                return call('startIndividualResponseAudioUpload', { response_session_id: activeResponse.response_session_id, operation_id: operation, mime_type: String(blob.type || 'audio/webm').split(';')[0], size_bytes: blob.size, duration_seconds: durationSeconds });
            }).then(function (result) {
                return uploadWithTimeout(api.uploadCloudFile(result.upload.cloud_path, blob)).then(function (uploaded) {
                    return call('finishIndividualResponseAudioUpload', { response_session_id: activeResponse.response_session_id, operation_id: operation, asset_id: result.asset_id, uploaded_file_id: uploaded.file_id, duration_seconds: durationSeconds });
                });
            }).then(function () {
                activeResponse.recording_status = 'uploaded';
                selectedResponse = activeResponse;
                return call('startIndividualResponseAnalysis', { response_session_id: activeResponse.response_session_id, operation_id: 'analysis-' + activeResponse.response_session_id });
            }).then(function () {
                responseBlob = null;
                responseRecordedDurationSeconds = null;
                responseUploadOperationId = '';
                if (responseDialog && responseDialog.open) return call('getIndividualResponse', { response_session_id: activeResponse.response_session_id }).then(function (result) { renderIndividualResponseDialog(result.response); loadIndividualResponses(); return result; });
                return getIndividualResponseAndRender(activeResponse.response_session_id);
            }).catch(function (error) {
                upload.disabled = false;
                document.getElementById('response-status').textContent = friendlyError(error);
            }).finally(function () { responseUploadInProgress = false; });
        });
    }
    function stopVoiceReferenceRecording() {
        if (voiceRecorder && voiceRecorder.state !== 'inactive') voiceRecorder.stop();
    }
    function startVoiceReferenceRecording(participantId, participantName, button) {
        if (recorder && recorder.state !== 'inactive') { setStatus('Finish the formal Discussion recording first.', true); return; }
        if (voiceRecorder && voiceRecorder.state !== 'inactive') {
            if (button === voiceButton) stopVoiceReferenceRecording();
            else setStatus('Finish the current Voice Reference first.', true);
            return;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) {
            setStatus('Browser recording is unavailable. Choose an audio file instead.', true);
            return;
        }
        if (!window.confirm('Record the displayed passage for ' + participantName + '?')) return;
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            var chunks = [];
            var preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(function (mime) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime); });
            voiceStream = stream;
            voiceRecorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
            voiceButton = button;
            voiceStartedAt = performance.now();
            voiceDiscard = false;
            button.textContent = 'Stop sample · 00:00';
            voiceRecorder.ondataavailable = function (event) { if (event.data && event.data.size) chunks.push(event.data); };
            voiceRecorder.onstop = function () {
                var duration = (performance.now() - voiceStartedAt) / 1000;
                var blob = new Blob(chunks, { type: voiceRecorder && voiceRecorder.mimeType || 'audio/webm' });
                if (voiceTimer) window.clearInterval(voiceTimer);
                voiceTimer = 0;
                if (voiceStream) voiceStream.getTracks().forEach(function (track) { track.stop(); });
                voiceStream = null;
                voiceRecorder = null;
                voiceButton = null;
                button.textContent = 'Record sample';
                if (voiceDiscard) { voiceDiscard = false; return; }
                if (duration < 8 || !blob.size) { setStatus('The Voice Reference was too short. Read the full passage for about 15–20 seconds.', true); return; }
                setStatus('Uploading Voice Reference…');
                uploadBlob(blob, 'voice_reference', participantId).then(function () { return openDiscussion(selectedId); }).then(function () { setStatus('Voice Reference uploaded.'); }).catch(function (error) { setStatus(friendlyError(error), true); });
            };
            voiceRecorder.start();
            voiceTimer = window.setInterval(function () {
                if (!voiceRecorder || voiceRecorder.state === 'inactive') return;
                var seconds = Math.floor((performance.now() - voiceStartedAt) / 1000);
                button.textContent = 'Stop sample · 00:' + String(seconds).padStart(2, '0');
                if (seconds >= 20) stopVoiceReferenceRecording();
            }, 250);
        }).catch(function () { setStatus('Microphone access was denied. Choose an audio file instead.', true); });
    }
    function finishFormalRecording() {
        if (['requesting', 'countdown'].indexOf(recordingState) >= 0) { discardLocalRecording(); setRecordingMessage('Recording cancelled.'); return; }
        if (!recorder || recorder.state === 'inactive' || ['recording', 'ending'].indexOf(recordingState) < 0) return;
        if (recordingElapsedSeconds() < Math.min(60, recordingTargetSeconds / 2) && !window.confirm('Finish this recording early?')) return;
        setRecordingState('stopping');
        showQualityWarning('Finishing the recording safely…');
        try { if (recorder.requestData) recorder.requestData(); } catch (error) {}
        try { recorder.stop(); }
        catch (error) { recordingCaptureGeneration += 1; recordingStartFailure('The browser could not finish this recording. Please record again or choose an audio file.'); }
    }
    function toggleRecordingPreview() {
        if (!recordingBlob || recordingState !== 'review') return;
        var button = document.getElementById('preview-recording');
        if (recordingPreviewAudio && !recordingPreviewAudio.paused) {
            recordingPreviewAudio.pause();
            if (button) button.textContent = 'Play recording';
            return;
        }
        if (!recordingPreviewAudio) {
            recordingPreviewUrl = URL.createObjectURL(recordingBlob);
            recordingPreviewAudio = new Audio(recordingPreviewUrl);
            recordingPreviewAudio.addEventListener('ended', function () { if (button) button.textContent = 'Play recording'; });
            recordingPreviewAudio.addEventListener('error', function () { stopRecordingPreview(); setStatus('This browser could not play the local preview. You can replace the recording or upload it.', true); });
        }
        recordingPreviewAudio.play().then(function () { if (button) button.textContent = 'Pause preview'; }).catch(function () { stopRecordingPreview(); setStatus('This browser could not play the local preview. You can replace the recording or upload it.', true); });
    }
    function prepareAudioFile(file) {
        if (!file || recordingState !== 'idle') return;
        if (file.type && !/^audio\//i.test(file.type)) { setRecordingMessage('Choose an audio file. Video files are not supported here.'); return; }
        stopRecordingPreview();
        recordingBlob = file;
        recordingUploadOperationId = 'speaking-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        var copy = document.getElementById('recording-review-copy');
        if (copy) copy.textContent = file.name + ' is ready. Play it if you want to check it, then upload and start the analysis.';
        setRecordingState('review');
    }
    function uploadPreparedRecording() {
        if (recordingState !== 'review' || !recordingBlob) return;
        var discussionId = selectedId;
        var blob = recordingBlob;
        var operationId = recordingUploadOperationId || ('speaking-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
        recordingUploadOperationId = operationId;
        stopRecordingPreview();
        persistRecordingTarget();
        setRecordingState('uploading');
        setStatus('Uploading audio securely…');
        var uploadCompleted = false;
        uploadBlob(blob, 'formal', null, operationId).then(function () {
            uploadCompleted = true;
            setStatus('Audio uploaded. Starting analysis…');
            return call('startAnalysis', { discussion_id: discussionId, operation_id: 'analysis-' + discussionId });
        }).then(function () {
            recordingBlob = null;
            recordingUploadOperationId = '';
            setRecordingState('idle');
            return openDiscussion(discussionId);
        }).then(function () { setStatus('Audio uploaded. Analysis has started.'); }).catch(function (error) {
            if (uploadCompleted) {
                recordingBlob = null;
                recordingUploadOperationId = '';
                setRecordingState('idle');
                openDiscussion(discussionId).then(function () { setStatus('Audio uploaded, but analysis did not start. ' + friendlyError(error), true); });
                return;
            }
            setRecordingState('review');
            var copy = document.getElementById('recording-review-copy');
            if (copy) copy.textContent = friendlyError(error) + ' Your recording is still here and ready to retry.';
            setStatus(friendlyError(error), true);
        });
    }
    function bindRecording() {
        setRecordingState(recordingBlob ? 'review' : 'idle');
        var duration = document.getElementById('recording-duration'); if (duration) duration.addEventListener('change', function () { var seconds = currentRecordingTarget(); var pill = document.getElementById('recording-target-pill'); if (pill) pill.textContent = 'Target ' + (seconds / 60) + ' min'; });
        var start = document.getElementById('record-now'); if (start) start.addEventListener('click', startRecording);
        var stop = document.getElementById('stop-recording'); if (stop) stop.addEventListener('click', finishFormalRecording);
        var preview = document.getElementById('preview-recording'); if (preview) preview.addEventListener('click', toggleRecordingPreview);
        var replace = document.getElementById('replace-recording'); if (replace) replace.addEventListener('click', function () { if (!window.confirm('Replace this recording? The current copy has not been uploaded.')) return; discardLocalRecording(); });
        var upload = document.getElementById('upload-recording'); if (upload) upload.addEventListener('click', uploadPreparedRecording);
        var date = document.getElementById('recording-date'); if (date) date.addEventListener('change', function () { persistDiscussionDate(date.value); });
        var file = document.getElementById('audio-file'); if (file) file.addEventListener('change', function () { var chosen = file.files && file.files[0]; file.value = ''; persistDiscussionDate(date && date.value).then(function () { prepareAudioFile(chosen); }); });
        detail.querySelectorAll('[data-voice-record]').forEach(function (button) { button.addEventListener('click', function () { startVoiceReferenceRecording(button.getAttribute('data-voice-record'), button.getAttribute('data-voice-name') || 'this participant', button); }); });
        detail.querySelectorAll('[data-voice-file]').forEach(function (input) { input.addEventListener('change', function () { var file = input.files[0]; if (!file) return; var name = input.getAttribute('data-voice-name') || 'this participant'; if (!window.confirm('Use this Voice Reference for ' + name + '?')) { input.value = ''; return; } setStatus('Uploading Voice Reference…'); uploadBlob(file, 'voice_reference', input.getAttribute('data-voice-file')).then(function () { return openDiscussion(selectedId); }).then(function () { setStatus('Voice Reference uploaded.'); }).catch(function (error) { setStatus(friendlyError(error), true); }); }); });
        var analysis = document.getElementById('start-analysis'); if (analysis) analysis.addEventListener('click', function () { analysis.disabled = true; call('startAnalysis', { discussion_id: selectedId, operation_id: 'analysis-' + selectedId }).then(function () { return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); analysis.disabled = false; }); });
    }
    function acknowledgeIdentityNotice(item) {
        var own = item && (item.participants || []).find(function (participant) { return participant.is_self && participant.identity_notice_unread; });
        if (!own) return;
        own.identity_notice_unread = false;
        call('acknowledgeIdentityNotice', { discussion_id: item.discussion_id }).then(function () {
            return call('listDiscussions', { page_size: 50, sort_order: discussionSortOrder });
        }).then(function (result) {
            renderList(result.discussions || []);
        }).catch(function () { /* The notice remains unread on the server and will reappear safely. */ });
    }
    function acknowledgeReportViewed(item) {
        if (!item || !item.report_unread || item.analysis_status !== 'ready' || !item.report) return;
        call('acknowledgeReportViewed', { discussion_id: item.discussion_id }).then(function (result) {
            if (!result || !result.success) return null;
            item.report_unread = false;
            return call('listDiscussions', { page_size: 50, sort_order: discussionSortOrder });
        }).then(function (result) {
            if (result) renderList(result.discussions || []);
        }).catch(function () { /* The report remains unread on the server and will reappear safely. */ });
    }
    function openDiscussion(idValue) {
        if (recordingState !== 'idle') return Promise.resolve(null);
        selectedId = idValue;
        syncDiscussionSidebarSelection();
        pollGeneration += 1;
        if (pollTimer) { window.clearTimeout(pollTimer); pollTimer = 0; }
        window.history.replaceState(null, '', 'speaking-lab.html?discussion=' + encodeURIComponent(idValue));
        var generation = pollGeneration;
        return call('getDiscussion', { discussion_id: idValue }).then(function (result) {
            hideSpeakingHomeCards();
            if (result.invitation) {
                updateToolbar({ title: result.invitation.title, invitation: true });
                document.body.classList.remove('speaking-detail-open');
                detail.hidden = true;
                list.hidden = false;
                invitationDialogContent.innerHTML = invitationMarkup(result.invitation);
                if (typeof invitationDialog.showModal === 'function' && !invitationDialog.open) invitationDialog.showModal();
                else invitationDialog.setAttribute('open', '');
                ['accept', 'decline'].forEach(function (action) {
                    var button = document.getElementById(action + '-invitation');
                    var own = (result.invitation.participants || []).find(function (participant) { return participant.is_self; });
                    button.addEventListener('click', function () {
                        button.disabled = true;
                        call('respondInvitation', { participant_id: own && own.participant_id, discussion_id: idValue, response: action }).then(function () {
                            if (invitationDialog.open) invitationDialog.close();
                            if (action === 'decline') {
                                selectedId = '';
                                window.history.replaceState(null, '', 'speaking-lab.html');
                                return loadList();
                            }
                            return loadList();
                        }).catch(function (error) { setStatus(friendlyError(error), true); button.disabled = false; });
                    });
                });
            } else {
                if (invitationDialog.open) invitationDialog.close();
                document.body.classList.add('speaking-detail-open');
                detail.hidden = false;
                detail.innerHTML = detailMarkup(result.discussion);
                updateToolbar(result.discussion);
                bindInvitationActions();
                bindRecording();
                acknowledgeIdentityNotice(result.discussion);
                acknowledgeReportViewed(result.discussion);
            }
            setStatus('');
            schedulePoll(result.discussion, generation);
            return result.discussion || result.invitation || true;
        }).catch(function (error) {
            setStatus(friendlyError(error), true);
            if (document.documentElement.classList.contains('speaking-direct-entry')) {
                document.body.classList.add('speaking-detail-open');
                detail.hidden = false;
                detail.innerHTML = '<article class="speaking-report-card speaking-response-state-card"><span class="speaking-response-state-symbol" aria-hidden="true">!</span><h3>This Discussion could not be opened.</h3><p>' + esc(friendlyError(error)) + '</p><div class="speaking-detail-actions"><button class="outline-button" type="button" id="close-discussion">Return to Speaking Lab</button></div></article>';
            }
            return null;
        });
    }
    function schedulePoll(item, generation) {
        var analysisWorking = item && ['queued', 'processing'].includes(item.analysis_status);
        var voiceSearchWorking = item && ['queued', 'processing'].includes(item.voice_match_status);
        if (!item || (!analysisWorking && !voiceSearchWorking) || generation !== pollGeneration) return;
        var delay = document.hidden ? 10000 : 3000;
        pollTimer = window.setTimeout(function () {
            if (generation !== pollGeneration || !selectedId) return;
            call('getDiscussion', { discussion_id: selectedId }).then(function (result) {
                if (generation !== pollGeneration) return;
                detail.innerHTML = detailMarkup(result.discussion); updateToolbar(result.discussion); bindInvitationActions(); bindRecording(); acknowledgeReportViewed(result.discussion); schedulePoll(result.discussion, generation);
            }).catch(function () { schedulePoll(item, generation); });
        }, delay);
    }
    function loadSidebarLists() {
        return call('listDiscussions', { page_size: 50, sort_order: discussionSortOrder }).then(function (result) { renderList(result.discussions || []); setStatus(''); return loadIndividualResponses(); }).catch(function (error) { setStatus(friendlyError(error), true); return null; });
    }
    function loadList() {
        document.body.classList.remove('speaking-detail-open');
        if (!selectedId) updateToolbar(null);
        return loadSidebarLists().then(function () { if (selectedId) return openDiscussion(selectedId); });
    }
    backButton.addEventListener('click', handleSpeakingBack);
    sidebarToggle.addEventListener('click', function () { if (sidebar.classList.contains('is-open')) closeSidebar({ restoreFocus: true }); else openSidebar(); });
    leaveDialogCancel.addEventListener('click', closeLeaveSpeakingDialog);
    leaveDialogConfirm.addEventListener('click', function () {
        closeLeaveSpeakingDialog();
        window.location.assign('dashboard.html');
    });
    toolbarEdit.addEventListener('click', openTitleDialog);
    document.getElementById('discussion-prompt-close').addEventListener('click', function () {
        if (promptDialog.open && promptDialog.close) promptDialog.close();
        else promptDialog.removeAttribute('open');
    });
    transcriptionDialogClose.addEventListener('click', function () {
        if (transcriptionDialog.open && transcriptionDialog.close) transcriptionDialog.close();
        else transcriptionDialog.removeAttribute('open');
    });
    responseDialog.addEventListener('cancel', function (event) {
        event.preventDefault();
        closeIndividualResponseDialog();
    });
    sidebarScrim.addEventListener('click', function () { closeSidebar({ restoreFocus: true }); });
    sidebarNew.addEventListener('click', function () { if (!allowRecordingNavigation()) return; closeSidebar(); returnToSpeakingSetLibrary(); });
    document.getElementById('new-discussion').addEventListener('click', returnToSpeakingSetLibrary);
    sidebarVoiceprint.addEventListener('click', function () { if (!allowRecordingNavigation()) return; closeSidebar(); renderVoiceprintMain(); });
    sidebarPartA.addEventListener('click', function () { setSidebarMode('part-a'); });
    sidebarPartB.addEventListener('click', function () { setSidebarMode('part-b'); });
    discussionSort.addEventListener('change', function () {
        discussionSortOrder = discussionSort.value === 'oldest' ? 'oldest' : 'newest';
        loadSidebarLists();
    });
    ['speaking-set-search', 'speaking-set-year-filter', 'speaking-set-source-filter'].forEach(function (id) {
        var control = document.getElementById(id);
        control.addEventListener(control.tagName === 'INPUT' ? 'input' : 'change', function () { speakingSetRenderLimit = 48; renderSpeakingSetResults(); });
    });
    document.getElementById('speaking-set-more').addEventListener('click', function () { speakingSetRenderLimit += 48; renderSpeakingSetResults(); });
    var voiceprintRecordButton = document.getElementById('voiceprint-record');
    voiceprintRecordButton.addEventListener('pointerdown', function (event) {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        event.preventDefault();
        startMyVoiceprintRecording(event);
    });
    voiceprintRecordButton.addEventListener('pointerup', function (event) {
        if (voiceprintPointerId !== null && event.pointerId !== voiceprintPointerId) return;
        event.preventDefault();
        stopMyVoiceprintRecording(false);
        voiceprintPointerId = null;
    });
    voiceprintRecordButton.addEventListener('pointercancel', function (event) {
        if (voiceprintPointerId !== null && event.pointerId !== voiceprintPointerId) return;
        stopMyVoiceprintRecording(true);
        voiceprintPointerId = null;
    });
    voiceprintRecordButton.addEventListener('contextmenu', function (event) { event.preventDefault(); });
    voiceprintRecordButton.addEventListener('keydown', function (event) {
        if ((event.key !== ' ' && event.key !== 'Enter') || event.repeat) return;
        event.preventDefault();
        startMyVoiceprintRecording();
    });
    voiceprintRecordButton.addEventListener('keyup', function (event) {
        if (event.key !== ' ' && event.key !== 'Enter') return;
        event.preventDefault();
        stopMyVoiceprintRecording(false);
    });
    document.getElementById('voiceprint-confirm').addEventListener('click', function () {
        if (voiceprintPendingResult) saveVoiceprintRecording(voiceprintPendingResult);
    });
    titleForm.addEventListener('submit', function (event) {
        if (event.submitter && event.submitter.value === 'cancel') return;
        event.preventDefault();
        if (!currentDiscussion || !currentDiscussion.can_edit_title) return;
        var title = titleInput.value.trim().replace(/\s+/g, ' ');
        if (!title) { titleError.textContent = 'Enter a Discussion title.'; titleInput.focus(); return; }
        var save = document.getElementById('discussion-title-save');
        save.disabled = true;
        titleError.textContent = '';
        call('updateDiscussionTitle', { discussion_id: currentDiscussion.discussion_id, title: title }).then(function () {
            if (titleDialog.open) titleDialog.close();
            return loadList();
        }).catch(function (error) {
            titleError.textContent = friendlyError(error);
        }).finally(function () { save.disabled = false; });
    });
    document.addEventListener('click', function (event) { if (event.target && event.target.id === 'close-discussion') returnToSpeakingHome(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape' && sidebar.classList.contains('is-open')) closeSidebar({ restoreFocus: true }); });
    document.addEventListener('visibilitychange', function () { if (document.hidden || recordingState !== 'idle' || voiceprintPressActive || voiceprintSaving || voiceprintPendingResult) return; if (selectedId) openDiscussion(selectedId); else loadList(); });
    window.addEventListener('beforeunload', function (event) { if (!recordingLocksPage() && !recordingNeedsDiscardConfirmation() && !responseUploadInProgress && !(responseRecorder && responseRecorder.state !== 'inactive') && !responseBlob && !voiceprintPressActive && !voiceprintController && !voiceprintPendingResult && !voiceprintSaving) return; event.preventDefault(); event.returnValue = ''; });
    window.addEventListener('pageshow', function (event) { if (event.persisted) closeSidebar(); });

    if (typeof window.ResizeObserver === 'function') {
        new window.ResizeObserver(scheduleToolbarTitleMeasure).observe(toolbarTitleWindow);
    } else {
        window.addEventListener('resize', scheduleToolbarTitleMeasure);
    }

    setSidebarMode('part-a');
    closeSidebar();

    auth.getSession().then(function (session) {
        if (!session || session.mode !== 'student') { window.location.replace('index.html?return=speaking-lab.html'); return null; }
        if (selectedId) {
            return openDiscussion(selectedId).then(function () {
                finishInitialLoading();
                window.setTimeout(function () {
                    loadMyVoiceprint().then(function () { return loadSpeakingSets(); }).then(function () { return loadSidebarLists(); }).catch(function () { /* The open report remains usable if supplementary navigation data is unavailable. */ });
                }, 0);
                return null;
            });
        }
        // Legacy startup contract retained: loadMyVoiceprint().then(function () { return loadList(); });
        return loadMyVoiceprint().then(function () { return loadSpeakingSets(); }).then(function () { return loadList(); });
    }).catch(function () { finishInitialLoading(); window.location.replace('index.html?return=speaking-lab.html'); });
    window.addEventListener('pagehide', function () { discardLocalRecording(); stopResponseHardware(); responseBlob = null; voiceDiscard = true; stopVoiceReferenceRecording(); if (voiceprintController) voiceprintController.cancel(); voiceprintController = null; voiceprintPendingResult = null; voiceprintPressActive = false; if (voiceStream) voiceStream.getTracks().forEach(function (track) { track.stop(); }); if (voiceTimer) window.clearInterval(voiceTimer); if (pollTimer) window.clearTimeout(pollTimer); });
})(window);
