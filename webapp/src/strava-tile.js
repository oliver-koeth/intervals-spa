/* ─── Strava-style shareable tile export ─────────────────────────────────
 * Recreates the reference "workout tile": a square dark card with a Strava
 * wordmark, an activity-type badge, a five-metric KPI strip, a stepped
 * WORKOUT STRUCTURE chart (from the paired planned workout), a TIME IN HR
 * ZONES bar list (from the HR stream + athlete zone model), and a footer.
 *
 * Icons are Lucide glyphs (24x24 stroke paths) drawn straight onto the
 * canvas via Path2D, so the exported PNG is fully self-contained.
 *
 * The renderer is split in two so it can be unit-tested off-DOM:
 *   - renderStravaTile(ctx, model)   pure drawing from a normalized model
 *   - buildStravaTileModel(snapshot) app data -> normalized model
 */

/* ── Geometry ─────────────────────────────────────────────────────────── */
const TILE_W = 1000;
const TILE_H = 1000;
const TILE_PAD = 44;
const TILE_SCALE = 2;

/* ── Palette ──────────────────────────────────────────────────────────── */
const TILE_BG = "#0d0d0d";
const TILE_TEXT = "#ffffff";
const TILE_MUTED = "#8a8f98";
const TILE_FAINT = "#5c616b";
const TILE_ORANGE = "#fc4c02";
const TILE_ORANGE_SOFT = "#ff7a3c";
const TILE_DIVIDER = "rgba(255,255,255,0.08)";
const TILE_TRACK = "#26292f";

const TILE_FONT_FAMILY = '-apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function tileFont(weight, size) {
  return `${weight} ${size}px ${TILE_FONT_FAMILY}`;
}

/* ── Lucide icons ─────────────────────────────────────────────────────────
 * Each entry is a list of primitives: a string is an SVG path "d"; an object
 * {c:[cx,cy,r]} is a circle. All are drawn stroked in a 24x24 view box, the
 * Lucide convention (stroke-width 2, round caps/joins, no fill). */
const TILE_ICONS = {
  "calendar-days": [
    "M8 2v4", "M16 2v4",
    "M3 10h18",
    "M5 4h14a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z",
    "M8 14h.01", "M12 14h.01", "M16 14h.01",
    "M8 18h.01", "M12 18h.01", "M16 18h.01",
  ],
  "clock-3": [
    { c: [12, 12, 10] },
    "M12 6v6h4.5",
  ],
  footprints: [
    "M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z",
    "M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z",
    "M16 17h4", "M4 13h4",
  ],
  heart: [
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  ],
  zap: [
    "M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z",
  ],
  weight: [
    { c: [12, 5, 3] },
    "M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.46A2 2 0 0 0 17.48 8Z",
  ],
  signal: [
    "M2 20h.01", "M7 20v-4", "M12 20v-8", "M17 20V8", "M22 4v16",
  ],
  activity: [
    "M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2",
  ],
  bike: [
    { c: [18.5, 17.5, 3.5] }, { c: [5.5, 17.5, 3.5] }, { c: [15, 5, 1] },
    "M12 17.5V14l-3-3 4-3 2 3h2",
  ],
  waves: [
    "M2 6c.6.5 1.2 1 2.5 1C7 7 7 5 9.5 5c2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
    "M2 12c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
    "M2 18c.6.5 1.2 1 2.5 1 2.5 0 2.5-2 5-2 2.6 0 2.4 2 5 2 2.5 0 2.5-2 5-2 1.3 0 1.9.5 2.5 1",
  ],
};

/* Activity-type -> badge icon. Falls back to the Lucide "activity" pulse. */
function tileActivityIconName(type) {
  const t = String(type || "").toLowerCase();
  if (/(^|_)(ride|cycl|bike|gravel|mountain|virtualride)/.test(t)) return "bike";
  if (/swim/.test(t)) return "waves";
  if (/row|paddle|kayak|canoe/.test(t)) return "waves";
  if (/run|walk|hike|treadmill|trail/.test(t)) return "footprints";
  return "activity";
}

/** Stroke a Lucide icon inside a size x size box whose top-left is (x, y). */
function tileDrawIcon(ctx, name, x, y, size, color, strokeVisual = 2) {
  const prims = TILE_ICONS[name];
  if (!prims) return;
  const s = size / 24;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeVisual / s;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const prim of prims) {
    let path;
    if (typeof prim === "string") {
      path = new Path2D(prim);
    } else if (prim && prim.c) {
      const [cx, cy, r] = prim.c;
      path = new Path2D(`M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`);
    } else {
      continue;
    }
    ctx.stroke(path);
  }
  ctx.restore();
}

/* ── Small drawing helpers ────────────────────────────────────────────── */
function tileText(ctx, text, x, y, { font, color, align = "left", baseline = "alphabetic", tracking = 0 } = {}) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = baseline;
  if ("letterSpacing" in ctx) {
    try { ctx.letterSpacing = `${tracking}px`; } catch (_) { /* older canvas */ }
  }
  ctx.fillText(text, x, y);
  if ("letterSpacing" in ctx) {
    try { ctx.letterSpacing = "0px"; } catch (_) { /* noop */ }
  }
}

function tileMeasure(ctx, text, font) {
  ctx.font = font;
  return ctx.measureText(text).width;
}

function tileTruncate(ctx, text, maxWidth, font) {
  ctx.font = font;
  if (ctx.measureText(text).width <= maxWidth) return text;
  let s = String(text);
  while (s.length > 1 && ctx.measureText(`${s}…`).width > maxWidth) s = s.slice(0, -1);
  return `${s}…`;
}

function tileRoundRect(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function tileDivider(ctx, y, x0 = TILE_PAD, x1 = TILE_W - TILE_PAD) {
  ctx.strokeStyle = TILE_DIVIDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x0, y + 0.5);
  ctx.lineTo(x1, y + 0.5);
  ctx.stroke();
}

/* ── Sections ─────────────────────────────────────────────────────────── */
function tileDrawHeader(ctx, model) {
  // Brand wordmark.
  tileText(ctx, "Trail Data Hub", TILE_PAD, 78, {
    font: tileFont(800, 30), color: TILE_ORANGE, tracking: 1,
  });

  // Title + subtitle.
  const titleMax = TILE_W - TILE_PAD - 160 - TILE_PAD;
  tileText(ctx, tileTruncate(ctx, model.title, titleMax, tileFont(700, 44)), TILE_PAD, 150, {
    font: tileFont(700, 44), color: TILE_TEXT,
  });
  if (model.subtitle) {
    tileText(ctx, tileTruncate(ctx, model.subtitle, titleMax, tileFont(400, 28)), TILE_PAD, 196, {
      font: tileFont(400, 28), color: TILE_MUTED,
    });
  }

  // Activity-type badge (top-right circle).
  const r = 50;
  const cx = TILE_W - TILE_PAD - r;
  const cy = 118;
  ctx.strokeStyle = TILE_ORANGE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.stroke();
  const iconSize = 48;
  tileDrawIcon(ctx, model.typeIcon, cx - iconSize / 2, cy - iconSize / 2, iconSize, TILE_ORANGE, 2.2);

  tileDivider(ctx, 232);
}

// Reference-matched column origins (date column is widest to fit "Aug 25, 2026").
const TILE_KPI_X = [44, 258, 468, 662, 820];

function tileDrawKpis(ctx, model) {
  const cols = model.kpis;
  cols.forEach((kpi, i) => {
    const x = TILE_KPI_X[i] != null ? TILE_KPI_X[i] : TILE_PAD + ((TILE_W - TILE_PAD * 2) / cols.length) * i;
    tileDrawIcon(ctx, kpi.icon, x, 268, 30, TILE_ORANGE, 2);
    tileText(ctx, kpi.label, x, 344, { font: tileFont(700, 15), color: TILE_MUTED, tracking: 0.5 });
    tileText(ctx, kpi.value, x, 384, { font: tileFont(700, 30), color: TILE_TEXT });
  });
  tileDivider(ctx, 428);
}

/** Stepped WORKOUT STRUCTURE profile (left body column). */
function tileDrawWorkoutStructure(ctx, model, area) {
  const { x0, x1, headingY, chartTop, chartBottom, labelY, legendY } = area;
  tileText(ctx, "WORKOUT STRUCTURE", x0, headingY, {
    font: tileFont(700, 15), color: TILE_MUTED, tracking: 1,
  });

  const wk = model.workout;
  if (!wk || !wk.segments.length) {
    tileText(ctx, "No planned workout", x0, (chartTop + chartBottom) / 2, {
      font: tileFont(500, 16), color: TILE_FAINT, baseline: "middle",
    });
    return;
  }

  const total = wk.totalDurationSec || wk.segments.reduce((s, seg) => s + seg.durationSec, 0);
  const mapX = (sec) => x0 + (Math.max(0, Math.min(total, sec)) / total) * (x1 - x0);
  const levelY = (zone) => {
    const z = Math.max(1, Math.min(5, zone || 1));
    const frac = 0.12 + ((z - 1) / 4) * 0.82;
    return chartBottom - frac * (chartBottom - chartTop);
  };

  // Top profile polyline (horizontal per segment, vertical steps between).
  const pts = [];
  wk.segments.forEach((seg) => {
    const y = levelY(seg.zone);
    pts.push([mapX(seg.startSec), y]);
    pts.push([mapX(seg.startSec + seg.durationSec), y]);
  });

  // Gradient area fill under the profile.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(pts[0][0], chartBottom);
  pts.forEach(([px, py]) => ctx.lineTo(px, py));
  ctx.lineTo(pts[pts.length - 1][0], chartBottom);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, chartTop, 0, chartBottom);
  grad.addColorStop(0, "rgba(252,76,2,0.55)");
  grad.addColorStop(1, "rgba(252,76,2,0.04)");
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();

  // Orange top stroke.
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
  ctx.strokeStyle = TILE_ORANGE;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = "round";
  ctx.stroke();

  // Dashed recovery markers.
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 1.4;
  ctx.setLineDash([2, 6]);
  (wk.recoveries || []).forEach((sec) => {
    const x = mapX(sec);
    ctx.beginPath();
    ctx.moveTo(x, chartTop);
    ctx.lineTo(x, chartBottom);
    ctx.stroke();
  });
  ctx.setLineDash([]);

  // X-axis time labels.
  const ticks = tileTimeTicks(total);
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = tileFont(500, 14);
  ctx.fillStyle = TILE_MUTED;
  ticks.forEach((sec) => {
    let align = "center";
    if (sec === 0) align = "left";
    else if (sec >= total - 0.5) align = "right";
    tileText(ctx, formatSeconds(sec), mapX(sec), labelY, { font: tileFont(500, 14), color: TILE_MUTED, align });
  });

  // Legend: work line + dashed recoveries.
  let lx = x0;
  ctx.strokeStyle = TILE_ORANGE;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(lx, legendY);
  ctx.lineTo(lx + 22, legendY);
  ctx.stroke();
  lx += 30;
  const workLabel = wk.workLabel || "Work";
  tileText(ctx, workLabel, lx, legendY, { font: tileFont(600, 14), color: TILE_MUTED, baseline: "middle" });
  lx += tileMeasure(ctx, workLabel, tileFont(600, 14)) + 26;

  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 1.6;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(lx, legendY);
  ctx.lineTo(lx + 22, legendY);
  ctx.stroke();
  ctx.setLineDash([]);
  lx += 30;
  tileText(ctx, "Recoveries", lx, legendY, { font: tileFont(600, 14), color: TILE_MUTED, baseline: "middle" });
}

/** TIME IN HR ZONES bar list (right body column). */
function tileDrawHrZones(ctx, model, area) {
  const { x0, x1, headingY, rowsTop, rowsBottom } = area;
  tileText(ctx, "TIME IN HR ZONES", x0, headingY, {
    font: tileFont(700, 15), color: TILE_MUTED, tracking: 1,
  });

  const zones = model.hrZones;
  if (!zones || !zones.length) {
    tileText(ctx, "No HR zone data", x0, (rowsTop + rowsBottom) / 2, {
      font: tileFont(500, 16), color: TILE_FAINT, baseline: "middle",
    });
    return;
  }

  // Draw Z(n) at top down to Z1 at bottom.
  const ordered = zones.slice().sort((a, b) => b.zone - a.zone);
  const rowH = (rowsBottom - rowsTop) / ordered.length;
  const barX0 = x0 + 100;
  const pctX = x1;
  const timeX = x1 - 62;
  const barX1 = timeX - 74;

  ordered.forEach((z, i) => {
    const cy = rowsTop + rowH * (i + 0.5);
    // Zone label + bpm range.
    tileText(ctx, `Z${z.zone}`, x0, cy - 4, { font: tileFont(700, 20), color: TILE_TEXT });
    tileText(ctx, z.range, x0, cy + 18, { font: tileFont(500, 13), color: TILE_MUTED });

    // Bar track + fill.
    const barY = cy - 5;
    const barH = 10;
    tileRoundRect(ctx, barX0, barY, barX1 - barX0, barH, barH / 2);
    ctx.fillStyle = TILE_TRACK;
    ctx.fill();
    const frac = Math.max(0, Math.min(1, z.pct));
    const fillW = (barX1 - barX0) * frac;
    if (fillW > 1) {
      tileRoundRect(ctx, barX0, barY, fillW, barH, barH / 2);
      ctx.fillStyle = z.pct > 0 ? TILE_ORANGE : TILE_TRACK;
      ctx.fill();
    }

    // Time + percentage.
    tileText(ctx, formatSeconds(z.seconds), timeX, cy + 6, {
      font: tileFont(700, 20), color: TILE_TEXT, align: "right",
    });
    const pctText = `${Math.round(z.pct * 100)}%`;
    tileText(ctx, pctText, pctX, cy + 6, {
      font: tileFont(700, 20), color: z.pct > 0 ? TILE_ORANGE : TILE_FAINT, align: "right",
    });
  });
}

function tileDrawFooterItem(ctx, x, cy, icon, label, value, align = "left") {
  if (align === "left") {
    tileDrawIcon(ctx, icon, x, cy - 16, 30, TILE_ORANGE, 2);
    const tx = x + 44;
    tileText(ctx, label, tx, cy - 6, { font: tileFont(700, 13), color: TILE_MUTED, tracking: 0.5 });
    tileText(ctx, value, tx, cy + 20, { font: tileFont(700, 24), color: TILE_TEXT });
    return tx + Math.max(tileMeasure(ctx, label, tileFont(700, 13)), tileMeasure(ctx, value, tileFont(700, 24)));
  }
  // Right-aligned: text block ends at x, icon sits to the left of it.
  const labelW = tileMeasure(ctx, label, tileFont(700, 13));
  const valueW = tileMeasure(ctx, value, tileFont(700, 24));
  const blockW = Math.max(labelW, valueW);
  const tx = x;
  tileText(ctx, label, tx, cy - 6, { font: tileFont(700, 13), color: TILE_MUTED, align: "right", tracking: 0.5 });
  tileText(ctx, value, tx, cy + 20, { font: tileFont(700, 24), color: TILE_TEXT, align: "right" });
  tileDrawIcon(ctx, icon, tx - blockW - 44, cy - 16, 30, TILE_ORANGE, 2);
  return tx - blockW - 44;
}

function tileDrawFooter(ctx, model, cy) {
  const loadRight = tileDrawFooterItem(ctx, TILE_PAD, cy, "weight", "LOAD", model.footer.load, "left");
  const sepX = loadRight + 34;
  ctx.strokeStyle = TILE_DIVIDER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(sepX, cy - 20);
  ctx.lineTo(sepX, cy + 20);
  ctx.stroke();
  tileDrawFooterItem(ctx, sepX + 34, cy, "signal", "SOURCE", model.footer.source, "left");
  tileDrawFooterItem(ctx, TILE_W - TILE_PAD, cy, "activity", "MAX HR", model.footer.maxHr, "right");
}

/* ── Axis helpers ─────────────────────────────────────────────────────── */
function tileTimeTicks(totalSec) {
  const stepsMin = [1, 2, 5, 10, 15, 20, 30, 60];
  const totalMin = totalSec / 60;
  const step = (stepsMin.find((s) => totalMin / s <= 6) || 60) * 60;
  const ticks = [];
  for (let t = 0; t < totalSec - step * 0.35; t += step) ticks.push(Math.round(t));
  ticks.push(Math.round(totalSec));
  return ticks;
}

/* ── Pure renderer ────────────────────────────────────────────────────── */
function renderStravaTile(ctx, model) {
  ctx.fillStyle = TILE_BG;
  ctx.fillRect(0, 0, TILE_W, TILE_H);

  tileDrawHeader(ctx, model);
  tileDrawKpis(ctx, model);

  const bodyHeadingY = 484;
  const leftX0 = TILE_PAD;
  const leftX1 = 488;
  const rightX0 = 520;
  const rightX1 = TILE_W - TILE_PAD;

  tileDrawWorkoutStructure(ctx, model, {
    x0: leftX0, x1: leftX1,
    headingY: bodyHeadingY,
    chartTop: 516, chartBottom: 748,
    labelY: 776, legendY: 812,
  });
  tileDrawHrZones(ctx, model, {
    x0: rightX0, x1: rightX1,
    headingY: bodyHeadingY,
    rowsTop: 508, rowsBottom: 812,
  });

  tileDivider(ctx, 872);
  tileDrawFooter(ctx, model, 930);
}

/* ── App-data adapter ─────────────────────────────────────────────────── */
const TILE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function tileFormatDate(dateStr) {
  const m = String(dateStr || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return String(dateStr || "-");
  return `${TILE_MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function tileZoneName(zone) {
  return { 1: "Recovery", 2: "Endurance", 3: "Tempo", 4: "Threshold", 5: "VO2 Max" }[zone] || "Effort";
}

/** Best-effort "3 × 8 min" summary of the planned workout's repeated work blocks. */
function tileSummarizeWorkout(plannedWorkout) {
  if (!plannedWorkout || !plannedWorkout.segments) return "";
  const work = plannedWorkout.segments.filter((s) => (s.zone || 0) >= 4);
  if (work.length >= 2) {
    const rounded = work.map((s) => Math.round(s.durationSec / 5) * 5);
    const counts = new Map();
    rounded.forEach((d) => counts.set(d, (counts.get(d) || 0) + 1));
    let bestD = null;
    let bestN = 0;
    counts.forEach((n, d) => { if (n > bestN) { bestN = n; bestD = d; } });
    if (bestN >= 2 && bestD) {
      const mm = Math.floor(bestD / 60);
      const ss = bestD % 60;
      const label = ss ? `${mm}:${String(ss).padStart(2, "0")}` : `${mm} min`;
      return `${bestN} × ${label}`;
    }
  }
  return String(plannedWorkout.description || "").split("\n")[0].slice(0, 60);
}

function tileBuildWorkoutModel(plannedWorkout) {
  if (!plannedWorkout || !plannedWorkout.segments || !plannedWorkout.segments.length) return null;
  const segments = plannedWorkout.segments;
  const total = plannedWorkout.totalDurationSec || segments.reduce((s, seg) => s + seg.durationSec, 0);

  // Recovery markers: valleys flanked by higher-effort neighbours.
  const recoveries = [];
  for (let i = 1; i < segments.length - 1; i++) {
    const prev = segments[i - 1].zone || 0;
    const cur = segments[i].zone || 0;
    const next = segments[i + 1].zone || 0;
    if (cur < prev && cur <= next && prev >= 4) {
      recoveries.push(segments[i].startSec + segments[i].durationSec / 2);
    }
  }

  const workZones = segments.filter((s) => (s.zone || 0) >= 4).map((s) => s.zone);
  const topWork = workZones.length ? Math.max(...workZones) : null;
  const summary = tileSummarizeWorkout(plannedWorkout);
  const workLabel = topWork ? `${summary || "Work"} @ ${tileZoneName(topWork)}` : (summary || "Work");

  return { segments, totalDurationSec: total, recoveries, workLabel };
}

/** Seconds spent in each HR zone, from the HR stream and athlete zone model. */
function tileComputeHrZones(hr, zoneModel, fallbackZoneTimes) {
  const bounds = zoneModel && Array.isArray(zoneModel.hr_zones) ? zoneModel.hr_zones : null;
  if (!bounds || !bounds.length) return null;
  const n = bounds.length;

  let seconds = null;
  if (hr && hr.length > 1) {
    seconds = new Array(n).fill(0);
    for (let i = 1; i < hr.length; i++) {
      const bpm = hr[i][1];
      let dt = (hr[i][0] - hr[i - 1][0]) * 60;
      if (!Number.isFinite(dt) || dt < 0) dt = 0;
      if (dt > 10) dt = 1; // guard large gaps
      let zi = n - 1;
      for (let z = 0; z < n; z++) { if (bpm <= bounds[z]) { zi = z; break; } }
      seconds[zi] += dt;
    }
  } else if (Array.isArray(fallbackZoneTimes) && fallbackZoneTimes.length) {
    seconds = new Array(n).fill(0);
    for (let z = 0; z < n; z++) seconds[z] = Number(fallbackZoneTimes[z]) || 0;
  }
  if (!seconds) return null;

  const total = seconds.reduce((a, b) => a + b, 0) || 1;
  const rows = [];
  for (let z = 0; z < n; z++) {
    let range;
    if (z === 0) range = `< ${bounds[0] + 1} bpm`;
    else if (z === n - 1) range = `> ${bounds[n - 2]} bpm`;
    else range = `${bounds[z - 1] + 1} – ${bounds[z]} bpm`;
    rows.push({ zone: z + 1, range, seconds: Math.round(seconds[z]), pct: seconds[z] / total });
  }
  return rows;
}

function tileAvgFromStream(series) {
  if (!series || !series.length) return null;
  let sum = 0;
  for (const p of series) sum += p[1];
  return sum / series.length;
}

function tileTitleCase(s) {
  const str = String(s || "");
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Convert the Activity Lab snapshot into a normalized tile model. */
function buildStravaTileModel(snapshot, zoneModel) {
  if (!snapshot || !snapshot.focusActivity) return null;
  const a = snapshot.focusActivity;
  const hr = snapshot.hr || [];
  const pace = snapshot.pace || [];
  const cadence = snapshot.cadence || [];
  const planned = snapshot.plannedWorkout || null;

  const avgHr = a.avg_hr > 0 ? a.avg_hr : tileAvgFromStream(hr);
  const maxHr = a.max_hr > 0 ? a.max_hr : (hr.length ? Math.max(...hr.map((p) => p[1])) : null);

  const kpis = [
    { icon: "calendar-days", label: "DATE", value: tileFormatDate(a.date) },
    { icon: "clock-3", label: "DURATION", value: a.moving_time_s ? formatSeconds(a.moving_time_s) : "-" },
    { icon: "footprints", label: "DISTANCE", value: a.distance_m ? formatDistance(a.distance_m) : "-" },
    { icon: "heart", label: "AVG HR", value: avgHr ? `${Math.round(avgHr)} bpm` : "-" },
    { icon: "zap", label: "AVG PACE", value: formatAvgPace(a.moving_time_s, a.distance_m) },
  ];

  return {
    title: planned?.name || a.activity_name || a.activity_type || "Activity",
    subtitle: tileSummarizeWorkout(planned),
    typeIcon: tileActivityIconName(a.activity_type),
    kpis,
    workout: tileBuildWorkoutModel(planned),
    hrZones: tileComputeHrZones(hr, zoneModel, a.hr_zone_times),
    footer: {
      load: a.training_load != null ? String(Math.round(a.training_load)) : "-",
      source: tileTitleCase(a.source || "intervals"),
      maxHr: maxHr ? `${Math.round(maxHr)} bpm` : "-",
    },
  };
}

/* ── Canvas assembly + download ───────────────────────────────────────── */
function buildStravaTileCanvas(snapshot) {
  const zoneModel = typeof getSelectedZoneModel === "function" ? getSelectedZoneModel() : null;
  const model = buildStravaTileModel(snapshot, zoneModel);
  if (!model) return null;

  const canvas = document.createElement("canvas");
  canvas.width = TILE_W * TILE_SCALE;
  canvas.height = TILE_H * TILE_SCALE;
  const ctx = canvas.getContext("2d");
  ctx.scale(TILE_SCALE, TILE_SCALE);
  renderStravaTile(ctx, model);
  return canvas;
}

function tileFileName(focusActivity) {
  const base = String(focusActivity?.activity_name || focusActivity?.activity_type || "activity")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "activity";
  return `${base}-strava-tile.png`;
}

/** Triggers a browser download of the tile canvas as a PNG. */
function downloadTileCanvas(canvas, focusActivity) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("Failed to render tile image.")); return; }
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = tileFileName(focusActivity);
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
      resolve();
    }, "image/png");
  });
}

/* ── Strava activity matching ─────────────────────────────────────────────
 * Strava's public API can't attach photos to an activity, so the upload is a
 * manual step. We help by finding the Strava activity that corresponds to the
 * (intervals.icu-sourced) focus activity — exact calendar date, closest start
 * time — and hand the user a deep link to open it. */
function tileLocalEpochSeconds(isoLocal) {
  // Treat the naming as wall-clock local time; parse the components directly so
  // intervals.icu local times and Strava start_date_local compare like-for-like.
  const m = String(isoLocal || "").match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return NaN;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000;
}

function tileLocalDateStr(isoLocal) {
  const m = String(isoLocal || "").match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : "";
}

/** Finds the Strava activity matching the focus activity by date + close time.
 *  Returns { id, name, type, start } or null. Throws on auth/network failure. */
async function findMatchingStravaActivity(focusActivity) {
  if (typeof getSettings !== "function" || typeof refreshStravaTokenIfNeeded !== "function"
      || typeof stravaGet !== "function") {
    throw new Error("Strava integration is unavailable.");
  }
  const settings = getSettings();
  const token = await refreshStravaTokenIfNeeded(settings);
  if (!token) throw new Error("No Strava access token. Connect Strava in Settings first.");

  const startIso = focusActivity.activity_start_local || `${focusActivity.date}T00:00:00`;
  const targetDate = tileLocalDateStr(startIso);
  const targetEpoch = tileLocalEpochSeconds(startIso);
  if (!targetDate) throw new Error("This activity has no start date to match on.");

  // Query a generous ±36h UTC window around the local day, then filter locally.
  const dayStartUtc = Date.parse(`${targetDate}T00:00:00Z`) / 1000;
  const after = Math.floor(dayStartUtc - 36 * 3600);
  const before = Math.floor(dayStartUtc + 60 * 3600);

  const activities = await stravaGet(
    `/athlete/activities?after=${after}&before=${before}&per_page=100`,
    settings, token
  );
  if (!Array.isArray(activities) || !activities.length) return null;

  const sameDay = activities.filter((a) => tileLocalDateStr(a.start_date_local) === targetDate);
  if (!sameDay.length) return null;

  let best = null;
  let bestDelta = Infinity;
  for (const a of sameDay) {
    const epoch = tileLocalEpochSeconds(a.start_date_local);
    const delta = Number.isFinite(targetEpoch) && Number.isFinite(epoch)
      ? Math.abs(epoch - targetEpoch) : 0;
    if (delta < bestDelta) { bestDelta = delta; best = a; }
  }
  if (!best) return null;
  // Exact date is required; accept the closest start time within 30 minutes,
  // or fall back to a sole same-day match regardless of time.
  if (bestDelta > 1800 && sameDay.length > 1) return null;
  return {
    id: best.id,
    name: best.name || "(untitled activity)",
    type: best.sport_type || best.type || "",
    start: best.start_date_local || "",
    deltaSec: Number.isFinite(bestDelta) ? bestDelta : null,
  };
}

/* ── Upload-assist modal ──────────────────────────────────────────────── */
function tileModalEl(id) { return document.getElementById(id); }

function closeStravaUploadModal() {
  const modal = tileModalEl("strava-upload-modal");
  if (modal) modal.classList.add("hidden");
}

function openStravaUploadModal() {
  const modal = tileModalEl("strava-upload-modal");
  if (!modal) return;
  modal.classList.remove("hidden");
  // Reset to the searching state.
  tileModalEl("strava-upload-status").classList.remove("hidden");
  tileModalEl("strava-upload-status").textContent = "Searching for the matching Strava activity…";
  tileModalEl("strava-upload-match").classList.add("hidden");
  tileModalEl("strava-upload-instructions").classList.add("hidden");
  const openBtn = tileModalEl("strava-upload-open");
  openBtn.classList.add("hidden");
  openBtn.removeAttribute("href");
  openBtn.textContent = "Open in Strava";
  tileModalEl("strava-upload-cancel").classList.remove("hidden");
  tileModalEl("strava-upload-done").classList.add("hidden");
}

function tileFormatModalDateTime(isoLocal) {
  const m = String(isoLocal || "").match(/(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  if (!m) return isoLocal || "";
  return `${tileFormatDate(`${m[1]}-${m[2]}-${m[3]}`)} · ${m[4]}:${m[5]}`;
}

function showStravaUploadMatch(match) {
  tileModalEl("strava-upload-status").textContent =
    "Tile downloaded. Matched this Strava activity:";
  const matchBox = tileModalEl("strava-upload-match");
  tileModalEl("strava-upload-match-name").textContent = match.name;
  const metaParts = [tileFormatModalDateTime(match.start)];
  if (match.type) metaParts.push(match.type);
  if (match.deltaSec != null && match.deltaSec > 60) {
    metaParts.push(`±${formatSeconds(match.deltaSec)} vs. selected`);
  }
  tileModalEl("strava-upload-match-meta").textContent = metaParts.join("  ·  ");
  matchBox.classList.remove("hidden");
  tileModalEl("strava-upload-instructions").classList.remove("hidden");

  const openBtn = tileModalEl("strava-upload-open");
  openBtn.href = `https://www.strava.com/activities/${encodeURIComponent(match.id)}`;
  openBtn.classList.remove("hidden");
}

function showStravaUploadNoMatch(message) {
  tileModalEl("strava-upload-status").textContent = message;
  tileModalEl("strava-upload-instructions").classList.remove("hidden");
  // Still let the user jump to their Strava activity feed to do it manually.
  const openBtn = tileModalEl("strava-upload-open");
  openBtn.href = "https://www.strava.com/athlete/training";
  openBtn.textContent = "Open Strava";
  openBtn.classList.remove("hidden");
}

function finishStravaUploadModal() {
  tileModalEl("strava-upload-cancel").classList.add("hidden");
  tileModalEl("strava-upload-done").classList.remove("hidden");
}

async function handleDownloadStravaTile() {
  const statusEl = document.getElementById("activity-lab-tile-status");
  const snapshot = state.activityLab.lastTileSnapshot;
  if (!snapshot || !snapshot.focusActivity) {
    if (statusEl) statusEl.textContent = "Open an activity and let its stream load first.";
    return;
  }
  if (statusEl) statusEl.textContent = "Generating tile…";
  const canvas = buildStravaTileCanvas(snapshot);
  if (!canvas) {
    if (statusEl) statusEl.textContent = "Nothing to export yet.";
    return;
  }

  try {
    await downloadTileCanvas(canvas, snapshot.focusActivity);
    if (statusEl) statusEl.textContent = "Tile downloaded.";
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message || "Failed to generate tile.";
    return;
  }

  // Open the assist modal and search for the matching Strava activity.
  openStravaUploadModal();
  try {
    const match = await findMatchingStravaActivity(snapshot.focusActivity);
    if (match) showStravaUploadMatch(match);
    else showStravaUploadNoMatch("No matching Strava activity found for this date. You can still add the tile manually.");
  } catch (err) {
    showStravaUploadNoMatch(`Couldn't search Strava: ${err.message}. You can still add the tile manually.`);
  } finally {
    finishStravaUploadModal();
  }
}

function bindStravaUploadModal() {
  const cancel = tileModalEl("strava-upload-cancel");
  const done = tileModalEl("strava-upload-done");
  const closeX = tileModalEl("strava-upload-close-x");
  const modal = tileModalEl("strava-upload-modal");
  if (cancel) cancel.addEventListener("click", closeStravaUploadModal);
  if (done) done.addEventListener("click", closeStravaUploadModal);
  if (closeX) closeX.addEventListener("click", closeStravaUploadModal);
  if (modal) {
    modal.addEventListener("click", (e) => { if (e.target === modal) closeStravaUploadModal(); });
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindStravaUploadModal);
  } else {
    bindStravaUploadModal();
  }
}

/* Node test harness hook (ignored in the browser). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    renderStravaTile, buildStravaTileModel, tileComputeHrZones, tileBuildWorkoutModel,
    tileFormatDate, tileTimeTicks, TILE_W, TILE_H, TILE_SCALE, TILE_ICONS,
  };
}
