/* ─── Race Analysis ───────────────────────────────────────────────────────── */
const RACE_EARTH_RADIUS_M = 6371000;
const RACE_COLORS = [SERIES_COLORS.pace, SERIES_COLORS.glucose, SERIES_COLORS.power, SERIES_COLORS.gap];
const RACE_MOVING_THRESHOLD_M_S = 0.20;

function raceFinite(value) { return Number.isFinite(value); }

function raceFormatNumber(value, decimals = 0) {
  if (!raceFinite(value)) return "-";
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function raceFormatDuration(seconds) {
  if (!raceFinite(seconds)) return "-";
  let total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  total -= h * 3600;
  const m = Math.floor(total / 60);
  const s = total - m * 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function raceFormatPace(seconds) {
  if (!raceFinite(seconds) || seconds <= 0) return "-";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function raceFormatDeltaSeconds(seconds) {
  if (!raceFinite(seconds)) return "-";
  return `${seconds >= 0 ? "+" : "-"}${raceFormatDuration(Math.abs(seconds))}`;
}

function raceSanitizeName(value) {
  return String(value).replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "race-analysis";
}

function raceEscapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function raceSum(values) {
  let result = 0;
  for (const value of values) result += value;
  return result;
}

function raceMedian(values) {
  if (!values.length) return NaN;
  const copy = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(copy.length / 2);
  return copy.length % 2 ? copy[mid] : (copy[mid - 1] + copy[mid]) / 2;
}

function racePercentile(values, p) {
  const sorted = values.filter(raceFinite).slice().sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const index = (sorted.length - 1) * p / 100;
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  const frac = index - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function raceRolling(values, width, reducer) {
  const half = Math.floor(width / 2);
  return values.map((_, index) => {
    const window = [];
    for (let i = Math.max(0, index - half); i <= Math.min(values.length - 1, index + half); i++) {
      if (raceFinite(values[i])) window.push(values[i]);
    }
    return window.length ? reducer(window) : NaN;
  });
}

function raceLowerBound(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function raceUpperBound(values, target) {
  let lo = 0;
  let hi = values.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[mid] <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function raceInterpolate(xs, ys, x) {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  const hi = raceUpperBound(xs, x);
  const lo = hi - 1;
  const fraction = (x - xs[lo]) / (xs[hi] - xs[lo]);
  return ys[lo] + fraction * (ys[hi] - ys[lo]);
}

function racePrefix(values) {
  const output = new Float64Array(values.length + 1);
  for (let i = 0; i < values.length; i++) output[i + 1] = output[i] + (raceFinite(values[i]) ? values[i] : 0);
  return output;
}

function raceRangeSum(pref, start, end) {
  return pref[end] - pref[start];
}

function raceHaversine(a, b) {
  const toRad = Math.PI / 180;
  const lat1 = a.lat * toRad;
  const lat2 = b.lat * toRad;
  const dLat = (b.lat - a.lat) * toRad;
  const dLon = (b.lon - a.lon) * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * RACE_EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function raceMinettiFactor(grade) {
  const g = Math.max(-0.30, Math.min(0.45, grade));
  const cost = 155.4 * g ** 5 - 30.4 * g ** 4 - 43.3 * g ** 3 + 46.3 * g ** 2 + 19.5 * g + 3.6;
  return Math.max(0.45, Math.min(6.0, cost / 3.6));
}

function parseRaceGpx(xmlText, fallbackTitle) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  const parserError = doc.getElementsByTagName("parsererror")[0];
  if (parserError) throw new Error("The selected file is not valid GPX/XML.");
  const trackPoints = Array.from(doc.getElementsByTagNameNS("*", "trkpt"));
  if (trackPoints.length < 2) throw new Error("The GPX must contain at least two track points.");

  let title = fallbackTitle.replace(/\.gpx$/i, "");
  const tracks = Array.from(doc.getElementsByTagNameNS("*", "trk"));
  if (tracks[0]) {
    const directName = Array.from(tracks[0].children).find((node) => node.localName === "name");
    if (directName && directName.textContent.trim()) title = directName.textContent.trim();
  }

  const readFirst = (point, localName) => {
    const node = point.getElementsByTagNameNS("*", localName)[0];
    return node ? node.textContent.trim() : "";
  };
  const readNumber = (point, localName) => {
    const value = readFirst(point, localName);
    return value === "" ? NaN : Number(value);
  };
  const points = trackPoints
    .map((point) => {
      const timeText = readFirst(point, "time");
      return {
        lat: Number(point.getAttribute("lat")),
        lon: Number(point.getAttribute("lon")),
        ele: readNumber(point, "ele"),
        time: Date.parse(timeText),
        hr: readNumber(point, "hr"),
        cad: readNumber(point, "cad"),
        power: readNumber(point, "power"),
      };
    })
    .filter((point) => raceFinite(point.lat) && raceFinite(point.lon) && raceFinite(point.ele) && raceFinite(point.time))
    .sort((a, b) => a.time - b.time)
    .filter((point, index, rows) => index === 0 || point.time !== rows[index - 1].time);

  if (points.length < 2) throw new Error("The GPX does not contain enough timestamped track points.");
  return { title, sourceName: fallbackTitle, points };
}

function raceStreamToParsed(activity, stream) {
  const time = Array.isArray(stream?.time) ? stream.time : [];
  const altitude = Array.isArray(stream?.altitude) ? stream.altitude : [];
  const distance = Array.isArray(stream?.distance) ? stream.distance : [];
  const velocity = Array.isArray(stream?.velocity) ? stream.velocity : [];
  if (time.length < 2) throw new Error("The selected activity has no usable time stream.");
  if (!altitude.length) throw new Error("The selected activity has no elevation stream.");

  const startMs = new Date(activity.activity_start_local || activity.date || Date.now()).getTime();
  const hasDistance = distance.some((v) => raceFinite(Number(v)) && Number(v) > 0);
  let cumulative = 0;
  const points = [];
  for (let i = 0; i < time.length; i++) {
    const t = Number(time[i]);
    const ele = Number(altitude[i]);
    if (!raceFinite(t) || !raceFinite(ele)) continue;
    if (hasDistance) {
      cumulative = Math.max(cumulative, Number(distance[i]) || cumulative);
    } else if (i > 0) {
      const dt = Math.max(0, t - Number(time[i - 1] || 0));
      const speed = Number(velocity[i]);
      if (raceFinite(speed) && speed > 0 && dt <= 30) cumulative += speed * dt;
    }
    points.push({
      ele,
      time: raceFinite(startMs) ? startMs + t * 1000 : t * 1000,
      hr: Number(stream.heartrate?.[i]),
      power: Number(stream.watts?.[i]),
      cad: Number(stream.cadence?.[i]),
      cumInput: cumulative,
    });
  }
  if (points.length < 2 || points[points.length - 1].cumInput <= 0) {
    throw new Error("The selected activity stream has no usable distance data.");
  }
  return {
    title: activity.activity_name || activity.date || "Cached activity",
    sourceName: `${activity.source || "intervals"} activity ${activity.activity_id || ""}`.trim(),
    points,
  };
}

function prepareRacePoints(points) {
  let cumulative = 0;
  const hasInputDistance = points.some((point) => raceFinite(point.cumInput));
  for (let i = 0; i < points.length; i++) {
    const dt = i ? (points[i].time - points[i - 1].time) / 1000 : 0;
    const rawStep = i
      ? (hasInputDistance ? Math.max(0, points[i].cumInput - points[i - 1].cumInput) : raceHaversine(points[i - 1], points[i]))
      : 0;
    const speed = dt > 0 ? rawStep / dt : 0;
    const plausible = dt > 0 && dt <= 30 && speed < 10;
    const step = plausible ? rawStep : 0;
    cumulative += step;
    Object.assign(points[i], {
      dt,
      rawSpeed: speed,
      plausible,
      step,
      cum: cumulative,
      moving: plausible && speed >= RACE_MOVING_THRESHOLD_M_S,
    });
  }
  if (cumulative <= 0) throw new Error("The source does not contain enough valid distance movement.");

  const distanceGrid = [];
  const rawElevation = [];
  const pointDistances = points.map((point) => point.cum);
  const elevations = points.map((point) => point.ele);
  for (let distanceM = 0; distanceM <= cumulative + 10; distanceM += 10) {
    distanceGrid.push(distanceM);
    rawElevation.push(raceInterpolate(pointDistances, elevations, distanceM));
  }
  const medElevation = raceRolling(rawElevation, 5, raceMedian);
  const smoothElevation = raceRolling(medElevation, 5, (values) => raceSum(values) / values.length);
  const profile = distanceGrid.map((distance, index) => ({ distance, ele: smoothElevation[index] }));
  const profileDistances = profile.map((row) => row.distance);
  const profileElevations = profile.map((row) => row.ele);
  for (const point of points) {
    const beforeDistance = Math.max(0, point.cum - 50);
    const afterDistance = Math.min(profileDistances[profileDistances.length - 1], point.cum + 50);
    const span = afterDistance - beforeDistance;
    const grade = span > 0
      ? (raceInterpolate(profileDistances, profileElevations, afterDistance) - raceInterpolate(profileDistances, profileElevations, beforeDistance)) / span
      : 0;
    Object.assign(point, {
      grade,
      gapFactor: raceMinettiFactor(grade),
      movingS: point.moving ? point.dt : 0,
      elapsedS: point.dt >= 0 && point.dt <= 300 ? point.dt : 0,
      equivStep: point.moving ? point.step * raceMinettiFactor(grade) : 0,
    });
  }
  return makeRaceContext(points, profile);
}

function makeRaceContext(points, profile) {
  const pointDistances = points.map((point) => point.cum);
  const profileDistances = profile.map((row) => row.distance);
  const profileElevations = profile.map((row) => row.ele);
  const delta = profile.map((row, index) => index ? row.ele - profile[index - 1].ele : 0);
  const arrays = {
    step: points.map((point) => point.step),
    movingS: points.map((point) => point.movingS),
    elapsedS: points.map((point) => point.elapsedS),
    equivStep: points.map((point) => point.equivStep),
    hrWeight: points.map((point) => raceFinite(point.hr) ? point.movingS : 0),
    hrWeighted: points.map((point) => raceFinite(point.hr) ? point.hr * point.movingS : 0),
    powerWeight: points.map((point) => raceFinite(point.power) ? point.movingS : 0),
    powerWeighted: points.map((point) => raceFinite(point.power) ? point.power * point.movingS : 0),
    cadWeight: points.map((point) => raceFinite(point.cad) ? point.movingS : 0),
    cadWeighted: points.map((point) => raceFinite(point.cad) ? point.cad * point.movingS : 0),
  };
  const pref = {};
  Object.entries(arrays).forEach(([key, values]) => { pref[key] = racePrefix(values); });
  return {
    points,
    profile,
    pointDistances,
    profileDistances,
    profileElevations,
    pref,
    profileGainPrefix: racePrefix(delta.map((value) => Math.max(0, value))),
    profileLossPrefix: racePrefix(delta.map((value) => Math.max(0, -value))),
    totalM: pointDistances[pointDistances.length - 1],
  };
}

function raceSegmentMetrics(ctx, startM, endM) {
  const start = raceUpperBound(ctx.pointDistances, startM);
  const end = raceUpperBound(ctx.pointDistances, endM);
  const pStart = raceLowerBound(ctx.profileDistances, startM);
  const pEnd = raceUpperBound(ctx.profileDistances, endM);
  const get = (key) => raceRangeSum(ctx.pref[key], start, end);
  const distanceM = get("step");
  const movingS = get("movingS");
  const elapsedS = get("elapsedS");
  const equivM = get("equivStep");
  const hrWeight = get("hrWeight");
  const powerWeight = get("powerWeight");
  const cadWeight = get("cadWeight");
  const gainM = raceRangeSum(ctx.profileGainPrefix, pStart, pEnd);
  const lossM = raceRangeSum(ctx.profileLossPrefix, pStart, pEnd);
  const netM = raceInterpolate(ctx.profileDistances, ctx.profileElevations, endM) - raceInterpolate(ctx.profileDistances, ctx.profileElevations, startM);
  const avgHr = hrWeight ? get("hrWeighted") / hrWeight : NaN;
  return {
    startKm: startM / 1000,
    endKm: endM / 1000,
    distanceKm: distanceM / 1000,
    movingS,
    elapsedS,
    stoppedS: Math.max(0, elapsedS - movingS),
    gainM,
    lossM,
    netM,
    paceSKm: distanceM ? movingS / (distanceM / 1000) : NaN,
    gapSKm: equivM ? movingS / (equivM / 1000) : NaN,
    avgHr,
    avgPower: powerWeight ? get("powerWeighted") / powerWeight : NaN,
    avgCadenceSpm: cadWeight ? 2 * get("cadWeighted") / cadWeight : NaN,
    efficiency: movingS && avgHr ? (equivM / movingS * 60) / avgHr : NaN,
    vamMH: movingS ? netM / (movingS / 3600) : NaN,
    avgGradePct: 100 * netM / Math.max(1, endM - startM),
  };
}

function raceFlattestWindow(ctx, quarterStart, quarterEnd, lengthM = 1500) {
  let best = null;
  for (let start = quarterStart; start <= Math.max(quarterStart, quarterEnd - lengthM); start += 50) {
    const end = Math.min(start + lengthM, quarterEnd);
    if (end - start < 1200) continue;
    const metrics = raceSegmentMetrics(ctx, start, end);
    const score = (metrics.gainM + metrics.lossM + Math.abs(metrics.netM)) / metrics.distanceKm;
    if (!best || score < best.score) best = { score, metrics };
  }
  return best ? best.metrics : raceSegmentMetrics(ctx, quarterStart, quarterEnd);
}

function raceSteepestNetWindow(ctx, quarterStart, quarterEnd, riseM = 100, direction = 1) {
  const startIndex = raceLowerBound(ctx.profileDistances, quarterStart);
  const endIndex = raceUpperBound(ctx.profileDistances, quarterEnd);
  let best = null;
  for (let i = startIndex; i < endIndex; i += 5) {
    for (let j = i + 1; j < endIndex; j++) {
      if (direction * (ctx.profileElevations[j] - ctx.profileElevations[i]) < riseM) continue;
      const length = ctx.profileDistances[j] - ctx.profileDistances[i];
      if (length >= 250 && length <= 6000) {
        const grade = riseM / length;
        if (!best || grade > best.grade) best = { grade, start: ctx.profileDistances[i], end: ctx.profileDistances[j] };
      }
      break;
    }
  }
  return best ? raceSegmentMetrics(ctx, best.start, best.end) : null;
}

function raceStationaryClusters(points, minimumS = 3) {
  const clusters = [];
  let current = null;
  const raceStart = points[0].time;
  const finish = () => {
    if (current && current.duration >= minimumS) {
      clusters.push({
        km: current.distanceWeight ? current.distanceSum / current.distanceWeight / 1000 : current.startCum / 1000,
        elapsedAtStartS: (current.startTime - raceStart) / 1000,
        durationS: current.duration,
        avgHr: current.hrWeight ? current.hrWeighted / current.hrWeight : NaN,
      });
    }
    current = null;
  };
  for (const point of points) {
    const stationary = point.dt > 0 && point.dt <= 30 && point.rawSpeed < RACE_MOVING_THRESHOLD_M_S;
    if (!stationary) {
      finish();
      continue;
    }
    if (!current) current = { startTime: point.time, startCum: point.cum, duration: 0, distanceSum: 0, distanceWeight: 0, hrWeighted: 0, hrWeight: 0 };
    current.duration += point.dt;
    current.distanceSum += point.cum * point.dt;
    current.distanceWeight += point.dt;
    if (raceFinite(point.hr)) {
      current.hrWeighted += point.hr * point.dt;
      current.hrWeight += point.dt;
    }
  }
  finish();
  return clusters.sort((a, b) => a.km - b.km || a.elapsedAtStartS - b.elapsedAtStartS);
}

function raceTerrainBandSummary(ctx) {
  const bands = [
    ["steep_up", 0.10, Infinity],
    ["moderate_up", 0.03, 0.10],
    ["flat", -0.03, 0.03],
    ["moderate_down", -0.10, -0.03],
    ["steep_down", -Infinity, -0.10],
  ];
  const output = [];
  for (let quarter = 0; quarter < 4; quarter++) {
    const start = quarter * ctx.totalM / 4;
    const end = (quarter + 1) * ctx.totalM / 4;
    for (const [label, low, high] of bands) {
      const acc = { distanceM: 0, movingS: 0, equivM: 0, hrW: 0, hrWeight: 0, powerW: 0, powerWeight: 0, cadW: 0, cadWeight: 0 };
      for (const point of ctx.points) {
        if (!point.moving || point.cum <= start || point.cum > end || point.grade < low || point.grade >= high) continue;
        acc.distanceM += point.step;
        acc.movingS += point.movingS;
        acc.equivM += point.equivStep;
        if (raceFinite(point.hr)) {
          acc.hrW += point.hr * point.movingS;
          acc.hrWeight += point.movingS;
        }
        if (raceFinite(point.power)) {
          acc.powerW += point.power * point.movingS;
          acc.powerWeight += point.movingS;
        }
        if (raceFinite(point.cad)) {
          acc.cadW += point.cad * point.movingS;
          acc.cadWeight += point.movingS;
        }
      }
      if (acc.distanceM < 100 || !acc.movingS) continue;
      output.push({
        quarter: quarter + 1,
        terrain: label,
        distanceKm: acc.distanceM / 1000,
        movingS: acc.movingS,
        paceSKm: acc.movingS / (acc.distanceM / 1000),
        gapSKm: acc.equivM ? acc.movingS / (acc.equivM / 1000) : NaN,
        avgHr: acc.hrWeight ? acc.hrW / acc.hrWeight : NaN,
        avgPower: acc.powerWeight ? acc.powerW / acc.powerWeight : NaN,
        avgCadenceSpm: acc.cadWeight ? 2 * acc.cadW / acc.cadWeight : NaN,
      });
    }
  }
  return output;
}

function raceNormalizedQuarterSeries(ctx, metric, bins = 80) {
  const output = [];
  const quarterLength = ctx.totalM / 4;
  for (let quarter = 0; quarter < 4; quarter++) {
    const buckets = Array.from({ length: bins }, () => ({ movingS: 0, distanceM: 0, equivM: 0, hrW: 0, hrWeight: 0 }));
    const start = quarter * quarterLength;
    const end = (quarter + 1) * quarterLength;
    for (const point of ctx.points) {
      if (!point.moving || point.cum < start || point.cum > end) continue;
      const progress = (point.cum - start) / quarterLength;
      const bucket = buckets[Math.min(bins - 1, Math.max(0, Math.floor(progress * bins)))];
      bucket.movingS += point.movingS;
      bucket.distanceM += point.step;
      bucket.equivM += point.equivStep;
      if (raceFinite(point.hr)) {
        bucket.hrW += point.hr * point.movingS;
        bucket.hrWeight += point.movingS;
      }
    }
    const ys = buckets.map((bucket) => {
      if (metric === "hr") return bucket.hrWeight ? bucket.hrW / bucket.hrWeight : NaN;
      const distance = metric === "gap" ? bucket.equivM : bucket.distanceM;
      return distance ? bucket.movingS / (distance / 1000) : NaN;
    });
    output.push({ x: buckets.map((_, index) => (index + 0.5) / bins), y: raceRolling(ys, 5, raceMedian) });
  }
  return output;
}

function raceGapHeartRateScatter(ctx, bins = 80) {
  const output = [];
  const quarterLength = ctx.totalM / 4;
  for (let quarter = 0; quarter < 4; quarter++) {
    const buckets = Array.from({ length: bins }, () => ({ movingS: 0, equivM: 0, distanceM: 0, hrW: 0, hrWeight: 0 }));
    const start = quarter * quarterLength;
    const end = (quarter + 1) * quarterLength;
    for (const point of ctx.points) {
      if (!point.moving || point.cum < start || point.cum > end) continue;
      const progress = (point.cum - start) / quarterLength;
      const bucket = buckets[Math.min(bins - 1, Math.max(0, Math.floor(progress * bins)))];
      bucket.movingS += point.movingS;
      bucket.equivM += point.equivStep;
      bucket.distanceM += point.step;
      if (raceFinite(point.hr)) {
        bucket.hrW += point.hr * point.movingS;
        bucket.hrWeight += point.movingS;
      }
    }
    output.push(buckets
      .filter((bucket) => bucket.equivM > 0 && bucket.hrWeight > 0 && bucket.distanceM >= 75)
      .map((bucket) => ({
        x: bucket.movingS / (bucket.equivM / 1000),
        y: bucket.hrW / bucket.hrWeight,
      })));
  }
  return output;
}

function raceSlopeHeartRateScatter(ctx, direction, bins = 80) {
  const output = [];
  const quarterLength = ctx.totalM / 4;
  for (let quarter = 0; quarter < 4; quarter++) {
    const buckets = Array.from({ length: bins }, () => ({ movingS: 0, distanceM: 0, gradeWeighted: 0, hrW: 0, hrWeight: 0 }));
    const start = quarter * quarterLength;
    const end = (quarter + 1) * quarterLength;
    for (const point of ctx.points) {
      if (!point.moving || point.cum < start || point.cum > end) continue;
      if (direction > 0 && point.grade <= 0) continue;
      if (direction < 0 && point.grade >= 0) continue;
      const progress = (point.cum - start) / quarterLength;
      const bucket = buckets[Math.min(bins - 1, Math.max(0, Math.floor(progress * bins)))];
      bucket.movingS += point.movingS;
      bucket.distanceM += point.step;
      bucket.gradeWeighted += point.grade * point.step;
      if (raceFinite(point.hr)) {
        bucket.hrW += point.hr * point.movingS;
        bucket.hrWeight += point.movingS;
      }
    }
    output.push(buckets
      .filter((bucket) => bucket.distanceM >= 75 && bucket.hrWeight > 0)
      .map((bucket) => ({
        x: 100 * bucket.gradeWeighted / bucket.distanceM,
        y: bucket.hrW / bucket.hrWeight,
      })));
  }
  return output;
}

const RACE_SLOPE_SEGMENTS = [
  { label: "0-5%", min: 0, max: 5 },
  { label: "5-10%", min: 5, max: 10 },
  { label: "10-15%", min: 10, max: 15 },
  { label: "15-20%", min: 15, max: 20 },
  { label: "20-30%", min: 20, max: 30 },
  { label: "30%+", min: 30, max: Infinity },
];

/**
 * Average VAM (vertical ascent/descent metres per hour) per slope segment per quarter,
 * binned with the same per-quarter increments as the slope-vs-HR scatter charts.
 */
function raceSlopeVamSegments(ctx, direction, bins = 80) {
  const quarterLength = ctx.totalM / 4;
  const quarters = [];
  for (let quarter = 0; quarter < 4; quarter++) {
    const buckets = Array.from({ length: bins }, () => ({ distanceM: 0, gradeWeighted: 0, verticalM: 0, movingS: 0 }));
    const start = quarter * quarterLength;
    const end = (quarter + 1) * quarterLength;
    for (const point of ctx.points) {
      if (!point.moving || point.cum < start || point.cum > end) continue;
      if (direction > 0 && point.grade <= 0) continue;
      if (direction < 0 && point.grade >= 0) continue;
      const progress = (point.cum - start) / quarterLength;
      const bucket = buckets[Math.min(bins - 1, Math.max(0, Math.floor(progress * bins)))];
      bucket.distanceM += point.step;
      bucket.gradeWeighted += point.grade * point.step;
      bucket.verticalM += point.grade * point.step;
      bucket.movingS += point.movingS;
    }
    const segAcc = RACE_SLOPE_SEGMENTS.map(() => ({ verticalM: 0, movingS: 0 }));
    for (const bucket of buckets) {
      if (bucket.distanceM < 75 || bucket.movingS <= 0) continue;
      const absSlope = Math.abs(100 * bucket.gradeWeighted / bucket.distanceM);
      const index = RACE_SLOPE_SEGMENTS.findIndex((seg) => absSlope >= seg.min && absSlope < seg.max);
      if (index < 0) continue;
      segAcc[index].verticalM += bucket.verticalM;
      segAcc[index].movingS += bucket.movingS;
    }
    quarters.push(segAcc.map((acc) => acc.movingS > 0 ? Math.abs(acc.verticalM) / (acc.movingS / 3600) : NaN));
  }
  return quarters;
}

function buildRaceResult(ctx, parsed) {
  const quarterLength = ctx.totalM / 4;
  const quarters = Array.from({ length: 4 }, (_, index) => raceSegmentMetrics(ctx, index * quarterLength, (index + 1) * quarterLength));
  const flatSections = Array.from({ length: 4 }, (_, index) => raceFlattestWindow(ctx, index * quarterLength, (index + 1) * quarterLength));
  const steepClimbs = Array.from({ length: 4 }, (_, index) => raceSteepestNetWindow(ctx, index * quarterLength, (index + 1) * quarterLength, 100, 1));
  const steepDescents = Array.from({ length: 4 }, (_, index) => raceSteepestNetWindow(ctx, index * quarterLength, (index + 1) * quarterLength, 100, -1));
  const overall = raceSegmentMetrics(ctx, 0, ctx.totalM);
  const firstHalf = raceSegmentMetrics(ctx, 0, ctx.totalM / 2);
  const secondHalf = raceSegmentMetrics(ctx, ctx.totalM / 2, ctx.totalM);
  const decouplingPct = (raceFinite(firstHalf.efficiency) && firstHalf.efficiency && raceFinite(secondHalf.efficiency))
    ? 100 * (firstHalf.efficiency - secondHalf.efficiency) / firstHalf.efficiency
    : NaN;
  Object.assign(overall, {
    title: parsed.title,
    sourceName: parsed.sourceName,
    startTime: new Date(ctx.points[0].time).toISOString(),
    endTime: new Date(ctx.points[ctx.points.length - 1].time).toISOString(),
    recordedElapsedS: (ctx.points[ctx.points.length - 1].time - ctx.points[0].time) / 1000,
    points: ctx.points.length,
    minEleM: Math.min(...ctx.profileElevations),
    maxEleM: Math.max(...ctx.profileElevations),
    firstHalfEfficiency: firstHalf.efficiency,
    secondHalfEfficiency: secondHalf.efficiency,
    aerobicDecouplingPct: decouplingPct,
  });
  return {
    method: {
      quarters: "equal distance",
      flatWindowM: 1500,
      steepWindow: "shortest smoothed-profile section with 100 m net rise/loss per quarter",
      gap: "Minetti grade-energy factor on a 50 m-smoothed profile; grade clipped to -30%/+45%",
      movingThresholdMS: RACE_MOVING_THRESHOLD_M_S,
      profileSpacingM: 10,
      smoothingM: 50,
    },
    overall,
    quarters,
    flatSections,
    steepClimbs,
    steepDescents,
    stationaryClusters: raceStationaryClusters(ctx.points),
    terrainBands: raceTerrainBandSummary(ctx),
    chart: {
      profile: ctx.profile,
      hr: raceNormalizedQuarterSeries(ctx, "hr"),
      pace: raceNormalizedQuarterSeries(ctx, "pace"),
      gap: raceNormalizedQuarterSeries(ctx, "gap"),
      gapHeartRate: raceGapHeartRateScatter(ctx),
      uphillHeartRate: raceSlopeHeartRateScatter(ctx, 1),
      downhillHeartRate: raceSlopeHeartRateScatter(ctx, -1),
      uphillVam: raceSlopeVamSegments(ctx, 1),
      downhillVam: raceSlopeVamSegments(ctx, -1),
    },
  };
}

/* ── Quarter suitability check ──────────────────────────────────────────────
 * Quarter analysis only makes sense when every quarter mixes climbing and
 * descending. On a single climb-then-descent ("un puerto") profile the halves
 * sit in opposite terrain regimes and the GAP:HR decoupling is a terrain
 * artifact. A quarter is "suitable" only if it contains both a contiguous
 * climb and a contiguous descent of at least RACE_MEANINGFUL_VERT_M. */
const RACE_MEANINGFUL_VERT_M = 50;

function raceQuarterSuitability(ctx) {
  const quarterLength = ctx.totalM / 4;
  const failing = [];
  for (let quarter = 0; quarter < 4; quarter++) {
    const start = quarter * quarterLength;
    const end = (quarter + 1) * quarterLength;
    const hasClimb = !!raceSteepestNetWindow(ctx, start, end, RACE_MEANINGFUL_VERT_M, 1);
    const hasDescent = !!raceSteepestNetWindow(ctx, start, end, RACE_MEANINGFUL_VERT_M, -1);
    if (!hasClimb || !hasDescent) {
      failing.push({ quarter: quarter + 1, hasClimb, hasDescent });
    }
  }
  return { suitable: failing.length === 0, failing };
}

/* ── Segment analysis (mode 2) ──────────────────────────────────────────────*/

/** Classify a selected distance range as a climb, a descent, or ambiguous.
 *  Small dips/hops are tolerated because classification is driven by the net
 *  vertical relative to the total vertical travel (ratio), not by requiring a
 *  monotonic profile. */
function raceClassifySegment(ctx, startM, endM) {
  const lo = Math.max(0, Math.min(startM, endM));
  const hi = Math.min(ctx.totalM, Math.max(startM, endM));
  if (hi - lo < 200) {
    return { type: null, message: "Selection is too short — drag across at least 200 m of a climb or descent." };
  }
  const iStart = raceLowerBound(ctx.profileDistances, lo);
  const iEnd = raceUpperBound(ctx.profileDistances, hi);
  let gainM = 0;
  let lossM = 0;
  for (let i = iStart + 1; i < iEnd; i++) {
    const delta = ctx.profileElevations[i] - ctx.profileElevations[i - 1];
    if (delta > 0) gainM += delta;
    else lossM -= delta;
  }
  const netM = raceInterpolate(ctx.profileDistances, ctx.profileElevations, hi)
    - raceInterpolate(ctx.profileDistances, ctx.profileElevations, lo);
  const totalVert = gainM + lossM;
  const ratio = totalVert > 0 ? Math.abs(netM) / totalVert : 0;
  const base = { startM: lo, endM: hi, netM, gainM, lossM, ratio };
  if (Math.abs(netM) < RACE_MEANINGFUL_VERT_M) {
    return { ...base, type: null, message: `Selection has only ${Math.abs(netM).toFixed(0)} m net change — not a meaningful climb or descent (need ≥ ${RACE_MEANINGFUL_VERT_M} m).` };
  }
  if (ratio < 0.5) {
    return { ...base, type: null, message: `Selection is rolling/mixed terrain (${gainM.toFixed(0)} m up, ${lossM.toFixed(0)} m down, only ${Math.abs(netM).toFixed(0)} m net). Select a cleaner single climb or descent.` };
  }
  return { ...base, type: netM > 0 ? "climb" : "descent" };
}

/** Scatter buckets over an arbitrary range, split into `groups` equal-distance
 *  sub-ranges (halves for segments). metric "gap" → GAP pace, "slope" → grade%.
 *  direction filters ascending (>0) / descending (<0) / all (0) samples. */
function raceRangeScatter(ctx, startM, endM, groups, metric, direction = 0, bins = 60) {
  const output = [];
  const groupLength = (endM - startM) / groups;
  for (let group = 0; group < groups; group++) {
    const start = startM + group * groupLength;
    const end = startM + (group + 1) * groupLength;
    const buckets = Array.from({ length: bins }, () => ({ movingS: 0, equivM: 0, distanceM: 0, gradeWeighted: 0, hrW: 0, hrWeight: 0 }));
    for (const point of ctx.points) {
      if (!point.moving || point.cum < start || point.cum > end) continue;
      if (direction > 0 && point.grade <= 0) continue;
      if (direction < 0 && point.grade >= 0) continue;
      const progress = groupLength > 0 ? (point.cum - start) / groupLength : 0;
      const bucket = buckets[Math.min(bins - 1, Math.max(0, Math.floor(progress * bins)))];
      bucket.movingS += point.movingS;
      bucket.equivM += point.equivStep;
      bucket.distanceM += point.step;
      bucket.gradeWeighted += point.grade * point.step;
      if (raceFinite(point.hr)) {
        bucket.hrW += point.hr * point.movingS;
        bucket.hrWeight += point.movingS;
      }
    }
    output.push(buckets
      .filter((bucket) => bucket.hrWeight > 0 && bucket.distanceM >= 50)
      .map((bucket) => {
        const y = bucket.hrW / bucket.hrWeight;
        const x = metric === "gap"
          ? (bucket.equivM ? bucket.movingS / (bucket.equivM / 1000) : NaN)
          : 100 * bucket.gradeWeighted / bucket.distanceM;
        return { x, y };
      })
      .filter((pt) => raceFinite(pt.x) && raceFinite(pt.y)));
  }
  return output;
}

/** VAM (m/h) by slope segment over a range, split into `groups` sub-ranges. */
function raceRangeVam(ctx, startM, endM, direction, groups, bins = 60) {
  const output = [];
  const groupLength = (endM - startM) / groups;
  for (let group = 0; group < groups; group++) {
    const start = startM + group * groupLength;
    const end = startM + (group + 1) * groupLength;
    const buckets = Array.from({ length: bins }, () => ({ distanceM: 0, gradeWeighted: 0, verticalM: 0, movingS: 0 }));
    for (const point of ctx.points) {
      if (!point.moving || point.cum < start || point.cum > end) continue;
      if (direction > 0 && point.grade <= 0) continue;
      if (direction < 0 && point.grade >= 0) continue;
      const progress = groupLength > 0 ? (point.cum - start) / groupLength : 0;
      const bucket = buckets[Math.min(bins - 1, Math.max(0, Math.floor(progress * bins)))];
      bucket.distanceM += point.step;
      bucket.gradeWeighted += point.grade * point.step;
      bucket.verticalM += point.grade * point.step;
      bucket.movingS += point.movingS;
    }
    const segAcc = RACE_SLOPE_SEGMENTS.map(() => ({ verticalM: 0, movingS: 0 }));
    for (const bucket of buckets) {
      if (bucket.distanceM < 50 || bucket.movingS <= 0) continue;
      const absSlope = Math.abs(100 * bucket.gradeWeighted / bucket.distanceM);
      const index = RACE_SLOPE_SEGMENTS.findIndex((seg) => absSlope >= seg.min && absSlope < seg.max);
      if (index < 0) continue;
      segAcc[index].verticalM += bucket.verticalM;
      segAcc[index].movingS += bucket.movingS;
    }
    output.push(segAcc.map((acc) => acc.movingS > 0 ? Math.abs(acc.verticalM) / (acc.movingS / 3600) : NaN));
  }
  return output;
}

function setRaceAnalysisStatus(message, isError = false) {
  const status = document.getElementById("race-analysis-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("error", isError);
}

function setRaceAnalysisBusy(isBusy) {
  const spinner = document.getElementById("race-analysis-spinner");
  if (spinner) spinner.classList.toggle("hidden", !isBusy);
  const controlIds = ["race-analyze-activity", "race-activity-query", "race-gpx-input"];
  for (const id of controlIds) {
    const el = document.getElementById(id);
    if (el) el.disabled = isBusy;
  }
  const uploadLabel = document.querySelector(".race-upload-label");
  if (uploadLabel) uploadLabel.classList.toggle("is-disabled", isBusy);
  const dropZone = document.getElementById("race-drop-zone");
  if (dropZone) dropZone.classList.toggle("is-disabled", isBusy);
}

function mkRaceChart(name) {
  if (state.raceAnalysisCharts[name]) state.raceAnalysisCharts[name].dispose();
  state.raceAnalysisCharts[name] = echarts.init(document.getElementById(`chart-${name}`), isDark() ? "dark" : null);
  return state.raceAnalysisCharts[name];
}

function raceActivityLabel(activity) {
  return `${activity.date || "-"} · ${activity.activity_type || "-"} · ${activity.activity_name || "Activity"} · ${formatDistance(activity.distance_m)}`;
}

function raceActivityMatchesQuery(activity, query) {
  if (!query) return true;
  return String(activity.activity_name || "").toLowerCase().includes(query.toLowerCase());
}

function renderRaceAnalysisActivityOptions() {
  const input = document.getElementById("race-activity-query");
  const resultsNode = document.getElementById("race-activity-results");
  const summary = document.getElementById("race-activity-search-summary");
  const analyzeButton = document.getElementById("race-analyze-activity");
  if (!input || !resultsNode || !summary) return;
  const query = input.value.trim();
  const matches = state.activities
    .slice()
    .sort(compareActivitiesChronologically)
    .filter((activity) => raceActivityMatchesQuery(activity, query));
  if (!matches.some((activity) => String(activity.activity_id || "") === String(state.raceAnalysis.selectedActivityId))) {
    state.raceAnalysis.selectedActivityId = matches[0] ? String(matches[0].activity_id || "") : "";
  }
  summary.textContent = query
    ? `${matches.length} matching cached activit${matches.length === 1 ? "y" : "ies"}`
    : `${state.activities.length} cached activit${state.activities.length === 1 ? "y" : "ies"}; type part of a name to filter`;
  resultsNode.innerHTML = matches.slice(0, 20).map((activity) => {
    const id = String(activity.activity_id || "");
    const active = id === String(state.raceAnalysis.selectedActivityId || "");
    return `<button class="race-activity-result${active ? " active" : ""}" type="button" data-race-activity-id="${raceEscapeHtml(id)}">
      <strong>${raceEscapeHtml(activity.activity_name || "Activity")}</strong>
      <span>${raceEscapeHtml(activity.date || "-")} · ${raceEscapeHtml(activity.activity_type || "-")} · ${formatDistance(activity.distance_m)} · ${formatDuration(activity.moving_time_s)}</span>
    </button>`;
  }).join("");
  if (matches.length > 20) {
    resultsNode.insertAdjacentHTML("beforeend", `<div class="muted race-activity-result-more">Showing first 20 matches. Keep typing to narrow the list.</div>`);
  }
  if (!matches.length) {
    resultsNode.innerHTML = `<div class="muted race-activity-result-empty">No cached activity name contains "${raceEscapeHtml(query)}".</div>`;
  }
  if (analyzeButton) analyzeButton.disabled = !state.raceAnalysis.selectedActivityId;
}

function handleRaceActivityResultClick(event) {
  const button = event.target.closest("[data-race-activity-id]");
  if (!button) return;
  state.raceAnalysis.selectedActivityId = button.dataset.raceActivityId || "";
  renderRaceAnalysisActivityOptions();
}

function renderRaceKpis(result) {
  const kpis = [
    ["Distance", `${result.overall.distanceKm.toFixed(2)} km`],
    ["Recorded elapsed", raceFormatDuration(result.overall.recordedElapsedS)],
    ["Moving", raceFormatDuration(result.overall.movingS)],
    ["Ascent / descent", `+${raceFormatNumber(result.overall.gainM)} / -${raceFormatNumber(result.overall.lossM)} m`],
    ["Average HR", `${raceFormatNumber(result.overall.avgHr)} bpm`],
    ["Average power", `${raceFormatNumber(result.overall.avgPower)} W`],
    ["Aerobic decoupling (GAP:HR)", raceFinite(result.overall.aerobicDecouplingPct)
      ? `${result.overall.aerobicDecouplingPct >= 0 ? "+" : ""}${result.overall.aerobicDecouplingPct.toFixed(1)} %`
      : "n/a"],
  ];
  document.getElementById("race-kpis").innerHTML = kpis
    .map(([label, value]) => `<div class="race-kpi"><span>${label}</span><strong>${value}</strong></div>`)
    .join("");
}

function renderRaceLegend() {
  document.getElementById("race-quarter-legend").innerHTML = RACE_COLORS
    .map((color, index) => `<span><i class="race-quarter-swatch" style="background:${color}"></i>Q${index + 1}</span>`)
    .join("");
}

function raceLineSeries(series, pace = false) {
  return series.map((row, index) => ({
    type: "line",
    name: `Q${index + 1}`,
    smooth: true,
    showSymbol: false,
    connectNulls: false,
    lineStyle: { width: 2, color: RACE_COLORS[index], opacity: 0.82 },
    itemStyle: { color: RACE_COLORS[index], opacity: 0.86 },
    data: row.x.map((x, i) => [Math.round(x * 100), raceFinite(row.y[i]) ? (pace ? row.y[i] / 60 : row.y[i]) : null]),
  }));
}

function renderRaceProfileChart(result) {
  const profile = result.chart.profile;
  const chart = mkRaceChart("race-profile");
  const totalKm = result.overall.endKm;
  chart.setOption({
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const value = params[0]?.value || [0, 0];
        return `${Number(value[0]).toFixed(2)} km · ${Math.round(value[1])} m`;
      },
    },
    grid: { left: 48, right: 18, top: 24, bottom: 34 },
    xAxis: {
      type: "value",
      name: "km",
      max: totalKm,
    },
    yAxis: {
      type: "value",
      name: "m",
      min: Math.floor(result.overall.minEleM),
      max: Math.ceil(result.overall.maxEleM),
    },
    series: [{
      type: "line",
      name: "Elevation",
      smooth: true,
      showSymbol: false,
      lineStyle: { color: SERIES_COLORS.elevation, width: 1.5 },
      areaStyle: { color: SERIES_COLORS.elevation, opacity: 0.12 },
      markLine: {
        symbol: "none",
        label: { formatter: (p) => p.name, color: "inherit" },
        lineStyle: { type: "dashed", color: "#64748b" },
        data: [1, 2, 3].map((q) => ({ name: `Q${q + 1}`, xAxis: q * totalKm / 4 })),
      },
      data: profile.map((row) => [row.distance / 1000, row.ele]),
    }],
  });
}

function renderRaceLineChart(name, title, series, pace = false) {
  const all = series.flatMap((row) => row.y).filter(raceFinite);
  const chart = mkRaceChart(name);
  const min = all.length ? racePercentile(all, 2) : (pace ? 180 : 80);
  const max = all.length ? racePercentile(all, 98) : (pace ? 900 : 200);
  chart.setOption({
    tooltip: {
      trigger: "axis",
      formatter: (params) => params.map((p) => {
        const y = p.value?.[1];
        const value = pace ? `${formatPaceMinutes(y)} /km` : `${Math.round(y)} bpm`;
        return `${p.marker}${p.seriesName}: ${value}`;
      }).join("<br>"),
    },
    legend: { top: 4, textStyle: { fontSize: 11 } },
    grid: { left: 46, right: 16, top: 42, bottom: 34 },
    xAxis: { type: "value", name: "% quarter", min: 0, max: 100 },
    yAxis: {
      type: "value",
      name: pace ? "min/km" : "bpm",
      inverse: pace,
      min: pace ? Math.max(3, (min - 20) / 60) : Math.max(80, min - 3),
      max: pace ? Math.min(20, (max + 20) / 60) : Math.min(220, max + 3),
      axisLabel: { formatter: (v) => pace ? formatPaceMinutes(v) : Math.round(v) },
    },
    series: raceLineSeries(series, pace),
  });
  chart.setOption({ title: { text: title, show: false } });
}

function renderRaceScatter(result) {
  const points = result.chart.gapHeartRate.flat();
  const chart = mkRaceChart("race-scatter");
  const xValues = points.map((point) => point.x).filter(raceFinite);
  const yValues = points.map((point) => point.y).filter(raceFinite);
  chart.setOption({
    tooltip: {
      formatter: (p) => `${p.seriesName}<br>GAP ${raceFormatPace(p.value[0])} /km<br>HR ${Math.round(p.value[1])} bpm`,
    },
    legend: { top: 4, textStyle: { fontSize: 11 } },
    grid: { left: 54, right: 18, top: 42, bottom: 42 },
    xAxis: {
      type: "value",
      name: "GAP /km",
      min: xValues.length ? Math.max(180, racePercentile(xValues, 2) - 15) : 180,
      max: xValues.length ? Math.min(900, racePercentile(xValues, 98) + 15) : 900,
      axisLabel: { formatter: (v) => raceFormatPace(v) },
    },
    yAxis: {
      type: "value",
      name: "bpm",
      min: yValues.length ? Math.max(80, racePercentile(yValues, 2) - 3) : 80,
      max: yValues.length ? Math.min(220, racePercentile(yValues, 98) + 3) : 200,
    },
    series: result.chart.gapHeartRate.map((quarter, index) => ({
      type: "scatter",
      name: `Q${index + 1}`,
      symbolSize: 8,
      itemStyle: { color: RACE_COLORS[index], opacity: 0.56 },
      data: quarter.map((point) => [point.x, point.y]),
    })),
  });
}

function renderRaceSlopeScatter(result, name, data, direction) {
  const points = data.flat();
  const chart = mkRaceChart(name);
  const xValues = points.map((point) => point.x).filter(raceFinite);
  const yValues = points.map((point) => point.y).filter(raceFinite);
  const positive = direction > 0;
  const xMin = xValues.length
    ? (positive ? Math.max(0, racePercentile(xValues, 2) - 0.5) : Math.min(0, racePercentile(xValues, 2) - 0.5))
    : (positive ? 0 : -20);
  const xMax = xValues.length
    ? (positive ? racePercentile(xValues, 98) + 0.5 : Math.min(0, racePercentile(xValues, 98) + 0.5))
    : (positive ? 20 : 0);
  chart.setOption({
    tooltip: {
      formatter: (p) => `${p.seriesName}<br>Slope ${Number(p.value[0]).toFixed(1)}%<br>HR ${Math.round(p.value[1])} bpm`,
    },
    legend: { top: 4, textStyle: { fontSize: 11 } },
    grid: { left: 52, right: 18, top: 42, bottom: 42 },
    xAxis: {
      type: "value",
      name: "slope %",
      min: xMin,
      max: xMax,
      axisLabel: { formatter: (v) => `${Number(v).toFixed(0)}%` },
    },
    yAxis: {
      type: "value",
      name: "bpm",
      min: yValues.length ? Math.max(80, racePercentile(yValues, 2) - 3) : 80,
      max: yValues.length ? Math.min(220, racePercentile(yValues, 98) + 3) : 200,
    },
    series: data.map((quarter, index) => ({
      type: "scatter",
      name: `Q${index + 1}`,
      symbolSize: 8,
      itemStyle: { color: RACE_COLORS[index], opacity: 0.56 },
      data: quarter.map((point) => [point.x, point.y]),
    })),
  });
}

function renderRaceVamBars(name, data) {
  const chart = mkRaceChart(name);
  const categories = RACE_SLOPE_SEGMENTS.map((seg) => seg.label);
  chart.setOption({
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const lines = [`${params[0]?.axisValue} slope`];
        for (const p of params) {
          if (raceFinite(p.value)) lines.push(`${p.marker}${p.seriesName}: ${Math.round(p.value)} m/h`);
        }
        return lines.join("<br>");
      },
    },
    legend: { top: 4, textStyle: { fontSize: 11 } },
    grid: { left: 54, right: 18, top: 42, bottom: 34 },
    xAxis: { type: "category", name: "slope", data: categories },
    yAxis: { type: "value", name: "VAM m/h" },
    series: data.map((quarter, index) => ({
      type: "bar",
      name: `Q${index + 1}`,
      itemStyle: { color: RACE_COLORS[index], opacity: 0.78 },
      data: quarter.map((value) => raceFinite(value) ? Math.round(value) : null),
    })),
  });
}

function raceTable(headers, rows, classes = []) {
  const head = headers.map((label) => `<th>${label}</th>`).join("");
  const body = rows.map((row, index) => `<tr${classes[index] ? ` class="${classes[index]}"` : ""}>${row.map((value) => `<td>${value}</td>`).join("")}</tr>`).join("");
  return `<div class="race-table-wrap table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function raceBandFilterControls(scope, typeLabel, typeNames, sourceRows, typeKey, quarterFilter, typeFilter) {
  const quarters = [...new Set(sourceRows.map((row) => row.quarter))].sort((a, b) => a - b);
  const types = [...new Set(sourceRows.map((row) => row[typeKey]))];
  const button = (kind, value, label, active) =>
    `<button type="button" class="btn secondary race-filter-chip${active ? " active" : ""}" data-race-filter-scope="${scope}" data-race-filter-kind="${kind}" data-race-filter-value="${raceEscapeHtml(value)}">${raceEscapeHtml(label)}</button>`;
  return `<div class="race-terrain-filters">
    <div><span class="muted">Quarter</span>${quarters.map((q) => button("quarter", String(q), `Q${q}`, String(q) === String(quarterFilter))).join("")}</div>
    <div><span class="muted">${raceEscapeHtml(typeLabel)}</span>${types.map((type) => button("type", type, typeNames[type] || type, type === typeFilter)).join("")}</div>
    ${(quarterFilter || typeFilter) ? `<button type="button" class="btn secondary race-filter-chip" data-race-filter-scope="${scope}" data-race-filter-kind="clear" data-race-filter-value="">Clear filters</button>` : ""}
  </div>`;
}

function handleRaceTableFilterClick(event) {
  const button = event.target.closest("[data-race-filter-kind]");
  if (!button) return;
  const scope = button.dataset.raceFilterScope || "terrain";
  const kind = button.dataset.raceFilterKind;
  const value = button.dataset.raceFilterValue || "";
  const quarterKey = scope === "extreme" ? "extremeQuarterFilter" : "terrainQuarterFilter";
  const typeKey = scope === "extreme" ? "extremeTypeFilter" : "terrainTypeFilter";
  if (kind === "quarter") {
    state.raceAnalysis[quarterKey] = state.raceAnalysis[quarterKey] === value ? "" : value;
  }
  if (kind === "type") {
    state.raceAnalysis[typeKey] = state.raceAnalysis[typeKey] === value ? "" : value;
  }
  if (kind === "clear") {
    state.raceAnalysis[quarterKey] = "";
    state.raceAnalysis[typeKey] = "";
  }
  if (state.raceAnalysis.result) renderRaceTables(state.raceAnalysis.result);
}

function renderRaceTables(result) {
  const q0 = result.quarters[0];
  const qRows = result.quarters.map((q, index) => [
    `Q${index + 1}`,
    `${q.startKm.toFixed(2)}-${q.endKm.toFixed(2)}`,
    raceFormatDuration(q.movingS),
    raceFormatDuration(q.elapsedS),
    raceFormatNumber(q.gainM),
    raceFormatNumber(q.lossM),
    raceFormatPace(q.paceSKm),
    raceFormatPace(q.gapSKm),
    raceFormatNumber(q.avgHr),
    raceFormatNumber(q.avgPower),
    raceFormatNumber(q.avgCadenceSpm),
    raceFormatNumber(q.efficiency, 3),
    raceFormatDeltaSeconds(q.gapSKm - q0.gapSKm),
    raceFinite(q.avgHr) && raceFinite(q0.avgHr) ? `${q.avgHr - q0.avgHr >= 0 ? "+" : ""}${(q.avgHr - q0.avgHr).toFixed(0)}` : "-",
    raceFinite(q.avgPower) && raceFinite(q0.avgPower) ? `${q.avgPower - q0.avgPower >= 0 ? "+" : ""}${(q.avgPower - q0.avgPower).toFixed(0)}` : "-",
  ]);
  const terrainNames = {
    steep_up: "Steep up (>=10%)",
    moderate_up: "Moderate up (3-10%)",
    flat: "Flat (-3% to 3%)",
    moderate_down: "Moderate down (-10% to -3%)",
    steep_down: "Steep down (<=-10%)",
  };
  const extremeNames = {
    flat: "Flattest 1.5 km",
    steep_up: "Steepest 100 m climb",
    steep_down: "Steepest 100 m descent",
  };
  const extremeSourceRows = result.flatSections.map((row, index) => ({
    ...row,
    quarter: index + 1,
    band: "flat",
  })).concat(
    result.steepClimbs.map((row, index) => row ? ({
      ...row,
      quarter: index + 1,
      band: "steep_up",
    }) : null).filter(Boolean),
    result.steepDescents.map((row, index) => row ? ({
      ...row,
      quarter: index + 1,
      band: "steep_down",
    }) : null).filter(Boolean)
  );
  const extremeFilteredRows = extremeSourceRows.filter((row) => {
    const quarterFilter = state.raceAnalysis.extremeQuarterFilter || "";
    const typeFilter = state.raceAnalysis.extremeTypeFilter || "";
    if (quarterFilter && String(row.quarter) !== String(quarterFilter)) return false;
    if (typeFilter && row.band !== typeFilter) return false;
    return true;
  });
  const extremeRows = extremeFilteredRows.map((row) => [
    `Q${row.quarter}`,
    extremeNames[row.band],
    `${row.startKm.toFixed(2)}-${row.endKm.toFixed(2)}`,
    row.distanceKm.toFixed(2),
    `${row.netM >= 0 ? "+" : ""}${row.netM.toFixed(0)}`,
    `${row.avgGradePct.toFixed(1)}%`,
    raceFormatDuration(row.movingS),
    raceFormatPace(row.paceSKm),
    raceFormatPace(row.gapSKm),
    raceFormatNumber(row.avgHr),
    raceFormatNumber(row.avgPower),
    raceFormatNumber(row.avgCadenceSpm),
    raceFormatNumber(row.vamMH),
  ]);
  const extremeClasses = extremeFilteredRows.map((row) => `q${row.quarter}`);
  const terrainSourceRows = result.terrainBands;
  const terrainFilteredRows = terrainSourceRows.filter((row) => {
    const quarterFilter = state.raceAnalysis.terrainQuarterFilter || "";
    const terrainFilter = state.raceAnalysis.terrainTypeFilter || "";
    if (quarterFilter && String(row.quarter) !== String(quarterFilter)) return false;
    if (terrainFilter && row.terrain !== terrainFilter) return false;
    return true;
  });
  const terrainRows = terrainFilteredRows.map((row) => [
    `Q${row.quarter}`,
    terrainNames[row.terrain],
    row.distanceKm.toFixed(2),
    raceFormatPace(row.paceSKm),
    raceFormatPace(row.gapSKm),
    raceFormatNumber(row.avgHr),
    raceFormatNumber(row.avgPower),
    raceFormatNumber(row.avgCadenceSpm),
  ]);
  const terrainClasses = terrainFilteredRows.map((row) => `q${row.quarter}`);
  const stopRows = result.stationaryClusters.length
    ? result.stationaryClusters.slice().sort((a, b) => a.km - b.km || a.elapsedAtStartS - b.elapsedAtStartS).map((row) => [
      row.km.toFixed(2),
      raceFormatDuration(row.elapsedAtStartS),
      raceFormatDuration(row.durationS),
      raceFormatNumber(row.avgHr),
    ])
    : [["-", "-", "-", "-"]];
  const classes = ["q1", "q2", "q3", "q4"];
  document.getElementById("race-analysis-tables").innerHTML = [
    ["Quarter averages", raceTable(["Quarter", "km", "Moving", "Elapsed", "D+ m", "D- m", "Pace /km", "Est. GAP /km", "HR bpm", "Power W", "Cadence spm", "Efficiency", "GAP vs Q1", "HR vs Q1", "Power vs Q1"], qRows, classes)],
    ["Terrain-grade bands", `${raceBandFilterControls("terrain", "Terrain", terrainNames, terrainSourceRows, "terrain", state.raceAnalysis.terrainQuarterFilter || "", state.raceAnalysis.terrainTypeFilter || "")}${raceTable(["Quarter", "Terrain", "Distance km", "Pace /km", "Est. GAP /km", "HR bpm", "Power W", "Cadence spm"], terrainRows, terrainClasses)}`],
    ["Extreme-grade bands", `${raceBandFilterControls("extreme", "Band", extremeNames, extremeSourceRows, "band", state.raceAnalysis.extremeQuarterFilter || "", state.raceAnalysis.extremeTypeFilter || "")}${raceTable(["Quarter", "Band", "km", "Length km", "Net m", "Grade", "Moving", "Pace /km", "Est. GAP /km", "HR bpm", "Power W", "Cadence spm", "VAM m/h"], extremeRows, extremeClasses)}`],
    ["Stationary clusters (minimum 3 seconds)", raceTable(["km", "Elapsed at start", "Duration", "HR bpm"], stopRows)],
    ["Calculation parameters", raceTable(["Parameter", "Value"], [
      ["Quarter split", result.method.quarters],
      ["Flat window", `${result.method.flatWindowM} m`],
      ["Climb/descent window", result.method.steepWindow],
      ["Estimated GAP", result.method.gap],
      ["Profile spacing / smoothing", `${result.method.profileSpacingM} m / ${result.method.smoothingM} m`],
      ["Moving threshold", `${result.method.movingThresholdMS.toFixed(2)} m/s`],
    ])],
  ].map(([title, table]) => `<div class="card race-section-card"><h2>${title}</h2>${table}</div>`).join("");
}

function renderRaceAnalysisResult(result) {
  state.raceAnalysis.result = result;
  document.getElementById("race-analysis-report").classList.remove("hidden");
  document.getElementById("race-download-json").disabled = false;
  document.getElementById("race-report-name").textContent = result.overall.title;
  document.getElementById("race-report-meta").textContent = `${result.overall.sourceName} · ${result.overall.startTime} · ${raceFormatNumber(result.overall.points)} track points`;
  renderRaceKpis(result);
  renderRaceLegend();
  renderRaceProfileChart(result);
  renderRaceLineChart("race-hr", "Heart rate", result.chart.hr, false);
  renderRaceLineChart("race-pace", "Actual pace", result.chart.pace, true);
  renderRaceLineChart("race-gap", "Estimated GAP", result.chart.gap, true);
  renderRaceScatter(result);
  renderRaceSlopeScatter(result, "race-uphill-hr", result.chart.uphillHeartRate, 1);
  renderRaceSlopeScatter(result, "race-downhill-hr", result.chart.downhillHeartRate, -1);
  renderRaceVamBars("race-uphill-vam", result.chart.uphillVam);
  renderRaceVamBars("race-downhill-vam", result.chart.downhillVam);
  renderRaceTables(result);
  renderRaceQuarterSuitability();
  setRaceAnalysisStatus(`Complete: ${result.overall.distanceKm.toFixed(2)} km, ${raceFormatNumber(result.overall.gainM)} m ascent, ${raceFormatDuration(result.overall.recordedElapsedS)} elapsed.`);
}

function renderRaceQuarterSuitability() {
  const banner = document.getElementById("race-quarters-suitability");
  const ctx = state.raceAnalysis.ctx;
  if (!banner || !ctx) return;
  const { suitable, failing } = raceQuarterSuitability(ctx);
  if (suitable) {
    banner.classList.add("hidden");
    banner.innerHTML = "";
    return;
  }
  const list = failing.map((f) => {
    const missing = [!f.hasClimb ? "climb" : null, !f.hasDescent ? "descent" : null].filter(Boolean).join(" & ");
    return `Q${f.quarter} (no ${missing})`;
  }).join(", ");
  banner.classList.remove("hidden");
  banner.innerHTML = `<strong>⚠ This race may not suit quarter analysis.</strong> `
    + `Quarter GAP:HR comparisons assume every quarter mixes climbing and descending, but these quarters do not have both a meaningful (≥ ${RACE_MEANINGFUL_VERT_M} m) climb and descent: <strong>${raceEscapeHtml(list)}</strong>. `
    + `On a single climb-then-descent profile the numbers are dominated by terrain, not fatigue — use <em>Analyse Segments</em> to compare halves within one climb or descent instead.`;
}

/* ── Mode switching ─────────────────────────────────────────────────────────*/

function raceSetHeader(ctx, parsed) {
  document.getElementById("race-report-name").textContent = parsed.title;
  const startTime = new Date(ctx.points[0].time).toISOString();
  document.getElementById("race-report-meta").textContent =
    `${parsed.sourceName} · ${startTime} · ${raceFormatNumber(ctx.points.length)} track points`;
}

function renderRaceActiveMode() {
  const ctx = state.raceAnalysis.ctx;
  const parsed = state.raceAnalysis.parsed;
  if (!ctx || !parsed) return;
  const mode = state.raceAnalysis.mode === "segments" ? "segments" : "quarters";
  document.getElementById("race-analysis-report").classList.remove("hidden");
  raceSetHeader(ctx, parsed);
  document.querySelectorAll("#race-mode-toggle [data-race-mode]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.raceMode === mode);
  });
  const quartersEl = document.getElementById("race-quarters-report");
  const segmentsEl = document.getElementById("race-segments-report");
  quartersEl.classList.toggle("hidden", mode !== "quarters");
  segmentsEl.classList.toggle("hidden", mode !== "segments");

  if (mode === "quarters") {
    if (!state.raceAnalysis.result) state.raceAnalysis.result = buildRaceResult(ctx, parsed);
    document.getElementById("race-download-json").disabled = false;
    renderRaceAnalysisResult(state.raceAnalysis.result);
  } else {
    document.getElementById("race-download-json").disabled = true;
    renderRaceSegmentsMode(ctx);
  }
}

function setRaceMode(mode) {
  const next = mode === "segments" ? "segments" : "quarters";
  if (state.raceAnalysis.mode === next) return;
  state.raceAnalysis.mode = next;
  try { localStorage.setItem("race_analysis_mode", next); } catch (_) { /* ignore */ }
  renderRaceActiveMode();
}

function handleRaceModeToggleClick(event) {
  const btn = event.target.closest("[data-race-mode]");
  if (!btn) return;
  setRaceMode(btn.dataset.raceMode);
}

/* ── Segment mode rendering ─────────────────────────────────────────────────*/

const RACE_HALF_COLORS = [SERIES_COLORS.pace, SERIES_COLORS.gap];
const RACE_HALF_LABELS = ["First half", "Second half"];

function setRaceSegStatus(message, isError = false) {
  const el = document.getElementById("race-seg-status");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("error", isError);
}

function renderRaceSegmentsMode(ctx) {
  document.getElementById("race-seg-charts").classList.add("hidden");
  state.raceAnalysis.segment = null;
  setRaceSegStatus("Drag across a single climb or descent on the profile. Small dips or hops within it are ignored; mixed rolling terrain is rejected.");
  setRaceAnalysisStatus(`Loaded ${(ctx.totalM / 1000).toFixed(2)} km. Select a single climb or descent on the profile below.`);
  renderRaceSegmentProfile(ctx);
}

function renderRaceSegmentProfile(ctx) {
  const chart = mkRaceChart("race-seg-profile");
  const minEle = Math.min(...ctx.profileElevations);
  const maxEle = Math.max(...ctx.profileElevations);
  chart.setOption({
    tooltip: {
      trigger: "axis",
      formatter: (params) => {
        const value = params[0]?.value || [0, 0];
        return `${Number(value[0]).toFixed(2)} km · ${Math.round(value[1])} m`;
      },
    },
    grid: { left: 48, right: 18, top: 24, bottom: 34 },
    xAxis: { type: "value", name: "km", max: ctx.totalM / 1000 },
    yAxis: { type: "value", name: "m", min: Math.floor(minEle), max: Math.ceil(maxEle) },
    brush: {
      xAxisIndex: 0,
      brushType: "lineX",
      brushMode: "single",
      throttleType: "debounce",
      throttleDelay: 200,
      brushStyle: { borderWidth: 1, color: "rgba(129,140,248,0.18)", borderColor: "rgba(129,140,248,0.7)" },
    },
    series: [{
      type: "line",
      name: "Elevation",
      smooth: true,
      showSymbol: false,
      lineStyle: { color: SERIES_COLORS.elevation, width: 1.5 },
      areaStyle: { color: SERIES_COLORS.elevation, opacity: 0.12 },
      data: ctx.profile.map((row) => [row.distance / 1000, row.ele]),
    }],
  });
  chart.off("brushEnd");
  chart.on("brushEnd", (event) => {
    const area = event.areas && event.areas[0];
    if (!area || !area.coordRange) return;
    const [x0, x1] = area.coordRange;
    handleRaceSegmentSelection(Math.min(x0, x1) * 1000, Math.max(x0, x1) * 1000);
  });
  // Activate the brush cursor by default so the user can drag immediately.
  chart.dispatchAction({ type: "takeGlobalCursor", key: "brush", brushOption: { brushType: "lineX", brushMode: "single" } });
}

function handleRaceSegmentSelection(startM, endM) {
  const ctx = state.raceAnalysis.ctx;
  if (!ctx) return;
  const seg = raceClassifySegment(ctx, startM, endM);
  if (!seg.type) {
    state.raceAnalysis.segment = null;
    document.getElementById("race-seg-charts").classList.add("hidden");
    setRaceSegStatus(seg.message, true);
    return;
  }
  state.raceAnalysis.segment = seg;
  const km = ((seg.endM - seg.startM) / 1000).toFixed(2);
  setRaceSegStatus(
    `${seg.type === "climb" ? "Climb" : "Descent"} selected: ${(seg.startM / 1000).toFixed(2)}–${(seg.endM / 1000).toFixed(2)} km `
    + `(${km} km, ${seg.netM >= 0 ? "+" : ""}${seg.netM.toFixed(0)} m net; ${seg.gainM.toFixed(0)} m up / ${seg.lossM.toFixed(0)} m down). Split into halves below.`
  );
  renderRaceSegmentCharts(ctx, seg);
}

function renderRaceSegmentCharts(ctx, seg) {
  document.getElementById("race-seg-charts").classList.remove("hidden");
  const direction = seg.type === "climb" ? 1 : -1;
  const slopeWord = seg.type === "climb" ? "Ascending" : "Descending";
  document.getElementById("race-seg-slope-title").textContent = `${slopeWord} slope vs heart rate`;
  document.getElementById("race-seg-vam-title").textContent = `${slopeWord} VAM by slope segment`;

  const gapHr = raceRangeScatter(ctx, seg.startM, seg.endM, 2, "gap", 0);
  const slopeHr = raceRangeScatter(ctx, seg.startM, seg.endM, 2, "slope", direction);
  const vam = raceRangeVam(ctx, seg.startM, seg.endM, direction, 2);

  renderRaceHalfScatter("race-seg-gap-hr", gapHr, "gap");
  renderRaceHalfScatter("race-seg-slope-hr", slopeHr, "slope", direction);
  renderRaceHalfVamBars("race-seg-vam", vam);
}

function renderRaceHalfScatter(name, data, metric, direction = 0) {
  const chart = mkRaceChart(name);
  const points = data.flat();
  const xValues = points.map((point) => point.x).filter(raceFinite);
  const yValues = points.map((point) => point.y).filter(raceFinite);
  const isPace = metric === "gap";
  const positive = direction > 0;
  let xAxis;
  if (isPace) {
    xAxis = {
      type: "value",
      name: "GAP /km",
      min: xValues.length ? Math.max(180, racePercentile(xValues, 2) - 15) : 180,
      max: xValues.length ? Math.min(900, racePercentile(xValues, 98) + 15) : 900,
      axisLabel: { formatter: (v) => raceFormatPace(v) },
    };
  } else {
    xAxis = {
      type: "value",
      name: "slope %",
      min: xValues.length ? (positive ? Math.max(0, racePercentile(xValues, 2) - 0.5) : racePercentile(xValues, 2) - 0.5) : (positive ? 0 : -20),
      max: xValues.length ? (positive ? racePercentile(xValues, 98) + 0.5 : Math.min(0, racePercentile(xValues, 98) + 0.5)) : (positive ? 20 : 0),
      axisLabel: { formatter: (v) => `${Number(v).toFixed(0)}%` },
    };
  }
  chart.setOption({
    tooltip: {
      formatter: (p) => isPace
        ? `${p.seriesName}<br>GAP ${raceFormatPace(p.value[0])} /km<br>HR ${Math.round(p.value[1])} bpm`
        : `${p.seriesName}<br>Slope ${Number(p.value[0]).toFixed(1)}%<br>HR ${Math.round(p.value[1])} bpm`,
    },
    legend: { top: 4, textStyle: { fontSize: 11 } },
    grid: { left: 54, right: 18, top: 42, bottom: 42 },
    xAxis,
    yAxis: {
      type: "value",
      name: "bpm",
      min: yValues.length ? Math.max(80, racePercentile(yValues, 2) - 3) : 80,
      max: yValues.length ? Math.min(220, racePercentile(yValues, 98) + 3) : 200,
    },
    series: data.map((group, index) => ({
      type: "scatter",
      name: RACE_HALF_LABELS[index],
      symbolSize: 8,
      itemStyle: { color: RACE_HALF_COLORS[index], opacity: 0.56 },
      data: group.map((point) => [point.x, point.y]),
    })),
  });
}

function renderRaceHalfVamBars(name, data) {
  const chart = mkRaceChart(name);
  const categories = RACE_SLOPE_SEGMENTS.map((seg) => seg.label);
  chart.setOption({
    tooltip: {
      trigger: "axis",
      axisPointer: { type: "shadow" },
      formatter: (params) => {
        const lines = [`${params[0]?.axisValue} slope`];
        for (const p of params) {
          if (raceFinite(p.value)) lines.push(`${p.marker}${p.seriesName}: ${Math.round(p.value)} m/h`);
        }
        return lines.join("<br>");
      },
    },
    legend: { top: 4, textStyle: { fontSize: 11 } },
    grid: { left: 54, right: 18, top: 42, bottom: 34 },
    xAxis: { type: "category", name: "slope", data: categories },
    yAxis: { type: "value", name: "VAM m/h" },
    series: data.map((group, index) => ({
      type: "bar",
      name: RACE_HALF_LABELS[index],
      itemStyle: { color: RACE_HALF_COLORS[index], opacity: 0.78 },
      data: group.map((value) => raceFinite(value) ? Math.round(value) : null),
    })),
  });
}

function prepareRaceAndRender(parsed) {
  const ctx = prepareRacePoints(parsed.points);
  state.raceAnalysis.ctx = ctx;
  state.raceAnalysis.parsed = parsed;
  state.raceAnalysis.result = null;
  state.raceAnalysis.segment = null;
  try {
    const saved = localStorage.getItem("race_analysis_mode");
    if (saved === "segments" || saved === "quarters") state.raceAnalysis.mode = saved;
  } catch (_) { /* ignore */ }
  renderRaceActiveMode();
}

function serializableRaceResult(result) {
  const copy = JSON.parse(JSON.stringify(result, (key, value) => Number.isNaN(value) ? null : value));
  delete copy.chart;
  return copy;
}

function downloadRaceAnalysisJson() {
  const result = state.raceAnalysis.result;
  if (!result) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(serializableRaceResult(result), null, 2)], { type: "application/json;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${raceSanitizeName(result.overall.title)}_race_analysis.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function handleRaceAnalyzeActivity() {
  const activityId = state.raceAnalysis.selectedActivityId;
  const activity = state.activities.find((item) => String(item.activity_id || "") === String(activityId));
  if (!activity) {
    setRaceAnalysisStatus("Search for and select a cached activity first.", true);
    return;
  }
  setRaceAnalysisBusy(true);
  setRaceAnalysisStatus(`Loading stream for ${activity.activity_name || activity.date || "activity"}…`);
  document.getElementById("race-download-json").disabled = true;
  try {
    const settings = getSettings();
    const stream = await fetchHrStream(activity.activity_id, settings, activity.source || "intervals");
    const parsed = raceStreamToParsed(activity, stream);
    setRaceAnalysisStatus(`Analyzing ${raceFormatNumber(parsed.points.length)} stream points…`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    setRaceAnalysisStatus("Rendering charts…");
    await new Promise((resolve) => setTimeout(resolve, 0));
    prepareRaceAndRender(parsed);
  } catch (err) {
    console.error(err);
    setRaceAnalysisStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    setRaceAnalysisBusy(false);
  }
}

async function analyzeRaceGpxFile(file) {
  if (!file) return;
  setRaceAnalysisBusy(true);
  setRaceAnalysisStatus(`Reading ${file.name}…`);
  document.getElementById("race-download-json").disabled = true;
  try {
    const parsed = parseRaceGpx(await file.text(), file.name);
    setRaceAnalysisStatus(`Analyzing ${raceFormatNumber(parsed.points.length)} track points…`);
    await new Promise((resolve) => setTimeout(resolve, 0));
    setRaceAnalysisStatus("Rendering charts…");
    await new Promise((resolve) => setTimeout(resolve, 0));
    prepareRaceAndRender(parsed);
  } catch (err) {
    console.error(err);
    setRaceAnalysisStatus(err instanceof Error ? err.message : String(err), true);
  } finally {
    setRaceAnalysisBusy(false);
  }
}

function handleRaceGpxFileUpload() {
  analyzeRaceGpxFile(document.getElementById("race-gpx-input").files[0]);
}

function initRaceAnalysisDropZone() {
  const dropZone = document.getElementById("race-drop-zone");
  if (!dropZone) return;
  ["dragenter", "dragover"].forEach((type) => dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.add("active");
  }));
  ["dragleave", "drop"].forEach((type) => dropZone.addEventListener(type, (event) => {
    event.preventDefault();
    dropZone.classList.remove("active");
  }));
  dropZone.addEventListener("drop", (event) => analyzeRaceGpxFile(event.dataTransfer.files[0]));
  dropZone.addEventListener("click", () => document.getElementById("race-gpx-input").click());
  dropZone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") document.getElementById("race-gpx-input").click();
  });
}
