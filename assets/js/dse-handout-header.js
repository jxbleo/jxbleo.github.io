(function () {
    "use strict";

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
