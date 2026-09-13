(function (window) {
    'use strict';

    // One controller per capture lifecycle. Unsupported/denied locks never block audio.
    function create() {
        var active = false, destroyed = false, epoch = 0, pending = null, sentinel = null;
        function visible() { return document.visibilityState === 'visible'; }
        function release(lock) {
            if (!lock) return;
            try { Promise.resolve(lock.release()).catch(function () {}); } catch (_error) {}
        }
        function clear() {
            epoch += 1;
            var old = sentinel; sentinel = null;
            release(old);
        }
        function acquire() {
            if (!active || destroyed || !visible() || pending || sentinel || !navigator.wakeLock || !navigator.wakeLock.request) return;
            var requestEpoch = epoch;
            var request = {};
            pending = request;
            Promise.resolve().then(function () {
                if (!active || destroyed || !visible() || requestEpoch !== epoch) return null;
                return navigator.wakeLock.request('screen');
            }).then(function (lock) {
                if (!lock) return;
                if (!active || destroyed || !visible() || requestEpoch !== epoch) { release(lock); return; }
                sentinel = lock;
                lock.addEventListener('release', function () {
                    if (sentinel === lock) sentinel = null;
                    // Let the system revoke a lock; retry on returning to the page.
                });
            }).catch(function () {
                // Low power, browser policy and unsupported contexts must not fail capture.
            }).finally(function () {
                if (pending === request) pending = null;
                if (requestEpoch !== epoch) acquire();
            });
        }
        function visibilityChanged() {
            if (visible()) acquire();
            else clear();
        }
        function setActive(next) {
            next = Boolean(next) && !destroyed;
            if (next === active) return;
            active = next;
            if (active) {
                document.addEventListener('visibilitychange', visibilityChanged);
                acquire();
            } else {
                document.removeEventListener('visibilitychange', visibilityChanged);
                clear();
            }
        }
        return {
            setActive: setActive,
            destroy: function () { setActive(false); destroyed = true; }
        };
    }
    window.MrCatScreenWakeLock = { create: create };
})(window);
