/* ─── Glucose chart tabs ─────────────────────────────────────────────────── */
const GLUCOSE_TARGET_LOW = 80;
const GLUCOSE_TARGET_HIGH = 150;
const GLUCOSE_BORDER_MARGIN = 15;    // width (mg/dL) of the red↔green gradient zone on each side
const GLUCOSE_AXIS_MIN = 50;
const GLUCOSE_AXIS_MAX = 200;
const GLUCOSE_COLOR_GREEN = [0x54, 0xe0, 0xa1];  // matches ZONE_COLORS[1]
const GLUCOSE_COLOR_RED   = [0xff, 0x64, 0x7c];  // matches ZONE_COLORS[5]

function lerpRgb(a, b, t) {
  return a.map((channel, i) => Math.round(channel + (b[i] - channel) * t));
}

function rgbToHex([r, g, b]) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Builds a fine-grained piecewise visualMap covering [GLUCOSE_AXIS_MIN, GLUCOSE_AXIS_MAX]:
 * flat red below/above the target range, flat green inside it, and a smooth red↔green
 * gradient (in 1 mg/dL steps) across the border margins in between.
 */
function buildGlucoseColorPieces() {
  const lowBorderStart = GLUCOSE_TARGET_LOW - GLUCOSE_BORDER_MARGIN;
  const highBorderEnd = GLUCOSE_TARGET_HIGH + GLUCOSE_BORDER_MARGIN;
  const pieces = [];

  pieces.push({ min: -Infinity, max: lowBorderStart, color: rgbToHex(GLUCOSE_COLOR_RED) });
  for (let v = lowBorderStart; v < GLUCOSE_TARGET_LOW; v += 1) {
    const t = (v - lowBorderStart) / GLUCOSE_BORDER_MARGIN;
    pieces.push({ gt: v, lte: v + 1, color: rgbToHex(lerpRgb(GLUCOSE_COLOR_RED, GLUCOSE_COLOR_GREEN, t)) });
  }
  pieces.push({ gt: GLUCOSE_TARGET_LOW, lte: GLUCOSE_TARGET_HIGH, color: rgbToHex(GLUCOSE_COLOR_GREEN) });
  for (let v = GLUCOSE_TARGET_HIGH; v < highBorderEnd; v += 1) {
    const t = (v - GLUCOSE_TARGET_HIGH) / GLUCOSE_BORDER_MARGIN;
    pieces.push({ gt: v, lte: v + 1, color: rgbToHex(lerpRgb(GLUCOSE_COLOR_GREEN, GLUCOSE_COLOR_RED, t)) });
  }
  pieces.push({ min: highBorderEnd, max: Infinity, color: rgbToHex(GLUCOSE_COLOR_RED) });
  return pieces;
}

/** Builds a human-readable range label from the "YYYY-MM-DD" filter values (used as tab name). */
function formatGlucoseRangeLabel(from, to) {
  if (!from && !to) return "All readings";
  if (!to) return `From ${from}`;
  if (!from) return `Until ${to}`;
  if (from === to) return from;
  return `${from} → ${to}`;
}

function renderGlucoseTabBar() {
  const bar = document.getElementById("glucose-tab-bar");
  bar.innerHTML = "";
  if (state.openGlucoseTabs.length === 0) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  state.openGlucoseTabs.forEach(({ id, label }) => {
    const tab = document.createElement("button");
    tab.className = "activity-tab" + (id === state.activeGlucoseTabId ? " active" : "");
    tab.dataset.tabId = id;
    tab.innerHTML = `<span class="activity-tab-label">${label}</span>`
      + `<span class="activity-tab-close" data-close-tab="${id}" title="Close">×</span>`;
    bar.appendChild(tab);
  });
}

/** Opens (or focuses, if already open) a chart tab for the currently filtered glucose range. */
function openGlucoseTab() {
  const from = document.getElementById("glucose-filter-from").value;
  const to = document.getElementById("glucose-filter-to").value;
  if (state.glucoseFiltered.length === 0) {
    document.getElementById("glucose-upload-status").textContent =
      "No glucose readings in the selected range to chart.";
    return;
  }

  const id = `${from || ""}|${to || ""}`;
  const label = formatGlucoseRangeLabel(from, to);
  const points = state.glucoseFiltered
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((r) => [new Date(`${r.date}T${r.time}:00`).getTime(), r.value]);

  const existing = state.openGlucoseTabs.find((t) => t.id === id);
  if (existing) {
    existing.label = label;
    existing.from = from;
    existing.to = to;
    existing.points = points;
  } else {
    state.openGlucoseTabs.push({ id, label, from, to, points, selectedDay: null });
  }
  openGlucoseDetail(id);
}

/** Extracts the local "YYYY-MM-DD" date key from a chart timestamp (ms, local time — consistent with how points were built). */
function dateKeyFromTimestamp(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function renderGlucoseDetailChart(tab) {
  document.getElementById("glucose-detail-summary").textContent =
    `${tab.points.length} readings · target range ${GLUCOSE_TARGET_LOW}–${GLUCOSE_TARGET_HIGH} mg/dL`;

  const chart = mkChart("glucose-detail");
  chart.setOption({
    title: {
      text: tab.label,
      top: 6,
      textStyle: { fontSize: 13 },
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const p = params[0];
        if (!p) return "";
        const d = new Date(p.value[0]);
        return `${d.toLocaleString()}<br/>${Math.round(p.value[1])} mg/dL`;
      },
    },
    visualMap: {
      show: false,
      type: "piecewise",
      dimension: 1,
      seriesIndex: 0,
      pieces: buildGlucoseColorPieces(),
    },
    grid: { left: 52, right: 16, top: 48, bottom: 36 },
    xAxis: { type: "time" },
    yAxis: { type: "value", name: "mg/dL", min: GLUCOSE_AXIS_MIN, max: GLUCOSE_AXIS_MAX },
    series: [{
      type: "line",
      name: "Glucose",
      showSymbol: false,
      smooth: true,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.08 },
      data: tab.points,
    }],
  });

  // Use a zrender-level click + pixel→data conversion instead of the series "click" event:
  // the series event only fires when the click lands exactly on the (thin, smoothed) line,
  // so clicks on the area fill or empty grid space would otherwise be silently ignored.
  chart.getZr().off("click");
  chart.getZr().on("click", (params) => {
    const pixel = [params.offsetX, params.offsetY];
    if (!chart.containPixel("grid", pixel)) return;
    const dataPoint = chart.convertFromPixel({ gridIndex: 0 }, pixel);
    const ts = dataPoint && dataPoint[0];
    if (!Number.isFinite(ts)) return;
    selectGlucoseDay(tab, dateKeyFromTimestamp(ts));
  });
}

/** Renders the second, drill-down chart: the full 00:00–23:59 view of tab.selectedDay. */
function renderGlucoseDayChart(tab) {
  const summaryEl = document.getElementById("glucose-day-summary");
  if (!tab.selectedDay) {
    summaryEl.textContent = "Click a point on the chart above to see the full day here.";
    const chart = mkChart("glucose-day");
    chart.setOption({ title: { show: false }, xAxis: { show: false }, yAxis: { show: false }, series: [] });
    return;
  }

  const dayPoints = state.glucose
    .filter((r) => r.date === tab.selectedDay)
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((r) => [new Date(`${r.date}T${r.time}:00`).getTime(), r.value]);

  const dayStart = new Date(`${tab.selectedDay}T00:00:00`).getTime();
  const dayEnd = new Date(`${tab.selectedDay}T23:59:59`).getTime();
  const model = getSelectedZoneModel();
  const dayActivities = getActivitiesOnDay(tab.selectedDay);
  const activityMarkAreas = buildGlucoseDayActivityMarkAreas(dayActivities, model);

  summaryEl.textContent = `${tab.selectedDay} · ${dayPoints.length} readings`
    + (dayActivities.length
      ? ` · ${dayActivities.length} ${dayActivities.length === 1 ? "activity" : "activities"} (shaded, colored by avg HR zone)`
      : " · no activities that day");

  const chart = mkChart("glucose-day");
  chart.setOption({
    title: {
      text: `Day view — ${tab.selectedDay}`,
      top: 6,
      textStyle: { fontSize: 13 },
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const p = params[0];
        if (!p) return "";
        const ts = p.value[0];
        const d = new Date(ts);
        const lines = [
          d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          `${Math.round(p.value[1])} mg/dL`,
        ];
        const match = dayActivities.find((a) => ts >= a.startMs && ts <= a.endMs);
        if (match) {
          const zone = zoneIndexForHr(match.activity.avg_hr, model);
          const hrPart = match.activity.avg_hr ? ` (${Math.round(match.activity.avg_hr)} bpm avg)` : "";
          lines.push(`🏃 ${match.activity.activity_type || "Activity"}${zone ? ` · Z${zone}` : ""}${hrPart}`);
        }
        return lines.join("<br/>");
      },
    },
    visualMap: {
      show: false,
      type: "piecewise",
      dimension: 1,
      seriesIndex: 0,
      pieces: buildGlucoseColorPieces(),
    },
    grid: { left: 52, right: 16, top: 48, bottom: 36 },
    xAxis: {
      type: "time",
      min: dayStart,
      max: dayEnd,
      minInterval: 3600 * 1000,
      maxInterval: 3600 * 1000,
      axisLabel: { formatter: (value) => String(new Date(value).getHours()) },
    },
    yAxis: { type: "value", name: "mg/dL", min: GLUCOSE_AXIS_MIN, max: GLUCOSE_AXIS_MAX },
    series: [{
      type: "line",
      name: "Glucose",
      showSymbol: false,
      smooth: true,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.08 },
      data: dayPoints,
      markArea: {
        silent: true,
        data: activityMarkAreas,
      },
    }],
  });
}

/** Returns the 1-based HR zone index for an HR value under the given zone model, or null. */
function zoneIndexForHr(hr, model) {
  if (!model || !Array.isArray(model.hr_zones) || !Number.isFinite(hr) || hr <= 0) return null;
  const zones = model.hr_zones;
  for (let i = 0; i < zones.length; i++) {
    if (hr <= zones[i]) return i + 1;
  }
  return zones.length;
}

/** Returns activities from the local Activities list that started on dayKey, with absolute start/end ms. */
function getActivitiesOnDay(dayKey) {
  return state.activities
    .filter((a) => a.date === dayKey && a.activity_start_local)
    .map((activity) => {
      const startMs = new Date(activity.activity_start_local).getTime();
      const durationMs = Math.max(0, Number(activity.moving_time_s || 0)) * 1000;
      return { activity, startMs, endMs: startMs + durationMs };
    })
    .filter((entry) => Number.isFinite(entry.startMs))
    .sort((a, b) => a.startMs - b.startMs);
}

/** Builds ECharts markArea pairs highlighting each activity's time window, colored by avg-HR zone. */
function buildGlucoseDayActivityMarkAreas(dayActivities, model) {
  const MIN_VISIBLE_WIDTH_MS = 3 * 60 * 1000; // keep very short sessions visible/labelable
  return dayActivities.map(({ activity, startMs, endMs }) => {
    const zone = zoneIndexForHr(activity.avg_hr, model);
    const color = zone ? (ZONE_COLORS[zone] || "#94a3b8") : "#94a3b8";
    const label = zone
      ? `${activity.activity_type || "Activity"} · Z${zone}`
      : (activity.activity_type || "Activity");
    return [
      {
        xAxis: startMs,
        itemStyle: { color, opacity: 0.22, borderColor: color, borderWidth: 1, borderType: "dashed" },
        label: {
          show: true,
          position: "insideTop",
          formatter: label,
          fontSize: 10,
          fontWeight: 600,
          color: "#0b1220",
          backgroundColor: color,
          padding: [2, 4],
          borderRadius: 3,
        },
      },
      { xAxis: Math.max(endMs, startMs + MIN_VISIBLE_WIDTH_MS) },
    ];
  });
}

function selectGlucoseDay(tab, dayKey) {
  tab.selectedDay = dayKey;
  renderGlucoseDayChart(tab);
}

function openGlucoseDetail(id) {
  const tab = state.openGlucoseTabs.find((t) => t.id === id);
  if (!tab) {
    setScreen("glucose");
    return;
  }
  state.activeGlucoseTabId = id;
  renderGlucoseTabBar();
  setScreen("glucose-detail");
  renderGlucoseDetailChart(tab);
  renderGlucoseDayChart(tab);
}

function closeGlucoseTab(id) {
  const idx = state.openGlucoseTabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  state.openGlucoseTabs.splice(idx, 1);

  if (state.activeGlucoseTabId === id) {
    if (state.openGlucoseTabs.length > 0) {
      const next = state.openGlucoseTabs[Math.max(0, idx - 1)];
      openGlucoseDetail(next.id);
    } else {
      state.activeGlucoseTabId = null;
      renderGlucoseTabBar();
      setScreen("glucose");
    }
  } else {
    renderGlucoseTabBar();
  }
}

function hideActivitySearchPreview() {
  const box = document.getElementById("activity-search-preview");
  box.classList.add("hidden");
  document.getElementById("activity-search-preview-body").innerHTML = "";
  document.getElementById("activity-search-preview-summary").textContent = "";
  document.getElementById("activity-search-preview-add").disabled = false;
  state.pendingActivityResults = [];
}

function renderActivitySearchPreview(results) {
  const body = document.getElementById("activity-search-preview-body");
  body.innerHTML = "";
  results.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.date || ""}</td>
      <td>${item.activity_type || ""}</td>
      <td title="${item.activity_name || ""}">${(item.activity_name || "").slice(0, 42)}</td>
      <td class="right">${formatSeconds(item.moving_time_s)}</td>
    `;
    body.appendChild(tr);
  });
  document.getElementById("activity-search-preview-summary").textContent =
    `${results.length} activity(s) found`;
  document.getElementById("activity-search-preview-add").disabled = results.length === 0;
  document.getElementById("activity-search-preview").classList.remove("hidden");
}

function hideSearchPreview(kind) {
  const prefix = kind === "strava" ? "strava-search" : "search";
  const box = document.getElementById(`${prefix}-preview`);
  box.classList.add("hidden");
  document.getElementById(`${prefix}-preview-body`).innerHTML = "";
  document.getElementById(`${prefix}-preview-summary`).textContent = "";
  document.getElementById(`${prefix}-preview-add`).disabled = false;
  if (kind === "strava") {
    state.pendingStravaResults = [];
  } else {
    state.pendingIntervalsResults = [];
    state.pendingIntervalsParams = null;
  }
}

function renderSearchPreview(results, kind) {
  const prefix = kind === "strava" ? "strava-search" : "search";
  const body = document.getElementById(`${prefix}-preview-body`);
  body.innerHTML = "";
  results.forEach((item) => {
    const tr = document.createElement("tr");
    const z = item.zone;
    tr.innerHTML = `
      <td>${item.date || ""}</td>
      <td>${item.activity_type || ""}</td>
      <td title="${item.activity_name || ""}">${(item.activity_name || "").slice(0, 34)}</td>
      <td>${item.label || ""}</td>
      <td class="right">${formatSeconds(item.start_index || 0)}</td>
      <td class="right">${formatSeconds(item.moving_time_s)}</td>
      <td class="right" style="color:${ZONE_COLORS[z] || "inherit"}">${z ? `Z${z}` : "-"}</td>
    `;
    body.appendChild(tr);
  });
  document.getElementById(`${prefix}-preview-summary`).textContent = `${results.length} interval(s) found`;
  document.getElementById(`${prefix}-preview-add`).disabled = results.length === 0;
  document.getElementById(`${prefix}-preview`).classList.remove("hidden");
}

function intervalIdentity(item) {
  return [
    item.source || "intervals",
    item.activity_id || "",
    item.interval_id || "",
    Number(item.start_index) || 0,
  ].join("|");
}

function mergeIntervals(existing, incoming) {
  const byId = new Map();
  existing.forEach((item) => byId.set(intervalIdentity(item), item));
  let added = 0;
  let updated = 0;
  incoming.forEach((raw) => {
    const item = { ...raw, source: raw.source || "intervals" };
    const key = intervalIdentity(item);
    if (byId.has(key)) {
      byId.set(key, item);
      updated += 1;
    } else {
      byId.set(key, item);
      added += 1;
    }
  });
  return { items: [...byId.values()], added, updated };
}

function activityIdentity(item) {
  return [
    item.source || "intervals",
    item.activity_id || "",
    String(item.activity_start_local || item.date || ""),
  ].join("|");
}

function mergeActivities(existing, incoming) {
  const byId = new Map();
  existing.forEach((item) => byId.set(activityIdentity(item), item));
  let added = 0;
  let updated = 0;
  incoming.forEach((raw) => {
    const item = { ...raw, source: raw.source || "intervals" };
    const key = activityIdentity(item);
    if (byId.has(key)) {
      byId.set(key, item);
      updated += 1;
    } else {
      byId.set(key, item);
      added += 1;
    }
  });
  return { items: [...byId.values()], added, updated };
}

function commitActivities(results) {
  const merged = mergeActivities(state.activities, results);
  state.activities = merged.items.sort(compareActivitiesChronologically);
  state.activitiesFiltered = [...state.activities];
  renderActivities();
  saveActivitiesCache(state.activities);
  document.getElementById("activity-search-status").textContent = merged.updated
    ? `Added ${merged.added} activity(s), updated ${merged.updated} duplicate(s).`
    : `Added ${merged.added} activity(s).`;
  hideActivitySearchPreview();
  hideSearchPreview("intervals");
  hideSearchPreview("strava");
  setScreen("activities");
}

function commitIntervals(results, params) {
  const merged = mergeIntervals(state.intervals, results);
  state.intervals = merged.items.sort(compareIntervalsChronologically);
  state.filtered  = [...state.intervals];
  state.selected.clear();
  renderIntervals();
  saveIntervalsCache(state.intervals);
  setStatus(
    merged.updated
      ? `Added ${merged.added} interval(s), updated ${merged.updated} duplicate(s).`
      : `Added ${merged.added} interval(s).`
  );
  if (params) {
    document.getElementById("filter-label").value = params.label;
    document.getElementById("filter-type").value  = params.activityType;
    if (params.targetSeconds !== null) {
      document.getElementById("filter-time-from").value = formatSeconds(Math.max(0, params.targetSeconds - params.marginSeconds));
      document.getElementById("filter-time-to").value   = formatSeconds(params.targetSeconds + params.marginSeconds);
    } else {
      document.getElementById("filter-time-from").value = "";
      document.getElementById("filter-time-to").value   = "";
    }
    document.getElementById("filter-date-from").value = params.startDate;
    document.getElementById("filter-date-to").value   = params.endDate;
  }
  hideActivitySearchPreview();
  hideSearchPreview("intervals");
  hideSearchPreview("strava");
  setScreen("intervals");
}

