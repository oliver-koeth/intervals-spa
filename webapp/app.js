/* ─── Constants ────────────────────────────────────────────────────────── */
const ZONE_COLORS = {
  1:"#10b981", 2:"#06b6d4", 3:"#f59e0b", 4:"#f97316", 5:"#ef4444",
  6:"#8b5cf6", 7:"#ec4899",
};
const TOOLTIP_CSS = "background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.55);color:#f1f5f9;font-size:12px;max-width:260px";

/* ─── State ─────────────────────────────────────────────────────────────── */
const state = {
  intervals: [],
  filtered: [],
  selected: new Set(),
  pendingSearchResults: [],
  pendingSearchParams: null,
  screen: "search",
  charts: {},
  compareSource: [],
  pinnedInterval: null,
  dismissedCallouts: new Set(),
};

/** In-memory HR stream cache — keyed by activity_id, not persisted. */
const hrStreamCache = {};
const INTERVALS_CACHE_KEY = "intervals_cached_intervals_v1";

/* ─── Helpers ────────────────────────────────────────────────────────────── */
function parseMmSs(input) {
  if (!input || !String(input).trim()) return null;
  const m = String(input).trim().match(/^(\d+):([0-5]\d)$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

function formatSeconds(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function isDark() { return document.body.classList.contains("theme-dark"); }

function normalizeActivityType(type) {
  return type ? type.replace(/\s+/g, "").toLowerCase() : "";
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

/* ─── Navigation ─────────────────────────────────────────────────────────── */
function setScreen(name) {
  state.screen = name;
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === `screen-${name}`);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("nav-btn-active", btn.dataset.screenTarget === name);
  });
  if (name === "compare") renderCompare();
}

/* ─── Settings ───────────────────────────────────────────────────────────── */
function getSettings() {
  return {
    athleteId:    (localStorage.getItem("intervals_athlete_id") || "").trim(),
    apiKey:       (localStorage.getItem("intervals_api_key") || "").trim(),
    apiMode:      localStorage.getItem("intervals_api_mode") || "auto",
    zoneModelId:  localStorage.getItem("intervals_zone_model_id") || "",
    zoneModels:   JSON.parse(localStorage.getItem("intervals_zone_models") || "[]"),
    strava: {
      clientId: localStorage.getItem("intervals_strava_client_id") || "",
      clientSecret: localStorage.getItem("intervals_strava_client_secret") || "",
      accessToken: localStorage.getItem("intervals_strava_access_token") || "",
      scope: localStorage.getItem("intervals_strava_scope") || "",
    },
  };
}

function getSelectedZoneModel() {
  const s = getSettings();
  if (!s.zoneModels.length) return null;
  const id = Number(s.zoneModelId);
  return s.zoneModels.find((m) => m.id === id) || null;
}

/** Build zone display info: indices, label names, colors, upper-HR bounds. */
function getZoneInfo() {
  const model = getSelectedZoneModel();
  const n = model ? model.hr_zones.length : 5;
  const indices = Array.from({ length: n }, (_, i) => i + 1);
  const names = model
    ? model.hr_zone_names.slice(0, n)
    : indices.map((z) => `Z${z}`);
  return { indices, names, hrZones: model ? model.hr_zones : null };
}


function loadSettingsToForm() {
  const s = getSettings();
  document.getElementById("settings-athlete-id").value = s.athleteId;
  document.getElementById("settings-api-key").value = s.apiKey;
  document.getElementById("settings-api-mode").value = s.apiMode;
  document.getElementById("settings-strava-client-id").value = s.strava.clientId;
  document.getElementById("settings-strava-client-secret").value = s.strava.clientSecret;
  document.getElementById("settings-strava-access-token").value = s.strava.accessToken;
  document.getElementById("settings-strava-scope").value = s.strava.scope;
  populateZoneModelSelect(s.zoneModels, s.zoneModelId);
}

function saveSettings(e) {
  e.preventDefault();
  localStorage.setItem("intervals_athlete_id", document.getElementById("settings-athlete-id").value.trim());
  localStorage.setItem("intervals_api_key",    document.getElementById("settings-api-key").value.trim());
  document.getElementById("settings-status").textContent = "Saved.";
  updateSettingsCallouts();
}

function saveApiMode() {
  localStorage.setItem("intervals_api_mode", document.getElementById("settings-api-mode").value);
  updateSettingsCallouts();
}

function saveStravaSettings() {
  localStorage.setItem(
    "intervals_strava_client_id",
    document.getElementById("settings-strava-client-id").value.trim()
  );
  localStorage.setItem(
    "intervals_strava_client_secret",
    document.getElementById("settings-strava-client-secret").value.trim()
  );
  localStorage.setItem(
    "intervals_strava_access_token",
    document.getElementById("settings-strava-access-token").value.trim()
  );
  localStorage.setItem(
    "intervals_strava_scope",
    document.getElementById("settings-strava-scope").value.trim()
  );
  document.getElementById("settings-strava-status").textContent = "Strava settings saved.";
}

function clearSettings() {
  [
    "intervals_athlete_id", "intervals_api_key", "intervals_api_mode",
    "intervals_zone_model_id", "intervals_zone_models", INTERVALS_CACHE_KEY,
    "intervals_strava_client_id", "intervals_strava_client_secret",
    "intervals_strava_access_token", "intervals_strava_scope",
  ].forEach((k) => localStorage.removeItem(k));
  state.intervals = [];
  state.filtered = [];
  state.selected.clear();
  hideSearchPreview();
  renderIntervals();
  loadSettingsToForm();
  document.getElementById("settings-status").textContent = "";
  document.getElementById("settings-strava-status").textContent = "";
  document.getElementById("zone-model-status").textContent = "";
  document.getElementById("zone-model-preview").innerHTML = "";
  // Reset any per-session dismiss flags
  state.dismissedCallouts.clear();
  updateSettingsCallouts();
}

/* ─── Settings callouts ─────────────────────────────────────────────────── */
function updateSettingsCallouts() {
  const s = getSettings();
  const needsAccount = !s.athleteId || !s.apiKey;
  const needsMode = s.apiMode !== "auto";
  const needsZone = !s.zoneModelId || !s.zoneModels.length;

  function setCallout(id, visible) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!visible || state.dismissedCallouts.has(id)) {
      el.classList.add("hidden");
    } else {
      el.classList.remove("hidden");
    }
  }

  setCallout("callout-account",    needsAccount);
  setCallout("callout-api-mode",   needsMode);
  setCallout("callout-zone-model", needsZone);
}

/* ─── Zone model UI ──────────────────────────────────────────────────────── */
function zoneModelLabel(m) {
  const names = m.hr_zone_names.join(" · ");
  const lthr = m.lthr ? ` LTHR ${m.lthr}` : "";
  const max = m.max_hr ? ` / Max ${m.max_hr}` : "";
  return `${m.hr_zones.length} zones: ${names} (${lthr}${max})`;
}

function populateZoneModelSelect(models, selectedId) {
  const sel = document.getElementById("settings-zone-model");
  // Preserve the default option then replace model options
  sel.innerHTML = '<option value="">Default (Z1–Z5)</option>';
  models.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = String(m.id);
    opt.textContent = zoneModelLabel(m);
    if (String(m.id) === String(selectedId)) opt.selected = true;
    sel.appendChild(opt);
  });
  renderZoneModelPreview(models.find((m) => String(m.id) === String(selectedId)) || null);
}

function renderZoneModelPreview(model) {
  const el = document.getElementById("zone-model-preview");
  if (!model) { el.innerHTML = ""; return; }
  const rows = model.hr_zone_names.map((name, i) => {
    const upper = model.hr_zones[i];
    const lower = i === 0 ? 0 : model.hr_zones[i - 1] + 1;
    const range = i === 0 ? `≤ ${upper} bpm` : `${lower} – ${upper} bpm`;
    const color = ZONE_COLORS[i + 1] || "#94a3b8";
    return `<tr>
      <td><span class="zone-swatch" style="background:${color}"></span>Z${i+1}</td>
      <td>${name}</td>
      <td>${range}</td>
    </tr>`;
  }).join("");
  el.innerHTML = `<table class="zone-model-table">
    <thead><tr><th>Zone</th><th>Name</th><th>HR range</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

async function fetchZoneModels(settings) {
  const mode = resolveApiMode(settings.apiMode);
  let models;
  if (mode === "proxy") {
    try {
      const qs = new URLSearchParams({ athlete_id: settings.athleteId, api_key: settings.apiKey });
      const res = await fetch(`./api/zone-models?${qs}`);
      if (!res.ok) throw new Error(`Zone models proxy error (${res.status})`);
      return await res.json();
    } catch (err) {
      if (!isAutoProxyMode(settings.apiMode)) throw err;
      // Auto mode fallback: proxy unavailable or upstream error, retry direct.
    }
  }

  const auth = `Basic ${btoa(`API_KEY:${settings.apiKey}`)}`;
  const res = await fetch(
    `https://intervals.icu/api/v1/athlete/${encodeURIComponent(settings.athleteId)}/sport-settings`,
    { headers: { Authorization: auth, Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`Sport settings request failed (${res.status})`);
  const raw = await res.json();
  const seen = new Set();
  models = [];
  for (const s of raw) {
    if (!seen.has(s.id) && Array.isArray(s.hr_zones) && s.hr_zones.length) {
      seen.add(s.id);
      models.push({
        id: s.id,
        hr_zones: s.hr_zones,
        hr_zone_names: s.hr_zone_names || s.hr_zones.map((_, i) => `Z${i + 1}`),
        lthr: s.lthr || null,
        max_hr: s.max_hr || null,
      });
    }
  }
  return models;
}

async function handleLoadZoneModels() {
  const btn = document.getElementById("load-zone-models");
  const statusEl = document.getElementById("zone-model-status");
  const settings = getSettings();
  if (!settings.athleteId || !settings.apiKey) {
    statusEl.textContent = "Save athlete ID and API key first.";
    return;
  }
  btn.disabled = true;
  statusEl.textContent = "Loading…";
  try {
    const models = await fetchZoneModels(settings);
    localStorage.setItem("intervals_zone_models", JSON.stringify(models));
    const currentId = settings.zoneModelId;
    populateZoneModelSelect(models, currentId);
    statusEl.textContent = `${models.length} zone model(s) loaded.`;
    updateSettingsCallouts();
  } catch (err) {
    statusEl.textContent = `Error: ${err.message}`;
  } finally {
    btn.disabled = false;
  }
}

/* ─── Search status ──────────────────────────────────────────────────────── */
function setStatus(text, isError = false) {
  const node = document.getElementById("search-status");
  node.textContent = text;
  node.style.color = isError ? "#f87171" : "";
}

function resolveApiMode(savedMode) {
  if (savedMode !== "auto") return savedMode;
  return ["localhost","127.0.0.1"].includes(window.location.hostname) ? "proxy" : "direct";
}

function isAutoProxyMode(savedMode) {
  return savedMode === "auto" && ["localhost","127.0.0.1"].includes(window.location.hostname);
}

function saveIntervalsCache(intervals) {
  localStorage.setItem(INTERVALS_CACHE_KEY, JSON.stringify(intervals));
}

function loadIntervalsCache() {
  try {
    const raw = localStorage.getItem(INTERVALS_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearIntervalsCache() {
  localStorage.removeItem(INTERVALS_CACHE_KEY);
}

function hideSearchPreview() {
  const box = document.getElementById("search-preview");
  box.classList.add("hidden");
  document.getElementById("search-preview-body").innerHTML = "";
  document.getElementById("search-preview-summary").textContent = "";
  document.getElementById("search-preview-add").disabled = false;
  state.pendingSearchResults = [];
  state.pendingSearchParams = null;
}

function renderSearchPreview(results) {
  const body = document.getElementById("search-preview-body");
  body.innerHTML = "";
  results.forEach((item) => {
    const tr = document.createElement("tr");
    const z = item.zone;
    tr.innerHTML = `
      <td>${item.date || ""}</td>
      <td>${item.activity_type || ""}</td>
      <td title="${item.activity_name || ""}">${(item.activity_name || "").slice(0, 34)}</td>
      <td>${item.label || ""}</td>
      <td class="right">${formatSeconds(item.start_index || 0)}</td>
      <td class="right">${formatSeconds(item.moving_time_s)}</td>
      <td class="right" style="color:${ZONE_COLORS[z] || "inherit"}">${z ? `Z${z}` : "-"}</td>
    `;
    body.appendChild(tr);
  });
  document.getElementById("search-preview-summary").textContent = `${results.length} interval(s) found`;
  document.getElementById("search-preview-add").disabled = results.length === 0;
  document.getElementById("search-preview").classList.remove("hidden");
}

function commitIntervals(results, params) {
  state.intervals = results.sort(compareIntervalsChronologically);
  state.filtered  = [...state.intervals];
  state.selected.clear();
  renderIntervals();
  saveIntervalsCache(state.intervals);
  setStatus(`Added ${results.length} interval(s).`);
  if (params) {
    document.getElementById("filter-label").value = params.label;
    document.getElementById("filter-type").value  = params.activityType;
    if (params.targetSeconds !== null) {
      document.getElementById("filter-time-from").value = formatSeconds(Math.max(0, params.targetSeconds - params.marginSeconds));
      document.getElementById("filter-time-to").value   = formatSeconds(params.targetSeconds + params.marginSeconds);
    } else {
      document.getElementById("filter-time-from").value = "";
      document.getElementById("filter-time-to").value   = "";
    }
    document.getElementById("filter-date-from").value = params.startDate;
    document.getElementById("filter-date-to").value   = params.endDate;
  }
  hideSearchPreview();
  setScreen("intervals");
}

/* ─── Map API response → internal interval object ─────────────────────────── */
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

/* ─── Render intervals table ─────────────────────────────────────────────── */
function renderIntervals() {
  const body = document.getElementById("intervals-body");
  body.innerHTML = "";
  state.filtered.forEach((item) => {
    const id = String(item.interval_id);
    const z  = item.zone;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="center"><input type="checkbox" data-select-id="${id}" ${state.selected.has(id) ? "checked" : ""} /></td>
      <td>${item.date || ""}</td>
      <td>${item.activity_type || ""}</td>
      <td title="${item.activity_name || ""}">${(item.activity_name || "").slice(0, 34)}</td>
      <td>${item.label || ""}</td>
      <td class="right">${formatSeconds(item.moving_time_s)}</td>
      <td class="right">${Math.round(item.avg_watts || 0)}</td>
      <td class="right">${(item.avg_watts_kg || 0).toFixed(2)}</td>
      <td class="right">${Math.round(item.avg_hr || 0)}</td>
      <td class="right">${Math.round(item.max_hr || 0)}</td>
      <td class="right">${(item.training_load || 0).toFixed(1)}</td>
      <td class="right" style="color:${ZONE_COLORS[z] || "inherit"}">${z ? `Z${z}` : "-"}</td>
      <td class="right">${(item.decoupling || 0).toFixed(1)}%</td>
    `;
    body.appendChild(tr);
  });
  document.getElementById("result-summary").textContent = `${state.filtered.length} intervals`;
  document.getElementById("selected-count").textContent = `${state.selected.size} selected`;
  body.querySelectorAll("input[data-select-id]").forEach((cb) => {
    cb.addEventListener("change", (e) => {
      const id = e.target.getAttribute("data-select-id");
      if (e.target.checked) state.selected.add(id); else state.selected.delete(id);
      document.getElementById("selected-count").textContent = `${state.selected.size} selected`;
    });
  });
}

/* ─── Local filter ───────────────────────────────────────────────────────── */
function applyLocalFilters() {
  const labelNeedle = document.getElementById("filter-label").value.trim().toLowerCase();
  const typeNeedle  = normalizeActivityType(document.getElementById("filter-type").value);
  const tFrom = parseMmSs(document.getElementById("filter-time-from").value);
  const tTo   = parseMmSs(document.getElementById("filter-time-to").value);
  const dFrom = document.getElementById("filter-date-from").value;
  const dTo   = document.getElementById("filter-date-to").value;

  state.filtered = state.intervals.filter((item) => {
    if (labelNeedle && !String(item.label).toLowerCase().includes(labelNeedle)) return false;
    if (typeNeedle && normalizeActivityType(item.activity_type) !== typeNeedle) return false;
    if (tFrom !== null && Number(item.moving_time_s) < tFrom) return false;
    if (tTo   !== null && Number(item.moving_time_s) > tTo)   return false;
    if (dFrom && item.date < dFrom) return false;
    if (dTo   && item.date > dTo)   return false;
    return true;
  });
  state.selected.forEach((id) => {
    if (!state.filtered.find((x) => String(x.interval_id) === id)) state.selected.delete(id);
  });
  renderIntervals();
}

/* ─── Charts ─────────────────────────────────────────────────────────────── */
function mkChart(name) {
  if (state.charts[name]) state.charts[name].dispose();
  state.charts[name] = echarts.init(document.getElementById(`chart-${name}`), isDark() ? "dark" : null);
  return state.charts[name];
}

function resizeAll() { Object.values(state.charts).forEach((c) => c && c.resize()); }

function mockHrStream(item) {
  const avg = Number(item.avg_hr || 150);
  const max = Number(item.max_hr || avg + 10);
  const secs = Math.max(300, Number(item.moving_time_s || 1500));
  const pts = [];
  for (let t = 0; t <= secs; t += 20) {
    const wave  = Math.sin(t / 150) * 4 + Math.cos(t / 80) * 2;
    const trend = (t / secs) * (max - avg) * 0.7;
    pts.push([+(t / 60).toFixed(2), Math.round(avg - 4 + wave + trend)]);
  }
  return pts;
}

/* ─── HR stream fetch (with cache) ──────────────────────────────────────── */
async function fetchHrStream(activityId, settings) {
  if (hrStreamCache[activityId]) return hrStreamCache[activityId];

  const mode = resolveApiMode(settings.apiMode);
  let result;

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
    const res = await fetch(
      `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams?types=heartrate,time`,
      { headers: { Authorization: auth, Accept: "application/json" } }
    );
    if (!res.ok) throw new Error(`Streams request failed (${res.status})`);
    const raw = await res.json();
    result = {
      time:      (raw.find((s) => s.type === "time")?.data)      || [],
      heartrate: (raw.find((s) => s.type === "heartrate")?.data) || [],
    };
  }

  hrStreamCache[activityId] = result;
  return result;
}

/** Extract the HR data points for a single interval from the full activity stream. */
function sliceHrStream(stream, startIndex, movingTimeS) {
  const endIndex = startIndex + movingTimeS;
  const points = [];
  for (let i = 0; i < stream.time.length; i++) {
    const t = stream.time[i];
    if (t >= startIndex && t < endIndex) {
      points.push([(t - startIndex) / 60, stream.heartrate[i]]);
    }
  }
  return points;
}

function renderHrStreamChart(points, item) {
  const avg  = Math.round(item.avg_hr || 0);
  const max  = Math.round(item.max_hr || 0);
  const model = getSelectedZoneModel();
  // Build visualMap pieces for HR zone colour bands
  const pieces = model ? model.hr_zones.map((upper, i) => {
    const lower = i === 0 ? 0 : model.hr_zones[i - 1];
    return { gte: lower, lt: upper, color: ZONE_COLORS[i + 1] || "#94a3b8", label: model.hr_zone_names[i] || `Z${i+1}` };
  }).concat([{
    gte: model.hr_zones[model.hr_zones.length - 1],
    color: ZONE_COLORS[model.hr_zones.length] || "#ef4444",
    label: model.hr_zone_names[model.hr_zones.length - 1] || `Z${model.hr_zones.length}`,
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
      formatter: (p) => `${Number(p[0].value[0]).toFixed(1)} min · HR ${p[0].value[1]} bpm`,
    },
    ...(pieces ? { visualMap: { show: false, type: "piecewise", dimension: 1, seriesIndex: 0, pieces } } : {}),
    grid: { left: 42, right: 20, top: 52, bottom: 28 },
    xAxis: { type: "value", name: "min", nameLocation: "end" },
    yAxis: { type: "value", name: "bpm", min: yMin },
    series: [{
      type: "line", smooth: true, showSymbol: false,
      lineStyle: { width: 2 },
      areaStyle: { opacity: 0.18 },
      data: points,
    }],
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
    xAxis: { type: "category", data: model.hr_zone_names.slice(0, model.hr_zones.length) },
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
    xAxis: { type: "category", data: [1,2,3,4,5].map((v) => `Z${v}`) },
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
    const stream = await fetchHrStream(item.activity_id, settings);
    const points = sliceHrStream(stream, item.start_index, item.moving_time_s);

    // Zone chart — histogram from HR stream if model available, fallback otherwise
    const model = getSelectedZoneModel();
    if (model && points.length > 0) {
      renderZoneHistogram(points, item, model);
    } else {
      renderZoneFallback(item);
    }

    // HR stream chart
    if (points.length > 0) {
      renderHrStreamChart(points, item);
    } else {
      loadPlaceholder("hr-stream", `HR stream: ${item.date}`, "No HR data in stream");
    }
  } catch (err) {
    console.warn("HR stream fetch failed:", err);
    renderZoneFallback(item);
    loadPlaceholder("hr-stream", `HR stream: ${item.date}`, `Error: ${err.message}`);
  }
}

function attachRow1Click(chartName, indexFn) {
  const c = state.charts[chartName];
  if (!c) return;
  c.on("click", (params) => {
    const item = state.compareSource[indexFn(params)] ?? null;
    state.pinnedInterval = item;
    renderRow2(item);
  });
}

function renderCompare() {
  const sel = state.filtered.filter((x) => state.selected.has(String(x.interval_id)));
  const src = sel.length ? sel : state.filtered;
  state.compareSource = [...src].sort(compareIntervalsChronologically);
  state.pinnedInterval = null;
  document.getElementById("compare-summary").textContent =
    `${state.compareSource.length} interval(s) shown${sel.length ? " (selected)" : " (all filtered)"}`;

  const sorted = state.compareSource;
  const dates  = sorted.map((x) => x.date);

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
    yAxis:  [{ type: "value", name: "W" }, { type: "value", name: "Load" }],
    series: [
      { type: "line", name: "Avg W",      smooth: true, data: sorted.map((x) => x.avg_watts) },
      { type: "line", name: "Weighted W", smooth: true, data: sorted.map((x) => x.weighted_watts) },
      { type: "line", name: "Load", yAxisIndex: 1, smooth: true, data: sorted.map((x) => +((x.training_load||0).toFixed(2))) },
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

/* ─── Theme ──────────────────────────────────────────────────────────────── */
function toggleTheme() {
  const dark = document.body.classList.toggle("theme-dark");
  document.getElementById("theme-toggle").textContent = dark ? "Light mode" : "Dark mode";
  localStorage.setItem("webapp-theme", dark ? "dark" : "light");
  if (state.screen === "compare") renderCompare();
}

/* ─── Search ─────────────────────────────────────────────────────────────── */
function defaultDateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 6);
  return { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10) };
}

async function handleSearchSubmit(e) {
  e.preventDefault();
  const settings = getSettings();
  if (!settings.athleteId || !settings.apiKey) {
    setStatus("Set athlete ID and API key in Settings first.", true);
    setScreen("settings");
    return;
  }
  const targetSeconds = parseMmSs(document.getElementById("search-time").value);
  const marginSeconds = parseMmSs(document.getElementById("search-margin").value) ?? 10;
  const defaultRange = defaultDateRange();
  const resolvedStartDate = document.getElementById("search-from").value || defaultRange.from;
  const resolvedEndDate = document.getElementById("search-to").value || defaultRange.to;
  // Keep the form state consistent for subsequent searches.
  document.getElementById("search-from").value = resolvedStartDate;
  document.getElementById("search-to").value = resolvedEndDate;
  const params = {
    label:           document.getElementById("search-label").value.trim(),
    activityType:    document.getElementById("search-type").value,
    startDate:       resolvedStartDate,
    endDate:         resolvedEndDate,
    targetSeconds,
    marginSeconds,
    excludeRecovery: document.getElementById("search-exclude-recovery").checked,
  };
  const submit = document.getElementById("search-submit");
  submit.disabled = true;
  setStatus("Searching…");
  try {
    const mode = resolveApiMode(settings.apiMode);
    let results;
    if (mode === "proxy") {
      try {
        results = await runProxySearch(params, settings.athleteId, settings.apiKey);
      } catch (err) {
        if (!isAutoProxyMode(settings.apiMode)) throw err;
        setStatus("Local proxy unavailable, retrying direct…");
        results = await runDirectSearch(params, settings.athleteId, settings.apiKey);
      }
    } else {
      results = await runDirectSearch(params, settings.athleteId, settings.apiKey);
    }
    const sorted = results.sort(compareIntervalsChronologically);
    state.pendingSearchResults = sorted;
    state.pendingSearchParams = params;
    renderSearchPreview(sorted);
    setStatus(`Search complete. ${sorted.length} interval(s) ready to add.`);
  } catch (err) {
    setStatus(`Search failed: ${err.message}`, true);
  } finally {
    submit.disabled = false;
  }
}

/* ─── Init ───────────────────────────────────────────────────────────────── */
function init() {
  const storedTheme = localStorage.getItem("webapp-theme") || localStorage.getItem("mockup-theme");
  if (storedTheme === "light") {
    document.body.classList.remove("theme-dark");
    document.getElementById("theme-toggle").textContent = "Dark mode";
  }

  const range = defaultDateRange();
  document.getElementById("search-from").value = range.from;
  document.getElementById("search-to").value   = range.to;

  const cached = loadIntervalsCache().sort(compareIntervalsChronologically);
  state.intervals = cached;
  state.filtered = [...cached];
  renderIntervals();

  loadSettingsToForm();
  updateSettingsCallouts();
  setScreen("search");

  document.getElementById("search-form").addEventListener("submit", handleSearchSubmit);
  document.getElementById("search-form").addEventListener("reset", () => {
    const resetRange = defaultDateRange();
    document.getElementById("search-from").value = resetRange.from;
    document.getElementById("search-to").value = resetRange.to;
    hideSearchPreview();
    setStatus("");
  });
  document.getElementById("search-preview-cancel").addEventListener("click", () => {
    hideSearchPreview();
    setStatus("Search preview canceled.");
  });
  document.getElementById("search-preview-add").addEventListener("click", () => {
    if (!state.pendingSearchResults.length) return;
    commitIntervals(state.pendingSearchResults, state.pendingSearchParams);
  });
  document.getElementById("settings-form").addEventListener("submit", saveSettings);
  document.getElementById("settings-save-mode").addEventListener("click", saveApiMode);
  document.getElementById("settings-save-strava").addEventListener("click", saveStravaSettings);
  document.getElementById("settings-reset").addEventListener("click", clearSettings);
  document.getElementById("settings-clear-interval-cache").addEventListener("click", () => {
    clearIntervalsCache();
    state.intervals = [];
    state.filtered = [];
    state.selected.clear();
    hideSearchPreview();
    renderIntervals();
    document.getElementById("settings-status").textContent = "Intervals cache deleted.";
  });
  document.getElementById("load-zone-models").addEventListener("click", handleLoadZoneModels);
  // Callout dismiss buttons
  document.querySelectorAll(".callout-dismiss").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.dismiss;
      state.dismissedCallouts.add(id);
      document.getElementById(id)?.classList.add("hidden");
    });
  });
  document.getElementById("settings-zone-model").addEventListener("change", (e) => {
    localStorage.setItem("intervals_zone_model_id", e.target.value);
    const s = getSettings();
    renderZoneModelPreview(s.zoneModels.find((m) => String(m.id) === e.target.value) || null);
    updateSettingsCallouts();
  });
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  document.getElementById("back-to-list").addEventListener("click", () => setScreen("intervals"));
  document.getElementById("go-compare").addEventListener("click", () => setScreen("compare"));
  document.getElementById("select-all").addEventListener("click", () => {
    state.filtered.forEach((x) => state.selected.add(String(x.interval_id)));
    renderIntervals();
  });
  document.getElementById("select-none").addEventListener("click", () => {
    state.selected.clear();
    renderIntervals();
  });

  document.querySelectorAll("[data-screen-target]").forEach((btn) => {
    btn.addEventListener("click", () => setScreen(btn.dataset.screenTarget));
  });

  document.getElementById("apply-filters").addEventListener("click", applyLocalFilters);
  document.getElementById("clear-filters").addEventListener("click", () => {
    ["filter-label","filter-time-from","filter-time-to","filter-date-from","filter-date-to"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    document.getElementById("filter-type").value = "";
    state.filtered = [...state.intervals];
    renderIntervals();
  });

  window.addEventListener("resize", resizeAll);
}

init();
