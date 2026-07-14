/* ─── Constants ────────────────────────────────────────────────────────── */
const ZONE_COLORS = { 1:"#10b981", 2:"#06b6d4", 3:"#f59e0b", 4:"#f97316", 5:"#ef4444" };
const TOOLTIP_CSS = "background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.55);color:#f1f5f9;font-size:12px;max-width:260px";

/* ─── State ─────────────────────────────────────────────────────────────── */
const state = {
  intervals: [],
  filtered: [],
  selected: new Set(),
  screen: "search",
  charts: {},
  compareSource: [],
  pinnedInterval: null,
};

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function parseMmSs(input) {
  if (!input || !String(input).trim()) return null;
  const m = String(input).trim().match(/^(\d+):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatSeconds(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isDark() { return document.body.classList.contains("theme-dark"); }

function normalizeActivityType(type) {
  return type ? type.replace(/\s+/g, "").toLowerCase() : "";
}

function intervalTooltip(item) {
  const z = item.zone;
  const zColor = ZONE_COLORS[z] || "#94a3b8";
  const name = (item.activity_name || "").slice(0, 36);
  return `<div style="line-height:1.7;font-size:12px">
    <div style="font-weight:700;font-size:13px;margin-bottom:2px">${item.date} · ${item.activity_type || ""}</div>
    <div style="color:#94a3b8;margin-bottom:4px">${name}</div>
    <div>Label: <b>${item.label || ""}</b></div>
    <div>Time: <b>${formatSeconds(item.moving_time_s)}</b> &nbsp; Zone: <b style="color:${zColor}">Z${z || "–"}</b></div>
    <div>HR: <b>${Math.round(item.avg_hr || 0)}</b> avg / <b>${Math.round(item.max_hr || 0)}</b> max bpm</div>
  </div>`;
}

/* ─── Navigation ─────────────────────────────────────────────────────────── */
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

/* ─── Settings ───────────────────────────────────────────────────────────── */
function getSettings() {
  return {
    athleteId: (localStorage.getItem("intervals_athlete_id") || "").trim(),
    apiKey: (localStorage.getItem("intervals_api_key") || "").trim(),
    apiMode: localStorage.getItem("intervals_api_mode") || "auto",
  };
}

function loadSettingsToForm() {
  const s = getSettings();
  document.getElementById("settings-athlete-id").value = s.athleteId;
  document.getElementById("settings-api-key").value = s.apiKey;
  document.getElementById("settings-api-mode").value = s.apiMode;
}

function saveSettings(e) {
  e.preventDefault();
  localStorage.setItem("intervals_athlete_id", document.getElementById("settings-athlete-id").value.trim());
  localStorage.setItem("intervals_api_key",    document.getElementById("settings-api-key").value.trim());
  localStorage.setItem("intervals_api_mode",   document.getElementById("settings-api-mode").value);
  document.getElementById("settings-status").textContent = "Saved.";
}

function clearSettings() {
  ["intervals_athlete_id","intervals_api_key","intervals_api_mode"].forEach((k) => localStorage.removeItem(k));
  loadSettingsToForm();
  document.getElementById("settings-status").textContent = "Cleared.";
}

/* ─── Search status ──────────────────────────────────────────────────────── */
function setStatus(text, isError = false) {
  const node = document.getElementById("search-status");
  node.textContent = text;
  node.style.color = isError ? "#f87171" : "";
}

function resolveApiMode(savedMode) {
  if (savedMode !== "auto") return savedMode;
  return ["localhost","127.0.0.1"].includes(window.location.hostname) ? "proxy" : "direct";
}

/* ─── Map API response → internal interval object ─────────────────────────── */
function mapInterval(activity, interval) {
  return {
    interval_id:    interval.id,
    activity_id:    activity.id,
    date:           String(activity.start_date_local || "").slice(0, 10),
    activity_name:  activity.name || "",
    activity_type:  activity.type || "",
    label:          interval.label || "",
    moving_time_s:  interval.moving_time || 0,
    avg_watts:      interval.average_watts || 0,
    weighted_watts: interval.normalized_power || interval.weighted_average_watts || 0,
    avg_watts_kg:   interval.watts_kg || 0,
    avg_hr:         interval.average_heartrate || 0,
    max_hr:         interval.max_heartrate || 0,
    training_load:  interval.training_load || 0,
    decoupling:     interval.decoupling || 0,
    zone:           interval.zone || null,
  };
}

/* ─── API: direct (browser → intervals.icu) ──────────────────────────────── */
async function runDirectSearch(params, athleteId, apiKey) {
  const auth = `Basic ${btoa(`API_KEY:${apiKey}`)}`;
  const hdrs = { Authorization: auth, Accept: "application/json" };
  const fields = encodeURIComponent("id,name,start_date_local,type");
  const url = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities` +
    `?oldest=${encodeURIComponent(params.startDate)}&newest=${encodeURIComponent(params.endDate)}&fields=${fields}`;

  const res = await fetch(url, { headers: hdrs });
  if (!res.ok) throw new Error(`Activities request failed (${res.status})`);
  const activities = await res.json();

  const typeNeedle = normalizeActivityType(params.activityType);
  const results = [];

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    if (typeNeedle && normalizeActivityType(activity.type) !== typeNeedle) continue;

    setStatus(`Loading activity ${i + 1}/${activities.length}…`);
    const iRes = await fetch(
      `https://intervals.icu/api/v1/activity/${encodeURIComponent(activity.id)}/intervals`,
      { headers: hdrs }
    );
    if (!iRes.ok) { await delay(150); continue; }
    const iData = await iRes.json();
    const intervals = Array.isArray(iData.icu_intervals) ? iData.icu_intervals : [];

    intervals.forEach((interval) => {
      if (params.label && !String(interval.label || "").toLowerCase().includes(params.label.toLowerCase())) return;
      if (params.targetSeconds !== null) {
        const t = Number(interval.moving_time || 0);
        if (t < params.targetSeconds - params.marginSeconds || t > params.targetSeconds + params.marginSeconds) return;
      }
      results.push(mapInterval(activity, interval));
    });
    await delay(150);
  }
  return results;
}

/* ─── API: proxy (browser → local server) ───────────────────────────────── */
async function runProxySearch(params, athleteId, apiKey) {
  const res = await fetch("./api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      athlete_id:   athleteId,
      api_key:      apiKey,
      label:        params.label,
      activity_type: params.activityType,
      start_date:   params.startDate,
      end_date:     params.endDate,
      time_target_s: params.targetSeconds,
      time_margin_s: params.marginSeconds,
    }),
  });
  if (!res.ok) throw new Error(`Proxy search failed (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

/* ─── Render intervals table ─────────────────────────────────────────────── */
function renderIntervals() {
  const body = document.getElementById("intervals-body");
  body.innerHTML = "";
  state.filtered.forEach((item) => {
    const id = String(item.interval_id);
    const z  = item.zone;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="center"><input type="checkbox" data-select-id="${id}" ${state.selected.has(id) ? "checked" : ""} /></td>
      <td>${item.date || ""}</td>
      <td>${item.activity_type || ""}</td>
      <td title="${item.activity_name || ""}">${(item.activity_name || "").slice(0, 34)}</td>
      <td>${item.label || ""}</td>
      <td class="right">${formatSeconds(item.moving_time_s)}</td>
      <td class="right">${Math.round(item.avg_watts || 0)}</td>
      <td class="right">${(item.avg_watts_kg || 0).toFixed(2)}</td>
      <td class="right">${Math.round(item.avg_hr || 0)}</td>
      <td class="right">${Math.round(item.max_hr || 0)}</td>
      <td class="right">${(item.training_load || 0).toFixed(1)}</td>
      <td class="right" style="color:${ZONE_COLORS[z] || "inherit"}">${z ? `Z${z}` : "-"}</td>
      <td class="right">${(item.decoupling || 0).toFixed(1)}%</td>
    `;
    body.appendChild(tr);
  });
  document.getElementById("result-summary").textContent = `${state.filtered.length} intervals`;
  document.getElementById("selected-count").textContent = `${state.selected.size} selected`;
  body.querySelectorAll("input[data-select-id]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-select-id");
      if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
      document.getElementById("selected-count").textContent = `${state.selected.size} selected`;
    });
  });
}

/* ─── Local filter ───────────────────────────────────────────────────────── */
function applyLocalFilters() {
  const labelNeedle = document.getElementById("filter-label").value.trim().toLowerCase();
  const typeNeedle  = normalizeActivityType(document.getElementById("filter-type").value);
  const tFrom = parseMmSs(document.getElementById("filter-time-from").value);
  const tTo   = parseMmSs(document.getElementById("filter-time-to").value);
  const dFrom = document.getElementById("filter-date-from").value;
  const dTo   = document.getElementById("filter-date-to").value;

  state.filtered = state.intervals.filter((item) => {
    if (labelNeedle && !String(item.label).toLowerCase().includes(labelNeedle)) return false;
    if (typeNeedle && normalizeActivityType(item.activity_type) !== typeNeedle) return false;
    if (tFrom !== null && Number(item.moving_time_s) < tFrom) return false;
    if (tTo   !== null && Number(item.moving_time_s) > tTo)   return false;
    if (dFrom && item.date < dFrom) return false;
    if (dTo   && item.date > dTo)   return false;
    return true;
  });
  state.selected.forEach((id) => {
    if (!state.filtered.find((x) => String(x.interval_id) === id)) state.selected.delete(id);
  });
  renderIntervals();
}

/* ─── Charts ─────────────────────────────────────────────────────────────── */
function mkChart(name) {
  if (state.charts[name]) state.charts[name].dispose();
  state.charts[name] = echarts.init(document.getElementById(`chart-${name}`), isDark() ? "dark" : null);
  return state.charts[name];
}

function resizeAll() { Object.values(state.charts).forEach((c) => c && c.resize()); }

function mockHrStream(item) {
  const avg = Number(item.avg_hr || 150);
  const max = Number(item.max_hr || avg + 10);
  const secs = Math.max(300, Number(item.moving_time_s || 1500));
  const pts = [];
  for (let t = 0; t <= secs; t += 20) {
    const wave  = Math.sin(t / 150) * 4 + Math.cos(t / 80) * 2;
    const trend = (t / secs) * (max - avg) * 0.7;
    pts.push([+(t / 60).toFixed(2), Math.round(avg - 4 + wave + trend)]);
  }
  return pts;
}

function renderRow2(item) {
  const src    = item ? [item] : state.compareSource;
  const single = !!item;

  const zones = [1,2,3,4,5].map((z) => ({
    label: `Z${z}`, count: src.filter((x) => Number(x.zone) === z).length,
  }));
  const zChart = mkChart("zones");
  zChart.setOption({
    title: {
      text: single ? `Zone: ${item.date}` : "Zone distribution",
      subtext: single ? (item.activity_name || "").slice(0, 36) : "",
      top: 6, textStyle: { fontSize: 12 }, subtextStyle: { fontSize: 10 },
    },
    tooltip: { trigger: "axis" },
    grid: { left: 36, right: 16, top: single ? 52 : 36, bottom: 28 },
    xAxis: { type: "category", data: zones.map((x) => x.label) },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: zones.map((x, i) => ({ value: x.count, itemStyle: { color: ZONE_COLORS[i+1] } })) }],
  });

  const si = item || state.compareSource[0] || { moving_time_s: 1500, avg_hr: 150, max_hr: 165 };
  const sChart = mkChart("hr-stream");
  sChart.setOption({
    title: {
      text: single ? `HR stream: ${item.date}` : "Mock HR stream (first interval)",
      subtext: `Generated · avg ${Math.round(si.avg_hr||0)} bpm · max ${Math.round(si.max_hr||0)} bpm`,
      top: 6, textStyle: { fontSize: 12 }, subtextStyle: { fontSize: 10 },
    },
    tooltip: { trigger: "axis", formatter: (p) => `${p[0].value[0].toFixed(1)} min · HR ${p[0].value[1]} bpm` },
    grid: { left: 42, right: 20, top: 52, bottom: 28 },
    xAxis: { type: "value", name: "min", nameLocation: "end" },
    yAxis: { type: "value", name: "bpm" },
    series: [{
      type: "line", smooth: true, showSymbol: false,
      lineStyle: { color: "#06b6d4", width: 2 },
      areaStyle: { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1,
        colorStops: [{ offset: 0, color: "rgba(6,182,212,0.25)" }, { offset: 1, color: "rgba(6,182,212,0)" }] } },
      data: mockHrStream(si),
    }],
  });
}

function attachRow1Click(chartName, indexFn) {
  const c = state.charts[chartName];
  if (!c) return;
  c.on("click", (params) => {
    const item = state.compareSource[indexFn(params)] ?? null;
    state.pinnedInterval = item;
    renderRow2(item);
  });
}

function renderCompare() {
  const sel = state.filtered.filter((x) => state.selected.has(String(x.interval_id)));
  const src = sel.length ? sel : state.filtered;
  state.compareSource = [...src].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  state.pinnedInterval = null;
  document.getElementById("compare-summary").textContent =
    `${state.compareSource.length} interval(s) shown${sel.length ? " (selected)" : " (all filtered)"}`;

  const sorted = state.compareSource;
  const dates  = sorted.map((x) => x.date);

  function axisFormatter(params) {
    const item = sorted[params[0]?.dataIndex ?? 0];
    if (!item) return "";
    return intervalTooltip(item);
  }

  // ── Progression ──
  const p = mkChart("progression");
  p.setOption({
    title:  { text: "Progression over time", top: 6, textStyle: { fontSize: 12 } },
    tooltip: { trigger: "axis", formatter: axisFormatter, extraCssText: TOOLTIP_CSS },
    legend: { top: 28, textStyle: { fontSize: 11 } },
    grid:   { left: 44, right: 44, top: 68, bottom: 32 },
    xAxis:  { type: "category", data: dates },
    yAxis:  [{ type: "value", name: "W" }, { type: "value", name: "Load" }],
    series: [
      { type: "line", name: "Avg W",      smooth: true, data: sorted.map((x) => x.avg_watts) },
      { type: "line", name: "Weighted W", smooth: true, data: sorted.map((x) => x.weighted_watts) },
      { type: "line", name: "Load", yAxisIndex: 1, smooth: true, data: sorted.map((x) => +((x.training_load||0).toFixed(2))) },
    ],
  });
  attachRow1Click("progression", (p) => p.dataIndex);

  // ── HR trends ──
  const hr = mkChart("hr");
  hr.setOption({
    title:  { text: "Heart rate trends", top: 6, textStyle: { fontSize: 12 } },
    tooltip: { trigger: "axis", formatter: axisFormatter, extraCssText: TOOLTIP_CSS },
    legend: { top: 28, textStyle: { fontSize: 11 } },
    grid:   { left: 44, right: 16, top: 68, bottom: 32 },
    xAxis:  { type: "category", data: dates },
    yAxis:  { type: "value", name: "bpm" },
    series: [
      { type: "line", name: "Avg HR",       smooth: true, data: sorted.map((x) => x.avg_hr) },
      { type: "line", name: "Max HR",       smooth: true, data: sorted.map((x) => x.max_hr) },
      { type: "line", name: "Decoupling %", smooth: true, data: sorted.map((x) => +(x.decoupling||0).toFixed(1)) },
    ],
  });
  attachRow1Click("hr", (p) => p.dataIndex);

  // ── Power vs HR scatter ──
  const sc = mkChart("scatter");
  sc.setOption({
    title:  { text: "Power vs HR", textStyle: { fontSize: 12 } },
    tooltip: {
      formatter: (p) => { const item = sorted[p.dataIndex]; return item ? intervalTooltip(item) : ""; },
      extraCssText: TOOLTIP_CSS,
    },
    grid:  { left: 44, right: 16, top: 36, bottom: 32 },
    xAxis: { type: "value", name: "Avg W",  nameLocation: "end" },
    yAxis: { type: "value", name: "Avg HR", nameLocation: "end" },
    series: [{
      type: "scatter",
      data: sorted.map((x) => [x.avg_watts, x.avg_hr, x.moving_time_s]),
      symbolSize: (v) => Math.max(9, Math.min(26, v[2] / 70)),
    }],
  });
  attachRow1Click("scatter", (p) => p.dataIndex);

  renderRow2(null);
}

/* ─── Theme ──────────────────────────────────────────────────────────────── */
function toggleTheme() {
  const dark = document.body.classList.toggle("theme-dark");
  document.getElementById("theme-toggle").textContent = dark ? "Light mode" : "Dark mode";
  localStorage.setItem("webapp-theme", dark ? "dark" : "light");
  if (state.screen === "compare") renderCompare();
}

/* ─── Search ─────────────────────────────────────────────────────────────── */
function defaultDateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 6);
  return { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10) };
}

async function handleSearchSubmit(e) {
  e.preventDefault();
  const settings = getSettings();
  if (!settings.athleteId || !settings.apiKey) {
    setStatus("Set athlete ID and API key in Settings first.", true);
    setScreen("settings");
    return;
  }
  const targetSeconds = parseMmSs(document.getElementById("search-time").value);
  const marginSeconds = parseMmSs(document.getElementById("search-margin").value) ?? 10;
  const params = {
    label:         document.getElementById("search-label").value.trim(),
    activityType:  document.getElementById("search-type").value,
    startDate:     document.getElementById("search-from").value,
    endDate:       document.getElementById("search-to").value,
    targetSeconds,
    marginSeconds,
  };
  const submit = document.getElementById("search-submit");
  submit.disabled = true;
  setStatus("Searching…");
  try {
    const mode = resolveApiMode(settings.apiMode);
    const results = mode === "proxy"
      ? await runProxySearch(params, settings.athleteId, settings.apiKey)
      : await runDirectSearch(params, settings.athleteId, settings.apiKey);
    state.intervals = results.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    state.filtered  = [...state.intervals];
    state.selected.clear();
    renderIntervals();
    setStatus(`Done. ${results.length} intervals found.`);
    setScreen("intervals");
    document.getElementById("filter-label").value = params.label;
    document.getElementById("filter-type").value  = params.activityType;
    if (targetSeconds !== null) {
      document.getElementById("filter-time-from").value = formatSeconds(Math.max(0, targetSeconds - marginSeconds));
      document.getElementById("filter-time-to").value   = formatSeconds(targetSeconds + marginSeconds);
    } else {
      document.getElementById("filter-time-from").value = "";
      document.getElementById("filter-time-to").value   = "";
    }
    document.getElementById("filter-date-from").value = params.startDate;
    document.getElementById("filter-date-to").value   = params.endDate;
  } catch (err) {
    setStatus(`Search failed: ${err.message}`, true);
  } finally {
    submit.disabled = false;
  }
}

/* ─── Init ───────────────────────────────────────────────────────────────── */
function init() {
  const storedTheme = localStorage.getItem("webapp-theme") || localStorage.getItem("mockup-theme");
  if (storedTheme === "light") {
    document.body.classList.remove("theme-dark");
    document.getElementById("theme-toggle").textContent = "Dark mode";
  }

  const range = defaultDateRange();
  document.getElementById("search-from").value = range.from;
  document.getElementById("search-to").value   = range.to;

  loadSettingsToForm();
  setScreen("search");

  document.getElementById("search-form").addEventListener("submit", handleSearchSubmit);
  document.getElementById("settings-form").addEventListener("submit", saveSettings);
  document.getElementById("settings-clear").addEventListener("click", clearSettings);
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("back-to-list").addEventListener("click", () => setScreen("intervals"));
  document.getElementById("go-compare").addEventListener("click", () => setScreen("compare"));
  document.getElementById("select-all").addEventListener("click", () => {
    state.filtered.forEach((x) => state.selected.add(String(x.interval_id)));
    renderIntervals();
  });
  document.getElementById("select-none").addEventListener("click", () => {
    state.selected.clear();
    renderIntervals();
  });

  document.querySelectorAll("[data-screen-target]").forEach((btn) => {
    btn.addEventListener("click", () => setScreen(btn.dataset.screenTarget));
  });

  document.getElementById("apply-filters").addEventListener("click", applyLocalFilters);
  document.getElementById("clear-filters").addEventListener("click", () => {
    ["filter-label","filter-time-from","filter-time-to","filter-date-from","filter-date-to"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    document.getElementById("filter-type").value = "";
    state.filtered = [...state.intervals];
    renderIntervals();
  });

  window.addEventListener("resize", resizeAll);
}

init();
