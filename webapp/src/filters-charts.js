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

function resizeAll() {
  Object.values(state.charts).forEach((c) => c && c.resize());
  Object.values(state.activityLabCharts).forEach((c) => c && c.resize());
  Object.values(state.raceAnalysisCharts).forEach((c) => c && c.resize());
}

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
