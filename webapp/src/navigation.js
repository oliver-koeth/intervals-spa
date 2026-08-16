/* ─── Navigation ─────────────────────────────────────────────────────────── */
function closeTopbarMenu() {
  const topbar = document.querySelector(".topbar");
  const toggle = document.getElementById("topbar-menu-toggle");
  if (!topbar || !toggle) return;
  topbar.classList.remove("menu-open");
  toggle.setAttribute("aria-expanded", "false");
}

function setScreen(name) {
  state.screen = name;
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === `screen-${name}`);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("nav-btn-active", btn.dataset.screenTarget === name);
  });
  if (name === "compare") renderCompare();
  if (name === "similarity") renderSimilarityQueryOptions();
}

