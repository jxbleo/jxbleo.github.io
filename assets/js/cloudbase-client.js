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

    function authErrorMarker(error) {
        if (!error) return '';
        return [error.code, error.message, error.errMsg, String(error)]
            .filter(Boolean)
            .join(' ');
    }

    function isCredentialBootstrapError(error) {
        return /null is not an object.*scope|credentials?\.scope|evaluating ['\"]?[a-z]\.scope|AUTH_TEMPORARILY_UNAVAILABLE/i
            .test(authErrorMarker(error));
    }

    function authenticatedState() {
        var attempts = 0;
        function check() {
            attempts += 1;
            return Promise.resolve().then(function() {
                return getLoginState();
            }).then(function(state) {
                if (!state) throw new Error('LOGIN_REQUIRED');
                return state;
            }).catch(function(error) {
                if (attempts < 2 && isCredentialBootstrapError(error)) {
                    return new Promise(function(resolve) {
                        window.setTimeout(resolve, 180);
                    }).then(check);
                }
                if (isCredentialBootstrapError(error)) {
                    var friendly = new Error('Your login could not be verified. Please check the network and try again. Your answers have not been submitted.');
                    friendly.code = 'AUTH_TEMPORARILY_UNAVAILABLE';
                    throw friendly;
                }
                throw error;
            });
        }
        return check();
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

    function callAuthenticatedFunction(name, data) {
        // Only the read-only login preflight may retry. The mutating cloud
        // function call is invoked exactly once so submission semantics remain
        // under the caller's and server's idempotency controls.
        return authenticatedState().then(function() {
            return callFunction(name, data);
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

    function uploadCloudFile(cloudPath, file) {
        if (!cloudPath || !file) {
            return Promise.reject(new Error('Upload information is incomplete.'));
        }
        return getApp().uploadFile({
            cloudPath: cloudPath,
            filePath: file
        }).then(function(result) {
            var fileId = result && (result.fileID || result.fileId || result.file_id);
            if (!fileId) throw new Error('Cloud storage did not return a file ID.');
            return { success: true, file_id: fileId };
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
        authenticatedState: authenticatedState,
        isCredentialBootstrapError: isCredentialBootstrapError,
        signIn: signIn,
        signInAnonymously: signInAnonymously,
        signOut: signOut,
        callFunction: callFunction,
        callAuthenticatedFunction: callAuthenticatedFunction,
        uploadWithMetadata: uploadWithMetadata,
        uploadCloudFile: uploadCloudFile,
        prepareEvidenceImage: prepareEvidenceImage,
        getDeviceId: getDeviceId,
        getClientInstanceId: getClientInstanceId
    };
})(window);
