/* ─── Activities calendar view ─────────────────────────────────────────────
 * Weekly grid modeled on the Strava "Training Log" calendar: one row per
 * ISO week (Monday-start), a day column per weekday holding activity chips,
 * and a week-summary column on the right (total time/distance/load + time
 * in zones). Colour/icon language intentionally mirrors the Strava-style
 * tile (src/strava-tile.js): footprints for Run, bike for Ride, a flag for
 * Race, and a dumbbell/weight glyph — reused here in purple — for every
 * other activity type (Strength, Mobility, Swim, etc.). We only show data
 * this app actually has cached, so trend/fitness-form info ("Productive"
 * label + sparkline) from the Strava UI is intentionally left out. */

/* Same stroke-only Lucide primitives used by the Strava tile, so the chip
 * icons look consistent with the rest of the app. "flag" is new (race). */
const CAL_ICONS = {
  footprints: [
    "M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z",
    "M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z",
    "M16 17h4", "M4 13h4",
  ],
  bike: [
    { c: [18.5, 17.5, 3.5] }, { c: [5.5, 17.5, 3.5] }, { c: [15, 5, 1] },
    "M12 17.5V14l-3-3 4-3 2 3h2",
  ],
  flag: [
    "M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z",
    "M4 22v-7",
  ],
  weight: [
    { c: [12, 5, 3] },
    "M6.5 8a2 2 0 0 0-1.905 1.46L2.1 18.5A2 2 0 0 0 4 21h16a2 2 0 0 0 1.925-2.54L19.4 9.46A2 2 0 0 0 17.48 8Z",
  ],
};

function calIconSvg(name, color) {
  const prims = CAL_ICONS[name] || CAL_ICONS.weight;
  const inner = prims.map((p) => (
    typeof p === "string"
      ? `<path d="${p}"/>`
      : `<circle cx="${p.c[0]}" cy="${p.c[1]}" r="${p.c[2]}"/>`
  )).join("");
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round" class="cal-icon-svg">${inner}</svg>`;
}

/* Category → colour/icon/label. Only Run, Ride and Race get their own
 * identity (matching the reference screenshot); everything else — Strength,
 * Mobility, Swim, Workout, etc. — is grouped into "Other" and shown in
 * purple, per spec. */
const CAL_CATEGORIES = {
  run:   { icon: "footprints", color: "#51b8ff", label: "Run" },
  ride:  { icon: "bike",       color: "#54e0a1", label: "Ride" },
  race:  { icon: "flag",       color: "#f97316", label: "Race" },
  other: { icon: "weight",     color: "#a78bfa", label: "Strength / Mobility" },
};

function calCategoryFor(item) {
  if (item.is_race) return "race";
  const t = String(item.activity_type || "").toLowerCase();
  if (/(^|_)(ride|cycl|bike|gravel|mountain|virtualride)/.test(t)) return "ride";
  if (/run|walk|hike|treadmill|trail/.test(t)) return "run";
  return "other";
}

/* Monday of the ISO week containing dateStr ("YYYY-MM-DD"), as "YYYY-MM-DD". */
function calMondayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function calFmtDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function calFmtRange(monday) {
  const sunday = new Date(monday);
  sunday.setDate(sunday.getDate() + 6);
  const opts = { month: "short", day: "numeric" };
  const from = monday.toLocaleDateString(undefined, opts);
  const to = sunday.toLocaleDateString(undefined, { ...opts, year: "numeric" });
  return `${from} – ${to}`;
}

function calChipHtml(item) {
  const cat = CAL_CATEGORIES[calCategoryFor(item)];
  const name = item.activity_name || item.activity_type || "Activity";
  const metaParts = [];
  if (item.moving_time_s) metaParts.push(formatSeconds(item.moving_time_s));
  if (item.distance_m) metaParts.push(formatDistance(item.distance_m));
  return `
    <div class="cal-chip" data-activity-id="${item.activity_id}" style="--cal-chip-color:${cat.color}" title="${name}">
      <span class="cal-chip-icon">${calIconSvg(cat.icon, cat.color)}</span>
      <span class="cal-chip-body">
        <span class="cal-chip-name">${name.slice(0, 36)}</span>
        <span class="cal-chip-meta">${metaParts.join(" · ") || "-"}</span>
      </span>
    </div>`;
}

/* Zone palette for the weekly-summary bar. Intentionally distinct from the
 * app-wide ZONE_COLORS: Z1 grey, Z2 blue, Z3 green, Z4 orange, Z5 red. */
const CAL_ZONE_COLORS = ["#8a8f98", "#51b8ff", "#54e0a1", "#ffb85c", "#ff647c"];

function calZoneBarHtml(zoneTotals) {
  const total = zoneTotals.reduce((s, v) => s + v, 0);
  if (!total) return "";
  const segs = zoneTotals.map((v, i) => {
    const pct = (v / total) * 100;
    if (!pct) return "";
    return `<span class="cal-zone-seg" style="width:${pct}%;background:${CAL_ZONE_COLORS[i] || "#8a8f98"}" title="Z${i + 1}: ${formatSeconds(v)}"></span>`;
  }).join("");
  return `<div class="cal-zone-bar">${segs}</div>`;
}

/** Builds the weekly calendar grid from state.activitiesFiltered. Weeks with
 *  no cached activities are skipped (only weeks that actually contain data
 *  are rendered), newest week first. */
function renderActivitiesCalendar() {
  const host = document.getElementById("activities-calendar");
  if (!host) return;
  const items = state.activitiesFiltered.filter((item) => item.date);
  if (!items.length) {
    host.innerHTML = `<p class="muted cal-empty">No activities to show.</p>`;
    return;
  }

  const weeks = new Map(); // mondayKey -> { monday, days: Map(dateStr -> items[]) }
  items.forEach((item) => {
    const monday = calMondayOf(item.date);
    const key = calFmtDate(monday);
    if (!weeks.has(key)) weeks.set(key, { monday, days: new Map() });
    const week = weeks.get(key);
    if (!week.days.has(item.date)) week.days.set(item.date, []);
    week.days.get(item.date).push(item);
  });

  const weekKeys = [...weeks.keys()].sort().reverse();
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const rows = weekKeys.map((key) => {
    const week = weeks.get(key);
    const dayCols = [];
    let totalTime = 0, totalDistance = 0, totalLoad = 0, activityCount = 0;
    const zoneTotals = [0, 0, 0, 0, 0];
    for (let i = 0; i < 7; i++) {
      const d = new Date(week.monday);
      d.setDate(d.getDate() + i);
      const dateStr = calFmtDate(d);
      const dayItems = week.days.get(dateStr) || [];
      activityCount += dayItems.length;
      dayItems.forEach((item) => {
        totalTime += Number(item.moving_time_s || 0);
        totalDistance += Number(item.distance_m || 0);
        totalLoad += Number(item.training_load || 0);
        (item.hr_zone_times || []).forEach((v, zi) => { if (zi < 5) zoneTotals[zi] += Number(v || 0); });
      });
      dayCols.push(`
        <div class="cal-day">
          <div class="cal-day-header"><span class="cal-day-num">${d.getDate()}</span></div>
          <div class="cal-day-items">${dayItems.map(calChipHtml).join("")}</div>
        </div>`);
    }
    return `
      <div class="cal-week-row">
        <div class="cal-week-meta">
          <div class="cal-week-range">${calFmtRange(week.monday)}</div>
          <div class="muted cal-week-count">${activityCount} activit${activityCount === 1 ? "y" : "ies"}</div>
        </div>
        <div class="cal-week-days">${dayCols.join("")}</div>
        <div class="cal-week-summary">
          <div class="cal-summary-item"><span class="muted">Total Time</span><span>${formatSeconds(totalTime)}</span></div>
          <div class="cal-summary-item"><span class="muted">Total Distance</span><span>${formatDistance(totalDistance)}</span></div>
          <div class="cal-summary-item"><span class="muted">Total Load</span><span>${totalLoad ? Math.round(totalLoad) : "-"}</span></div>
          ${calZoneBarHtml(zoneTotals)}
        </div>
      </div>`;
  }).join("");

  const legend = Object.values(CAL_CATEGORIES).map((cat) => `
    <span class="cal-legend-item">${calIconSvg(cat.icon, cat.color)}<span>${cat.label}</span></span>
  `).join("");

  host.innerHTML = `
    <div class="cal-header-row">
      <div class="cal-week-meta"></div>
      <div class="cal-week-days">${dayNames.map((n) => `<div class="cal-day-col-header">${n}</div>`).join("")}</div>
      <div class="cal-week-summary"><div class="muted">Week summary</div></div>
    </div>
    ${rows}
    <div class="cal-legend">${legend}</div>`;

  host.querySelectorAll(".cal-chip").forEach((el) => {
    el.addEventListener("click", () => {
      const id = el.getAttribute("data-activity-id");
      const item = items.find((x) => String(x.activity_id) === String(id));
      if (item) openActivityTab(item);
    });
  });
}

if (typeof module !== "undefined") {
  module.exports = { calCategoryFor, calMondayOf, renderActivitiesCalendar };
}
