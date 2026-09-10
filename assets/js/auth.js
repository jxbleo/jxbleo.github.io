(function(window) {
    'use strict';

    var visitorKey = 'mrcat_visitor';
    var profileKey = 'mrcat_student_profile';
    var logoutPromise = null;
    var signOutPromise = null;

    function setVisitor(enabled) {
        if (enabled) {
            localStorage.setItem(visitorKey, 'true');
            localStorage.removeItem(profileKey);
        } else {
            localStorage.removeItem(visitorKey);
        }
    }

    function isVisitor() {
        return localStorage.getItem(visitorKey) === 'true';
    }

    function saveProfile(profile) {
        setVisitor(false);
        localStorage.setItem(profileKey, JSON.stringify(profile || {}));
    }

    function getCachedProfile() {
        try {
            return JSON.parse(localStorage.getItem(profileKey) || 'null');
        } catch (error) {
            return null;
        }
    }

    function clearLocalIdentity() {
        [visitorKey, profileKey, 'opencode_user', 'opencode_visitor'].forEach(function(key) {
            try { localStorage.removeItem(key); } catch (error) {}
        });
        try { sessionStorage.removeItem('mrcat_my_words_first_page_v1'); } catch (error) {}
    }

    function getSession() {
        if (isVisitor()) return Promise.resolve({ mode: 'visitor', profile: null });
        return window.MrCatCloud.getLoginState().then(function(state) {
            if (!state) return { mode: 'none', profile: null };
            return window.MrCatCloud.callFunction('getCurrentStudent').then(function(result) {
                if (!result || !result.success) {
                    var error = new Error(result && result.message || 'Student profile unavailable.');
                    if (result && result.code) error.code = result.code;
                    throw error;
                }
                saveProfile(result.student);
                return {
                    mode: result.student.role === 'teacher' ? 'teacher' : 'student',
                    profile: result.student
                };
            });
        });
    }

    function withLogoutDeadline(task, milliseconds) {
        return new Promise(function(resolve, reject) {
            var timer = window.setTimeout(function() {
                var error = new Error('Log out is taking too long. Check your connection and try again.');
                error.code = 'LOGOUT_TIMEOUT';
                reject(error);
            }, milliseconds);
            task.then(function(value) {
                window.clearTimeout(timer);
                resolve(value);
            }, function(error) {
                window.clearTimeout(timer);
                reject(error);
            });
        });
    }

    function clearDashboardCache() {
        // Cache cleanup must not trap an already signed-out user. A blocked
        // delete remains queued by IndexedDB until the other connections close.
        var task = Promise.resolve().then(function() {
            if (!window.indexedDB) return;
            return new Promise(function(resolve, reject) {
                var request = window.indexedDB.deleteDatabase('mrcat-student-dashboard-v1');
                request.onsuccess = request.onblocked = function() { resolve(); };
                request.onerror = function() { reject(request.error); };
            });
        });
        return withLogoutDeadline(task, 1000).catch(function() {});
    }

    function logout() {
        if (logoutPromise) return logoutPromise;
        // Keep one SDK operation even after a UI timeout: concurrent sign-outs
        // could otherwise finish late and clear a newly established session.
        if (!signOutPromise) {
            signOutPromise = Promise.resolve().then(function() {
                return window.MrCatCloud.getLoginState();
            }).then(function(state) {
                // A previous timed-out SDK call may since have signed out.
                if (!state) return;
                return window.MrCatCloud.signOut();
            }).then(function(result) {
                // CloudBase 2.32 also reports failures as fulfilled { error }.
                if (result && result.error) throw result.error;
            }).finally(function() {
                signOutPromise = null;
            });
        }
        logoutPromise = withLogoutDeadline(signOutPromise, 7000).catch(function(error) {
            if (error && error.code === 'LOGOUT_TIMEOUT') throw error;
            throw new Error('Unable to log out. Check your connection and try again.');
        }).then(function() {
            clearLocalIdentity();
            return clearDashboardCache();
        }).then(function() {
            window.location.replace('index.html');
        }).finally(function() {
            logoutPromise = null;
        });
        return logoutPromise;
    }

    window.MrCatAuth = {
        setVisitor: setVisitor,
        isVisitor: isVisitor,
        saveProfile: saveProfile,
        getCachedProfile: getCachedProfile,
        clearLocalIdentity: clearLocalIdentity,
        getSession: getSession,
        logout: logout
    };
})(window);
