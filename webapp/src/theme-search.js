/* ─── Theme ──────────────────────────────────────────────────────────────── */
function toggleTheme() {
  const dark = document.body.classList.toggle("theme-dark");
  document.getElementById("theme-toggle").textContent = dark ? "Light mode" : "Dark mode";
  localStorage.setItem("webapp-theme", dark ? "dark" : "light");
  if (state.screen === "compare") renderCompare();
  if (state.screen === "activity-detail") {
    const tabActivity = getActiveTabActivity();
    if (tabActivity) {
      const focusId = state.activityLab.focusActivityId || tabActivity.activity_id;
      openActivityLab(tabActivity, { focusActivityId: focusId });
    }
  }
}

/* ─── Search ─────────────────────────────────────────────────────────────── */
function defaultDateRange() {
  const to = new Date();
  const from = new Date(to);
  from.setMonth(from.getMonth() - 6);
  return { from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10) };
}

/* Date range for the "Load all new activities" shortcut: from = the day of the
 * newest activity already in the local cache, to = today. Falls back to the
 * default 6-month window when nothing is cached yet. */
function loadAllNewDateRange() {
  const dates = (state.activities || []).map((a) => a.date).filter(Boolean);
  const to = new Date().toISOString().slice(0, 10);
  if (!dates.length) return defaultDateRange();
  return { from: dates.sort()[dates.length - 1], to };
}

/* Reflects the current "Load all new activities" checkbox state onto the two
 * date inputs: when checked, fill them with the newest-cached→today range and
 * disable manual editing; when unchecked, re-enable them. */
function syncActivitySearchLoadAll() {
  const check = document.getElementById("activity-search-loadall");
  const fromEl = document.getElementById("activity-search-from");
  const toEl = document.getElementById("activity-search-to");
  if (!check || !fromEl || !toEl) return;
  if (check.checked) {
    const range = loadAllNewDateRange();
    fromEl.value = range.from;
    toEl.value = range.to;
    fromEl.setAttribute("disabled", "");
    toEl.setAttribute("disabled", "");
  } else {
    fromEl.removeAttribute("disabled");
    toEl.removeAttribute("disabled");
  }
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
  const loadAll = document.getElementById("activity-search-loadall")?.checked;
  const range = loadAll ? loadAllNewDateRange() : null;
  const resolvedStartDate = range ? range.from : (document.getElementById("activity-search-from").value || defaultRange.from);
  const resolvedEndDate = range ? range.to : (document.getElementById("activity-search-to").value || defaultRange.to);
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

