(function () {
    "use strict";

    var nextId = 0;
    function bind(header) {
        if (header.hasAttribute("data-share-header-bound")) return;
        header.setAttribute("data-share-header-bound", "");

        // App hand-off is attempted only after a mobile visitor clicks an icon.
        // HTTPS links remain usable without JavaScript and for modified/desktop clicks.
        var appLinks = header.querySelectorAll("[data-handout-app]");
        var appHint;
        var appTrigger;
        var ua = navigator.userAgent || "";
        var isWeChat = /MicroMessenger/i.test(ua);
        var isMobile = /Android|iPhone|iPad|iPod|HarmonyOS/i.test(ua) ||
            (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);

        function closeAppHint() {
            if (appHint) appHint.hidden = true;
            if (appTrigger) appTrigger.removeAttribute("aria-describedby");
            appTrigger = null;
        }

        appLinks.forEach(function (link) {
            link.addEventListener("click", function (event) {
                if (!isMobile || event.defaultPrevented || event.button !== 0 ||
                    event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                var platform = link.getAttribute("data-handout-app");
                // In WeChat, let the owner's official Xiaohongshu share page handle
                // platform permissions and app opening instead of forcing a scheme.
                if (isWeChat && platform === "xiaohongshu") return;
                var target = link.getAttribute("data-handout-app-url");
                if (platform !== "xiaohongshu" || !/^xhsdiscover:\/\/user\/[a-f0-9]+$/.test(target || "")) return;
                event.preventDefault();
                closeAppHint();
                if (!appHint) {
                    appHint = document.createElement("div");
                    appHint.className = "handout-contact-tip handout-app-tip";
                    appHint.id = "share-header-app-help-" + (++nextId);
                    appHint.setAttribute("role", "status");
                    appHint.setAttribute("aria-live", "polite");
                    appHint.appendChild(document.createElement("p"));
                    var fallback = document.createElement("a");
                    fallback.target = "_blank";
                    fallback.rel = "noopener noreferrer";
                    fallback.referrerPolicy = "no-referrer";
                    appHint.appendChild(fallback);
                    link.closest(".handout-socials").appendChild(appHint);
                }
                appHint.querySelector("p").textContent = "若未打开 App，可继续查看猫先生英语的小红书主页。";
                var webLink = appHint.querySelector("a");
                webLink.href = link.href;
                webLink.textContent = "查看小红书主页 ↗";
                appTrigger = link;
                link.setAttribute("aria-describedby", appHint.id);
                appHint.hidden = false;
                // No timer redirects: a delayed OS confirmation must not navigate away
                // from the lesson, and returning from an app must not reopen the web page.
                try { window.location.assign(target); } catch (error) { /* Keep the web fallback visible. */ }
            });
        });
        document.addEventListener("click", function (event) {
            if (appHint && !appHint.contains(event.target) && !(appTrigger && appTrigger.contains(event.target))) closeAppHint();
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") closeAppHint();
        });
        window.addEventListener("pagehide", closeAppHint);
        document.addEventListener("visibilitychange", function () {
            if (document.hidden) closeAppHint();
        });

        function legacyCopy(value) {
            var previous = document.activeElement;
            var input = document.createElement("textarea");
            input.value = value;
            input.setAttribute("readonly", "");
            input.style.cssText = "position:fixed;top:0;left:0;opacity:0;font-size:16px";
            document.body.appendChild(input);
            var copied = false;
            try {
                input.focus({ preventScroll: true });
                input.select();
                input.setSelectionRange(0, value.length);
                copied = document.execCommand("copy");
            } catch (error) {
                copied = false;
            } finally {
                input.remove();
                if (previous && previous.focus) previous.focus({ preventScroll: true });
            }
            return copied;
        }

        function bindCopy(trigger, attribute, value, render, duration) {
            if (!trigger) return;
            // Copy feedback belongs to this header only.
            var container = trigger.closest(".handout-copy-help") || trigger.closest(".handout-wechat-help");
            var status = container.querySelector("[data-handout-" + attribute + "-status]");
            var request = 0;
            var timer;
            function hideStatus() {
                request += 1;
                window.clearTimeout(timer);
                status.hidden = true;
                if (trigger.hasAttribute("aria-expanded")) trigger.setAttribute("aria-expanded", "false");
            }
            trigger.addEventListener("click", async function (event) {
                // Handle only unmodified primary clicks.
                if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                event.preventDefault();
                closeAppHint();
                hideStatus();
                var current = request;
                var copied = false;
                if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
                    try {
                        await navigator.clipboard.writeText(value);
                        copied = true;
                    } catch (error) { /* Fall back to user-initiated legacy copying. */ }
                }
                if (current !== request) return;
                if (!copied) copied = legacyCopy(value);
                render(container, copied);
                status.hidden = false;
                if (trigger.hasAttribute("aria-expanded")) trigger.setAttribute("aria-expanded", "true");
                if (copied && duration) timer = window.setTimeout(hideStatus, duration);
            });
            document.addEventListener("click", function (event) {
                if (!container.contains(event.target)) hideStatus();
            });
            document.addEventListener("keydown", function (event) {
                if (event.key === "Escape") hideStatus();
            });
            window.addEventListener("pagehide", hideStatus);
            document.addEventListener("visibilitychange", function () {
                if (document.hidden) hideStatus();
            });
        }

        var wechat = header.querySelector("[data-handout-wechat]");
        bindCopy(wechat, "wechat", wechat && wechat.getAttribute("data-handout-wechat"), function (container, copied) {
            container.querySelector("[data-handout-wechat-message]").textContent = copied
                ? "微信号已复制" : "请长按或选中微信号复制：";
        }, 6000);
    }
    function init() {
        document.querySelectorAll("[data-share-header]").forEach(bind);
    }
    window.MrCatShareHeader = { init: init };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
    else init();
}());
