(function () {
    "use strict";

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
