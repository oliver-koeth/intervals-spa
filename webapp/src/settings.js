/* ─── Settings ───────────────────────────────────────────────────────────── */
function getSettings() {
  return {
    athleteId:    (localStorage.getItem("intervals_athlete_id") || "").trim(),
    apiKey:       (localStorage.getItem("intervals_api_key") || "").trim(),
    apiMode:      localStorage.getItem("intervals_api_mode") || "auto",
    zoneModelId:  localStorage.getItem("intervals_zone_model_id") || "",
    zoneModels:   JSON.parse(localStorage.getItem("intervals_zone_models") || "[]"),
    developerMode: localStorage.getItem("intervals_developer_mode") === "true",
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
  const devCheckbox = document.getElementById("settings-developer-mode");
  if (devCheckbox) devCheckbox.checked = s.developerMode;
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
  const devCheckbox = document.getElementById("settings-developer-mode");
  if (devCheckbox) {
    localStorage.setItem("intervals_developer_mode", devCheckbox.checked ? "true" : "false");
    updateDeveloperModeVisibility(devCheckbox.checked);
  }
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

async function clearSettings() {
  [
    "intervals_athlete_id", "intervals_api_key", "intervals_api_mode", "intervals_developer_mode",
    "intervals_zone_model_id", "intervals_zone_models",
    GLUCOSE_CACHE_KEY,
    "intervals_strava_client_id", "intervals_strava_client_secret",
    "intervals_strava_access_token", "intervals_strava_redirect_uri", "intervals_strava_scope",
    "intervals_strava_refresh_token", "intervals_strava_expires_at_epoch",
    "intervals_strava_granted_scope", "intervals_strava_oauth_state", "intervals_strava_oauth_redirect_uri",
  ].forEach((k) => localStorage.removeItem(k));
  await clearActivitiesCache();
  await clearIntervalsCache();
  state.activities = [];
  state.activitiesFiltered = [];
  state.glucose = [];
  state.glucoseFiltered = [];
  state.glucosePage = 1;
  state.openGlucoseTabs = [];
  state.activeGlucoseTabId = null;
  state.openActivityTabs = [];
  state.activeActivityTabId = null;
  state.activityLab.tabActivityId = null;
  state.activityLab.focusActivityId = null;
  state.activityLab.streamActivities = [];
  state.activityLab.workIntervalsByActivity = {};
  state.activityLab.workIntervals = [];
  state.activityLab.plannedWorkoutByActivity = {};
  state.activityLab.lastTileSnapshot = null;
  state.intervals = [];
  state.filtered = [];
  state.selected.clear();
  hideActivitySearchPreview();
  hideSearchPreview("intervals");
  hideSearchPreview("strava");
  renderActivities();
  renderIntervals();
  applyGlucoseFilters();
  renderGlucoseTabBar();
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

/* ─── Developer mode visibility ─────────────────────────────────────────── */
function updateDeveloperModeVisibility(enabled) {
  const nav = document.querySelector('.sidebar-nav [data-screen-target="similarity"]');
  if (nav) nav.classList.toggle("hidden", !enabled);
  const screen = document.getElementById("screen-similarity");
  if (screen && !enabled && screen.classList.contains("active")) {
    setScreen("search");
  }
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

