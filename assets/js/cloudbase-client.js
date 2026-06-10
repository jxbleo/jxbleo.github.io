(function(window) {
    'use strict';

    var config = window.MRCAT_CONFIG || {};
    var app = null;
    var auth = null;

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
        return getApp().callFunction({
            name: name,
            data: data || {}
        }).then(function(response) {
            return response && Object.prototype.hasOwnProperty.call(response, 'result')
                ? response.result
                : response;
        });
    }

    window.MrCatCloud = {
        config: config,
        getApp: getApp,
        getAuth: getAuth,
        getLoginState: getLoginState,
        signIn: signIn,
        signOut: signOut,
        callFunction: callFunction
    };
})(window);
