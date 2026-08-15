(function(window) {
    'use strict';

    var config = window.MRCAT_CONFIG || {};
    var app = null;
    var auth = null;
    var deviceKey = 'mrcat_device_id';
    var clientInstanceId = null;

    function randomId(prefix) {
        var value = '';
        if (window.crypto && typeof window.crypto.randomUUID === 'function') {
            value = window.crypto.randomUUID();
        } else {
            value = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
        }
        return prefix + '-' + value;
    }

    function storedId(storage, key, prefix) {
        try {
            var current = storage.getItem(key);
            if (current) return current;
            var next = randomId(prefix);
            storage.setItem(key, next);
            return next;
        } catch (error) {
            return randomId(prefix);
        }
    }

    function getDeviceId() {
        return storedId(window.localStorage, deviceKey, 'device');
    }

    function getClientInstanceId() {
        if (!clientInstanceId) clientInstanceId = randomId('instance');
        return clientInstanceId;
    }

    function requireSdk() {
        if (!window.cloudbase || typeof window.cloudbase.init !== 'function') {
            throw new Error('CloudBase SDK failed to load.');
        }
    }

    function getApp() {
        if (!app) {
            requireSdk();
            app = window.cloudbase.init({
                env: config.cloudbaseEnvId,
                region: config.region
            });
        }
        return app;
    }

    function getAuth() {
        if (!auth) auth = getApp().auth({ persistence: 'local' });
        return auth;
    }

    function getLoginState() {
        return Promise.resolve(getAuth().getLoginState());
    }

    function signIn(username, password) {
        return getAuth().signInWithUsernameAndPassword(username, password);
    }

    function signInAnonymously() {
        return getAuth().signInAnonymously();
    }

    function signOut() {
        return Promise.resolve(getAuth().signOut());
    }

    function callFunction(name, data) {
        var payload = data && typeof data === 'object' ? Object.assign({}, data) : {};
        payload._client_device_id = payload._client_device_id || getDeviceId();
        payload._client_instance_id = payload._client_instance_id || getClientInstanceId();
        return getApp().callFunction({
            name: name,
            data: payload
        }).then(function(response) {
            var result = response && Object.prototype.hasOwnProperty.call(response, 'result')
                ? response.result
                : response;
            if (name === 'submitAttempt' && result && result.success) {
                window.dispatchEvent(new CustomEvent('mrcat:attempt-submitted', {
                    detail: result
                }));
            }
            return result;
        });
    }

    function uploadWithMetadata(metadata, file) {
        if (!metadata || !metadata.url || !metadata.cloud_path || !file) {
            return Promise.reject(new Error('Upload information is incomplete.'));
        }
        return fetch(metadata.url, {
            method: 'PUT',
            headers: {
                'Authorization': metadata.authorization,
                'Signature': metadata.authorization,
                'x-cos-security-token': metadata.token,
                'x-cos-meta-fileid': metadata.cos_file_id || metadata.file_id,
                'key': encodeURIComponent(metadata.cloud_path)
            },
            body: file
        }).then(function(response) {
            if (!response.ok) throw new Error('Photo upload failed.');
            return { success: true, file_id: metadata.file_id };
        });
    }

    function imageElementForFile(file) {
        return new Promise(function(resolve, reject) {
            var url = URL.createObjectURL(file);
            var image = new Image();
            image.onload = function() {
                URL.revokeObjectURL(url);
                resolve(image);
            };
            image.onerror = function() {
                URL.revokeObjectURL(url);
                reject(new Error('This photo could not be read.'));
            };
            image.src = url;
        });
    }

    function canvasBlob(canvas, quality) {
        return new Promise(function(resolve, reject) {
            canvas.toBlob(function(blob) {
                if (blob) resolve(blob);
                else reject(new Error('This photo could not be prepared.'));
            }, 'image/jpeg', quality);
        });
    }

    function prepareEvidenceImage(file) {
        var accepted = ['image/jpeg', 'image/png', 'image/webp'];
        if (!file || accepted.indexOf(String(file.type || '').toLowerCase()) === -1) {
            return Promise.reject(new Error('Choose a JPG, PNG, or WebP photo.'));
        }
        if (file.size < 1 || file.size > 10 * 1024 * 1024) {
            return Promise.reject(new Error('The original photo must be 10 MB or smaller.'));
        }
        return imageElementForFile(file).then(function(image) {
            var scale = Math.min(1, 1600 / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
            var canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
            canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            function compress(quality) {
                return canvasBlob(canvas, quality).then(function(blob) {
                    if (blob.size <= 2 * 1024 * 1024 || quality <= 0.42) return blob;
                    return compress(quality - 0.1);
                });
            }
            return compress(0.82).then(function(displayBlob) {
                if (displayBlob.size > 2 * 1024 * 1024) throw new Error('This photo is too large to prepare.');
                return { original: file, display: displayBlob };
            });
        });
    }

    window.MrCatCloud = {
        config: config,
        getApp: getApp,
        getAuth: getAuth,
        getLoginState: getLoginState,
        signIn: signIn,
        signInAnonymously: signInAnonymously,
        signOut: signOut,
        callFunction: callFunction,
        uploadWithMetadata: uploadWithMetadata,
        prepareEvidenceImage: prepareEvidenceImage,
        getDeviceId: getDeviceId,
        getClientInstanceId: getClientInstanceId
    };
})(window);
