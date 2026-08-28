(function (window) {
    'use strict';

    var api = window.MrCatCloud;
    var auth = window.MrCatAuth;
    var list = document.getElementById('speaking-list');
    var detail = document.getElementById('speaking-detail');
    var status = document.getElementById('speaking-status');
    var identity = document.getElementById('speaking-identity');
    var dialog = document.getElementById('discussion-dialog');
    var invitationDialog = document.getElementById('invitation-dialog');
    var invitationDialogContent = document.getElementById('invitation-dialog-content');
    var form = document.getElementById('discussion-form');
    var selectedId = new URLSearchParams(window.location.search).get('discussion') || '';
    var activeStream = null;
    var recorder = null;
    var recordingChunks = [];
    var recordingStartedAt = 0;
    var recordingPausedAt = 0;
    var recordingPausedTotal = 0;
    var recordingTimer = 0;
    var recordingBlob = null;
    var recordingTargetSeconds = 0;
    var qualityRecoveryTimer = 0;
    var qualityFrame = 0;
    var qualityAnalyser = null;
    var qualityContext = null;
    var qualityBadSince = 0;
    var qualityReadyAt = 0;
    var LOW_VOLUME_DBFS = -45;
    var CLIPPING_AMPLITUDE = 0.98;
    var INPUT_LOSS_SECONDS = 3;
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
    var READ_ACTIONS = {
        getMyVoiceprint: true,
        listDiscussions: true,
        getDiscussion: true,
        getVoiceConfirmationPlayback: true
    };

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
        status.textContent = message || '';
        status.classList.toggle('is-error', Boolean(isError));
    }
    function friendlyError(error) {
        if (error && error.code === 'SPEAKING_PROVIDER_NOT_CONFIGURED') return 'Speaking analysis is not enabled yet. Your recording is still private.';
        if (error && error.message) return error.message;
        return 'The Speaking Lab request could not be completed. Please try again.';
    }
    function formatDate(value) {
        if (!value) return 'Date not set';
        var date = new Date(value + (String(value).length === 10 ? 'T00:00:00+08:00' : ''));
        return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    }
    function voiceprintTime(seconds) {
        var value = Math.max(0, Math.min(20, Math.floor(Number(seconds || 0))));
        return '00:' + String(value).padStart(2, '0') + ' / 00:20';
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
        var pending = (item.participants || []).some(function (participant) { return participant.invitation_status === 'pending'; });
        return '<button class="speaking-card" type="button" data-discussion-id="' + esc(item.discussion_id) + '">' +
            '<span><strong>' + esc(item.title || 'Untitled Discussion') + '</strong><small>' + esc(formatDate(item.discussion_date)) + '</small></span>' +
            '<span class="speaking-card-meta"><span class="speaking-pill">' + esc(item.participant_count || 0) + ' participants</span><span class="speaking-pill">' + esc(item.analysis_status || 'not ready') + '</span>' + (pending ? '<span class="speaking-pill">Invitation</span>' : '') + '</span></button>';
    }
    function renderList(items) {
        if (!items.length) { list.innerHTML = '<div class="speaking-detail-card"><h2>Start your first Discussion</h2><p>Invite your group, add the DSE task prompt, and record when everyone is ready.</p></div>'; return; }
        list.innerHTML = items.map(listCard).join('');
        list.querySelectorAll('[data-discussion-id]').forEach(function (button) {
            button.addEventListener('click', function () { openDiscussion(button.getAttribute('data-discussion-id')); });
        });
    }
    function participantRow(participant, item) {
        var rosterName = participant.roster_display_name || participant.display_name;
        var label = participant.kind === 'guest' ? rosterName + ' · Guest participant · Name not verified' : rosterName;
        var actions = '';
        if (participant.invitation_status === 'pending' && participant.is_self) {
            actions = '<button class="outline-button" type="button" data-invite-action="accept" data-participant-id="' + esc(participant.participant_id) + '">Accept</button><button class="outline-button" type="button" data-invite-action="decline" data-participant-id="' + esc(participant.participant_id) + '">Decline</button>';
        }
        if (participant.is_self && participant.matched_speaker_key && participant.identity_status !== 'disputed') {
            actions += '<button class="outline-button" type="button" data-playback-kind="reference" data-participant-id="' + esc(participant.participant_id) + '">Listen to my sample</button><button class="outline-button" type="button" data-playback-kind="formal_excerpt" data-participant-id="' + esc(participant.participant_id) + '">Listen to matched excerpt</button>';
            if (['ai_matched', 'unconfirmed', 'unmatched'].indexOf(participant.identity_status) >= 0) actions += '<button class="primary-button" type="button" data-confirm-voice="true" data-participant-id="' + esc(participant.participant_id) + '" data-speaker-key="' + esc(participant.matched_speaker_key) + '" data-mapping-revision="' + esc(participant.mapping_revision) + '">This is my voice</button>';
            actions += '<button class="outline-button" type="button" data-confirm-voice="false" data-participant-id="' + esc(participant.participant_id) + '" data-speaker-key="' + esc(participant.matched_speaker_key) + '" data-mapping-revision="' + esc(participant.mapping_revision) + '">This isn\'t my voice</button>';
        }
        if (participant.is_self && participant.identity_status === 'disputed') actions += '<span class="speaking-pill">Identity under teacher review</span>';
        if (item.can_edit_roster && participant.kind === 'guest') actions += '<button class="outline-button" type="button" data-rename-guest="' + esc(participant.participant_id) + '" data-current-name="' + esc(rosterName) + '">Rename</button>';
        if (item.can_edit_roster && item.roster_status === 'draft' && !participant.is_self) actions += '<button class="outline-button" type="button" data-remove-participant="' + esc(participant.participant_id) + '">Remove</button>';
        return '<li class="speaking-participant"><span><strong>' + esc(label) + '</strong><small>' + esc(participant.invitation_status || 'accepted') + ' · ' + esc(participant.voice_reference_status || 'missing') + '</small></span><span>' + actions + '</span></li>';
    }
    function reportList(title, items) {
        if (!Array.isArray(items) || !items.length) return '';
        return '<h4>' + esc(title) + '</h4><ul>' + items.map(function (item) { return '<li>' + esc(item) + '</li>'; }).join('') + '</ul>';
    }
    function internalReportMarkup(item) {
        var report = item.report;
        if (!report) return '';
        var canShare = (item.participants || []).some(function (participant) { return participant.is_self && ['student_confirmed', 'teacher_confirmed'].indexOf(participant.identity_status) >= 0; });
        var domainLabels = { communication_strategies: 'Communication strategies', vocabulary_language_patterns: 'Vocabulary & language', ideas_organisation: 'Ideas & organisation' };
        var candidates = (report.candidates || []).map(function (candidate) {
            var domains = Object.keys(domainLabels).map(function (key) {
                var domain = candidate.domains && candidate.domains[key];
                return domain ? '<div class="speaking-detail-grid"><dl><dt>' + esc(domainLabels[key]) + '</dt><dd>' + esc(domain.score) + '/7</dd></dl></div><p>' + esc(domain.commentary_zh || '') + '</p>' : '';
            }).join('');
            return '<article class="speaking-upload-panel"><h4>' + esc(candidate.speaker_label || 'Speaker') + '</h4><p>' + esc(candidate.summary_zh || '') + '</p>' + domains + '<p><strong>Pronunciation &amp; Delivery:</strong> Not assessed</p>' + reportList('Strengths', candidate.strengths) + reportList('Priority actions', candidate.priority_actions) + reportList('Language suggestions', candidate.language_suggestions) + '</article>';
        }).join('');
        var transcript = (report.transcript || []).length ? '<details class="speaking-upload-panel"><summary>Complete transcript</summary>' + report.transcript.map(function (line) { return '<p><strong>' + esc(line.speaker_label || 'Speaker') + '</strong> <small>' + esc(Math.floor(Number(line.start_ms || 0) / 1000)) + 's</small><br>' + esc(line.text) + '</p>'; }).join('') + '</details>' : '';
        return '<section class="speaking-upload-panel"><h3>Internal report</h3><p>' + esc(report.group_summary_zh || '') + '</p>' + reportList('Group strengths', report.group_strengths) + reportList('Group priorities', report.group_priorities) + reportList('Discussion flow', report.discussion_flow) + '<div class="speaking-detail-actions">' + (canShare ? '<button class="primary-button" type="button" id="create-student-share">Create Student Share</button>' : '<span class="speaking-pill">Confirm your voice before sharing</span>') + '</div><div id="student-share-result"></div>' + candidates + transcript + '</section>';
    }
    function detailMarkup(item) {
        var canRecord = item.recording_status !== 'uploaded' && item.roster_status === 'draft';
        var voiceCards = (item.participants || []).map(function (participant) {
            var mayUpload = ['missing', 'uploading', 'uploaded', 'quality_failed'].indexOf(participant.voice_reference_status || 'missing') >= 0;
            var rosterName = participant.roster_display_name || participant.display_name;
            var action = mayUpload ? '<div class="speaking-detail-actions"><button class="outline-button" type="button" data-voice-record="' + esc(participant.participant_id) + '" data-voice-name="' + esc(rosterName) + '">Record sample</button><label class="outline-button speaking-file-button">Choose audio<input type="file" accept="audio/*" capture="user" hidden data-voice-file="' + esc(participant.participant_id) + '" data-voice-name="' + esc(rosterName) + '"></label></div>' : '';
            var label = participant.kind === 'guest' ? rosterName + ' · Guest participant · Name not verified' : rosterName;
            var reusable = participant.reusable_voiceprint_status === 'active';
            return '<article class="speaking-upload-panel"><strong>' + esc(label) + '</strong><small>' + (reusable ? 'Reusable voiceprint ready' : 'Reusable voiceprint not set up') + ' · Discussion sample ' + esc(participant.voice_reference_status || 'missing') + '</small><p>' + (reusable ? 'The reusable voiceprint can identify this participant automatically. A Discussion sample remains available as a fallback.' : 'Read: “Many people have different ideas. I will listen carefully, explain my view, and respond clearly to the group before we reach a conclusion.”') + '</p>' + action + '</article>';
        }).join('');
        var recording = canRecord ? '<section class="speaking-upload-panel"><h3>Formal Discussion recording</h3><p>Choose Record now or upload one audio file. Audio is kept private.</p><label>Target time (seconds)<input id="recording-duration" type="number" min="180" max="1800" step="30" value="' + esc(item.duration_seconds) + '"></label><button class="outline-button" type="button" id="save-recording-duration">Save target time</button><div class="speaking-detail-actions"><button class="primary-button" type="button" id="record-now">Record now</button><label class="outline-button speaking-file-button">Upload audio<input type="file" accept="audio/*" hidden id="audio-file"></label></div><div class="speaking-recording-time" id="recording-time" hidden>00:00</div><div class="speaking-quality-warning" id="quality-warning" role="status"></div><div class="speaking-detail-actions" id="recording-actions" hidden><button class="outline-button" type="button" id="pause-recording">Pause</button><button class="outline-button" type="button" id="stop-recording">Stop</button><button class="outline-button" type="button" id="preview-recording" disabled>Play local preview</button><button class="primary-button" type="button" id="upload-recording" disabled>Upload recording</button></div></section>' : '';
        var stage = item.analysis_status === 'queued' ? 'Preparing transcript' : item.analysis_status === 'processing' ? 'Analysing discussion' : item.analysis_status === 'ready' ? 'Report ready' : '';
        var reportEligible = Number(item.participant_count) >= 3 && Number(item.participant_count) <= 6;
        var analysis = item.recording_status === 'uploaded' ? '<div class="speaking-detail-actions">' + (stage ? '<span class="speaking-pill speaking-stage">' + esc(stage) + '</span>' : (reportEligible ? '<button class="primary-button" type="button" id="start-analysis">' + (item.analysis_status === 'failed' ? 'Retry analysis' : 'Analyse Discussion') + '</button>' : '<span class="speaking-pill">Two participants do not generate a DSE report</span>')) + '</div>' : '';
        var reportMarkup = internalReportMarkup(item);
        var rosterEditor = item.can_edit_roster && item.roster_status === 'draft' ? '<div class="speaking-upload-panel"><label>VIP Student ID<input id="add-vip-id"></label><button class="outline-button" type="button" id="add-vip-participant">Invite VIP</button><label>Guest name<input id="add-guest-name"></label><button class="outline-button" type="button" id="add-guest-participant">Add Guest</button><p>Three to six participants are required for a DSE report.</p></div>' : '';
        return '<article class="speaking-detail-card"><div class="speaking-detail-top"><button class="back-link" type="button" id="close-discussion">← Discussions</button><p class="eyebrow accent">DISCUSSION</p><h2>' + esc(item.title) + '</h2><p>' + esc(formatDate(item.discussion_date)) + '</p></div><div class="speaking-detail-grid"><dl><dt>Roster</dt><dd>' + esc(item.roster_status) + '</dd></dl><dl><dt>Recording</dt><dd>' + esc(item.recording_status) + '</dd></dl><dl><dt>Analysis</dt><dd>' + esc(item.analysis_status) + '</dd></dl></div><section><h3>Prompt</h3><p>' + esc(item.prompt_text) + '</p></section><section><h3>Participants</h3><ul class="speaking-participants">' + (item.participants || []).map(function (participant) { return participantRow(participant, item); }).join('') + '</ul>' + rosterEditor + '</section>' + recording + (voiceCards ? '<section><h3>Voice References</h3>' + voiceCards + '</section>' : '') + analysis + reportMarkup + '</article>';
    }
    function bindInvitationActions() {
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
        return '<form method="dialog"><p class="eyebrow accent">INVITATION</p><h2 id="invitation-dialog-title">' + esc(invitation.title) + '</h2><p>' + esc(formatDate(invitation.discussion_date)) + '</p><p>Invited by ' + esc(invitation.inviter_name || 'your teacher or group') + '.</p><ul class="speaking-participants">' + (invitation.participants || []).map(function (participant) { return '<li class="speaking-participant"><span>' + esc(participant.display_name) + '</span><small>' + esc(participant.kind === 'guest' ? 'Guest participant · Name not verified' : participant.invitation_status) + '</small></li>'; }).join('') + '</ul><div class="speaking-detail-actions"><button class="primary-button" type="button" id="accept-invitation">Accept</button><button class="outline-button" type="button" id="decline-invitation">Decline</button><button class="outline-button" value="cancel">Close</button></div></form>';
    }
    function elapsedText() {
        var pausedNow = recordingPausedAt ? performance.now() - recordingPausedAt : 0;
        var seconds = Math.floor((performance.now() - recordingStartedAt - recordingPausedTotal - pausedNow) / 1000);
        var elapsed = String(Math.floor(seconds / 60)).padStart(2, '0') + ':' + String(seconds % 60).padStart(2, '0');
        var target = String(Math.floor(recordingTargetSeconds / 60)).padStart(2, '0') + ':' + String(recordingTargetSeconds % 60).padStart(2, '0');
        return elapsed + ' / ' + target;
    }
    function stopLocalRecording() {
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
            var samples = new Float32Array(qualityAnalyser.fftSize);
            qualityReadyAt = performance.now() + 5000;
            function frame() {
                if (!qualityAnalyser) return;
                qualityAnalyser.getFloatTimeDomainData(samples);
                var sum = 0; var clipped = 0;
                for (var index = 0; index < samples.length; index += 1) { var value = samples[index]; sum += value * value; if (Math.abs(value) >= CLIPPING_AMPLITUDE) clipped += 1; }
                var rms = Math.sqrt(sum / samples.length);
                var dbfs = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
                var now = performance.now();
                var muted = stream.getTracks().some(function (track) { return track.readyState === 'ended' || track.muted; });
                if (now >= qualityReadyAt && (muted || dbfs === -Infinity)) {
                    if (!qualityBadSince) qualityBadSince = now;
                    if ((now - qualityBadSince) / 1000 >= INPUT_LOSS_SECONDS) showQualityWarning('Microphone signal lost. Check the input or choose Upload audio.');
                } else if (now >= qualityReadyAt && clipped / samples.length >= 0.01) {
                    if (!qualityBadSince) qualityBadSince = now;
                    if ((now - qualityBadSince) / 1000 >= 1) showQualityWarning('The sound is clipping. Move the phone slightly farther away.');
                } else if (now >= qualityReadyAt && dbfs < LOW_VOLUME_DBFS) {
                    if (!qualityBadSince) qualityBadSince = now;
                    if ((now - qualityBadSince) / 1000 >= 4) showQualityWarning('Move the phone closer so the group can be heard.');
                } else if (qualityBadSince && now - qualityBadSince >= 2000) { qualityBadSince = 0; showQualityWarning(''); }
                qualityFrame = window.requestAnimationFrame(frame);
            }
            qualityFrame = window.requestAnimationFrame(frame);
        } catch (error) { qualityContext = null; qualityAnalyser = null; }
    }
    function startRecording() {
        if (voiceRecorder && voiceRecorder.state !== 'inactive') { showQualityWarning('Finish the current Voice Reference first.'); return; }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.MediaRecorder) { showQualityWarning('Recording is unavailable here. Choose Upload audio instead.'); return; }
        navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
            recordingBlob = null;
            recordingTargetSeconds = Math.max(180, Math.min(1800, Number(document.getElementById('recording-duration') && document.getElementById('recording-duration').value || 1800)));
            activeStream = stream;
            monitorQuality(stream);
            var preferred = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(function (mime) { return MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(mime); });
            recorder = new MediaRecorder(stream, preferred ? { mimeType: preferred } : undefined);
            recordingChunks = [];
            recorder.ondataavailable = function (event) { if (event.data && event.data.size) recordingChunks.push(event.data); };
            recorder.onstop = function () { recordingBlob = new Blob(recordingChunks, { type: recorder && recorder.mimeType || 'audio/webm' }); stopLocalRecording(); var upload = document.getElementById('upload-recording'); var preview = document.getElementById('preview-recording'); if (upload) upload.disabled = !recordingBlob.size; if (preview) preview.disabled = !recordingBlob.size; showQualityWarning('Recording ready. Listen locally before uploading if you need to check it.'); };
            recorder.start();
            recordingStartedAt = performance.now();
            recordingPausedAt = 0;
            recordingPausedTotal = 0;
            var timer = document.getElementById('recording-time'); if (timer) { timer.hidden = false; timer.textContent = '00:00'; }
            document.getElementById('recording-actions').hidden = false;
            recordingTimer = window.setInterval(function () { if (timer) timer.textContent = elapsedText(); if ((performance.now() - recordingStartedAt) / 1000 >= 1800 && recorder && recorder.state !== 'inactive') { showQualityWarning('The 30-minute recording limit was reached. Your recording is ready to upload.'); recorder.stop(); } }, 250);
        }).catch(function () { showQualityWarning('Microphone access was denied. Choose Upload audio instead.'); });
    }
    function uploadBlob(blob, kind, participantId) {
        if (!blob || !blob.size) return Promise.reject(new Error('Choose an audio recording first.'));
        var operationId = 'speaking-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        var mime = String(blob.type || 'audio/webm').toLowerCase().split(';')[0];
        var action = kind === 'voice_reference' ? 'startVoiceReferenceUpload' : 'startAudioUpload';
        return call(action, { discussion_id: selectedId, participant_id: participantId || null, operation_id: operationId, mime_type: mime, size_bytes: blob.size }).then(function (result) {
            return api.uploadWithMetadata(result.upload, blob).then(function () { return call(kind === 'voice_reference' ? 'finishVoiceReferenceUpload' : 'finishAudioUpload', { discussion_id: selectedId, participant_id: participantId || null, operation_id: operationId, asset_id: result.asset_id }); });
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
    function bindRecording() {
        var saveDuration = document.getElementById('save-recording-duration'); if (saveDuration) saveDuration.addEventListener('click', function () { saveDuration.disabled = true; call('updateDiscussionDuration', { discussion_id: selectedId, duration_seconds: Number(document.getElementById('recording-duration').value) }).then(function () { return openDiscussion(selectedId); }).then(function () { setStatus('Recording target updated.'); }).catch(function (error) { setStatus(friendlyError(error), true); saveDuration.disabled = false; }); });
        var start = document.getElementById('record-now'); if (start) start.addEventListener('click', startRecording);
        var pause = document.getElementById('pause-recording'); if (pause) pause.addEventListener('click', function () { if (!recorder || recorder.state === 'inactive') return; if (recorder.state === 'paused') { recorder.resume(); if (recordingPausedAt) recordingPausedTotal += performance.now() - recordingPausedAt; recordingPausedAt = 0; pause.textContent = 'Pause'; } else { recorder.pause(); recordingPausedAt = performance.now(); pause.textContent = 'Resume'; } });
        var stop = document.getElementById('stop-recording'); if (stop) stop.addEventListener('click', function () { if (!recorder || recorder.state === 'inactive') return; var elapsed = (performance.now() - recordingStartedAt) / 1000; if (elapsed < Math.min(60, recordingTargetSeconds / 2) && !window.confirm('Stop this recording early?')) return; recorder.stop(); });
        var preview = document.getElementById('preview-recording'); if (preview) preview.addEventListener('click', function () { if (!recordingBlob) return; var url = URL.createObjectURL(recordingBlob); var audio = new Audio(url); audio.addEventListener('ended', function () { URL.revokeObjectURL(url); }); audio.play().catch(function () { URL.revokeObjectURL(url); showQualityWarning('Local preview could not play on this browser.'); }); });
        var upload = document.getElementById('upload-recording'); if (upload) upload.addEventListener('click', function () { upload.disabled = true; setStatus('Uploading audio…'); uploadBlob(recordingBlob, 'formal').then(function () { return openDiscussion(selectedId); }).then(function () { setStatus('Audio uploaded.'); }).catch(function (error) { setStatus(friendlyError(error), true); upload.disabled = false; }); });
        var file = document.getElementById('audio-file'); if (file) file.addEventListener('change', function () { if (file.files[0]) { setStatus('Uploading audio…'); uploadBlob(file.files[0], 'formal').then(function () { return openDiscussion(selectedId); }).then(function () { setStatus('Audio uploaded.'); }).catch(function (error) { setStatus(friendlyError(error), true); }); } });
        detail.querySelectorAll('[data-voice-record]').forEach(function (button) { button.addEventListener('click', function () { startVoiceReferenceRecording(button.getAttribute('data-voice-record'), button.getAttribute('data-voice-name') || 'this participant', button); }); });
        detail.querySelectorAll('[data-voice-file]').forEach(function (input) { input.addEventListener('change', function () { var file = input.files[0]; if (!file) return; var name = input.getAttribute('data-voice-name') || 'this participant'; if (!window.confirm('Use this Voice Reference for ' + name + '?')) { input.value = ''; return; } setStatus('Uploading Voice Reference…'); uploadBlob(file, 'voice_reference', input.getAttribute('data-voice-file')).then(function () { return openDiscussion(selectedId); }).then(function () { setStatus('Voice Reference uploaded.'); }).catch(function (error) { setStatus(friendlyError(error), true); }); }); });
        var analysis = document.getElementById('start-analysis'); if (analysis) analysis.addEventListener('click', function () { analysis.disabled = true; call('startAnalysis', { discussion_id: selectedId, operation_id: 'analysis-' + selectedId }).then(function () { return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); analysis.disabled = false; }); });
    }
    function openDiscussion(idValue) {
        selectedId = idValue;
        pollGeneration += 1;
        if (pollTimer) { window.clearTimeout(pollTimer); pollTimer = 0; }
        window.history.replaceState(null, '', 'speaking-lab.html?discussion=' + encodeURIComponent(idValue));
        var generation = pollGeneration;
        return call('getDiscussion', { discussion_id: idValue }).then(function (result) {
            if (result.invitation) {
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
                            return openDiscussion(idValue);
                        }).catch(function (error) { setStatus(friendlyError(error), true); button.disabled = false; });
                    });
                });
            } else {
                if (invitationDialog.open) invitationDialog.close();
                detail.hidden = false;
                list.hidden = true;
                detail.innerHTML = detailMarkup(result.discussion);
                bindInvitationActions();
                bindRecording();
            }
            setStatus('');
            schedulePoll(result.discussion, generation);
        }).catch(function (error) { setStatus(friendlyError(error), true); });
    }
    function schedulePoll(item, generation) {
        if (!item || !['queued', 'processing'].includes(item.analysis_status) || generation !== pollGeneration) return;
        var delay = document.hidden ? 10000 : 3000;
        pollTimer = window.setTimeout(function () {
            if (generation !== pollGeneration || !selectedId) return;
            call('getDiscussion', { discussion_id: selectedId }).then(function (result) {
                if (generation !== pollGeneration) return;
                detail.innerHTML = detailMarkup(result.discussion); bindInvitationActions(); bindRecording(); schedulePoll(result.discussion, generation);
            }).catch(function () { schedulePoll(item, generation); });
        }, delay);
    }
    function loadList() {
        return call('listDiscussions', { page_size: 50 }).then(function (result) { renderList(result.discussions || []); setStatus(''); if (selectedId) return openDiscussion(selectedId); }).catch(function (error) { setStatus(friendlyError(error), true); });
    }
    document.getElementById('new-discussion').addEventListener('click', function () { if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', ''); });
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
    form.addEventListener('submit', function (event) { if (event.submitter && event.submitter.value === 'cancel') return; event.preventDefault(); var button = document.getElementById('discussion-create'); button.disabled = true; var vipIds = document.getElementById('discussion-vip-ids').value.split(',').map(function (item) { return item.trim(); }).filter(Boolean); var guests = document.getElementById('discussion-guests').value.split(',').map(function (item) { return item.trim(); }).filter(Boolean); var durationValue = document.getElementById('discussion-duration').value; var createPayload = { operation_id: 'create-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 9), title: document.getElementById('discussion-title').value, prompt_text: document.getElementById('discussion-prompt').value, discussion_date: document.getElementById('discussion-date').value }; if (durationValue) createPayload.duration_seconds = Number(durationValue); call('createDiscussion', createPayload).then(function (result) { selectedId = result.discussion.discussion_id; return vipIds.reduce(function (promise, studentId) { return promise.then(function () { return call('addVipParticipant', { discussion_id: selectedId, student_id: studentId }); }); }, Promise.resolve()).then(function () { return guests.reduce(function (promise, guestName) { return promise.then(function () { return call('addGuestParticipant', { discussion_id: selectedId, guest_name: guestName }); }); }, Promise.resolve()); }).then(function () { dialog.close(); document.getElementById('discussion-form').reset(); return loadList(); }); }).catch(function (error) { setStatus(friendlyError(error), true); }).finally(function () { button.disabled = false; }); });
    document.addEventListener('click', function (event) { if (event.target && event.target.id === 'close-discussion') { detail.hidden = true; list.hidden = false; selectedId = ''; pollGeneration += 1; if (pollTimer) window.clearTimeout(pollTimer); window.history.replaceState(null, '', 'speaking-lab.html'); stopLocalRecording(); voiceDiscard = true; stopVoiceReferenceRecording(); } });
    document.addEventListener('visibilitychange', function () { if (selectedId && !document.hidden) openDiscussion(selectedId); });

    auth.getSession().then(function (session) {
        if (!session || session.mode !== 'student') { window.location.replace('index.html?return=speaking-lab.html'); return null; }
        identity.textContent = session.profile && (session.profile.english_name || session.profile.name) || 'Speaking Lab';
        return loadMyVoiceprint().then(function () { return loadList(); });
    }).catch(function () { window.location.replace('index.html?return=speaking-lab.html'); });
    window.addEventListener('pagehide', function () { stopLocalRecording(); voiceDiscard = true; stopVoiceReferenceRecording(); if (voiceprintController) voiceprintController.cancel(); voiceprintController = null; if (voiceStream) voiceStream.getTracks().forEach(function (track) { track.stop(); }); if (voiceTimer) window.clearInterval(voiceTimer); if (qualityRecoveryTimer) window.clearTimeout(qualityRecoveryTimer); if (pollTimer) window.clearTimeout(pollTimer); if (recordingBlob) recordingBlob = null; });
})(window);
