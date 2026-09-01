/* ─── Add-motion flow (power-only indoor rides / workouts) ─────────────────
 * Indoor trainer / virtual rides frequently record power (watts) but no
 * distance or speed. This synthesises a distance + speed stream from the
 * power stream using a standard cycling power model, and pushes it back to
 * intervals.icu via the streams-CSV upload endpoint (same mechanism the
 * "Add elevation" flow uses).
 *
 * Physics — steady-state cycling on flat ground, no head/tailwind:
 *   P_wheel = v · (Crr · m · g)  +  ½ · ρ · CdA · v³
 * where P_wheel = P_pedal · drivetrain_efficiency. Solving this monotonic
 * cubic for v gives ground speed from instantaneous power. Constants use the
 * requested rider/bike setup: 75 kg athlete + 10 kg bike. */

const MOTION_ATHLETE_KG = 75;
const MOTION_BIKE_KG = 10;
const MOTION_MASS_KG = MOTION_ATHLETE_KG + MOTION_BIKE_KG; // 85 kg total
const MOTION_G = 9.8067;            // gravitational acceleration (m/s²)
const MOTION_CRR = 0.005;           // rolling resistance coefficient (road tyre)
const MOTION_RHO = 1.225;           // air density at sea level, 15 °C (kg/m³)
const MOTION_CDA = 0.30;            // drag area (m²), typical road hoods position
const MOTION_DRIVETRAIN_EFF = 0.97; // pedal → wheel efficiency

/** Ground speed (m/s) for a given instantaneous power (W) on flat ground with
 *  no wind. Solves the cubic P = a·v³ + b·v by bisection (f is monotonic
 *  increasing in v, so bisection is stable and needs no derivative). */
function motionSpeedFromPower(watts) {
  const p = Math.max(0, Number(watts) || 0) * MOTION_DRIVETRAIN_EFF;
  if (p <= 0) return 0;
  const a = 0.5 * MOTION_RHO * MOTION_CDA;      // coefficient of v³
  const b = MOTION_CRR * MOTION_MASS_KG * MOTION_G; // coefficient of v
  const f = (v) => a * v * v * v + b * v - p;
  let lo = 0, hi = 30;
  while (f(hi) < 0 && hi < 1000) hi *= 2;
  for (let k = 0; k < 60; k++) {
    const mid = (lo + hi) / 2;
    if (f(mid) > 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Build per-sample velocity (m/s) and cumulative distance (m) arrays from the
 *  activity's power stream. Distance is integrated trapezoidally over the
 *  time stream so uneven sample spacing is handled correctly. */
function motionBuildSeries(stream) {
  const time = Array.isArray(stream?.time) ? stream.time : [];
  const watts = Array.isArray(stream?.watts) ? stream.watts : [];
  const n = time.length;
  const velocity = new Array(n).fill(0);
  const distance = new Array(n).fill(0);
  if (!n) return { velocity, distance, totalDistance: 0, movingTime: 0 };

  for (let i = 0; i < n; i++) {
    velocity[i] = Math.round(motionSpeedFromPower(watts[i]) * 1000) / 1000;
  }
  let acc = 0;
  distance[0] = 0;
  for (let i = 1; i < n; i++) {
    const dt = Number(time[i]) - Number(time[i - 1]);
    if (Number.isFinite(dt) && dt > 0) {
      acc += ((velocity[i] + velocity[i - 1]) / 2) * dt;
    }
    distance[i] = Math.round(acc * 100) / 100;
  }
  const movingTime = Number(time[n - 1]) - Number(time[0]);
  return { velocity, distance, totalDistance: acc, movingTime };
}

/** Serialise time + distance + velocity_smooth to the CSV intervals.icu
 *  expects. Row count is unchanged, so only these columns are (re)written;
 *  intervals.icu recomputes pace/speed metrics from the new distance. */
function motionBuildStreamsCsv(stream, distance, velocity) {
  const time = stream.time;
  const lines = ["time,distance,velocity_smooth"];
  for (let i = 0; i < time.length; i++) {
    lines.push(`${Number(time[i])},${distance[i]},${velocity[i]}`);
  }
  return lines.join("\n");
}

/* ── Modal helpers ────────────────────────────────────────────────────── */
let motionContext = null;

function motionEl(id) { return document.getElementById(id); }

function motionSetStatus(text) {
  const el = motionEl("motion-status");
  if (el) el.textContent = text;
}

function motionResetProgress() {
  const el = motionEl("motion-progress");
  if (el) { el.innerHTML = ""; el.classList.add("hidden"); }
}

function motionAddProgress(text, stateName = "active") {
  const list = motionEl("motion-progress");
  if (!list) return null;
  list.classList.remove("hidden");
  const li = document.createElement("li");
  li.className = `elevation-step is-${stateName}`;
  li.textContent = text;
  list.appendChild(li);
  return li;
}

function motionMarkProgress(li, stateName, text) {
  if (!li) return;
  li.className = `elevation-step is-${stateName}`;
  if (text) li.textContent = text;
}

function closeMotionModal() {
  const modal = motionEl("motion-modal");
  if (modal) modal.classList.add("hidden");
}

function finishMotion() {
  motionEl("motion-cancel").classList.add("hidden");
  motionEl("motion-apply").classList.add("hidden");
  motionEl("motion-done").classList.remove("hidden");
}

async function openMotionModal() {
  const modal = motionEl("motion-modal");
  if (!modal) return;
  const snapshot = state.activityLab.lastTileSnapshot;
  const focus = snapshot && snapshot.focusActivity;

  modal.classList.remove("hidden");
  motionResetProgress();
  motionEl("motion-apply").classList.add("hidden");
  motionEl("motion-cancel").classList.remove("hidden");
  motionEl("motion-done").classList.add("hidden");

  if (!focus || !focus.activity_id) {
    motionSetStatus("Open an activity and let its stream load first.");
    return;
  }
  if ((focus.source || "intervals") !== "intervals") {
    motionSetStatus("Motion can only be written back to intervals.icu activities.");
    return;
  }
  const settings = getSettings();
  if (!settings.apiKey) {
    motionSetStatus("Add your intervals.icu API key in Settings first.");
    return;
  }

  motionSetStatus("Loading activity stream…");
  try {
    const src = focus.source || "intervals";
    let stream = await fetchHrStream(focus.activity_id, settings, src);
    const streamHasWatts = (s) => Array.isArray(s?.watts) && s.watts.some((v) => Number(v) > 0);
    // A cached stream may have been loaded earlier without the power channel
    // (e.g. an HR-only fetch that fell back to time/heartrate/velocity/altitude).
    // The cache is keyed on time+heartrate, so it won't re-fetch on its own —
    // force one refresh before concluding there's no power.
    if (Array.isArray(stream?.time) && stream.time.length && !streamHasWatts(stream)) {
      motionSetStatus("Re-fetching activity stream to include power…");
      stream = await fetchHrStream(focus.activity_id, settings, src, "", true);
    }
    if (!Array.isArray(stream?.time) || !stream.time.length) {
      motionSetStatus("This activity has no stream data to compute motion from.");
      return;
    }
    if (!streamHasWatts(stream)) {
      motionSetStatus(
        "This activity has no power (watts) stream on intervals.icu — motion can't be computed. " +
        "The activity list only stores average power; a recorded/estimated power stream is required."
      );
      return;
    }
    motionContext = { activityId: focus.activity_id, stream, focus };
    const preview = motionBuildSeries(stream);
    const km = (preview.totalDistance / 1000).toFixed(2);
    const avgKmh = preview.movingTime > 0
      ? ((preview.totalDistance / 1000) / (preview.movingTime / 3600)).toFixed(1)
      : "0.0";
    motionSetStatus(
      `Computed from power for a ${MOTION_ATHLETE_KG} kg rider + ${MOTION_BIKE_KG} kg bike ` +
      `(flat, no wind): ~${km} km, avg ${avgKmh} km/h. Apply to write distance + speed back to intervals.icu.`
    );
    motionEl("motion-apply").classList.remove("hidden");
  } catch (err) {
    motionSetStatus(`Couldn't load activity: ${err.message}`);
  }
}

async function applyMotion() {
  if (!motionContext) return;
  const { activityId, stream } = motionContext;

  motionEl("motion-apply").disabled = true;
  motionEl("motion-apply").classList.add("hidden");
  motionEl("motion-cancel").classList.add("hidden");
  motionResetProgress();
  motionSetStatus("Adding motion…");

  const s1 = motionAddProgress("Computing distance & speed from power…");
  let csv, totalDistance;
  try {
    const built = motionBuildSeries(stream);
    totalDistance = built.totalDistance;
    csv = motionBuildStreamsCsv(stream, built.distance, built.velocity);
    motionContext.built = built;
    motionMarkProgress(s1, "done", `Computed motion (${(totalDistance / 1000).toFixed(2)} km).`);
  } catch (err) {
    motionMarkProgress(s1, "error", `Failed to compute motion: ${err.message}`);
    finishMotion();
    return;
  }

  const s2 = motionAddProgress("Uploading distance & speed stream to intervals.icu…");
  try {
    await elevUploadStreamsCsv(activityId, csv, getSettings());
    motionMarkProgress(s2, "done", "Uploaded motion stream.");
  } catch (err) {
    motionMarkProgress(s2, "error", err.message);
    finishMotion();
    return;
  }

  const s3 = motionAddProgress("Refreshing local activity data…");
  try {
    await fetchHrStream(activityId, getSettings(), "intervals", "", true);
    motionMarkProgress(s3, "done", "Refreshed activity stream.");
  } catch (_) {
    motionMarkProgress(s3, "done", "Motion uploaded (local refresh skipped).");
  }

  // Patch the cached Activities-table row so the new distance shows up
  // immediately without a manual list refresh/re-search.
  if (typeof state !== "undefined" && Array.isArray(state.activities)) {
    const row = state.activities.find((a) => String(a.activity_id) === String(activityId));
    if (row) {
      row.distance_m = totalDistance;
      if (typeof saveActivitiesCache === "function") await saveActivitiesCache(state.activities);
      if (typeof applyActivitiesFilters === "function") applyActivitiesFilters();
    }
  }

  motionSetStatus(`Done — added ${(totalDistance / 1000).toFixed(2)} km of distance (with speed) to this activity.`);
  finishMotion();
}

function initMotionModal() {
  const apply = motionEl("motion-apply");
  const cancel = motionEl("motion-cancel");
  const done = motionEl("motion-done");
  const closeX = motionEl("motion-close-x");
  const modal = motionEl("motion-modal");
  if (apply) apply.addEventListener("click", applyMotion);
  if (cancel) cancel.addEventListener("click", closeMotionModal);
  if (done) done.addEventListener("click", closeMotionModal);
  if (closeX) closeX.addEventListener("click", closeMotionModal);
  if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) closeMotionModal(); });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initMotionModal);
  } else {
    initMotionModal();
  }
}

if (typeof module !== "undefined") {
  module.exports = { motionSpeedFromPower, motionBuildSeries, motionBuildStreamsCsv };
}
