/* ─── Constants ────────────────────────────────────────────────────────── */
const ZONE_COLORS = {
  1:"#10b981", 2:"#06b6d4", 3:"#f59e0b", 4:"#f97316", 5:"#ef4444",
  6:"#8b5cf6", 7:"#ec4899",
};
const TOOLTIP_CSS = "background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px 14px;box-shadow:0 4px 16px rgba(0,0,0,0.55);color:#f1f5f9;font-size:12px;max-width:260px";

/* ─── State ─────────────────────────────────────────────────────────────── */
const state = {
  activities: [],
  intervals: [],
  filtered: [],
  selected: new Set(),
  pendingActivityResults: [],
  pendingIntervalsResults: [],
  pendingIntervalsParams: null,
  pendingStravaResults: [],
  screen: "search",
  charts: {},
  compareSource: [],
  pinnedInterval: null,
  dismissedCallouts: new Set(),
};

/** In-memory HR stream cache — keyed by "source:activity_id". */
const hrStreamCache = {};
/** In-memory Strava activity start-time cache — keyed by activity_id. */
const stravaActivityStartCache = {};
/** In-memory Strava effort start-time cache — keyed by effort_id. */
const stravaEffortStartCache = {};

const ACTIVITIES_CACHE_KEY  = "intervals_cached_activities_v1";
const INTERVALS_CACHE_KEY   = "intervals_cached_intervals_v1";
const HR_STREAM_LS_PREFIX   = "intervals_hr_stream_v3:";   // localStorage key prefix for HR streams

/** Persist a stream object to localStorage (silently skips on quota errors). */
function saveHrStreamToStorage(cacheKey, stream) {
  try {
    localStorage.setItem(HR_STREAM_LS_PREFIX + cacheKey, JSON.stringify(stream));
  } catch { /* quota or private-mode — ignore */ }
}

/** Load a stream object from localStorage; returns null if not found. */
function loadHrStreamFromStorage(cacheKey) {
  try {
    const raw = localStorage.getItem(HR_STREAM_LS_PREFIX + cacheKey);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Remove all HR stream entries from both in-memory and localStorage caches. */
function clearHrStreamCache() {
  for (const k of Object.keys(hrStreamCache)) delete hrStreamCache[k];
  const toRemove = [];
  const prefixes = [HR_STREAM_LS_PREFIX, "intervals_hr_stream:", "intervals_hr_stream_v2:"];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && prefixes.some((prefix) => k.startsWith(prefix))) toRemove.push(k);
  }
  toRemove.forEach((k) => localStorage.removeItem(k));
}

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

function formatPaceMinutes(value) {
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return "-";
  const total = Math.round(Number(value) * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function shortZoneLabels(count) {
  return Array.from({ length: count }, (_, i) => `Z${i + 1}`);
}

function computeNiceDurationAxis(values) {
  const nums = values.map((v) => Number(v)).filter((v) => Number.isFinite(v));
  if (!nums.length) return { min: 0, max: 300, interval: 60 };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = Math.max(30, max - min);
  const target = range / 4;
  const steps = [5, 10, 15, 30, 60, 120, 180, 300, 600, 900, 1200, 1800];
  const step = steps.find((v) => v >= target) || 1800;
  return {
    min: Math.max(0, Math.floor((min - step) / step) * step),
    max: Math.ceil((max + step) / step) * step,
    interval: step,
  };
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function writeHrDiagnostics(payload) {
  const pre = document.getElementById("hr-diagnostics");
  if (!pre) return;
  pre.textContent = JSON.stringify(payload, null, 2);
}

function parseStravaEffortId(intervalId) {
  const m = String(intervalId || "").match(/^strava-(\d+)$/);
  return m ? m[1] : "";
}

function extractStreamArray(raw, keys) {
  if (Array.isArray(raw)) {
    for (const key of keys) {
      const found = raw.find((s) => s?.type === key);
      if (found) return toStreamArray(found);
    }
    return [];
  }
  for (const key of keys) {
    if (raw && raw[key] !== undefined) return toStreamArray(raw[key]);
  }
  return [];
}

function initManualGallery() {
  const lightbox = document.getElementById("manual-lightbox");
  const img = document.getElementById("manual-lightbox-image");
  const caption = document.getElementById("manual-lightbox-caption");
  const closeBtn = document.getElementById("manual-lightbox-close");
  if (!lightbox || !img || !caption || !closeBtn) return;

  const close = () => {
    lightbox.classList.add("hidden");
    img.src = "";
    img.alt = "";
    caption.textContent = "";
  };

  document.querySelectorAll(".manual-thumb-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      const src = link.getAttribute("data-full-image") || link.getAttribute("href") || "";
      const text = link.getAttribute("data-caption") || "";
      if (!src) return;
      img.src = src;
      img.alt = text;
      caption.textContent = text;
      lightbox.classList.remove("hidden");
    });
  });

  closeBtn.addEventListener("click", close);
  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) close();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !lightbox.classList.contains("hidden")) close();
  });
}

function initSearchDatePickers() {
  if (typeof flatpickr === "undefined") return;
  const ids = [
    "activity-search-from", "activity-search-to",
    "search-from", "search-to",
    "strava-search-from", "strava-search-to",
    "filter-date-from", "filter-date-to",
  ];
  ids.forEach((id) => {
    const input = document.getElementById(id);
    if (!input || input.dataset.fpAttached === "1") return;
    flatpickr(input, {
      dateFormat: "Y-m-d",
      allowInput: false,
      clickOpens: true,
    });
    input.dataset.fpAttached = "1";
  });
}

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

function compareActivitiesChronologically(a, b) {
  const aStart = String(a.activity_start_local || a.date || "");
  const bStart = String(b.activity_start_local || b.date || "");
  const byStart = aStart.localeCompare(bStart);
  if (byStart !== 0) return byStart;
  return String(a.activity_id || "").localeCompare(String(b.activity_id || ""));
}

/* ─── Navigation ─────────────────────────────────────────────────────────── */
function closeTopbarMenu() {
  const topbar = document.querySelector(".topbar");
  const toggle = document.getElementById("topbar-menu-toggle");
  if (!topbar || !toggle) return;
  topbar.classList.remove("menu-open");
  toggle.setAttribute("aria-expanded", "false");
}

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
      redirectUri: localStorage.getItem("intervals_strava_redirect_uri") || "",
      scope: localStorage.getItem("intervals_strava_scope") || "",
      refreshToken: localStorage.getItem("intervals_strava_refresh_token") || "",
      expiresAtEpoch: Number(localStorage.getItem("intervals_strava_expires_at_epoch") || "0"),
      grantedScope: localStorage.getItem("intervals_strava_granted_scope") || "",
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
  document.getElementById("settings-strava-redirect-uri").value = s.strava.redirectUri;
  const exp = s.strava.expiresAtEpoch
    ? new Date(s.strava.expiresAtEpoch * 1000).toISOString()
    : "";
  document.getElementById("settings-strava-oauth-status").textContent = s.strava.accessToken
    ? `Connected (${s.strava.grantedScope || "scope unknown"})${exp ? ` · expires ${exp}` : ""}`
    : "Not connected";
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
    "intervals_strava_redirect_uri",
    document.getElementById("settings-strava-redirect-uri").value.trim()
  );
  document.getElementById("settings-strava-oauth-status").textContent = "Saved manually (no OAuth refresh token).";
  document.getElementById("settings-strava-status").textContent = "Strava settings saved.";
  updateSettingsCallouts();
}

function clearSettings() {
  [
    "intervals_athlete_id", "intervals_api_key", "intervals_api_mode",
    "intervals_zone_model_id", "intervals_zone_models", ACTIVITIES_CACHE_KEY, INTERVALS_CACHE_KEY,
    "intervals_strava_client_id", "intervals_strava_client_secret",
    "intervals_strava_access_token", "intervals_strava_redirect_uri", "intervals_strava_scope",
    "intervals_strava_refresh_token", "intervals_strava_expires_at_epoch",
    "intervals_strava_granted_scope", "intervals_strava_oauth_state", "intervals_strava_oauth_redirect_uri",
  ].forEach((k) => localStorage.removeItem(k));
  state.activities = [];
  state.intervals = [];
  state.filtered = [];
  state.selected.clear();
  hideActivitySearchPreview();
  hideSearchPreview("intervals");
  hideSearchPreview("strava");
  renderActivities();
  renderIntervals();
  loadSettingsToForm();
  document.getElementById("settings-status").textContent = "";
  document.getElementById("settings-strava-status").textContent = "";
  document.getElementById("settings-strava-oauth-status").textContent = "";
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
  const needsStrava = !s.strava.clientId || !s.strava.clientSecret || !s.strava.accessToken;
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
  setCallout("callout-strava",     needsStrava);
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
  sel.innerHTML = '<sl-option value="">Default (Z1–Z5)</sl-option>';
  models.forEach((m) => {
    const opt = document.createElement("sl-option");
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

async function stravaTokenExchangeViaProxy(body) {
  const res = await fetch("./api/strava/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = await res.json().catch(() => ({}));
    throw new Error(payload.error || `Strava token proxy error (${res.status})`);
  }
  return await res.json();
}

async function stravaTokenExchangeDirect(body) {
  const form = new URLSearchParams(body);
  const res = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) throw new Error(`Strava token request failed (${res.status})`);
  return await res.json();
}

async function exchangeStravaToken(body, settings) {
  // Prefer direct in auto mode to avoid local Python SSL trust-store issues.
  if (settings.apiMode !== "proxy") {
    try {
      return await stravaTokenExchangeDirect(body);
    } catch (err) {
      if (settings.apiMode === "direct") throw err;
    }
  }
  return await stravaTokenExchangeViaProxy(body);
}

function storeStravaTokenPayload(payload) {
  localStorage.setItem("intervals_strava_access_token", payload.access_token || "");
  localStorage.setItem("intervals_strava_refresh_token", payload.refresh_token || "");
  localStorage.setItem("intervals_strava_expires_at_epoch", String(payload.expires_at || 0));
  localStorage.setItem("intervals_strava_granted_scope", payload.scope || "");
  document.getElementById("settings-strava-access-token").value = payload.access_token || "";
  document.getElementById("settings-strava-oauth-status").textContent =
    payload.access_token
      ? `Connected (${payload.scope || "scope unknown"})`
      : "Not connected";
}

async function refreshStravaTokenIfNeeded(settings) {
  const nowEpoch = Math.floor(Date.now() / 1000);
  if (settings.strava.accessToken && settings.strava.expiresAtEpoch > nowEpoch + 120) {
    return settings.strava.accessToken;
  }
  if (!settings.strava.refreshToken) {
    return settings.strava.accessToken;
  }
  const payload = await exchangeStravaToken(
    {
      client_id: settings.strava.clientId,
      client_secret: settings.strava.clientSecret,
      grant_type: "refresh_token",
      refresh_token: settings.strava.refreshToken,
    },
    settings
  );
  storeStravaTokenPayload(payload);
  return payload.access_token || "";
}

function resolveStravaRedirectUri(settings) {
  const configured = String(settings?.strava?.redirectUri || "").trim();
  if (configured) return configured;
  const clean = new URL(window.location.href);
  clean.search = "";
  clean.hash = "";
  // Strava redirect matching is strict in some app configurations; prefer
  // no trailing slash on non-root paths.
  if (clean.pathname !== "/" && clean.pathname.endsWith("/")) {
    clean.pathname = clean.pathname.slice(0, -1);
  }
  return clean.toString();
}

function startStravaOAuth() {
  const settings = getSettings();
  if (!settings.strava.clientId || !settings.strava.clientSecret) {
    document.getElementById("settings-strava-status").textContent =
      "Enter Strava Client ID and Client Secret first.";
    return;
  }
  const stateToken = Math.random().toString(36).slice(2);
  localStorage.setItem("intervals_strava_oauth_state", stateToken);
  const redirectUri = resolveStravaRedirectUri(settings);
  localStorage.setItem("intervals_strava_oauth_redirect_uri", redirectUri);
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", settings.strava.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "read,activity:read_all");
  url.searchParams.set("state", stateToken);
  window.location.assign(url.toString());
}

async function handleStravaOAuthCallback() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has("code")) return;
  const code = url.searchParams.get("code") || "";
  const stateParam = url.searchParams.get("state") || "";
  const expectedState = localStorage.getItem("intervals_strava_oauth_state") || "";
  const expectedRedirectUri = localStorage.getItem("intervals_strava_oauth_redirect_uri") || "";
  const settings = getSettings();
  const statusEl = document.getElementById("settings-strava-status");
  try {
    if (!code) throw new Error("Missing authorization code.");
    if (!expectedState || stateParam !== expectedState) throw new Error("Invalid OAuth state.");
    if (!settings.strava.clientId || !settings.strava.clientSecret) {
      throw new Error("Missing client ID/client secret in settings.");
    }
    statusEl.textContent = "Completing Strava OAuth…";
    const payload = await exchangeStravaToken(
      {
        client_id: settings.strava.clientId,
        client_secret: settings.strava.clientSecret,
        code,
        redirect_uri: expectedRedirectUri || resolveStravaRedirectUri(settings),
        grant_type: "authorization_code",
      },
      settings
    );
    storeStravaTokenPayload(payload);
    statusEl.textContent = "Strava OAuth connected.";
  } catch (err) {
    statusEl.textContent = `Strava OAuth failed: ${err.message}`;
  } finally {
    localStorage.removeItem("intervals_strava_oauth_state");
    localStorage.removeItem("intervals_strava_oauth_redirect_uri");
    const clean = new URL(window.location.href);
    ["code", "state", "scope"].forEach((k) => clean.searchParams.delete(k));
    window.history.replaceState({}, "", clean.toString());
  }
}

async function stravaGet(path, settings, token) {
  // Prefer direct in auto mode to avoid local Python SSL trust-store issues.
  if (settings.apiMode !== "proxy") {
    const res = await fetch(`https://www.strava.com/api/v3${path}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Strava request failed (${res.status})`);
    return await res.json();
  }

  if (settings.apiMode === "proxy") {
    try {
      const qs = new URLSearchParams({ path, access_token: token });
      const res = await fetch(`./api/strava/get?${qs}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error || `Strava proxy error (${res.status})`);
      }
      const data = await res.json();
      return data.result;
    }
    catch (err) {
      throw err;
    }
  }
  throw new Error("Unsupported Strava API mode.");
}

function mapSegmentEffortToInterval(effort) {
  const segment = effort.segment || {};
  const activity = effort.activity || {};
  // effort_start_iso stores the effort's absolute start so we can compute the
  // correct stream offset at render time once we know the activity's start time.
  const effortStartIso = effort.start_date_local || effort.start_date || "";
  // Pre-compute offset only when __activityStart is the TRUE activity start
  // (activity-scan path sets this correctly; all_efforts path may not).
  const effortEpoch = Date.parse(effortStartIso);
  const activityEpoch = Date.parse(effort.__activityStart || "");
  const startOffsetS = Number.isFinite(effortEpoch) && Number.isFinite(activityEpoch)
    && Math.abs(effortEpoch - activityEpoch) > 100   // sanity: ignore if same time
    ? Math.max(0, Math.round((effortEpoch - activityEpoch) / 1000))
    : 0;
  return {
    interval_id: `strava-${effort.id}`,
    strava_effort_id: String(effort.id || ""),
    activity_id: activity.id || `strava-activity-${effort.id}`,
    activity_start_local: effort.__activityStart || effortStartIso,
    effort_start_iso: effortStartIso,
    date: String(effortStartIso).slice(0, 10),
    activity_name: effort.__activityName || segment.name || effort.name || "Strava segment",
    activity_type: effort.__activityType || segment.activity_type || "",
    label: segment.name || effort.name || "",
    interval_type: "STRAVA_SEGMENT",
    source: "strava",
    moving_time_s: Number(effort.elapsed_time || effort.moving_time || 0),
    start_index: startOffsetS,
    avg_watts: Number(effort.average_watts || 0),
    weighted_watts: Number(effort.average_watts || 0),
    avg_watts_kg: 0,
    avg_hr: Number(effort.average_heartrate || 0),
    max_hr: Number(effort.max_heartrate || 0),
    training_load: 0,
    decoupling: 0,
    zone: null,
  };
}

/**
 * Fetch all athlete efforts for a single segment from Strava.
 * Uses GET /segments/{id}/all_efforts with optional date range.
 * Returns raw effort objects (augmented with __segment for mapping).
 */
async function fetchAllEffortsForSegment(segmentId, segment, params, settings, token) {
  const efforts = [];
  const qs = new URLSearchParams({ per_page: "200" });
  if (params.startDate) qs.set("start_date_local", `${params.startDate}T00:00:00Z`);
  if (params.endDate)   qs.set("end_date_local",   `${params.endDate}T23:59:59Z`);
  for (let page = 1; page <= 10; page++) {
    qs.set("page", String(page));
    const batch = await stravaGet(`/segments/${segmentId}/all_efforts?${qs}`, settings, token);
    if (!Array.isArray(batch) || !batch.length) break;
    batch.forEach((e) => {
      // Enrich with segment info (all_efforts results omit full segment detail)
      efforts.push({
        ...e,
        segment: e.segment ?? segment,
        __activityType: segment.activity_type || "",
        __activityName: segment.name || "",
        __activityStart: e.start_date_local || e.start_date || "",
      });
    });
    if (batch.length < 200) break;
  }
  return efforts;
}

async function runStravaSegmentSearch(params, settings, onProgress = () => {}) {
  const emitProgress = (text) => onProgress(`Searching Strava segments… ${text}`);
  emitProgress("Preparing request.");
  const token = await refreshStravaTokenIfNeeded(settings);
  if (!token) throw new Error("No Strava access token. Use Connect Strava first.");

  const labelNeedle = params.label.trim().toLowerCase();
  const typeNeedle = normalizeActivityType(params.activityType);

  // ── Starred path: load starred segments, then fetch all efforts per segment ──
  // This is much more complete than activity scanning: Strava returns every
  // effort the athlete has on that segment, respecting the date range filter.
  if (params.starredOnly) {
    emitProgress("Loading starred segments…");
    const starredSegments = [];
    for (let page = 1; page <= 10; page++) {
      emitProgress(`Loading starred segments (page ${page})…`);
      const batch = await stravaGet(
        `/segments/starred?page=${page}&per_page=200`,
        settings,
        token
      );
      if (!Array.isArray(batch) || !batch.length) break;
      batch.forEach((s) => starredSegments.push(s));
      if (batch.length < 200) break;
    }
    emitProgress(`${starredSegments.length} starred segment(s) found. Filtering by label…`);

    // Filter segments by label first so we only fetch efforts for matching ones
    const matchingSegments = labelNeedle
      ? starredSegments.filter((s) => String(s.name || "").toLowerCase().includes(labelNeedle))
      : starredSegments;

    emitProgress(`${matchingSegments.length} matching segment(s). Fetching your efforts…`);

    const allEfforts = [];
    for (let i = 0; i < matchingSegments.length; i++) {
      const seg = matchingSegments[i];
      emitProgress(`Fetching efforts for "${seg.name}" (${i + 1}/${matchingSegments.length})…`);
      try {
        const efforts = await fetchAllEffortsForSegment(seg.id, seg, params, settings, token);
        const typeFiltered = typeNeedle
          ? efforts.filter((e) => normalizeActivityType(e.__activityType) === typeNeedle)
          : efforts;
        allEfforts.push(...typeFiltered);
        emitProgress(`"${seg.name}": ${typeFiltered.length} effort(s) in range. Total so far: ${allEfforts.length}.`);
      } catch (err) {
        const msg = String(err?.message || "");
        if (msg.includes("401")) {
          throw new Error("Strava token missing scope activity:read_all. Reconnect Strava in Settings.");
        }
        // Skip segments that can't be read (e.g. private)
        console.warn(`Skipping segment ${seg.id} (${seg.name}): ${msg}`);
      }
    }

    emitProgress("Done.");
    return allEfforts
      .map(mapSegmentEffortToInterval)
      .sort(compareIntervalsChronologically);
  }

  // ── Non-starred path: scan athlete activities ──────────────────────────────
  // There is no Strava endpoint to search segments by name for all athletes,
  // so we fall back to scanning recent activities and collecting efforts.
  const afterEpoch = params.startDate
    ? Math.floor(new Date(`${params.startDate}T00:00:00`).getTime() / 1000)
    : 0;
  const beforeEpoch = params.endDate
    ? Math.floor(new Date(`${params.endDate}T23:59:59`).getTime() / 1000)
    : 0;

  const efforts = [];
  let processedActivities = 0;
  for (let page = 1; page <= 5; page++) {
    emitProgress(`Scanning activities page ${page}/5…`);
    const activityQuery = new URLSearchParams({ page: String(page), per_page: "50" });
    if (afterEpoch > 0) activityQuery.set("after", String(afterEpoch));
    if (beforeEpoch > 0) activityQuery.set("before", String(beforeEpoch));
    let activities;
    try {
      activities = await stravaGet(`/athlete/activities?${activityQuery}`, settings, token);
    } catch (err) {
      const msg = String(err?.message || "");
      if (msg.includes("401")) {
        throw new Error("Strava token missing scope activity:read_all. Reconnect Strava in Settings.");
      }
      throw err;
    }
    if (!Array.isArray(activities) || !activities.length) break;
    for (const activity of activities) {
      if (processedActivities >= 30) break;
      processedActivities += 1;
      emitProgress(`Scanning activity ${processedActivities}/30…`);
      const activityType = String(activity.type || "");
      if (typeNeedle && normalizeActivityType(activityType) !== typeNeedle) continue;
      try {
        const detail = await stravaGet(
          `/activities/${activity.id}?include_all_efforts=true`,
          settings,
          token
        );
        const segmentEfforts = Array.isArray(detail.segment_efforts) ? detail.segment_efforts : [];
        segmentEfforts.forEach((e) => {
          efforts.push({
            ...e,
            __activityType: detail.type || activityType,
            __activityName: detail.name || activity.name || "",
            __activityStart: detail.start_date_local || detail.start_date || "",
          });
        });
        emitProgress(`Scanning activity ${processedActivities}/30… found ${efforts.length} effort(s).`);
      } catch {
        // Skip activities that cannot be read with current token scope.
      }
    }
    if (processedActivities >= 30) break;
    if (activities.length < 50) break;
  }

  emitProgress("Filtering results…");
  return efforts
    .filter((effort) => {
      const segment = effort.segment || {};
      if (labelNeedle && !String(segment.name || effort.name || "").toLowerCase().includes(labelNeedle)) return false;
      return true;
    })
    .map(mapSegmentEffortToInterval)
    .filter((item) => {
      if (params.startDate && item.date < params.startDate) return false;
      if (params.endDate && item.date > params.endDate) return false;
      return true;
    })
    .sort(compareIntervalsChronologically);
}

function saveIntervalsCache(intervals) {
  localStorage.setItem(INTERVALS_CACHE_KEY, JSON.stringify(intervals));
}

function saveActivitiesCache(activities) {
  localStorage.setItem(ACTIVITIES_CACHE_KEY, JSON.stringify(activities));
}

function loadActivitiesCache() {
  try {
    const raw = localStorage.getItem(ACTIVITIES_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
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

function clearActivitiesCache() {
  localStorage.removeItem(ACTIVITIES_CACHE_KEY);
}

function hideActivitySearchPreview() {
  const box = document.getElementById("activity-search-preview");
  box.classList.add("hidden");
  document.getElementById("activity-search-preview-body").innerHTML = "";
  document.getElementById("activity-search-preview-summary").textContent = "";
  document.getElementById("activity-search-preview-add").disabled = false;
  state.pendingActivityResults = [];
}

function renderActivitySearchPreview(results) {
  const body = document.getElementById("activity-search-preview-body");
  body.innerHTML = "";
  results.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.date || ""}</td>
      <td>${item.activity_type || ""}</td>
      <td title="${item.activity_name || ""}">${(item.activity_name || "").slice(0, 42)}</td>
      <td class="right">${formatSeconds(item.moving_time_s)}</td>
    `;
    body.appendChild(tr);
  });
  document.getElementById("activity-search-preview-summary").textContent =
    `${results.length} activity(s) found`;
  document.getElementById("activity-search-preview-add").disabled = results.length === 0;
  document.getElementById("activity-search-preview").classList.remove("hidden");
}

function hideSearchPreview(kind) {
  const prefix = kind === "strava" ? "strava-search" : "search";
  const box = document.getElementById(`${prefix}-preview`);
  box.classList.add("hidden");
  document.getElementById(`${prefix}-preview-body`).innerHTML = "";
  document.getElementById(`${prefix}-preview-summary`).textContent = "";
  document.getElementById(`${prefix}-preview-add`).disabled = false;
  if (kind === "strava") {
    state.pendingStravaResults = [];
  } else {
    state.pendingIntervalsResults = [];
    state.pendingIntervalsParams = null;
  }
}

function renderSearchPreview(results, kind) {
  const prefix = kind === "strava" ? "strava-search" : "search";
  const body = document.getElementById(`${prefix}-preview-body`);
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
  document.getElementById(`${prefix}-preview-summary`).textContent = `${results.length} interval(s) found`;
  document.getElementById(`${prefix}-preview-add`).disabled = results.length === 0;
  document.getElementById(`${prefix}-preview`).classList.remove("hidden");
}

function intervalIdentity(item) {
  return [
    item.source || "intervals",
    item.activity_id || "",
    item.interval_id || "",
    Number(item.start_index) || 0,
  ].join("|");
}

function mergeIntervals(existing, incoming) {
  const byId = new Map();
  existing.forEach((item) => byId.set(intervalIdentity(item), item));
  let added = 0;
  let updated = 0;
  incoming.forEach((raw) => {
    const item = { ...raw, source: raw.source || "intervals" };
    const key = intervalIdentity(item);
    if (byId.has(key)) {
      byId.set(key, item);
      updated += 1;
    } else {
      byId.set(key, item);
      added += 1;
    }
  });
  return { items: [...byId.values()], added, updated };
}

function activityIdentity(item) {
  return [
    item.source || "intervals",
    item.activity_id || "",
    String(item.activity_start_local || item.date || ""),
  ].join("|");
}

function mergeActivities(existing, incoming) {
  const byId = new Map();
  existing.forEach((item) => byId.set(activityIdentity(item), item));
  let added = 0;
  let updated = 0;
  incoming.forEach((raw) => {
    const item = { ...raw, source: raw.source || "intervals" };
    const key = activityIdentity(item);
    if (byId.has(key)) {
      byId.set(key, item);
      updated += 1;
    } else {
      byId.set(key, item);
      added += 1;
    }
  });
  return { items: [...byId.values()], added, updated };
}

function commitActivities(results) {
  const merged = mergeActivities(state.activities, results);
  state.activities = merged.items.sort(compareActivitiesChronologically);
  renderActivities();
  saveActivitiesCache(state.activities);
  document.getElementById("activity-search-status").textContent = merged.updated
    ? `Added ${merged.added} activity(s), updated ${merged.updated} duplicate(s).`
    : `Added ${merged.added} activity(s).`;
  hideActivitySearchPreview();
  hideSearchPreview("intervals");
  hideSearchPreview("strava");
  setScreen("activities");
}

function commitIntervals(results, params) {
  const merged = mergeIntervals(state.intervals, results);
  state.intervals = merged.items.sort(compareIntervalsChronologically);
  state.filtered  = [...state.intervals];
  state.selected.clear();
  renderIntervals();
  saveIntervalsCache(state.intervals);
  setStatus(
    merged.updated
      ? `Added ${merged.added} interval(s), updated ${merged.updated} duplicate(s).`
      : `Added ${merged.added} interval(s).`
  );
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
  hideActivitySearchPreview();
  hideSearchPreview("intervals");
  hideSearchPreview("strava");
  setScreen("intervals");
}

/* ─── Map API response → internal interval object ─────────────────────────── */
function mapActivity(activity) {
  return {
    activity_id: activity.id,
    activity_start_local: activity.start_date_local || "",
    date: String(activity.start_date_local || "").slice(0, 10),
    activity_name: activity.name || "",
    activity_type: activity.type || "",
    source: "intervals",
    moving_time_s: Number(activity.moving_time || 0),
    distance_m: Number(activity.distance || 0),
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
  const fields = encodeURIComponent("id,name,start_date_local,type,moving_time,distance");
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
  state.activities.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.date || ""}</td>
      <td>${item.activity_type || ""}</td>
      <td title="${item.activity_name || ""}">${(item.activity_name || "").slice(0, 48)}</td>
      <td class="right">${formatSeconds(item.moving_time_s)}</td>
    `;
    body.appendChild(tr);
  });
  document.getElementById("activities-summary").textContent = `${state.activities.length} activities`;
}

/* ─── Render intervals table ─────────────────────────────────────────────── */
function renderIntervals() {
  const body = document.getElementById("intervals-body");
  body.innerHTML = "";
  state.filtered.forEach((item) => {
    const id = String(item.interval_id);
    const z  = item.zone;
    const source = item.source || "intervals";
    const sourceIcon = source === "strava"
      ? '<span style="color:#f59e0b;font-weight:700">S</span>'
      : '<span style="color:#ef4444;font-weight:700">I</span>';
    const sourceLabel = source === "strava" ? "Strava" : "Intervals.icu";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="center"><input type="checkbox" data-select-id="${id}" ${state.selected.has(id) ? "checked" : ""} /></td>
      <td class="center" title="${sourceLabel}">${sourceIcon}</td>
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
  const sourceNeedle = document.getElementById("filter-source").value;
  const typeNeedle  = normalizeActivityType(document.getElementById("filter-type").value);
  const tFrom = parseMmSs(document.getElementById("filter-time-from").value);
  const tTo   = parseMmSs(document.getElementById("filter-time-to").value);
  const dFrom = document.getElementById("filter-date-from").value;
  const dTo   = document.getElementById("filter-date-to").value;

  state.filtered = state.intervals.filter((item) => {
    if (labelNeedle && !String(item.label).toLowerCase().includes(labelNeedle)) return false;
    if (sourceNeedle && (item.source || "intervals") !== sourceNeedle) return false;
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

async function fetchHrStream(activityId, settings, source = "intervals", stravaEffortId = "") {
  const activityCacheKey = `${source}:${activityId}`;
  const effortCacheKey = source === "strava" && stravaEffortId ? `strava-effort:${stravaEffortId}` : "";

  const cacheCandidates = [activityCacheKey, effortCacheKey].filter(Boolean);
  for (const key of cacheCandidates) {
    if (hrStreamCache[key]) return hrStreamCache[key];
    const stored = loadHrStreamFromStorage(key);
    if (stored && Array.isArray(stored.time) && Array.isArray(stored.heartrate)) {
      hrStreamCache[key] = stored;
      return stored;
    }
  }

  let result;
  if (source === "strava") {
    const token = await refreshStravaTokenIfNeeded(settings);
    if (!token) throw new Error("No Strava access token. Use Connect Strava first.");
    try {
      const activityCandidates = [
        `/activities/${encodeURIComponent(activityId)}/streams?keys=time,heartrate,watts,velocity_smooth,distance,altitude,grade_smooth&key_by_type=true`,
        `/activities/${encodeURIComponent(activityId)}/streams?keys=time,heartrate,watts,velocity_smooth,distance,altitude,grade_smooth`,
        `/activities/${encodeURIComponent(activityId)}/streams?keys=time,heartrate&key_by_type=true`,
        `/activities/${encodeURIComponent(activityId)}/streams?keys=time,heartrate`,
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
          `/segment_efforts/${encodeURIComponent(stravaEffortId)}/streams?keys=time,heartrate,watts,velocity_smooth,distance,altitude,grade_smooth&key_by_type=true`,
          `/segment_efforts/${encodeURIComponent(stravaEffortId)}/streams?keys=time,heartrate,watts,velocity_smooth,distance,altitude,grade_smooth`,
          `/segment_efforts/${encodeURIComponent(stravaEffortId)}/streams?keys=time,heartrate&key_by_type=true`,
          `/segment_efforts/${encodeURIComponent(stravaEffortId)}/streams?keys=time,heartrate`,
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
      let res = await fetch(
        `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams?types=heartrate,time,watts,velocity,pace,gap,distance,altitude,grade`,
        { headers: { Authorization: auth, Accept: "application/json" } }
      );
      if (!res.ok && res.status === 400) {
        res = await fetch(
          `https://intervals.icu/api/v1/activity/${encodeURIComponent(activityId)}/streams?types=heartrate,time`,
          { headers: { Authorization: auth, Accept: "application/json" } }
        );
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
  const wattsPoints = sliceMetricStream(stream, stream?.watts, startIndex, movingTimeS, (v) => Number(v));
  if (wattsPoints.length) {
    return {
      kind: "watts",
      name: "Watts",
      unit: "W",
      points: wattsPoints,
    };
  }

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
      return Number.isFinite(speed) && speed > 0 ? (1000 / speed) / 60 : null;
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

function renderCompare() {
  const sel = state.filtered.filter((x) => state.selected.has(String(x.interval_id)));
  const src = sel.length ? sel : state.filtered;
  state.compareSource = [...src].sort(compareIntervalsChronologically);
  state.pinnedInterval = null;
  document.getElementById("compare-summary").textContent =
    `${state.compareSource.length} interval(s) shown${sel.length ? " (selected)" : " (all filtered)"}`;

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
    state.pendingIntervalsResults = sorted;
    state.pendingIntervalsParams = params;
    hideActivitySearchPreview();
    renderSearchPreview(sorted, "intervals");
    hideSearchPreview("strava");
    setStatus(`Search complete. ${sorted.length} interval(s) ready to add.`);
  } catch (err) {
    setStatus(`Search failed: ${err.message}`, true);
  } finally {
    submit.disabled = false;
  }
}

async function handleActivitySearchSubmit(e) {
  e.preventDefault();
  const settings = getSettings();
  if (!settings.athleteId || !settings.apiKey) {
    document.getElementById("activity-search-status").textContent =
      "Set athlete ID and API key in Settings first.";
    setScreen("settings");
    return;
  }
  const defaultRange = defaultDateRange();
  const resolvedStartDate = document.getElementById("activity-search-from").value || defaultRange.from;
  const resolvedEndDate = document.getElementById("activity-search-to").value || defaultRange.to;
  document.getElementById("activity-search-from").value = resolvedStartDate;
  document.getElementById("activity-search-to").value = resolvedEndDate;
  const params = {
    label: document.getElementById("activity-search-label").value.trim(),
    activityType: document.getElementById("activity-search-type").value,
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
  };
  const submit = document.getElementById("activity-search-submit");
  const status = document.getElementById("activity-search-status");
  submit.disabled = true;
  status.textContent = "Searching activities…";
  try {
    const mode = resolveApiMode(settings.apiMode);
    let results;
    if (mode === "proxy") {
      try {
        results = await runProxyActivitySearch(params, settings.athleteId, settings.apiKey);
      } catch (err) {
        if (!isAutoProxyMode(settings.apiMode)) throw err;
        status.textContent = "Local proxy unavailable, retrying direct…";
        results = await runDirectActivitySearch(params, settings.athleteId, settings.apiKey);
      }
    } else {
      results = await runDirectActivitySearch(params, settings.athleteId, settings.apiKey);
    }
    const sorted = [...results].sort(compareActivitiesChronologically);
    state.pendingActivityResults = sorted;
    renderActivitySearchPreview(sorted);
    hideSearchPreview("intervals");
    hideSearchPreview("strava");
    status.textContent = `Search complete. ${sorted.length} activity(s) ready to add.`;
  } catch (err) {
    status.textContent = `Activity search failed: ${err.message}`;
  } finally {
    submit.disabled = false;
  }
}

async function handleStravaSearchSubmit(e) {
  e.preventDefault();
  const settings = getSettings();
  const defaultRange = defaultDateRange();
  const resolvedStartDate = document.getElementById("strava-search-from").value || defaultRange.from;
  const resolvedEndDate = document.getElementById("strava-search-to").value || defaultRange.to;
  document.getElementById("strava-search-from").value = resolvedStartDate;
  document.getElementById("strava-search-to").value = resolvedEndDate;
  const params = {
    label: document.getElementById("strava-search-label").value.trim(),
    activityType: document.getElementById("strava-search-type").value,
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    starredOnly: document.getElementById("strava-search-starred").checked,
  };
  const submit = document.getElementById("strava-search-submit");
  const status = document.getElementById("strava-search-status");
  submit.disabled = true;
  status.textContent = "Searching Strava segments…";
  try {
    const results = await runStravaSegmentSearch(params, settings, (text) => {
      status.textContent = text;
    });
    state.pendingStravaResults = results;
    hideActivitySearchPreview();
    renderSearchPreview(results, "strava");
    hideSearchPreview("intervals");
    status.textContent = `${results.length} segment effort(s) ready to add.`;
  } catch (err) {
    status.textContent = `Strava search failed: ${err.message}`;
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
  document.getElementById("activity-search-from").value = range.from;
  document.getElementById("activity-search-to").value = range.to;
  document.getElementById("search-from").value = range.from;
  document.getElementById("search-to").value   = range.to;
  document.getElementById("strava-search-from").value = range.from;
  document.getElementById("strava-search-to").value = range.to;

  state.activities = loadActivitiesCache().sort(compareActivitiesChronologically);
  const cached = loadIntervalsCache().sort(compareIntervalsChronologically);
  state.intervals = cached;
  state.filtered = [...cached];
  renderActivities();
  renderIntervals();

  loadSettingsToForm();
  updateSettingsCallouts();
  handleStravaOAuthCallback();
  initManualGallery();
  initSearchDatePickers();
  setScreen("search");

  document.getElementById("activity-search-form").addEventListener("submit", handleActivitySearchSubmit);
  document.getElementById("activity-search-form").addEventListener("reset", () => {
    const resetRange = defaultDateRange();
    document.getElementById("activity-search-from").value = resetRange.from;
    document.getElementById("activity-search-to").value = resetRange.to;
    hideActivitySearchPreview();
    document.getElementById("activity-search-status").textContent = "";
  });
  document.getElementById("activity-search-preview-cancel").addEventListener("click", () => {
    hideActivitySearchPreview();
    document.getElementById("activity-search-status").textContent = "Activity search preview canceled.";
  });
  document.getElementById("activity-search-preview-add").addEventListener("click", () => {
    if (!state.pendingActivityResults.length) return;
    commitActivities(state.pendingActivityResults);
  });
  document.getElementById("search-form").addEventListener("submit", handleSearchSubmit);
  document.getElementById("search-form").addEventListener("reset", () => {
    const resetRange = defaultDateRange();
    document.getElementById("search-from").value = resetRange.from;
    document.getElementById("search-to").value = resetRange.to;
    hideSearchPreview("intervals");
    setStatus("");
  });
  document.getElementById("search-preview-cancel").addEventListener("click", () => {
    hideSearchPreview("intervals");
    setStatus("Search preview canceled.");
  });
  document.getElementById("search-preview-add").addEventListener("click", () => {
    if (!state.pendingIntervalsResults.length) return;
    commitIntervals(state.pendingIntervalsResults, state.pendingIntervalsParams);
  });
  document.getElementById("strava-search-form").addEventListener("submit", handleStravaSearchSubmit);
  document.getElementById("strava-search-form").addEventListener("reset", () => {
    const resetRange = defaultDateRange();
    document.getElementById("strava-search-from").value = resetRange.from;
    document.getElementById("strava-search-to").value = resetRange.to;
    // Reset checkbox to checked default and hide warning
    document.getElementById("strava-search-starred").checked = true;
    document.getElementById("strava-nonstarred-warn-wrap").style.display = "none";
    hideSearchPreview("strava");
    document.getElementById("strava-search-status").textContent = "";
  });
  const stravaStarredEl = document.getElementById("strava-search-starred");
  const syncStarredWarning = () => {
    document.getElementById("strava-nonstarred-warn-wrap").style.display =
      stravaStarredEl.checked ? "none" : "";
  };
  stravaStarredEl.addEventListener("change", syncStarredWarning);
  stravaStarredEl.addEventListener("sl-change", syncStarredWarning);
  document.getElementById("strava-search-preview-cancel").addEventListener("click", () => {
    hideSearchPreview("strava");
    document.getElementById("strava-search-status").textContent = "Strava preview canceled.";
  });
  document.getElementById("strava-search-preview-add").addEventListener("click", () => {
    if (!state.pendingStravaResults.length) return;
    commitIntervals(state.pendingStravaResults, null);
    document.getElementById("strava-search-status").textContent = "Added Strava results to intervals.";
  });
  document.getElementById("settings-form").addEventListener("submit", saveSettings);
  document.getElementById("settings-save-mode").addEventListener("click", saveApiMode);
  document.getElementById("settings-save-strava").addEventListener("click", saveStravaSettings);
  document.getElementById("settings-strava-connect").addEventListener("click", startStravaOAuth);
  document.getElementById("settings-reset").addEventListener("click", clearSettings);
  document.getElementById("settings-clear-interval-cache").addEventListener("click", () => {
    clearIntervalsCache();
    state.intervals = [];
    state.filtered = [];
    state.selected.clear();
    hideSearchPreview("intervals");
    hideSearchPreview("strava");
    renderIntervals();
    document.getElementById("settings-status").textContent = "Intervals cache deleted.";
  });

  document.getElementById("settings-clear-hr-cache").addEventListener("click", () => {
    clearHrStreamCache();
    document.getElementById("settings-status").textContent = "HR stream cache deleted.";
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
  const zoneModelEl = document.getElementById("settings-zone-model");
  const onZoneModelChange = (e) => {
    localStorage.setItem("intervals_zone_model_id", e.target.value);
    const s = getSettings();
    renderZoneModelPreview(s.zoneModels.find((m) => String(m.id) === e.target.value) || null);
    updateSettingsCallouts();
  };
  zoneModelEl.addEventListener("change", onZoneModelChange);
  zoneModelEl.addEventListener("sl-change", onZoneModelChange);
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);
  const topbar = document.querySelector(".topbar");
  const topbarMenuToggle = document.getElementById("topbar-menu-toggle");
  topbarMenuToggle?.addEventListener("click", () => {
    if (!topbar) return;
    const isOpen = topbar.classList.toggle("menu-open");
    topbarMenuToggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
  document.getElementById("back-to-list").addEventListener("click", () => setScreen("intervals"));
  document.getElementById("go-compare").addEventListener("click", () => setScreen("compare"));
  document.getElementById("select-all").addEventListener("click", () => {
    state.filtered.forEach((x) => state.selected.add(String(x.interval_id)));
    renderIntervals();
  });
  document.getElementById("clear-activities").addEventListener("click", () => {
    state.activities = [];
    clearActivitiesCache();
    renderActivities();
  });
  document.getElementById("select-none").addEventListener("click", () => {
    state.selected.clear();
    renderIntervals();
  });

  document.querySelectorAll("[data-screen-target]").forEach((btn) => {
    btn.addEventListener("click", () => {
      setScreen(btn.dataset.screenTarget);
      closeTopbarMenu();
    });
  });

  document.getElementById("apply-filters").addEventListener("click", applyLocalFilters);
  document.getElementById("clear-filters").addEventListener("click", () => {
    ["filter-label","filter-time-from","filter-time-to","filter-date-from","filter-date-to"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    document.getElementById("filter-source").value = "";
    document.getElementById("filter-type").value = "";
    state.filtered = [...state.intervals];
    renderIntervals();
  });

  window.addEventListener("resize", resizeAll);
}

init();
