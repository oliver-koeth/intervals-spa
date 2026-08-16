/* ─── HR stream fetch (with cache) ──────────────────────────────────────── */
function toStreamArray(streamPart) {
  if (Array.isArray(streamPart)) return streamPart;
  if (streamPart && Array.isArray(streamPart.data)) return streamPart.data;
  return [];
}

function normalizeStravaStream(raw) {
  return {
    time: extractStreamArray(raw, ["time"]),
    heartrate: extractStreamArray(raw, ["heartrate"]),
    watts: extractStreamArray(raw, ["watts"]),
    distance: extractStreamArray(raw, ["distance"]),
    altitude: extractStreamArray(raw, ["altitude"]),
    grade: extractStreamArray(raw, ["grade_smooth"]),
    velocity: extractStreamArray(raw, ["velocity_smooth"]),
    pace: extractStreamArray(raw, ["pace"]),
    gap: extractStreamArray(raw, ["grade_adjusted_pace", "gap"]),
  };
}

async function fetchStravaStreamFromCandidates(candidates, settings, token) {
  let lastErr = null;
  for (const path of candidates) {
    try {
      const raw = await stravaGet(path, settings, token);
      return { raw, path };
    } catch (err) {
      lastErr = err;
      const msg = String(err?.message || "");
      if (!(msg.includes("404") || msg.includes("400"))) throw err;
    }
  }
  throw lastErr || new Error("Strava stream request failed.");
}

async function fetchHrStream(
  activityId,
  settings,
  source = "intervals",
  stravaEffortId = "",
  forceRefresh = false
) {
  const activityCacheKey = `${source}:${activityId}`;
  const effortCacheKey = source === "strava" && stravaEffortId ? `strava-effort:${stravaEffortId}` : "";

  const cacheCandidates = [activityCacheKey, effortCacheKey].filter(Boolean);
  if (forceRefresh) {
    for (const key of cacheCandidates) {
      delete hrStreamCache[key];
      localStorage.removeItem(HR_STREAM_LS_PREFIX + key);
    }
  } else {
    for (const key of cacheCandidates) {
      if (hrStreamCache[key]) return hrStreamCache[key];
      const stored = loadHrStreamFromStorage(key);
      if (stored && Array.isArray(stored.time) && Array.isArray(stored.heartrate)) {
        hrStreamCache[key] = stored;
        return stored;
      }
    }
  }

  let result;
  if (source === "strava") {
    const token = await refreshStravaTokenIfNeeded(settings);
    if (!token) throw new Error("No Strava access token. Use Connect Strava first.");
    try {
      const activityCandidates = [
        `/activities/${encodeURIComponent(activityId)}/streams?keys=time,heartrate,velocity_smooth,altitude&key_by_type=true`,
        `/activities/${encodeURIComponent(activityId)}/streams?keys=time,heartrate,velocity_smooth,altitude`,
      ];
      const { raw, path } = await fetchStravaStreamFromCandidates(activityCandidates, settings, token);
      const normalized = normalizeStravaStream(raw);
      result = {
        time: normalized.time,
        heartrate: normalized.heartrate,
        watts: normalized.watts,
        distance: normalized.distance,
        altitude: normalized.altitude,
        grade: normalized.grade,
        velocity: normalized.velocity,
        pace: normalized.pace,
        gap: normalized.gap,
        __stream_scope: "activity",
        __stream_path: path,
      };
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.includes("401")) {
        throw new Error("Strava token missing scope activity:read_all. Reconnect Strava in Settings.");
      }
      if (msg.includes("404") && stravaEffortId) {
        const effortCandidates = [
          `/segment_efforts/${encodeURIComponent(stravaEffortId)}/streams?keys=time,heartrate,velocity_smooth,altitude&key_by_type=true`,
          `/segment_efforts/${encodeURIComponent(stravaEffortId)}/streams?keys=time,heartrate,velocity_smooth,altitude`,
        ];
        const { raw: fallbackRaw, path } = await fetchStravaStreamFromCandidates(effortCandidates, settings, token);
        const normalized = normalizeStravaStream(fallbackRaw);
        result = {
          time: normalized.time,
          heartrate: normalized.heartrate,
          watts: normalized.watts,
          distance: normalized.distance,
          altitude: normalized.altitude,
          grade: normalized.grade,
          velocity: normalized.velocity,
          pace: normalized.pace,
          gap: normalized.gap,
          __stream_scope: "segment_effort",
          __segment_effort_id: stravaEffortId,
          __stream_path: path,
        };
      } else {
        throw err;
      }
    }

    if (!Array.isArray(result.time) || !Array.isArray(result.heartrate) || !result.time.length) {
      throw new Error("Strava HR stream unavailable for this effort/activity (no stream data returned).");
    }
  } else {
    const mode = resolveApiMode(settings.apiMode);
    if (mode === "proxy") {
      try {
        const qs = new URLSearchParams({ activity_id: activityId, api_key: settings.apiKey });
        const res = await fetch(`./api/streams?${qs}`);
        if (!res.ok) throw new Error(`Streams proxy error (${res.status})`);
        result = await res.json();
      } catch (err) {
        if (!isAutoProxyMode(settings.apiMode)) throw err;
        // Auto mode fallback: retry direct.
      }
    }

    if (!result) {
      const auth = `Basic ${btoa(`API_KEY:${settings.apiKey}`)}`;
      const fullStreamTypes = "heartrate,time,velocity_smooth,altitude";
      let res = await fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams?types=${fullStreamTypes}`,
        { headers: { Authorization: auth, Accept: "application/json" } }
      );
      if (!res.ok && isStreamFallbackStatus(res.status)) {
        res = await fetch(
          `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams?types=heartrate,time,velocity_smooth,altitude`,
          { headers: { Authorization: auth, Accept: "application/json" } }
        );
      }
      if (!res.ok && isStreamUnavailableStatus(res.status)) {
        throw new Error(`No stream data available (${res.status})`);
      }
      if (!res.ok) throw new Error(`Streams request failed (${res.status})`);
      const raw = await res.json();
      result = {
        time: extractStreamArray(raw, ["time"]),
        heartrate: extractStreamArray(raw, ["heartrate"]),
        watts: extractStreamArray(raw, ["watts", "power"]),
        distance: extractStreamArray(raw, ["distance"]),
        altitude: extractStreamArray(raw, ["altitude"]),
        grade: extractStreamArray(raw, ["grade_smooth", "grade"]),
        velocity: extractStreamArray(raw, ["velocity_smooth", "velocity", "speed"]),
        pace: extractStreamArray(raw, ["pace"]),
        gap: extractStreamArray(raw, ["grade_adjusted_pace", "gap"]),
      };
    }
  }

  const writeKey = source === "strava" && result?.__stream_scope === "segment_effort" && effortCacheKey
    ? effortCacheKey
    : activityCacheKey;
  hrStreamCache[writeKey] = result;
  saveHrStreamToStorage(writeKey, result);
  return result;
}

/** Extract the HR data points for a single interval from the full activity stream. */
function sliceHrStream(stream, startIndex, movingTimeS) {
  const safeStart = Number(startIndex) || 0;
  const endIndex = safeStart + (Number(movingTimeS) || 0);
  const points = [];
  for (let i = 0; i < stream.time.length; i++) {
    const t = stream.time[i];
    const hr = stream.heartrate[i];
    if (t >= safeStart && t < endIndex) {
      if (typeof hr === "number") points.push([(t - safeStart) / 60, hr]);
    }
  }
  return points;
}

function sliceMetricStream(stream, values, startIndex, movingTimeS, transform = (v) => v) {
  const safeStart = Number(startIndex) || 0;
  const endIndex = safeStart + (Number(movingTimeS) || 0);
  const timeArr = Array.isArray(stream?.time) ? stream.time : [];
  const dataArr = Array.isArray(values) ? values : [];
  const points = [];
  for (let i = 0; i < timeArr.length && i < dataArr.length; i++) {
    const t = Number(timeArr[i]);
    const raw = dataArr[i];
    if (!Number.isFinite(t) || t < safeStart || t >= endIndex) continue;
    const value = transform(raw);
    if (Number.isFinite(value)) points.push([(t - safeStart) / 60, value]);
  }
  return points;
}

function normalizeExplicitPaceValue(value) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  if (v > 20) return v / 60;   // seconds per km -> min/km
  if (v >= 2 && v <= 20) return v; // already min/km
  return null;
}

function buildPaceFromDistance(stream, startIndex, movingTimeS) {
  const safeStart = Number(startIndex) || 0;
  const endIndex = safeStart + (Number(movingTimeS) || 0);
  const timeArr = Array.isArray(stream?.time) ? stream.time : [];
  const distArr = Array.isArray(stream?.distance) ? stream.distance : [];
  const points = [];
  for (let i = 1; i < timeArr.length && i < distArr.length; i++) {
    const t = Number(timeArr[i]);
    const prevT = Number(timeArr[i - 1]);
    const d = Number(distArr[i]);
    const prevD = Number(distArr[i - 1]);
    if (!Number.isFinite(t) || !Number.isFinite(prevT) || t < safeStart || t >= endIndex) continue;
    if (!Number.isFinite(d) || !Number.isFinite(prevD) || d <= prevD) continue;
    const deltaMeters = d - prevD;
    const deltaSeconds = t - prevT;
    if (deltaMeters <= 0 || deltaSeconds <= 0) continue;
    const paceMinPerKm = (deltaSeconds / deltaMeters) * 1000 / 60;
    if (Number.isFinite(paceMinPerKm) && paceMinPerKm > 0) {
      points.push([(t - safeStart) / 60, paceMinPerKm]);
    }
  }
  return points;
}

function buildSecondaryStreamSeries(stream, startIndex, movingTimeS) {
  const gapPoints = sliceMetricStream(stream, stream?.gap, startIndex, movingTimeS, normalizeExplicitPaceValue);
  if (gapPoints.length) {
    return {
      kind: "pace",
      name: "GAP",
      unit: "min/km",
      points: gapPoints,
    };
  }

  const pacePoints = sliceMetricStream(stream, stream?.pace, startIndex, movingTimeS, normalizeExplicitPaceValue);
  if (pacePoints.length) {
    return {
      kind: "pace",
      name: "Pace",
      unit: "min/km",
      points: pacePoints,
    };
  }

  const velocityPoints = sliceMetricStream(
    stream,
    stream?.velocity,
    startIndex,
    movingTimeS,
    (v) => {
      const speed = Number(v);
      if (!Number.isFinite(speed) || speed <= 0) return null;
      const minPerKm = (1000 / speed) / 60;
      return minPerKm <= 20 ? minPerKm : null;
    }
  );
  if (velocityPoints.length) {
    return {
      kind: "pace",
      name: "Pace",
      unit: "min/km",
      points: velocityPoints,
    };
  }

  const distancePacePoints = buildPaceFromDistance(stream, startIndex, movingTimeS);
  if (distancePacePoints.length) {
    return {
      kind: "pace",
      name: "Pace",
      unit: "min/km",
      points: distancePacePoints,
    };
  }

  const wattsPoints = sliceMetricStream(stream, stream?.watts, startIndex, movingTimeS, (v) => Number(v));
  if (wattsPoints.length) {
    return {
      kind: "watts",
      name: "Watts",
      unit: "W",
      points: wattsPoints,
    };
  }

  return null;
}

function renderHrStreamChart(points, item, secondarySeries = null) {
  const avg  = Math.round(item.avg_hr || 0);
  const max  = Math.round(item.max_hr || 0);
  const model = getSelectedZoneModel();
  // Build visualMap pieces for HR zone colour bands
  const pieces = model ? model.hr_zones.map((upper, i) => {
    const lower = i === 0 ? 0 : model.hr_zones[i - 1];
    return { gte: lower, lt: upper, color: ZONE_COLORS[i + 1] || "#94a3b8", label: `Z${i+1}` };
  }).concat([{
    gte: model.hr_zones[model.hr_zones.length - 1],
    color: ZONE_COLORS[model.hr_zones.length] || "#ef4444",
    label: `Z${model.hr_zones.length}`,
  }]) : null;

  // Compute a sensible Y axis min: 10 bpm below the minimum HR value, rounded down to 10
  const minHr = points.reduce((m, p) => Math.min(m, p[1]), Infinity);
  const yMin = Math.max(60, Math.floor((isFinite(minHr) ? minHr - 10 : 60) / 10) * 10);

  const c = mkChart("hr-stream");
  c.setOption({
    title: {
      text: `HR stream: ${item.date}`,
      subtext: `${item.label || item.interval_type || ""} · avg ${avg} bpm · max ${max} bpm`,
      top: 6, textStyle: { fontSize: 12 }, subtextStyle: { fontSize: 10 },
    },
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const lines = [`${Number(params[0]?.value?.[0] || 0).toFixed(1)} min`];
        for (const p of params) {
          if (p.seriesName === "HR") lines.push(`HR ${Math.round(p.value[1])} bpm`);
          else if (secondarySeries?.kind === "watts") lines.push(`${p.seriesName} ${Math.round(p.value[1])} W`);
          else lines.push(`${p.seriesName} ${formatPaceMinutes(p.value[1])} min/km`);
        }
        return lines.join(" · ");
      },
    },
    ...(pieces ? { visualMap: { show: false, type: "piecewise", dimension: 1, seriesIndex: 0, pieces } } : {}),
    grid: { left: 42, right: secondarySeries ? 52 : 20, top: 52, bottom: 28 },
    xAxis: { type: "value", name: "min", nameLocation: "end" },
    yAxis: [
      { type: "value", name: "bpm", min: yMin },
      ...(secondarySeries ? [{
        type: "value",
        name: secondarySeries.unit,
        alignTicks: true,
        inverse: secondarySeries.kind === "pace",
        ...(secondarySeries.kind === "pace" ? { max: 20 } : {}),
        axisLabel: secondarySeries.kind === "pace"
          ? { formatter: (v) => formatPaceMinutes(v) }
          : { formatter: (v) => Math.round(v) },
      }] : []),
    ],
    series: [
      {
        type: "line", name: "HR", smooth: true, showSymbol: false,
        lineStyle: { width: 2 },
        areaStyle: { opacity: 0.18 },
        data: points,
      },
      ...(secondarySeries ? [{
        type: "line",
        name: secondarySeries.name,
        yAxisIndex: 1,
        smooth: true,
        showSymbol: false,
        lineStyle: { width: 2 },
        data: secondarySeries.points,
      }] : []),
    ],
  });
}

/** Count HR stream points per zone. Returns array of second-counts, one per zone. */
function computeZoneHistogram(points, model) {
  const n = model.hr_zones.length;
  const counts = new Array(n).fill(0);
  for (const [, hr] of points) {
    let placed = false;
    for (let i = 0; i < n; i++) {
      if (hr <= model.hr_zones[i]) { counts[i]++; placed = true; break; }
    }
    if (!placed) counts[n - 1]++;  // above last boundary → top zone
  }
  return counts;
}

function renderZoneHistogram(points, item, model) {
  const counts = computeZoneHistogram(points, model);
  const labels = shortZoneLabels(model.hr_zones.length);
  const c = mkChart("zones");
  c.setOption({
    title: {
      text: `Zone distribution: ${item.date}`,
      subtext: (item.activity_name || "").slice(0, 36),
      top: 6, textStyle: { fontSize: 12 }, subtextStyle: { fontSize: 10 },
    },
    tooltip: {
      trigger: "axis",
      formatter: (p) => `${p[0].name}: ${formatSeconds(p[0].value)}`,
    },
    grid: { left: 48, right: 16, top: 52, bottom: 28 },
    xAxis: { type: "category", data: labels, axisLabel: { interval: 0 } },
    yAxis: { type: "value", axisLabel: { formatter: (v) => formatSeconds(v) } },
    series: [{ type: "bar", data: counts.map((v, i) => ({
      value: v, itemStyle: { color: ZONE_COLORS[i + 1] || "#94a3b8" },
    })) }],
  });
}

function renderZoneFallback(item) {
  // No zone model: show single-bar (the interval's assigned zone)
  const z = item.zone;
  const c = mkChart("zones");
  c.setOption({
    title: {
      text: `Zone: ${item.date}`, subtext: "Load a zone model in Settings for HR histogram",
      top: 6, textStyle: { fontSize: 12 }, subtextStyle: { fontSize: 10, color: "#94a3b8" },
    },
    grid: { left: 36, right: 16, top: 52, bottom: 28 },
    xAxis: { type: "category", data: [1,2,3,4,5].map((v) => `Z${v}`), axisLabel: { interval: 0 } },
    yAxis: { type: "value" },
    series: [{ type: "bar", data: [1,2,3,4,5].map((v) => ({
      value: v === z ? 1 : 0, itemStyle: { color: ZONE_COLORS[v] || "#94a3b8" },
    })) }],
  });
}

function renderRow2Empty() {
  const placeholder = (id) => {
    const c = mkChart(id);
    c.setOption({ graphic: [{ type: "text", left: "center", top: "middle",
      style: { text: "Click an interval above", fill: "#64748b", fontSize: 13 } }],
      xAxis: { show: false }, yAxis: { show: false }, series: [] });
  };
  placeholder("zones");
  placeholder("hr-stream");
}

/**
 * Fetch and cache the start_date_local of a Strava activity.
 * Used to compute the correct stream offset for segment efforts.
 */
async function fetchStravaActivityStart(activityId, settings, token) {
  if (stravaActivityStartCache[activityId] !== undefined) {
    return stravaActivityStartCache[activityId];
  }
  try {
    const act = await stravaGet(`/activities/${activityId}`, settings, token);
    const t = act.start_date_local || act.start_date || "";
    stravaActivityStartCache[activityId] = t;
    return t;
  } catch {
    stravaActivityStartCache[activityId] = "";
    return "";
  }
}

/**
 * Fetch and cache start_date_local of a Strava segment effort.
 * Used as fallback for legacy cached rows missing effort_start_iso.
 */
async function fetchStravaEffortStart(effortId, settings, token) {
  if (!effortId) return "";
  if (stravaEffortStartCache[effortId] !== undefined) {
    return stravaEffortStartCache[effortId];
  }
  try {
    const effort = await stravaGet(`/segment_efforts/${effortId}`, settings, token);
    const t = effort.start_date_local || effort.start_date || "";
    stravaEffortStartCache[effortId] = t;
    return t;
  } catch {
    stravaEffortStartCache[effortId] = "";
    return "";
  }
}

async function renderRow2(item) {
  if (!item) { renderRow2Empty(); return; }

  // Show loading placeholders for both charts while stream is fetching
  const loadPlaceholder = (id, title, sub) => {
    const c = mkChart(id);
    c.setOption({ title: { text: title, subtext: sub || "Loading…",
      top: 6, textStyle: { fontSize: 12 }, subtextStyle: { fontSize: 10, color: "#94a3b8" } },
      xAxis: { show: false }, yAxis: { show: false }, series: [] });
  };
  loadPlaceholder("zones",     `Zone distribution: ${item.date}`);
  loadPlaceholder("hr-stream", `HR stream: ${item.date}`);

  try {
    const settings = getSettings();
    const effortIdForStream = item.strava_effort_id || parseStravaEffortId(item.interval_id);
    const stream = await fetchHrStream(
      item.activity_id,
      settings,
      item.source || "intervals",
      effortIdForStream
    );
    const diag = {
      source: item.source || "intervals",
      interval_id: item.interval_id,
      activity_id: item.activity_id,
      strava_effort_id: effortIdForStream || "",
      label: item.label || "",
      date: item.date || "",
      moving_time_s: Number(item.moving_time_s || 0),
      avg_hr_metadata: Number(item.avg_hr || 0),
      max_hr_metadata: Number(item.max_hr || 0),
      item_start_index: Number(item.start_index || 0),
      effort_start_iso: item.effort_start_iso || "",
      activity_start_local: item.activity_start_local || "",
      stream_time_len: Array.isArray(stream?.time) ? stream.time.length : 0,
      stream_hr_len: Array.isArray(stream?.heartrate) ? stream.heartrate.length : 0,
      stream_watts_len: Array.isArray(stream?.watts) ? stream.watts.length : 0,
      stream_distance_len: Array.isArray(stream?.distance) ? stream.distance.length : 0,
      stream_altitude_len: Array.isArray(stream?.altitude) ? stream.altitude.length : 0,
      stream_grade_len: Array.isArray(stream?.grade) ? stream.grade.length : 0,
      stream_velocity_len: Array.isArray(stream?.velocity) ? stream.velocity.length : 0,
      stream_pace_len: Array.isArray(stream?.pace) ? stream.pace.length : 0,
      stream_gap_len: Array.isArray(stream?.gap) ? stream.gap.length : 0,
      stream_scope: stream?.__stream_scope || "unknown",
      stream_path: stream?.__stream_path || "",
    };

    // For Strava items, recompute the true stream offset using the effort's
    // absolute start time vs the activity's actual start time.
    // This is necessary because the all_efforts path cannot pre-compute the
    // offset without fetching the parent activity.
    let startIndex = Number(item.start_index) || 0;
    if (item.source === "strava" && item.activity_id) {
      const token = await refreshStravaTokenIfNeeded(settings);
      const activityStartIso = await fetchStravaActivityStart(item.activity_id, settings, token);
      let effortStartIso = item.effort_start_iso || "";
      const effortId = effortIdForStream;
      if (!effortStartIso && effortId) {
        effortStartIso = await fetchStravaEffortStart(effortId, settings, token);
      }
      const effortEpoch   = Date.parse(effortStartIso);
      const activityEpoch = Date.parse(activityStartIso);
      if (activityStartIso && Number.isFinite(effortEpoch) && Number.isFinite(activityEpoch)) {
        startIndex = Math.max(0, Math.round((effortEpoch - activityEpoch) / 1000));
      }
      diag.strava_effort_id = effortId || "";
      diag.effort_start_iso_resolved = effortStartIso || "";
      diag.activity_start_iso = activityStartIso || "";
      diag.effort_epoch = Number.isFinite(effortEpoch) ? effortEpoch : null;
      diag.activity_epoch = Number.isFinite(activityEpoch) ? activityEpoch : null;
      if (stream?.__stream_scope === "segment_effort") {
        // Segment-effort streams already start at effort t=0.
        startIndex = 0;
      }
      // startIndex is now elapsed seconds — sliceHrStream can use it directly.
    } else {
      // intervals.icu: start_index is an array index into the stream, NOT elapsed seconds.
      // GPS devices often record at 2 s or variable rate, so index ≠ seconds.
      // Resolve via stream.time[start_index] to get the true elapsed-seconds offset.
      const timeArr = Array.isArray(stream.time) ? stream.time : [];
      if (timeArr.length > 0) {
        const idx = Math.min(startIndex, timeArr.length - 1);
        startIndex = Number(timeArr[idx]) || 0;
      }
    }

    const points = sliceHrStream(stream, startIndex, item.moving_time_s);
    const secondarySeries = buildSecondaryStreamSeries(stream, startIndex, item.moving_time_s);
    diag.computed_start_s = startIndex;
    diag.points_count = points.length;
    diag.points_first = points[0] || null;
    diag.points_last = points[points.length - 1] || null;
    const safeStartIdx = Math.max(0, Math.min(startIndex, (stream?.time?.length || 1) - 1));
    diag.stream_time_head = (stream?.time || []).slice(0, 12);
    diag.stream_hr_head = (stream?.heartrate || []).slice(0, 12);
    diag.stream_time_at_start = (stream?.time || []).slice(safeStartIdx, safeStartIdx + 12);
    diag.stream_hr_at_start = (stream?.heartrate || []).slice(safeStartIdx, safeStartIdx + 12);
    diag.points_sample = points.slice(0, 20);
    if (points.length) {
      const sum = points.reduce((acc, p) => acc + Number(p[1] || 0), 0);
      diag.points_avg_hr = +(sum / points.length).toFixed(1);
    } else {
      diag.points_avg_hr = null;
    }
    diag.secondary_series = secondarySeries ? {
      kind: secondarySeries.kind,
      name: secondarySeries.name,
      points_count: secondarySeries.points.length,
      sample: secondarySeries.points.slice(0, 10),
    } : null;
    writeHrDiagnostics(diag);

    // Zone chart — histogram from HR stream if model available, fallback otherwise
    const model = getSelectedZoneModel();
    if (model && points.length > 0) {
      renderZoneHistogram(points, item, model);
    } else {
      renderZoneFallback(item);
    }

    // HR stream chart
    if (points.length > 0) {
      renderHrStreamChart(points, item, secondarySeries);
    } else {
      loadPlaceholder("hr-stream", `HR stream: ${item.date}`, "No HR data in stream");
    }
  } catch (err) {
    console.warn("HR stream fetch failed:", err);
    writeHrDiagnostics({
      source: item?.source || "intervals",
      interval_id: item?.interval_id || null,
      activity_id: item?.activity_id || null,
      error: String(err?.message || err || "Unknown error"),
    });
    renderZoneFallback(item);
    loadPlaceholder("hr-stream", `HR stream: ${item.date}`, `Error: ${err.message}`);
  }
}

function attachRow1Click(chartName, indexFn) {
  const c = state.charts[chartName];
  if (!c) return;
  let lastIndex = -1;
  let lastPickAt = 0;

  function selectByIndex(index) {
    const idx = Number(index);
    if (!Number.isFinite(idx)) return;
    const rounded = Math.round(idx);
    const now = Date.now();
    if (rounded === lastIndex && now - lastPickAt < 250) return;
    lastIndex = rounded;
    lastPickAt = now;
    const item = state.compareSource[rounded] ?? null;
    if (!item) return;
    state.pinnedInterval = item;
    renderRow2(item);
  }

  c.on("click", (params) => {
    selectByIndex(indexFn(params));
  });

  // Touch devices may not emit a useful series click for dense line charts.
  // Fallback: map tap position on the plot to nearest x-axis data index.
  const zr = c.getZr?.();
  zr?.on("click", (evt) => {
    if (!evt) return;
    const opt = c.getOption?.() || {};
    const xAxis = Array.isArray(opt.xAxis) ? opt.xAxis[0] : opt.xAxis;
    if (!xAxis || xAxis.type !== "category") return;
    const pixel = [evt.offsetX, evt.offsetY];
    if (!c.containPixel({ gridIndex: 0 }, pixel)) return;
    const dataPoint = c.convertFromPixel({ xAxisIndex: 0 }, pixel);
    const rawIndex = Array.isArray(dataPoint) ? dataPoint[0] : dataPoint;
    selectByIndex(rawIndex);
  });
}

function getCompareIndexLabel(index) {
  if (index < 9) return String(index + 1);
  return String.fromCharCode(65 + (index - 9));
}

function compareTabLabel(index, intervals) {
  return `${getCompareIndexLabel(index)} - ${intervals.length} Intervals`;
}

function renderCompareSidebar(hostId) {
  const list = document.getElementById(hostId);
  if (!list) return;
  list.innerHTML = "";
  const collapsed = document.querySelector("#sidebar.collapsed") != null;
  state.openCompareTabs.forEach(({ id, intervals }, index) => {
    const btn = document.createElement("button");
    btn.className = "btn activities-sidebar-item" + (id === state.activeCompareTabId ? " active" : "");
    btn.type = "button";
    btn.dataset.compareTabId = id;
    btn.title = compareTabLabel(index, intervals);
    btn.innerHTML = `<span class="activities-sidebar-label">${collapsed ? getCompareIndexLabel(index) : compareTabLabel(index, intervals)}</span>`
      + `<span class="activities-sidebar-close" data-close-compare-tab="${id}" title="Close">×</span>`;
    list.appendChild(btn);
  });
}

function updateCompareSidebars() {
  const hasTabs = state.openCompareTabs.length > 0;
  const onIntervals = state.screen === "intervals";
  const onCompare = state.screen === "compare";
  const intervalsSidebar = document.getElementById("intervals-compare-sidebar");
  const compareSidebar = document.getElementById("compare-sidebar");
  if (intervalsSidebar) intervalsSidebar.classList.toggle("hidden", !(onIntervals && hasTabs));
  if (compareSidebar) compareSidebar.classList.toggle("hidden", !(onCompare && hasTabs));
  if (onIntervals) renderCompareSidebar("intervals-compare-sidebar-list");
  if (onCompare) renderCompareSidebar("compare-sidebar-list");
}

function openCompareTab() {
  const selected = state.filtered.filter((x) => state.selected.has(String(x.interval_id)));
  const intervals = [...(selected.length ? selected : state.filtered)].sort(compareIntervalsChronologically);
  const id = `compare-${++state.compareTabCounter}`;
  state.openCompareTabs.push({ id, intervals });
  state.activeCompareTabId = id;
  updateCompareSidebars();
  setScreen("compare");
}

function closeCompareTab(id) {
  const idx = state.openCompareTabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  state.openCompareTabs.splice(idx, 1);
  if (state.activeCompareTabId === id) {
    const next = state.openCompareTabs[Math.max(0, idx - 1)];
    state.activeCompareTabId = next ? next.id : null;
    if (next && state.screen === "compare") {
      updateCompareSidebars();
      renderCompare();
    } else {
      updateCompareSidebars();
      if (state.screen === "compare") setScreen("intervals");
    }
  } else {
    updateCompareSidebars();
  }
}

function renderCompare() {
  const activeTab = state.openCompareTabs.find((t) => t.id === state.activeCompareTabId);
  const sel = state.filtered.filter((x) => state.selected.has(String(x.interval_id)));
  const src = activeTab?.intervals || (sel.length ? sel : state.filtered);
  state.compareSource = [...src].sort(compareIntervalsChronologically);
  state.pinnedInterval = null;
  document.getElementById("compare-summary").textContent =
    `${state.compareSource.length} interval(s) shown${activeTab ? "" : sel.length ? " (selected)" : " (all filtered)"}`;

  const sorted = state.compareSource;
  const dates  = sorted.map((x) => x.date);
  const stravaOnly = sorted.length > 0 && sorted.every((x) => x.source === "strava");
  const durationAxis = computeNiceDurationAxis(sorted.map((x) => x.moving_time_s));

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
    yAxis:  [
      { type: "value", name: "W" },
      stravaOnly
        ? {
          type: "value",
          name: "Time",
          min: durationAxis.min,
          max: durationAxis.max,
          interval: durationAxis.interval,
          axisLabel: { formatter: (v) => formatSeconds(v) },
        }
        : { type: "value", name: "Load" },
    ],
    series: [
      { type: "line", name: "Avg W",      smooth: true, data: sorted.map((x) => x.avg_watts) },
      {
        type: "line",
        name: stravaOnly ? "Seg time" : "Load",
        yAxisIndex: 1,
        smooth: true,
        data: stravaOnly
          ? sorted.map((x) => Number(x.moving_time_s || 0))
          : sorted.map((x) => +((x.training_load || 0).toFixed(2))),
      },
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

  renderRow2Empty();
}
