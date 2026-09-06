(function(window, document) {
    'use strict';

    var overlay = document.getElementById('my-words-scan-overlay');
    var openButton = document.querySelector('[data-open-scan]');
    var manualButton = document.querySelector('[data-open-manual]');
    if (!overlay || !openButton || !window.MrCatCloud) return;

    var statusNode = document.getElementById('my-words-scan-status');
    var shell = overlay.querySelector('.my-words-scan-shell');
    var pageHost = overlay.querySelector('[data-scan-pages]');
    var photoEmpty = overlay.querySelector('[data-scan-photo-empty]');
    var photoCount = overlay.querySelector('[data-scan-photo-count]');
    var photoChoice = overlay.querySelector('[data-scan-photo-choice]');
    var photoChoiceTitle = overlay.querySelector('#my-words-scan-photo-choice-title');
    var editorHost = overlay.querySelector('[data-scan-editor]');
    var reviewHost = overlay.querySelector('[data-scan-review]');
    var reviewHeading = overlay.querySelector('[data-scan-review-heading]');
    var progressHost = overlay.querySelector('[data-scan-progress]');
    var progressStep = overlay.querySelector('[data-scan-progress-step]');
    var progressTrack = overlay.querySelector('[data-scan-progress-track]');
    var progressBar = overlay.querySelector('[data-scan-progress-bar]');
    var progressCount = overlay.querySelector('[data-scan-progress-count]');
    var readyHint = overlay.querySelector('[data-scan-ready-hint]');
    var drawer = overlay.querySelector('[data-scan-drawer]');
    var drawerHost = overlay.querySelector('[data-scan-candidate-list]');
    var countNode = overlay.querySelector('[data-scan-selected-count]');
    var commitButton = overlay.querySelector('[data-scan-commit]');
    var drawerToggle = overlay.querySelector('[data-scan-drawer-toggle]');
    var phraseActions = overlay.querySelector('.my-words-scan-phrase-actions');
    var preview = overlay.querySelector('[data-scan-preview]');
    var previewImage = overlay.querySelector('[data-scan-preview-image]');
    var phases = Array.prototype.slice.call(overlay.querySelectorAll('[data-scan-phase]'));
    var isDashboardScan = overlay.classList.contains('dashboard-words-scan-overlay');

    var state = {
        phase: 'choose',
        files: [],
        activePhoto: 0,
        activeEditor: 0,
        editorMode: 'crop',
        scan: null,
        selected: new Map(),
        candidates: [],
        tokenRegistry: new Map(),
        phrase: null,
        pollTimer: null,
        syncTimer: null,
        syncPromise: null,
        syncDirty: false,
        candidateRevision: 0,
        nextRevision: 0,
        uploadOperation: null,
        preparedFiles: null,
        commitOperation: null,
        didCommit: false,
        busy: false,
        photoChoiceOpen: false,
        photoChoiceReplaceIndex: null,
        pendingPhotoReplaceIndex: null,
        photoChoiceReturnFocus: null,
        lastFocus: null,
        scrollY: 0,
        bodyStyle: null
    };

    function say(message) {
        statusNode.textContent = message || '';
    }

    function makeOperation(prefix) {
        if (window.crypto && window.crypto.randomUUID) return prefix + '-' + window.crypto.randomUUID();
        return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
    }

    function setPhase(name) {
        state.phase = name;
        overlay.classList.toggle('is-choose-phase', name === 'choose');
        shell.classList.toggle('is-choose-phase', name === 'choose');
        phases.forEach(function(phase) {
            phase.hidden = phase.dataset.scanPhase !== name;
        });
    }

    function setBusy(busy) {
        state.busy = busy;
        overlay.querySelectorAll('[data-scan-run], [data-scan-commit], [data-scan-discard], [data-scan-close]').forEach(function(button) {
            button.disabled = busy;
        });
        if (!busy) renderDrawer();
    }

    function callScan(payload) {
        return window.MrCatCloud.callFunction('vocabularyScan', payload).then(function(result) {
            if (!result || !result.success) throw new Error(result && result.message || 'Scan Words could not complete that action.');
            return result;
        });
    }

    function lockPage() {
        state.scrollY = window.scrollY || window.pageYOffset || 0;
        state.bodyStyle = {
            position: document.body.style.position,
            top: document.body.style.top,
            left: document.body.style.left,
            right: document.body.style.right,
            width: document.body.style.width,
            overflow: document.body.style.overflow
        };
        document.body.style.position = 'fixed';
        document.body.style.top = '-' + state.scrollY + 'px';
        document.body.style.left = '0';
        document.body.style.right = '0';
        document.body.style.width = '100%';
        document.body.style.overflow = 'hidden';
    }

    function unlockPage() {
        if (!state.bodyStyle) return;
        Object.keys(state.bodyStyle).forEach(function(key) {
            document.body.style[key] = state.bodyStyle[key];
        });
        window.scrollTo(0, state.scrollY);
        state.bodyStyle = null;
    }

    function stopPolling() {
        if (state.pollTimer) window.clearTimeout(state.pollTimer);
        state.pollTimer = null;
    }

    function releaseLocalFiles() {
        state.files.forEach(function(item) {
            if (item.url) URL.revokeObjectURL(item.url);
        });
        state.files = [];
        state.activePhoto = 0;
        state.preparedFiles = null;
        state.uploadOperation = null;
    }

    function resetSelection() {
        state.selected.clear();
        state.candidates = [];
        state.tokenRegistry.clear();
        state.phrase = null;
        state.syncDirty = false;
        state.candidateRevision = 0;
        state.nextRevision = 0;
        state.commitOperation = null;
        phraseActions.hidden = true;
        drawerHost.hidden = false;
        drawer.classList.remove('is-collapsed');
        drawer.classList.add('is-empty');
        drawerToggle.setAttribute('aria-expanded', 'true');
    }

    function closePreview() {
        preview.hidden = true;
        previewImage.removeAttribute('src');
    }

    function closePhotoChoice(restoreFocus) {
        if (!state.photoChoiceOpen) return;
        var focusTarget = state.photoChoiceReturnFocus;
        state.photoChoiceOpen = false;
        state.photoChoiceReplaceIndex = null;
        state.photoChoiceReturnFocus = null;
        photoChoice.hidden = true;
        shell.inert = false;
        if (restoreFocus !== false && focusTarget && focusTarget.isConnected && focusTarget.focus) {
            focusTarget.focus({ preventScroll: true });
        }
    }

    function openPhotoChoice(trigger, replaceIndex) {
        var replacing = Number.isInteger(replaceIndex) && Boolean(state.files[replaceIndex]);
        if (state.busy || (!replacing && state.files.length >= 5) || state.photoChoiceOpen) {
            if (!replacing && state.files.length >= 5) say('You can scan up to five photos at a time.');
            return;
        }
        state.photoChoiceOpen = true;
        state.photoChoiceReplaceIndex = replacing ? replaceIndex : null;
        state.photoChoiceReturnFocus = trigger || document.activeElement;
        photoChoiceTitle.textContent = replacing ? 'Replace Photo' : 'Add Photos';
        photoChoice.hidden = false;
        shell.inert = true;
        window.requestAnimationFrame(function() {
            var first = photoChoice.querySelector('[data-scan-photo-source="camera"]');
            if (first) first.focus({ preventScroll: true });
        });
    }

    function close() {
        if (state.busy) return;
        stopPolling();
        if (state.syncTimer) window.clearTimeout(state.syncTimer);
        state.syncTimer = null;
        closePreview();
        closePhotoChoice(false);
        overlay.hidden = true;
        unlockPage();
        releaseLocalFiles();
        state.scan = null;
        resetSelection();
        say('');
        if (state.didCommit) window.dispatchEvent(new CustomEvent('mrcat:scan-committed'));
        state.didCommit = false;
        window.dispatchEvent(new CustomEvent('mrcat:scan-closed'));
        if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
    }

    function safeFile(file) {
        if (!file || file.size < 1 || file.size > 10 * 1024 * 1024) return false;
        if (/^image\/(?:jpeg|png|webp|heic|heif)$/i.test(file.type || '')) return true;
        return /\.(?:jpe?g|png|webp|heic|heif)$/i.test(file.name || '');
    }

    function loadImage(file) {
        return new Promise(function(resolve, reject) {
            var url = URL.createObjectURL(file);
            var image = new Image();
            image.onload = function() {
                resolve({
                    file: file,
                    image: image,
                    url: url,
                    crop: { x: 0, y: 0, w: 1, h: 1 },
                    commands: [],
                    undo: [],
                    redo: []
                });
            };
            image.onerror = function() {
                URL.revokeObjectURL(url);
                reject(new Error(/^image\/hei/i.test(file.type || '') ? 'This browser cannot read HEIC. Convert it to JPG or take the photo again.' : 'This photo could not be read.'));
            };
            image.src = url;
        });
    }

    function addFiles(fileList, replaceIndex) {
        var incoming = Array.prototype.slice.call(fileList || []);
        if (!incoming.length) return;
        if (replaceIndex == null && state.files.length + incoming.length > 5) {
            say('Choose no more than five photos.');
            return;
        }
        if (replaceIndex != null) incoming = incoming.slice(0, 1);
        var invalid = incoming.find(function(file) { return !safeFile(file); });
        if (invalid) {
            say('Choose a JPG, PNG, WebP, or browser-readable HEIC photo no larger than 10 MB.');
            return;
        }
        Promise.all(incoming.map(loadImage)).then(function(items) {
            if (replaceIndex != null && state.files[replaceIndex]) {
                URL.revokeObjectURL(state.files[replaceIndex].url);
                state.files.splice(replaceIndex, 1, items[0]);
            } else {
                state.files = state.files.concat(items);
                state.activePhoto = Math.max(0, state.files.length - items.length);
            }
            if (replaceIndex != null) state.activePhoto = replaceIndex;
            state.activeEditor = Math.min(state.activeEditor, Math.max(0, state.files.length - 1));
            renderPages();
            if (state.phase === 'edit') renderEditor();
            say('');
        }).catch(function(error) {
            say(error.message);
        });
    }

    function scanIcon(paths) {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('aria-hidden', 'true');
        paths.forEach(function(value) {
            var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', value);
            svg.appendChild(path);
        });
        return svg;
    }

    function renderPages() {
        pageHost.textContent = '';
        state.activePhoto = Math.max(0, Math.min(state.activePhoto, Math.max(0, state.files.length - 1)));
        var hasPhotos = state.files.length > 0;
        pageHost.hidden = !hasPhotos;
        photoEmpty.hidden = hasPhotos;
        photoCount.textContent = state.files.length + ' of 5 photo' + (state.files.length === 1 ? '' : 's');
        if (hasPhotos) {
            var index = state.activePhoto;
            var item = state.files[index];
            var card = document.createElement('figure');
            card.className = 'my-words-scan-photo-card';
            var counter = document.createElement('span');
            counter.className = 'my-words-scan-photo-counter';
            counter.setAttribute('role', 'status');
            counter.setAttribute('aria-live', 'polite');
            counter.textContent = 'Page ' + (index + 1) + '/' + state.files.length;
            var frame = document.createElement('div');
            frame.className = 'my-words-scan-photo-frame';
            var open = document.createElement('button');
            open.type = 'button';
            open.className = 'my-words-scan-photo-open';
            open.setAttribute('aria-label', 'Enlarge photo ' + (index + 1));
            var image = document.createElement('img');
            image.src = item.url;
            image.alt = 'Selected photo ' + (index + 1) + ' of ' + state.files.length;
            open.appendChild(image);
            open.addEventListener('click', function() {
                previewImage.src = item.url;
                preview.hidden = false;
                overlay.querySelector('[data-scan-preview-close]').focus();
            });
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'my-words-scan-photo-remove';
            remove.setAttribute('aria-label', 'Remove photo ' + (index + 1));
            remove.appendChild(scanIcon(['m7 7 10 10', 'M17 7 7 17']));
            remove.addEventListener('click', function() {
                URL.revokeObjectURL(item.url);
                state.files.splice(index, 1);
                state.activePhoto = Math.min(index, Math.max(0, state.files.length - 1));
                state.activeEditor = Math.min(state.activeEditor, Math.max(0, state.files.length - 1));
                renderPages();
            });
            frame.appendChild(open);
            frame.appendChild(remove);
            if (state.files.length > 1) {
                [-1, 1].forEach(function(step) {
                    var arrow = document.createElement('button');
                    arrow.type = 'button';
                    arrow.className = 'my-words-scan-photo-arrow ' + (step < 0 ? 'is-previous' : 'is-next');
                    arrow.disabled = step < 0 ? index === 0 : index === state.files.length - 1;
                    arrow.setAttribute('aria-label', step < 0 ? 'Previous photo' : 'Next photo');
                    arrow.appendChild(scanIcon([step < 0 ? 'm15 5-7 7 7 7' : 'm9 5 7 7-7 7']));
                    arrow.addEventListener('click', function() { state.activePhoto += step; renderPages(); });
                    frame.appendChild(arrow);
                });
            }
            var actions = document.createElement('div');
            actions.className = 'my-words-scan-photo-actions';
            var replace = document.createElement('button');
            replace.type = 'button';
            replace.className = 'my-words-scan-replace-photo';
            replace.appendChild(scanIcon(['M4 7h11', 'm12 4 3 3-3 3', 'M20 17H9', 'm12 3-3 3 3 3']));
            replace.appendChild(document.createTextNode('Replace'));
            replace.addEventListener('click', function() { openPhotoChoice(replace, index); });
            var add = document.createElement('button');
            add.type = 'button';
            add.className = 'outline-button my-words-scan-add-photo';
            add.disabled = state.files.length >= 5;
            add.appendChild(scanIcon(['M4 8.5h16v10.5H4z', 'm8 8.5 1.3-2h5.4l1.3 2', 'M12 11v5', 'M9.5 13.5h5']));
            add.appendChild(document.createTextNode(state.files.length >= 5 ? '5 Photos Added' : 'Add Photo'));
            add.addEventListener('click', function() { openPhotoChoice(add); });
            actions.appendChild(replace);
            actions.appendChild(add);
            card.appendChild(counter);
            card.appendChild(frame);
            card.appendChild(actions);
            pageHost.appendChild(card);
        }
        overlay.querySelector('[data-scan-next]').disabled = state.files.length < 1;
    }

    function cloneEditState(item) {
        return {
            crop: { x: item.crop.x, y: item.crop.y, w: item.crop.w, h: item.crop.h },
            commands: item.commands.map(function(command) {
                return { mode: command.mode, size: command.size, points: command.points.map(function(point) { return { x: point.x, y: point.y }; }) };
            })
        };
    }

    function restoreEditState(item, snapshot) {
        item.crop = snapshot.crop;
        item.commands = snapshot.commands;
    }

    function pushUndo(item) {
        item.undo.push(cloneEditState(item));
        if (item.undo.length > 60) item.undo.shift();
        item.redo = [];
    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function normalizedPoint(event, canvas) {
        var rect = canvas.getBoundingClientRect();
        return {
            x: clamp((event.clientX - rect.left) / Math.max(1, rect.width), 0, 1),
            y: clamp((event.clientY - rect.top) / Math.max(1, rect.height), 0, 1)
        };
    }

    function drawCommands(ctx, commands, width, height) {
        var mask = document.createElement('canvas');
        mask.width = width;
        mask.height = height;
        var maskContext = mask.getContext('2d');
        commands.forEach(function(command) {
            if (!command.points.length) return;
            maskContext.save();
            maskContext.globalCompositeOperation = command.mode === 'erase' ? 'destination-out' : 'source-over';
            maskContext.strokeStyle = '#fff';
            maskContext.fillStyle = '#fff';
            maskContext.lineCap = 'round';
            maskContext.lineJoin = 'round';
            maskContext.lineWidth = Math.max(1, command.size * Math.max(width, height));
            maskContext.beginPath();
            command.points.forEach(function(point, index) {
                var x = point.x * width;
                var y = point.y * height;
                if (index) maskContext.lineTo(x, y);
                else maskContext.moveTo(x, y);
            });
            if (command.points.length === 1) {
                maskContext.arc(command.points[0].x * width, command.points[0].y * height, maskContext.lineWidth / 2, 0, Math.PI * 2);
                maskContext.fill();
            } else {
                maskContext.stroke();
            }
            maskContext.restore();
        });
        ctx.drawImage(mask, 0, 0);
    }

    function cropHandles(crop) {
        return [
            { name: 'nw', x: crop.x, y: crop.y },
            { name: 'ne', x: crop.x + crop.w, y: crop.y },
            { name: 'sw', x: crop.x, y: crop.y + crop.h },
            { name: 'se', x: crop.x + crop.w, y: crop.y + crop.h }
        ];
    }

    function renderEditor() {
        editorHost.textContent = '';
        var item = state.files[state.activeEditor];
        if (!item) {
            setPhase('choose');
            renderPages();
            return;
        }
        var imageWidth = item.image.naturalWidth || item.image.width;
        var imageHeight = item.image.naturalHeight || item.image.height;
        var scale = Math.min(1, 1200 / Math.max(imageWidth, imageHeight));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(imageWidth * scale));
        canvas.height = Math.max(1, Math.round(imageHeight * scale));
        canvas.setAttribute('aria-label', 'Crop or mask photo ' + (state.activeEditor + 1));
        var ctx = canvas.getContext('2d');
        var gesture = null;

        function paint() {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(item.image, 0, 0, canvas.width, canvas.height);
            drawCommands(ctx, item.commands, canvas.width, canvas.height);
            var crop = item.crop;
            var x = crop.x * canvas.width;
            var y = crop.y * canvas.height;
            var w = crop.w * canvas.width;
            var h = crop.h * canvas.height;
            ctx.save();
            ctx.fillStyle = 'rgba(18, 33, 29, .48)';
            ctx.beginPath();
            ctx.rect(0, 0, canvas.width, canvas.height);
            ctx.rect(x, y, w, h);
            ctx.fill('evenodd');
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, w, h);
            if (state.editorMode === 'crop') {
                cropHandles(crop).forEach(function(handle) {
                    ctx.beginPath();
                    ctx.fillStyle = '#fff';
                    ctx.strokeStyle = '#21664f';
                    ctx.lineWidth = 2;
                    ctx.arc(handle.x * canvas.width, handle.y * canvas.height, 9, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.stroke();
                });
            }
            ctx.restore();
        }

        function cropGesture(point) {
            var rect = canvas.getBoundingClientRect();
            var radius = 18 / Math.max(1, Math.min(rect.width, rect.height));
            var handle = cropHandles(item.crop).find(function(candidate) {
                return Math.hypot(point.x - candidate.x, point.y - candidate.y) <= radius;
            });
            if (handle) return { type: 'handle', handle: handle.name, start: point, original: cloneEditState(item).crop };
            if (point.x >= item.crop.x && point.x <= item.crop.x + item.crop.w && point.y >= item.crop.y && point.y <= item.crop.y + item.crop.h) {
                return { type: 'move', start: point, original: cloneEditState(item).crop };
            }
            return null;
        }

        function updateCrop(current) {
            var original = gesture.original;
            var dx = current.x - gesture.start.x;
            var dy = current.y - gesture.start.y;
            if (gesture.type === 'move') {
                item.crop.x = clamp(original.x + dx, 0, 1 - original.w);
                item.crop.y = clamp(original.y + dy, 0, 1 - original.h);
                return;
            }
            var left = original.x;
            var top = original.y;
            var right = original.x + original.w;
            var bottom = original.y + original.h;
            if (gesture.handle.indexOf('w') >= 0) left = clamp(original.x + dx, 0, right - .1);
            if (gesture.handle.indexOf('e') >= 0) right = clamp(original.x + original.w + dx, left + .1, 1);
            if (gesture.handle.indexOf('n') >= 0) top = clamp(original.y + dy, 0, bottom - .1);
            if (gesture.handle.indexOf('s') >= 0) bottom = clamp(original.y + original.h + dy, top + .1, 1);
            item.crop = { x: left, y: top, w: right - left, h: bottom - top };
        }

        canvas.addEventListener('pointerdown', function(event) {
            var point = normalizedPoint(event, canvas);
            if (state.editorMode === 'crop') {
                gesture = cropGesture(point);
                if (!gesture) return;
            } else {
                gesture = {
                    type: 'stroke',
                    command: {
                        mode: state.editorMode,
                        size: Number(overlay.querySelector('[data-scan-brush]').value || 24) / Math.max(1, Math.max(canvas.getBoundingClientRect().width, canvas.getBoundingClientRect().height)),
                        points: [point]
                    }
                };
            }
            pushUndo(item);
            if (gesture.type === 'stroke') item.commands.push(gesture.command);
            canvas.setPointerCapture(event.pointerId);
            paint();
        });
        canvas.addEventListener('pointermove', function(event) {
            if (!gesture) return;
            var point = normalizedPoint(event, canvas);
            if (gesture.type === 'stroke') gesture.command.points.push(point);
            else updateCrop(point);
            paint();
        });
        ['pointerup', 'pointercancel'].forEach(function(type) {
            canvas.addEventListener(type, function() { gesture = null; });
        });

        editorHost.appendChild(canvas);
        item.paint = paint;
        overlay.querySelector('[data-scan-page-label]').textContent = 'Photo ' + (state.activeEditor + 1) + ' / ' + state.files.length;
        overlay.querySelector('[data-scan-page-prev]').disabled = state.activeEditor === 0;
        overlay.querySelector('[data-scan-page-next]').disabled = state.activeEditor >= state.files.length - 1;
        overlay.querySelectorAll('[data-scan-mode]').forEach(function(button) {
            button.setAttribute('aria-pressed', button.dataset.scanMode === state.editorMode ? 'true' : 'false');
        });
        paint();
    }

    function exportProcessed(item, index) {
        var imageWidth = item.image.naturalWidth || item.image.width;
        var imageHeight = item.image.naturalHeight || item.image.height;
        var sx = Math.round(item.crop.x * imageWidth);
        var sy = Math.round(item.crop.y * imageHeight);
        var sw = Math.max(1, Math.round(item.crop.w * imageWidth));
        var sh = Math.max(1, Math.round(item.crop.h * imageHeight));
        var scale = Math.min(1, 3000 / Math.max(sw, sh));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(sw * scale));
        canvas.height = Math.max(1, Math.round(sh * scale));
        var ctx = canvas.getContext('2d');
        ctx.drawImage(item.image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        var transformed = item.commands.map(function(command) {
            return {
                mode: command.mode,
                size: command.size / Math.max(item.crop.w, item.crop.h),
                points: command.points.map(function(point) {
                    return { x: (point.x - item.crop.x) / item.crop.w, y: (point.y - item.crop.y) / item.crop.h };
                })
            };
        });
        drawCommands(ctx, transformed, canvas.width, canvas.height);
        return new Promise(function(resolve, reject) {
            canvas.toBlob(function(blob) {
                if (!blob || blob.size > 10 * 1024 * 1024) {
                    reject(new Error('Processed photo ' + (index + 1) + ' is too large. Crop it more tightly.'));
                } else {
                    resolve(new File([blob], 'scan-' + (index + 1) + '.jpg', { type: 'image/jpeg' }));
                }
            }, 'image/jpeg', .84);
        });
    }

    function upload() {
        if (!state.files.length || state.busy) return;
        setBusy(true);
        say('Preparing your photos…');
        var prepared = state.preparedFiles ? Promise.resolve(state.preparedFiles) : Promise.all(state.files.map(exportProcessed));
        prepared.then(function(files) {
            state.preparedFiles = files;
            state.uploadOperation = state.uploadOperation || makeOperation('scan');
            return callScan({
                action: 'startUpload',
                operation_id: state.uploadOperation,
                pages: files.map(function(file) { return { mime_type: file.type, size_bytes: file.size, file_name: file.name }; })
            }).then(function(result) {
                state.scan = { scan_id: result.scan_id, operation_id: state.uploadOperation };
                say('Uploading…');
                return Promise.all((result.uploads || []).map(function(metadata) {
                    return window.MrCatCloud.uploadWithMetadata(metadata, files[Number(metadata.page_index)]);
                }));
            }).then(function() {
                return callScan({ action: 'finishUpload', scan_id: state.scan.scan_id });
            });
        }).then(function(result) {
            setBusy(false);
            setPhase('review');
            if (result.scan) hydrateScan(result.scan);
            renderScanProgress(result.scan);
            say('');
            poll();
        }).catch(function(error) {
            setBusy(false);
            say(error.message || 'The scan could not start. Your edited photos are still here; try again.');
            setPhase('edit');
        });
    }

    function isReviewReady(scan) {
        var pages = (scan.pages || []).filter(function(page) { return page.status !== 'deleted'; });
        return pages.length > 0 && pages.every(function(page) { return page.status === 'succeeded' || page.status === 'failed'; });
    }

    function renderScanProgress(scan) {
        var pages = ((scan && scan.pages) || []).filter(function(page) { return page.status !== 'deleted'; });
        var complete = pages.filter(function(page) { return page.status === 'succeeded' || page.status === 'failed'; }).length;
        var total = Math.max(1, pages.length);
        var percentage = Math.round((complete / total) * 100);
        progressHost.hidden = false;
        reviewHeading.hidden = true;
        readyHint.hidden = true;
        drawer.hidden = true;
        reviewHost.textContent = '';
        progressStep.textContent = 'SCANNING · ' + complete + '/' + total + (total === 1 ? ' PAGE CHECKED' : ' PAGES CHECKED');
        progressTrack.setAttribute('aria-valuemax', String(total));
        progressTrack.setAttribute('aria-valuenow', String(complete));
        progressBar.style.width = percentage + '%';
        var remaining = total - complete;
        progressCount.textContent = remaining > 0 ? 'Scanning ' + remaining + ' remaining page' + (remaining === 1 ? '' : 's') + '…' : 'Finishing your scan…';
    }

    function showReviewReady(scan) {
        var succeeded = ((scan && scan.pages) || []).filter(function(page) { return page.status === 'succeeded'; }).length;
        progressHost.hidden = true;
        reviewHeading.hidden = false;
        readyHint.hidden = succeeded < 1;
        drawer.hidden = false;
    }

    function poll() {
        stopPolling();
        function run() {
            callScan({ action: 'getCurrentScan' }).then(function(result) {
                if (!result.scan) {
                    say('This scan is no longer available.');
                    return;
                }
                hydrateScan(result.scan);
                if (isReviewReady(result.scan)) {
                    renderReview(result.scan);
                    setPhase('review');
                    var failed = (result.scan.pages || []).filter(function(page) { return page.status === 'failed'; }).length;
                    say(failed ? failed + ' page' + (failed === 1 ? '' : 's') + ' need attention.' : '');
                    return;
                }
                renderScanProgress(result.scan);
                say('');
                state.pollTimer = window.setTimeout(run, 3500);
            }).catch(function() {
                say('Network unavailable. Your scan is saved; reconnecting…');
                state.pollTimer = window.setTimeout(run, 5000);
            });
        }
        run();
    }

    function specKey(spec) {
        return spec.page_id + ':' + spec.sentence_id + ':' + (spec.token_ids || []).slice().sort().join(',');
    }

    function hydrateScan(scan) {
        state.scan = scan;
        state.candidates = scan.candidates || [];
        state.candidateRevision = Number(scan.candidate_revision || 0);
        state.nextRevision = Math.max(state.nextRevision, state.candidateRevision);
        state.selected.clear();
        state.candidates.forEach(function(candidate) {
            var spec = { page_id: candidate.page_id, sentence_id: candidate.sentence_id, token_ids: (candidate.token_ids || []).slice() };
            state.selected.set(specKey(spec), spec);
        });
        renderDrawer();
    }

    function localCandidate(spec) {
        var registry = state.tokenRegistry.get(spec.page_id + ':' + spec.sentence_id);
        if (!registry) return { text: 'Selected item', context: '', status: 'pending' };
        var tokens = spec.token_ids.map(function(id) { return registry.tokens.find(function(token) { return token.token_id === id; }); }).filter(Boolean).sort(function(a, b) { return a.index - b.index; });
        return { text: tokens.map(function(token) { return token.text; }).join(' '), context: registry.text, status: 'pending' };
    }

    function candidateForSpec(spec) {
        var key = specKey(spec);
        return state.candidates.find(function(candidate) { return specKey(candidate) === key; }) || localCandidate(spec);
    }

    function selectedTokenKeys() {
        var result = new Set();
        state.selected.forEach(function(spec) {
            spec.token_ids.forEach(function(tokenId) { result.add(spec.page_id + ':' + spec.sentence_id + ':' + tokenId); });
        });
        return result;
    }

    function updateTokenStyles() {
        var selected = selectedTokenKeys();
        overlay.querySelectorAll('.my-words-scan-token').forEach(function(button) {
            var tokenKey = button.dataset.pageId + ':' + button.dataset.sentenceId + ':' + button.dataset.tokenId;
            var inPhrase = state.phrase && state.phrase.pageId === button.dataset.pageId && state.phrase.sentenceId === button.dataset.sentenceId && state.phrase.tokens.indexOf(button.dataset.tokenId) >= 0;
            button.classList.toggle('is-selected', selected.has(tokenKey));
            button.classList.toggle('is-phrase', Boolean(inPhrase && state.phrase.tokens.length > 1));
            button.classList.toggle('is-phrase-anchor', Boolean(inPhrase && state.phrase.tokens.length === 1));
            button.classList.toggle('is-marked', button.dataset.marked === 'true' && !selected.has(tokenKey) && !inPhrase && button.dataset.markDismissed !== 'true');
        });
    }

    function selectionChanged() {
        state.commitOperation = null;
        state.syncDirty = true;
        renderDrawer();
        updateTokenStyles();
        if (state.syncTimer) window.clearTimeout(state.syncTimer);
        state.syncTimer = window.setTimeout(function() { flushCandidateSync().catch(function() {}); }, 180);
    }

    function flushCandidateSync() {
        if (state.syncTimer) window.clearTimeout(state.syncTimer);
        state.syncTimer = null;
        if (!state.syncDirty || !state.scan || !state.scan.scan_id) return state.syncPromise || Promise.resolve();
        if (state.syncPromise) {
            return state.syncPromise.then(function() { return flushCandidateSync(); });
        }
        state.syncDirty = false;
        state.nextRevision = Math.max(state.nextRevision, state.candidateRevision) + 1;
        var revision = state.nextRevision;
        var specs = Array.from(state.selected.values()).map(function(spec) {
            return { page_id: spec.page_id, sentence_id: spec.sentence_id, token_ids: spec.token_ids.slice() };
        });
        state.syncPromise = callScan({ action: 'saveCandidates', scan_id: state.scan.scan_id, candidate_revision: revision, candidates: specs }).then(function(result) {
            if (Number(result.candidate_revision || 0) >= state.candidateRevision) {
                state.candidateRevision = Number(result.candidate_revision || revision);
                state.nextRevision = Math.max(state.nextRevision, state.candidateRevision);
                if (result.stale_revision) state.syncDirty = true;
                else state.candidates = result.candidates || [];
                renderDrawer();
                updateTokenStyles();
            }
        }).catch(function(error) {
            state.syncDirty = true;
            say(error.message || 'Your selection could not be saved yet.');
            throw error;
        }).finally(function() {
            state.syncPromise = null;
        });
        return state.syncPromise.then(function() {
            return state.syncDirty ? flushCandidateSync() : undefined;
        });
    }

    function tokenClick(event) {
        var button = event.currentTarget;
        button.dataset.markDismissed = 'true';
        if (button.__suppressClick) {
            button.__suppressClick = false;
            updateTokenStyles();
            return;
        }
        if (state.phrase) {
            if (state.phrase.pageId !== button.dataset.pageId || state.phrase.sentenceId !== button.dataset.sentenceId) {
                say('Finish or cancel this phrase before choosing another sentence.');
                return;
            }
            var phraseIndex = state.phrase.tokens.indexOf(button.dataset.tokenId);
            if (phraseIndex >= 0) state.phrase.tokens.splice(phraseIndex, 1);
            else if (state.phrase.tokens.length < 16) state.phrase.tokens.push(button.dataset.tokenId);
            else say('A phrase can contain up to sixteen selected words.');
            updateTokenStyles();
            return;
        }
        var spec = { page_id: button.dataset.pageId, sentence_id: button.dataset.sentenceId, token_ids: [button.dataset.tokenId] };
        var key = specKey(spec);
        if (state.selected.has(key)) state.selected.delete(key);
        else {
            if (state.selected.size >= 100) { say('Add the current 100 items before selecting more.'); return; }
            state.selected.set(key, spec);
        }
        selectionChanged();
    }

    function cancelLongPress(button) {
        if (button.__pressTimer) window.clearTimeout(button.__pressTimer);
        button.__pressTimer = null;
        button.__pressStart = null;
    }

    function longPressStart(event) {
        var button = event.currentTarget;
        button.__pressStart = { x: event.clientX, y: event.clientY };
        button.__pressTimer = window.setTimeout(function() {
            button.__pressTimer = null;
            button.__suppressClick = true;
            state.phrase = { pageId: button.dataset.pageId, sentenceId: button.dataset.sentenceId, tokens: [button.dataset.tokenId] };
            phraseActions.hidden = false;
            updateTokenStyles();
            say('Phrase mode: tap any other words in this sentence, then confirm.');
        }, 520);
    }

    function longPressMove(event) {
        var button = event.currentTarget;
        if (!button.__pressStart) return;
        if (Math.hypot(event.clientX - button.__pressStart.x, event.clientY - button.__pressStart.y) > 10) cancelLongPress(button);
    }

    function finishPhrase() {
        if (!state.phrase || state.phrase.tokens.length < 2) {
            say('A phrase needs at least two selected words.');
            return;
        }
        var spec = { page_id: state.phrase.pageId, sentence_id: state.phrase.sentenceId, token_ids: state.phrase.tokens.slice() };
        if (!state.selected.has(specKey(spec)) && state.selected.size >= 100) {
            say('Add the current 100 items before selecting more.');
            return;
        }
        state.selected.set(specKey(spec), spec);
        state.phrase = null;
        phraseActions.hidden = true;
        selectionChanged();
    }

    function cancelPhrase() {
        state.phrase = null;
        phraseActions.hidden = true;
        updateTokenStyles();
        say('Tap a word to stage it. Long-press to start a phrase.');
    }

    function addTextWithTokens(parent, sentence, page, pageIndex) {
        var cursor = 0;
        var acknowledgements = new Set(page.uncertainty_acknowledged || []);
        state.tokenRegistry.set(page.page_id + ':' + sentence.sentence_id, { text: sentence.text, tokens: sentence.tokens || [] });
        (sentence.tokens || []).forEach(function(token) {
            var start = Number(token.start || 0);
            if (start > cursor) parent.appendChild(document.createTextNode(sentence.text.slice(cursor, start)));
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'my-words-scan-token';
            button.textContent = token.text;
            button.dataset.tokenId = token.token_id;
            button.dataset.pageId = page.page_id;
            button.dataset.sentenceId = sentence.sentence_id;
            button.setAttribute('aria-label', token.text + ', page ' + (pageIndex + 1));
            var marked = (sentence.marked_tokens || []).some(function(item) { return item.token_id === token.token_id; });
            var uncertain = (sentence.uncertain_tokens || []).some(function(item) { return item.token_id === token.token_id; });
            button.dataset.marked = marked ? 'true' : 'false';
            if (marked) button.classList.add('is-marked');
            if (uncertain && !acknowledgements.has(sentence.sentence_id + ':' + token.token_id)) button.classList.add('is-uncertain');
            button.addEventListener('click', tokenClick);
            button.addEventListener('pointerdown', longPressStart);
            button.addEventListener('pointermove', longPressMove);
            button.addEventListener('pointerup', function() { cancelLongPress(button); });
            button.addEventListener('pointercancel', function() { cancelLongPress(button); });
            parent.appendChild(button);
            cursor = Number(token.end || start + token.text.length);
        });
        if (cursor < sentence.text.length) parent.appendChild(document.createTextNode(sentence.text.slice(cursor)));
    }

    function acknowledgeUncertainty(scan, page, sentence, item, warning) {
        warning.disabled = true;
        callScan({ action: 'acknowledgeUncertainty', scan_id: scan.scan_id, page_id: page.page_id, sentence_id: sentence.sentence_id, token_id: item.token_id }).then(function() {
            warning.remove();
            var token = reviewHost.querySelector('[data-page-id="' + page.page_id + '"][data-sentence-id="' + sentence.sentence_id + '"][data-token-id="' + item.token_id + '"]');
            if (token) token.classList.remove('is-uncertain');
        }).catch(function(error) {
            warning.disabled = false;
            say(error.message);
        });
    }

    function viewPage(page) {
        callScan({ action: 'getPagePreview', scan_id: state.scan.scan_id, page_id: page.page_id }).then(function(result) {
            previewImage.src = result.preview_url;
            preview.hidden = false;
            overlay.querySelector('[data-scan-preview-close]').focus();
        }).catch(function(error) { say(error.message); });
    }

    function retryPage(page) {
        say('Retrying page ' + (Number(page.page_index) + 1) + '…');
        callScan({ action: 'retryPage', scan_id: state.scan.scan_id, page_id: page.page_id }).then(function(result) {
            if (result.scan) hydrateScan(result.scan);
            poll();
        }).catch(function(error) { say(error.message); });
    }

    function removeReviewPage(page) {
        if (!window.confirm('Remove this page from the scan?')) return;
        callScan({ action: 'removePage', scan_id: state.scan.scan_id, page_id: page.page_id }).then(function(result) {
            if (result.scan) {
                hydrateScan(result.scan);
                renderReview(result.scan);
            }
            say('Page removed.');
        }).catch(function(error) { say(error.message); });
    }

    function renderReview(scan) {
        showReviewReady(scan);
        reviewHost.textContent = '';
        state.tokenRegistry.clear();
        (scan.pages || []).filter(function(page) { return page.status !== 'deleted'; }).forEach(function(page) {
            var section = document.createElement('section');
            section.className = 'my-words-scan-review-page';
            var header = document.createElement('header');
            var heading = document.createElement('h3');
            heading.textContent = 'Page ' + (Number(page.page_index) + 1);
            var actions = document.createElement('div');
            var view = document.createElement('button');
            view.type = 'button';
            view.className = 'outline-button';
            view.textContent = 'View photo';
            view.addEventListener('click', function() { viewPage(page); });
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'outline-button';
            remove.textContent = 'Remove page';
            remove.addEventListener('click', function() { removeReviewPage(page); });
            actions.appendChild(view);
            actions.appendChild(remove);
            header.appendChild(heading);
            header.appendChild(actions);
            section.appendChild(header);
            if (page.status === 'failed') {
                var failure = document.createElement('p');
                failure.textContent = 'This page could not be read. Retry it or remove it.';
                var retry = document.createElement('button');
                retry.type = 'button';
                retry.className = 'primary-button';
                retry.textContent = 'Retry this page';
                retry.addEventListener('click', function() { retryPage(page); });
                section.appendChild(failure);
                section.appendChild(retry);
            } else if (!page.ocr || !page.ocr.has_english) {
                var empty = document.createElement('p');
                empty.textContent = 'No English words found.';
                section.appendChild(empty);
            } else {
                (page.ocr.blocks || []).forEach(function(block) {
                    (block.sentences || []).forEach(function(sentence) {
                        var row = document.createElement('p');
                        row.className = 'my-words-scan-sentence';
                        addTextWithTokens(row, sentence, page, Number(page.page_index));
                        section.appendChild(row);
                        var acknowledged = new Set(page.uncertainty_acknowledged || []);
                        (sentence.uncertain_tokens || []).forEach(function(item) {
                            if (acknowledged.has(sentence.sentence_id + ':' + item.token_id)) return;
                            var warning = document.createElement('button');
                            warning.type = 'button';
                            warning.className = 'my-words-scan-uncertainty';
                            warning.textContent = '? ' + item.token_text + ' — tap if this OCR is acceptable';
                            warning.addEventListener('click', function() { acknowledgeUncertainty(scan, page, sentence, item, warning); });
                            section.appendChild(warning);
                        });
                    });
                });
            }
            reviewHost.appendChild(section);
        });
        renderDrawer();
        updateTokenStyles();
    }

    function removeCandidate(spec) {
        state.selected.delete(specKey(spec));
        selectionChanged();
    }

    function renderDrawer() {
        var specs = Array.from(state.selected.values());
        drawer.classList.toggle('is-empty', specs.length < 1);
        countNode.textContent = specs.length;
        commitButton.textContent = 'Add ' + specs.length + ' item' + (specs.length === 1 ? '' : 's');
        commitButton.disabled = state.busy || specs.length < 1;
        drawerHost.textContent = '';
        specs.forEach(function(spec) {
            var candidate = candidateForSpec(spec);
            var row = document.createElement('div');
            row.className = 'my-words-scan-candidate';
            if (candidate.status === 'failed') row.classList.add('is-failed');
            var copy = document.createElement('div');
            var text = document.createElement('strong');
            text.textContent = candidate.text;
            var context = document.createElement('small');
            context.textContent = candidate.context;
            copy.appendChild(text);
            copy.appendChild(context);
            var remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'outline-button';
            remove.textContent = candidate.status === 'failed' ? 'Remove / reselect' : 'Remove';
            remove.addEventListener('click', function() { removeCandidate(spec); });
            row.appendChild(copy);
            row.appendChild(remove);
            drawerHost.appendChild(row);
        });
    }

    function commitCandidates() {
        if (state.busy || !state.selected.size) return;
        setBusy(true);
        say('Saving your selections…');
        flushCandidateSync().then(function() {
            state.commitOperation = state.commitOperation || makeOperation('commit');
            return callScan({ action: 'commitCandidates', scan_id: state.scan.scan_id, commit_operation_id: state.commitOperation });
        }).then(function(result) {
            state.didCommit = Boolean((result.vocab_ids || []).length) || state.didCommit;
            (result.vocab_ids || []).forEach(function(id) {
                if (window.MrCatPersonalVocab && window.MrCatPersonalVocab.enrichWord) window.MrCatPersonalVocab.enrichWord({ vocab_id: id }, false);
            });
            if (result.partial_failure) {
                state.candidates = result.candidates || [];
                state.selected.clear();
                state.candidates.forEach(function(candidate) {
                    var spec = { page_id: candidate.page_id, sentence_id: candidate.sentence_id, token_ids: candidate.token_ids.slice() };
                    state.selected.set(specKey(spec), spec);
                });
                state.commitOperation = null;
                say('Some items could not be added. Remove and reselect them, then try again.');
                renderDrawer();
                updateTokenStyles();
                setBusy(false);
                return;
            }
            say('Added to My Words. Dictionary details will load there automatically.');
            setBusy(false);
            window.setTimeout(close, 900);
        }).catch(function(error) {
            setBusy(false);
            say(error.message || 'Your words could not be added yet. Try again.');
        });
    }

    function open() {
        state.lastFocus = document.activeElement;
        state.didCommit = false;
        window.dispatchEvent(new CustomEvent('mrcat:scan-opened'));
        overlay.hidden = false;
        lockPage();
        setPhase('choose');
        renderPages();
        say(isDashboardScan ? '' : 'Checking Scan Words…');
        var initialFocus = isDashboardScan ? overlay.querySelector('[data-scan-discard]') : overlay.querySelector('[data-scan-close]');
        if (initialFocus) initialFocus.focus();
        callScan({ action: 'getCapability' }).then(function(result) {
            if (!result.enabled) throw new Error('Scan Words is not available yet.');
            return callScan({ action: 'getCurrentScan' });
        }).then(function(result) {
            if (!result.scan) {
                say(isDashboardScan ? '' : 'Choose up to five photos.');
                return;
            }
            hydrateScan(result.scan);
            if (result.scan.status === 'uploading') {
                say('A previous upload was interrupted. Discard it, then choose those photos again.');
                return;
            }
            if (isReviewReady(result.scan)) {
                renderReview(result.scan);
                setPhase('review');
                say('');
            } else {
                setPhase('review');
                renderScanProgress(result.scan);
                poll();
            }
        }).catch(function(error) {
            say(error.message || 'Unable to open Scan Words.');
        });
    }

    function discard() {
        if (state.busy || !window.confirm('Discard this scan and delete its temporary photos?')) return;
        setBusy(true);
        var promise = state.scan && state.scan.scan_id ? callScan({ action: 'discardScan', scan_id: state.scan.scan_id }) : Promise.resolve();
        promise.then(function() {
            setBusy(false);
            close();
        }).catch(function(error) {
            setBusy(false);
            say(error.message);
        });
    }

    function undo() {
        var item = state.files[state.activeEditor];
        if (!item || !item.undo.length) return;
        item.redo.push(cloneEditState(item));
        restoreEditState(item, item.undo.pop());
        renderEditor();
    }

    function redo() {
        var item = state.files[state.activeEditor];
        if (!item || !item.redo.length) return;
        item.undo.push(cloneEditState(item));
        restoreEditState(item, item.redo.pop());
        renderEditor();
    }

    function focusTrap(event) {
        if (overlay.hidden || event.key !== 'Tab') return;
        var scope = !preview.hidden ? preview : (!photoChoice.hidden ? photoChoice : shell);
        var focusable = Array.prototype.slice.call(scope.querySelectorAll('button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')).filter(function(item) { return !item.hidden && item.offsetParent !== null; });
        if (!focusable.length) return;
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }

    overlay.addEventListener('click', function(event) {
        var target = event.target;
        if (target.closest('[data-scan-photo-source]')) {
            var source = target.closest('[data-scan-photo-source]').dataset.scanPhotoSource;
            state.pendingPhotoReplaceIndex = state.photoChoiceReplaceIndex;
            closePhotoChoice(false);
            var input = overlay.querySelector(source === 'camera' ? '[data-scan-camera]' : '[data-scan-library]');
            if (input) input.click();
        }
        else if (target.closest('[data-scan-photo-choice-close]')) closePhotoChoice();
        else if (target.closest('[data-scan-add-photo]')) openPhotoChoice(target.closest('[data-scan-add-photo]'));
        else if (target.closest('[data-scan-close]')) close();
        else if (target.closest('[data-scan-discard]')) discard();
        else if (target.closest('[data-scan-next]')) { state.activeEditor = 0; setPhase('edit'); renderEditor(); }
        else if (target.closest('[data-scan-run]')) upload();
        else if (target.closest('[data-scan-undo]')) undo();
        else if (target.closest('[data-scan-redo]')) redo();
        else if (target.closest('[data-scan-page-prev]')) { state.activeEditor -= 1; renderEditor(); }
        else if (target.closest('[data-scan-page-next]')) { state.activeEditor += 1; renderEditor(); }
        else if (target.closest('[data-scan-mode]')) { state.editorMode = target.closest('[data-scan-mode]').dataset.scanMode; renderEditor(); }
        else if (target.closest('[data-scan-finish-phrase]')) finishPhrase();
        else if (target.closest('[data-scan-cancel-phrase]')) cancelPhrase();
        else if (target.closest('[data-scan-drawer-toggle]')) {
            drawerHost.hidden = !drawerHost.hidden;
            drawer.classList.toggle('is-collapsed', drawerHost.hidden);
            drawerToggle.setAttribute('aria-expanded', drawerHost.hidden ? 'false' : 'true');
        }
        else if (target.closest('[data-scan-commit]')) commitCandidates();
        else if (target.closest('[data-scan-preview-close]')) closePreview();
    });

    openButton.addEventListener('click', function() {
        window.dispatchEvent(new CustomEvent('mrcat:close-add-panel'));
        open();
    });
    if (manualButton) manualButton.addEventListener('click', function() {
        var form = document.getElementById('my-words-add-form');
        var choices = document.querySelector('.my-words-add-choices');
        if (form) {
            if (choices) choices.hidden = true;
            form.hidden = false;
            var input = document.getElementById('my-words-add-input');
            if (input) input.focus();
        }
    });
    overlay.querySelector('[data-scan-camera]').addEventListener('change', function(event) {
        var replaceIndex = state.pendingPhotoReplaceIndex;
        state.pendingPhotoReplaceIndex = null;
        addFiles(event.target.files, replaceIndex);
        event.target.value = '';
    });
    overlay.querySelector('[data-scan-library]').addEventListener('change', function(event) {
        var replaceIndex = state.pendingPhotoReplaceIndex;
        state.pendingPhotoReplaceIndex = null;
        addFiles(event.target.files, replaceIndex);
        event.target.value = '';
    });
    var drop = overlay.querySelector('[data-scan-drop]');
    drop.addEventListener('dragover', function(event) { event.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', function() { drop.classList.remove('is-over'); });
    drop.addEventListener('drop', function(event) { event.preventDefault(); drop.classList.remove('is-over'); addFiles(event.dataTransfer.files); });
    document.addEventListener('keydown', function(event) {
        focusTrap(event);
        if (overlay.hidden || event.key !== 'Escape') return;
        if (!preview.hidden) closePreview();
        else if (state.photoChoiceOpen) closePhotoChoice();
        else if (state.phrase) cancelPhrase();
        else close();
    });
})(window, document);
