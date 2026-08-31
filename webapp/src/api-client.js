/* ─── Map API response → internal interval object ─────────────────────────── */
function mapActivity(activity) {
  return {
    activity_id: activity.id,
    activity_start_local: activity.start_date_local || "",
    date: String(activity.start_date_local || "").slice(0, 10),
    activity_name: activity.name || "",
    activity_type: activity.type || "",
    is_race: activity.race === true,
    has_workout: activity.paired_event_id != null,
    // Single "Tag" shown in the activities table: Race takes priority over Workout.
    tag_rank: activity.race === true ? 2 : (activity.paired_event_id != null ? 1 : 0),
    source: "intervals",
    moving_time_s: Number(activity.moving_time || 0),
    distance_m: Number(activity.distance || 0),
    avg_hr: Number(activity.average_heartrate || 0),
    max_hr: Number(activity.max_heartrate || 0),
    elevation_gain_m: Number(activity.total_elevation_gain || 0),
    training_load: activity.icu_training_load != null ? Number(activity.icu_training_load) : null,
    intensity: activity.icu_intensity != null ? Number(activity.icu_intensity) : null,
    avg_watts: Number(activity.icu_average_watts || 0),
    weighted_watts: Number(activity.icu_weighted_avg_watts || 0),
    avg_speed_ms: Number(activity.average_speed || 0),
    hr_zone_times: Array.isArray(activity.icu_hr_zone_times) ? activity.icu_hr_zone_times.map(Number) : [],
  };
}

function mapInterval(activity, interval) {
  return {
    interval_id:    interval.id,
    activity_id:    activity.id,
    activity_start_local: activity.start_date_local || "",
    date:           String(activity.start_date_local || "").slice(0, 10),
    activity_name:  activity.name || "",
    activity_type:  activity.type || "",
    label:          interval.label || "",
    interval_type:  interval.type || "",
    source:         "intervals",
    moving_time_s:  interval.moving_time || 0,
    start_index:    interval.start_index || 0,
    avg_watts:      interval.average_watts || 0,
    weighted_watts: interval.normalized_power || interval.weighted_average_watts || 0,
    avg_watts_kg:   interval.watts_kg || 0,
    avg_hr:         interval.average_heartrate || 0,
    max_hr:         interval.max_heartrate || 0,
    training_load:  interval.training_load || 0,
    decoupling:     interval.decoupling || 0,
    zone:           interval.zone || null,
  };
}

/* ─── API: direct (browser → intervals.icu) ──────────────────────────────── */
async function runDirectSearch(params, athleteId, apiKey) {
  const auth = `Basic ${btoa(`API_KEY:${apiKey}`)}`;
  const hdrs = { Authorization: auth, Accept: "application/json" };
  const fields = encodeURIComponent("id,name,start_date_local,type");
  const url = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities` +
    `?oldest=${encodeURIComponent(params.startDate)}&newest=${encodeURIComponent(params.endDate)}&fields=${fields}`;

  const res = await fetch(url, { headers: hdrs });
  if (!res.ok) throw new Error(`Activities request failed (${res.status})`);
  const activities = await res.json();

  const typeNeedle = normalizeActivityType(params.activityType);
  const results = [];

  for (let i = 0; i < activities.length; i++) {
    const activity = activities[i];
    if (typeNeedle && normalizeActivityType(activity.type) !== typeNeedle) continue;

    setStatus(`Loading activity ${i + 1}/${activities.length}…`);
    const iRes = await fetch(
      `https://intervals.icu/api/v1/activity/${encodeURIComponent(activity.id)}/intervals`,
      { headers: hdrs }
    );
    if (!iRes.ok) { await delay(150); continue; }
    const iData = await iRes.json();
    const intervals = Array.isArray(iData.icu_intervals) ? iData.icu_intervals : [];

    intervals.forEach((interval) => {
      if (params.excludeRecovery && interval.type === "RECOVERY") return;
      if (params.label && !String(interval.label || "").toLowerCase().includes(params.label.toLowerCase())) return;
      if (params.targetSeconds !== null) {
        const t = Number(interval.moving_time || 0);
        if (t < params.targetSeconds - params.marginSeconds || t > params.targetSeconds + params.marginSeconds) return;
      }
      results.push(mapInterval(activity, interval));
    });
    await delay(150);
  }
  return results;
}

async function runDirectActivitySearch(params, athleteId, apiKey) {
  const auth = `Basic ${btoa(`API_KEY:${apiKey}`)}`;
  const hdrs = { Authorization: auth, Accept: "application/json" };
  const fields = encodeURIComponent(ACTIVITY_SEARCH_FIELDS);
  const url = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities` +
    `?oldest=${encodeURIComponent(params.startDate)}&newest=${encodeURIComponent(params.endDate)}` +
    `&fields=${fields}`;
  const res = await fetch(url, { headers: hdrs });
  if (!res.ok) throw new Error(`Activities request failed (${res.status})`);
  const activities = await res.json();
  const labelNeedle = params.label.toLowerCase();
  const typeNeedle = normalizeActivityType(params.activityType);
  return (Array.isArray(activities) ? activities : [])
    .filter((activity) => {
      if (typeNeedle && normalizeActivityType(activity.type) !== typeNeedle) return false;
      if (labelNeedle && !String(activity.name || "").toLowerCase().includes(labelNeedle)) return false;
      const date = String(activity.start_date_local || "").slice(0, 10);
      if (params.startDate && date < params.startDate) return false;
      if (params.endDate && date > params.endDate) return false;
      return true;
    })
    .map(mapActivity)
    .sort(compareActivitiesChronologically);
}

/* ─── API: proxy (browser → local server) ───────────────────────────────── */
async function runProxySearch(params, athleteId, apiKey) {
  const res = await fetch("./api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      athlete_id:   athleteId,
      api_key:      apiKey,
      label:        params.label,
      activity_type: params.activityType,
      start_date:   params.startDate,
      end_date:     params.endDate,
      time_target_s: params.targetSeconds,
      time_margin_s: params.marginSeconds,
    exclude_recovery: params.excludeRecovery,
    }),
  });
  if (!res.ok) throw new Error(`Proxy search failed (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

async function runProxyActivitySearch(params, athleteId, apiKey) {
  const res = await fetch("./api/activity-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      athlete_id: athleteId,
      api_key: apiKey,
      label: params.label,
      activity_type: params.activityType,
      start_date: params.startDate,
      end_date: params.endDate,
    }),
  });
  if (!res.ok) throw new Error(`Proxy activity search failed (${res.status})`);
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

function renderActivities() {
  const body = document.getElementById("activities-body");
  body.innerHTML = "";
  const items = sortForDisplay(state.activitiesFiltered, state.activitiesSort);
  items.forEach((item) => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.title = "Open activity";
    tr.innerHTML = `
      <td>${item.date || ""}</td>
      <td>${item.activity_type || ""}</td>
      <td>${item.is_race
        ? '<span class="activity-race-flag" title="Race">Race</span>'
        : item.has_workout
          ? '<span class="activity-workout-flag" title="Structured workout">Workout</span>'
          : ""}</td>
      <td title="${item.activity_name || ""}">${(item.activity_name || "").slice(0, 48)}</td>
      <td class="right">${formatSeconds(item.moving_time_s)}</td>
      <td class="right">${formatDistance(item.distance_m)}</td>
      <td class="right">${formatElevation(item.elevation_gain_m)}</td>
      <td class="right">${item.training_load != null ? Math.round(item.training_load) : "-"}</td>
    `;
    tr.addEventListener("click", () => openActivityTab(item));
    body.appendChild(tr);
  });
  document.getElementById("activities-summary").textContent = `${state.activitiesFiltered.length} activities`;
  if (typeof updateActivitiesSidebars === "function") updateActivitiesSidebars();
  if (typeof updateAppSidebarStats === "function") updateAppSidebarStats();
}

/** An "empty"/placeholder row with no real activity data (e.g. intervals.icu returning a
 *  bare rest-day marker for a date). These have no type/name and no measurable metrics —
 *  strip them out so they don't clutter the Activities table as blank "zombie" rows. */
function isZombieActivity(item) {
  return !item.activity_type && !item.activity_name &&
    !item.moving_time_s && !item.distance_m && !item.training_load;
}

/** Re-fetches summary fields for every already-loaded (cached) intervals.icu activity and
 *  overwrites the local cache/table in place. Needed because some fields (e.g. the Tag/
 *  has_workout flag, or elevation_gain_m after a manual "Add elevation" upload) can change
 *  on intervals.icu's side, or were added to this app after an activity was first cached —
 *  the cached copy in localStorage never updates itself otherwise. */
async function refreshCachedActivities() {
  const btn = document.getElementById("refresh-activities");
  const intervalsItems = state.activities.filter((item) => (item.source || "intervals") === "intervals");
  if (!intervalsItems.length) {
    document.getElementById("activities-summary").textContent = `${state.activitiesFiltered.length} activities (nothing to refresh)`;
    return;
  }
  const settings = getSettings();
  if (!settings.athleteId || !settings.apiKey) {
    document.getElementById("activities-summary").textContent = "Set athlete ID and API key in Settings first.";
    return;
  }
  const dates = intervalsItems.map((item) => item.date).filter(Boolean).sort();
  const params = { label: "", activityType: "", startDate: dates[0], endDate: dates[dates.length - 1] };
  if (btn) { btn.disabled = true; btn.textContent = "Refreshing…"; }
  try {
    const mode = resolveApiMode(settings.apiMode);
    let results;
    if (mode === "proxy") {
      try {
        results = await runProxyActivitySearch(params, settings.athleteId, settings.apiKey);
      } catch (err) {
        if (!isAutoProxyMode(settings.apiMode)) throw err;
        results = await runDirectActivitySearch(params, settings.athleteId, settings.apiKey);
      }
    } else {
      results = await runDirectActivitySearch(params, settings.athleteId, settings.apiKey);
    }
    const merged = mergeActivities(state.activities, results);
    const beforeCount = merged.items.length;
    const cleaned = merged.items.filter((item) => !isZombieActivity(item));
    const removedZombies = beforeCount - cleaned.length;
    state.activities = cleaned.sort(compareActivitiesChronologically);
    await saveActivitiesCache(state.activities);
    applyActivitiesFilters();
    document.getElementById("activities-summary").textContent =
      `${state.activitiesFiltered.length} activities (refreshed ${merged.updated}${removedZombies ? `, removed ${removedZombies} empty` : ""})`;
  } catch (err) {
    document.getElementById("activities-summary").textContent = `Refresh failed: ${err.message}`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "Refresh"; }
  }
}

function applyActivitiesFilters() {
  const labelNeedle = document.getElementById("activities-filter-label").value.trim().toLowerCase();
  const sourceNeedle = document.getElementById("activities-filter-source").value;
  const typeNeedle = normalizeActivityType(document.getElementById("activities-filter-type").value);
  const dFrom = document.getElementById("activities-filter-date-from").value;
  const dTo = document.getElementById("activities-filter-date-to").value;
  const tFrom = parseHhMmSs(document.getElementById("activities-filter-time-from").value);
  const tTo = parseHhMmSs(document.getElementById("activities-filter-time-to").value);
  const distFromKm = Number(document.getElementById("activities-filter-distance-from").value) || 0;
  const distToKm = Number(document.getElementById("activities-filter-distance-to").value) || 0;

  state.activitiesFiltered = state.activities.filter((item) => {
    if (labelNeedle && !String(item.activity_name || "").toLowerCase().includes(labelNeedle)) return false;
    if (sourceNeedle && (item.source || "intervals") !== sourceNeedle) return false;
    if (typeNeedle && normalizeActivityType(item.activity_type) !== typeNeedle) return false;
    if (dFrom && item.date < dFrom) return false;
    if (dTo && item.date > dTo) return false;
    if (tFrom != null && (item.moving_time_s == null || item.moving_time_s < tFrom)) return false;
    if (tTo != null && (item.moving_time_s == null || item.moving_time_s > tTo)) return false;
    if (distFromKm && (item.distance_m == null || item.distance_m < distFromKm * 1000)) return false;
    if (distToKm && (item.distance_m == null || item.distance_m > distToKm * 1000)) return false;
    return true;
  });
  renderActivities();
}
