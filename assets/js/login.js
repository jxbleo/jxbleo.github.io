(function() {
    'use strict';

    var form = document.getElementById('login-form');
    var studentId = document.getElementById('student-id');
    var password = document.getElementById('password');
    var message = document.getElementById('login-message');
    var loginButton = document.getElementById('login-button');
    var visitorButton = document.getElementById('visitor-button');
    var motivationalQuote = document.getElementById('login-motivational-quote');
    var motivationalQuotes = [
        'Small steps every day create remarkable progress.',
        'Your effort today is building your confidence tomorrow.',
        'Progress matters more than perfection.',
        'Every question you try makes you stronger.',
        'Stay curious. That is where learning begins.',
        'A difficult task is a chance to grow.',
        'You do not have to be perfect to improve.',
        'Consistency turns practice into progress.',
        'One focused session can change your whole day.',
        'Mistakes are proof that you are learning.',
        'Keep going. Your future self will thank you.',
        'The more you practise, the more possible things become.',
        'A little courage can begin a lot of progress.',
        'Today is another chance to surprise yourself.',
        'Strong results begin with one honest attempt.',
        'Learning gets easier when showing up becomes a habit.',
        'Your pace is valid. Keep moving forward.',
        'Focus on the next step, not the whole staircase.',
        'Every retry carries something you learned before.',
        'You are capable of more than one difficult moment suggests.',
        'Make today count, one question at a time.',
        'Confidence grows each time you choose to continue.',
        'The work you repeat becomes the skill you keep.',
        'Be patient with yourself and serious about your goals.',
        'Start where you are and improve from there.',
        'A calm mind and steady effort can go a long way.',
        'Your best learning happens when you keep asking why.',
        'Challenges are part of becoming more capable.',
        'Give this moment your attention and let progress follow.',
        'There is always something valuable in another attempt.',
        'A steady learner becomes a strong learner.',
        'You only need the next useful step.',
        'Practice turns uncertainty into skill.',
        'Give yourself credit for showing up.',
        'The next question is a new chance.',
        'Your attention is powerful when you use it well.',
        'A careful attempt is already progress.',
        'Keep your goals close and your steps simple.',
        'Small wins are still wins.',
        'Every finished task adds to your foundation.',
        'The habit matters as much as the score.',
        'You are training your brain to stay with hard things.',
        'A strong result often starts quietly.',
        'One clear answer can unlock the next one.',
        'Let today be a solid page in your learning story.',
        'The work you do now makes later work lighter.',
        'Progress is built in ordinary moments.',
        'Stay steady. The skills are forming.',
        'A focused start is half the battle.',
        'You can do hard things one piece at a time.',
        'Keep choosing the next right effort.',
        'Your future confidence is being built here.',
        'The best learners keep returning.',
        'A little discipline can create a lot of freedom.',
        'Do the next task with care.',
        'Every practice session gives you more evidence that you can improve.',
        'Learning is not a race. It is a rhythm.',
        'Try, notice, adjust, and try again.',
        'You are allowed to grow at a human pace.',
        'A brave attempt is better than a perfect delay.',
        'Keep your curiosity awake.',
        'One more thoughtful try can change the pattern.',
        'Build the skill, not just the score.',
        'The next small effort still counts.',
        'You are closer than you were before you started.',
        'Let the work be simple and honest today.',
        'Strong students are made by steady choices.',
        'You do not need a perfect day to make progress.',
        'Take the next step and let momentum find you.',
        'Your practice is becoming your strength.'
    ];

    function safeReturnTarget() {
        var raw = new URLSearchParams(window.location.search).get('return');
        if (!raw) return '';
        try {
            var target = new URL(raw, window.location.href);
            if (target.origin !== window.location.origin) return '';
            if (!/\.html$/i.test(target.pathname)) return '';
            return target.pathname.split('/').pop() + target.search + target.hash;
        } catch (error) {
            return '';
        }
    }

    function studentDestination() {
        return safeReturnTarget() || 'dashboard.html';
    }

    if (motivationalQuote) {
        motivationalQuote.textContent = motivationalQuotes[Math.floor(Math.random() * motivationalQuotes.length)];
    }

    function setBusy(busy) {
        loginButton.disabled = busy;
        loginButton.textContent = busy ? 'Signing in...' : 'Sign in';
    }

    function showMessage(text) {
        message.textContent = text || '';
    }

    window.MrCatAuth.getSession().then(function(session) {
        if (session && (session.mode === 'student' || session.mode === 'teacher')) {
            window.location.replace(safeReturnTarget() || (session.mode === 'teacher'
                ? 'teacher.html'
                : 'dashboard.html'));
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
                window.location.href = safeReturnTarget() || (result.student.role === 'teacher'
                    ? 'teacher.html'
                    : 'dashboard.html');
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
            window.location.href = studentDestination();
        });
    });
})();
