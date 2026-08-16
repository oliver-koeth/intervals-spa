/* ─── Glucose ────────────────────────────────────────────────────────────── */
function saveGlucoseCache(records) {
  localStorage.setItem(GLUCOSE_CACHE_KEY, JSON.stringify(records));
}

function loadGlucoseCache() {
  try {
    const raw = localStorage.getItem(GLUCOSE_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function clearGlucoseCache() {
  localStorage.removeItem(GLUCOSE_CACHE_KEY);
}

/** Parses a single CSV line into fields, honoring double-quoted values (incl. embedded commas/quotes). */
function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Parses a "DD-MM-YYYY HH:MM" device timestamp into a sortable/dedup key plus date/time parts. */
function parseGlucoseDeviceTimestamp(raw) {
  const m = /^(\d{2})-(\d{2})-(\d{4})\s+(\d{2}):(\d{2})$/.exec(String(raw || "").trim());
  if (!m) return null;
  const [, dd, mm, yyyy, HH, MM] = m;
  return {
    key: `${yyyy}-${mm}-${dd} ${HH}:${MM}`,
    date: `${yyyy}-${mm}-${dd}`,
    time: `${HH}:${MM}`,
  };
}

/** Parses a LibreView-style glucose export (CSV/TXT) into {key, date, time, value, type} rows. */
function parseGlucoseCsv(text) {
  const lines = String(text || "")
    .split(/\r\n|\n|\r/)
    .filter((line) => line.trim().length > 0);

  let headerIdx = -1;
  let columns = null;
  for (let i = 0; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.includes("Device Timestamp") && fields.includes("Record Type")) {
      headerIdx = i;
      columns = fields;
      break;
    }
  }
  if (headerIdx === -1) {
    throw new Error("Unrecognized file — no 'Device Timestamp' / 'Record Type' header row found.");
  }

  const idxTimestamp = columns.indexOf("Device Timestamp");
  const idxHistoric = columns.indexOf("Historic Glucose mg/dL");
  const idxScan = columns.indexOf("Scan Glucose mg/dL");

  const records = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const fields = parseCsvLine(lines[i]);
    if (fields.length <= idxTimestamp) continue;
    const parsedTs = parseGlucoseDeviceTimestamp(fields[idxTimestamp]);
    if (!parsedTs) continue;

    const historicRaw = idxHistoric >= 0 ? String(fields[idxHistoric] || "").trim() : "";
    const scanRaw = idxScan >= 0 ? String(fields[idxScan] || "").trim() : "";
    let value = null;
    let type = null;
    if (historicRaw !== "") {
      value = Number(historicRaw);
      type = "historic";
    } else if (scanRaw !== "") {
      value = Number(scanRaw);
      type = "scan";
    }
    if (value === null || !Number.isFinite(value)) continue;

    records.push({ key: parsedTs.key, date: parsedTs.date, time: parsedTs.time, value, type });
  }
  return records;
}

/** Merges incoming glucose records into existing ones, overwriting entries with a matching timestamp key. */
function mergeGlucoseRecords(existing, incoming) {
  const map = new Map(existing.map((r) => [r.key, r]));
  let added = 0;
  let updated = 0;
  incoming.forEach((rec) => {
    if (map.has(rec.key)) updated++;
    else added++;
    map.set(rec.key, rec);
  });
  return { merged: Array.from(map.values()), added, updated };
}

/** Returns true if a "YYYY-MM-DD HH:MM" key falls within an optional [from, to] date range (inclusive, whole days). */
function isGlucoseKeyInRange(key, from, to) {
  if (from && key < `${from} 00:00`) return false;
  if (to && key > `${to} 23:59`) return false;
  return true;
}

function applyGlucoseFilters() {
  const from = document.getElementById("glucose-filter-from").value;
  const to = document.getElementById("glucose-filter-to").value;
  state.glucoseFiltered = state.glucose
    .filter((item) => isGlucoseKeyInRange(item.key, from, to))
    .sort((a, b) => b.key.localeCompare(a.key));
  state.glucosePage = 1;
  renderGlucoseTable();
}

function renderGlucoseTable() {
  const body = document.getElementById("glucose-body");
  const total = state.glucoseFiltered.length;
  const totalPages = Math.max(1, Math.ceil(total / GLUCOSE_PAGE_SIZE));
  state.glucosePage = Math.min(Math.max(1, state.glucosePage), totalPages);

  const startIdx = (state.glucosePage - 1) * GLUCOSE_PAGE_SIZE;
  const pageItems = state.glucoseFiltered.slice(startIdx, startIdx + GLUCOSE_PAGE_SIZE);

  body.innerHTML = "";
  pageItems.forEach((item) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.date}</td>
      <td>${item.time}</td>
      <td class="right">${item.value}</td>
      <td>${item.type === "scan" ? "Scan" : "Historic"}</td>
    `;
    body.appendChild(tr);
  });

  document.getElementById("glucose-summary").textContent =
    total === 0 ? "No glucose readings." : `${total} readings`;

  const rangeStart = total === 0 ? 0 : startIdx + 1;
  const rangeEnd = Math.min(total, startIdx + GLUCOSE_PAGE_SIZE);
  document.getElementById("glucose-page-info").textContent =
    total === 0 ? "" : `${rangeStart}–${rangeEnd} of ${total} · Page ${state.glucosePage} of ${totalPages}`;
  document.getElementById("glucose-prev-page").disabled = state.glucosePage <= 1;
  document.getElementById("glucose-next-page").disabled = state.glucosePage >= totalPages;
}

function handleGlucoseFileUpload(event) {
  const input = event.target;
  const file = input.files && input.files[0];
  const statusEl = document.getElementById("glucose-upload-status");
  if (!file) return;

  statusEl.textContent = "Reading file…";
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = parseGlucoseCsv(String(reader.result || ""));
      if (parsed.length === 0) {
        statusEl.textContent = `No glucose readings found in "${file.name}".`;
        return;
      }
      const { merged, added, updated } = mergeGlucoseRecords(state.glucose, parsed);
      state.glucose = merged;
      saveGlucoseCache(merged);
      applyGlucoseFilters();
      statusEl.textContent =
        `Imported ${parsed.length} readings from "${file.name}" — ${added} added, ${updated} updated ` +
        `(${merged.length} stored total).`;
    } catch (err) {
      statusEl.textContent = `Import failed: ${err.message || err}`;
    } finally {
      input.value = "";
    }
  };
  reader.onerror = () => {
    statusEl.textContent = "Could not read the selected file.";
    input.value = "";
  };
  reader.readAsText(file);
}

