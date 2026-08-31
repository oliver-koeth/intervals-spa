/* ─── Minimal FIT activity encoder ─────────────────────────────────────────
 * Builds a Garmin FIT activity file in the browser from the activity streams
 * plus a synthesized altitude series, so an indoor treadmill / Stairmaster
 * workout can be re-uploaded to Strava with elevation. FIT (not GPX) is used
 * because it supports indoor records with no GPS — distance + altitude only. */

const FIT_EPOCH_OFFSET = 631065600; // Unix seconds at 1989-12-31T00:00:00Z.

/* FIT global message numbers. */
const FIT_MSG = { FILE_ID: 0, LAP: 19, RECORD: 20, SESSION: 18, ACTIVITY: 34, EVENT: 21 };

/* FIT base types (typeByte, size, invalid). */
const FIT_T = {
  enum:   { b: 0x00, size: 1, invalid: 0xFF },
  uint8:  { b: 0x02, size: 1, invalid: 0xFF },
  uint16: { b: 0x84, size: 2, invalid: 0xFFFF },
  uint32: { b: 0x86, size: 4, invalid: 0xFFFFFFFF },
  sint32: { b: 0x85, size: 4, invalid: 0x7FFFFFFF },
};

/* ── CRC-16 (FIT variant) ─────────────────────────────────────────────── */
const FIT_CRC_TABLE = [
  0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401,
  0xA001, 0x6C00, 0x7800, 0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
];
function fitCrc16(bytes) {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    let tmp = FIT_CRC_TABLE[crc & 0xF];
    crc = ((crc >> 4) & 0x0FFF) ^ tmp ^ FIT_CRC_TABLE[byte & 0xF];
    tmp = FIT_CRC_TABLE[crc & 0xF];
    crc = ((crc >> 4) & 0x0FFF) ^ tmp ^ FIT_CRC_TABLE[(byte >> 4) & 0xF];
  }
  return crc & 0xFFFF;
}

/* ── Byte writer ──────────────────────────────────────────────────────── */
function fitWriter() {
  const bytes = [];
  const api = {
    bytes,
    u8(v) { bytes.push(v & 0xFF); return api; },
    u16(v) { bytes.push(v & 0xFF, (v >>> 8) & 0xFF); return api; },
    u32(v) {
      bytes.push(v & 0xFF, (v >>> 8) & 0xFF, (v >>> 16) & 0xFF, (v >>> 24) & 0xFF);
      return api;
    },
    val(type, v) {
      const use = (v == null || Number.isNaN(v)) ? type.invalid : v;
      if (type.size === 1) return api.u8(use);
      if (type.size === 2) return api.u16(use);
      return api.u32(use >>> 0);
    },
  };
  return api;
}

/** Emit a definition message + a data message for one record layout.
 *  fields: [{ num, type, value }]. */
function fitEmitMessage(w, localType, globalNum, fields) {
  // Definition.
  w.u8(0x40 | localType).u8(0).u8(0).u16(globalNum).u8(fields.length);
  for (const f of fields) w.u8(f.num).u8(f.type.size).u8(f.type.b);
  // Data.
  w.u8(localType);
  for (const f of fields) w.val(f.type, f.value);
}

/* ── Value scaling helpers ────────────────────────────────────────────── */
function fitScale(value, scale, offset = 0) {
  if (value == null || Number.isNaN(value)) return null;
  return Math.round((value + offset) * scale);
}

const FIT_SEMICIRCLE = (2 ** 31) / 180; // degrees → FIT semicircles.
function fitLatLon(deg) {
  if (deg == null || Number.isNaN(deg)) return null;
  return Math.round(deg * FIT_SEMICIRCLE);
}

/* ── Public builder ───────────────────────────────────────────────────── */
/** Build a FIT activity file.
 *  stream: { time[], distance[], heartrate[], cadence[] }
 *  altitude: number[] (metres, one per sample)
 *  meta: { startUnixSec, sport, subSport, isRun, totalGain, route }
 *  meta.route: optional [{lat, lon}, ...] (one per sample) — a synthetic GPS
 *    track, e.g. for indoor activities uploaded as a "virtual" run so Strava
 *    renders a map + elevation profile.
 *  Returns a Uint8Array. */
function buildFitFile(stream, altitude, meta) {
  const time = Array.isArray(stream?.time) ? stream.time : [];
  const distance = Array.isArray(stream?.distance) ? stream.distance : [];
  const hr = Array.isArray(stream?.heartrate) ? stream.heartrate : [];
  const cadence = Array.isArray(stream?.cadence) ? stream.cadence : [];
  const n = time.length;
  if (!n) throw new Error("No stream samples to export.");

  const startUnix = Math.round(meta.startUnixSec);
  const startFit = startUnix - FIT_EPOCH_OFFSET;
  const t0 = Number(time[0]) || 0;
  const tEnd = Number(time[n - 1]) || 0;
  const startTs = startFit + t0;
  const endTs = startFit + tEnd;
  const elapsed = Math.max(0, tEnd - t0);
  const totalDistance = Number(distance[n - 1] || 0) - Number(distance[0] || 0);
  const sport = Number.isFinite(meta.sport) ? meta.sport : 0;
  const subSport = Number.isFinite(meta.subSport) ? meta.subSport : 0;
  const totalAscent = Math.max(0, Math.round(meta.totalGain || 0));

  const w = fitWriter();

  // 1. file_id (local 0).
  fitEmitMessage(w, 0, FIT_MSG.FILE_ID, [
    { num: 0, type: FIT_T.enum, value: 4 },        // type = activity
    { num: 1, type: FIT_T.uint16, value: 255 },    // manufacturer = development
    { num: 2, type: FIT_T.uint16, value: 0 },      // product
    { num: 4, type: FIT_T.uint32, value: startFit }, // time_created
    { num: 3, type: FIT_T.uint32, value: startUnix >>> 0 }, // serial_number
  ]);

  // 2. event (local 5) — timer start.
  fitEmitMessage(w, 5, FIT_MSG.EVENT, [
    { num: 253, type: FIT_T.uint32, value: startTs }, // timestamp
    { num: 0, type: FIT_T.enum, value: 0 },           // event = timer
    { num: 1, type: FIT_T.enum, value: 0 },           // event_type = start
  ]);

  // 3. record (local 1) — definition emitted once, reused for each sample.
  const route = Array.isArray(meta.route) && meta.route.length === n ? meta.route : null;
  const recFields = [
    { num: 253, type: FIT_T.uint32 }, // timestamp
    { num: 5, type: FIT_T.uint32 },   // distance (scale 100)
    { num: 2, type: FIT_T.uint16 },   // altitude (scale 5, offset 500)
    { num: 3, type: FIT_T.uint8 },    // heart_rate
    { num: 4, type: FIT_T.uint8 },    // cadence
  ];
  if (route) {
    recFields.push({ num: 0, type: FIT_T.sint32 }); // position_lat
    recFields.push({ num: 1, type: FIT_T.sint32 }); // position_long
  }
  // Definition for record.
  w.u8(0x40 | 1).u8(0).u8(0).u16(FIT_MSG.RECORD).u8(recFields.length);
  for (const f of recFields) w.u8(f.num).u8(f.type.size).u8(f.type.b);
  // Data messages.
  for (let i = 0; i < n; i++) {
    const ts = startFit + (Number(time[i]) || 0);
    const dist = fitScale(Number(distance[i]), 100);
    const alt = fitScale(Number(altitude[i]), 5, 500);
    const hrV = Number(hr[i]);
    const cadV = Number(cadence[i]);
    // Running cadence in FIT is per-leg RPM (≈ steps/min ÷ 2).
    const cadOut = Number.isFinite(cadV) && cadV > 0
      ? (meta.isRun ? Math.round(cadV / 2) : Math.round(cadV))
      : null;
    w.u8(1);
    w.val(FIT_T.uint32, ts);
    w.val(FIT_T.uint32, dist == null ? null : dist >>> 0);
    w.val(FIT_T.uint16, alt);
    w.val(FIT_T.uint8, Number.isFinite(hrV) && hrV > 0 ? Math.round(hrV) : null);
    w.val(FIT_T.uint8, cadOut != null && cadOut <= 254 ? cadOut : null);
    if (route) {
      w.val(FIT_T.sint32, fitLatLon(route[i]?.lat));
      w.val(FIT_T.sint32, fitLatLon(route[i]?.lon));
    }
  }

  // 4. event (local 5) — timer stop.
  fitEmitMessage(w, 5, FIT_MSG.EVENT, [
    { num: 253, type: FIT_T.uint32, value: endTs },
    { num: 0, type: FIT_T.enum, value: 0 },   // event = timer
    { num: 1, type: FIT_T.enum, value: 4 },   // event_type = stop_all
  ]);

  // 5. lap (local 2).
  fitEmitMessage(w, 2, FIT_MSG.LAP, [
    { num: 254, type: FIT_T.uint16, value: 0 },                        // message_index
    { num: 253, type: FIT_T.uint32, value: endTs },                    // timestamp
    { num: 2, type: FIT_T.uint32, value: startTs },                    // start_time
    { num: 7, type: FIT_T.uint32, value: fitScale(elapsed, 1000) },    // total_elapsed_time
    { num: 8, type: FIT_T.uint32, value: fitScale(elapsed, 1000) },    // total_timer_time
    { num: 9, type: FIT_T.uint32, value: fitScale(totalDistance, 100) }, // total_distance
    { num: 21, type: FIT_T.uint16, value: totalAscent },               // total_ascent
  ]);

  // 6. session (local 3).
  fitEmitMessage(w, 3, FIT_MSG.SESSION, [
    { num: 254, type: FIT_T.uint16, value: 0 },                        // message_index
    { num: 253, type: FIT_T.uint32, value: endTs },                    // timestamp
    { num: 2, type: FIT_T.uint32, value: startTs },                    // start_time
    { num: 7, type: FIT_T.uint32, value: fitScale(elapsed, 1000) },    // total_elapsed_time
    { num: 8, type: FIT_T.uint32, value: fitScale(elapsed, 1000) },    // total_timer_time
    { num: 9, type: FIT_T.uint32, value: fitScale(totalDistance, 100) }, // total_distance
    { num: 22, type: FIT_T.uint16, value: totalAscent },               // total_ascent
    { num: 5, type: FIT_T.enum, value: sport },                        // sport
    { num: 6, type: FIT_T.enum, value: subSport },                     // sub_sport
    { num: 25, type: FIT_T.uint16, value: 0 },                         // first_lap_index
    { num: 26, type: FIT_T.uint16, value: 1 },                         // num_laps
  ]);

  // 7. activity (local 4).
  fitEmitMessage(w, 4, FIT_MSG.ACTIVITY, [
    { num: 253, type: FIT_T.uint32, value: endTs },                    // timestamp
    { num: 0, type: FIT_T.uint32, value: fitScale(elapsed, 1000) },    // total_timer_time
    { num: 1, type: FIT_T.uint16, value: 1 },                          // num_sessions
    { num: 2, type: FIT_T.enum, value: 0 },                            // type = manual
    { num: 3, type: FIT_T.enum, value: 26 },                           // event = activity
    { num: 4, type: FIT_T.enum, value: 1 },                            // event_type = stop
    { num: 5, type: FIT_T.uint32, value: startFit },                   // local_timestamp
  ]);

  // Assemble: header (14) + data + CRC.
  const data = w.bytes;
  const header = [];
  const hw = { push: (b) => header.push(b & 0xFF) };
  header.push(14);          // header size
  header.push(0x20);        // protocol version 2.0
  header.push(0x64, 0x08);  // profile version 2148 (LE)
  const dataLen = data.length;
  header.push(dataLen & 0xFF, (dataLen >>> 8) & 0xFF, (dataLen >>> 16) & 0xFF, (dataLen >>> 24) & 0xFF);
  header.push(0x2E, 0x46, 0x49, 0x54); // ".FIT"
  const headerCrc = fitCrc16(header);
  header.push(headerCrc & 0xFF, (headerCrc >>> 8) & 0xFF);

  const full = header.concat(data);
  const fileCrc = fitCrc16(full);
  full.push(fileCrc & 0xFF, (fileCrc >>> 8) & 0xFF);

  return Uint8Array.from(full);
}

/* Node test harness hook (ignored in the browser). */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildFitFile, fitCrc16, FIT_EPOCH_OFFSET };
}
