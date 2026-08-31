/* ─── Constants ────────────────────────────────────────────────────────── */
const ZONE_COLORS = {
  1:"#54e0a1", 2:"#51b8ff", 3:"#ffb85c", 4:"#ff8a58", 5:"#ff647c",
  6:"#a78bfa", 7:"#f472b6",
};
/* Fixed zone palette for the planned-workout diagram — intentionally distinct from
   ZONE_COLORS (which drives HR-stream zone shading elsewhere) per product spec:
   Z1 blue, Z2 green, Z3 yellow, Z4 orange, Z5 red, regardless of the underlying metric.
   Muted/dimmed pastel spread (darkened ~30%) so it harmonizes with the app's dark theme
   instead of the previous saturated Tailwind primaries. */
const WORKOUT_ZONE_COLORS = {
  1: "#4b678d", 2: "#4e7a59", 3: "#927840", 4: "#966140", 5: "#8d4b54",
};
const TOOLTIP_CSS = "background:#101820;border:1px solid rgba(148,163,184,0.34);border-radius:10px;padding:10px 14px;box-shadow:0 16px 48px rgba(0,0,0,0.48);color:#eef4f8;font-size:12px;max-width:260px";

/* Activity Lab chart toggles switch each value between its colour and grey. */
const SERIES_TOGGLE_CYCLE = { on: "dimmed", dimmed: "on", off: "on" };
const SERIES_DIMMED_COLOR = "#94a3b8";
const SERIES_COLORS = {
  hr: "#ef4444",
  pace: "#51b8ff",
  gap: "#a78bfa",
  power: "#f59e0b",
  cadence: "#f472b6",
  elevation: "#64748b",
  glucose: "#54e0a1",
};

/* Activity-similarity search: exactly one of three independent similarity types is
   used at a time (never blended) — duration, work-interval shape (avg + variance of
   work-interval length), and training load. Activity type is a hard gate (a Run is
   never "similar" to a VirtualRun). */
const SIMILARITY_TYPES = ["duration", "intervals", "load"];
const SIMILARITY_TYPE_LABELS = {
  duration: "Duration",
  intervals: "Work intervals",
  load: "Load",
};
const SIMILARITY_DEFAULT_TYPE = "duration";
/* Safety cap on how many candidates get a live work-intervals fetch for the
   "intervals" similarity type (one API call per not-yet-cached activity). */
const SIMILARITY_INTERVALS_FETCH_CAP = 150;

/* ─── State ─────────────────────────────────────────────────────────────── */
const state = {
  activities: [],
  activitiesFiltered: [],
  activitiesSort: { field: "date", dir: "desc" },
  glucose: [],
  glucoseFiltered: [],
  glucosePage: 1,
  openGlucoseTabs: [],     // [{id, label, from, to, points}]
  activeGlucoseTabId: null,
  openActivityTabs: [],    // [{id, activity}]
  activeActivityTabId: null,
  intervals: [],
  filtered: [],
  intervalsSort: { field: "date", dir: "desc" },
  selected: new Set(),
  intervalsGrouped: false,
  collapsedIntervalGroups: new Set(),
  pendingActivityResults: [],
  pendingIntervalsResults: [],
  pendingIntervalsParams: null,
  pendingStravaResults: [],
  screen: "search",
  charts: {},
  activityLabCharts: {},
  raceAnalysisCharts: {},
  compareSource: [],
  openCompareTabs: [],     // [{id, intervals}]
  activeCompareTabId: null,
  compareTabCounter: 0,
  pinnedInterval: null,
  dismissedCallouts: new Set(),
  similarity: {
    queryActivityId: null,
    type: SIMILARITY_DEFAULT_TYPE,
    minScorePct: 40,
    results: [],
  },
  activityLab: {
    requestToken: 0,
    tabActivityId: null,
    focusActivityId: null,
    streamActivities: [],
    streamScores: {},
    streamListMode: SIMILARITY_DEFAULT_TYPE,
    streamMinScorePct: 80,
    workIntervalsByActivity: {},
    workIntervals: [],
    plannedWorkoutByActivity: {},
    lastTileSnapshot: null,
    visibleSeries: {
      hr: "on",
      pace: "on",
      gap: "on",
      power: "on",
      cadence: "on",
      elevation: "dimmed",
      glucose: "on",
    },
  },
  raceAnalysis: {
    source: null,
    result: null,
    reportHtml: "",
    selectedActivityId: "",
    terrainQuarterFilter: "",
    terrainTypeFilter: "",
    extremeQuarterFilter: "",
    extremeTypeFilter: "",
  },
};

/** In-memory activity stream cache — keyed by "source:activity_id". */
const hrStreamCache = {};
/** In-memory Strava activity start-time cache — keyed by activity_id. */
const stravaActivityStartCache = {};
/** In-memory Strava effort start-time cache — keyed by effort_id. */
const stravaEffortStartCache = {};

const ACTIVITIES_CACHE_KEY  = "intervals_cached_activities_v1";
const INTERVALS_CACHE_KEY   = "intervals_cached_intervals_v1";
const GLUCOSE_CACHE_KEY     = "intervals_cached_glucose_v1";
const GLUCOSE_PAGE_SIZE     = 100;
const HR_STREAM_LS_PREFIX   = "intervals_hr_stream_v7:";   // localStorage key prefix for activity streams

/**
 * Activity summary fields requested from intervals.icu's /activities endpoint.
 * Keep in sync with the `fields` query built server-side in webapp/server.py
 * (run_activity_search) and with mapActivity()'s field mapping below.
 */
const ACTIVITY_SEARCH_FIELDS = [
  "id", "name", "start_date_local", "type",
  "moving_time", "distance", "average_heartrate", "max_heartrate",
  "total_elevation_gain", "icu_training_load", "icu_intensity",
  "icu_average_watts", "icu_weighted_avg_watts", "average_speed",
  "icu_hr_zone_times", "race", "paired_event_id",
].join(",");

/** Persist a stream object to IndexedDB (silently skips on quota/unsupported errors). */
async function saveHrStreamToStorage(cacheKey, stream) {
  await idbSetValue(IDB_STREAM_STORE, cacheKey, stream);
}

/** Load a stream object from IndexedDB; returns null if not found. */
async function loadHrStreamFromStorage(cacheKey) {
  return await idbGetValue(IDB_STREAM_STORE, cacheKey, null);
}

/** Remove all HR stream entries from both in-memory and IndexedDB caches (also
 *  sweeps any pre-migration localStorage leftovers, just in case). */
async function clearHrStreamCache() {
  for (const k of Object.keys(hrStreamCache)) delete hrStreamCache[k];
  const idbKeys = await idbGetAllKeys(IDB_STREAM_STORE);
  for (const k of idbKeys) await idbDeleteValue(IDB_STREAM_STORE, k);
  const toRemove = [];
  const prefixes = [HR_STREAM_LS_PREFIX, "intervals_hr_stream:", "intervals_hr_stream_v2:", "intervals_hr_stream_v3:", "intervals_hr_stream_v4:"];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && prefixes.some((prefix) => k.startsWith(prefix))) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}
