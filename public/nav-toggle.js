// Nav-bar hamburger toggle. Wired up by every landing page (libs / lang
// / runtime). Each page renders:
//
//   <div class="nav-dropdown">
//     <button class="nav-toggle" aria-controls="primary-nav" aria-expanded="false">…</button>
//     <nav id="primary-nav" class="nav">…</nav>
//   </div>
//
// We previously used <details><summary>, but modern Chromium (≥ 131)
// styles the closed <details>'s ::details-content with
// content-visibility: hidden, which wins over the parent's
// `display: contents` and hides the desktop nav links entirely. Plain
// button + aria-expanded sidesteps the whole UA-shadow mess.
(() => {
  function wire(button) {
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") === "true";
      button.setAttribute("aria-expanded", String(!open));
    });
  }
  function closeOnOutsideClick(e) {
    for (const btn of document.querySelectorAll(".nav-toggle[aria-expanded='true']")) {
      const dropdown = btn.closest(".nav-dropdown");
      if (dropdown && !dropdown.contains(e.target)) {
        btn.setAttribute("aria-expanded", "false");
      }
    }
  }
  function init() {
    document.querySelectorAll(".nav-toggle").forEach(wire);
    document.addEventListener("click", closeOnOutsideClick);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        for (const btn of document.querySelectorAll(".nav-toggle[aria-expanded='true']")) {
          btn.setAttribute("aria-expanded", "false");
        }
      }
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
