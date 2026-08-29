(function (window) {
    'use strict';

    var api = window.MrCatCloud;
    var auth = window.MrCatAuth;
    var list = document.getElementById('speaking-list');
    var detail = document.getElementById('speaking-detail');
    var status = document.getElementById('speaking-status');
    var sidebar = document.getElementById('speaking-sidebar');
    var sidebarToggle = document.getElementById('speaking-sidebar-toggle');
    var sidebarAlert = document.getElementById('speaking-sidebar-alert');
    var sidebarScrim = document.getElementById('speaking-sidebar-scrim');
    var sidebarNew = document.getElementById('speaking-sidebar-new');
    var toolbarTitle = document.getElementById('speaking-toolbar-title');
    var toolbarEdit = document.getElementById('speaking-toolbar-edit');
    var dialog = document.getElementById('discussion-dialog');
    var titleDialog = document.getElementById('discussion-title-dialog');
    var titleForm = document.getElementById('discussion-title-form');
    var titleInput = document.getElementById('discussion-title-edit');
    var titleError = document.getElementById('discussion-title-error');
    var promptDialog = document.getElementById('discussion-prompt-dialog');
    var promptDialogTitle = document.getElementById('discussion-prompt-dialog-title');
    var promptDialogSubtitle = document.getElementById('discussion-prompt-dialog-subtitle');
    var promptDialogText = document.getElementById('discussion-prompt-dialog-text');
    var invitationDialog = document.getElementById('invitation-dialog');
    var invitationDialogContent = document.getElementById('invitation-dialog-content');
    var form = document.getElementById('discussion-form');
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
    var qualityFrame = 0;
    var qualityAnalyser = null;
    var qualityContext = null;
    var qualityIssue = '';
    var qualityBadSince = 0;
    var qualityRecoverySince = 0;
    var qualityReadyAt = 0;
    var LOW_VOLUME_DBFS = -45;
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
    var voiceprintDialog = document.getElementById('voiceprint-dialog');
    var voiceprintTarget = null;
    var voiceprintController = null;
    var voiceprintSaving = false;
    var READ_TIMEOUT_MS = 20000;
    var MUTATION_TIMEOUT_MS = 90000;
    var FILE_UPLOAD_TIMEOUT_MS = 10 * 60 * 1000;
    var READ_ACTIONS = {
        getMyVoiceprint: true,
        listDiscussions: true,
        getDiscussion: true,
        getVoiceConfirmationPlayback: true
    };
    var sidebarInvitationCount = 0;
    var currentDiscussion = null;

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
    function updateToolbar(item) {
        currentDiscussion = item && !item.invitation ? item : null;
        var title = item && item.title ? item.title : 'Speaking Lab';
        toolbarTitle.textContent = title;
        toolbarTitle.setAttribute('title', title);
        toolbarEdit.hidden = !(currentDiscussion && currentDiscussion.can_edit_title);
        toolbarEdit.disabled = recordingLocksPage();
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
        promptDialogSubtitle.textContent = formatDate(currentDiscussion.discussion_date) + ' · DSE Paper 4 Part A Set question';
        promptDialogText.textContent = currentDiscussion.prompt_text || 'No Set question is available.';
        if (typeof promptDialog.showModal === 'function') promptDialog.showModal();
        else promptDialog.setAttribute('open', '');
    }
    function voiceprintTime(seconds) {
        var value = Math.max(0, Math.min(20, Math.floor(Number(seconds || 0))));
        return '00:' + String(value).padStart(2, '0') + ' / 00:20';
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
        var active = Boolean(voiceprintTarget && voiceprintTarget.voiceprint && voiceprintTarget.voiceprint.status === 'active');
        var summary = document.getElementById('my-voiceprint-summary');
        var button = document.getElementById('open-my-voiceprint');
        if (!result || result.provider_configured === false) {
            summary.textContent = active ? 'Your saved voiceprint is ready. Updating is temporarily unavailable.' : 'Voiceprint registration will be available after Tencent setup is completed.';
            button.disabled = true;
        } else {
            summary.textContent = active ? 'Ready for automatic Speaker matching in future Discussions.' : 'Record once, then reuse it in future Discussions.';
            button.disabled = false;
        }
        button.textContent = active ? 'Update voiceprint' : 'Set up voiceprint';
    }
    function loadMyVoiceprint() {
        return call('getMyVoiceprint').then(function (result) { renderMyVoiceprint(result); return result; }).catch(function (error) {
            document.getElementById('my-voiceprint-summary').textContent = friendlyError(error);
            document.getElementById('open-my-voiceprint').disabled = true;
        });
    }
    function resetVoiceprintDialog() {
        if (voiceprintController) voiceprintController.cancel();
        voiceprintController = null;
        document.getElementById('voiceprint-record').disabled = false;
        document.getElementById('voiceprint-stop').disabled = true;
        document.getElementById('voiceprint-delete').disabled = false;
        document.getElementById('voiceprint-time').textContent = voiceprintTime(0);
        document.getElementById('voiceprint-message').textContent = 'Record in a quiet place and read the full passage naturally.';
    }
    function openVoiceprintDialog() {
        resetVoiceprintDialog();
        var active = Boolean(voiceprintTarget && voiceprintTarget.voiceprint && voiceprintTarget.voiceprint.status === 'active');
        document.getElementById('voiceprint-dialog-title').textContent = active ? 'Update my voiceprint' : 'Set up my voiceprint';
        document.getElementById('voiceprint-record').textContent = active ? 'Record replacement' : 'Start recording';
        document.getElementById('voiceprint-delete').hidden = !active;
        document.getElementById('voiceprint-consent').checked = false;
        if (voiceprintTarget && voiceprintTarget.passage) document.getElementById('voiceprint-passage').textContent = voiceprintTarget.passage;
        if (typeof voiceprintDialog.showModal === 'function') voiceprintDialog.showModal(); else voiceprintDialog.setAttribute('open', '');
    }
    function saveVoiceprintRecording(result) {
        if (!result || !result.base64 || voiceprintSaving) return;
        voiceprintSaving = true;
        document.getElementById('voiceprint-record').disabled = true;
        document.getElementById('voiceprint-stop').disabled = true;
        document.getElementById('voiceprint-delete').disabled = true;
        document.getElementById('voiceprint-message').textContent = 'Saving your reusable voiceprint with Tencent…';
        call('saveMyVoiceprint', {
            operation_id: 'voiceprint-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
            consent_confirmed: true,
            audio_base64: result.base64
        }).then(function (saved) {
            renderMyVoiceprint({ target: saved.target, provider_configured: true });
            document.getElementById('voiceprint-dialog-title').textContent = 'Voiceprint ready';
            document.getElementById('voiceprint-message').textContent = 'Saved. Future Discussions can use this voiceprint for automatic Speaker matching.';
            document.getElementById('voiceprint-delete').hidden = false;
        }).catch(function (error) {
            document.getElementById('voiceprint-message').textContent = friendlyError(error);
            document.getElementById('voiceprint-record').disabled = false;
        }).finally(function () {
            voiceprintSaving = false;
            voiceprintController = null;
            document.getElementById('voiceprint-delete').disabled = false;
        });
    }
    function startMyVoiceprintRecording() {
        if (voiceprintSaving || voiceprintController) return;
        if (!document.getElementById('voiceprint-consent').checked) {
            document.getElementById('voiceprint-message').textContent = 'Confirm consent before recording a reusable voiceprint.';
            return;
        }
        var recordButton = document.getElementById('voiceprint-record');
        var stopButton = document.getElementById('voiceprint-stop');
        recordButton.disabled = true;
        document.getElementById('voiceprint-delete').disabled = true;
        document.getElementById('voiceprint-message').textContent = 'Recording… read the full passage naturally.';
        window.MrCatVoiceprintRecorder.start({
            maxSeconds: 20,
            onProgress: function (seconds) {
                document.getElementById('voiceprint-time').textContent = voiceprintTime(seconds);
                stopButton.disabled = seconds < 8;
            },
            onReady: saveVoiceprintRecording,
            onError: function (error) {
                voiceprintController = null;
                recordButton.disabled = false;
                stopButton.disabled = true;
                document.getElementById('voiceprint-delete').disabled = false;
                document.getElementById('voiceprint-message').textContent = friendlyError(error);
            }
        }).then(function (controller) {
            voiceprintController = controller;
            stopButton.disabled = true;
        }).catch(function () {
            recordButton.disabled = false;
            document.getElementById('voiceprint-delete').disabled = false;
            document.getElementById('voiceprint-message').textContent = 'Microphone access was denied or this browser cannot create a voiceprint recording.';
        });
    }
    function stopMyVoiceprintRecording() {
        if (!voiceprintController || voiceprintController.elapsedSeconds() < 8) return;
        var current = voiceprintController;
        document.getElementById('voiceprint-stop').disabled = true;
        current.stop().then(saveVoiceprintRecording).catch(function (error) {
            document.getElementById('voiceprint-message').textContent = friendlyError(error);
            document.getElementById('voiceprint-record').disabled = false;
            document.getElementById('voiceprint-delete').disabled = false;
        });
    }
    function listCard(item) {
        var pending = item.invitation_pending === true || (item.participants || []).some(function (participant) { return participant.is_self && participant.invitation_status === 'pending'; });
        var voiceMatchNotice = (item.participants || []).some(function (participant) { return participant.is_self && participant.identity_notice_unread; });
        var candidateLabel = Number.isInteger(item.candidate_count) ? item.candidate_count + ' Candidate' + (item.candidate_count === 1 ? '' : 's') : 'Candidates pending';
        return '<button class="speaking-card' + (pending ? ' is-invitation' : '') + '" type="button" data-discussion-id="' + esc(item.discussion_id) + '">' +
            '<span class="speaking-card-icon" aria-hidden="true"></span>' +
            '<span class="speaking-card-copy"><h3>' + esc(item.title || 'Untitled Discussion') + '</h3><span class="speaking-card-date">' + esc(formatDate(item.discussion_date)) + '</span></span>' +
            '<span class="speaking-card-meta"><span class="speaking-pill">' + esc(candidateLabel) + '</span><span class="speaking-pill" data-tone="' + esc(statusTone(item.analysis_status)) + '">' + esc(readableStatus(item.analysis_status)) + '</span>' + (pending ? '<span class="speaking-pill" data-tone="attention">Invitation</span>' : '') + (voiceMatchNotice ? '<span class="speaking-pill" data-tone="attention">Voice matched</span>' : '') + '</span>' +
            '<svg class="speaking-card-chevron" aria-hidden="true" viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg></button>';
    }
    function sidebarToggleLabel(expanded) {
        var action = expanded ? 'Close Discussion sidebar' : 'Open Discussion sidebar';
        if (!sidebarInvitationCount) return action;
        return action + '. ' + sidebarInvitationCount + ' new Discussion update' + (sidebarInvitationCount === 1 ? '' : 's') + '.';
    }
    function updateSidebarInvitations(items) {
        sidebarInvitationCount = (items || []).filter(function (item) {
            return item.invitation_pending === true || (item.participants || []).some(function (participant) {
                return participant.is_self && (participant.invitation_status === 'pending' || participant.identity_notice_unread);
            });
        }).length;
        sidebarAlert.hidden = sidebarInvitationCount === 0;
        sidebarToggle.classList.toggle('has-invitations', sidebarInvitationCount > 0);
        sidebarToggle.setAttribute('aria-label', sidebarToggleLabel(sidebar.classList.contains('is-open')));
    }
    function openSidebar() {
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
    function returnToSpeakingHome() {
        if (!allowRecordingNavigation()) return;
        document.body.classList.remove('speaking-detail-open');
        detail.hidden = true;
        selectedId = '';
        pollGeneration += 1;
        if (pollTimer) window.clearTimeout(pollTimer);
        window.history.replaceState(null, '', 'speaking-lab.html');
        voiceDiscard = true;
        stopVoiceReferenceRecording();
        closeSidebar();
        updateToolbar(null);
    }
    function openNewDiscussionDialog() {
        if (!allowRecordingNavigation()) return;
        closeSidebar();
        document.getElementById('discussion-date').value = shanghaiToday();
        if (typeof dialog.showModal === 'function') dialog.showModal();
        else dialog.setAttribute('open', '');
    }
    function renderList(items) {
        updateSidebarInvitations(items);
        if (!items.length) { list.innerHTML = '<div class="speaking-detail-card speaking-empty-state"><div class="speaking-empty-icon" aria-hidden="true">◎</div><h2>Start your first Discussion</h2><p>Add the DSE task and record when the group is ready. Candidates and invitations are created from the audio.</p></div>'; return; }
        list.innerHTML = items.map(listCard).join('');
        list.querySelectorAll('[data-discussion-id]').forEach(function (button) {
            button.addEventListener('click', function () { if (!allowRecordingNavigation()) return; closeSidebar(); openDiscussion(button.getAttribute('data-discussion-id')); });
        });
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
    function turnReviewCardsMarkup(candidate) {
        var reviews = Array.isArray(candidate && candidate.turn_reviews) ? candidate.turn_reviews : [];
        return reviews.map(function (review, index) {
            var cs = review.communication_strategies || {};
            var io = review.ideas_organisation || {};
            var caution = review.asr_text_status === 'higher_confidence' ? '' : '<span class="speaking-turn-caution">AI transcript may contain recognition errors</span>';
            return '<article class="speaking-turn-card"><header><div><span class="speaking-turn-number">Turn ' + esc(index + 1) + '</span><span class="speaking-turn-time">' + esc(turnTime(review.start_ms)) + '–' + esc(turnTime(review.end_ms)) + '</span></div>' + caution + '</header><blockquote><span>What you said · AI transcript</span>' + esc(review.transcript_text || '') + '</blockquote><div class="speaking-turn-coaching"><section data-domain="cs"><p class="speaking-turn-domain">CS · Communication Strategies</p><p>' + esc(cs.commentary_zh || '') + '</p><div class="speaking-turn-sample"><span>Try saying</span><q>' + esc(cs.sample_en || '') + '</q></div></section><section data-domain="io"><p class="speaking-turn-domain">IO · Ideas &amp; Organisation</p><p>' + esc(io.commentary_zh || '') + '</p><div class="speaking-turn-sample"><span>Try saying</span><q>' + esc(io.sample_en || '') + '</q></div></section></div></article>';
        }).join('');
    }
    function candidateControls(item) {
        var candidateTiles = (item.candidates || []).map(detectedCandidateMarkup).join('');
        var candidateIntro = candidateTiles ? '<div class="speaking-candidate-grid">' + candidateTiles + '</div>' : '<div class="speaking-candidate-empty"><span aria-hidden="true">◎</span><p><strong>Candidates appear after transcription.</strong><br>Reusable voiceprints are checked automatically; unclear matches remain Speaker 1, Speaker 2, and so on.</p></div>';
        var participantRows = (item.participants || []).map(function (participant) { return participantRow(participant, item); }).join('');
        var rosterEditor = item.can_edit_roster ? '<div class="speaking-roster-editor"><label>VIP Student ID<input id="add-vip-id" placeholder="Login ID"></label><button class="outline-button" type="button" id="add-vip-participant">Invite VIP</button><label>Non-VIP name<input id="add-guest-name" placeholder="Self-declared name"></label><button class="outline-button" type="button" id="add-guest-participant">Add Non-VIP</button><p>Adding a name does not change the AI analysis. Unconfirmed Speakers stay anonymous.</p></div>' : '';
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
            rosterEditor: rosterEditor
        };
    }
    function reportDuration(item, report) {
        var transcript = report && Array.isArray(report.transcript) ? report.transcript : [];
        var lastEnd = transcript.reduce(function (maximum, line) { return Math.max(maximum, Number(line.end_ms || 0)); }, 0);
        var seconds = lastEnd > 0 ? Math.round(lastEnd / 1000) : Number(item.duration_seconds || 0);
        if (!seconds) return 'Pending';
        return Math.floor(seconds / 60) + ' min ' + String(seconds % 60).padStart(2, '0') + ' sec';
    }
    function reportInfoCardMarkup(item, report, controls) {
        var canShare = (item.participants || []).some(function (participant) { return participant.is_self && ['voiceprint_confirmed', 'student_confirmed', 'teacher_confirmed'].indexOf(participant.identity_status) >= 0; });
        var candidateCount = Number.isInteger(item.candidate_count) ? item.candidate_count : (report.candidates || []).length;
        var matchingDetails = controls.identityAccess || controls.rosterEditor ? '<details class="speaking-report-identity"><summary><span><strong>Candidate matching &amp; access</strong><small>Review invitations, voice matches, and names</small></span></summary>' + controls.identityAccess + controls.rosterEditor + '</details>' : '';
        return '<section class="speaking-report-card speaking-report-info-card"><header class="speaking-report-card-header"><div><p class="eyebrow accent">DISCUSSION DETAILS</p><h2>About this Discussion</h2><p>Your report uses the Set question, the private recording, and confirmed Candidate identities.</p></div><div class="speaking-report-card-actions"><button class="outline-button" type="button" id="view-discussion-prompt">View Set task</button>' + controls.voiceSearchButton + '</div></header>' +
            '<div class="speaking-report-facts"><dl><dt>Date</dt><dd>' + esc(formatDate(item.discussion_date)) + '</dd></dl><dl><dt>Recording</dt><dd>' + esc(reportDuration(item, report)) + '</dd></dl><dl><dt>Candidates</dt><dd>' + esc(candidateCount) + '</dd></dl><dl><dt>Report</dt><dd>Ready</dd></dl></div>' +
            '<div class="speaking-report-candidate-heading"><h3>Candidates</h3><span class="speaking-pill">' + esc(controls.candidatePill) + '</span></div>' + (controls.voiceSearchNote ? '<p class="speaking-voice-search-note" role="status">' + esc(controls.voiceSearchNote) + '</p>' : '') + controls.candidateIntro + matchingDetails +
            '<div class="speaking-report-share"><div><strong>Private report sharing</strong><p>' + (canShare ? 'Create a seven-day Student Share with your own confirmed name only.' : 'Confirm your voice before creating a Student Share.') + '</p></div>' + (canShare ? '<button class="primary-button" type="button" id="create-student-share">Create Student Share</button>' : '<span class="speaking-pill">Voice confirmation required</span>') + '</div><div id="student-share-result"></div></section>';
    }
    function personalAnalysisCardMarkup(report) {
        var own = (report.candidates || []).find(function (candidate) { return candidate.is_self; });
        if (!own) return '<section class="speaking-report-card speaking-personal-analysis"><header class="speaking-report-card-header"><div><p class="eyebrow accent">YOUR ANALYSIS</p><h2>Individual performance</h2></div></header><div class="speaking-report-empty"><span aria-hidden="true">◎</span><div><strong>Your voice is not connected to a Candidate yet.</strong><p>Use Candidate matching above. Your personal scores and coaching will appear only after your Speaker identity is confirmed.</p></div></div></section>';
        var labels = {
            communication_strategies: ['CS', 'Communication Strategies'],
            ideas_organisation: ['IO', 'Ideas & Organisation'],
            vocabulary_language_patterns: ['VL', 'Vocabulary & Language']
        };
        var domains = Object.keys(labels).map(function (key) {
            var domain = own.domains && own.domains[key];
            var score = domain && Number.isFinite(Number(domain.score)) ? Math.max(0, Math.min(7, Number(domain.score))) : 0;
            return '<article class="speaking-score-card" style="--score:' + score + '"><div class="speaking-score-head"><span><b>' + esc(labels[key][0]) + '</b>' + esc(labels[key][1]) + '</span><strong>' + esc(score) + '<small>/7</small></strong></div><p>' + esc(domain && domain.commentary_zh || 'No commentary is available for this dimension.') + '</p></article>';
        }).join('');
        domains += '<article class="speaking-score-card speaking-score-card-pd"><div class="speaking-score-head"><span><b>PD</b>Pronunciation &amp; Delivery</span><strong>—</strong></div><p>Not assessed · 暂不评论</p></article>';
        return '<section class="speaking-report-card speaking-personal-analysis"><header class="speaking-report-card-header speaking-personal-header"><span class="speaking-avatar" aria-hidden="true">' + esc(initials(own.speaker_label || 'You')) + '</span><div><p class="eyebrow accent">YOUR ANALYSIS</p><h2>' + esc(own.speaker_label || 'Your performance') + '</h2><p>' + esc(own.summary_zh || '') + '</p></div></header><div class="speaking-score-grid speaking-score-grid-four">' + domains + '</div><div class="speaking-coaching-grid">' + reportList('Strengths', own.strengths) + reportList('Priority actions', own.priority_actions) + reportList('Language suggestions', own.language_suggestions) + '</div></section>';
    }
    function turnAdviceCardMarkup(report) {
        var own = (report.candidates || []).find(function (candidate) { return candidate.is_self; });
        var reviews = Array.isArray(own && own.turn_reviews) ? own.turn_reviews : [];
        var body = reviews.length ? '<p class="speaking-turn-review-note">Each turn focuses on CS and IO. VL support is included inside the suggested language samples.</p><div class="speaking-turn-list">' + turnReviewCardsMarkup(own) + '</div>' : '<div class="speaking-report-empty"><span aria-hidden="true">◎</span><div><strong>No personal turns are connected yet.</strong><p>Once your Speaker identity is confirmed, this card will show advice for each of your turns.</p></div></div>';
        return '<section class="speaking-report-card speaking-turn-advice-card"><header class="speaking-report-card-header"><div><p class="eyebrow accent">TURN-BY-TURN REVIEW</p><h2>What you could say next time</h2><p>Replay the thinking behind every turn with a stronger CS or IO choice.</p></div><span class="speaking-pill">' + esc(reviews.length) + ' turn' + (reviews.length === 1 ? '' : 's') + '</span></header>' + body + '</section>';
    }
    function transcriptMarkup(report) {
        var own = (report.candidates || []).find(function (candidate) { return candidate.is_self; });
        var ownSpeakerKey = own && own.speaker_key;
        if (!Array.isArray(report.transcript) || !report.transcript.length) return '';
        return '<details class="speaking-report-card speaking-transcript"><summary><span><strong>Complete script</strong><small>Open the full Discussion transcript · your own turns are highlighted in yellow</small></span></summary><div class="speaking-transcript-lines">' + report.transcript.map(function (line) {
            var selfClass = ownSpeakerKey && line.speaker_key === ownSpeakerKey ? ' is-self' : '';
            return '<article class="speaking-transcript-line' + selfClass + '"><header><strong>' + esc(line.speaker_label || 'Speaker') + '</strong><small>' + esc(turnTime(line.start_ms)) + '–' + esc(turnTime(line.end_ms)) + '</small></header><p>' + esc(line.text) + '</p></article>';
        }).join('') + '</div></details>';
    }
    function reportReadyMarkup(item) {
        var report = item.report;
        var controls = candidateControls(item);
        return '<article class="speaking-detail-card speaking-report-phase"><div class="speaking-report-nav"><button class="back-link" type="button" id="close-discussion">‹ Discussions</button><span class="speaking-pill" data-tone="ready">Report ready</span></div><div class="speaking-report-layout">' + reportInfoCardMarkup(item, report, controls) + personalAnalysisCardMarkup(report) + turnAdviceCardMarkup(report) + transcriptMarkup(report) + '</div></article>';
    }
    function reportProcessingMarkup(item) {
        var controls = candidateControls(item);
        var working = ['queued', 'processing'].indexOf(item.analysis_status) >= 0;
        var failed = item.analysis_status === 'failed';
        var stageTitle = item.analysis_status === 'queued' ? 'Your report is in the queue' : item.analysis_status === 'processing' ? 'AI is building your report' : failed ? 'The report needs another try' : 'Your recording is ready for analysis';
        var stageCopy = item.analysis_status === 'queued' ? 'The recording is secure. Speaking Lab will begin transcription as soon as the analysis worker is available.' : item.analysis_status === 'processing' ? 'Speaking Lab is transcribing the Discussion, detecting Candidates, checking voiceprints, and preparing personal coaching.' : failed ? 'Your recording is still here. Retry the analysis without uploading it again.' : 'Start the analysis to create the DSE report.';
        var action = working ? '<span class="speaking-pill speaking-stage" aria-live="polite">' + esc(item.analysis_status === 'queued' ? 'Waiting for analysis worker' : 'Transcribing · matching · coaching') + '</span>' : '<button class="primary-button" type="button" id="start-analysis">' + (failed ? 'Retry analysis' : 'Analyse Discussion') + '</button>';
        return '<article class="speaking-detail-card speaking-report-phase speaking-report-processing"><div class="speaking-report-nav"><button class="back-link" type="button" id="close-discussion">‹ Discussions</button><span class="speaking-pill" data-tone="working">Report in progress</span></div><div class="speaking-report-layout"><section class="speaking-report-card speaking-report-progress-card"><span class="speaking-upload-spinner" aria-hidden="true"></span><p class="eyebrow accent">REPORT PROGRESS</p><h2>' + esc(stageTitle) + '</h2><p>' + esc(stageCopy) + '</p><ol class="speaking-report-stages"><li class="is-done"><span>1</span><strong>Recording uploaded</strong></li><li class="' + (working ? 'is-current' : '') + '"><span>2</span><strong>Transcript &amp; Candidates</strong></li><li class="' + (item.analysis_status === 'processing' ? 'is-current' : '') + '"><span>3</span><strong>Voice matching</strong></li><li><span>4</span><strong>Personal report</strong></li></ol><div class="speaking-detail-actions">' + action + '<button class="outline-button" type="button" id="view-discussion-prompt">View Set task</button></div></section><section class="speaking-report-card speaking-processing-candidates"><header class="speaking-report-card-header"><div><p class="eyebrow accent">CANDIDATE MATCHING</p><h2>Candidates</h2><p>Confirmed voiceprints are named automatically. Unclear or unmatched voices stay anonymous.</p></div><div class="speaking-report-card-actions">' + controls.voiceSearchButton + '<span class="speaking-pill">' + esc(controls.candidatePill) + '</span></div></header>' + (controls.voiceSearchNote ? '<p class="speaking-voice-search-note" role="status">' + esc(controls.voiceSearchNote) + '</p>' : '') + controls.candidateIntro + controls.identityAccess + controls.rosterEditor + '</section></div></article>';
    }
    function detailMarkup(item) {
        if (item.recording_status === 'uploaded') return item.analysis_status === 'ready' && item.report ? reportReadyMarkup(item) : reportProcessingMarkup(item);
        var canRecord = item.recording_status !== 'uploaded';
        var targetMinutes = Math.max(3, Math.min(30, Number(item.duration_seconds || 480) / 60));
        var recording = canRecord ? '<section class="speaking-section-card speaking-recording-card" data-recording-state="idle"><header><div><h3>Record the Discussion</h3><p>Record here or choose one audio file. Nothing is uploaded until you confirm.</p></div><span class="speaking-pill" id="recording-target-pill">Target ' + esc(targetMinutes % 1 ? targetMinutes.toFixed(1) : targetMinutes) + ' min</span></header>' +
            '<div class="speaking-recording-state" id="recording-ready"><div class="speaking-recording-settings"><label>Target length<div class="speaking-duration-field"><input id="recording-duration" type="number" min="3" max="30" step="0.5" value="' + esc(targetMinutes) + '" inputmode="decimal"><span>minutes</span></div></label></div><div class="speaking-recording-choice"><button class="primary-button" type="button" id="record-now">Record on this device</button><label class="outline-button speaking-file-button" id="audio-file-label">Choose audio file<input type="file" accept="audio/*" hidden id="audio-file"></label></div><p class="speaking-recording-note">Keep this page open while recording. You can listen before anything is uploaded.</p><p class="speaking-quality-warning" id="recording-message" role="status" aria-live="polite"></p></div>' +
            '<div class="speaking-recording-state speaking-recording-live" id="recording-live" hidden><div class="speaking-recording-live-label"><span aria-hidden="true"></span><strong id="recording-live-status">Recording</strong></div><div class="speaking-recording-time" id="recording-time">00:00 / ' + esc(String(Math.floor(Number(item.duration_seconds || 480) / 60)).padStart(2, '0') + ':' + String(Number(item.duration_seconds || 480) % 60).padStart(2, '0')) + '</div><p class="speaking-quality-warning" id="quality-warning" role="status" aria-live="polite">Keep this page open and the screen awake.</p><button class="danger-button speaking-finish-recording" type="button" id="stop-recording">Finish recording</button></div>' +
            '<div class="speaking-recording-state speaking-recording-review" id="recording-review" hidden><div class="speaking-recording-ready-mark" aria-hidden="true">✓</div><h4>Recording ready</h4><p id="recording-review-copy">Listen once if you want to check it, then upload and start the analysis.</p><div class="speaking-detail-actions"><button class="outline-button" type="button" id="preview-recording">Play recording</button><button class="outline-button" type="button" id="replace-recording">Replace recording</button><button class="primary-button" type="button" id="upload-recording">Upload &amp; analyse</button></div></div>' +
            '<div class="speaking-recording-state speaking-recording-uploading" id="recording-uploading" hidden aria-live="polite" aria-busy="true"><span class="speaking-upload-spinner" aria-hidden="true"></span><h4>Uploading securely</h4><p>Keep this page open. Analysis will begin automatically.</p><div class="speaking-upload-progress-track" role="progressbar" aria-label="Secure upload in progress"><span></span></div></div></section>' : '';
        var stage = item.analysis_status === 'queued' ? 'Preparing transcript and Candidates' : item.analysis_status === 'processing' ? 'Matching voices and analysing discussion' : '';
        var analysis = item.recording_status === 'uploaded' && item.analysis_status !== 'ready' ? '<div class="speaking-analysis-action">' + (stage ? '<span class="speaking-pill speaking-stage">' + esc(stage) + '</span>' : '<button class="primary-button" type="button" id="start-analysis">' + (item.analysis_status === 'failed' ? 'Retry analysis' : 'Analyse Discussion') + '</button>') + '</div>' : '';
        var reportMarkup = '';
        var rosterEditor = item.can_edit_roster ? '<div class="speaking-roster-editor"><label>VIP Student ID<input id="add-vip-id" placeholder="Login ID"></label><button class="outline-button" type="button" id="add-vip-participant">Invite VIP</button><label>Non-VIP name<input id="add-guest-name" placeholder="Self-declared name"></label><button class="outline-button" type="button" id="add-guest-participant">Add Non-VIP</button><p>Adding a name does not change the AI analysis. Unconfirmed Speakers stay anonymous.</p></div>' : '';
        var candidateTiles = (item.candidates || []).map(detectedCandidateMarkup).join('');
        var candidateIntro = candidateTiles ? '<div class="speaking-candidate-grid">' + candidateTiles + '</div>' : '<div class="speaking-candidate-empty"><span aria-hidden="true">◎</span><p><strong>Candidates appear after transcription.</strong><br>Reusable voiceprints are checked automatically; unclear matches remain Speaker 1, Speaker 2, and so on.</p></div>';
        var participantRows = (item.participants || []).map(function (participant) { return participantRow(participant, item); }).join('');
        var candidateCountText = Number.isInteger(item.candidate_count) ? String(item.candidate_count) : 'Pending';
        var candidatePill = Number.isInteger(item.candidate_count) ? item.candidate_count + ' detected' : 'Waiting for audio';
        var voiceSearchWorking = ['queued', 'processing'].indexOf(item.voice_match_status) >= 0;
        var voiceSearchButton = item.can_search_voice_matches ? '<button class="outline-button speaking-voice-search' + (voiceSearchWorking ? ' is-searching' : '') + '" type="button" id="search-voice-matches"' + (voiceSearchWorking ? ' disabled aria-busy="true"' : '') + '><svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="5.5"></circle><path d="m15 15 4.25 4.25M7.5 10.5h1.3l1.1-2.2 1.6 4.4 1.2-2.2h.8"></path></svg><span>' + (voiceSearchWorking ? 'Searching voices…' : 'Search voice matches') + '</span></button>' : '';
        var voiceSearchNote = '';
        if (voiceSearchWorking) voiceSearchNote = 'Checking the Candidate clips against currently registered voiceprints.';
        else if (item.voice_match_status === 'failed') voiceSearchNote = 'The last voice search could not finish. You can try again.';
        else if (item.voice_match_last_run_at && item.voice_match_safe_error_code) voiceSearchNote = 'Search completed, but automatic matching was temporarily unavailable.';
        else if (item.voice_match_last_run_at && Number(item.voice_match_last_changed_count || 0) > 0) voiceSearchNote = Number(item.voice_match_last_changed_count) + ' voice match update' + (Number(item.voice_match_last_changed_count) === 1 ? '' : 's') + ' found. Matches at 70% or above are locked automatically; lower scores require the student to listen and confirm.';
        else if (item.voice_match_last_run_at) voiceSearchNote = 'Search complete. No new reliable voice matches were found.';
        var candidateHeaderActions = '<span class="speaking-candidate-header-actions">' + voiceSearchButton + '<span class="speaking-pill">' + esc(candidatePill) + '</span></span>';
        var identityAccess = participantRows ? '<div class="speaking-identity-access"><h4>Identity &amp; access</h4><ul class="speaking-participants">' + participantRows + '</ul></div>' : '';
        return '<article class="speaking-detail-card">' +
            '<div class="speaking-detail-hero"><div class="speaking-detail-top"><button class="back-link" type="button" id="close-discussion">‹ Discussions</button>' +
            '<div class="speaking-detail-title-row"><div><p class="eyebrow accent">DISCUSSION</p><h2>' + esc(item.title) + '</h2></div><p class="speaking-detail-date">' + esc(formatDate(item.discussion_date)) + '</p></div></div>' +
            workflowMarkup(item) + '<div class="speaking-detail-grid"><dl><dt>Candidates</dt><dd>' + esc(candidateCountText) + '</dd></dl><dl><dt>Recording</dt><dd>' + esc(readableStatus(item.recording_status)) + '</dd></dl><dl><dt>Analysis</dt><dd>' + esc(readableStatus(item.analysis_status)) + '</dd></dl></div></div>' +
            '<div class="speaking-detail-body"><section class="speaking-section-card speaking-prompt-card"><header><div><h3>Discussion prompt</h3><p>The DSE task your group should address.</p></div></header><p class="speaking-prompt-text">' + esc(item.prompt_text) + '</p></section>' +
            '<section class="speaking-section-card speaking-candidates-card"><header><div><h3>Candidates</h3><p>Voiceprint matches at 70% or above are named and opened automatically. Lower scores stay anonymous until the matched VIP listens and confirms.</p></div>' + candidateHeaderActions + '</header>' + (voiceSearchNote ? '<p class="speaking-voice-search-note" role="status">' + esc(voiceSearchNote) + '</p>' : '') + candidateIntro + identityAccess + rosterEditor + '</section>' +
            recording + analysis + reportMarkup + '</div></article>';
    }
    function bindInvitationActions() {
        var viewPrompt = document.getElementById('view-discussion-prompt');
        if (viewPrompt) viewPrompt.addEventListener('click', openPromptDialog);
        var voiceSearch = document.getElementById('search-voice-matches');
        if (voiceSearch) voiceSearch.addEventListener('click', function () {
            voiceSearch.disabled = true;
            voiceSearch.classList.add('is-searching');
            voiceSearch.setAttribute('aria-busy', 'true');
            call('startVoiceRematch', { discussion_id: selectedId, operation_id: 'voice-rematch-' + selectedId + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8) })
                .then(function () { return openDiscussion(selectedId); })
                .catch(function (error) { setStatus(friendlyError(error), true); voiceSearch.disabled = false; voiceSearch.classList.remove('is-searching'); voiceSearch.removeAttribute('aria-busy'); });
        });
        var addVip = document.getElementById('add-vip-participant'); if (addVip) addVip.addEventListener('click', function () { var input = document.getElementById('add-vip-id'); addVip.disabled = true; call('addVipParticipant', { discussion_id: selectedId, student_id: input.value }).then(function () { return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); addVip.disabled = false; }); });
        var addGuest = document.getElementById('add-guest-participant'); if (addGuest) addGuest.addEventListener('click', function () { var input = document.getElementById('add-guest-name'); addGuest.disabled = true; call('addGuestParticipant', { discussion_id: selectedId, guest_name: input.value }).then(function () { return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); addGuest.disabled = false; }); });
        detail.querySelectorAll('[data-remove-participant]').forEach(function (button) { button.addEventListener('click', function () { if (!window.confirm('Remove this participant from the Discussion?')) return; button.disabled = true; call('removeParticipant', { discussion_id: selectedId, participant_id: button.getAttribute('data-remove-participant') }).then(function () { return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); button.disabled = false; }); }); });
        detail.querySelectorAll('[data-rename-guest]').forEach(function (button) { button.addEventListener('click', function () { var name = window.prompt('Guest name', button.getAttribute('data-current-name') || ''); if (!name) return; button.disabled = true; call('renameGuest', { discussion_id: selectedId, participant_id: button.getAttribute('data-rename-guest'), guest_name: name }).then(function () { return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); button.disabled = false; }); }); });
        detail.querySelectorAll('[data-invite-action]').forEach(function (button) {
            button.addEventListener('click', function () {
                button.disabled = true;
                call('respondInvitation', { discussion_id: selectedId, participant_id: button.getAttribute('data-participant-id'), response: button.getAttribute('data-invite-action') }).then(function () { return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); button.disabled = false; });
            });
        });
        detail.querySelectorAll('[data-confirm-voice]').forEach(function (button) {
            button.addEventListener('click', function () {
                button.disabled = true;
                call('confirmVoice', { discussion_id: selectedId, participant_id: button.getAttribute('data-participant-id'), speaker_key: button.getAttribute('data-speaker-key'), mapping_revision: Number(button.getAttribute('data-mapping-revision')), confirmed: button.getAttribute('data-confirm-voice') === 'true' }).then(function () { return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); button.disabled = false; });
            });
        });
        detail.querySelectorAll('[data-playback-kind]').forEach(function (button) {
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
        var share = document.getElementById('create-student-share');
        if (share) share.addEventListener('click', function () { share.disabled = true; call('createStudentShare', { discussion_id: selectedId }).then(function (result) { var container = document.getElementById('student-share-result'); var url = new URL(result.share_url, window.location.href).href; container.innerHTML = '<p><a href="' + esc(url) + '" target="_blank" rel="noopener">Open private snapshot</a> · expires ' + esc(result.expires_at || 'in 7 days') + '</p><div class="speaking-detail-actions"><button class="outline-button" type="button" id="copy-student-share">Copy link</button><button class="outline-button" type="button" id="revoke-student-share">Revoke link</button></div>'; document.getElementById('copy-student-share').addEventListener('click', function () { if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { setStatus('Private link copied.'); }); }); document.getElementById('revoke-student-share').addEventListener('click', function () { call('revokeShare', { share_id: result.share_id }).then(function () { container.innerHTML = '<p>Link revoked.</p>'; }); }); }).catch(function (error) { setStatus(friendlyError(error), true); share.disabled = false; }); });
    }
    function invitationMarkup(invitation) {
        return '<form method="dialog"><div class="speaking-dialog-head"><p class="eyebrow accent">DISCUSSION INVITATION</p><h2 id="invitation-dialog-title">' + esc(invitation.title) + '</h2><p>' + esc(formatDate(invitation.discussion_date)) + ' · Invited by ' + esc(invitation.inviter_name || 'your teacher or group') + '</p></div><ul class="speaking-participants">' + (invitation.participants || []).map(function (participant) { var name = participant.display_name || 'Participant'; return '<li class="speaking-participant"><span class="speaking-participant-identity"><span class="speaking-avatar" aria-hidden="true">' + esc(initials(name)) + '</span><span><strong>' + esc(name) + '</strong><small>' + esc(participant.kind === 'guest' ? 'Guest participant · Name not verified' : readableStatus(participant.invitation_status)) + '</small></span></span></li>'; }).join('') + '</ul><div class="speaking-dialog-actions"><button class="primary-button" type="button" id="accept-invitation">Accept</button><button class="outline-button" type="button" id="decline-invitation">Decline</button><button class="outline-button" value="cancel">Close</button></div></form>';
    }
    function elapsedText() {
        var seconds = Math.max(0, Math.floor((performance.now() - recordingStartedAt) / 1000));
        var elapsed = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
        var target = String(Math.floor(recordingTargetSeconds / 60)).padStart(2, '0') + ':' + String(recordingTargetSeconds % 60).padStart(2, '0');
        return elapsed + ' / ' + target;
    }
    function recordingElapsedSeconds() {
        return recordingStartedAt ? Math.max(0, (performance.now() - recordingStartedAt) / 1000) : 0;
    }
    function recordingLocksPage() {
        return ['requesting', 'recording', 'stopping', 'uploading'].indexOf(recordingState) >= 0;
    }
    function recordingNeedsDiscardConfirmation() {
        return recordingState === 'recording' || recordingState === 'review';
    }
    function setRecordingMessage(message) {
        var element = document.getElementById('recording-message');
        if (element) element.textContent = message || '';
    }
    function setRecordingState(nextState) {
        recordingState = nextState;
        var card = document.querySelector('.speaking-recording-card');
        if (card) card.setAttribute('data-recording-state', nextState);
        var ready = document.getElementById('recording-ready');
        var live = document.getElementById('recording-live');
        var review = document.getElementById('recording-review');
        var uploading = document.getElementById('recording-uploading');
        if (ready) ready.hidden = nextState !== 'idle';
        if (live) live.hidden = ['requesting', 'recording', 'stopping'].indexOf(nextState) < 0;
        if (review) review.hidden = nextState !== 'review';
        if (uploading) uploading.hidden = nextState !== 'uploading';
        var liveStatus = document.getElementById('recording-live-status');
        if (liveStatus) liveStatus.textContent = nextState === 'requesting' ? 'Starting microphone…' : nextState === 'stopping' ? 'Finishing recording…' : 'Recording';
        var finish = document.getElementById('stop-recording');
        if (finish) { finish.textContent = nextState === 'requesting' ? 'Cancel' : 'Finish recording'; finish.disabled = nextState === 'stopping'; }
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
        if (recordingLocksPage()) {
            if (recordingState === 'uploading') setStatus('Please wait for the secure upload to finish.', true);
            return false;
        }
        if (recordingNeedsDiscardConfirmation() && !window.confirm('Discard this recording and leave this Discussion?')) return false;
        if (recordingNeedsDiscardConfirmation()) discardLocalRecording();
        return true;
    }
    function showQualityWarning(message) { var warning = document.getElementById('quality-warning'); if (warning) warning.textContent = message || ''; }
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
            function frame() {
                if (!qualityAnalyser) return;
                qualityAnalyser.getFloatTimeDomainData(samples);
                var sum = 0; var clipped = 0;
                for (var index = 0; index < samples.length; index += 1) { var value = samples[index]; sum += value * value; if (Math.abs(value) >= CLIPPING_AMPLITUDE) clipped += 1; }
                var rms = Math.sqrt(sum / samples.length);
                var dbfs = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
                var now = performance.now();
                var muted = stream.getTracks().some(function (track) { return track.readyState === 'ended' || track.muted; });
                var issue = '';
                var thresholdSeconds = 0;
                var message = '';
                if (now >= qualityReadyAt && (muted || dbfs === -Infinity)) { issue = 'input'; thresholdSeconds = INPUT_LOSS_SECONDS; message = 'Microphone signal lost. Check that the phone can still hear the group.'; }
                else if (now >= qualityReadyAt && clipped / samples.length >= 0.01) { issue = 'clipping'; thresholdSeconds = 1; message = 'The sound is clipping. Move the phone slightly farther away.'; }
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
            try { activeRecorder.start(1000); }
            catch (error) { recordingStartFailure('This browser could not begin recording. Choose an audio file instead.'); return; }
            recordingStartedAt = performance.now();
            recordingTargetNoticeShown = false;
            monitorQuality(stream);
            stream.getTracks().forEach(function (track) { track.addEventListener('ended', function () { if (captureGeneration === recordingCaptureGeneration && recorder === activeRecorder && activeRecorder.state !== 'inactive') { showQualityWarning('Microphone signal ended. Finishing the recording safely…'); setRecordingState('stopping'); activeRecorder.stop(); } }); });
            setRecordingState('recording');
            var timer = document.getElementById('recording-time');
            if (timer) timer.textContent = elapsedText();
            recordingTimer = window.setInterval(function () {
                if (timer) timer.textContent = elapsedText();
                var elapsed = recordingElapsedSeconds();
                if (!recordingTargetNoticeShown && elapsed >= recordingTargetSeconds) { recordingTargetNoticeShown = true; showQualityWarning('Target time reached. Finish at the group\'s next natural stopping point.'); }
                if (elapsed >= 1800 && recorder === activeRecorder && activeRecorder.state !== 'inactive') { showQualityWarning('The 30-minute limit was reached. Finishing the recording safely…'); setRecordingState('stopping'); activeRecorder.stop(); }
            }, 250);
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
        if (recordingState === 'requesting') { discardLocalRecording(); setRecordingMessage('Recording cancelled.'); return; }
        if (!recorder || recorder.state === 'inactive' || recordingState !== 'recording') return;
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
        var file = document.getElementById('audio-file'); if (file) file.addEventListener('change', function () { var chosen = file.files && file.files[0]; file.value = ''; prepareAudioFile(chosen); });
        detail.querySelectorAll('[data-voice-record]').forEach(function (button) { button.addEventListener('click', function () { startVoiceReferenceRecording(button.getAttribute('data-voice-record'), button.getAttribute('data-voice-name') || 'this participant', button); }); });
        detail.querySelectorAll('[data-voice-file]').forEach(function (input) { input.addEventListener('change', function () { var file = input.files[0]; if (!file) return; var name = input.getAttribute('data-voice-name') || 'this participant'; if (!window.confirm('Use this Voice Reference for ' + name + '?')) { input.value = ''; return; } setStatus('Uploading Voice Reference…'); uploadBlob(file, 'voice_reference', input.getAttribute('data-voice-file')).then(function () { return openDiscussion(selectedId); }).then(function () { setStatus('Voice Reference uploaded.'); }).catch(function (error) { setStatus(friendlyError(error), true); }); }); });
        var analysis = document.getElementById('start-analysis'); if (analysis) analysis.addEventListener('click', function () { analysis.disabled = true; call('startAnalysis', { discussion_id: selectedId, operation_id: 'analysis-' + selectedId }).then(function () { return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); analysis.disabled = false; }); });
    }
    function acknowledgeIdentityNotice(item) {
        var own = item && (item.participants || []).find(function (participant) { return participant.is_self && participant.identity_notice_unread; });
        if (!own) return;
        own.identity_notice_unread = false;
        call('acknowledgeIdentityNotice', { discussion_id: item.discussion_id }).then(function () {
            return call('listDiscussions', { page_size: 50 });
        }).then(function (result) {
            renderList(result.discussions || []);
        }).catch(function () { /* The notice remains unread on the server and will reappear safely. */ });
    }
    function openDiscussion(idValue) {
        if (recordingState !== 'idle') return Promise.resolve(null);
        selectedId = idValue;
        pollGeneration += 1;
        if (pollTimer) { window.clearTimeout(pollTimer); pollTimer = 0; }
        window.history.replaceState(null, '', 'speaking-lab.html?discussion=' + encodeURIComponent(idValue));
        var generation = pollGeneration;
        return call('getDiscussion', { discussion_id: idValue }).then(function (result) {
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
            }
            setStatus('');
            schedulePoll(result.discussion, generation);
        }).catch(function (error) { setStatus(friendlyError(error), true); });
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
                detail.innerHTML = detailMarkup(result.discussion); updateToolbar(result.discussion); bindInvitationActions(); bindRecording(); schedulePoll(result.discussion, generation);
            }).catch(function () { schedulePoll(item, generation); });
        }, delay);
    }
    function loadList() {
        document.body.classList.remove('speaking-detail-open');
        if (!selectedId) updateToolbar(null);
        return call('listDiscussions', { page_size: 50 }).then(function (result) { renderList(result.discussions || []); setStatus(''); if (selectedId) return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); });
    }
    sidebarToggle.addEventListener('click', function () { if (sidebar.classList.contains('is-open')) closeSidebar({ restoreFocus: true }); else openSidebar(); });
    toolbarEdit.addEventListener('click', openTitleDialog);
    document.getElementById('discussion-prompt-close').addEventListener('click', function () {
        if (promptDialog.open && promptDialog.close) promptDialog.close();
        else promptDialog.removeAttribute('open');
    });
    sidebarScrim.addEventListener('click', function () { closeSidebar({ restoreFocus: true }); });
    sidebarNew.addEventListener('click', openNewDiscussionDialog);
    document.getElementById('new-discussion').addEventListener('click', openNewDiscussionDialog);
    document.getElementById('open-my-voiceprint').addEventListener('click', openVoiceprintDialog);
    document.getElementById('voiceprint-record').addEventListener('click', startMyVoiceprintRecording);
    document.getElementById('voiceprint-stop').addEventListener('click', stopMyVoiceprintRecording);
    document.getElementById('voiceprint-close').addEventListener('click', function () {
        if (voiceprintSaving) { document.getElementById('voiceprint-message').textContent = 'Wait until Tencent finishes saving this voiceprint.'; return; }
        resetVoiceprintDialog();
        if (voiceprintDialog.open && voiceprintDialog.close) voiceprintDialog.close(); else voiceprintDialog.removeAttribute('open');
    });
    document.getElementById('voiceprint-delete').addEventListener('click', function () {
        if (voiceprintSaving || voiceprintController) return;
        if (!window.confirm('Remove your reusable voiceprint from Tencent? Future Discussions will need a new sample until you record it again.')) return;
        var button = document.getElementById('voiceprint-delete');
        button.disabled = true;
        call('deleteMyVoiceprint', { operation_id: 'voiceprint-delete-' + Date.now().toString(36) }).then(function (result) {
            renderMyVoiceprint({ target: result.target, provider_configured: true });
            resetVoiceprintDialog();
            button.hidden = true;
            document.getElementById('voiceprint-message').textContent = 'Voiceprint removed.';
        }).catch(function (error) {
            document.getElementById('voiceprint-message').textContent = friendlyError(error);
        }).finally(function () { button.disabled = false; });
    });
    form.addEventListener('submit', function (event) {
        if (event.submitter && event.submitter.value === 'cancel') return;
        event.preventDefault();
        var button = document.getElementById('discussion-create');
        var durationValue = document.getElementById('discussion-duration').value;
        var createPayload = {
            operation_id: 'create-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9),
            title: document.getElementById('discussion-title').value,
            prompt_text: document.getElementById('discussion-prompt').value,
            discussion_date: document.getElementById('discussion-date').value || shanghaiToday()
        };
        if (durationValue) createPayload.duration_seconds = Number(durationValue);
        button.disabled = true;
        call('createDiscussion', createPayload).then(function (result) {
            selectedId = result.discussion.discussion_id;
            dialog.close();
            form.reset();
            document.getElementById('discussion-date').value = shanghaiToday();
            return loadList();
        }).catch(function (error) {
            setStatus(friendlyError(error), true);
        }).finally(function () {
            button.disabled = false;
        });
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
    document.addEventListener('visibilitychange', function () { if (document.hidden || recordingState !== 'idle') return; if (selectedId) openDiscussion(selectedId); else loadList(); });
    window.addEventListener('beforeunload', function (event) { if (!recordingLocksPage() && !recordingNeedsDiscardConfirmation()) return; event.preventDefault(); event.returnValue = ''; });
    window.addEventListener('pageshow', function (event) { if (event.persisted) closeSidebar(); });

    closeSidebar();

    auth.getSession().then(function (session) {
        if (!session || session.mode !== 'student') { window.location.replace('index.html?return=speaking-lab.html'); return null; }
        return loadMyVoiceprint().then(function () { return loadList(); });
    }).catch(function () { window.location.replace('index.html?return=speaking-lab.html'); });
    window.addEventListener('pagehide', function () { discardLocalRecording(); voiceDiscard = true; stopVoiceReferenceRecording(); if (voiceprintController) voiceprintController.cancel(); voiceprintController = null; if (voiceStream) voiceStream.getTracks().forEach(function (track) { track.stop(); }); if (voiceTimer) window.clearInterval(voiceTimer); if (pollTimer) window.clearTimeout(pollTimer); });
})(window);
