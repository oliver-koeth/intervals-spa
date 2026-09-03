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

function formatElevation(meters) {
  if (!meters) return "-";
  return `${Math.round(meters)} m`;
}

function formatAvgPace(movingTimeS, distanceM) {
  const secs = Number(movingTimeS || 0);
  const meters = Number(distanceM || 0);
  if (secs <= 0 || meters <= 0) return "-";
  const minPerKm = (secs / 60) / (meters / 1000);
  return `${formatPaceMinutes(minPerKm)} /km`;
}

/* Cycling activities are conventionally measured in speed (km/h), not pace
 * (min/km). Used to switch the pace label/value for Ride-type activities. */
function isBikeActivityType(type) {
  const t = String(type || "").toLowerCase();
  return /(^|_)(ride|cycl|bike|gravel|mountain|virtualride|ebike|handcycle)/.test(t);
}

function formatAvgSpeed(movingTimeS, distanceM) {
  const secs = Number(movingTimeS || 0);
  const meters = Number(distanceM || 0);
  if (secs <= 0 || meters <= 0) return "-";
  const kmh = (meters / 1000) / (secs / 3600);
  return `${kmh.toFixed(1)} km/h`;
}

/* Label + value for the "average speed/pace" metric, picking speed (km/h) for
 * bike activities and pace (min/km) for everything else. */
function avgPaceOrSpeedField(activity) {
  if (isBikeActivityType(activity.activity_type)) {
    return { label: "Avg Speed", value: formatAvgSpeed(activity.moving_time_s, activity.distance_m) };
  }
  return { label: "Avg Pace", value: formatAvgPace(activity.moving_time_s, activity.distance_m) };
}

function getActivityIndexLabel(index) {
  if (index < 9) return String(index + 1);
  return String.fromCharCode(65 + (index - 9));
}

/* Collapsible "Activity Stream" panel on the activity-detail screen. Defaults
 * to collapsed so the chart/detail area gets the most width; state persists
 * across visits via localStorage. */
function initActivityLabStreamToggle() {
  const card = document.getElementById("activity-lab-stream-card");
  const toggle = document.getElementById("activity-lab-stream-toggle");
  const layout = document.querySelector(".activity-lab-layout");
  if (!card || !toggle || !layout) return;

  const applyCollapsed = (collapsed) => {
    card.classList.toggle("collapsed", collapsed);
    layout.classList.toggle("stream-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    toggle.setAttribute("aria-label", collapsed ? "Expand activity stream" : "Collapse activity stream");
    const icon = toggle.querySelector("sl-icon");
    if (icon) icon.name = collapsed ? "chevron-right" : "chevron-left";
  };

  const stored = localStorage.getItem("activity-lab-stream-collapsed");
  // Default to collapsed unless the user has explicitly expanded it before.
  applyCollapsed(stored !== "false");

  toggle.addEventListener("click", () => {
    const collapsed = card.classList.toggle("collapsed");
    applyCollapsed(collapsed);
    localStorage.setItem("activity-lab-stream-collapsed", collapsed ? "true" : "false");
  });
}

function renderActivitiesSidebar(hostId) {
  const list = document.getElementById(hostId);
  if (!list) return;
  list.innerHTML = "";
  const activeId = state.activeActivityTabId;
  const collapsed = document.querySelector("#sidebar.collapsed") != null;
  state.openActivityTabs.forEach(({ id, activity }, index) => {
    const btn = document.createElement("button");
    btn.className = "btn activities-sidebar-item" + (id === activeId ? " active" : "");
    btn.type = "button";
    btn.dataset.tabId = id;
    const label = activity.date || id;
    btn.title = activity.activity_name ? `${activity.date} — ${activity.activity_name}` : activity.date;
    btn.innerHTML = `<span class="activities-sidebar-label">${collapsed ? getActivityIndexLabel(index) : label}</span>`
      + `<span class="activities-sidebar-close" data-close-tab="${id}" title="Close">×</span>`;
    list.appendChild(btn);
  });
}

function updateActivitiesSidebars() {
  const hasTabs = state.openActivityTabs.length > 0;
  const onActivities = state.screen === "activities";
  const onDetail = state.screen === "activity-detail";
  const activitiesSidebar = document.getElementById("activities-sidebar");
  const detailSidebar = document.getElementById("activity-detail-sidebar");
  if (activitiesSidebar) activitiesSidebar.classList.toggle("hidden", !(onActivities && hasTabs));
  if (detailSidebar) detailSidebar.classList.toggle("hidden", !onDetail);
  if (onActivities || onDetail) renderActivitiesSidebar("activities-sidebar-list");
  if (onDetail) renderActivitiesSidebar("activity-detail-sidebar-list");
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
    avgPaceOrSpeedField(activity),
    { label: "Avg HR", value: activity.avg_hr ? `${Math.round(activity.avg_hr)} bpm` : "-" },
    { label: "Load", value: activity.training_load != null ? Math.round(activity.training_load) : "-" },
    { label: "Tag", value: activity.is_race
      ? '<span class="activity-race-flag" title="Race">Race</span>'
      : activity.has_workout
        ? '<span class="activity-workout-flag" title="Structured workout">Workout</span>'
        : "-" },
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
    const seriesState = key === "elevation" ? "dimmed" : (state.activityLab.visibleSeries[key] || "on");
    btn.classList.toggle("is-active", seriesState === "on");
    btn.classList.toggle("is-dimmed", seriesState === "dimmed");
    btn.classList.toggle("is-fixed", key === "elevation");
    btn.setAttribute("aria-pressed", seriesState === "on" ? "true" : seriesState === "dimmed" ? "mixed" : "false");
    btn.setAttribute("aria-disabled", key === "elevation" ? "true" : "false");
    btn.title = key === "elevation"
      ? "Elevation is always shown in grey"
      : `${key}: ${seriesState === "on" ? "colour" : "grey"} (click to toggle)`;
  });
}

function setActivityLabToggleVisible(key, visible) {
  const btn = document.querySelector(`.activity-lab-series-toggle[data-activity-lab-label="${key}"]`);
  if (btn) btn.classList.toggle("hidden", !visible);
}

/** Shows/hides the glucose series toggle button — it only ever appears when glucose data exists. */
function setGlucoseToggleVisible(visible) {
  setActivityLabToggleVisible("glucose", visible);
}

function setExtraStreamTogglesVisible(visibility) {
  ["gap", "power", "cadence"].forEach((key) => setActivityLabToggleVisible(key, !!visibility?.[key]));
}

function streamNeedsEnhancedRefresh(stream) {
  return stream?.__enhanced_streams_loaded !== true
    || ["watts", "gap", "cadence"].some((key) => !Array.isArray(stream?.[key]));
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

/* ─── Planned workout (paired intervals.icu Event) ──────────────────────── */
/* Default zone-boundary heuristics used only when a workout step's target isn't already
   an explicit zone number. These mirror intervals.icu's own stock defaults (Coggan power
   zones by %FTP, analogous %LTHR HR bands, %threshold-pace run bands) and are a best-effort
   fallback — athlete-specific HR zones (getSelectedZoneModel()) are preferred when usable. */
const WORKOUT_POWER_PCT_FTP_BOUNDS = [55, 75, 90, 105];        // Z1<55 Z2 55-75 Z3 75-90 Z4 90-105 Z5>105
const WORKOUT_HR_PCT_LTHR_BOUNDS = [81, 89, 93, 99];           // Z1<81 Z2 81-89 Z3 90-93 Z4 94-99 Z5>=100
const WORKOUT_PACE_PCT_THRESHOLD_BOUNDS = [129, 114, 106, 100]; // %threshold time; higher % = slower = lower zone

function clampWorkoutZone(z) {
  return Math.max(1, Math.min(5, Math.round(z)));
}

function workoutZoneFromAscendingBounds(value, bounds) {
  for (let i = 0; i < bounds.length; i++) {
    if (value < bounds[i]) return i + 1;
  }
  return bounds.length + 1;
}

function workoutZoneFromDescendingBounds(value, bounds) {
  for (let i = 0; i < bounds.length; i++) {
    if (value > bounds[i]) return i + 1;
  }
  return bounds.length + 1;
}

/** Resolve a single workout step's effort zone (1-5) regardless of whether its target is
 *  power, HR, or pace based. Returns null when the step carries no usable target. */
function computeWorkoutStepZone(step, ftpWatts) {
  const target = step?.power || step?.hr || step?.pace;
  if (!target) return null;
  const units = String(target.units || "").toLowerCase();
  const start = Number(target.start ?? target.value);
  const end = Number(target.end ?? target.value ?? start);
  const mid = Number.isFinite(start) && Number.isFinite(end) ? (start + end) / 2 : NaN;
  if (!Number.isFinite(mid)) return null;

  if (units.includes("zone")) return clampWorkoutZone(mid);

  if (step.power) {
    if (units.includes("watt") || units === "w") {
      if (!(ftpWatts > 0)) return null;
      return clampWorkoutZone(workoutZoneFromAscendingBounds((mid / ftpWatts) * 100, WORKOUT_POWER_PCT_FTP_BOUNDS));
    }
    return clampWorkoutZone(workoutZoneFromAscendingBounds(mid, WORKOUT_POWER_PCT_FTP_BOUNDS));
  }

  if (step.hr) {
    const model = getSelectedZoneModel();
    if (units.includes("bpm") || units === "hr") {
      if (!model) return null;
      return clampWorkoutZone(workoutZoneFromAscendingBounds(mid, model.hr_zones));
    }
    if (model && model.lthr) {
      const bpm = (mid * model.lthr) / 100;
      return clampWorkoutZone(workoutZoneFromAscendingBounds(bpm, model.hr_zones));
    }
    return clampWorkoutZone(workoutZoneFromAscendingBounds(mid, WORKOUT_HR_PCT_LTHR_BOUNDS));
  }

  if (step.pace) {
    if (units.includes("secs") || units.includes("min")) return null; // absolute pace, no threshold reference
    return clampWorkoutZone(workoutZoneFromDescendingBounds(mid, WORKOUT_PACE_PCT_THRESHOLD_BOUNDS));
  }
  return null;
}

/** Flatten workout_doc steps (expanding repeat blocks) into a chronological list of
 *  {startSec, durationSec, zone, text} leaf segments covering the full planned duration. */
function flattenWorkoutSteps(steps, ftpWatts, offsetRef) {
  const out = [];
  for (const step of steps || []) {
    const childSteps = Array.isArray(step?.steps) ? step.steps : null;
    const reps = Math.max(1, Number(step?.reps) || 1);
    if (childSteps && childSteps.length) {
      for (let r = 0; r < reps; r++) {
        out.push(...flattenWorkoutSteps(childSteps, ftpWatts, offsetRef));
      }
      continue;
    }
    const durationSec = Number(step?.duration) || 0;
    if (durationSec > 0) {
      out.push({
        startSec: offsetRef.value,
        durationSec,
        zone: computeWorkoutStepZone(step, ftpWatts),
        text: String(step?.text || "").trim(),
      });
    }
    offsetRef.value += durationSec;
  }
  return out;
}

function buildPlannedWorkoutView(event) {
  const rawSteps = Array.isArray(event?.workout_doc?.steps) ? event.workout_doc.steps : [];
  const ftpWatts = Number(event?.icu_ftp) || 0;
  const segments = flattenWorkoutSteps(rawSteps, ftpWatts, { value: 0 });
  if (!segments.length) return null;
  const totalDurationSec = segments.reduce((sum, s) => sum + s.durationSec, 0);
  return {
    eventId: event.id,
    name: String(event.name || "Planned workout"),
    description: String(event.description || ""),
    timeSec: Number(event.moving_time) || totalDurationSec,
    load: event.icu_training_load != null ? Number(event.icu_training_load) : null,
    intensity: event.icu_intensity != null ? Number(event.icu_intensity) : null,
    segments,
    totalDurationSec,
  };
}

/** Loads (and caches) the planned workout paired with an executed activity, if any.
 *  Returns null when there is no paired event, no structured workout_doc, or the
 *  request cannot be made (no credentials, Strava-only activity, network error). */
async function loadPlannedWorkout(activity) {
  const key = String(activity?.activity_id || "");
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(state.activityLab.plannedWorkoutByActivity, key)) {
    return state.activityLab.plannedWorkoutByActivity[key];
  }
  if ((activity.source || "intervals") !== "intervals") {
    state.activityLab.plannedWorkoutByActivity[key] = null;
    return null;
  }
  const settings = getSettings();
  if (!settings.apiKey || !settings.athleteId) return null; // don't cache — settings may arrive later

  const auth = `Basic ${btoa(`API_KEY:${settings.apiKey}`)}`;
  let result = null;
  try {
    const activityRes = await fetch(
      `https://intervals.icu/api/v1/activity/${encodeURIComponent(key)}`,
      { headers: { Authorization: auth, Accept: "application/json" } }
    );
    if (activityRes.ok) {
      const activityDetail = await activityRes.json();
      const eventId = activityDetail?.paired_event_id;
      if (eventId != null) {
        const eventRes = await fetch(
          `https://intervals.icu/api/v1/athlete/${encodeURIComponent(settings.athleteId)}/events/${encodeURIComponent(eventId)}?resolve=true`,
          { headers: { Authorization: auth, Accept: "application/json" } }
        );
        if (eventRes.ok) {
          const event = await eventRes.json();
          result = buildPlannedWorkoutView(event);
        }
      }
    }
  } catch {
    result = null;
  }
  state.activityLab.plannedWorkoutByActivity[key] = result;
  return result;
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

/** Renders (or hides) the planned-workout diagram directly below the main HR/pace chart.
 *  sharedXMax/gridLeft/gridRight are taken from the main chart so both x-axes align in
 *  pixel space even when the planned workout is shorter or longer than the activity. */
function renderPlannedWorkoutChart(plannedWorkout, sharedXMax, gridLeft, gridRight) {
  const card = document.getElementById("activity-lab-workout-card");
  if (!card) return;
  if (!plannedWorkout || !plannedWorkout.segments.length) {
    card.classList.add("hidden");
    if (state.activityLabCharts["lab-workout"]) {
      state.activityLabCharts["lab-workout"].dispose();
      delete state.activityLabCharts["lab-workout"];
    }
    return;
  }
  card.classList.remove("hidden");

  document.getElementById("activity-lab-workout-title").textContent = plannedWorkout.name;
  document.getElementById("activity-lab-workout-time").textContent = formatSeconds(plannedWorkout.timeSec);
  document.getElementById("activity-lab-workout-load").textContent =
    plannedWorkout.load != null ? Math.round(plannedWorkout.load) : "-";
  document.getElementById("activity-lab-workout-intensity").textContent =
    // icu_intensity from intervals.icu is already a percentage (e.g. 74.69 => "75%"),
    // not a 0-1 fraction — do not multiply by 100 again.
    plannedWorkout.intensity != null ? `${Math.round(plannedWorkout.intensity)}%` : "-";
  const descEl = document.getElementById("activity-lab-workout-description");
  descEl.textContent = plannedWorkout.description || "No description provided.";
  descEl.classList.add("hidden");
  const detailsBtn = document.getElementById("activity-lab-workout-details-toggle");
  if (detailsBtn) detailsBtn.textContent = "Details";

  const workoutDurationMin = plannedWorkout.totalDurationSec / 60;
  const xMax = Math.max(Number(sharedXMax) || 0, workoutDurationMin, 1);

  const data = plannedWorkout.segments.map((seg) => ({
    value: [seg.startSec / 60, (seg.startSec + seg.durationSec) / 60, seg.zone || 1],
    itemStyle: { color: seg.zone ? WORKOUT_ZONE_COLORS[seg.zone] : SERIES_DIMMED_COLOR },
  }));

  const chart = mkActivityLabChart("lab-workout");
  chart.setOption({
    tooltip: {
      trigger: "item",
      formatter: (p) => {
        const seg = plannedWorkout.segments[p.dataIndex];
        const zoneLabel = seg.zone ? `Z${seg.zone}` : "–";
        const label = seg.text ? `${seg.text} · ` : "";
        return `${label}${zoneLabel} · ${formatSeconds(seg.durationSec)}`;
      },
    },
    grid: { left: gridLeft, right: gridRight, top: 8, bottom: 20 },
    xAxis: {
      type: "value", name: "min", min: 0, max: xMax,
      // Suppress the auto-injected label at the exact (often non-round) max value,
      // e.g. "57.4166666666664" — keep only the nice interval-based tick labels.
      axisLabel: { showMaxLabel: false },
    },
    yAxis: { type: "value", show: false, min: 0, max: 5.4 },
    series: [{
      type: "custom",
      renderItem: (params, api) => {
        const start = api.coord([api.value(0), 0]);
        const end = api.coord([api.value(1), api.value(2)]);
        const rectShape = echarts.graphic.clipRectByRect(
          { x: start[0], y: end[1], width: end[0] - start[0], height: start[1] - end[1] },
          { x: params.coordSys.x, y: params.coordSys.y, width: params.coordSys.width, height: params.coordSys.height }
        );
        return rectShape && { type: "rect", shape: rectShape, style: api.style() };
      },
      encode: { x: [0, 1], y: 2 },
      data,
    }],
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

/** Extract the standard set of Activity Lab metric series from a raw stream object.
 *  Shared by the main chart renderer and the Strava-tile exporter so both draw from
 *  identical data. */
function computeActivityLabStreamSeries(stream) {
  const hr = sliceMetricStream(stream, stream?.heartrate, 0, Number.MAX_SAFE_INTEGER, (v) => Number(v));
  const gap = sliceMetricStream(stream, stream?.gap, 0, Number.MAX_SAFE_INTEGER, normalizeExplicitPaceValue);
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
  const power = sliceMetricStream(stream, stream?.watts, 0, Number.MAX_SAFE_INTEGER, (v) => {
    const watts = Number(v);
    return Number.isFinite(watts) && watts > 0 ? watts : null;
  });
  const cadence = sliceMetricStream(stream, stream?.cadence, 0, Number.MAX_SAFE_INTEGER, (v) => {
    const rpm = Number(v);
    return Number.isFinite(rpm) && rpm > 0 ? rpm : null;
  });
  const elevation = sliceMetricStream(stream, stream?.altitude, 0, Number.MAX_SAFE_INTEGER, (v) => Number(v));
  return { hr, gap, pace, power, cadence, elevation };
}

function renderActivityLabTimeSeries(stream, focusActivity, plannedWorkout = null) {
  const time = Array.isArray(stream?.time) ? stream.time : [];
  const { hr, gap, pace, power, cadence, elevation } = computeActivityLabStreamSeries(stream);
  state.activityLab.lastTileSnapshot = { focusActivity, hr, pace, cadence, plannedWorkout, hasStream: time.length > 0 };

  if (!time.length) {
    setGlucoseToggleVisible(false);
    setExtraStreamTogglesVisible({ gap: false, power: false, cadence: false });
    renderActivityLabPlaceholder("lab-hr", "Heart rate, pace, GAP, power, cadence, elevation", "No stream data available");
    renderPlannedWorkoutChart(plannedWorkout, 0, 16, 16);
    return;
  }

  const glucosePoints = getGlucosePointsForActivity(focusActivity);
  const hasGlucose = glucosePoints.length > 0;
  setGlucoseToggleVisible(hasGlucose);

  const hrState = state.activityLab.visibleSeries.hr === "dimmed" ? "dimmed" : "on";
  const paceState = state.activityLab.visibleSeries.pace === "dimmed" ? "dimmed" : "on";
  const gapState = state.activityLab.visibleSeries.gap === "dimmed" ? "dimmed" : "on";
  const powerState = state.activityLab.visibleSeries.power === "dimmed" ? "dimmed" : "on";
  const cadenceState = state.activityLab.visibleSeries.cadence === "dimmed" ? "dimmed" : "on";
  const elevationState = "dimmed";
  const glucoseState = hasGlucose
    ? (state.activityLab.visibleSeries.glucose === "dimmed" ? "dimmed" : "on")
    : "off";

  const showHr = hr.length > 0;
  const showPace = pace.length > 0;
  const showGap = gap.length > 0;
  const showPower = power.length > 0;
  const showCadence = cadence.length > 0;
  const showElevation = elevationState !== "off" && elevation.length > 0;
  const showGlucose = glucoseState !== "off";
  setExtraStreamTogglesVisible({ gap: showGap, power: showPower, cadence: showCadence });

  const hrDimmed = hrState === "dimmed";
  const paceDimmed = paceState === "dimmed";
  const gapDimmed = gapState === "dimmed";
  const powerDimmed = powerState === "dimmed";
  const cadenceDimmed = cadenceState === "dimmed";
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
  const useHrZoneColors = !!pieces && showHr && !hrDimmed
    && (!showPace || paceDimmed)
    && (!showGap || gapDimmed)
    && (!showPower || powerDimmed)
    && (!showCadence || cadenceDimmed)
    && (!showElevation || elevationDimmed)
    && (!showGlucose || glucoseDimmed);

  // Build y-axes and series in tandem so each series' yAxisIndex/visualMap seriesIndex
  // always matches where it actually landed in the arrays below.
  const yAxisEntries = [{ type: "value", name: "bpm", min: yMin, show: showHr }];
  let rightAxisCount = 0;
  const nextRightAxisOffset = () => (rightAxisCount++ * 58);
  let paceAxisIndex = -1;
  let powerAxisIndex = -1;
  let cadenceAxisIndex = -1;
  let elevationAxisIndex = -1;
  let glucoseAxisIndex = -1;

  if (showPace || showGap) {
    paceAxisIndex = yAxisEntries.length;
    yAxisEntries.push({
      type: "value",
      name: "min/km",
      position: "right",
      offset: nextRightAxisOffset(),
      alignTicks: true,
      inverse: true,
      max: 20,
      axisLabel: { formatter: (v) => formatPaceMinutes(v) },
    });
  }
  if (showPower) {
    powerAxisIndex = yAxisEntries.length;
    yAxisEntries.push({
      type: "value",
      name: "W",
      position: "right",
      offset: nextRightAxisOffset(),
      alignTicks: true,
      axisLabel: { formatter: (v) => Math.round(v) },
      splitLine: { show: false },
    });
  }
  if (showCadence) {
    cadenceAxisIndex = yAxisEntries.length;
    yAxisEntries.push({
      type: "value",
      name: "rpm",
      position: "right",
      offset: nextRightAxisOffset(),
      alignTicks: true,
      axisLabel: { formatter: (v) => Math.round(v) },
      splitLine: { show: false },
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
      offset: nextRightAxisOffset(),
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
        ...(hrDimmed ? { color: SERIES_DIMMED_COLOR } : (useHrZoneColors ? {} : { color: SERIES_COLORS.hr })),
      },
      itemStyle: hrDimmed
        ? { color: SERIES_DIMMED_COLOR }
        : (useHrZoneColors ? undefined : { color: SERIES_COLORS.hr }),
      areaStyle: {
        opacity: hrDimmed ? 0.06 : 0.16,
        ...(hrDimmed ? { color: SERIES_DIMMED_COLOR } : (useHrZoneColors ? {} : { color: SERIES_COLORS.hr })),
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
      lineStyle: { width: 1, color: paceDimmed ? SERIES_DIMMED_COLOR : SERIES_COLORS.pace, opacity: paceDimmed ? 0.6 : 1 },
      data: pace,
    });
  }
  if (showGap) {
    seriesEntries.push({
      type: "line",
      name: "GAP",
      yAxisIndex: paceAxisIndex,
      smooth: true,
      showSymbol: false,
      z: 2,
      lineStyle: { width: 1, color: gapDimmed ? SERIES_DIMMED_COLOR : SERIES_COLORS.gap, opacity: gapDimmed ? 0.6 : 1 },
      data: gap,
    });
  }
  if (showPower) {
    seriesEntries.push({
      type: "line",
      name: "Power",
      yAxisIndex: powerAxisIndex,
      smooth: true,
      showSymbol: false,
      z: 2,
      lineStyle: { width: 1, color: powerDimmed ? SERIES_DIMMED_COLOR : SERIES_COLORS.power, opacity: powerDimmed ? 0.6 : 1 },
      data: power,
    });
  }
  if (showCadence) {
    seriesEntries.push({
      type: "line",
      name: "Cadence",
      yAxisIndex: cadenceAxisIndex,
      smooth: true,
      showSymbol: false,
      z: 2,
      lineStyle: { width: 1, color: cadenceDimmed ? SERIES_DIMMED_COLOR : SERIES_COLORS.cadence, opacity: cadenceDimmed ? 0.6 : 1 },
      data: cadence,
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
      lineStyle: { width: 0.5, color: SERIES_COLORS.elevation, opacity: 0.28 },
      areaStyle: { color: SERIES_COLORS.elevation, opacity: 0.07 },
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
      lineStyle: { width: 1.5, color: glucoseDimmed ? SERIES_DIMMED_COLOR : SERIES_COLORS.glucose },
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

  const gridRight = rightAxisCount === 0 ? 16 : 58 + ((rightAxisCount - 1) * 58);
  const gridLeft = showElevation ? 58 : showHr ? 42 : 16;
  const titleParts = [
    showHr ? "heart rate" : null,
    showPace ? "pace" : null,
    showGap ? "GAP" : null,
    showPower ? "power" : null,
    showCadence ? "cadence" : null,
    showElevation ? "elevation" : null,
    showGlucose ? "glucose" : null,
  ].filter(Boolean);

  const lastTimeSec = time.length ? Number(time[time.length - 1]) : 0;
  const streamDurationMin = Number.isFinite(lastTimeSec) ? lastTimeSec / 60 : 0;
  const workoutDurationMin = plannedWorkout ? plannedWorkout.totalDurationSec / 60 : 0;
  const sharedXMax = plannedWorkout ? Math.max(streamDurationMin, workoutDurationMin, 1) : null;

  const hrChart = mkActivityLabChart("lab-hr");
  hrChart.setOption({
    title: {
      text: titleParts.length ? titleParts.join(", ") : "Activity streams",
      subtext: `${focusActivity.date || ""} · ${focusActivity.activity_name || ""}`,
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
          else if (p.seriesName === "GAP") lines.push(`GAP ${formatPaceMinutes(p.value[1])} min/km`);
          else if (p.seriesName === "Power") lines.push(`Power ${Math.round(p.value[1])} W`);
          else if (p.seriesName === "Cadence") lines.push(`Cadence ${Math.round(p.value[1])} rpm`);
          else if (p.seriesName === "Elevation") lines.push(`Elevation ${Math.round(p.value[1])} m`);
          else if (p.seriesName === "Glucose") lines.push(`Glucose ${Math.round(p.value[1])} mg/dL`);
        }
        return lines.join(" · ");
      },
    },
    ...(visualMapEntries.length ? { visualMap: visualMapEntries } : {}),
    grid: { left: gridLeft, right: gridRight, top: 52, bottom: 28 },
    xAxis: {
      type: "value", name: "min", ...(sharedXMax ? { min: 0, max: sharedXMax } : {}),
      // Same fix as renderPlannedWorkoutChart: hide the ugly non-round max-value label.
      axisLabel: { showMaxLabel: false },
    },
    yAxis: yAxisEntries,
    series: seriesEntries,
  });
  renderPlannedWorkoutChart(plannedWorkout, sharedXMax ?? streamDurationMin, gridLeft, gridRight);
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
  setExtraStreamTogglesVisible({ gap: false, power: false, cadence: false });
  renderActivityLabPlaceholder("lab-hr", "Heart rate + pace stream", "Loading streams…");
  document.getElementById("activity-lab-workout-card")?.classList.add("hidden");
  const plannedWorkoutPromise = loadPlannedWorkout(focusActivity).catch(() => null);
  try {
    const settings = getSettings();
    let stream = await fetchHrStream(
      focusActivity.activity_id,
      settings,
      focusActivity.source || "intervals",
      "",
      forceRefresh
    );
    if (!forceRefresh && streamNeedsEnhancedRefresh(stream)) {
      stream = await fetchHrStream(
        focusActivity.activity_id,
        settings,
        focusActivity.source || "intervals",
        "",
        true
      );
    }
    const plannedWorkout = await plannedWorkoutPromise;
    renderActivityLabTimeSeries(stream, focusActivity, plannedWorkout);
  } catch (err) {
    const detail = String(err?.message || "Unknown stream error");
    setGlucoseToggleVisible(false);
    setExtraStreamTogglesVisible({ gap: false, power: false, cadence: false });
    renderActivityLabPlaceholder("lab-hr", "Heart rate, pace, GAP, power, cadence, elevation", detail);
    const plannedWorkout = await plannedWorkoutPromise;
    renderPlannedWorkoutChart(plannedWorkout, plannedWorkout ? plannedWorkout.totalDurationSec / 60 : 0, 16, 16);
    state.activityLab.lastTileSnapshot = { focusActivity, hr: [], pace: [], cadence: [], plannedWorkout, hasStream: false };
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
  updateActivitiesSidebars();
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
      updateActivitiesSidebars();
      openActivityLab(next.activity);
    } else {
      state.activeActivityTabId = null;
      updateActivitiesSidebars();
      setScreen("activities");
    }
  } else {
    updateActivitiesSidebars();
  }
}


function renderIntervals() {
  const body = document.getElementById("intervals-body");
  body.innerHTML = "";
  if (state.intervalsGrouped) {
    renderGroupedIntervals(body);
  } else {
    const items = sortForDisplay(state.filtered, state.intervalsSort);
    items.forEach((item) => body.appendChild(renderIntervalRow(item)));
  }
  document.getElementById("result-summary").textContent = `${state.filtered.length} intervals`;
  document.getElementById("selected-count").textContent = `${state.selected.size} selected`;
  if (typeof updateAppSidebarStats === "function") updateAppSidebarStats();
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
