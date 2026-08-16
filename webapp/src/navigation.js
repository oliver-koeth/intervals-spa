/* ─── Navigation ─────────────────────────────────────────────────────────── */
function closeTopbarMenu() {
  const topbar = document.querySelector(".topbar");
  const toggle = document.getElementById("topbar-menu-toggle");
  if (!topbar || !toggle) return;
  topbar.classList.remove("menu-open");
  toggle.setAttribute("aria-expanded", "false");
}

function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  const toggle = document.getElementById("sidebar-toggle");
  if (!sidebar || !toggle) return;

  const applyCollapsed = (collapsed) => {
    sidebar.classList.toggle("collapsed", collapsed);
    document.body.classList.toggle("sidebar-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
    const icon = toggle.querySelector("sl-icon");
    if (icon) icon.name = collapsed ? "chevron-right" : "chevron-left";
    document.querySelectorAll(".activities-sidebar").forEach((as) => {
      as.classList.toggle("collapsed", collapsed);
    });
    if (typeof updateActivitiesSidebars === "function") updateActivitiesSidebars();
    if (typeof updateCompareSidebars === "function") updateCompareSidebars();
  };

  const stored = localStorage.getItem("sidebar-collapsed");
  if (stored === "true") {
    applyCollapsed(true);
  } else if (stored === "false") {
    applyCollapsed(false);
  } else if (window.innerWidth <= 900) {
    // Start collapsed on narrow viewports so the content area stays usable.
    applyCollapsed(true);
  }

  toggle.addEventListener("click", () => {
    const collapsed = sidebar.classList.toggle("collapsed");
    applyCollapsed(collapsed);
    localStorage.setItem("sidebar-collapsed", collapsed ? "true" : "false");
  });
}

function setScreen(name) {
  state.screen = name;
  const primaryNavTarget = name === "activity-detail"
    ? "activities"
    : name === "compare"
      ? "intervals"
      : name === "glucose-detail"
        ? "glucose"
        : name;
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === `screen-${name}`);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("nav-btn-active", btn.dataset.screenTarget === primaryNavTarget);
  });
  document.body.classList.toggle(
    "activities-layout",
    name === "activities" || name === "activity-detail" || name === "intervals" || name === "compare"
  );
  if (typeof updateActivitiesSidebars === "function") updateActivitiesSidebars();
  if (typeof updateCompareSidebars === "function") updateCompareSidebars();
  if (name === "compare") renderCompare();
  if (name === "similarity") renderSimilarityQueryOptions();
}
