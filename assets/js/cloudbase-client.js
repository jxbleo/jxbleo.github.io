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

    window.MrCatCloud = {
        config: config,
        getApp: getApp,
        getAuth: getAuth,
        getLoginState: getLoginState,
        signIn: signIn,
        signOut: signOut,
        callFunction: callFunction,
        getDeviceId: getDeviceId,
        getClientInstanceId: getClientInstanceId
    };
})(window);
