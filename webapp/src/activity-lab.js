/* ─── Activity tabs ──────────────────────────────────────────────────────── */
function formatDuration(seconds) {
  if (!seconds) return "-";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function formatDistance(meters) {
  if (!meters) return "-";
  return (meters / 1000).toFixed(2) + " km";
}

function formatAvgPace(movingTimeS, distanceM) {
  const secs = Number(movingTimeS || 0);
  const meters = Number(distanceM || 0);
  if (secs <= 0 || meters <= 0) return "-";
  const minPerKm = (secs / 60) / (meters / 1000);
  return `${formatPaceMinutes(minPerKm)} /km`;
}

function renderActivityTabBar() {
  const bar = document.getElementById("activity-tab-bar");
  bar.innerHTML = "";
  if (state.openActivityTabs.length === 0) {
    bar.classList.add("hidden");
    return;
  }
  bar.classList.remove("hidden");
  state.openActivityTabs.forEach(({ id, activity }) => {
    const tab = document.createElement("button");
    tab.className = "activity-tab" + (id === state.activeActivityTabId ? " active" : "");
    tab.dataset.tabId = id;
    const label = activity.date || id;
    tab.innerHTML = `<span class="activity-tab-label">${label}</span>`
      + `<span class="activity-tab-close" data-close-tab="${id}" title="Close">×</span>`;
    bar.appendChild(tab);
  });
}

function renderActivityDetail(tabActivity, focusActivity) {
  const card = document.getElementById("activity-detail-card");
  const activity = focusActivity || tabActivity;
  const tabId = String(tabActivity?.activity_id || "");
  const focusId = String(activity?.activity_id || "");
  const fields = [
    { label: "Date", value: activity.date || "-" },
    { label: "Type", value: activity.activity_type || "-" },
    { label: "Duration", value: formatDuration(activity.moving_time_s) },
    { label: "Distance", value: formatDistance(activity.distance_m) },
    { label: "Avg Pace", value: formatAvgPace(activity.moving_time_s, activity.distance_m) },
    { label: "Avg HR", value: activity.avg_hr ? `${Math.round(activity.avg_hr)} bpm` : "-" },
    { label: "Load", value: activity.training_load != null ? Math.round(activity.training_load) : "-" },
    { label: "Source", value: activity.source || "intervals.icu" },
  ];
  card.innerHTML = `
    <div class="row space-between activity-detail-head">
      <h2 style="margin:0">${activity.activity_name || activity.date || "Activity"}</h2>
      <span class="muted">
        ${focusId === tabId ? "Tab activity" : "Viewing similar activity"}
      </span>
    </div>
    <div class="activity-detail-grid">
      ${fields.map((f) => `
        <div class="activity-detail-field">
          <div class="adf-label">${f.label}</div>
          <div class="adf-value">${f.value}</div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderActivityLabStreamList() {
  const wrap = document.getElementById("activity-lab-stream-list");
  const summary = document.getElementById("activity-lab-stream-summary");
  const desc = document.getElementById("activity-lab-stream-desc");
  const tabId = String(state.activityLab.tabActivityId || "");
  const focusId = String(state.activityLab.focusActivityId || "");
  const mode = state.activityLab.streamListMode || SIMILARITY_DEFAULT_TYPE;
  const scores = state.activityLab.streamScores || {};
  const items = state.activityLab.streamActivities || [];
  summary.textContent = `${items.length} activities`;
  if (desc) {
    desc.textContent = mode === "recent"
      ? "Same main type from the past 14 days. The tab activity stays highlighted."
      : `Ranked by "${SIMILARITY_TYPE_LABELS[mode] || mode}" similarity to the tab activity. The tab activity stays highlighted.`;
  }
  wrap.innerHTML = "";
  items.forEach((activity) => {
    const id = String(activity.activity_id || "");
    const row = document.createElement("div");
    row.className = "activity-lab-stream-item";
    if (id === tabId) row.classList.add("is-tab-activity");
    if (id === focusId) row.classList.add("is-focus-activity");
    row.dataset.activityLabSelect = id;
    const score = scores[id];
    const scoreBadge = Number.isFinite(score) ? `<span class="activity-lab-stream-score">${Math.round(score * 100)}%</span>` : "";
    row.innerHTML = `
      <div class="activity-lab-stream-main">
        <strong>${activity.date || "-"}</strong>
        <span>${formatDuration(activity.moving_time_s)}${scoreBadge}</span>
      </div>
      <div class="activity-lab-stream-sub">
        ${(activity.activity_type || "-")} · ${(activity.activity_name || "").slice(0, 44)}
      </div>
    `;
    wrap.appendChild(row);
  });
}


function mkActivityLabChart(name) {
  if (state.activityLabCharts[name]) state.activityLabCharts[name].dispose();
  state.activityLabCharts[name] = echarts.init(
    document.getElementById(`chart-${name}`),
    isDark() ? "dark" : null
  );
  return state.activityLabCharts[name];
}

function updateActivityLabValueToggleButtons() {
  document.querySelectorAll(".activity-lab-series-toggle").forEach((btn) => {
    const key = btn.dataset.activityLabLabel;
    const seriesState = state.activityLab.visibleSeries[key] || "off";
    btn.classList.toggle("is-active", seriesState === "on");
    btn.classList.toggle("is-dimmed", seriesState === "dimmed");
    btn.setAttribute("aria-pressed", seriesState === "on" ? "true" : seriesState === "dimmed" ? "mixed" : "false");
    btn.title = `${key}: ${seriesState} (click to cycle on → dimmed → off)`;
  });
}

/** Shows/hides the glucose series toggle button — it only ever appears when glucose data exists. */
function setGlucoseToggleVisible(visible) {
  const btn = document.querySelector('.activity-lab-series-toggle[data-activity-lab-label="glucose"]');
  if (btn) btn.classList.toggle("hidden", !visible);
}

/**
 * Returns [minutesSinceActivityStart, mg/dL] points for glucose readings that fall within
 * the activity's start → start+moving_time_s window. Empty if the activity has no known
 * start/duration or no glucose readings overlap it.
 */
function getGlucosePointsForActivity(focusActivity) {
  const startMs = new Date(focusActivity?.activity_start_local || "").getTime();
  if (!Number.isFinite(startMs)) return [];
  const durationMs = Math.max(0, Number(focusActivity?.moving_time_s || 0)) * 1000;
  const endMs = startMs + durationMs;

  return state.glucose
    .map((r) => ({ ts: new Date(`${r.date}T${r.time}:00`).getTime(), value: r.value }))
    .filter((p) => Number.isFinite(p.ts) && p.ts >= startMs && p.ts <= endMs)
    .sort((a, b) => a.ts - b.ts)
    .map((p) => [(p.ts - startMs) / 60000, p.value]);
}

function chartLabelOpt(show, formatter = undefined) {
  return show ? { show: true, fontSize: 9, formatter } : { show: false };
}

function buildFullMetricPoints(stream, metricKind) {
  const time = Array.isArray(stream?.time) ? stream.time : [];
  const hr = Array.isArray(stream?.heartrate) ? stream.heartrate : [];
  if (!time.length || !hr.length) return [];
  const clamp = Math.min(time.length, hr.length);
  const points = [];
  for (let i = 0; i < clamp; i++) {
    const t = Number(time[i]);
    const hrv = Number(hr[i]);
    if (!Number.isFinite(t) || !Number.isFinite(hrv)) continue;
    let metric = null;
    if (metricKind === "watts") {
      const watts = Number(stream?.watts?.[i]);
      if (Number.isFinite(watts) && watts > 0) metric = watts;
    } else {
      metric = normalizeExplicitPaceValue(stream?.gap?.[i]);
      if (!Number.isFinite(metric)) metric = normalizeExplicitPaceValue(stream?.pace?.[i]);
      if (!Number.isFinite(metric)) {
        const v = Number(stream?.velocity?.[i]);
        if (Number.isFinite(v) && v > 0) metric = (1000 / v) / 60;
      }
    }
    if (!Number.isFinite(metric)) continue;
    points.push([metric, hrv]);
  }
  if (points.length <= 700) return points;
  const stride = Math.ceil(points.length / 700);
  return points.filter((_, i) => i % stride === 0);
}

async function loadActivityLabStreamActivities(tabActivity) {
  const tabDate = formatIsoDate(tabActivity.date || new Date().toISOString());
  const startDate = addDays(tabDate, -13);
  const endDate = tabDate;
  const mainType = activityMainType(tabActivity.activity_type);

  const local = state.activities.filter((a) => {
    const date = formatIsoDate(a.date);
    return date >= startDate
      && date <= endDate
      && activityMainType(a.activity_type) === mainType;
  });

  const byIdentity = new Map();
  local.forEach((a) => byIdentity.set(activityIdentity(a), a));
  byIdentity.set(activityIdentity(tabActivity), tabActivity);

  const settings = getSettings();
  const canLoadRemote = tabActivity.source !== "strava"
    && settings.athleteId
    && settings.apiKey;

  if (canLoadRemote) {
    const params = {
      label: "",
      activityType: "",
      startDate,
      endDate,
    };
    try {
      const mode = resolveApiMode(settings.apiMode);
      let remote;
      if (mode === "proxy") {
        try {
          remote = await runProxyActivitySearch(params, settings.athleteId, settings.apiKey);
        } catch (err) {
          if (!isAutoProxyMode(settings.apiMode)) throw err;
          remote = await runDirectActivitySearch(params, settings.athleteId, settings.apiKey);
        }
      } else {
        remote = await runDirectActivitySearch(params, settings.athleteId, settings.apiKey);
      }
      remote
        .filter((a) => activityMainType(a.activity_type) === mainType)
        .forEach((a) => byIdentity.set(activityIdentity(a), a));
    } catch (err) {
      if (!isAutoProxyMode(settings.apiMode)) {
        console.warn("Activity stream remote load failed:", err);
      }
    }
  }

  return [...byIdentity.values()].sort((a, b) => {
    const byDate = String(b.activity_start_local || b.date || "")
      .localeCompare(String(a.activity_start_local || a.date || ""));
    if (byDate !== 0) return byDate;
    return String(b.activity_id || "").localeCompare(String(a.activity_id || ""));
  });
}

/** Ranks state.activities by similarity `type` to `tabActivity`, always including the tab activity itself. */
async function loadActivityLabSimilarActivities(tabActivity, type, minScore) {
  const results = await findSimilarActivities(tabActivity, state.activities, {
    type,
    minScore,
    limit: 40,
  });
  const scores = {};
  results.forEach((r) => {
    scores[String(r.activity.activity_id || "")] = r.score;
  });
  const byIdentity = new Map();
  byIdentity.set(activityIdentity(tabActivity), tabActivity);
  results.forEach((r) => byIdentity.set(activityIdentity(r.activity), r.activity));
  return { activities: [...byIdentity.values()], scores };
}

/** Resolves the Activity Stream panel's list according to the current mode (recent, or one of the 3 similarity types). */
async function loadActivityLabStreamList(tabActivity) {
  const mode = state.activityLab.streamListMode || SIMILARITY_DEFAULT_TYPE;
  if (mode === "recent") {
    const activities = await loadActivityLabStreamActivities(tabActivity);
    return { activities, scores: {} };
  }
  const minScore = (Number(state.activityLab.streamMinScorePct) || 0) / 100;
  return loadActivityLabSimilarActivities(tabActivity, mode, minScore);
}

/** Syncs the Activity Stream mode dropdown + threshold slider inputs to state.activityLab. */
function syncActivityLabStreamControls() {
  const modeSelect = document.getElementById("activity-lab-stream-mode");
  const thresholdWrap = document.getElementById("activity-lab-stream-threshold-wrap");
  const thresholdInput = document.getElementById("activity-lab-stream-threshold");
  const thresholdValue = document.getElementById("activity-lab-stream-threshold-value");
  if (!modeSelect) return;
  const mode = state.activityLab.streamListMode || SIMILARITY_DEFAULT_TYPE;
  const pct = state.activityLab.streamMinScorePct || 80;
  modeSelect.value = mode;
  thresholdWrap.classList.toggle("hidden", mode === "recent");
  thresholdInput.value = String(pct);
  thresholdValue.textContent = `${pct}%`;
}

/** Reloads and re-renders the Activity Stream panel for the current mode, without disturbing the chart unless the focused activity drops out of the new list. */
async function refreshActivityLabStreamList() {
  const tabActivity = getActiveTabActivity();
  if (!tabActivity) return;
  const token = ++state.activityLab.requestToken;
  const { activities: streamActivities, scores } = await loadActivityLabStreamList(tabActivity);
  if (token !== state.activityLab.requestToken) return;
  state.activityLab.streamActivities = streamActivities;
  state.activityLab.streamScores = scores;
  const stillFocused = streamActivities.some(
    (a) => String(a.activity_id) === String(state.activityLab.focusActivityId)
  );
  if (!stillFocused) state.activityLab.focusActivityId = String(tabActivity.activity_id || "");
  renderActivityLabStreamList();
  if (!stillFocused) {
    const focusActivity = streamActivities.find(
      (a) => String(a.activity_id) === String(state.activityLab.focusActivityId)
    ) || tabActivity;
    await renderActivityLabFocus(tabActivity, focusActivity);
  }
}

async function loadWorkIntervals(activity) {
  const key = String(activity.activity_id || "");
  if (state.activityLab.workIntervalsByActivity[key]) {
    return state.activityLab.workIntervalsByActivity[key];
  }
  if (activity.source === "strava") {
    state.activityLab.workIntervalsByActivity[key] = [];
    return [];
  }

  const settings = getSettings();
  if (!settings.apiKey) {
    state.activityLab.workIntervalsByActivity[key] = [];
    return [];
  }
  const auth = `Basic ${btoa(`API_KEY:${settings.apiKey}`)}`;
  const res = await fetch(
    `https://intervals.icu/api/v1/activity/${encodeURIComponent(activity.activity_id)}/intervals`,
    { headers: { Authorization: auth, Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Intervals request failed (${res.status})`);
  const data = await res.json();
  const rawIntervals = Array.isArray(data?.icu_intervals) ? data.icu_intervals : [];
  const workIntervals = rawIntervals
    .filter((it) => Number(it?.moving_time || 0) > 0)
    .filter((it) => !["RECOVERY", "WARMUP", "COOLDOWN"].includes(String(it?.type || "").toUpperCase()))
    .map((it) => ({
      label: String(it.label || it.type || "Interval"),
      type: String(it.type || ""),
      duration: Number(it.moving_time || 0),
      startIndex: Number(it.start_index || 0),
      avgWatts: Number(it.average_watts || 0),
      avgHr: Number(it.average_heartrate || 0),
      maxHr: Number(it.max_heartrate || 0),
      zone: it.zone ?? null,
    }));
  state.activityLab.workIntervalsByActivity[key] = workIntervals;
  return workIntervals;
}

function renderWorkIntervalsList(workIntervals) {
  const node = document.getElementById("activity-lab-work-intervals");
  if (!workIntervals.length) {
    node.innerHTML = "No work intervals found for this activity.";
    return;
  }
  const rows = workIntervals.map((it) => `
    <tr>
      <td>${it.label || "-"}</td>
      <td>${it.type || "-"}</td>
      <td class="right">${formatSeconds(it.startIndex)}</td>
      <td class="right">${formatDuration(it.duration)}</td>
      <td class="right">${it.avgWatts ? Math.round(it.avgWatts) : "-"}</td>
      <td class="right">${it.avgHr ? Math.round(it.avgHr) : "-"}</td>
      <td class="right">${it.maxHr ? Math.round(it.maxHr) : "-"}</td>
      <td class="right">${it.zone ? `Z${it.zone}` : "-"}</td>
    </tr>
  `).join("");
  node.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Label</th>
            <th>Type</th>
            <th class="right">Start</th>
            <th class="right">Time</th>
            <th class="right">Avg W</th>
            <th class="right">Avg HR</th>
            <th class="right">Max HR</th>
            <th class="right">Zone</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderActivityLabPlaceholder(chartName, title, subtext) {
  const c = mkActivityLabChart(chartName);
  c.setOption({
    title: { text: title, subtext, top: 6, textStyle: { fontSize: 12 }, subtextStyle: { fontSize: 10 } },
    xAxis: { show: false },
    yAxis: { show: false },
    series: [],
  });
}

function computeElevationAxisBounds(points) {
  let values = points
    .map((p) => Number(p?.[1]))
    .filter((v) => Number.isFinite(v));
  if (!values.length) return {};

  const positiveValues = values.filter((v) => v > 0);
  if (positiveValues.length >= Math.max(3, values.length * 0.8)) {
    values = positiveValues;
  }

  if (values.length >= 8) {
    const sorted = [...values].sort((a, b) => a - b);
    const q1 = sorted[Math.floor((sorted.length - 1) * 0.25)];
    const q3 = sorted[Math.floor((sorted.length - 1) * 0.75)];
    const iqr = q3 - q1;
    if (iqr > 0) {
      const lowerFence = q1 - 1.5 * iqr;
      const upperFence = q3 + 1.5 * iqr;
      const inliers = values.filter((v) => v >= lowerFence && v <= upperFence);
      if (inliers.length >= Math.max(3, values.length * 0.8)) {
        values = inliers;
      }
    }
  }

  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 5;
    max += 5;
  }
  return { min: Math.floor(min), max: Math.ceil(max) };
}

function renderActivityLabTimeSeries(stream, focusActivity) {
  const time = Array.isArray(stream?.time) ? stream.time : [];
  const hr = sliceMetricStream(stream, stream?.heartrate, 0, Number.MAX_SAFE_INTEGER, (v) => Number(v));
  const pace = sliceMetricStream(
    stream,
    stream?.velocity,
    0,
    Number.MAX_SAFE_INTEGER,
    (v) => {
      const speed = Number(v);
      if (!Number.isFinite(speed) || speed <= 0) return null;
      const minPerKm = (1000 / speed) / 60;
      return minPerKm <= 20 ? minPerKm : null;
    }
  );
  const elevation = sliceMetricStream(stream, stream?.altitude, 0, Number.MAX_SAFE_INTEGER, (v) => Number(v));

  if (!time.length) {
    setGlucoseToggleVisible(false);
    renderActivityLabPlaceholder("lab-hr", "Heart rate, pace, elevation", "No stream data available");
    return;
  }

  const glucosePoints = getGlucosePointsForActivity(focusActivity);
  const hasGlucose = glucosePoints.length > 0;
  setGlucoseToggleVisible(hasGlucose);

  const hrState = state.activityLab.visibleSeries.hr || "off";
  const paceState = state.activityLab.visibleSeries.pace || "off";
  const elevationState = state.activityLab.visibleSeries.elevation || "off";
  const glucoseState = hasGlucose ? (state.activityLab.visibleSeries.glucose || "off") : "off";

  const showHr = hrState !== "off";
  const showPace = paceState !== "off" && pace.length > 0;
  const showElevation = elevationState !== "off" && elevation.length > 0;
  const showGlucose = glucoseState !== "off";

  const hrDimmed = hrState === "dimmed";
  const paceDimmed = paceState === "dimmed";
  const elevationDimmed = elevationState === "dimmed";
  const glucoseDimmed = glucoseState === "dimmed";

  const model = getSelectedZoneModel();
  const pieces = model ? model.hr_zones.map((upper, i) => {
    const lower = i === 0 ? 0 : model.hr_zones[i - 1];
    return {
      gte: lower,
      lt: upper,
      color: ZONE_COLORS[i + 1] || "#94a3b8",
      label: `Z${i + 1}`,
    };
  }).concat([{
    gte: model.hr_zones[model.hr_zones.length - 1],
    color: ZONE_COLORS[model.hr_zones.length] || "#ef4444",
    label: `Z${model.hr_zones.length}`,
  }]) : null;
  const yMin = 80;
  const elevationAxisOffset = showHr ? 42 : 0;
  const elevationAxisBounds = showElevation ? computeElevationAxisBounds(elevation) : {};
  const useHrZoneColors = !!pieces && showHr && !hrDimmed;

  // Build y-axes and series in tandem so each series' yAxisIndex/visualMap seriesIndex
  // always matches where it actually landed in the arrays below.
  const yAxisEntries = [{ type: "value", name: "bpm", min: yMin, show: showHr }];
  let paceAxisIndex = -1;
  let elevationAxisIndex = -1;
  let glucoseAxisIndex = -1;

  if (showPace) {
    paceAxisIndex = yAxisEntries.length;
    yAxisEntries.push({
      type: "value",
      name: "min/km",
      position: "right",
      offset: 0,
      alignTicks: true,
      inverse: true,
      max: 20,
      axisLabel: { formatter: (v) => formatPaceMinutes(v) },
    });
  }
  if (showElevation) {
    elevationAxisIndex = yAxisEntries.length;
    yAxisEntries.push({
      type: "value",
      name: "m",
      position: "left",
      offset: elevationAxisOffset,
      ...elevationAxisBounds,
      axisLabel: { formatter: (v) => Math.round(v) },
      splitLine: { show: false },
    });
  }
  if (showGlucose) {
    glucoseAxisIndex = yAxisEntries.length;
    yAxisEntries.push({
      type: "value",
      name: "mg/dL",
      position: "right",
      offset: showPace ? 58 : 0,
      min: GLUCOSE_AXIS_MIN,
      max: GLUCOSE_AXIS_MAX,
      axisLabel: { formatter: (v) => Math.round(v) },
      splitLine: { show: false },
    });
  }

  const seriesEntries = [];
  let hrSeriesIndex = -1;
  let glucoseSeriesIndex = -1;

  if (showHr) {
    hrSeriesIndex = seriesEntries.length;
    seriesEntries.push({
      type: "line",
      name: "HR",
      smooth: true,
      showSymbol: false,
      z: 3,
      lineStyle: {
        width: 1,
        ...(hrDimmed ? { color: SERIES_DIMMED_COLOR } : (useHrZoneColors ? {} : { color: "#ef4444" })),
      },
      itemStyle: hrDimmed
        ? { color: SERIES_DIMMED_COLOR }
        : (useHrZoneColors ? undefined : { color: "#ef4444" }),
      areaStyle: {
        opacity: hrDimmed ? 0.06 : 0.16,
        ...(hrDimmed ? { color: SERIES_DIMMED_COLOR } : {}),
      },
      data: hr,
    });
  }
  if (showPace) {
    seriesEntries.push({
      type: "line",
      name: "Pace",
      yAxisIndex: paceAxisIndex,
      smooth: true,
      showSymbol: false,
      z: 2,
      lineStyle: { width: 1, ...(paceDimmed ? { color: SERIES_DIMMED_COLOR, opacity: 0.6 } : {}) },
      data: pace,
    });
  }
  if (showElevation) {
    seriesEntries.push({
      type: "line",
      name: "Elevation",
      yAxisIndex: elevationAxisIndex,
      smooth: true,
      showSymbol: false,
      z: 0,
      lineStyle: { width: 0.5, color: "#64748b", opacity: elevationDimmed ? 0.2 : 0.45 },
      areaStyle: { color: "#64748b", opacity: elevationDimmed ? 0.05 : 0.16 },
      data: elevation,
    });
  }
  if (showGlucose) {
    glucoseSeriesIndex = seriesEntries.length;
    seriesEntries.push({
      type: "line",
      name: "Glucose",
      yAxisIndex: glucoseAxisIndex,
      smooth: true,
      showSymbol: false,
      z: 1,
      lineStyle: { width: 1.5, ...(glucoseDimmed ? { color: SERIES_DIMMED_COLOR } : {}) },
      data: glucosePoints,
    });
  }

  const visualMapEntries = [];
  if (useHrZoneColors) {
    visualMapEntries.push({ show: false, type: "piecewise", dimension: 1, seriesIndex: hrSeriesIndex, pieces });
  }
  if (showGlucose && !glucoseDimmed) {
    visualMapEntries.push({
      show: false,
      type: "piecewise",
      dimension: 1,
      seriesIndex: glucoseSeriesIndex,
      pieces: buildGlucoseColorPieces(),
    });
  }

  const rightAxisCount = (showPace ? 1 : 0) + (showGlucose ? 1 : 0);
  const gridRight = rightAxisCount === 0 ? 16 : rightAxisCount === 1 ? 58 : 100;

  const hrChart = mkActivityLabChart("lab-hr");
  hrChart.setOption({
    title: {
      text: "Heart rate, pace, elevation" + (showGlucose ? ", glucose" : ""),
      subtext: `${focusActivity.date || ""} · ${focusActivity.activity_name || ""} · pace from velocity_smooth`,
      top: 6,
      textStyle: { fontSize: 12 },
      subtextStyle: { fontSize: 10 },
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const lines = [`${Number(params[0]?.value?.[0] || 0).toFixed(1)} min`];
        for (const p of params) {
          if (p.seriesName === "HR") lines.push(`HR ${Math.round(p.value[1])} bpm`);
          else if (p.seriesName === "Pace") lines.push(`Pace ${formatPaceMinutes(p.value[1])} min/km`);
          else if (p.seriesName === "Elevation") lines.push(`Elevation ${Math.round(p.value[1])} m`);
          else if (p.seriesName === "Glucose") lines.push(`Glucose ${Math.round(p.value[1])} mg/dL`);
        }
        return lines.join(" · ");
      },
    },
    ...(visualMapEntries.length ? { visualMap: visualMapEntries } : {}),
    grid: { left: showElevation ? 58 : showHr ? 42 : 16, right: gridRight, top: 52, bottom: 28 },
    xAxis: { type: "value", name: "min" },
    yAxis: yAxisEntries,
    series: seriesEntries,
  });
}

async function renderActivityLabScatter(tabActivity) {
  const settings = getSettings();
  const scatter = mkActivityLabChart("lab-scatter");
  scatter.setOption({
    title: { text: "HR vs Pace / GAP / Watts", top: 6, textStyle: { fontSize: 12 } },
    xAxis: { show: false },
    yAxis: { show: false },
    series: [],
  });
  const historyPoints = [];
  const currentPacePoints = [];
  const currentPowerPoints = [];
  for (const activity of state.activityLab.streamActivities) {
    if (!activity?.activity_id) continue;
    try {
      const stream = await fetchHrStream(activity.activity_id, settings, activity.source || "intervals");
      const pacePts = buildFullMetricPoints(stream, "pace");
      const powerPts = buildFullMetricPoints(stream, "watts");
      if (String(activity.activity_id) === String(tabActivity.activity_id)) {
        currentPacePoints.push(...pacePts);
        currentPowerPoints.push(...powerPts);
      } else {
        historyPoints.push(...pacePts.slice(0, 120));
      }
    } catch (err) {
      if (!String(err?.message || "").includes("No stream data available")) {
        console.warn("Scatter stream load failed:", err);
      }
    }
  }
  const showValues = false;
  scatter.setOption({
    legend: { top: 28, textStyle: { fontSize: 11 } },
    tooltip: {
      formatter: (p) => `${p.seriesName}<br>X: ${Number(p.value[0]).toFixed(2)}<br>HR: ${Math.round(p.value[1])} bpm`,
    },
    grid: { left: 44, right: 16, top: 68, bottom: 32 },
    xAxis: { type: "value", name: "Pace (min/km) / Power (W)" },
    yAxis: { type: "value", name: "HR (bpm)" },
    series: [
      {
        type: "scatter",
        name: "History (pace/gap)",
        symbolSize: 7,
        itemStyle: { color: "#64748b" },
        label: chartLabelOpt(showValues, (p) => `${p.value[0].toFixed(2)}, ${Math.round(p.value[1])}`),
        data: historyPoints,
      },
      {
        type: "scatter",
        name: "This activity pace/gap",
        symbolSize: 9,
        itemStyle: { color: "#22c55e" },
        label: chartLabelOpt(showValues, (p) => formatPaceMinutes(p.value[0])),
        data: currentPacePoints,
      },
      {
        type: "scatter",
        name: "This activity watts",
        symbolSize: 9,
        itemStyle: { color: "#f59e0b" },
        label: chartLabelOpt(showValues, (p) => Math.round(p.value[0])),
        data: currentPowerPoints,
      },
    ],
  });
}

async function renderActivityLabFocus(tabActivity, focusActivity, forceRefresh = false) {
  renderActivityDetail(tabActivity, focusActivity);
  updateActivityLabValueToggleButtons();
  setGlucoseToggleVisible(false);
  renderActivityLabPlaceholder("lab-hr", "Heart rate + pace stream", "Loading streams…");
  try {
    const settings = getSettings();
    const stream = await fetchHrStream(
      focusActivity.activity_id,
      settings,
      focusActivity.source || "intervals",
      "",
      forceRefresh
    );
    renderActivityLabTimeSeries(stream, focusActivity);
  } catch (err) {
    const detail = String(err?.message || "Unknown stream error");
    setGlucoseToggleVisible(false);
    renderActivityLabPlaceholder("lab-hr", "Heart rate, pace, elevation", detail);
  }
  try {
    const workIntervals = await loadWorkIntervals(focusActivity);
    state.activityLab.workIntervals = workIntervals;
    renderWorkIntervalsList(workIntervals);
  } catch (err) {
    document.getElementById("activity-lab-work-intervals").textContent =
      `Failed to load work intervals: ${err.message}`;
  }
}

async function openActivityLab(tabActivity, options = {}) {
  const token = ++state.activityLab.requestToken;
  state.activityLab.tabActivityId = String(tabActivity.activity_id || "");
  state.activityLab.focusActivityId = String(options.focusActivityId || tabActivity.activity_id || "");
  if (!options.keepStreamMode) {
    state.activityLab.streamListMode = SIMILARITY_DEFAULT_TYPE;
    state.activityLab.streamMinScorePct = 80;
  }
  syncActivityLabStreamControls();
  setScreen("activity-detail");
  const { activities: streamActivities, scores } = await loadActivityLabStreamList(tabActivity);
  if (token !== state.activityLab.requestToken) return;
  state.activityLab.streamActivities = streamActivities;
  state.activityLab.streamScores = scores;
  if (!streamActivities.some((a) => String(a.activity_id) === String(state.activityLab.focusActivityId))) {
    state.activityLab.focusActivityId = String(tabActivity.activity_id || "");
  }
  renderActivityLabStreamList();
  const focusActivity = streamActivities.find(
    (a) => String(a.activity_id) === String(state.activityLab.focusActivityId)
  ) || tabActivity;
  await renderActivityLabFocus(tabActivity, focusActivity, !!options.forceRefresh);
}

function getActiveTabActivity() {
  const active = state.openActivityTabs.find((t) => t.id === state.activeActivityTabId);
  return active ? active.activity : null;
}

function openActivityTab(activity) {
  const id = String(activity.activity_id || activity.date || Math.random());
  const existing = state.openActivityTabs.find((t) => t.id === id);
  if (!existing) {
    state.openActivityTabs.push({ id, activity });
  } else {
    existing.activity = activity;
  }
  state.activeActivityTabId = id;
  renderActivityTabBar();
  openActivityLab(activity);
}

function closeActivityTab(id) {
  const idx = state.openActivityTabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  state.openActivityTabs.splice(idx, 1);

  if (state.activeActivityTabId === id) {
    if (state.openActivityTabs.length > 0) {
      const next = state.openActivityTabs[Math.max(0, idx - 1)];
      state.activeActivityTabId = next.id;
      renderActivityTabBar();
      openActivityLab(next.activity);
    } else {
      state.activeActivityTabId = null;
      renderActivityTabBar();
      setScreen("activities");
    }
  } else {
    renderActivityTabBar();
  }
}


function renderIntervals() {
  const body = document.getElementById("intervals-body");
  body.innerHTML = "";
  if (state.intervalsGrouped) {
    renderGroupedIntervals(body);
  } else {
    state.filtered.forEach((item) => body.appendChild(renderIntervalRow(item)));
  }
  document.getElementById("result-summary").textContent = `${state.filtered.length} intervals`;
  document.getElementById("selected-count").textContent = `${state.selected.size} selected`;
  const groupBtn = document.getElementById("group-intervals");
  if (groupBtn) {
    groupBtn.classList.toggle("is-active", state.intervalsGrouped);
    groupBtn.setAttribute("aria-pressed", String(state.intervalsGrouped));
    groupBtn.textContent = state.intervalsGrouped ? "Ungroup" : "Group";
  }
  body.querySelectorAll("input[data-select-id]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-select-id");
      if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
      document.getElementById("selected-count").textContent = `${state.selected.size} selected`;
    });
  });
  body.querySelectorAll("[data-group-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.groupToggle;
      if (!key) return;
      if (state.collapsedIntervalGroups.has(key)) {
        state.collapsedIntervalGroups.delete(key);
      } else {
        state.collapsedIntervalGroups.add(key);
      }
      renderIntervals();
    });
  });
}

function renderIntervalRow(item, groupKey = "") {
  const id = String(item.interval_id);
  const z  = item.zone;
  const source = item.source || "intervals";
  const sourceIcon = source === "strava"
    ? '<span style="color:#f59e0b;font-weight:700">S</span>'
    : '<span style="color:#ef4444;font-weight:700">I</span>';
  const sourceLabel = source === "strava" ? "Strava" : "Intervals.icu";
  const tr = document.createElement("tr");
  if (groupKey) tr.className = "interval-child-row";
  tr.innerHTML = `
    <td class="center"><input type="checkbox" data-select-id="${id}" ${state.selected.has(id) ? "checked" : ""} /></td>
    <td class="center" title="${sourceLabel}">${sourceIcon}</td>
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
  return tr;
}

function intervalGroupName(item) {
  return String(item.label || item.interval_type || item.activity_name || "Unnamed interval").trim()
    || "Unnamed interval";
}

function intervalGroupKey(name) {
  return encodeURIComponent(name.toLowerCase());
}

function averageMetric(items, field) {
  const values = items
    .map((item) => Number(item[field]))
    .filter((value) => Number.isFinite(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function uniqueDisplayValue(items, field) {
  const values = [...new Set(items.map((item) => String(item[field] || "").trim()).filter(Boolean))];
  if (!values.length) return "-";
  return values.length === 1 ? values[0] : "Mixed";
}

function groupDateRange(items) {
  const dates = items.map((item) => String(item.date || "").slice(0, 10)).filter(Boolean).sort();
  if (!dates.length) return "-";
  return dates[0] === dates[dates.length - 1] ? dates[0] : `${dates[0]}..${dates[dates.length - 1]}`;
}

function averageZone(items) {
  const avg = averageMetric(items, "zone");
  if (avg === null || avg <= 0) return "-";
  return `Z${avg.toFixed(1)}`;
}

function renderGroupedIntervals(body) {
  const groups = new Map();
  for (const item of state.filtered) {
    const name = intervalGroupName(item);
    const key = intervalGroupKey(name);
    if (!groups.has(key)) groups.set(key, { key, name, items: [] });
    groups.get(key).items.push(item);
  }
  const sortedGroups = [...groups.values()].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    if (byName !== 0) return byName;
    return groupDateRange(a.items).localeCompare(groupDateRange(b.items));
  });

  sortedGroups.forEach((group) => {
    const items = [...group.items].sort(compareIntervalsChronologically);
    const collapsed = state.collapsedIntervalGroups.has(group.key);
    const groupRow = document.createElement("tr");
    groupRow.className = "interval-group-row";
    const avgTime = averageMetric(items, "moving_time_s");
    const avgWatts = averageMetric(items, "avg_watts");
    const avgWattsKg = averageMetric(items, "avg_watts_kg");
    const avgHr = averageMetric(items, "avg_hr");
    const avgMaxHr = averageMetric(items, "max_hr");
    const avgLoad = averageMetric(items, "training_load");
    const avgDecoupling = averageMetric(items, "decoupling");
    groupRow.innerHTML = `
      <td class="center">
        <button class="interval-group-toggle" type="button" data-group-toggle="${group.key}" aria-label="${collapsed ? "Expand" : "Collapse"} ${group.name}">
          ${collapsed ? "▸" : "▾"}
        </button>
      </td>
      <td class="center interval-group-muted">-</td>
      <td>${groupDateRange(items)}</td>
      <td>${uniqueDisplayValue(items, "activity_type")}</td>
      <td class="interval-group-muted">Average</td>
      <td class="interval-group-name">${group.name} (${items.length})</td>
      <td class="right">${avgTime === null ? "-" : formatSeconds(avgTime)}</td>
      <td class="right">${avgWatts === null ? "-" : Math.round(avgWatts)}</td>
      <td class="right">${avgWattsKg === null ? "-" : avgWattsKg.toFixed(2)}</td>
      <td class="right">${avgHr === null ? "-" : Math.round(avgHr)}</td>
      <td class="right">${avgMaxHr === null ? "-" : Math.round(avgMaxHr)}</td>
      <td class="right">${avgLoad === null ? "-" : avgLoad.toFixed(1)}</td>
      <td class="right">${averageZone(items)}</td>
      <td class="right">${avgDecoupling === null ? "-" : `${avgDecoupling.toFixed(1)}%`}</td>
    `;
    body.appendChild(groupRow);
    if (!collapsed) {
      items.forEach((item) => body.appendChild(renderIntervalRow(item, group.key)));
    }
  });
}

