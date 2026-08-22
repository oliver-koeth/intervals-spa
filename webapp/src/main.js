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
  state.activitiesFiltered = [...state.activities];
  const cached = loadIntervalsCache().sort(compareIntervalsChronologically);
  state.intervals = cached;
  state.filtered = [...cached];
  state.glucose = loadGlucoseCache();
  applyGlucoseFilters();
  renderActivities();
  renderIntervals();
  renderRaceAnalysisActivityOptions();

  loadSettingsToForm();
  updateSettingsCallouts();
  updateDeveloperModeVisibility(getSettings().developerMode);
  handleStravaOAuthCallback();
  initManualGallery();
  initSearchDatePickers();
  const initialScreen = location.hash.replace(/^#/, "");
  const validInitialScreens = ["search", "activities", "race-analysis", "similarity", "intervals", "glucose", "settings", "manual"];
  setScreen(validInitialScreens.includes(initialScreen) ? initialScreen : "search");
  initSidebar();

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
  const saveDevModeBtn = document.getElementById("settings-save-developer-mode");
  if (saveDevModeBtn) saveDevModeBtn.addEventListener("click", saveApiMode);
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
  document.getElementById("go-compare").addEventListener("click", openCompareTab);

  // Activity tab sidebars — delegated click handler
  ["activities-sidebar", "activity-detail-sidebar"].forEach((id) => {
    const sidebar = document.getElementById(id);
    if (!sidebar) return;
    sidebar.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-close-tab]");
      if (closeBtn) {
        e.stopPropagation();
        closeActivityTab(closeBtn.dataset.closeTab);
        return;
      }
      const item = e.target.closest(".activities-sidebar-item");
      if (item) {
        const id = item.dataset.tabId;
        const entry = state.openActivityTabs.find((t) => t.id === id);
        if (entry) {
          state.activeActivityTabId = id;
          updateActivitiesSidebars();
          openActivityLab(entry.activity);
        }
      }
    });
  });

  ["intervals-compare-sidebar", "compare-sidebar"].forEach((id) => {
    const sidebar = document.getElementById(id);
    if (!sidebar) return;
    sidebar.addEventListener("click", (e) => {
      const closeBtn = e.target.closest("[data-close-compare-tab]");
      if (closeBtn) {
        e.stopPropagation();
        closeCompareTab(closeBtn.dataset.closeCompareTab);
        return;
      }
      const item = e.target.closest(".activities-sidebar-item");
      if (!item) return;
      const tab = state.openCompareTabs.find((t) => t.id === item.dataset.compareTabId);
      if (!tab) return;
      state.activeCompareTabId = tab.id;
      updateCompareSidebars();
      setScreen("compare");
    });
  });

  document.getElementById("activity-lab-stream-list").addEventListener("click", (e) => {
    const row = e.target.closest("[data-activity-lab-select]");
    if (!row) return;
    const focusId = row.dataset.activityLabSelect;
    const tabActivity = getActiveTabActivity();
    if (!tabActivity || !focusId) return;
    state.activityLab.focusActivityId = String(focusId);
    renderActivityLabStreamList();
    const focusActivity = state.activityLab.streamActivities.find(
      (a) => String(a.activity_id) === String(focusId)
    ) || tabActivity;
    renderActivityLabFocus(tabActivity, focusActivity);
  });

  document.getElementById("activity-lab-refresh").addEventListener("click", () => {
    const tabActivity = getActiveTabActivity();
    if (!tabActivity) return;
    const focusActivity = state.activityLab.streamActivities.find(
      (a) => String(a.activity_id) === String(state.activityLab.focusActivityId || "")
    ) || tabActivity;
    delete state.activityLab.workIntervalsByActivity[String(focusActivity.activity_id || "")];
    renderActivityLabFocus(tabActivity, focusActivity, true);
  });

  document.getElementById("activity-lab-stream-mode").addEventListener("sl-change", (e) => {
    state.activityLab.streamListMode = e.target.value || "recent";
    syncActivityLabStreamControls();
    refreshActivityLabStreamList();
  });
  document.getElementById("activity-lab-stream-threshold").addEventListener("input", (e) => {
    const pct = Number(e.target.value) || 0;
    state.activityLab.streamMinScorePct = pct;
    document.getElementById("activity-lab-stream-threshold-value").textContent = `${pct}%`;
  });
  document.getElementById("activity-lab-stream-threshold").addEventListener("change", () => {
    refreshActivityLabStreamList();
  });

  document.querySelectorAll(".activity-lab-series-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.activityLabLabel;
      if (!key) return;
      if (key === "elevation") return;
      const current = state.activityLab.visibleSeries[key] || "off";
      state.activityLab.visibleSeries[key] = SERIES_TOGGLE_CYCLE[current] || "on";
      const tabActivity = getActiveTabActivity();
      if (!tabActivity) return;
      const focusActivity = state.activityLab.streamActivities.find(
        (a) => String(a.activity_id) === String(state.activityLab.focusActivityId || "")
      ) || tabActivity;
      renderActivityLabFocus(tabActivity, focusActivity);
    });
  });


  document.getElementById("select-all").addEventListener("click", () => {
    state.filtered.forEach((x) => state.selected.add(String(x.interval_id)));
    renderIntervals();
  });
  document.getElementById("clear-activities").addEventListener("click", () => {
    state.activities = [];
    state.activitiesFiltered = [];
    clearActivitiesCache();
    renderActivities();
    renderRaceAnalysisActivityOptions();
  });
  document.getElementById("apply-activities-filters").addEventListener("click", applyActivitiesFilters);
  document.getElementById("clear-activities-filters").addEventListener("click", () => {
    [
      "activities-filter-label",
      "activities-filter-date-from",
      "activities-filter-date-to",
      "activities-filter-time-from",
      "activities-filter-time-to",
      "activities-filter-distance-from",
      "activities-filter-distance-to",
    ].forEach((id) => {
      document.getElementById(id).value = "";
    });
    document.getElementById("activities-filter-source").value = "";
    document.getElementById("activities-filter-type").value = "";
    state.activitiesFiltered = [...state.activities];
    renderActivities();
  });

  const advancedToggle = document.getElementById("activities-advanced-toggle");
  const advancedFilters = document.getElementById("activities-advanced-filters");
  const timeFilters = document.getElementById("activities-time-filters");
  const distanceFilters = document.getElementById("activities-distance-filters");
  advancedToggle.addEventListener("click", () => {
    const expanded = advancedFilters.classList.toggle("hidden");
    timeFilters.classList.toggle("hidden", expanded);
    distanceFilters.classList.toggle("hidden", expanded);
    advancedToggle.setAttribute("aria-expanded", String(!expanded));
    advancedToggle.textContent = expanded ? "+" : "−";
  });

  document.addEventListener("click", (e) => {
    const intervalsAdvancedToggle = e.target.closest("#intervals-advanced-toggle");
    if (!intervalsAdvancedToggle) return;
    const intervalsAdvancedFilters = document.getElementById("intervals-advanced-filters");
    if (!intervalsAdvancedFilters) return;
    const showAdvanced = intervalsAdvancedFilters.classList.contains("hidden");
    intervalsAdvancedFilters.classList.toggle("hidden", !showAdvanced);
    intervalsAdvancedToggle.setAttribute("aria-expanded", String(showAdvanced));
    intervalsAdvancedToggle.textContent = showAdvanced ? "−" : "+";
  });

  document.getElementById("select-none").addEventListener("click", () => {
    state.selected.clear();
    renderIntervals();
  });
  document.getElementById("group-intervals").addEventListener("click", () => {
    state.intervalsGrouped = !state.intervalsGrouped;
    if (!state.intervalsGrouped) state.collapsedIntervalGroups.clear();
    renderIntervals();
  });

  document.getElementById("glucose-upload-input").addEventListener("change", handleGlucoseFileUpload);
  document.getElementById("apply-glucose-filters").addEventListener("click", applyGlucoseFilters);
  document.getElementById("clear-glucose-filters").addEventListener("click", () => {
    document.getElementById("glucose-filter-from").value = "";
    document.getElementById("glucose-filter-to").value = "";
    applyGlucoseFilters();
  });
  document.getElementById("clear-glucose").addEventListener("click", () => {
    state.glucose = [];
    clearGlucoseCache();
    state.openGlucoseTabs = [];
    state.activeGlucoseTabId = null;
    renderGlucoseTabBar();
    document.getElementById("glucose-upload-status").textContent = "";
    applyGlucoseFilters();
  });
  document.getElementById("glucose-prev-page").addEventListener("click", () => {
    state.glucosePage -= 1;
    renderGlucoseTable();
  });
  document.getElementById("glucose-next-page").addEventListener("click", () => {
    state.glucosePage += 1;
    renderGlucoseTable();
  });
  document.getElementById("glucose-view-chart").addEventListener("click", openGlucoseTab);
  document.getElementById("glucose-detail-back").addEventListener("click", () => setScreen("glucose"));
  document.getElementById("glucose-tab-bar").addEventListener("click", (e) => {
    const closeBtn = e.target.closest("[data-close-tab]");
    if (closeBtn) {
      e.stopPropagation();
      closeGlucoseTab(closeBtn.dataset.closeTab);
      return;
    }
    const tab = e.target.closest(".activity-tab");
    if (tab) openGlucoseDetail(tab.dataset.tabId);
  });

  document.getElementById("similarity-min-score").addEventListener("input", (e) => {
    document.getElementById("similarity-min-score-value").textContent = `${e.target.value}%`;
  });
  document.getElementById("similarity-type-select").addEventListener("sl-change", (e) => {
    state.similarity.type = e.target.value || SIMILARITY_DEFAULT_TYPE;
  });
  document.getElementById("similarity-query-select").addEventListener("sl-change", (e) => {
    state.similarity.queryActivityId = e.target.value;
  });
  document.getElementById("similarity-find").addEventListener("click", handleSimilarityFind);
  document.getElementById("similarity-results-body").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-similarity-open-id]");
    if (!btn) return;
    const activity = state.activities.find((a) => String(a.activity_id) === btn.dataset.similarityOpenId);
    if (activity) openActivityTab(activity);
  });

  document.getElementById("race-analyze-activity").addEventListener("click", handleRaceAnalyzeActivity);
  document.getElementById("race-activity-query").addEventListener("input", renderRaceAnalysisActivityOptions);
  document.getElementById("race-activity-results").addEventListener("click", handleRaceActivityResultClick);
  document.getElementById("race-analysis-tables").addEventListener("click", handleRaceTableFilterClick);
  document.getElementById("race-gpx-input").addEventListener("change", handleRaceGpxFileUpload);
  document.getElementById("race-download-json").addEventListener("click", downloadRaceAnalysisJson);
  initRaceAnalysisDropZone();

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
