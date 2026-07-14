const state = {
  intervals: [],
  filtered: [],
  screen: "search",
};

function parseMmSs(input) {
  if (!input || !String(input).trim()) return null;
  const match = String(input).trim().match(/^(\d+):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatSeconds(value) {
  const total = Math.max(0, Math.round(Number(value) || 0));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function setScreen(name) {
  state.screen = name;
  document.querySelectorAll(".screen").forEach((el) => {
    el.classList.toggle("active", el.id === `screen-${name}`);
  });
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.classList.toggle("nav-btn-active", btn.dataset.screenTarget === name);
  });
}

function getSettings() {
  return {
    athleteId: (localStorage.getItem("intervals_athlete_id") || "").trim(),
    apiKey: (localStorage.getItem("intervals_api_key") || "").trim(),
    apiMode: localStorage.getItem("intervals_api_mode") || "auto",
  };
}

function setStatus(text, isError = false) {
  const node = document.getElementById("search-status");
  node.textContent = text;
  node.style.color = isError ? "#f87171" : "";
}

function resolveApiMode(savedMode) {
  if (savedMode !== "auto") return savedMode;
  return window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1" ? "proxy" : "direct";
}

function normalizeActivityType(type) {
  if (!type) return "";
  return type.replace(/\s+/g, "").toLowerCase();
}

function mapInterval(activity, interval) {
  return {
    interval_id: interval.id,
    activity_id: activity.id,
    date: String(activity.start_date_local || "").slice(0, 10),
    activity_name: activity.name || "",
    activity_type: activity.type || "",
    label: interval.label || "",
    moving_time_s: interval.moving_time || 0,
    avg_hr: interval.average_heartrate || 0,
    max_hr: interval.max_heartrate || 0,
    zone: interval.zone || null,
  };
}

async function runDirectSearch(params, athleteId, apiKey) {
  const oldest = encodeURIComponent(params.startDate);
  const newest = encodeURIComponent(params.endDate);
  const fields = encodeURIComponent("id,name,start_date_local,type");
  const activitiesUrl = `https://intervals.icu/api/v1/athlete/${encodeURIComponent(athleteId)}/activities?oldest=${oldest}&newest=${newest}&fields=${fields}`;

  const auth = `Basic ${btoa(`API_KEY:${apiKey}`)}`;
  const commonHeaders = {
    Authorization: auth,
    Accept: "application/json",
  };

  const activityRes = await fetch(activitiesUrl, { headers: commonHeaders });
  if (!activityRes.ok) {
    throw new Error(`Activities request failed (${activityRes.status})`);
  }
  const activities = await activityRes.json();

  const activityTypeNeedle = normalizeActivityType(params.activityType);
  const results = [];

  for (let i = 0; i < activities.length; i += 1) {
    const activity = activities[i];
    if (activityTypeNeedle && normalizeActivityType(activity.type) !== activityTypeNeedle) {
      continue;
    }

    setStatus(`Loading activity ${i + 1}/${activities.length}...`);
    const intervalRes = await fetch(
      `https://intervals.icu/api/v1/activity/${encodeURIComponent(activity.id)}/intervals`,
      { headers: commonHeaders },
    );
    if (!intervalRes.ok) {
      await delay(150);
      continue;
    }
    const intervalData = await intervalRes.json();
    const intervals = Array.isArray(intervalData.icu_intervals) ? intervalData.icu_intervals : [];

    intervals.forEach((interval) => {
      const labelMatch = !params.label || String(interval.label || "").toLowerCase().includes(params.label.toLowerCase());
      if (!labelMatch) return;

      if (params.targetSeconds !== null) {
        const low = params.targetSeconds - params.marginSeconds;
        const high = params.targetSeconds + params.marginSeconds;
        const t = Number(interval.moving_time || 0);
        if (t < low || t > high) return;
      }

      results.push(mapInterval(activity, interval));
    });

    await delay(150);
  }

  return results;
}

async function runProxySearch(params, athleteId, apiKey) {
  const res = await fetch("./api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      athlete_id: athleteId,
      api_key: apiKey,
      label: params.label,
      activity_type: params.activityType,
      start_date: params.startDate,
      end_date: params.endDate,
      time_target_s: params.targetSeconds,
      time_margin_s: params.marginSeconds,
    }),
  });
  if (!res.ok) {
    throw new Error(`Proxy search failed (${res.status})`);
  }
  const data = await res.json();
  return Array.isArray(data.results) ? data.results : [];
}

function renderIntervals() {
  const body = document.getElementById("intervals-body");
  body.innerHTML = "";

  state.filtered.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.date || ""}</td>
      <td>${item.activity_type || ""}</td>
      <td title="${item.activity_name || ""}">${(item.activity_name || "").slice(0, 34)}</td>
      <td>${item.label || ""}</td>
      <td class="right">${formatSeconds(item.moving_time_s)}</td>
      <td class="right">${Math.round(item.avg_hr || 0)}</td>
      <td class="right">${Math.round(item.max_hr || 0)}</td>
      <td class="right">${item.zone ? `Z${item.zone}` : "-"}</td>
    `;
    body.appendChild(tr);
  });

  document.getElementById("result-summary").textContent = `${state.filtered.length} intervals`;
}

function applyLocalFilters() {
  const labelNeedle = document.getElementById("filter-label").value.trim().toLowerCase();
  const typeNeedle = normalizeActivityType(document.getElementById("filter-type").value);
  const tFrom = parseMmSs(document.getElementById("filter-time-from").value);
  const tTo = parseMmSs(document.getElementById("filter-time-to").value);
  const dFrom = document.getElementById("filter-date-from").value;
  const dTo = document.getElementById("filter-date-to").value;

  state.filtered = state.intervals.filter((item) => {
    if (labelNeedle && !String(item.label).toLowerCase().includes(labelNeedle)) return false;
    if (typeNeedle && normalizeActivityType(item.activity_type) !== typeNeedle) return false;
    if (tFrom !== null && Number(item.moving_time_s) < tFrom) return false;
    if (tTo !== null && Number(item.moving_time_s) > tTo) return false;
    if (dFrom && item.date < dFrom) return false;
    if (dTo && item.date > dTo) return false;
    return true;
  });

  renderIntervals();
}

function loadSettingsToForm() {
  const settings = getSettings();
  document.getElementById("settings-athlete-id").value = settings.athleteId;
  document.getElementById("settings-api-key").value = settings.apiKey;
  document.getElementById("settings-api-mode").value = settings.apiMode;
}

function saveSettings(e) {
  e.preventDefault();
  localStorage.setItem("intervals_athlete_id", document.getElementById("settings-athlete-id").value.trim());
  localStorage.setItem("intervals_api_key", document.getElementById("settings-api-key").value.trim());
  localStorage.setItem("intervals_api_mode", document.getElementById("settings-api-mode").value);
  document.getElementById("settings-status").textContent = "Saved.";
}

function clearSettings() {
  localStorage.removeItem("intervals_athlete_id");
  localStorage.removeItem("intervals_api_key");
  localStorage.removeItem("intervals_api_mode");
  loadSettingsToForm();
  document.getElementById("settings-status").textContent = "Cleared.";
}

function defaultDateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 6);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
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
  const params = {
    label: document.getElementById("search-label").value.trim(),
    activityType: document.getElementById("search-type").value,
    startDate: document.getElementById("search-from").value,
    endDate: document.getElementById("search-to").value,
    targetSeconds,
    marginSeconds,
  };

  const submit = document.getElementById("search-submit");
  submit.disabled = true;
  setStatus("Searching...");

  try {
    const mode = resolveApiMode(settings.apiMode);
    const results = mode === "proxy"
      ? await runProxySearch(params, settings.athleteId, settings.apiKey)
      : await runDirectSearch(params, settings.athleteId, settings.apiKey);

    state.intervals = results.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    state.filtered = [...state.intervals];
    renderIntervals();
    setStatus(`Done. ${results.length} intervals found.`);
    setScreen("intervals");

    document.getElementById("filter-label").value = params.label;
    document.getElementById("filter-type").value = params.activityType;
    if (targetSeconds !== null) {
      document.getElementById("filter-time-from").value = formatSeconds(Math.max(0, targetSeconds - marginSeconds));
      document.getElementById("filter-time-to").value = formatSeconds(targetSeconds + marginSeconds);
    } else {
      document.getElementById("filter-time-from").value = "";
      document.getElementById("filter-time-to").value = "";
    }
    document.getElementById("filter-date-from").value = params.startDate;
    document.getElementById("filter-date-to").value = params.endDate;
  } catch (err) {
    setStatus(`Search failed: ${err.message}`, true);
  } finally {
    submit.disabled = false;
  }
}

function toggleTheme() {
  const dark = document.body.classList.toggle("theme-dark");
  document.getElementById("theme-toggle").textContent = dark ? "Light mode" : "Dark mode";
  localStorage.setItem("webapp-theme", dark ? "dark" : "light");
}

function init() {
  const storedTheme = localStorage.getItem("webapp-theme") || localStorage.getItem("mockup-theme");
  if (storedTheme === "light") {
    document.body.classList.remove("theme-dark");
    document.getElementById("theme-toggle").textContent = "Dark mode";
  }

  const range = defaultDateRange();
  document.getElementById("search-from").value = range.from;
  document.getElementById("search-to").value = range.to;

  loadSettingsToForm();
  setScreen("search");

  document.getElementById("search-form").addEventListener("submit", handleSearchSubmit);
  document.getElementById("settings-form").addEventListener("submit", saveSettings);
  document.getElementById("settings-clear").addEventListener("click", clearSettings);
  document.getElementById("theme-toggle").addEventListener("click", toggleTheme);

  document.querySelectorAll("[data-screen-target]").forEach((btn) => {
    btn.addEventListener("click", () => setScreen(btn.dataset.screenTarget));
  });

  document.getElementById("apply-filters").addEventListener("click", applyLocalFilters);
  document.getElementById("clear-filters").addEventListener("click", () => {
    ["filter-label", "filter-time-from", "filter-time-to", "filter-date-from", "filter-date-to"].forEach((id) => {
      document.getElementById(id).value = "";
    });
    document.getElementById("filter-type").value = "";
    state.filtered = [...state.intervals];
    renderIntervals();
  });
}

init();
