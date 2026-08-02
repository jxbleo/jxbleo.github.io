(function() {
    'use strict';

    var RESOURCE_KEY = 'hk8-dse-jupas-weighting-2026-27';
    var PAGE_NAME = 'hk8-dse-jupas-weighting-report-2026-27.html';
    var preview = document.getElementById('report-preview');
    var loading = document.getElementById('report-loading');
    var full = document.getElementById('report-full');
    var errorPanel = document.getElementById('report-error');
    var errorMessage = document.getElementById('report-error-message');
    var reportFrame = document.getElementById('report-frame');
    var access = document.getElementById('report-access');
    var accessLabel = document.getElementById('report-access-label');
    var backLink = document.getElementById('report-back');
    var loginLinks = document.querySelectorAll('[data-report-login]');
    var retryButton = document.getElementById('report-retry');

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

    function configureNavigation() {
        backLink.href = safeReturnTarget() || 'index.html';
        loginLinks.forEach(function(link) {
            link.href = 'index.html?return=' + encodeURIComponent(PAGE_NAME);
        });
    }

    function showPreview(label) {
        loading.hidden = true;
        full.hidden = true;
        errorPanel.hidden = true;
        preview.hidden = false;
        setAccess('is-preview', label || '访客预览');
    }

    function showLoading(label) {
        preview.hidden = true;
        full.hidden = true;
        errorPanel.hidden = true;
        loading.hidden = false;
        setAccess('', label || '正在检查访问权限');
    }

    function showError(message) {
        preview.hidden = true;
        loading.hidden = true;
        full.hidden = true;
        errorPanel.hidden = false;
        errorMessage.textContent = message || '无法载入完整报告，请稍后重试。';
        setAccess('', '暂时无法访问');
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
            return Promise.reject(new Error('当前浏览器无法打开受保护报告，请更新 Safari、Chrome 或 Edge。'));
        }
        var bytes = base64Bytes(encoded);
        var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
        return new Response(stream).arrayBuffer().then(function(buffer) {
            return window.crypto.subtle.digest('SHA-256', buffer).then(function(digest) {
                if (hexDigest(digest) !== manifest.sha256) {
                    throw new Error('报告完整性校验失败，请重新载入。');
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
                var error = new Error(result && result.message || '受保护报告暂时不可用。');
                error.code = result && result.code || 'RESOURCE_ERROR';
                throw error;
            }
            return result;
        });
    }

    function loadFullResource(profile) {
        showLoading('正在载入学生完整版');
        return protectedCall({ action: 'manifest' }).then(function(manifest) {
            if (!Number.isInteger(manifest.chunk_count) || manifest.chunk_count < 1 || manifest.chunk_count > 64) {
                throw new Error('报告清单无效。');
            }
            var requests = [];
            for (var index = 0; index < manifest.chunk_count; index += 1) {
                requests.push(protectedCall({ action: 'chunk', chunk_index: index }));
            }
            return Promise.all(requests).then(function(parts) {
                parts.sort(function(left, right) { return left.chunk_index - right.chunk_index; });
                if (parts.some(function(part, index) {
                    return part.chunk_index !== index || part.chunk_count !== manifest.chunk_count;
                })) {
                    throw new Error('报告分段不完整，请重新载入。');
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
            setAccess('is-full', name + ' · 学生完整版');
        });
    }

    function start() {
        configureNavigation();
        showLoading('正在检查访问权限');
        window.MrCatAuth.getSession().then(function(session) {
            if (!session || session.mode === 'none' || session.mode === 'visitor') {
                showPreview('访客预览');
                return;
            }
            if (!session.profile || String(session.profile.role || 'student') !== 'student') {
                showPreview('仅学生账号可查看完整版');
                return;
            }
            return loadFullResource(session.profile);
        }).catch(function(error) {
            if (error && (error.code === 'AUTH_REQUIRED' || error.code === 'STUDENT_NOT_LINKED')) {
                showPreview('访客预览');
                return;
            }
            if (error && error.code === 'ACCESS_DENIED') {
                showPreview('仅学生账号可查看完整版');
                return;
            }
            showError(error && error.message);
        });
    }

    retryButton.addEventListener('click', start);
    start();
})();
