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
  url.searchParams.set("scope", "read,activity:read_all,activity:write");
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

/** Upload an activity file (FIT/TCX/GPX) to Strava. Returns the raw upload
 *  object ({ id, status, activity_id, error }). Requires activity:write scope. */
async function stravaUploadActivity(fileBytes, fields, settings, token) {
  if (settings.apiMode === "proxy") {
    throw new Error("Strava upload isn't available in proxy mode. Switch API mode to direct/auto.");
  }
  const form = new FormData();
  form.append("file", new Blob([fileBytes], { type: "application/octet-stream" }),
    fields.filename || "activity.fit");
  form.append("data_type", fields.dataType || "fit");
  if (fields.name) form.append("name", fields.name);
  if (fields.description) form.append("description", fields.description);
  if (fields.externalId) form.append("external_id", fields.externalId);
  if (fields.trainer) form.append("trainer", "1");
  const res = await fetch("https://www.strava.com/api/v3/uploads", {
    method: "POST",
    headers: { Authorization: "Bearer " + token },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401) {
      throw new Error("Strava token missing scope activity:write. Reconnect Strava in Settings.");
    }
    throw new Error(data.message || data.error || `Strava upload failed (${res.status})`);
  }
  return data;
}

/** Poll GET /uploads/{id} until Strava finishes processing (activity_id set) or
 *  reports an error. */
async function stravaPollUpload(uploadId, settings, token, { attempts = 20, delayMs = 1500 } = {}) {
  for (let i = 0; i < attempts; i++) {
    const upload = await stravaGet(`/uploads/${encodeURIComponent(uploadId)}`, settings, token);
    if (upload.error) throw new Error(upload.error);
    if (upload.activity_id) return upload;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error("Strava upload still processing — check your Strava activities in a moment.");
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

async function saveIntervalsCache(intervals) {
  await idbSetValue(IDB_KV_STORE, INTERVALS_CACHE_KEY, intervals);
}

async function saveActivitiesCache(activities) {
  await idbSetValue(IDB_KV_STORE, ACTIVITIES_CACHE_KEY, activities);
}

async function loadActivitiesCache() {
  const parsed = await idbGetValue(IDB_KV_STORE, ACTIVITIES_CACHE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

async function loadIntervalsCache() {
  const parsed = await idbGetValue(IDB_KV_STORE, INTERVALS_CACHE_KEY, []);
  return Array.isArray(parsed) ? parsed : [];
}

async function clearIntervalsCache() {
  await idbDeleteValue(IDB_KV_STORE, INTERVALS_CACHE_KEY);
}

async function clearActivitiesCache() {
  await idbDeleteValue(IDB_KV_STORE, ACTIVITIES_CACHE_KEY);
}

