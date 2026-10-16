(function () {
    "use strict";

    // App hand-off is attempted only after a mobile visitor clicks an icon.
    // HTTPS links remain usable without JavaScript and for modified/desktop clicks.
    var appLinks = document.querySelectorAll("[data-handout-app]");
    var appHint;
    var appTrigger;
    var keyword = encodeURIComponent("猫先生英语");
    var appTargets = {
        xiaohongshu: "xhsdiscover://search/result?keyword=" + keyword,
        douyin: "snssdk1128://search?keyword=" + keyword
    };
    var ua = navigator.userAgent || "";
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
            var target = appTargets[link.getAttribute("data-handout-app")];
            if (!target) return;
            event.preventDefault();
            closeAppHint();
            if (!appHint) {
                appHint = document.createElement("div");
                appHint.className = "handout-contact-tip handout-app-tip";
                appHint.id = "handout-app-help";
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
            appHint.querySelector("p").textContent = /MicroMessenger/i.test(ua)
                ? "若未打开 App，请从右上角菜单选择在浏览器中打开，或继续使用网页版。"
                : "若未打开 App，可继续使用网页版搜索「猫先生英语」。";
            var webLink = appHint.querySelector("a");
            webLink.href = link.href;
            webLink.textContent = link.getAttribute("data-handout-app") === "xiaohongshu"
                ? "打开小红书网页版 ↗" : "打开抖音网页版 ↗";
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

    var button = document.querySelector("[data-handout-wechat]");
    if (!button) return;
    var container = button.closest(".handout-wechat-help");
    var status = container.querySelector("[data-handout-wechat-status]");
    var message = container.querySelector("[data-handout-wechat-message]");
    var timer;
    var request = 0;

    function hideStatus() {
        request += 1;
        window.clearTimeout(timer);
        status.hidden = true;
    }

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

    button.addEventListener("click", async function () {
        var current = ++request;
        var value = button.getAttribute("data-handout-wechat");
        var copied = false;
        window.clearTimeout(timer);
        status.hidden = true;
        if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
            try {
                await navigator.clipboard.writeText(value);
                copied = true;
            } catch (error) {
                copied = false;
            }
        }
        if (current !== request) return;
        if (!copied) copied = legacyCopy(value);
        message.textContent = copied ? "微信号已复制" : "请长按或选中微信号复制：";
        status.hidden = false;
        if (copied) timer = window.setTimeout(hideStatus, 3500);
    });

    document.addEventListener("click", function (event) {
        if (!container.contains(event.target)) hideStatus();
    });
    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") hideStatus();
    });
}());
