(function () {
    "use strict";

    var toastTimer = null;

    function showToast(message) {
        var toast = document.querySelector("[data-resource-toast]");
        if (!toast) return;
        toast.textContent = message;
        toast.classList.add("is-visible");
        window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(function () {
            toast.classList.remove("is-visible");
        }, 2200);
    }

    function copyText(value) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(value);
        }

        return new Promise(function (resolve, reject) {
            var input = document.createElement("textarea");
            input.value = value;
            input.setAttribute("readonly", "");
            input.style.position = "fixed";
            input.style.opacity = "0";
            document.body.appendChild(input);
            input.select();
            try {
                document.execCommand("copy") ? resolve() : reject(new Error("Copy failed"));
            } catch (error) {
                reject(error);
            }
            input.remove();
        });
    }

    function canonicalUrl() {
        var canonical = document.querySelector('link[rel="canonical"]');
        return canonical ? canonical.href : window.location.href.split("#")[0];
    }

    async function shareResource(button) {
        var data = {
            title: document.title,
            text: button.getAttribute("data-share-text") || "Mr. Cat Academy 免费英语学习资料",
            url: canonicalUrl()
        };

        if (navigator.share) {
            try {
                await navigator.share(data);
                return;
            } catch (error) {
                if (error && error.name === "AbortError") return;
            }
        }

        try {
            await copyText(data.url);
            showToast("链接已复制，可以分享了");
        } catch (error) {
            showToast("请复制浏览器地址分享");
        }
    }

    function updateTopbar() {
        var topbar = document.querySelector("[data-resource-topbar]");
        if (topbar) topbar.classList.toggle("is-scrolled", window.scrollY > 12);
    }

    function installChecklistControls() {
        document.querySelectorAll(".check-icon").forEach(function (control) {
            control.setAttribute("role", "checkbox");
            control.setAttribute("tabindex", "0");
            control.setAttribute("aria-checked", control.classList.contains("checked") ? "true" : "false");
            if (!control.hasAttribute("onclick")) {
                control.addEventListener("click", function () {
                    toggleChecklist(control);
                });
            }
            control.addEventListener("keydown", function (event) {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                control.click();
            });
        });
    }

    function toggleChecklist(control) {
        var isChecked = control.classList.toggle("checked");
        control.textContent = isChecked ? "✓" : "";
        control.setAttribute("aria-checked", isChecked ? "true" : "false");
    }

    function installPromptCopies() {
        document.querySelectorAll("[data-ai-prompt]").forEach(function (button) {
            button.addEventListener("click", async function () {
                var original = button.textContent;
                try {
                    await copyText(button.getAttribute("data-ai-prompt"));
                    button.textContent = "提示已复制 ✓";
                    button.classList.add("is-complete");
                    showToast("已复制，可粘贴到你常用的 AI 助手");
                    window.setTimeout(function () {
                        button.textContent = original;
                        button.classList.remove("is-complete");
                    }, 2200);
                } catch (error) {
                    showToast("复制失败，请长按题目复制");
                }
            });
        });

        document.querySelectorAll('.try-btn[onclick^="sendPrompt"]').forEach(function (button) {
            button.textContent = "复制 AI 辅导提示";
            button.title = "复制后可粘贴到你常用的 AI 助手";
        });
    }

    window.sendPrompt = async function (prompt) {
        var button = document.activeElement && document.activeElement.classList.contains("try-btn")
            ? document.activeElement
            : null;
        try {
            await copyText(prompt);
            showToast("已复制，可粘贴到你常用的 AI 助手");
            if (button) {
                var original = button.textContent;
                button.textContent = "提示已复制 ✓";
                button.classList.add("is-complete");
                window.setTimeout(function () {
                    button.textContent = original;
                    button.classList.remove("is-complete");
                }, 2200);
            }
        } catch (error) {
            showToast("复制失败，请长按题目复制");
        }
    };

    document.addEventListener("DOMContentLoaded", function () {
        var shareButton = document.querySelector("[data-resource-share]");
        if (shareButton) {
            shareButton.addEventListener("click", function () {
                shareResource(shareButton);
            });
        }

        installChecklistControls();
        installPromptCopies();
        updateTopbar();
        window.addEventListener("scroll", updateTopbar, { passive: true });
    });
})();
