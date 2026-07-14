/* ─── State ────────────────────────────────────────────────────────────── */
const state = {
  intervals: [],
  filtered: [],
  selected: new Set(),
  screen: "search",
  charts: {}, // keyed by name
  compareSource: [], // sorted intervals currently shown in compare
  pinnedInterval: null, // interval clicked in a row-1 chart
};

const ZONE_COLORS = {
  1: "#10b981", 2: "#06b6d4", 3: "#f59e0b", 4: "#f97316", 5: "#ef4444",
};

/* ─── Helpers ──────────────────────────────────────────────────────────── */
function parseMmSs(input) {
  if (!input || !String(input).trim()) return null;
  const m = String(input).trim().match(/^(\d+):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function fmtTime(s) {
  const total = Math.max(0, Math.round(Number(s) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function isDark() { return document.body.classList.contains("theme-dark"); }

function intervalTooltip(item) {
  const z = item.zone;
  const zColor = ZONE_COLORS[z] || "#94a3b8";
  const name = item.activity_name.length > 34 ? item.activity_name.slice(0, 33) + "…" : item.activity_name;
  return `<div style="line-height:1.7;font-size:12px">
    <div style="font-weight:700;font-size:13px;margin-bottom:2px">${item.date} · ${item.activity_type || ""}</div>
    <div style="color:#94a3b8;margin-bottom:4px">${name}</div>
    <div>Label: <b>${item.label}</b></div>
    <div>Time: <b>${fmtTime(item.moving_time_s)}</b> &nbsp; Zone: <b style="color:${zColor}">Z${z || "–"}</b></div>
    <div>HR: <b>${Math.round(item.avg_hr || 0)}</b> avg / <b>${Math.round(item.max_hr || 0)}</b> max bpm</div>
  </div>`;
}

/* ─── Navigation ───────────────────────────────────────────────────────── */
function setScreen(name) {
  state.screen = name;
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === `screen-${name}`);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("nav-btn-active", btn.dataset.screenTarget === name);
  });
  if (name === "compare") renderCompare();
}

/* ─── Filters ──────────────────────────────────────────────────────────── */
function applyFilters() {
  const labelNeedle = document.getElementById("filter-label").value.trim().toLowerCase();
  const typeNeedle  = document.getElementById("filter-type").value;
  const tFrom       = parseMmSs(document.getElementById("filter-time-from").value);
  const tTo         = parseMmSs(document.getElementById("filter-time-to").value);
  const dFrom       = document.getElementById("filter-date-from").value;
  const dTo         = document.getElementById("filter-date-to").value;

  state.filtered = state.intervals.filter((item) => {
    if (labelNeedle && !String(item.label).toLowerCase().includes(labelNeedle)) return false;
    if (typeNeedle  && item.activity_type !== typeNeedle) return false;
    if (tFrom !== null && Number(item.moving_time_s) < tFrom) return false;
    if (tTo   !== null && Number(item.moving_time_s) > tTo)   return false;
    if (dFrom && item.date < dFrom) return false;
    if (dTo   && item.date > dTo)   return false;
    return true;
  });

  // drop selections no longer visible
  state.selected.forEach((id) => {
    if (!state.filtered.find((x) => String(x.interval_id) === id)) state.selected.delete(id);
  });
  renderIntervals();
}

/* ─── Interval list ────────────────────────────────────────────────────── */
function renderIntervals() {
  const body = document.getElementById("intervals-body");
  body.innerHTML = "";
  state.filtered.forEach((item) => {
    const id = String(item.interval_id);
    const z = item.zone;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="center"><input type="checkbox" data-select-id="${id}" ${state.selected.has(id) ? "checked" : ""} /></td>
      <td>${item.date}</td>
      <td>${item.activity_type || ""}</td>
      <td title="${item.activity_name}">${item.activity_name.length > 28 ? item.activity_name.slice(0, 27) + "…" : item.activity_name}</td>
      <td>${item.label}</td>
      <td class="right">${fmtTime(item.moving_time_s)}</td>
      <td class="right">${Math.round(item.avg_watts || 0)}</td>
      <td class="right">${(item.avg_watts_kg || 0).toFixed(2)}</td>
      <td class="right">${Math.round(item.avg_hr || 0)}</td>
      <td class="right">${Math.round(item.max_hr || 0)}</td>
      <td class="right">${(item.training_load || 0).toFixed(1)}</td>
      <td class="right" style="color:${ZONE_COLORS[z] || "inherit"}">Z${z || "-"}</td>
      <td class="right">${(item.decoupling || 0).toFixed(1)}%</td>
    `;
    body.appendChild(tr);
  });
  document.getElementById("result-summary").textContent = `${state.filtered.length} intervals`;
  document.getElementById("selected-count").textContent = `${state.selected.size} selected`;
  body.querySelectorAll("input[data-select-id]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-select-id");
      if (e.target.checked) state.selected.add(id);
      else state.selected.delete(id);
      document.getElementById("selected-count").textContent = `${state.selected.size} selected`;
    });
  });
}

/* ─── HR stream mock generator ─────────────────────────────────────────── */
function mockHrStream(item) {
  const avg  = Number(item.avg_hr  || 150);
  const max  = Number(item.max_hr  || avg + 10);
  const secs = Math.max(300, Number(item.moving_time_s || 1500));
  const points = [];
  for (let t = 0; t <= secs; t += 20) {
    const wave  = Math.sin(t / 150) * 4 + Math.cos(t / 80) * 2;
    const trend = (t / secs) * (max - avg) * 0.7;
    points.push([+(t / 60).toFixed(2), Math.round(avg - 4 + wave + trend)]);
  }
  return points;
}

/* ─── Chart helpers ────────────────────────────────────────────────────── */
function mkChart(name) {
  if (state.charts[name]) { state.charts[name].dispose(); }
  const theme = isDark() ? "dark" : null;
  state.charts[name] = echarts.init(document.getElementById(`chart-${name}`), theme);
  return state.charts[name];
}

function resizeAll() {
  Object.values(state.charts).forEach((c) => c && c.resize());
}

/* ─── Row-2 charts: zone dist + HR stream ──────────────────────────────── */
function renderRow2(item) {
  // item = single interval to highlight, or null = show aggregate of compareSource
  const src = item ? [item] : state.compareSource;
  const single = !!item;

  // Zone distribution
  const zones = [1, 2, 3, 4, 5].map((z) => ({
    label: `Z${z}`,
    count: src.filter((x) => Number(x.zone) === z).length,
  }));
  const zChart = mkChart("zones");
  zChart.setOption({
    title: {
      text: single ? `Zone: ${item.date}` : "Zone distribution",
      subtext: single ? item.activity_name.slice(0, 32) : "",
      textStyle: { fontSize: 12 },
      subtextStyle: { fontSize: 10 },
    },
    tooltip: { trigger: "axis" },
    grid: { left: 36, right: 16, top: single ? 52 : 36, bottom: 28 },
    xAxis: { type: "category", data: zones.map((x) => x.label) },
    yAxis: { type: "value" },
    series: [{
      type: "bar",
      data: zones.map((x, i) => ({ value: x.count, itemStyle: { color: ZONE_COLORS[i + 1] } })),
    }],
  });

  // HR stream
  const streamItem = item || state.compareSource[0] || { moving_time_s: 1500, avg_hr: 150, max_hr: 165 };
  const streamData = mockHrStream(streamItem);
  const sChart = mkChart("hr-stream");
  sChart.setOption({
    title: {
      text: single ? `HR stream: ${item.date}` : "Mock HR stream (first interval)",
      subtext: `Generated · avg ${Math.round(streamItem.avg_hr || 0)} bpm · max ${Math.round(streamItem.max_hr || 0)} bpm`,
      textStyle: { fontSize: 12 },
      subtextStyle: { fontSize: 10 },
    },
    tooltip: {
      trigger: "axis",
      formatter: (p) => `${p[0].value[0].toFixed(1)} min  ·  HR ${p[0].value[1]} bpm`,
    },
    grid: { left: 42, right: 20, top: 52, bottom: 28 },
    xAxis: { type: "value", name: "min", nameLocation: "end" },
    yAxis: { type: "value", name: "bpm" },
    series: [{
      type: "line",
      smooth: true,
      showSymbol: false,
      lineStyle: { color: "#06b6d4", width: 2 },
      areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [{ offset: 0, color: "rgba(6,182,212,0.25)" }, { offset: 1, color: "rgba(6,182,212,0)" }] } },
      data: streamData,
    }],
  });
}

/* ─── Row-1 click → pin row-2 ──────────────────────────────────────────── */
function attachRow1Click(chartName, indexFn) {
  const c = state.charts[chartName];
  if (!c) return;
  c.on("click", (params) => {
    const idx = indexFn(params);
    const item = state.compareSource[idx] ?? null;
    state.pinnedInterval = item;
    renderRow2(item);
  });
}

/* ─── Full compare render ───────────────────────────────────────────────── */
function renderCompare() {
  const sel = state.filtered.filter((x) => state.selected.has(String(x.interval_id)));
  const src = sel.length ? sel : state.filtered;
  state.compareSource = [...src].sort((a, b) => a.date.localeCompare(b.date));
  state.pinnedInterval = null;

  document.getElementById("compare-summary").textContent =
    `${state.compareSource.length} interval(s) shown${sel.length ? " (selected)" : " (all filtered)"}`;

  const sorted = state.compareSource;
  const dates  = sorted.map((x) => x.date);

  // Axis tooltip: interval header only (series values shown by ECharts default below)
  function axisFormatter(params) {
    const idx = params[0]?.dataIndex ?? 0;
    const item = sorted[idx];
    if (!item) return "";
    return intervalTooltip(item);
  }

  // ── Progression ──
  const progChart = mkChart("progression");
  progChart.setOption({
    title: { text: "Progression over time", textStyle: { fontSize: 12 } },
    tooltip: { trigger: "axis", formatter: axisFormatter, extraCssText: 'background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.55);color:#f1f5f9;font-size:12px;max-width:260px' },
    legend: { top: 22, textStyle: { fontSize: 11 } },
    grid: { left: 44, right: 44, top: 56, bottom: 32 },
    xAxis: { type: "category", data: dates },
    yAxis: [
      { type: "value", name: "W",    nameTextStyle: { fontSize: 10 } },
      { type: "value", name: "Load", nameTextStyle: { fontSize: 10 } },
    ],
    series: [
      { type: "line", name: "Avg W",       smooth: true, data: sorted.map((x) => x.avg_watts) },
      { type: "line", name: "Weighted W",  smooth: true, data: sorted.map((x) => x.weighted_watts) },
      { type: "line", name: "Load", yAxisIndex: 1, smooth: true, data: sorted.map((x) => +((x.training_load || 0).toFixed(2))) },
    ],
  });
  attachRow1Click("progression", (p) => p.dataIndex);

  // ── HR trends ──
  const hrChart = mkChart("hr");
  hrChart.setOption({
    title: { text: "Heart rate trends", textStyle: { fontSize: 12 } },
    tooltip: { trigger: "axis", formatter: axisFormatter, extraCssText: 'background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.55);color:#f1f5f9;font-size:12px;max-width:260px' },
    legend: { top: 22, textStyle: { fontSize: 11 } },
    grid: { left: 44, right: 16, top: 56, bottom: 32 },
    xAxis: { type: "category", data: dates },
    yAxis: { type: "value", name: "bpm", nameTextStyle: { fontSize: 10 } },
    series: [
      { type: "line", name: "Avg HR",  smooth: true, data: sorted.map((x) => x.avg_hr) },
      { type: "line", name: "Max HR",  smooth: true, data: sorted.map((x) => x.max_hr) },
      { type: "line", name: "Decoupling %", smooth: true, data: sorted.map((x) => +(x.decoupling || 0).toFixed(1)) },
    ],
  });
  attachRow1Click("hr", (p) => p.dataIndex);

  // ── Power vs HR scatter ──
  const scatterChart = mkChart("scatter");
  scatterChart.setOption({
    title: { text: "Power vs HR", textStyle: { fontSize: 12 } },
    tooltip: {
      formatter: (p) => {
        const item = sorted[p.dataIndex];
        return item ? intervalTooltip(item) : "";
      },
      extraCssText: 'background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.55);color:#f1f5f9;font-size:12px;max-width:260px',
    },
    grid: { left: 44, right: 16, top: 36, bottom: 32 },
    xAxis: { type: "value", name: "Avg W",  nameLocation: "end" },
    yAxis: { type: "value", name: "Avg HR", nameLocation: "end" },
    series: [{
      type: "scatter",
      data: sorted.map((x) => [x.avg_watts, x.avg_hr, x.moving_time_s]),
      symbolSize: (v) => Math.max(9, Math.min(26, v[2] / 70)),
    }],
  });
  attachRow1Click("scatter", (p) => p.dataIndex);

  // ── Row 2 ──
  renderRow2(null);
}

/* ─── Theme ─────────────────────────────────────────────────────────────── */
function toggleTheme() {
  const dark = document.body.classList.toggle("theme-dark");
  document.getElementById("theme-toggle").textContent = dark ? "Light mode" : "Dark mode";
  localStorage.setItem("mockup-theme", dark ? "dark" : "light");
  if (state.screen === "compare") renderCompare();
}

/* ─── Settings ─────────────────────────────────────────────────────────── */
function loadSettings() {
  document.getElementById("settings-athlete-id").value = localStorage.getItem("intervals_athlete_id") || "";
  document.getElementById("settings-api-key").value    = localStorage.getItem("intervals_api_key")    || "";
}
function saveSettings(e) {
  e.preventDefault();
  localStorage.setItem("intervals_athlete_id", document.getElementById("settings-athlete-id").value.trim());
  localStorage.setItem("intervals_api_key",    document.getElementById("settings-api-key").value.trim());
  const status = document.getElementById("settings-status");
  status.textContent = "Saved.";
  setTimeout(() => { status.textContent = ""; }, 2000);
}
function clearSettings() {
  localStorage.removeItem("intervals_athlete_id");
  localStorage.removeItem("intervals_api_key");
  document.getElementById("settings-athlete-id").value = "";
  document.getElementById("settings-api-key").value    = "";
  document.getElementById("settings-status").textContent = "Cleared.";
  setTimeout(() => { document.getElementById("settings-status").textContent = ""; }, 2000);
}

/* ─── Bootstrap ─────────────────────────────────────────────────────────── */
async function init() {
  // Theme
  const storedTheme = localStorage.getItem("mockup-theme");
  if (storedTheme === "light") {
    document.body.classList.remove("theme-dark");
    document.getElementById("theme-toggle").textContent = "Dark mode";
  }

  // Load data
  const response = await fetch("./data/intervals.json");
  state.intervals = await response.json();
  state.filtered  = [...state.intervals];
  renderIntervals();
  setScreen("search");

  // Search form
  document.getElementById("search-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const label  = document.getElementById("search-label").value.trim();
    const type   = document.getElementById("search-type").value;
    const time   = document.getElementById("search-time").value.trim();
    const margin = document.getElementById("search-margin").value.trim();

    document.getElementById("filter-label").value = label;
    document.getElementById("filter-type").value  = type;
    document.getElementById("filter-date-from").value = document.getElementById("search-from").value;
    document.getElementById("filter-date-to").value   = document.getElementById("search-to").value;

    if (time) {
      const center = parseMmSs(time) ?? 0;
      const mgn    = parseMmSs(margin) ?? 10;
      document.getElementById("filter-time-from").value = fmtTime(Math.max(0, center - mgn));
      document.getElementById("filter-time-to").value   = fmtTime(center + mgn);
    } else {
      document.getElementById("filter-time-from").value = "";
      document.getElementById("filter-time-to").value   = "";
    }
    applyFilters();
    setScreen("intervals");
  });

  // Nav
  document.querySelectorAll("[data-screen-target]").forEach((btn) => {
    btn.addEventListener("click", () => setScreen(btn.dataset.screenTarget));
  });

  // Interval filters
  document.getElementById("apply-filters").addEventListener("click", applyFilters);
  document.getElementById("clear-filters").addEventListener("click", () => {
    ["filter-label","filter-time-from","filter-time-to","filter-date-from","filter-date-to"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    document.getElementById("filter-type").value = "";
    state.filtered = [...state.intervals];
    renderIntervals();
  });

  // Selection
  document.getElementById("select-all").addEventListener("click", () => {
    state.filtered.forEach((x) => state.selected.add(String(x.interval_id)));
    renderIntervals();
  });
  document.getElementById("select-none").addEventListener("click", () => {
    state.selected.clear();
    renderIntervals();
  });
  document.getElementById("go-compare").addEventListener("click", () => setScreen("compare"));
  document.getElementById("back-to-list").addEventListener("click", () => setScreen("intervals"));

  // Theme
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

  // Settings
  loadSettings();
  document.getElementById("settings-form").addEventListener("submit", saveSettings);
  document.getElementById("settings-clear").addEventListener("click", clearSettings);

  // Resize
  window.addEventListener("resize", resizeAll);
}

init();
