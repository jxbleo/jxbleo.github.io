(function(window) {
    'use strict';

    var legacyQueryKeys = {
        user: true,
        visitor: true
    };

    function locationHref() {
        var location = window.location || {};
        if (location.href) return String(location.href);

        var origin = location.origin || '';
        var pathname = location.pathname || '/index.html';
        return origin + pathname + (location.search || '') + (location.hash || '');
    }

    function sameOrigin(url) {
        var location = window.location || {};
        var origin = location.origin;
        if (!origin) {
            try {
                origin = new URL(locationHref()).origin;
            } catch (error) {
                return false;
            }
        }
        return url.origin === origin;
    }

    function normalizedQuery(url) {
        var query = new URLSearchParams();
        url.searchParams.forEach(function(value, key) {
            if (legacyQueryKeys[String(key).toLowerCase()]) return;
            query.append(key, value);
        });
        return query.toString();
    }

    function normalize(value) {
        if (typeof value !== 'string' || !value.trim()) return '';

        var target;
        try {
            target = new URL(value.trim(), locationHref());
        } catch (error) {
            return '';
        }

        if (!sameOrigin(target) || target.username || target.password) return '';

        var decodedPathname;
        try {
            decodedPathname = decodeURIComponent(target.pathname);
        } catch (error) {
            return '';
        }

        if (!/^\/[^/\\]+\.html$/i.test(decodedPathname)) return '';
        if (decodedPathname.toLowerCase() === '/index.html') return '';

        var pathname = target.pathname.slice(1);
        var query = normalizedQuery(target);
        return pathname + (query ? '?' + query : '') + (target.hash || '');
    }

    function safeTarget(value, fallback) {
        return normalize(value) || normalize(fallback);
    }

    function currentTarget(fallback) {
        return safeTarget(locationHref(), fallback);
    }

    function requestedTarget(fallback) {
        var location = window.location || {};
        var params = new URLSearchParams(location.search || '');
        return safeTarget(params.get('return'), currentTarget(fallback));
    }

    function loginHref(target, fallback) {
        var destination = safeTarget(target, fallback);
        return destination
            ? 'index.html?return=' + encodeURIComponent(destination)
            : 'index.html';
    }

    window.MrCatLoginNavigation = {
        safeTarget: safeTarget,
        currentTarget: currentTarget,
        requestedTarget: requestedTarget,
        loginHref: loginHref
    };
})(window);
