(function(window, document) {
    'use strict';

    var WORLD_WIDTH = 960;
    var WORLD_HEIGHT = 420;
    var GROUND_Y = 338;
    var RUN_SPEED = 230;
    var GRAVITY = 1700;
    var JUMP_VELOCITY = -650;
    var STEP = 1 / 60;
    var MAX_DELTA = 0.05;
    var BUFFER_MS = 120;
    var COYOTE_SECONDS = 0.1;
    var MIN_OBSTACLE_GAP = 330;
    var MAX_OBSTACLE_GAP = 560;
    var STUMBLE_MS = 600;
    var INVULNERABLE_MS = 1200;
    var MIN_COLLECTIBLES = 3;
    var MAX_COLLECTIBLES = 7;

    function reducedMotion() {
        return Boolean(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function supportedCanvas(canvas) {
        return Boolean(canvas && typeof canvas.getContext === 'function'
            && typeof window.requestAnimationFrame === 'function'
            && typeof window.cancelAnimationFrame === 'function');
    }

    function noopController() {
        var called = false;
        return {
            jump: function() {},
            setTaskState: function() {},
            finish: function(callback) {
                if (called) return;
                called = true;
                if (typeof callback === 'function') callback();
            },
            pause: function() {},
            resume: function() {},
            destroy: function() {},
            snapshot: function() { return { supported: false, destroyed: false }; }
        };
    }

    function mount(canvas, options) {
        options = options || {};
        if (!supportedCanvas(canvas)) return noopController();

        var context = canvas.getContext('2d');
        if (!context) return noopController();
        [
            'setTransform', 'scale', 'clearRect', 'fillRect', 'fill', 'stroke', 'beginPath',
            'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'quadraticCurveTo', 'save',
            'restore', 'translate'
        ].forEach(function(name) {
            if (typeof context[name] !== 'function') context[name] = function() {};
        });
        canvas.style = canvas.style || {};

        var destroyed = false;
        var paused = false;
        var reduced = reducedMotion();
        var frameHandle = null;
        var finishTimer = null;
        var resizeObserver = null;
        var listeningToWindowResize = false;
        var lastTime = null;
        var accumulator = 0;
        var finishCallback = null;
        var finishCalled = false;
        var finishing = false;
        var elapsed = 0;
        var distance = 0;
        var score = 0;
        var lastReportedScore = null;
        var obstacleSeed = 0;
        var lastObstacleRight = WORLD_WIDTH + 190;
        var obstacles = [];
        var collectibles = [];
        var collectibleSeed = 0;
        var collectedCount = 0;
        var taskState = 'queued';
        var collisionCount = 0;
        var player = {
            x: 160,
            y: GROUND_Y - 62,
            width: 48,
            height: 62,
            vy: 0,
            grounded: true,
            coyote: COYOTE_SECONDS,
            jumpCount: 0,
            jumpsUsed: 0,
            jumpBuffer: 0,
            stumble: 0,
            invulnerable: 0,
            runFrame: 0
        };

        function randomBetween(min, max) {
            return min + Math.random() * (max - min);
        }

        function dimensions() {
            var rect = typeof canvas.getBoundingClientRect === 'function'
                ? canvas.getBoundingClientRect()
                : { width: canvas.clientWidth || WORLD_WIDTH, height: canvas.clientHeight || WORLD_HEIGHT };
            return {
                width: Math.max(280, rect.width || canvas.clientWidth || WORLD_WIDTH),
                height: Math.max(120, rect.height || canvas.clientHeight || WORLD_WIDTH * 7 / 16)
            };
        }

        function resize() {
            if (destroyed) return;
            var size = dimensions();
            var dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
            canvas.width = Math.round(size.width * dpr);
            canvas.height = Math.round(size.height * dpr);
            canvas.style.width = '100%';
            canvas.style.height = 'auto';
            if (typeof context.setTransform === 'function') {
                context.setTransform(dpr * size.width / WORLD_WIDTH, 0, 0, dpr * size.height / WORLD_HEIGHT, 0, 0);
            }
            draw();
        }

        function notifyScore(force) {
            if (typeof options.onScore !== 'function') return;
            if (!force && lastReportedScore === score) return;
            lastReportedScore = score;
            options.onScore({ score: score });
        }

        function notifyEvent(type) {
            if (typeof options.onEvent === 'function') options.onEvent({ type: type });
        }

        function addObstacle() {
            var gap = randomBetween(MIN_OBSTACLE_GAP, MAX_OBSTACLE_GAP);
            var x = Math.max(WORLD_WIDTH + 40, lastObstacleRight + gap);
            var type = obstacleSeed % 4;
            obstacleSeed += 1;
            var obstacle = {
                x: x,
                width: type === 0 ? 62 : type === 1 ? 30 : type === 2 ? 54 : 70,
                height: type === 0 ? 42 : type === 1 ? 86 : type === 2 ? 32 : 30,
                type: type,
                airborne: type === 3,
                hit: false
            };
            obstacle.y = obstacle.airborne ? GROUND_Y - 150 : GROUND_Y - obstacle.height;
            obstacles.push(obstacle);
            lastObstacleRight = obstacle.x + obstacle.width;
        }

        function ensureObstacles() {
            var rightmost = WORLD_WIDTH;
            obstacles.forEach(function(obstacle) {
                rightmost = Math.max(rightmost, obstacle.x + obstacle.width);
            });
            lastObstacleRight = Math.max(lastObstacleRight, rightmost);
            while (lastObstacleRight < WORLD_WIDTH + 780) addObstacle();
        }

        function obstacleContains(x, y) {
            return obstacles.some(function(obstacle) {
                return x + 12 > obstacle.x - 20 && x - 12 < obstacle.x + obstacle.width + 20
                    && y + 12 > obstacle.y - 20 && y - 12 < obstacle.y + obstacle.height + 20;
            });
        }

        function addCollectible(x, y) {
            var safeX = x;
            var safeY = y;
            var attempts = 0;
            while (obstacleContains(safeX, safeY) && attempts < 10) {
                safeX += 70;
                attempts += 1;
            }
            collectibles.push({
                x: safeX,
                y: Math.max(GROUND_Y - 145, Math.min(GROUND_Y - 32, safeY)),
                radius: 9,
                collected: false,
                seed: collectibleSeed++
            });
        }

        function ensureCollectibles() {
            var activeCount = collectibles.filter(function(item) { return !item.collected; }).length;
            var target = activeCount < MIN_COLLECTIBLES
                ? MIN_COLLECTIBLES + Math.floor(Math.random() * (MAX_COLLECTIBLES - MIN_COLLECTIBLES + 1))
                : Math.min(MAX_COLLECTIBLES, activeCount);
            var rightmost = WORLD_WIDTH + 120;
            obstacles.forEach(function(obstacle) { rightmost = Math.max(rightmost, obstacle.x + obstacle.width); });
            while (activeCount < target) {
                var x = Math.max(WORLD_WIDTH + 80, rightmost + randomBetween(90, 250));
                var y = GROUND_Y - randomBetween(38, 124);
                addCollectible(x, y);
                rightmost = x;
                activeCount += 1;
            }
        }

        function initializeWorld() {
            ensureObstacles();
            var firstX = WORLD_WIDTH + 80;
            for (var index = 0; index < 5; index += 1) {
                addCollectible(firstX + index * 170, GROUND_Y - 92);
            }
            ensureCollectibles();
        }

        function overlap(a, b) {
            return a.x < b.x + b.width && a.x + a.width > b.x
                && a.y < b.y + b.height && a.y + a.height > b.y;
        }

        function playerBox() {
            return { x: player.x + 7, y: player.y + 7, width: player.width - 14, height: player.height - 9 };
        }

        function launchJump() {
            player.vy = JUMP_VELOCITY;
            player.y -= 1;
            player.grounded = false;
            player.coyote = 0;
            player.jumpsUsed += 1;
            player.jumpCount += 1;
            player.jumpBuffer = 0;
        }

        function requestJump() {
            if (destroyed || paused || finishing) return;
            if (player.grounded || (player.coyote > 0 && player.jumpsUsed === 0)) {
                player.jumpsUsed = 0;
                launchJump();
                return;
            }
            if (player.jumpsUsed < 2) {
                launchJump();
                return;
            }
            player.jumpBuffer = BUFFER_MS;
        }

        function update(step) {
            elapsed += step;
            var speed = RUN_SPEED * (player.stumble > 0 ? 0.58 : 1);
            distance += speed * step;
            player.runFrame += step * (player.stumble > 0 ? 2 : 9);
            player.invulnerable = Math.max(0, player.invulnerable - step * 1000);
            player.stumble = Math.max(0, player.stumble - step * 1000);
            player.jumpBuffer = Math.max(0, player.jumpBuffer - step * 1000);
            if (player.grounded) player.coyote = Math.min(COYOTE_SECONDS, player.coyote + step);
            else player.coyote = Math.max(0, player.coyote - step);
            player.vy += GRAVITY * step;
            player.y += player.vy * step;
            var landed = false;
            if (player.y >= GROUND_Y - player.height) {
                landed = !player.grounded;
                player.y = GROUND_Y - player.height;
                player.vy = 0;
                player.grounded = true;
                player.coyote = COYOTE_SECONDS;
                if (landed) player.jumpsUsed = 0;
            } else {
                player.grounded = false;
            }
            if (landed && player.jumpBuffer > 0) launchJump();
            obstacles.forEach(function(obstacle) { obstacle.x -= speed * step; });
            collectibles.forEach(function(item) { item.x -= speed * step; });
            ensureObstacles();
            ensureCollectibles();
            obstacles = obstacles.filter(function(obstacle) { return obstacle.x + obstacle.width > -100; });
            collectibles = collectibles.filter(function(item) { return !item.collected && item.x > -80; });
            var box = playerBox();
            if (player.invulnerable <= 0) {
                obstacles.forEach(function(obstacle) {
                    if (obstacle.hit || !overlap(box, obstacle)) return;
                    obstacle.hit = true;
                    collisionCount += 1;
                    score -= 1;
                    notifyEvent('hit');
                    player.stumble = STUMBLE_MS;
                    player.invulnerable = INVULNERABLE_MS;
                    player.vy = Math.min(player.vy, -95);
                });
            }
            collectibles.forEach(function(item) {
                var itemBox = { x: item.x - item.radius, y: item.y - item.radius, width: item.radius * 2, height: item.radius * 2 };
                if (item.collected || !overlap(box, itemBox)) return;
                item.collected = true;
                collectedCount += 1;
                score += 1;
                notifyEvent('collect');
            });
            ensureCollectibles();
            notifyScore();
        }

        function drawRoundedRect(x, y, width, height, radius, fill, stroke) {
            context.beginPath();
            context.moveTo(x + radius, y);
            context.arcTo(x + width, y, x + width, y + height, radius);
            context.arcTo(x + width, y + height, x, y + height, radius);
            context.arcTo(x, y + height, x, y, radius);
            context.arcTo(x, y, x + width, y, radius);
            context.closePath();
            if (fill) { context.fillStyle = fill; context.fill(); }
            if (stroke) { context.strokeStyle = stroke; context.stroke(); }
        }

        function drawCat() {
            var lean = player.stumble > 0 ? 8 : 0;
            context.save();
            context.translate(player.x + lean, player.y);
            context.globalAlpha = player.invulnerable > 0 ? 0.72 : 1;
            context.fillStyle = '#315d55';
            context.beginPath();
            context.moveTo(10, 18); context.lineTo(12, 3); context.lineTo(24, 13);
            context.lineTo(39, 3); context.lineTo(42, 20); context.closePath(); context.fill();
            drawRoundedRect(4, 14, 42, 40, 15, '#315d55', '#244841');
            context.fillStyle = '#f3f8f6';
            context.beginPath(); context.arc(18, 29, 3, 0, Math.PI * 2); context.arc(34, 29, 3, 0, Math.PI * 2); context.fill();
            context.strokeStyle = '#f3f8f6'; context.beginPath(); context.moveTo(24, 40); context.quadraticCurveTo(28, 44, 32, 40); context.stroke();
            context.strokeStyle = '#315d55'; context.lineWidth = 4; context.lineCap = 'round'; context.beginPath();
            context.moveTo(9, 53); context.lineTo(player.stumble > 0 ? 3 : Math.sin(player.runFrame) * 6 + 6, 62);
            context.moveTo(40, 53); context.lineTo(player.stumble > 0 ? 45 : Math.sin(player.runFrame + Math.PI) * 6 + 34, 62); context.stroke();
            context.strokeStyle = '#244841'; context.lineWidth = 3; context.beginPath();
            context.moveTo(5, 44); context.quadraticCurveTo(-18, 34, -6, 17); context.stroke();
            context.restore();
        }

        function drawObstacle(obstacle) {
            context.save();
            if (obstacle.type === 0) {
                drawRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 6, '#d4a373', '#926c49');
            } else if (obstacle.type === 1) {
                context.fillStyle = '#d26a52'; context.beginPath();
                context.moveTo(obstacle.x + obstacle.width / 2, obstacle.y);
                context.lineTo(obstacle.x + obstacle.width, obstacle.y + obstacle.height);
                context.lineTo(obstacle.x, obstacle.y + obstacle.height); context.closePath(); context.fill();
            } else if (obstacle.type === 2) {
                drawRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 11, '#e3c27b', '#a98345');
            } else {
                drawRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 13, '#8da9c4', '#5f7892');
                context.strokeStyle = '#5f7892'; context.lineWidth = 3; context.beginPath();
                context.moveTo(obstacle.x + 12, obstacle.y + obstacle.height);
                context.lineTo(obstacle.x + 22, obstacle.y + obstacle.height + 12);
                context.moveTo(obstacle.x + obstacle.width - 12, obstacle.y + obstacle.height);
                context.lineTo(obstacle.x + obstacle.width - 22, obstacle.y + obstacle.height + 12);
                context.stroke();
            }
            context.restore();
        }

        function drawCollectible(item) {
            context.save();
            context.globalAlpha = 0.9;
            context.fillStyle = '#3f9a72';
            context.beginPath();
            context.moveTo(item.x, item.y - item.radius);
            context.lineTo(item.x + item.radius * 0.35, item.y - item.radius * 0.35);
            context.lineTo(item.x + item.radius, item.y);
            context.lineTo(item.x + item.radius * 0.35, item.y + item.radius * 0.35);
            context.lineTo(item.x, item.y + item.radius);
            context.lineTo(item.x - item.radius * 0.35, item.y + item.radius * 0.35);
            context.lineTo(item.x - item.radius, item.y);
            context.lineTo(item.x - item.radius * 0.35, item.y - item.radius * 0.35);
            context.closePath();
            context.fill();
            context.restore();
        }

        function draw() {
            if (destroyed) return;
            context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
            context.fillStyle = '#f3f8f6'; context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
            context.fillStyle = '#e6efeb'; context.fillRect(0, GROUND_Y, WORLD_WIDTH, WORLD_HEIGHT - GROUND_Y);
            context.strokeStyle = '#a6c5bc'; context.lineWidth = 3; context.beginPath();
            context.moveTo(0, GROUND_Y); context.lineTo(WORLD_WIDTH, GROUND_Y); context.stroke();
            obstacles.forEach(drawObstacle);
            collectibles.forEach(function(item) { if (!item.collected) drawCollectible(item); });
            drawCat();
        }

        function finishNow() {
            if (finishCalled) return;
            finishCalled = true;
            if (finishTimer != null) window.clearTimeout(finishTimer);
            finishTimer = null;
            var callback = finishCallback;
            finishCallback = null;
            if (typeof callback === 'function') callback();
        }

        function frame(now) {
            frameHandle = null;
            if (destroyed || paused) return;
            if (lastTime == null) lastTime = now;
            var delta = Math.min(MAX_DELTA, Math.max(0, (now - lastTime) / 1000));
            lastTime = now;
            accumulator += delta;
            while (accumulator >= STEP) { update(STEP); accumulator -= STEP; }
            draw();
            if (finishing && !finishCalled && elapsed >= 0) finishNow();
            if (!reduced && !destroyed && !paused) frameHandle = window.requestAnimationFrame(frame);
        }

        function schedule() {
            if (destroyed || paused || reduced || frameHandle != null) return;
            frameHandle = window.requestAnimationFrame(frame);
        }

        function isInteractiveKey(event) {
            var target = event.target;
            if (target && target.closest && target.closest('input,textarea,select,button,[contenteditable="true"]')) return false;
            return document.activeElement === canvas;
        }

        function onPointerDown(event) {
            if (destroyed) return;
            if (typeof canvas.focus === 'function') canvas.focus({ preventScroll: true });
            if (event && event.pointerId != null && typeof canvas.setPointerCapture === 'function') {
                try { canvas.setPointerCapture(event.pointerId); } catch (error) {}
            }
            requestJump();
        }

        function onKeyDown(event) {
            if (!isInteractiveKey(event) || event.repeat) return;
            if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
                event.preventDefault(); requestJump();
            }
        }

        function onVisibilityChange() {
            if (document.hidden) pause();
            else resume();
        }

        function pause() {
            if (destroyed) return;
            paused = true; lastTime = null; accumulator = 0;
            if (frameHandle != null) window.cancelAnimationFrame(frameHandle);
            frameHandle = null;
        }

        function resume() {
            if (destroyed) return;
            paused = false; lastTime = null; accumulator = 0; draw(); schedule();
        }

        function finish(callback) {
            if (destroyed || finishCalled) return;
            if (typeof callback === 'function' && !finishCallback) finishCallback = callback;
            finishing = true;
            if (reduced || document.hidden) finishNow();
            else {
                if (finishTimer != null) window.clearTimeout(finishTimer);
                finishTimer = window.setTimeout(finishNow, 500);
                schedule();
            }
        }

        function setTaskState(nextState) {
            if (['queued', 'analysing', 'ready', 'failed'].indexOf(nextState) >= 0) taskState = nextState;
        }

        function destroy() {
            if (destroyed) return;
            destroyed = true;
            if (frameHandle != null) window.cancelAnimationFrame(frameHandle);
            if (finishTimer != null) window.clearTimeout(finishTimer);
            frameHandle = null; finishTimer = null; finishCallback = null;
            if (resizeObserver && typeof resizeObserver.disconnect === 'function') resizeObserver.disconnect();
            if (listeningToWindowResize) window.removeEventListener('resize', resize);
            if (canvas.removeEventListener) canvas.removeEventListener('pointerdown', onPointerDown);
            if (window.removeEventListener) window.removeEventListener('keydown', onKeyDown);
            if (document.removeEventListener) document.removeEventListener('visibilitychange', onVisibilityChange);
            if (typeof context.clearRect === 'function') context.clearRect(0, 0, canvas.width || WORLD_WIDTH, canvas.height || WORLD_HEIGHT);
        }

        function snapshot() {
            return {
                supported: true,
                destroyed: destroyed,
                paused: paused,
                taskState: taskState,
                finishing: finishing,
                score: score,
                distance: Math.floor(distance),
                collisionCount: collisionCount,
                collectedCount: collectedCount,
                collectibleCount: collectibles.filter(function(item) { return !item.collected; }).length,
                player: {
                    x: player.x, y: player.y, vy: player.vy, grounded: player.grounded,
                    jumpCount: player.jumpCount, jumpsUsed: player.jumpsUsed, jumpBuffer: player.jumpBuffer
                },
                obstacles: obstacles.map(function(obstacle) {
                    return { x: obstacle.x, y: obstacle.y, width: obstacle.width, height: obstacle.height, type: obstacle.type, airborne: obstacle.airborne, hit: obstacle.hit };
                })
            };
        }

        canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
        window.addEventListener('keydown', onKeyDown, { passive: false });
        if (document.addEventListener) document.addEventListener('visibilitychange', onVisibilityChange);
        if (window.ResizeObserver) {
            resizeObserver = new window.ResizeObserver(resize); resizeObserver.observe(canvas);
        } else {
            window.addEventListener('resize', resize); listeningToWindowResize = true;
        }
        initializeWorld();
        resize();
        if (document.hidden) pause(); else if (!reduced) schedule();
        notifyScore(true);

        return {
            jump: requestJump,
            setTaskState: setTaskState,
            finish: finish,
            pause: pause,
            resume: resume,
            destroy: destroy,
            snapshot: snapshot
        };
    }

    window.MrCatWaitingRunner = {
        mount: mount,
        isSupported: function() { return supportedCanvas(document && document.createElement ? document.createElement('canvas') : null); }
    };
})(window, document);
