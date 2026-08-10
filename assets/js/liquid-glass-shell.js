(function () {
    "use strict";

    var modalRootSelector = [
        ".student-account-overlay",
        ".student-star-overlay",
        ".password-dialog-overlay",
        ".logout-confirm-overlay",
        ".student-words-overlay",
        ".student-message-overlay",
        ".student-calendar-overlay",
        ".teacher-replies-overlay",
        ".practice-entry-overlay",
        ".my-word-merge-modal",
        ".teacher-utility-modal",
        ".create-student-modal",
        ".create-student-success-modal",
        ".assign-picker-modal",
        ".assignment-edit-overlay",
        ".percentage-picker-overlay",
        ".assignment-cancel-confirm-overlay",
        ".progress-matrix-modal-backdrop",
        ".account-panel"
    ].join(",");

    var modalSurfaceSelector = [
        ".practice-entry-card",
        ".student-account-dialog",
        ".student-star-dialog",
        ".student-words-dialog",
        ".student-calendar-dialog",
        ".student-message-dialog",
        ".teacher-replies-dialog",
        ".password-dialog",
        ".logout-confirm-dialog",
        ".my-word-merge-card",
        ".teacher-utility-dialog",
        ".create-student-dialog",
        ".create-student-success-card",
        ".assign-picker-dialog",
        ".assignment-edit-dialog",
        ".percentage-picker-dialog",
        ".assignment-cancel-confirm-dialog",
        ".progress-matrix-modal",
        ".account-panel"
    ].join(",");

    var replayingCloseButtons = new WeakSet();
    var closingModalRoots = new WeakSet();
    var activeModalAnimations = new WeakMap();

    function cancelModalAnimations(root) {
        var animations = activeModalAnimations.get(root) || [];
        animations.forEach(function (animation) {
            try {
                animation.cancel();
            } catch (error) {}
        });
        activeModalAnimations.delete(root);
    }

    function isModalCloseButton(button) {
        var label = button.getAttribute("aria-label") || button.textContent || "";
        return /^close\b/i.test(label.trim());
    }

    function visibleSurface(root) {
        if (root.matches(".account-panel:not(.student-account-overlay)")) return root;
        return Array.prototype.find.call(root.querySelectorAll(modalSurfaceSelector), function (surface) {
            return surface.getClientRects().length > 0;
        }) || null;
    }

    function playModalClose(root, surface, button) {
        var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        var duration = reduceMotion ? 140 : 260;
        var easing = reduceMotion ? "ease-out" : "cubic-bezier(.32, 0, .2, 1)";
        var animations = [];

        cancelModalAnimations(root);

        if (surface) {
            var liveStyle = window.getComputedStyle(surface);
            if (typeof surface.getAnimations === "function") {
                Array.prototype.forEach.call(surface.getAnimations(), function (animation) {
                    animation.cancel();
                });
            }
            animations.push(surface.animate(reduceMotion ? [
                { opacity: liveStyle.opacity },
                { opacity: 0 }
            ] : [
                { opacity: liveStyle.opacity, transform: liveStyle.transform === "none" ? "translateY(0) scale(1)" : liveStyle.transform },
                { opacity: 0, transform: "translateY(8px) scale(.97)" }
            ], {
                duration: duration,
                easing: easing,
                fill: "forwards"
            }));
        }

        if (root !== surface) {
            var rootStyle = window.getComputedStyle(root);
            animations.push(root.animate([
                {
                    backgroundColor: rootStyle.backgroundColor,
                    backdropFilter: reduceMotion ? "none" : rootStyle.backdropFilter
                },
                {
                    backgroundColor: "rgba(0, 0, 0, 0)",
                    backdropFilter: reduceMotion ? "none" : "blur(0px) saturate(100%)"
                }
            ], {
                duration: duration,
                easing: "ease-out",
                fill: "forwards"
            }));
        }

        if (button && (!surface || !surface.contains(button))) {
            animations.push(button.animate([
                { opacity: 1 },
                { opacity: 0 }
            ], {
                duration: Math.min(duration, 210),
                easing: "ease-out",
                fill: "forwards"
            }));
        }

        activeModalAnimations.set(root, animations);
        return {
            animations: animations,
            finished: new Promise(function (resolve) {
                window.setTimeout(resolve, duration + 20);
            })
        };
    }

    document.addEventListener("click", function (event) {
        var button = event.target.closest && event.target.closest("button");
        if (!button || replayingCloseButtons.has(button) || !isModalCloseButton(button)) return;

        var root = button.closest(modalRootSelector);
        if (!root || root.hidden || closingModalRoots.has(root) || typeof root.animate !== "function") return;

        event.preventDefault();
        event.stopImmediatePropagation();
        closingModalRoots.add(root);
        button.disabled = true;

        var exit = playModalClose(root, visibleSurface(root), button);
        exit.finished.then(function () {
            replayingCloseButtons.add(button);
            button.disabled = false;
            try {
                button.click();
            } finally {
                cancelModalAnimations(root);
                replayingCloseButtons.delete(button);
                closingModalRoots.delete(root);
            }
        });
    }, true);

    if (!window.matchMedia("(pointer: fine)").matches ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    var selector = [
        ".auth-shell",
        ".login-card",
        ".app-header",
        ".student-library-search-trigger",
        ".dashboard-tabs",
        ".account-panel",
        ".student-words-dialog",
        ".student-message-dialog",
        ".teacher-replies-dialog",
        ".teacher-updates-dialog",
        ".teacher-review-dialog",
        ".student-lookup-dialog",
        ".create-student-dialog",
        ".create-student-success-card",
        ".assign-picker-dialog",
        ".assignment-edit-dialog",
        ".global-search-card",
        ".tab-bar",
        ".modal-box",
        ".dropdown-menu"
    ].join(",");

    document.querySelectorAll(selector).forEach(function (surface) {
        surface.addEventListener("pointermove", function (event) {
            var rect = surface.getBoundingClientRect();
            if (!rect.width || !rect.height) return;
            surface.style.setProperty("--lg-x", ((event.clientX - rect.left) / rect.width * 100).toFixed(1) + "%");
            surface.style.setProperty("--lg-y", ((event.clientY - rect.top) / rect.height * 100).toFixed(1) + "%");
        }, { passive: true });

        surface.addEventListener("pointerleave", function () {
            surface.style.setProperty("--lg-x", "18%");
            surface.style.setProperty("--lg-y", "10%");
        }, { passive: true });
    });
}());
