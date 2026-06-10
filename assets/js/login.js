(function() {
    'use strict';

    var form = document.getElementById('login-form');
    var studentId = document.getElementById('student-id');
    var password = document.getElementById('password');
    var message = document.getElementById('login-message');
    var loginButton = document.getElementById('login-button');
    var visitorButton = document.getElementById('visitor-button');

    function setBusy(busy) {
        loginButton.disabled = busy;
        loginButton.textContent = busy ? 'Signing in...' : 'Continue';
    }

    function showMessage(text) {
        message.textContent = text || '';
    }

    window.MrCatCloud.getLoginState().then(function(state) {
        if (state && !window.MrCatAuth.isVisitor()) {
            window.location.replace('dashboard.html');
        }
    }).catch(function() {});

    form.addEventListener('submit', function(event) {
        event.preventDefault();
        var username = studentId.value.trim();
        var rawPassword = password.value;
        showMessage('');

        if (!username || !rawPassword) {
            showMessage('Please enter both your Student ID and password.');
            return;
        }

        setBusy(true);
        window.MrCatAuth.clearLocalIdentity();
        window.MrCatCloud.signIn(username, rawPassword)
            .then(function() {
                return window.MrCatCloud.callFunction('getCurrentStudent');
            })
            .then(function(result) {
                if (!result || !result.success) {
                    throw new Error(result && result.message || 'This login is not linked to a student profile.');
                }
                window.MrCatAuth.saveProfile(result.student);
                window.location.href = 'dashboard.html';
            })
            .catch(function(error) {
                showMessage(error && error.message ? error.message : 'Unable to sign in. Check your details and try again.');
                window.MrCatCloud.signOut().catch(function() {});
            })
            .finally(function() {
                setBusy(false);
            });
    });

    visitorButton.addEventListener('click', function() {
        window.MrCatCloud.signOut().catch(function() {}).finally(function() {
            window.MrCatAuth.clearLocalIdentity();
            window.MrCatAuth.setVisitor(true);
            window.location.href = 'dashboard.html';
        });
    });
})();
