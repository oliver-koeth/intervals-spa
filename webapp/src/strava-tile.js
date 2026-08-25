/* ─── Strava-style shareable tile export ─────────────────────────────────
 * Renders a static PNG "workout tile" (dark card, Strava branding, HR/cadence/
 * pace chart, and — only when a paired planned workout is available — a
 * workout-profile bar chart plus avg gauges) and triggers a download.
 * Drawn entirely on a plain <canvas>: the exported image has no outer white
 * border and no rounded frame corners (those only appeared in the reference
 * screenshot's editor chrome, not the actual shared image). */

const TILE_W = 1000;
const TILE_PAD = 40;
const TILE_HEADER_H = 190;
const TILE_LEGEND_H = 40;
const TILE_CHART_H = 420;
const TILE_PROFILE_H = 300;
const TILE_FOOTER_H = 64;

const TILE_BG = "#0c0c0c";
const TILE_TEXT = "#f5f5f5";
const TILE_MUTED = "#9aa0a6";
const TILE_GRID = "rgba(255,255,255,0.10)";
const TILE_ORANGE = "#fc4c02";
const TILE_COLORS = { hr: "#ef4444", cadence: "#c9ced6", pace: "#5b9bf0" };
const TILE_ZONE_COLORS = { warmup: "#3f4750", threshold: "#bb5847", recovery: "#516272" };

function tileFont(weight, size) {
  return `${weight} ${size}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
}

function tileRoundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function tileTruncateText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) {
    s = s.slice(0, -1);
  }
  return `${s}…`;
}

function tileDifficultyLabel(pct) {
  if (pct >= 95) return "VERY HARD";
  if (pct >= 85) return "HARD";
  if (pct >= 70) return "MODERATE";
  if (pct >= 40) return "EASY";
  return "VERY EASY";
}

/** Best-effort "3 x 8 min"-style summary of a planned workout's repeated work blocks. */
function summarizePlannedWorkout(plannedWorkout) {
  if (!plannedWorkout) return "";
  const workSegments = plannedWorkout.segments.filter((s) => (s.zone || 0) >= 4);
  if (workSegments.length >= 2) {
    const rounded = workSegments.map((s) => Math.round(s.durationSec / 5) * 5);
    const counts = new Map();
    rounded.forEach((d) => counts.set(d, (counts.get(d) || 0) + 1));
    let bestDuration = null;
    let bestCount = 0;
    counts.forEach((count, duration) => {
      if (count > bestCount) { bestCount = count; bestDuration = duration; }
    });
    if (bestCount >= 2 && bestDuration) {
      const mm = Math.floor(bestDuration / 60);
      const ss = bestDuration % 60;
      const label = ss ? `${mm}:${String(ss).padStart(2, "0")}` : `${mm} min`;
      return `${bestCount} x ${label}`;
    }
  }
  return (plannedWorkout.description || "").split("\n")[0].slice(0, 70);
}

function tileNiceMinuteStep(maxMin) {
  const steps = [1, 2, 5, 10, 15, 20, 30, 60];
  return steps.find((s) => maxMin / s <= 8) || 60;
}

function tileClassifySegment(seg, index, total) {
  const zone = seg.zone || 0;
  if (zone >= 4) return "threshold";
  if ((index === 0 || index === total - 1) && zone <= 2) return "warmup";
  return "recovery";
}

function tileDrawLegendDot(ctx, x, y, color, label) {
  ctx.beginPath();
  ctx.arc(x, y, 6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = TILE_MUTED;
  ctx.font = tileFont(600, 14);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.fillText(label, x + 14, y + 1);
  return x + 14 + ctx.measureText(label).width;
}

function tileDrawLogo(ctx, x, y, size) {
  tileRoundRectPath(ctx, x, y, size, size, size * 0.2);
  ctx.fillStyle = TILE_ORANGE;
  ctx.fill();
  ctx.save();
  ctx.translate(x + size / 2, y + size / 2);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.moveTo(-size * 0.16, size * 0.22);
  ctx.lineTo(0, -size * 0.24);
  ctx.lineTo(size * 0.16, size * 0.22);
  ctx.lineTo(size * 0.06, size * 0.22);
  ctx.lineTo(0, size * 0.02);
  ctx.lineTo(-size * 0.06, size * 0.22);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function tileDrawGauge(ctx, cx, cy, r, fraction, color, valueText, unitText, topLabel, bottomLabel) {
  const start = Math.PI * 0.75;
  const end = start + Math.PI * 1.5;
  const clamped = Math.max(0, Math.min(1, fraction));

  ctx.font = tileFont(700, 12);
  ctx.fillStyle = TILE_MUTED;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(topLabel.toUpperCase(), cx, cy - r - 16);

  ctx.lineCap = "round";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "rgba(255,255,255,0.14)";
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, end, false);
  ctx.stroke();

  if (clamped > 0) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, start + (end - start) * clamped, false);
    ctx.stroke();
  }

  ctx.textBaseline = "middle";
  ctx.fillStyle = TILE_TEXT;
  ctx.font = tileFont(700, 26);
  ctx.fillText(valueText, cx, cy - 6);
  ctx.fillStyle = TILE_MUTED;
  ctx.font = tileFont(500, 13);
  ctx.fillText(unitText, cx, cy + 18);

  ctx.textBaseline = "alphabetic";
  ctx.font = tileFont(600, 12);
  ctx.fillStyle = TILE_MUTED;
  ctx.fillText(bottomLabel.toUpperCase(), cx, cy + r + 24);
}

function tileDrawHeader(ctx, focusActivity, plannedWorkout) {
  const logoSize = 76;
  tileDrawLogo(ctx, TILE_PAD, TILE_PAD, logoSize);

  const textX = TILE_PAD + logoSize + 22;
  const title = plannedWorkout?.name || focusActivity.activity_name || focusActivity.activity_type || "Activity";
  const subtitle = summarizePlannedWorkout(plannedWorkout);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TILE_TEXT;
  ctx.font = tileFont(700, 32);
  const titleMaxW = 480;
  ctx.fillText(tileTruncateText(ctx, title, titleMaxW), textX, TILE_PAD + 32);

  if (subtitle) {
    ctx.fillStyle = TILE_MUTED;
    ctx.font = tileFont(400, 20);
    ctx.fillText(tileTruncateText(ctx, subtitle, titleMaxW), textX, TILE_PAD + 62);
  }

  if (focusActivity.date) {
    const dateY = TILE_PAD + 96;
    ctx.strokeStyle = TILE_MUTED;
    ctx.lineWidth = 1.4;
    tileRoundRectPath(ctx, textX, dateY - 12, 16, 14, 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(textX + 3, dateY - 8);
    ctx.lineTo(textX + 13, dateY - 8);
    ctx.stroke();
    ctx.fillStyle = TILE_MUTED;
    ctx.font = tileFont(500, 15);
    ctx.fillText(focusActivity.date, textX + 24, dateY);
  }

  const kpiRightEdge = TILE_W - TILE_PAD;
  const kpis = [
    { label: "TIME", value: focusActivity.moving_time_s ? formatSeconds(focusActivity.moving_time_s) : "-" },
    { label: "DISTANCE", value: focusActivity.distance_m ? formatDistance(focusActivity.distance_m) : "-" },
    { label: "LOAD", value: focusActivity.training_load != null ? String(Math.round(focusActivity.training_load)) : "-" },
  ];
  const colW = 150;
  kpis.forEach((kpi, i) => {
    const cx = kpiRightEdge - colW * (kpis.length - 1 - i);
    ctx.textAlign = "right";
    ctx.fillStyle = TILE_MUTED;
    ctx.font = tileFont(700, 13);
    ctx.fillText(kpi.label, cx, TILE_PAD + 12);
    ctx.fillStyle = TILE_TEXT;
    ctx.font = tileFont(700, 28);
    ctx.fillText(kpi.value, cx, TILE_PAD + 46);
  });

  const intensityPct = focusActivity.intensity != null
    ? Math.round(focusActivity.intensity * 100)
    : (plannedWorkout?.intensity != null ? Math.round(plannedWorkout.intensity * 100) : null);
  if (intensityPct != null) {
    ctx.textAlign = "left";
    ctx.fillStyle = TILE_MUTED;
    ctx.font = tileFont(700, 13);
    const intensityX = kpiRightEdge - colW * 2;
    ctx.fillText("INTENSITY", intensityX, TILE_PAD + 92);
    ctx.fillStyle = TILE_TEXT;
    ctx.font = tileFont(700, 26);
    ctx.fillText(`${intensityPct}%`, intensityX, TILE_PAD + 124);

    const badgeText = tileDifficultyLabel(intensityPct);
    ctx.font = tileFont(700, 13);
    const badgeTextW = ctx.measureText(badgeText).width;
    const badgeW = badgeTextW + 32;
    const badgeH = 34;
    const badgeX = kpiRightEdge - badgeW;
    const badgeY = TILE_PAD + 96;
    tileRoundRectPath(ctx, badgeX, badgeY, badgeW, badgeH, badgeH / 2);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.fillStyle = TILE_TEXT;
    ctx.fillText(badgeText, badgeX + badgeW / 2, badgeY + badgeH / 2 + 4);
  }
}

function tileDrawLegend(ctx, y, showHr, showCadence, showPace) {
  let x = TILE_PAD;
  if (showHr) x = tileDrawLegendDot(ctx, x, y, TILE_COLORS.hr, "HEART RATE (bpm)") + 26;
  if (showCadence) x = tileDrawLegendDot(ctx, x, y, TILE_COLORS.cadence, "CADENCE (rpm)") + 26;
  if (showPace) tileDrawLegendDot(ctx, x, y, TILE_COLORS.pace, "PACE (min/km)");
}

function tileAxisBounds(values, step, minFloor = 0) {
  if (!values.length) return { min: minFloor, max: minFloor + step * 4 };
  let min = Math.floor(Math.min(...values) / step) * step;
  let max = Math.ceil(Math.max(...values) / step) * step;
  if (min === max) { min -= step; max += step; }
  return { min: Math.max(minFloor, min), max };
}

function tileDrawChart(ctx, x0, y0, x1, y1, xMax, hr, cadence, pace) {
  const hasHr = hr.length > 0;
  const hasCadence = cadence.length > 0;
  const hasPace = pace.length > 0;

  const bpmBounds = tileAxisBounds(hr.map((p) => p[1]), 20);
  const rpmBounds = { min: 0, max: Math.max(100, tileAxisBounds(cadence.map((p) => p[1]), 20).max) };
  const paceValues = pace.map((p) => p[1]);
  const paceMin = paceValues.length ? Math.max(0, Math.floor(Math.min(...paceValues) / 5) * 5) : 0;
  const paceMax = 20;

  const mapX = (tMin) => x0 + (Math.max(0, Math.min(xMax, tMin)) / xMax) * (x1 - x0);
  const mapYBpm = (v) => y1 - ((v - bpmBounds.min) / (bpmBounds.max - bpmBounds.min)) * (y1 - y0);
  const mapYRpm = (v) => y1 - ((v - rpmBounds.min) / (rpmBounds.max - rpmBounds.min)) * (y1 - y0);
  const mapYPace = (v) => y0 + ((v - paceMin) / (paceMax - paceMin)) * (y1 - y0);

  ctx.strokeStyle = TILE_GRID;
  ctx.lineWidth = 1;
  const hGridLines = 5;
  for (let i = 0; i <= hGridLines; i++) {
    const y = y0 + ((y1 - y0) / hGridLines) * i;
    ctx.beginPath();
    ctx.moveTo(x0, y);
    ctx.lineTo(x1, y);
    ctx.stroke();
  }
  const xStep = tileNiceMinuteStep(xMax);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = tileFont(500, 13);
  for (let t = 0; t <= xMax + 0.001; t += xStep) {
    const x = mapX(t);
    ctx.strokeStyle = TILE_GRID;
    ctx.beginPath();
    ctx.moveTo(x, y0);
    ctx.lineTo(x, y1);
    ctx.stroke();
    ctx.fillStyle = TILE_MUTED;
    ctx.fillText(String(Math.round(t)), x, y1 + 8);
  }
  ctx.textAlign = "left";
  ctx.fillText("min", x1 + 6, y1 + 8);

  if (hasHr) {
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillStyle = TILE_COLORS.hr;
    ctx.font = tileFont(600, 13);
    for (let v = bpmBounds.min; v <= bpmBounds.max; v += 20) {
      ctx.fillText(String(v), x0 - 10, mapYBpm(v));
    }
    ctx.font = tileFont(700, 12);
    ctx.textBaseline = "alphabetic";
    ctx.fillText("bpm", x0 - 10, y0 - 10);
  }
  if (hasCadence) {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = TILE_MUTED;
    ctx.font = tileFont(600, 13);
    for (let v = rpmBounds.min; v <= rpmBounds.max; v += 20) {
      ctx.fillText(String(v), x1 + 10, mapYRpm(v));
    }
    ctx.font = tileFont(700, 12);
    ctx.textBaseline = "alphabetic";
    ctx.fillText("rpm", x1 + 10, y0 - 10);
  }
  if (hasPace) {
    const paceAxisX = x1 + 70;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = TILE_COLORS.pace;
    ctx.font = tileFont(600, 13);
    for (let v = paceMin; v <= paceMax; v += 5) {
      ctx.fillText(formatPaceMinutes(v), paceAxisX, mapYPace(v));
    }
    ctx.font = tileFont(700, 12);
    ctx.textBaseline = "alphabetic";
    ctx.fillText("min/km", paceAxisX, y0 - 10);
  }

  if (hasHr) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
    ctx.clip();
    const gradient = ctx.createLinearGradient(0, y0, 0, y1);
    gradient.addColorStop(0, "rgba(239,68,68,0.30)");
    gradient.addColorStop(1, "rgba(239,68,68,0.02)");
    ctx.beginPath();
    hr.forEach(([t, v], i) => {
      const px = mapX(t);
      const py = mapYBpm(v);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.lineTo(mapX(hr[hr.length - 1][0]), y1);
    ctx.lineTo(mapX(hr[0][0]), y1);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.restore();

    ctx.beginPath();
    hr.forEach(([t, v], i) => {
      const px = mapX(t);
      const py = mapYBpm(v);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = TILE_COLORS.hr;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  if (hasCadence) {
    ctx.beginPath();
    cadence.forEach(([t, v], i) => {
      const px = mapX(t);
      const py = mapYRpm(v);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = TILE_COLORS.cadence;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  if (hasPace) {
    ctx.beginPath();
    pace.forEach(([t, v], i) => {
      const px = mapX(t);
      const py = mapYPace(v);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    });
    ctx.strokeStyle = TILE_COLORS.pace;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function tileDrawWorkoutProfile(ctx, x0, y0, x1, y1, xMax, plannedWorkout, hr, cadence, pace) {
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = TILE_MUTED;
  ctx.font = tileFont(700, 13);
  ctx.fillText("WORKOUT PROFILE", x0, y0 - 14);

  const barAreaRight = x0 + (x1 - x0) * 0.62;
  const baseline = y1 - 60;
  const barTop = y0 + 10;
  const mapX = (tMin) => x0 + (Math.max(0, Math.min(xMax, tMin)) / xMax) * (barAreaRight - x0);

  ctx.strokeStyle = TILE_GRID;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, baseline);
  ctx.lineTo(barAreaRight, baseline);
  ctx.stroke();

  const xStep = tileNiceMinuteStep(xMax);
  ctx.textAlign = "center";
  ctx.fillStyle = TILE_MUTED;
  ctx.font = tileFont(500, 12);
  for (let t = 0; t <= xMax + 0.001; t += xStep) {
    ctx.fillText(String(Math.round(t)), mapX(t), baseline + 18);
  }
  ctx.textAlign = "right";
  ctx.fillText(formatSeconds(plannedWorkout.totalDurationSec), barAreaRight, baseline + 18);
  ctx.fillText("min", barAreaRight, y0 - 14);

  const classes = new Set();
  plannedWorkout.segments.forEach((seg, i) => {
    const cls = tileClassifySegment(seg, i, plannedWorkout.segments.length);
    classes.add(cls);
    const zoneFrac = Math.max(0.14, (seg.zone || 1) / 5);
    const barH = (baseline - barTop) * zoneFrac;
    const sx = mapX(seg.startSec / 60);
    const ex = mapX((seg.startSec + seg.durationSec) / 60);
    const w = Math.max(1, ex - sx);
    ctx.fillStyle = TILE_ZONE_COLORS[cls];
    ctx.fillRect(sx, baseline - barH, w, barH);
  });

  const legendY = baseline + 42;
  let lx = x0;
  const legendOrder = ["warmup", "threshold", "recovery"];
  const legendLabels = { warmup: "WARM UP", threshold: "THRESHOLD", recovery: "RECOVERY" };
  legendOrder.filter((cls) => classes.has(cls)).forEach((cls) => {
    ctx.fillStyle = TILE_ZONE_COLORS[cls];
    ctx.fillRect(lx, legendY - 9, 14, 10);
    ctx.fillStyle = TILE_MUTED;
    ctx.font = tileFont(600, 12);
    ctx.textAlign = "left";
    ctx.fillText(legendLabels[cls], lx + 20, legendY);
    lx += 20 + ctx.measureText(legendLabels[cls]).width + 22;
  });

  const gaugeAreaLeft = barAreaRight + 40;
  const gaugeAreaW = x1 - gaugeAreaLeft;
  const gaugeR = 46;
  const gaugeCy = y0 + (y1 - y0) / 2 - 4;
  const gaugeXs = [0, 1, 2].map((i) => gaugeAreaLeft + gaugeAreaW * ((i + 0.5) / 3));

  const hrValues = hr.map((p) => p[1]);
  const avgHr = hrValues.length ? hrValues.reduce((a, b) => a + b, 0) / hrValues.length : null;
  const maxHr = hrValues.length ? Math.max(...hrValues) : null;
  const cadenceValues = cadence.map((p) => p[1]);
  const avgCadence = cadenceValues.length ? cadenceValues.reduce((a, b) => a + b, 0) / cadenceValues.length : null;
  const maxCadence = cadenceValues.length ? Math.max(...cadenceValues) : null;
  const paceValues = pace.map((p) => p[1]);
  const avgPace = paceValues.length ? paceValues.reduce((a, b) => a + b, 0) / paceValues.length : null;
  const bestPace = paceValues.length ? Math.min(...paceValues) : null;

  tileDrawGauge(
    ctx, gaugeXs[0], gaugeCy, gaugeR,
    avgHr != null && maxHr ? avgHr / maxHr : 0,
    TILE_COLORS.hr,
    avgHr != null ? String(Math.round(avgHr)) : "-", "bpm",
    "Avg HR", maxHr != null ? `Max ${Math.round(maxHr)}` : "Max -"
  );
  tileDrawGauge(
    ctx, gaugeXs[1], gaugeCy, gaugeR,
    avgCadence != null && maxCadence ? avgCadence / maxCadence : 0,
    TILE_COLORS.cadence,
    avgCadence != null ? String(Math.round(avgCadence)) : "-", "rpm",
    "Avg cadence", maxCadence != null ? `Max ${Math.round(maxCadence)}` : "Max -"
  );
  tileDrawGauge(
    ctx, gaugeXs[2], gaugeCy, gaugeR,
    avgPace != null && bestPace ? bestPace / avgPace : 0,
    TILE_COLORS.pace,
    avgPace != null ? formatPaceMinutes(avgPace) : "-", "min/km",
    "Avg pace", bestPace != null ? `Best ${formatPaceMinutes(bestPace)}` : "Best -"
  );
}

function tileDrawFooter(ctx, y, title) {
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = TILE_MUTED;
  ctx.font = tileFont(500, 15);
  const prefix = tileTruncateText(ctx, title, 480);
  ctx.fillText(prefix, TILE_PAD, y);
  const prefixW = ctx.measureText(prefix).width;
  ctx.fillText(" · Powered by ", TILE_PAD + prefixW, y);
  const sepW = ctx.measureText(" · Powered by ").width;
  ctx.font = tileFont(700, 15);
  ctx.fillStyle = TILE_ORANGE;
  ctx.fillText("STRAVA", TILE_PAD + prefixW + sepW, y);
}

/** Builds the full tile canvas from the currently-displayed activity/stream/planned
 *  workout snapshot. Returns null when there's nothing to render yet. */
function buildStravaTileCanvas(snapshot) {
  if (!snapshot || !snapshot.focusActivity) return null;
  const { focusActivity, hr, pace, cadence, plannedWorkout } = snapshot;
  const showProfile = !!(plannedWorkout && plannedWorkout.segments && plannedWorkout.segments.length);

  const height = TILE_HEADER_H + TILE_LEGEND_H + TILE_CHART_H + TILE_FOOTER_H + (showProfile ? TILE_PROFILE_H : 0);
  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = TILE_W * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  ctx.fillStyle = TILE_BG;
  ctx.fillRect(0, 0, TILE_W, height);

  tileDrawHeader(ctx, focusActivity, plannedWorkout);

  const legendY = TILE_HEADER_H - 6;
  tileDrawLegend(ctx, legendY, hr.length > 0, cadence.length > 0, pace.length > 0);

  const chartY0 = TILE_HEADER_H + TILE_LEGEND_H;
  const chartY1 = chartY0 + TILE_CHART_H;
  const chartX0 = TILE_PAD + 56;
  const chartX1 = TILE_W - TILE_PAD - 120;
  const streamMaxMin = [hr, cadence, pace].reduce((max, series) => (
    series.length ? Math.max(max, series[series.length - 1][0]) : max
  ), 0);
  const workoutMaxMin = showProfile ? plannedWorkout.totalDurationSec / 60 : 0;
  const xMax = Math.max(streamMaxMin, workoutMaxMin, 1);

  if (hr.length || cadence.length || pace.length) {
    tileDrawChart(ctx, chartX0, chartY0, chartX1, chartY1, xMax, hr, cadence, pace);
  } else {
    ctx.textAlign = "center";
    ctx.fillStyle = TILE_MUTED;
    ctx.font = tileFont(500, 16);
    ctx.fillText("No stream data available", TILE_W / 2, (chartY0 + chartY1) / 2);
  }

  let cursorY = chartY1;
  if (showProfile) {
    const profileY0 = cursorY + 36;
    const profileY1 = profileY0 + TILE_PROFILE_H - 36;
    tileDrawWorkoutProfile(ctx, chartX0, profileY0, chartX1, profileY1, xMax, plannedWorkout, hr, cadence, pace);
    cursorY = profileY1 + 20;
  } else {
    cursorY += 16;
  }

  tileDrawFooter(ctx, cursorY + (TILE_FOOTER_H - 20), plannedWorkout?.name || focusActivity.activity_name || "Activity");

  return canvas;
}

function tileFileName(focusActivity) {
  const base = String(focusActivity?.activity_name || focusActivity?.activity_type || "activity")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "activity";
  return `${base}-strava-tile.png`;
}

async function handleDownloadStravaTile() {
  const statusEl = document.getElementById("activity-lab-tile-status");
  const snapshot = state.activityLab.lastTileSnapshot;
  if (!snapshot || !snapshot.focusActivity) {
    if (statusEl) statusEl.textContent = "Open an activity and let its stream load first.";
    return;
  }
  const canvas = buildStravaTileCanvas(snapshot);
  if (!canvas) {
    if (statusEl) statusEl.textContent = "Nothing to export yet.";
    return;
  }
  if (statusEl) statusEl.textContent = "Generating tile…";
  canvas.toBlob((blob) => {
    if (!blob) {
      if (statusEl) statusEl.textContent = "Failed to generate tile.";
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = tileFileName(snapshot.focusActivity);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    if (statusEl) statusEl.textContent = "Tile downloaded.";
  }, "image/png");
}
