/* ─── Add-elevation flow (treadmill / Stairmaster workouts) ────────────────
 * Treadmill and Stairmaster sessions record no altitude. This lets the user
 * assign an incline per activity interval — either a gradient (%) or a
 * Stairmaster mode (fixed elevation per step) — synthesise an altitude stream
 * from the distance/cadence streams, and push it back to intervals.icu via the
 * streams-CSV upload endpoint. */

const STAIRMASTER_STEP_GAIN_M = 0.20;        // 20 cm/step (treadmill/stair with forward distance).
const STAIRMASTER_NODIST_STEP_GAIN_M = 0.30; // 30 cm/step for a pure stair machine (no distance/pace).
const STAIRMASTER_STRIDE_M = 0.70;           // Assumed forward stride (m/step) for the synthetic GPS route
                                              // when a Stairmaster interval records no real distance/pace.
const FLOOR_HEIGHT_M = 3;                     // 1 floor == 3 m of climb (used when the user enters floors).

/* ── DOM helpers ──────────────────────────────────────────────────────── */
function elevEl(id) { return document.getElementById(id); }

function elevSetStatus(text) {
  const el = elevEl("elevation-status");
  if (el) el.textContent = text;
}

function elevResetProgress() {
  const el = elevEl("elevation-progress");
  if (el) { el.innerHTML = ""; el.classList.add("hidden"); }
}

function elevAddProgress(text, state = "active") {
  const list = elevEl("elevation-progress");
  if (!list) return null;
  list.classList.remove("hidden");
  const li = document.createElement("li");
  li.className = `elevation-step is-${state}`;
  li.textContent = text;
  list.appendChild(li);
  return li;
}

function elevMarkProgress(li, state, text) {
  if (!li) return;
  li.className = `elevation-step is-${state}`;
  if (text) li.textContent = text;
}

/** Promise-based delay used by the upload retry flow. */
function elevDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function closeElevationModal() {
  const modal = elevEl("elevation-modal");
  if (modal) modal.classList.add("hidden");
}

/* ── Interval loading ─────────────────────────────────────────────────── */
/** Fetch every interval for the activity (warmup, work, recovery …) with the
 *  sample index range needed to slice the streams. */
async function elevFetchIntervals(activityId, settings) {
  const auth = `Basic ${btoa(`API_KEY:${settings.apiKey}`)}`;
  const res = await fetch(
    `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/intervals`,
    { headers: { Authorization: auth, Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Intervals request failed (${res.status})`);
  const data = await res.json();
  const raw = Array.isArray(data?.icu_intervals) ? data.icu_intervals : [];
  return raw
    .map((it, i) => ({
      label: String(it.label || it.type || `Interval ${i + 1}`),
      type: String(it.type || ""),
      duration: Number(it.moving_time || it.elapsed_time || 0),
      startIndex: Number(it.start_index || 0),
      endIndex: Number(
        it.end_index != null ? it.end_index : (it.start_index || 0) + (it.moving_time || 0)
      ),
    }))
    .filter((it) => it.endIndex > it.startIndex);
}

/* ── Elevation synthesis ──────────────────────────────────────────────── */
/** Build an altitude series (metres, one value per stream sample) from the
 *  per-interval incline choices. Samples outside any interval stay flat. */
function elevBuildAltitudeSeries(stream, rows) {
  const time = Array.isArray(stream?.time) ? stream.time : [];
  const distance = Array.isArray(stream?.distance) ? stream.distance : [];
  const cadence = Array.isArray(stream?.cadence) ? stream.cadence : [];
  const n = time.length;
  if (!n) return { altitude: [], totalGain: 0 };

  const gainPerSample = new Array(n).fill(0);

  for (const row of rows) {
    const start = Math.max(0, Math.min(n - 1, row.startIndex));
    const end = Math.max(start, Math.min(n, row.endIndex));

    if (row.stairmaster) {
      // Elevation from steps: cadence (steps/min) × minutes × step-gain.
      // A pure stair machine (no forward distance/pace in this interval) climbs
      // more per step, so use 30 cm; a treadmill/stair with distance uses 20 cm.
      // If the user entered a floor count, the interval total is pinned to
      // floors × 3 m and distributed across the samples by step effort instead.
      const stepWeight = new Array(n).fill(0);
      let totalSteps = 0;
      let intervalDist = 0;
      for (let i = start + 1; i < end; i++) {
        const dd = Number(distance[i]) - Number(distance[i - 1]);
        if (Number.isFinite(dd) && dd > 0) intervalDist += dd;
        const dt = Number(time[i]) - Number(time[i - 1]);
        const spm = Number(cadence[i]);
        if (Number.isFinite(dt) && dt > 0 && Number.isFinite(spm) && spm > 0) {
          stepWeight[i] = spm * (dt / 60);
          totalSteps += stepWeight[i];
        }
      }
      const floors = Number(row.floors);
      if (Number.isFinite(floors) && floors > 0) {
        // Pin the interval's total climb to floors × 3 m. Distribute it by step
        // effort so the profile follows cadence; if there is no cadence, fall
        // back to distributing by elapsed time.
        const target = floors * FLOOR_HEIGHT_M;
        let weights = stepWeight;
        let totalW = totalSteps;
        if (totalW <= 0) {
          weights = new Array(n).fill(0);
          totalW = 0;
          for (let i = start + 1; i < end; i++) {
            const dt = Number(time[i]) - Number(time[i - 1]);
            if (Number.isFinite(dt) && dt > 0) { weights[i] = dt; totalW += dt; }
          }
        }
        if (totalW > 0) {
          for (let i = start + 1; i < end; i++) {
            if (weights[i] > 0) gainPerSample[i] += target * (weights[i] / totalW);
          }
        }
      } else {
        const stepGain = intervalDist > 0
          ? STAIRMASTER_STEP_GAIN_M
          : STAIRMASTER_NODIST_STEP_GAIN_M;
        for (let i = start + 1; i < end; i++) {
          if (stepWeight[i] > 0) gainPerSample[i] += stepWeight[i] * stepGain;
        }
      }
    } else if (row.pct) {
      // Elevation from gradient: horizontal distance × grade, distributed over
      // the interval in proportion to each sample's distance delta.
      const grade = row.pct / 100;
      for (let i = start + 1; i < end; i++) {
        const dd = Number(distance[i]) - Number(distance[i - 1]);
        if (!Number.isFinite(dd) || dd <= 0) continue;
        gainPerSample[i] += dd * grade;
      }
    }
  }

  const altitude = new Array(n);
  let acc = 0;
  let totalGain = 0;
  for (let i = 0; i < n; i++) {
    const g = gainPerSample[i];
    if (g > 0) { acc += g; totalGain += g; }
    altitude[i] = Math.round(acc * 100) / 100;
  }
  return { altitude, totalGain };
}

/** Build a "virtual" forward-distance series (metres, cumulative) for FIT/GPS
 *  export only — never written back to intervals.icu. Real intervals.icu
 *  distance is reused wherever the activity actually recorded movement (e.g.
 *  a % incline interval, which requires distance already); Stairmaster
 *  intervals with no real distance/pace get a synthetic forward distance from
 *  cadence × an assumed stride length, so the exported route actually
 *  advances instead of sitting on one GPS point (which is what makes Strava
 *  flag an activity as Treadmill even when tagged Virtual Run). */
function elevBuildVirtualDistanceSeries(stream, rows) {
  const time = Array.isArray(stream?.time) ? stream.time : [];
  const distance = Array.isArray(stream?.distance) ? stream.distance : [];
  const cadence = Array.isArray(stream?.cadence) ? stream.cadence : [];
  const n = time.length;
  if (!n) return [];

  const deltaPerSample = new Array(n).fill(0);
  const covered = new Array(n).fill(false);

  for (const row of rows) {
    const start = Math.max(0, Math.min(n - 1, row.startIndex));
    const end = Math.max(start, Math.min(n, row.endIndex));

    let intervalDist = 0;
    for (let i = start + 1; i < end; i++) {
      const dd = Number(distance[i]) - Number(distance[i - 1]);
      if (Number.isFinite(dd) && dd > 0) intervalDist += dd;
    }

    if (intervalDist > 0) {
      // Real forward movement recorded — reuse it as-is.
      for (let i = start + 1; i < end; i++) {
        const dd = Number(distance[i]) - Number(distance[i - 1]);
        deltaPerSample[i] = Number.isFinite(dd) && dd > 0 ? dd : 0;
        covered[i] = true;
      }
    } else if (row.stairmaster) {
      // No real distance (pure stair machine) — synthesise forward movement
      // from cadence so the GPS route (and FIT pace) isn't stationary.
      for (let i = start + 1; i < end; i++) {
        const dt = Number(time[i]) - Number(time[i - 1]);
        const spm = Number(cadence[i]);
        if (Number.isFinite(dt) && dt > 0 && Number.isFinite(spm) && spm > 0) {
          const steps = spm * (dt / 60);
          deltaPerSample[i] = steps * STAIRMASTER_STRIDE_M;
        }
        covered[i] = true;
      }
    }
  }

  // Any sample outside the covered set falls back to real distance deltas.
  for (let i = 1; i < n; i++) {
    if (covered[i]) continue;
    const dd = Number(distance[i]) - Number(distance[i - 1]);
    deltaPerSample[i] = Number.isFinite(dd) && dd > 0 ? dd : 0;
  }

  const out = new Array(n);
  let acc = Number(distance[0]) || 0;
  out[0] = acc;
  for (let i = 1; i < n; i++) {
    acc += deltaPerSample[i];
    out[i] = Math.round(acc * 100) / 100;
  }
  return out;
}

/** Serialise time + altitude to the CSV format intervals.icu expects (row count
 *  unchanged, so only the altitude column is updated). */
function elevBuildStreamsCsv(stream, altitude) {
  const time = stream.time;
  const lines = ["time,altitude"];
  for (let i = 0; i < time.length; i++) {
    lines.push(`${Number(time[i])},${altitude[i]}`);
  }
  return lines.join("\n");
}

/* ── Upload ───────────────────────────────────────────────────────────── */
async function elevUploadStreamsCsv(activityId, csv, settings) {
  const auth = `Basic ${btoa(`API_KEY:${settings.apiKey}`)}`;
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "streams.csv");
  const res = await fetch(
    `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams.csv`,
    { method: "PUT", headers: { Authorization: auth, Accept: "application/json" }, body: form }
  );
  if (res.ok) return;
  if (res.status === 402 || res.status === 403) {
    throw new Error("Uploading streams needs an intervals.icu Supporter subscription.");
  }
  let detail = "";
  try { detail = (await res.text()).slice(0, 140); } catch (_) { /* ignore */ }
  throw new Error(`Upload failed (${res.status})${detail ? `: ${detail}` : ""}`);
}

/* ── Modal rendering ──────────────────────────────────────────────────── */
function elevRenderRows(intervals) {
  const host = elevEl("elevation-intervals");
  if (!host) return;
  host.innerHTML = "";

  // Bulk control: set a % or Stairmaster for every interval in one go. The
  // floors value is treated as the workout total and prorated across
  // intervals by duration (so the parts sum back to the entered total).
  const bulk = document.createElement("div");
  bulk.className = "elevation-row elevation-bulk";
  bulk.innerHTML = `
    <div class="elevation-row-label">
      <span class="elevation-row-name">All intervals</span>
      <span class="elevation-row-dur muted">% / Stairmaster apply to all; floors prorate by duration</span>
    </div>
    <div class="elevation-row-controls">
      <div class="elevation-field">
        <span class="elevation-field-cap">Incline</span>
        <div class="elevation-input-wrap">
          <input type="number" min="0" max="100" step="0.5" value="0" id="elevation-bulk-pct" />
          <span class="elevation-unit">%</span>
        </div>
      </div>
      <label class="elevation-field elevation-field-check">
        <span class="elevation-field-cap">Stairmaster</span>
        <input type="checkbox" id="elevation-bulk-stair" />
      </label>
      <div class="elevation-field">
        <span class="elevation-field-cap">Total floors</span>
        <div class="elevation-input-wrap">
          <input type="number" min="0" step="0.1" placeholder="auto" id="elevation-bulk-floors" class="elevation-floors-input" disabled />
          <span class="elevation-unit">×3 m</span>
        </div>
      </div>
      <button type="button" id="elevation-bulk-apply" class="btn secondary">Apply to all</button>
    </div>
  `;
  host.appendChild(bulk);

  intervals.forEach((it, i) => {
    const dur = typeof formatSeconds === "function" ? formatSeconds(it.duration) : `${it.duration}s`;
    const rowEl = document.createElement("div");
    rowEl.className = "elevation-row";
    rowEl.innerHTML = `
      <div class="elevation-row-label">
        <span class="elevation-row-name" title="${it.label}">${it.label}</span>
        <span class="elevation-row-dur muted">${dur}</span>
      </div>
      <div class="elevation-row-controls">
        <div class="elevation-field">
          <span class="elevation-field-cap">Incline</span>
          <div class="elevation-input-wrap">
            <input type="number" min="0" max="100" step="0.5" value="0" data-idx="${i}" class="elevation-pct-input" />
            <span class="elevation-unit">%</span>
          </div>
        </div>
        <label class="elevation-field elevation-field-check">
          <span class="elevation-field-cap">Stairmaster</span>
          <input type="checkbox" data-idx="${i}" class="elevation-stair-input" />
        </label>
        <div class="elevation-field">
          <span class="elevation-field-cap">Floors</span>
          <div class="elevation-input-wrap">
            <input type="number" min="0" step="0.1" placeholder="auto" data-idx="${i}" class="elevation-floors-input" disabled />
            <span class="elevation-unit">×3 m</span>
          </div>
        </div>
      </div>
    `;
    host.appendChild(rowEl);
  });

  // Enforce the % xor Stairmaster rule.
  host.querySelectorAll(".elevation-stair-input").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const idx = e.target.getAttribute("data-idx");
      const pctInput = host.querySelector(`.elevation-pct-input[data-idx="${idx}"]`);
      const floorsInput = host.querySelector(`.elevation-floors-input[data-idx="${idx}"]`);
      if (pctInput) {
        pctInput.disabled = e.target.checked;
        if (e.target.checked) pctInput.value = "0";
      }
      if (floorsInput) {
        floorsInput.disabled = !e.target.checked;
        if (!e.target.checked) floorsInput.value = "";
      }
    });
  });

  // Bulk control wiring: mirror the xor rule, and copy the value to every row.
  const bulkStair = host.querySelector("#elevation-bulk-stair");
  const bulkPct = host.querySelector("#elevation-bulk-pct");
  const bulkFloors = host.querySelector("#elevation-bulk-floors");
  const bulkApply = host.querySelector("#elevation-bulk-apply");
  if (bulkStair && bulkPct) {
    bulkStair.addEventListener("change", () => {
      bulkPct.disabled = bulkStair.checked;
      if (bulkStair.checked) bulkPct.value = "0";
      if (bulkFloors) {
        bulkFloors.disabled = !bulkStair.checked;
        if (!bulkStair.checked) bulkFloors.value = "";
      }
    });
  }
  if (bulkApply) {
    bulkApply.addEventListener("click", () => {
      const stair = !!(bulkStair && bulkStair.checked);
      const pct = stair ? 0 : (Number(bulkPct && bulkPct.value) || 0);
      const totalFloors = stair && bulkFloors ? Number(bulkFloors.value) || 0 : 0;
      const totalDuration = intervals.reduce((sum, it) => sum + Math.max(0, Number(it.duration) || 0), 0);
      host.querySelectorAll(".elevation-stair-input").forEach((cb) => {
        cb.checked = stair;
        cb.dispatchEvent(new Event("change"));
      });
      host.querySelectorAll(".elevation-pct-input").forEach((inp) => {
        if (!stair) inp.value = String(pct);
      });
      if (stair && totalFloors > 0 && totalDuration > 0) {
        // Prorate the entered total by each interval's duration, so the
        // per-interval floors sum back to the entered total.
        intervals.forEach((it, i) => {
          const share = Math.max(0, Number(it.duration) || 0) / totalDuration;
          const floorsInput = host.querySelector(`.elevation-floors-input[data-idx="${i}"]`);
          if (floorsInput) floorsInput.value = (totalFloors * share).toFixed(2);
        });
      }
    });
  }
}

function elevCollectRows(intervals) {
  const host = elevEl("elevation-intervals");
  return intervals.map((it, i) => {
    const pctInput = host.querySelector(`.elevation-pct-input[data-idx="${i}"]`);
    const stairInput = host.querySelector(`.elevation-stair-input[data-idx="${i}"]`);
    const floorsInput = host.querySelector(`.elevation-floors-input[data-idx="${i}"]`);
    const stairmaster = !!(stairInput && stairInput.checked);
    const pct = stairmaster ? 0 : (Number(pctInput && pctInput.value) || 0);
    const floors = stairmaster ? (Number(floorsInput && floorsInput.value) || 0) : 0;
    return { startIndex: it.startIndex, endIndex: it.endIndex, pct, stairmaster, floors };
  });
}

/* ── Orchestration ────────────────────────────────────────────────────── */
let elevContext = null; // { activityId, stream, intervals }

function elevShowConfigState() {
  elevEl("elevation-intervals").classList.remove("hidden");
  elevResetProgress();
  elevEl("elevation-apply").classList.remove("hidden");
  elevEl("elevation-apply").disabled = false;
  elevEl("elevation-cancel").classList.remove("hidden");
  elevEl("elevation-done").classList.add("hidden");
}

async function openElevationModal() {
  const modal = elevEl("elevation-modal");
  if (!modal) return;
  const snapshot = state.activityLab.lastTileSnapshot;
  const focus = snapshot && snapshot.focusActivity;

  modal.classList.remove("hidden");
  elevEl("elevation-intervals").innerHTML = "";
  elevEl("elevation-intervals").classList.add("hidden");
  elevResetProgress();
  elevEl("elevation-apply").classList.add("hidden");
  elevEl("elevation-download-fit").classList.add("hidden");
  elevEl("elevation-upload-strava").classList.add("hidden");
  elevEl("elevation-virtual-route-row").classList.add("hidden");
  elevEl("elevation-cancel").classList.remove("hidden");
  elevEl("elevation-done").classList.add("hidden");

  if (!focus || !focus.activity_id) {
    elevSetStatus("Open an activity and let its stream load first.");
    return;
  }
  if ((focus.source || "intervals") !== "intervals") {
    elevSetStatus("Elevation can only be written back to intervals.icu activities.");
    return;
  }

  const settings = getSettings();
  if (!settings.apiKey) {
    elevSetStatus("Add your intervals.icu API key in Settings first.");
    return;
  }

  elevSetStatus("Loading activity intervals and stream…");
  try {
    const [intervals, stream] = await Promise.all([
      elevFetchIntervals(focus.activity_id, settings),
      fetchHrStream(focus.activity_id, settings, focus.source || "intervals"),
    ]);
    if (!Array.isArray(stream?.time) || !stream.time.length) {
      elevSetStatus("This activity has no stream data to attach elevation to.");
      return;
    }
    if (!intervals.length) {
      // Fall back to treating the whole activity as one interval.
      intervals.push({
        label: focus.activity_name || "Whole activity",
        type: "", duration: stream.time.length,
        startIndex: 0, endIndex: stream.time.length,
      });
    }
    elevContext = { activityId: focus.activity_id, stream, intervals, focus };
    const hasDistance = Array.isArray(stream.distance) && stream.distance.some((v) => Number(v) > 0);
    const hasCadence = Array.isArray(stream.cadence) && stream.cadence.some((v) => Number(v) > 0);
    const notes = [];
    if (!hasDistance) notes.push("no distance stream — % incline will have no effect");
    if (!hasCadence) notes.push("no cadence stream — Stairmaster mode will have no effect");
    elevSetStatus(
      `Set an incline for each interval, then apply.${notes.length ? ` (${notes.join("; ")})` : ""}`
    );
    elevRenderRows(intervals);
    elevShowConfigState();
  } catch (err) {
    elevSetStatus(`Couldn't load activity: ${err.message}`);
  }
}

async function applyElevation() {
  if (!elevContext) return;
  const { activityId, stream, intervals } = elevContext;
  const rows = elevCollectRows(intervals);

  // Switch to processing view.
  elevEl("elevation-intervals").classList.add("hidden");
  elevEl("elevation-apply").disabled = true;
  elevEl("elevation-apply").classList.add("hidden");
  elevEl("elevation-cancel").classList.add("hidden");
  elevResetProgress();
  elevSetStatus("Adding elevation…");

  const s1 = elevAddProgress("Computing elevation from intervals…");
  let csv, totalGain;
  try {
    const built = elevBuildAltitudeSeries(stream, rows);
    totalGain = built.totalGain;
    csv = elevBuildStreamsCsv(stream, built.altitude);
    elevContext.altitude = built.altitude;
    elevContext.totalGain = totalGain;
    elevContext.rows = rows;
    elevMarkProgress(s1, "done", `Computed elevation (+${Math.round(totalGain)} m total gain).`);
    // The FIT can be downloaded regardless of whether the intervals.icu upload
    // succeeds, so reveal it as soon as the altitude series exists.
    elevEl("elevation-download-fit").classList.remove("hidden");
    elevEl("elevation-upload-strava").classList.remove("hidden");
    elevEl("elevation-virtual-route-row").classList.remove("hidden");
  } catch (err) {
    elevMarkProgress(s1, "error", `Failed to compute elevation: ${err.message}`);
    finishElevation();
    return;
  }

  const s2 = elevAddProgress("Uploading elevation stream to intervals.icu…");
  try {
    await elevUploadStreamsCsv(activityId, csv, getSettings());
    elevMarkProgress(s2, "done", "Uploaded elevation stream.");
  } catch (err) {
    elevMarkProgress(s2, "error", err.message);
    finishElevation();
    return;
  }

  const s3 = elevAddProgress("Refreshing local activity data…");
  try {
    await fetchHrStream(activityId, getSettings(), "intervals", "", true);
    elevMarkProgress(s3, "done", "Refreshed activity stream.");
  } catch (_) {
    elevMarkProgress(s3, "done", "Elevation uploaded (local refresh skipped).");
  }

  // Also patch the cached Activities-table row (and localStorage cache) so the new
  // elevation shows up immediately without requiring a manual list refresh/re-search.
  if (typeof state !== "undefined" && Array.isArray(state.activities)) {
    const row = state.activities.find((a) => String(a.activity_id) === String(activityId));
    if (row) {
      row.elevation_gain_m = totalGain;
      if (typeof saveActivitiesCache === "function") await saveActivitiesCache(state.activities);
      if (typeof applyActivitiesFilters === "function") applyActivitiesFilters();
    }
  }

  elevSetStatus(`Done — added ${Math.round(totalGain)} m of elevation to this activity.`);
  finishElevation();
}

function finishElevation() {
  elevEl("elevation-cancel").classList.add("hidden");
  elevEl("elevation-apply").classList.add("hidden");
  elevEl("elevation-done").classList.remove("hidden");
}

/* ── FIT export ───────────────────────────────────────────────────────── */
/** Parse an intervals.icu local ISO string as wall-clock seconds (no tz shift). */
function elevStartUnixSec(focus) {
  const iso = focus?.activity_start_local || `${focus?.date || ""}T00:00:00`;
  const m = String(iso).match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/)
    || String(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return Date.now() / 1000;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)) / 1000;
}

/** Map an intervals.icu activity type to FIT sport/sub_sport. */
function elevSportForType(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("run")) return { sport: 1, subSport: 0, isRun: true }; // generic run (NOT treadmill, so Strava shows elevation)
  if (t.includes("walk") || t.includes("hike")) return { sport: 11, subSport: 0, isRun: false }; // walking
  return { sport: 4, subSport: 0, isRun: false }; // fitness_equipment (Stairmaster etc.)
}

const FIT_SUB_SPORT_VIRTUAL_ACTIVITY = 58;

function elevFitFileName(focus) {
  const base = String(focus?.activity_name || focus?.activity_type || "activity")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "activity";
  return `${base}-elevation.fit`;
}

/** Build FIT bytes from the current elevation context. Optionally attaches a
 *  synthetic GPS route (the running loop, walked as many times as the
 *  activity's distance requires) so Strava will render a map + elevation
 *  profile; the activity is then tagged sub_sport = virtual_activity so
 *  Strava marks it "Virtual Run" rather than a (spurious) outdoor GPS run. */
function elevBuildFitBytes() {
  const { stream, altitude, focus, totalGain, rows } = elevContext;
  if (typeof buildFitFile !== "function") throw new Error("FIT export module not loaded.");
  const sport = elevSportForType(focus.activity_type);
  const useVirtualRoute = !!elevEl("elevation-virtual-route")?.checked;

  let route = null;
  let exportStream = stream;
  if (useVirtualRoute && typeof virtualRouteForDistances === "function") {
    // Use a synthetic forward-distance series (real distance where recorded,
    // cadence-derived for zero-distance Stairmaster stretches) so the GPS
    // route actually advances and the FIT's own distance/pace fields stay
    // consistent with it — a stationary/zero-pace GPS track is what makes
    // Strava tag the activity Treadmill even when sub_sport says Virtual Run.
    const virtualDistance = elevBuildVirtualDistanceSeries(stream, Array.isArray(rows) ? rows : []);
    route = virtualRouteForDistances(virtualDistance);
    exportStream = { ...stream, distance: virtualDistance };
  }

  return buildFitFile(exportStream, altitude, {
    startUnixSec: elevStartUnixSec(focus),
    sport: sport.sport,
    subSport: route ? FIT_SUB_SPORT_VIRTUAL_ACTIVITY : sport.subSport,
    isRun: sport.isRun,
    totalGain,
    route,
  });
}

function downloadElevationFit() {
  if (!elevContext || !Array.isArray(elevContext.altitude)) return;
  const { focus } = elevContext;
  try {
    const bytes = elevBuildFitBytes();
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = elevFitFileName(focus);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    elevSetStatus("FIT file downloaded — upload it to Strava as a new activity (then delete the old one).");
  } catch (err) {
    elevSetStatus(`Couldn't build FIT: ${err.message}`);
  }
}

async function uploadElevationToStrava() {
  if (!elevContext || !Array.isArray(elevContext.altitude)) return;
  const { focus } = elevContext;

  // Find the matching Strava activity so we can name/reference it, and warn the
  // user to delete it first (Strava rejects duplicates otherwise).
  elevEl("elevation-upload-strava").disabled = true;
  elevEl("elevation-download-fit").disabled = true;
  elevResetProgress();

  const settings = getSettings();
  let token;
  const sAuth = elevAddProgress("Checking Strava connection…");
  try {
    token = await refreshStravaTokenIfNeeded(settings);
    if (!token) throw new Error("Connect Strava in Settings first.");
    const granted = localStorage.getItem("intervals_strava_granted_scope") || "";
    if (!granted.includes("activity:write")) {
      throw new Error("Reconnect Strava in Settings to grant upload (activity:write) permission.");
    }
    elevMarkProgress(sAuth, "done", "Strava connected with upload permission.");
  } catch (err) {
    elevMarkProgress(sAuth, "error", err.message);
    elevEl("elevation-upload-strava").disabled = false;
    elevEl("elevation-download-fit").disabled = false;
    return;
  }

  let bytes;
  const sBuild = elevAddProgress("Building FIT file…");
  try {
    bytes = elevBuildFitBytes();
    elevMarkProgress(sBuild, "done", `Built FIT (${(bytes.length / 1024).toFixed(1)} KB).`);
  } catch (err) {
    elevMarkProgress(sBuild, "error", err.message);
    elevEl("elevation-upload-strava").disabled = false;
    elevEl("elevation-download-fit").disabled = false;
    return;
  }

  // Stash what the resume step needs, then pause for the user to delete the
  // original on Strava (Strava rejects duplicate uploads).
  elevContext.fitBytes = bytes;
  elevContext.stravaToken = token;
  elevContext.stravaSettings = settings;

  const sFind = elevAddProgress("Locating the original activity on Strava…");
  let match = null;
  try {
    if (typeof findMatchingStravaActivity === "function") {
      match = await findMatchingStravaActivity(focus);
    }
  } catch (_) { /* non-fatal — fall back to the Strava dashboard link */ }
  const deleteUrl = match && match.id
    ? `https://www.strava.com/activities/${encodeURIComponent(match.id)}`
    : "https://www.strava.com/athlete/training";
  elevMarkProgress(sFind, "done", match
    ? `Found "${match.name}" on Strava.`
    : "Couldn't auto-match the Strava activity — use your Strava activity list.");

  elevShowDeletePause(deleteUrl);
}

/** Pause the upload flow: show a delete-then-continue prompt with two links. */
function elevShowDeletePause(deleteUrl) {
  const list = elevEl("elevation-progress");
  if (!list) return;
  list.classList.remove("hidden");
  const li = document.createElement("li");
  li.className = "elevation-step is-pause";
  li.innerHTML = `
    <span class="elevation-pause-text">Delete the original activity on Strava first to avoid a duplicate.</span>
    <span class="elevation-pause-actions">
      <a href="${deleteUrl}" target="_blank" rel="noopener noreferrer" class="elevation-link">Delete in Strava ↗</a>
      <a href="#" class="elevation-link" id="elevation-continue-upload">Continue</a>
    </span>`;
  list.appendChild(li);
  const cont = li.querySelector("#elevation-continue-upload");
  if (cont) {
    cont.addEventListener("click", (e) => {
      e.preventDefault();
      if (cont.getAttribute("aria-disabled") === "true") return;
      cont.setAttribute("aria-disabled", "true");
      cont.classList.add("is-disabled");
      elevMarkProgress(li, "done",
        "Continuing (make sure the original is deleted on Strava).");
      continueElevationStravaUpload();
    });
  }
}

/** Resume after the delete-pause: wait for the delete to propagate on Strava's
 * side, then upload the built FIT and poll for the result. Retries on
 * failure with a longer backoff, up to a fixed number of attempts. */
async function continueElevationStravaUpload() {
  if (!elevContext || !elevContext.fitBytes) return;
  const { focus, fitBytes: bytes, stravaToken: token, stravaSettings: settings } = elevContext;

  const MAX_RETRIES = 2; // total attempts = 1 initial + MAX_RETRIES retries
  const INITIAL_WAIT_MS = 15000;
  const RETRY_WAIT_MS = 30000;

  const sWait = elevAddProgress("Waiting 15s before uploading (letting the delete propagate on Strava)…");
  await elevDelay(INITIAL_WAIT_MS);
  elevMarkProgress(sWait, "done", "Waited 15s.");

  for (let attempt = 0; ; attempt++) {
    const ok = await elevAttemptStravaUploadOnce(focus, bytes, token, settings, attempt);
    if (ok) return;
    if (attempt >= MAX_RETRIES) {
      elevAddProgress(
        `Gave up after ${MAX_RETRIES + 1} attempts. Delete the original activity on Strava, then try again.`,
        "error"
      );
      elevEl("elevation-download-fit").disabled = false;
      finishElevation();
      return;
    }
    const sRetryWait = elevAddProgress(`Waiting 30s before retry ${attempt + 1} of ${MAX_RETRIES}…`);
    await elevDelay(RETRY_WAIT_MS);
    elevMarkProgress(sRetryWait, "done", "Waited 30s.");
  }
}

/** Single upload+poll attempt. Returns true on success, false on failure
 * (leaving progress-list error entries in place for the caller to react to). */
async function elevAttemptStravaUploadOnce(focus, bytes, token, settings, attempt) {
  const label = attempt > 0 ? ` (retry ${attempt})` : "";
  const sUp = elevAddProgress(`Uploading FIT to Strava${label}…`);
  let upload;
  try {
    upload = await stravaUploadActivity(bytes, {
      dataType: "fit",
      filename: elevFitFileName(focus),
      name: focus.activity_name || "Workout (with elevation)",
      description: "Elevation added via Trail Data Hub.",
      externalId: `tdh-elev-${focus.activity_id}`,
      trainer: false, // NOT a trainer/treadmill upload — Strava hides elevation for treadmill runs.
    }, settings, token);
    elevMarkProgress(sUp, "done", "Uploaded — Strava is processing the file.");
  } catch (err) {
    // Strava reports duplicates here (existing activity with same start/duration).
    const dup = /duplicate/i.test(err.message);
    elevMarkProgress(sUp, "error", dup
      ? "Strava rejected this as a duplicate. Delete the original activity on Strava, then upload again."
      : err.message);
    return false;
  }

  const sPoll = elevAddProgress("Waiting for Strava to finish processing…");
  try {
    const done = await stravaPollUpload(upload.id, settings, token);
    const link = `https://www.strava.com/activities/${done.activity_id}`;
    elevMarkProgress(sPoll, "done", "Strava created the activity.");
    elevSetStatus("");
    const status = elevEl("elevation-status");
    status.innerHTML =
      `Uploaded to Strava with elevation. <a href="${link}" target="_blank" rel="noopener noreferrer">Open activity ↗</a>`;
    elevEl("elevation-download-fit").disabled = false;
    finishElevation();
    return true;
  } catch (err) {
    const dup = /duplicate/i.test(err.message);
    elevMarkProgress(sPoll, "error", dup
      ? "Strava flagged a duplicate. Delete the original activity on Strava, then upload again."
      : err.message);
    return false;
  }
}

function bindElevationModal() {
  const apply = elevEl("elevation-apply");
  const cancel = elevEl("elevation-cancel");
  const done = elevEl("elevation-done");
  const closeX = elevEl("elevation-close-x");
  const fit = elevEl("elevation-download-fit");
  const upload = elevEl("elevation-upload-strava");
  const modal = elevEl("elevation-modal");
  if (apply) apply.addEventListener("click", applyElevation);
  if (cancel) cancel.addEventListener("click", closeElevationModal);
  if (done) done.addEventListener("click", closeElevationModal);
  if (closeX) closeX.addEventListener("click", closeElevationModal);
  if (fit) fit.addEventListener("click", downloadElevationFit);
  if (upload) upload.addEventListener("click", uploadElevationToStrava);
  if (modal) modal.addEventListener("click", (e) => { if (e.target === modal) closeElevationModal(); });
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindElevationModal);
  } else {
    bindElevationModal();
  }
}

/* Node test harness hook (ignored in the browser). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    elevBuildAltitudeSeries, elevBuildStreamsCsv, elevBuildVirtualDistanceSeries,
    STAIRMASTER_STEP_GAIN_M, STAIRMASTER_NODIST_STEP_GAIN_M, STAIRMASTER_STRIDE_M,
    FLOOR_HEIGHT_M,
  };
}
