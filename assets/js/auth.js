(function(window) {
    'use strict';

    var visitorKey = 'mrcat_visitor';
    var profileKey = 'mrcat_student_profile';

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
        localStorage.removeItem(visitorKey);
        localStorage.removeItem(profileKey);
        localStorage.removeItem('opencode_user');
        localStorage.removeItem('opencode_visitor');
    }

    function getSession() {
        if (isVisitor()) return Promise.resolve({ mode: 'visitor', profile: null });
        return window.MrCatCloud.getLoginState().then(function(state) {
            if (!state) return { mode: 'none', profile: null };
            return window.MrCatCloud.callFunction('getCurrentStudent').then(function(result) {
                if (!result || !result.success) throw new Error(result && result.message || 'Student profile unavailable.');
                saveProfile(result.student);
                return {
                    mode: result.student.role === 'teacher' ? 'teacher' : 'student',
                    profile: result.student
                };
            });
        });
    }

    function logout() {
        clearLocalIdentity();
        return window.MrCatCloud.signOut().catch(function() {}).then(function() {
            window.location.href = 'index.html';
        });
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
