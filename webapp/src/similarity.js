/* ─── Activity similarity (fingerprint + score) ─────────────────────────────
 * Exactly one of three independent similarity types is scored at a time (never
 * blended): duration, work-interval shape (avg + variance of work-interval
 * length), and training load. Each uses a ratio-based comparison, naturally in
 * [0, 1], symmetric, no dataset-wide normalization needed. The exact activity
 * type is a hard gate (e.g. "Run" and "VirtualRun" are never considered
 * similar), keeping indoor/outdoor and real/virtual sessions distinct. The
 * "intervals" type additionally gates on both activities having work-interval
 * data available (fetched on demand and cached in workIntervalsByActivity).
 */

/** Ratio similarity for positive quantities: 1 when equal, →0 as they diverge; 1 if both are ~0. */
function ratioSimilarity(a, b) {
  const av = Number(a) || 0;
  const bv = Number(b) || 0;
  if (av <= 0 && bv <= 0) return 1;
  if (av <= 0 || bv <= 0) return 0;
  return Math.min(av, bv) / Math.max(av, bv);
}

/** Mean + population standard deviation of work-interval durations (seconds). */
function computeWorkIntervalStats(workIntervals) {
  const durations = (Array.isArray(workIntervals) ? workIntervals : [])
    .map((it) => Number(it?.duration || 0))
    .filter((d) => d > 0);
  const count = durations.length;
  if (count === 0) return { count: 0, avgS: 0, stdS: 0 };
  const avgS = durations.reduce((sum, d) => sum + d, 0) / count;
  const variance = durations.reduce((sum, d) => sum + (d - avgS) ** 2, 0) / count;
  return { count, avgS, stdS: Math.sqrt(variance) };
}

/**
 * Builds a similarity fingerprint from an internal activity object (as produced by
 * mapActivity()/run_activity_search) plus that activity's work intervals (only
 * needed for the "intervals" similarity type — pass [] or omit otherwise).
 */
function buildActivityFingerprint(activity, workIntervals = []) {
  const durationS = Math.max(0, Number(activity?.moving_time_s || 0));
  const trainingLoadRaw = activity?.training_load;
  const intensityRaw = activity?.intensity;
  const hasTrainingLoad = trainingLoadRaw != null;
  const hasIntensity = intensityRaw != null;
  const trainingLoad = hasTrainingLoad ? Math.max(0, Number(trainingLoadRaw)) : 0;
  const intensity = hasIntensity ? Math.max(0, Number(intensityRaw)) : 0;
  const durationMin = durationS / 60;
  const loadDensity = hasTrainingLoad && durationMin > 0 ? trainingLoad / durationMin : 0;
  const workIntervalStats = computeWorkIntervalStats(workIntervals);

  return {
    activity_id: activity?.activity_id,
    type: normalizeActivityType(activity?.activity_type),
    durationS,
    loadDensity,
    intensity,
    hasLoadDensity: hasTrainingLoad && durationMin > 0,
    hasLoad: hasTrainingLoad || hasIntensity,
    workIntervalCount: workIntervalStats.count,
    workIntervalAvgS: workIntervalStats.avgS,
    workIntervalStdS: workIntervalStats.stdS,
    hasWorkIntervals: workIntervalStats.count > 0,
  };
}

/**
 * Similarity between two fingerprints for a single similarity `type`. Returns
 * 0 (gated) when the activity types differ, or when the requested type needs
 * data that either side lacks (load, work intervals).
 */
function similarityScoreForType(fpA, fpB, type) {
  if (!fpA?.type || !fpB?.type || fpA.type !== fpB.type) {
    return { score: 0, gated: true };
  }
  if (type === "duration") {
    return { score: ratioSimilarity(fpA.durationS, fpB.durationS), gated: false };
  }
  if (type === "load") {
    if (!fpA.hasLoad || !fpB.hasLoad) return { score: 0, gated: true };
    const a = fpA.hasLoadDensity ? fpA.loadDensity : fpA.intensity;
    const b = fpB.hasLoadDensity ? fpB.loadDensity : fpB.intensity;
    return { score: ratioSimilarity(a, b), gated: false };
  }
  if (type === "intervals") {
    if (!fpA.hasWorkIntervals || !fpB.hasWorkIntervals) return { score: 0, gated: true };
    const avgSim = ratioSimilarity(fpA.workIntervalAvgS, fpB.workIntervalAvgS);
    const stdSim = ratioSimilarity(fpA.workIntervalStdS, fpB.workIntervalStdS);
    return { score: (avgSim * 0.7) + (stdSim * 0.3), gated: false };
  }
  return { score: 0, gated: true };
}

/** Best-effort work intervals lookup that never throws (used by similarity search). */
async function loadWorkIntervalsSafe(activity) {
  try {
    return await loadWorkIntervals(activity);
  } catch (err) {
    return [];
  }
}

/**
 * Ranks `candidates` by similarity to `queryActivity` for a single similarity
 * `type` ("duration" | "intervals" | "load"), excluding the query itself.
 * For "intervals", work-interval data is fetched (and cached) on demand, one
 * activity at a time, capped by SIMILARITY_INTERVALS_FETCH_CAP candidates.
 */
async function findSimilarActivities(queryActivity, candidates, options = {}) {
  const type = SIMILARITY_TYPES.includes(options.type) ? options.type : SIMILARITY_DEFAULT_TYPE;
  const minScore = Number.isFinite(options.minScore) ? options.minScore : 0;
  const limit = Number.isFinite(options.limit) ? options.limit : 20;
  const needsIntervals = type === "intervals";

  const queryWorkIntervals = needsIntervals ? await loadWorkIntervalsSafe(queryActivity) : [];
  const queryFp = buildActivityFingerprint(queryActivity, queryWorkIntervals);

  const sameType = candidates.filter((candidate) => (
    String(candidate.activity_id) !== String(queryActivity.activity_id)
    && normalizeActivityType(candidate.activity_type) === queryFp.type
  ));
  const pool = needsIntervals ? sameType.slice(0, SIMILARITY_INTERVALS_FETCH_CAP) : sameType;

  const results = [];
  for (const candidate of pool) {
    const workIntervals = needsIntervals ? await loadWorkIntervalsSafe(candidate) : [];
    const candidateFp = buildActivityFingerprint(candidate, workIntervals);
    const { score, gated } = similarityScoreForType(queryFp, candidateFp, type);
    if (gated || score < minScore) continue;
    results.push({
      activity: candidate,
      score,
      detail: {
        durationS: candidateFp.durationS,
        loadDensity: candidateFp.loadDensity,
        hasLoadDensity: candidateFp.hasLoadDensity,
        intensity: candidateFp.intensity,
        workIntervalCount: candidateFp.workIntervalCount,
        workIntervalAvgS: candidateFp.workIntervalAvgS,
        workIntervalStdS: candidateFp.workIntervalStdS,
      },
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

/* ─── Similarity screen (tactical test UI) ──────────────────────────────── */
function similarityActivityLabel(activity) {
  const durationLabel = activity.moving_time_s ? formatDuration(activity.moving_time_s) : "-";
  const distLabel = activity.distance_m ? formatDistance(activity.distance_m) : "";
  const namePart = activity.activity_name ? ` · ${activity.activity_name.slice(0, 32)}` : "";
  return `${activity.date || "-"} · ${activity.activity_type || "-"} · ${durationLabel}`
    + (distLabel ? ` · ${distLabel}` : "") + namePart;
}

function renderSimilarityQueryOptions() {
  const select = document.getElementById("similarity-query-select");
  if (!select) return;
  const sorted = [...state.activities].sort(compareActivitiesChronologically).reverse();
  const previousValue = select.value || state.similarity.queryActivityId || "";
  const stillExists = sorted.some((a) => String(a.activity_id) === previousValue);
  const selectedValue = stillExists ? previousValue : "";

  select.innerHTML = '<sl-option value="">Select an activity…</sl-option>';
  sorted.forEach((activity) => {
    const opt = document.createElement("sl-option");
    opt.value = String(activity.activity_id);
    opt.textContent = similarityActivityLabel(activity);
    if (opt.value === selectedValue) opt.selected = true;
    select.appendChild(opt);
  });
  state.similarity.queryActivityId = selectedValue;
}

/** Renders a contextual value for the currently selected similarity `type` (shown in the Detail column). */
function renderSimilarityDetail(type, detail) {
  if (!detail) return '<span class="muted">-</span>';
  if (type === "load") {
    if (detail.hasLoadDensity) return `${detail.loadDensity.toFixed(2)} load/min`;
    if (detail.intensity) return `${detail.intensity.toFixed(1)} intensity`;
    return '<span class="muted">-</span>';
  }
  if (type === "intervals") {
    if (!detail.workIntervalCount) return '<span class="muted">-</span>';
    return `${detail.workIntervalCount}× · avg ${formatDuration(Math.round(detail.workIntervalAvgS))}`
      + ` (±${formatDuration(Math.round(detail.workIntervalStdS))})`;
  }
  return formatDuration(detail.durationS);
}

function renderSimilarityResults(queryActivity, type, results) {
  const body = document.getElementById("similarity-results-body");
  body.innerHTML = "";
  results.forEach((entry, index) => {
    const { activity, score, detail } = entry;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index + 1}</td>
      <td>${activity.date || "-"}</td>
      <td>${activity.activity_type || "-"}</td>
      <td title="${activity.activity_name || ""}">${(activity.activity_name || "").slice(0, 42)}</td>
      <td class="right">${formatDuration(activity.moving_time_s)}</td>
      <td class="right similarity-score-cell">${Math.round(score * 100)}%</td>
      <td>${renderSimilarityDetail(type, detail)}</td>
      <td><button type="button" class="btn secondary similarity-open-btn" data-similarity-open-id="${activity.activity_id}">Open</button></td>
    `;
    body.appendChild(tr);
  });
  const statusEl = document.getElementById("similarity-status");
  const typeLabel = SIMILARITY_TYPE_LABELS[type] || type;
  if (results.length === 0) {
    statusEl.textContent = queryActivity
      ? `No activities of type "${queryActivity.activity_type}" met the minimum ${typeLabel.toLowerCase()} match against "${similarityActivityLabel(queryActivity)}".`
      : "";
  } else {
    statusEl.textContent = `${results.length} similar activit${results.length === 1 ? "y" : "ies"} `
      + `(by ${typeLabel.toLowerCase()}) found for "${similarityActivityLabel(queryActivity)}".`;
  }
}

async function handleSimilarityFind() {
  const select = document.getElementById("similarity-query-select");
  const queryId = select.value;
  const statusEl = document.getElementById("similarity-status");
  if (!queryId) {
    document.getElementById("similarity-results-body").innerHTML = "";
    statusEl.textContent = "Pick a query activity first.";
    return;
  }
  state.similarity.queryActivityId = queryId;
  const queryActivity = state.activities.find((a) => String(a.activity_id) === queryId);
  if (!queryActivity) {
    statusEl.textContent = "Could not find that activity — it may have been removed from the list.";
    return;
  }
  const type = document.getElementById("similarity-type-select").value || SIMILARITY_DEFAULT_TYPE;
  state.similarity.type = type;
  const minScore = (Number(document.getElementById("similarity-min-score").value) || 0) / 100;
  statusEl.textContent = "Searching…";
  const results = await findSimilarActivities(queryActivity, state.activities, {
    type,
    minScore,
    limit: 25,
  });
  state.similarity.results = results;
  renderSimilarityResults(queryActivity, type, results);
}

function addDays(dateIso, days) {
  const d = new Date(`${dateIso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatIsoDate(iso) {
  return String(iso || "").slice(0, 10);
}

function isStreamFallbackStatus(status) {
  return status === 400 || status === 422;
}

function isStreamUnavailableStatus(status) {
  return status === 400 || status === 404 || status === 422;
}

function intervalTooltip(item) {
  const z = item.zone;
  const zColor = ZONE_COLORS[z] || "#94a3b8";
  const name = (item.activity_name || "").slice(0, 36);
  return `<div style="line-height:1.7;font-size:12px">
    <div style="font-weight:700;font-size:13px;margin-bottom:2px">${item.date} · ${item.activity_type || ""}</div>
    <div style="color:#94a3b8;margin-bottom:4px">${name}</div>
    <div>Label: <b>${item.label || ""}</b></div>
    <div>Start: <b>${formatSeconds(item.start_index || 0)}</b> elapsed</div>
    <div>Time: <b>${formatSeconds(item.moving_time_s)}</b> &nbsp; Zone: <b style="color:${zColor}">Z${z || "–"}</b></div>
    <div>HR: <b>${Math.round(item.avg_hr || 0)}</b> avg / <b>${Math.round(item.max_hr || 0)}</b> max bpm</div>
  </div>`;
}

function compareIntervalsChronologically(a, b) {
  const aStart = String(a.activity_start_local || a.date || "");
  const bStart = String(b.activity_start_local || b.date || "");
  const byStart = aStart.localeCompare(bStart);
  if (byStart !== 0) return byStart;
  const byActivity = String(a.activity_id || "").localeCompare(String(b.activity_id || ""));
  if (byActivity !== 0) return byActivity;
  const byOffset = (Number(a.start_index) || 0) - (Number(b.start_index) || 0);
  if (byOffset !== 0) return byOffset;
  return (Number(a.interval_id) || 0) - (Number(b.interval_id) || 0);
}

function compareActivitiesChronologically(a, b) {
  const aStart = String(a.activity_start_local || a.date || "");
  const bStart = String(b.activity_start_local || b.date || "");
  const byStart = aStart.localeCompare(bStart);
  if (byStart !== 0) return byStart;
  return String(a.activity_id || "").localeCompare(String(b.activity_id || ""));
}

