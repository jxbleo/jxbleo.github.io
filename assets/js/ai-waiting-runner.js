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
    var MIN_OBSTACLE_GAP = 330;
    var MAX_OBSTACLE_GAP = 560;
    var STUMBLE_MS = 600;
    var INVULNERABLE_MS = 1200;

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
        ['setTransform', 'scale', 'clearRect', 'fillRect', 'fill', 'stroke', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'arcTo', 'quadraticCurveTo', 'save', 'restore', 'translate'].forEach(function(name) {
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
        var finishElapsed = 0;
        var distance = 0;
        var ink = 0;
        var obstacleSeed = 0;
        var lastObstacleRight = WORLD_WIDTH + 120;
        var obstacles = [];
        var drops = [];
        var taskState = 'queued';
        var player = {
            x: 160,
            y: GROUND_Y - 62,
            width: 48,
            height: 62,
            vy: 0,
            grounded: true,
            coyote: 0,
            stumble: 0,
            invulnerable: 0,
            stumbleCount: 0,
            runFrame: 0
        };

        function randomBetween(min, max) {
            return min + Math.random() * (max - min);
        }

        function dimensions() {
            var rect = typeof canvas.getBoundingClientRect === 'function'
                ? canvas.getBoundingClientRect()
                : { width: canvas.clientWidth || WORLD_WIDTH, height: canvas.clientHeight || WORLD_HEIGHT };
            var width = Math.max(280, rect.width || canvas.clientWidth || WORLD_WIDTH);
            var height = Math.max(120, rect.height || canvas.clientHeight || width * 7 / 16);
            return { width: width, height: height };
        }

        function resize() {
            if (destroyed) return;
            var size = dimensions();
            var dpr = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
            canvas.width = Math.round(size.width * dpr);
            canvas.height = Math.round(size.height * dpr);
            canvas.style.width = '100%';
            canvas.style.height = 'auto';
            if (typeof context.setTransform === 'function') context.setTransform(dpr * size.width / WORLD_WIDTH, 0, 0, dpr * size.height / WORLD_HEIGHT, 0, 0);
            else if (typeof context.scale === 'function') context.scale(dpr * size.width / WORLD_WIDTH, dpr * size.height / WORLD_HEIGHT);
            draw();
        }

        function notifyScore() {
            if (typeof options.onScore !== 'function') return;
            options.onScore({ distance: Math.floor(distance), ink: ink });
        }

        function addObstacle() {
            var gap = randomBetween(MIN_OBSTACLE_GAP, MAX_OBSTACLE_GAP);
            var x = Math.max(WORLD_WIDTH + 40, lastObstacleRight + gap);
            var type = obstacleSeed % 3;
            obstacleSeed += 1;
            var obstacle = {
                x: x,
                width: type === 0 ? 62 : type === 1 ? 30 : 54,
                height: type === 0 ? 42 : type === 1 ? 86 : 32,
                type: type
            };
            obstacle.y = GROUND_Y - obstacle.height;
            obstacles.push(obstacle);
            lastObstacleRight = obstacle.x + obstacle.width;
            if (Math.random() > 0.28) {
                drops.push({ x: obstacle.x - randomBetween(72, 126), y: GROUND_Y - randomBetween(78, 140), radius: 8, collected: false });
            }
        }

        function ensureObstacles() {
            var rightmost = WORLD_WIDTH;
            obstacles.forEach(function(obstacle) {
                rightmost = Math.max(rightmost, obstacle.x + obstacle.width);
            });
            lastObstacleRight = rightmost;
            while (lastObstacleRight < WORLD_WIDTH + 720) addObstacle();
        }

        function overlap(a, b) {
            return a.x < b.x + b.width && a.x + a.width > b.x
                && a.y < b.y + b.height && a.y + a.height > b.y;
        }

        function playerBox() {
            return { x: player.x + 7, y: player.y + 7, width: player.width - 14, height: player.height - 9 };
        }

        function update(step) {
            elapsed += step;
            if (finishing) finishElapsed += step;
            var speed = RUN_SPEED * (player.stumble > 0 ? 0.58 : 1);
            distance += speed * step;
            player.runFrame += step * (player.stumble > 0 ? 2 : 9);
            player.invulnerable = Math.max(0, player.invulnerable - step * 1000);
            player.stumble = Math.max(0, player.stumble - step * 1000);
            if (player.grounded) player.coyote = Math.min(0.1, player.coyote + step);
            else player.coyote = Math.max(0, player.coyote - step);
            player.vy += GRAVITY * step;
            player.y += player.vy * step;
            if (player.y >= GROUND_Y - player.height) {
                player.y = GROUND_Y - player.height;
                player.vy = 0;
                player.grounded = true;
                player.coyote = 0.1;
            } else {
                player.grounded = false;
            }
            obstacles.forEach(function(obstacle) { obstacle.x -= speed * step; });
            drops.forEach(function(drop) { drop.x -= speed * step; });
            ensureObstacles();
            obstacles = obstacles.filter(function(obstacle) { return obstacle.x + obstacle.width > -100; });
            drops = drops.filter(function(drop) { return !drop.collected && drop.x > -80; });
            var box = playerBox();
            if (player.invulnerable <= 0) {
                obstacles.some(function(obstacle) {
                    if (!overlap(box, obstacle)) return false;
                    player.stumble = STUMBLE_MS;
                    player.invulnerable = INVULNERABLE_MS;
                    player.stumbleCount += 1;
                    player.vy = Math.min(player.vy, -95);
                    return true;
                });
            }
            drops.forEach(function(drop) {
                var dropBox = { x: drop.x - drop.radius, y: drop.y - drop.radius, width: drop.radius * 2, height: drop.radius * 2 };
                if (overlap(box, dropBox)) {
                    drop.collected = true;
                    ink += 1;
                }
            });
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
            var x = player.x + lean;
            var y = player.y;
            context.save();
            context.translate(x, y);
            context.globalAlpha = player.invulnerable > 0 ? 0.72 : 1;
            context.fillStyle = '#315d55';
            context.beginPath();
            context.moveTo(10, 18);
            context.lineTo(12, 3);
            context.lineTo(24, 13);
            context.lineTo(39, 3);
            context.lineTo(42, 20);
            context.closePath();
            context.fill();
            drawRoundedRect(4, 14, 42, 40, 15, '#315d55');
            context.strokeStyle = '#244841';
            context.lineWidth = 2;
            context.stroke();
            context.fillStyle = '#f3f8f6';
            context.beginPath();
            context.arc(18, 29, 3, 0, Math.PI * 2);
            context.arc(34, 29, 3, 0, Math.PI * 2);
            context.fill();
            context.strokeStyle = '#f3f8f6';
            context.beginPath();
            context.moveTo(24, 40);
            context.quadraticCurveTo(28, 44, 32, 40);
            context.stroke();
            context.strokeStyle = '#315d55';
            context.lineWidth = 4;
            context.lineCap = 'round';
            context.beginPath();
            context.moveTo(9, 53);
            context.lineTo(player.stumble > 0 ? 3 : (Math.sin(player.runFrame) * 6 + 6), 62);
            context.moveTo(40, 53);
            context.lineTo(player.stumble > 0 ? 45 : (Math.sin(player.runFrame + Math.PI) * 6 + 34), 62);
            context.stroke();
            context.strokeStyle = '#244841';
            context.lineWidth = 3;
            context.beginPath();
            context.moveTo(5, 44);
            context.quadraticCurveTo(-18, 34, -6, 17);
            context.stroke();
            context.restore();
        }

        function drawObstacle(obstacle) {
            context.save();
            if (obstacle.type === 0) {
                drawRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 6, '#d4a373', '#926c49');
                context.strokeStyle = 'rgba(76,53,33,.45)';
                context.beginPath();
                context.moveTo(obstacle.x + 12, obstacle.y + 7);
                context.lineTo(obstacle.x + 12, obstacle.y + obstacle.height - 7);
                context.moveTo(obstacle.x + obstacle.width - 12, obstacle.y + 7);
                context.lineTo(obstacle.x + obstacle.width - 12, obstacle.y + obstacle.height - 7);
                context.stroke();
            } else if (obstacle.type === 1) {
                context.fillStyle = '#d26a52';
                context.beginPath();
                context.moveTo(obstacle.x + obstacle.width / 2, obstacle.y);
                context.lineTo(obstacle.x + obstacle.width, obstacle.y + obstacle.height);
                context.lineTo(obstacle.x, obstacle.y + obstacle.height);
                context.closePath();
                context.fill();
                context.fillStyle = '#e6c08a';
                context.fillRect(obstacle.x + 5, obstacle.y + obstacle.height - 13, obstacle.width - 10, 7);
            } else {
                drawRoundedRect(obstacle.x, obstacle.y, obstacle.width, obstacle.height, 11, '#e3c27b', '#a98345');
                context.strokeStyle = 'rgba(96,70,33,.5)';
                context.beginPath();
                context.moveTo(obstacle.x + 9, obstacle.y + 8);
                context.lineTo(obstacle.x + obstacle.width - 9, obstacle.y + obstacle.height - 8);
                context.stroke();
            }
            context.restore();
        }

        function drawDrop(drop) {
            context.save();
            context.globalAlpha = 0.9;
            context.fillStyle = '#4e8c82';
            context.beginPath();
            context.moveTo(drop.x, drop.y - drop.radius);
            context.quadraticCurveTo(drop.x + drop.radius * 1.4, drop.y, drop.x, drop.y + drop.radius);
            context.quadraticCurveTo(drop.x - drop.radius * 1.4, drop.y, drop.x, drop.y - drop.radius);
            context.fill();
            context.restore();
        }

        function drawFinishGate() {
            var gateX = WORLD_WIDTH - 100 - Math.min(1, finishElapsed / 0.3) * 180;
            context.strokeStyle = '#4e8c82';
            context.lineWidth = 7;
            context.beginPath();
            context.moveTo(gateX, GROUND_Y);
            context.lineTo(gateX, GROUND_Y - 110);
            context.moveTo(gateX + 70, GROUND_Y);
            context.lineTo(gateX + 70, GROUND_Y - 110);
            context.moveTo(gateX, GROUND_Y - 110);
            context.lineTo(gateX + 70, GROUND_Y - 110);
            context.stroke();
            context.fillStyle = '#e9f1ed';
            drawRoundedRect(gateX + 14, GROUND_Y - 98, 42, 30, 8, '#e9f1ed', '#4e8c82');
            context.strokeStyle = '#4e8c82';
            context.lineWidth = 3;
            context.beginPath();
            context.moveTo(gateX + 24, GROUND_Y - 84);
            context.lineTo(gateX + 32, GROUND_Y - 76);
            context.lineTo(gateX + 47, GROUND_Y - 92);
            context.stroke();
        }

        function draw() {
            if (destroyed) return;
            context.clearRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
            context.fillStyle = '#f3f8f6';
            context.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
            context.fillStyle = '#e6efeb';
            context.fillRect(0, GROUND_Y, WORLD_WIDTH, WORLD_HEIGHT - GROUND_Y);
            context.strokeStyle = '#a6c5bc';
            context.lineWidth = 3;
            context.beginPath();
            context.moveTo(0, GROUND_Y);
            context.lineTo(WORLD_WIDTH, GROUND_Y);
            context.stroke();
            obstacles.forEach(drawObstacle);
            drops.forEach(function(drop) { if (!drop.collected) drawDrop(drop); });
            if (finishing) drawFinishGate();
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
            while (accumulator >= STEP) {
                update(STEP);
                accumulator -= STEP;
            }
            draw();
            if (finishing && !finishCalled && finishElapsed >= 0.3) finishNow();
            if (!reduced && !destroyed && !paused && !finishCalled) frameHandle = window.requestAnimationFrame(frame);
        }

        function schedule() {
            if (destroyed || paused || reduced || frameHandle != null) return;
            frameHandle = window.requestAnimationFrame(frame);
        }

        function jump() {
            if (destroyed || paused || finishing) return;
            if (!player.grounded && player.coyote <= 0) return;
            player.vy = JUMP_VELOCITY;
            player.grounded = false;
            player.coyote = 0;
            schedule();
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
            jump();
        }

        function onKeyDown(event) {
            if (!isInteractiveKey(event) || event.repeat) return;
            if (event.key === ' ' || event.key === 'ArrowUp' || event.key === 'w' || event.key === 'W') {
                event.preventDefault();
                jump();
            }
        }

        function onVisibilityChange() {
            if (document.hidden) {
                if (finishing) finishNow();
                else pause();
            } else if (!finishing) {
                resume();
            }
        }

        function pause() {
            if (destroyed) return;
            paused = true;
            lastTime = null;
            accumulator = 0;
            if (frameHandle != null) window.cancelAnimationFrame(frameHandle);
            frameHandle = null;
        }

        function resume() {
            if (destroyed) return;
            paused = false;
            lastTime = null;
            accumulator = 0;
            draw();
            schedule();
        }

        function finish(callback) {
            if (destroyed || finishCalled) return;
            if (typeof callback === 'function' && !finishCallback) finishCallback = callback;
            finishing = true;
            finishElapsed = 0;
            if (reduced || document.hidden) {
                finishNow();
                return;
            }
            finishTimer = window.setTimeout(finishNow, 500);
            schedule();
        }

        function setTaskState(nextState) {
            if (['queued', 'analysing', 'ready', 'failed'].indexOf(nextState) >= 0) taskState = nextState;
        }

        function destroy() {
            if (destroyed) return;
            destroyed = true;
            if (frameHandle != null) window.cancelAnimationFrame(frameHandle);
            if (finishTimer != null) window.clearTimeout(finishTimer);
            frameHandle = null;
            finishTimer = null;
            finishCallback = null;
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
                distance: Math.floor(distance),
                ink: ink,
                player: { x: player.x, y: player.y, vy: player.vy, grounded: player.grounded },
                obstacles: obstacles.map(function(obstacle) { return { x: obstacle.x, width: obstacle.width, height: obstacle.height, type: obstacle.type }; }),
                stumbleCount: player.stumbleCount
            };
        }

        canvas.addEventListener('pointerdown', onPointerDown, { passive: true });
        window.addEventListener('keydown', onKeyDown, { passive: false });
        if (document.addEventListener) document.addEventListener('visibilitychange', onVisibilityChange);
        if (window.ResizeObserver) {
            resizeObserver = new window.ResizeObserver(resize);
            resizeObserver.observe(canvas);
        } else {
            window.addEventListener('resize', resize);
            listeningToWindowResize = true;
        }
        ensureObstacles();
        resize();
        if (document.hidden) pause();
        else if (!reduced) schedule();
        notifyScore();

        return {
            jump: jump,
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
