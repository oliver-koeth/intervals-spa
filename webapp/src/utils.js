/* ─── Helpers ────────────────────────────────────────────────────────────── */
function parseMmSs(input) {
  if (!input || !String(input).trim()) return null;
  const m = String(input).trim().match(/^(\d+):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function parseHhMmSs(input) {
  if (!input || !String(input).trim()) return null;
  const m = String(input).trim().match(/^(\d+):([0-5]\d):([0-5]\d)$/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}

function formatSeconds(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function formatPaceMinutes(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "-";
  const total = Math.round(Number(value) * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function shortZoneLabels(count) {
  return Array.from({ length: count }, (_, i) => `Z${i + 1}`);
}

function computeNiceDurationAxis(values) {
  const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!nums.length) return { min: 0, max: 300, interval: 60 };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = Math.max(30, max - min);
  const target = range / 4;
  const steps = [5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800];
  const step = steps.find((v) => v >= target) || 1800;
  return {
    min: Math.max(0, Math.floor((min - step) / step) * step),
    max: Math.ceil((max + step) / step) * step,
    interval: step,
  };
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function writeHrDiagnostics(payload) {
  const pre = document.getElementById("hr-diagnostics");
  if (!pre) return;
  pre.textContent = JSON.stringify(payload, null, 2);
}

function parseStravaEffortId(intervalId) {
  const m = String(intervalId || "").match(/^strava-(\d+)$/);
  return m ? m[1] : "";
}

function extractStreamArray(raw, keys) {
  if (Array.isArray(raw)) {
    for (const key of keys) {
      const found = raw.find((s) => s?.type === key);
      if (found) return toStreamArray(found);
    }
    return [];
  }
  for (const key of keys) {
    if (raw && raw[key] !== undefined) return toStreamArray(raw[key]);
  }
  return [];
}

function initManualGallery() {
  const lightbox = document.getElementById("manual-lightbox");
  const img = document.getElementById("manual-lightbox-image");
  const caption = document.getElementById("manual-lightbox-caption");
  const closeBtn = document.getElementById("manual-lightbox-close");
  if (!lightbox || !img || !caption || !closeBtn) return;

  const close = () => {
    lightbox.classList.add("hidden");
    img.src = "";
    img.alt = "";
    caption.textContent = "";
  };

  document.querySelectorAll(".manual-thumb-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const src = link.getAttribute("data-full-image") || link.getAttribute("href") || "";
      const text = link.getAttribute("data-caption") || "";
      if (!src) return;
      img.src = src;
      img.alt = text;
      caption.textContent = text;
      lightbox.classList.remove("hidden");
    });
  });

  closeBtn.addEventListener("click", close);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.classList.contains("hidden")) close();
  });
}

function initSearchDatePickers() {
  if (typeof flatpickr === "undefined") return;
  const ids = [
    "activity-search-from", "activity-search-to",
    "activities-filter-date-from", "activities-filter-date-to",
    "search-from", "search-to",
    "strava-search-from", "strava-search-to",
    "filter-date-from", "filter-date-to",
    "glucose-filter-from", "glucose-filter-to",
  ];
  ids.forEach((id) => {
    const input = document.getElementById(id);
    if (!input || input.dataset.fpAttached === "1") return;
    flatpickr(input, {
      dateFormat: "Y-m-d",
      allowInput: false,
      clickOpens: true,
    });
    input.dataset.fpAttached = "1";
  });
}

function isDark() { return document.body.classList.contains("theme-dark"); }

function normalizeActivityType(type) {
  return type ? type.replace(/\s+/g, "").toLowerCase() : "";
}

function activityMainType(type) {
  const t = normalizeActivityType(type);
  if (!t) return "";
  if (t.includes("run")) return "run";
  if (t.includes("ride") || t.includes("cycling") || t.includes("bike")) return "ride";
  if (t.includes("swim")) return "swim";
  if (t.includes("walk") || t.includes("hike")) return "walk";
  return t;
}

/* ─── Sortable table headers ─────────────────────────────────────────────── */
function sortValueForField(item, field) {
  const value = item[field];
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function compareForSort(a, b, dir) {
  const aNil = a === null || a === undefined || a === "";
  const bNil = b === null || b === undefined || b === "";
  if (aNil || bNil) {
    if (aNil && bNil) return 0;
    return aNil ? 1 : -1; // blanks always sort last, regardless of direction
  }
  let cmp;
  if (typeof a === "number" && typeof b === "number") cmp = a - b;
  else cmp = String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
  return dir === "desc" ? -cmp : cmp;
}

function sortForDisplay(items, sortState) {
  if (!sortState || !sortState.field) return items;
  const { field, dir } = sortState;
  return [...items].sort((a, b) =>
    compareForSort(sortValueForField(a, field), sortValueForField(b, field), dir)
  );
}

function updateSortIndicators(thead, sortState) {
  thead.querySelectorAll(".sort-btn").forEach((btn) => {
    const isActive = !!sortState &&
      sortState.field === btn.dataset.sortField &&
      sortState.dir === btn.dataset.sortDir;
    btn.classList.toggle("is-active", isActive);
  });
}

function setupSortableTable(tableId, getSort, setSort) {
  const table = document.getElementById(tableId);
  if (!table) return;
  const thead = table.querySelector("thead");
  if (!thead) return;
  thead.addEventListener("click", (e) => {
    const btn = e.target.closest(".sort-btn");
    if (!btn) return;
    const field = btn.dataset.sortField;
    const dir = btn.dataset.sortDir;
    if (!field || !dir) return;
    setSort({ field, dir });
    updateSortIndicators(thead, { field, dir });
  });
  updateSortIndicators(thead, getSort());
}


/* ─── Sidebar cache stats ────────────────────────────────────────────────── */
/** Rough estimate (in bytes) of everything this app has written to localStorage
 *  (activities/intervals/HR-stream caches, settings, etc). localStorage stores
 *  UTF-16 strings, so ~2 bytes per character is a reasonable approximation. */
function estimateLocalStorageUsageBytes() {
  let total = 0;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key) || "";
      total += ((key || "").length + value.length) * 2;
    }
  } catch { /* ignore — private mode or disabled storage */ }
  return total;
}

/** Formats a byte count as a human-readable size string (e.g. "482 KB", "12.3 MB"). */
function formatBytesSize(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Refreshes the small "Activities / Intervals / Storage" stats block pinned under
 *  the Manual nav button in the sidebar. Safe to call often — it's cheap and a
 *  no-op if the DOM nodes aren't present (e.g. during early boot). "Storage" shows
 *  the actual size used (IndexedDB, where the bulky activity/interval/stream caches
 *  now live, plus localStorage) rather than a percentage of some quota. */
async function updateAppSidebarStats() {
  const activitiesEl = document.getElementById("sidebar-stat-activities");
  const intervalsEl = document.getElementById("sidebar-stat-intervals");
  const cacheEl = document.getElementById("sidebar-stat-cache");
  if (!activitiesEl && !intervalsEl && !cacheEl) return;
  if (activitiesEl) activitiesEl.textContent = String((state.activities || []).length);
  if (intervalsEl) intervalsEl.textContent = String((state.intervals || []).length);
  if (!cacheEl) return;
  try {
    if (navigator.storage && navigator.storage.estimate) {
      const { usage = 0, quota = 0 } = await navigator.storage.estimate();
      cacheEl.textContent = formatBytesSize(usage);
      cacheEl.title = quota
        ? `${formatBytesSize(usage)} used of an estimated ${formatBytesSize(quota)} storage quota (IndexedDB + localStorage)`
        : `${formatBytesSize(usage)} used (IndexedDB + localStorage)`;
      return;
    }
  } catch { /* fall through to the localStorage-only estimate below */ }
  const usedBytes = estimateLocalStorageUsageBytes();
  cacheEl.textContent = formatBytesSize(usedBytes);
  cacheEl.title = `${formatBytesSize(usedBytes)} used in localStorage (IndexedDB size unavailable in this browser)`;
}
