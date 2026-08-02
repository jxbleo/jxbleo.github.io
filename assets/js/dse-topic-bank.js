(function() {
    'use strict';

    var RESOURCE_KEY = 'dse-topic-bank-2012-2026';
    var preview = document.getElementById('topic-preview');
    var loading = document.getElementById('topic-loading');
    var full = document.getElementById('topic-full');
    var errorPanel = document.getElementById('topic-error');
    var errorMessage = document.getElementById('topic-error-message');
    var reportFrame = document.getElementById('topic-report-frame');
    var access = document.getElementById('topic-access');
    var accessLabel = document.getElementById('topic-access-label');
    var backLink = document.getElementById('topic-back');
    var loginLinks = document.querySelectorAll('[data-topic-login]');
    var retryButton = document.getElementById('topic-retry');

    function safeReturnTarget() {
        var raw = new URLSearchParams(window.location.search).get('return');
        if (!raw) return '';
        try {
            var target = new URL(raw, window.location.href);
            if (target.origin !== window.location.origin || !/\.html$/i.test(target.pathname)) return '';
            return target.pathname.split('/').pop() + target.search + target.hash;
        } catch (error) {
            return '';
        }
    }

    function setAccess(mode, label) {
        access.classList.remove('is-full', 'is-preview');
        if (mode) access.classList.add(mode);
        accessLabel.textContent = label;
    }

    function loginTarget() {
        return 'index.html?return=' + encodeURIComponent('dse-topic-bank.html');
    }

    function configureNavigation() {
        backLink.href = safeReturnTarget() || 'dashboard.html?view=resources';
        loginLinks.forEach(function(link) { link.href = loginTarget(); });
    }

    function showPreview(label) {
        loading.hidden = true;
        full.hidden = true;
        errorPanel.hidden = true;
        preview.hidden = false;
        setAccess('is-preview', label || 'Visitor preview');
    }

    function showLoading(label) {
        preview.hidden = true;
        full.hidden = true;
        errorPanel.hidden = true;
        loading.hidden = false;
        setAccess('', label || 'Checking access');
    }

    function showError(message) {
        preview.hidden = true;
        loading.hidden = true;
        full.hidden = true;
        errorPanel.hidden = false;
        errorMessage.textContent = message || 'Unable to load the full topic bank. Please try again.';
        setAccess('', 'Access unavailable');
    }

    function base64Bytes(value) {
        var binary = window.atob(value);
        var bytes = new Uint8Array(binary.length);
        for (var index = 0; index < binary.length; index += 1) {
            bytes[index] = binary.charCodeAt(index);
        }
        return bytes;
    }

    function hexDigest(buffer) {
        return Array.from(new Uint8Array(buffer)).map(function(value) {
            return value.toString(16).padStart(2, '0');
        }).join('');
    }

    function decodeResource(encoded, manifest) {
        if (manifest.encoding !== 'gzip-base64' || typeof DecompressionStream !== 'function') {
            return Promise.reject(new Error('This browser cannot open the protected report. Please update Safari, Chrome, or Edge.'));
        }
        var bytes = base64Bytes(encoded);
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).arrayBuffer().then(function(buffer) {
            return window.crypto.subtle.digest('SHA-256', buffer).then(function(digest) {
                if (hexDigest(digest) !== manifest.sha256) {
                    throw new Error('The protected report did not pass its integrity check. Please retry.');
                }
                return new TextDecoder('utf-8').decode(buffer);
            });
        });
    }

    function protectedCall(data) {
        return window.MrCatCloud.callFunction('getProtectedResource', Object.assign({
            resource_key: RESOURCE_KEY
        }, data || {})).then(function(result) {
            if (!result || !result.success) {
                var error = new Error(result && result.message || 'The protected report is unavailable.');
                error.code = result && result.code || 'RESOURCE_ERROR';
                throw error;
            }
            return result;
        });
    }

    function loadFullResource(profile) {
        showLoading('Loading student edition');
        return protectedCall({ action: 'manifest' }).then(function(manifest) {
            if (!Number.isInteger(manifest.chunk_count) || manifest.chunk_count < 1 || manifest.chunk_count > 64) {
                throw new Error('The protected report manifest is invalid.');
            }
            var requests = [];
            for (var index = 0; index < manifest.chunk_count; index += 1) {
                requests.push(protectedCall({ action: 'chunk', chunk_index: index }));
            }
            return Promise.all(requests).then(function(parts) {
                parts.sort(function(left, right) { return left.chunk_index - right.chunk_index; });
                if (parts.some(function(part, index) { return part.chunk_index !== index || part.chunk_count !== manifest.chunk_count; })) {
                    throw new Error('The protected report is incomplete. Please retry.');
                }
                return decodeResource(parts.map(function(part) { return part.chunk; }).join(''), manifest);
            });
        }).then(function(html) {
            reportFrame.srcdoc = html;
            loading.hidden = true;
            errorPanel.hidden = true;
            preview.hidden = true;
            full.hidden = false;
            var name = profile && (profile.name || profile.student_id) || 'Student';
            setAccess('is-full', name + ' · Full edition');
        });
    }

    function start() {
        configureNavigation();
        showLoading('Checking access');
        window.MrCatAuth.getSession().then(function(session) {
            if (!session || session.mode === 'none') {
                showPreview('Visitor preview');
                return;
            }
            if (session.mode === 'visitor') {
                showPreview('Visitor preview');
                return;
            }
            return loadFullResource(session.profile);
        }).catch(function(error) {
            if (error && (error.code === 'AUTH_REQUIRED' || error.code === 'STUDENT_NOT_LINKED')) {
                showPreview('Visitor preview');
                return;
            }
            showError(error && error.message);
        });
    }

    retryButton.addEventListener('click', start);
    start();
})();
