/**
 * Ontime Aux Timers custom view
 *
 * Shows Aux1–Aux3 auxiliary timers, each with the time in the centre of a
 * circle. For count-down timers the circle fills clockwise as the timer
 * elapses towards zero. For count-up timers the ring is redundant and hidden,
 * leaving just the digits.
 *
 * Data is received over Ontime's WebSocket runtime stream.
 * See https://docs.getontime.no/features/custom-views/
 * and https://docs.getontime.no/api/data/runtime-data/
 */

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ALL_AUX_KEYS = ["auxtimer1", "auxtimer2", "auxtimer3"];
const AUX_LABELS = {
  auxtimer1: "Aux 1",
  auxtimer2: "Aux 2",
  auxtimer3: "Aux 3",
};

/**
 * Decide which aux timers to show, based on the `aux` query param.
 * Examples:
 *   (none)      -> all three
 *   ?aux=1      -> only Aux 1
 *   ?aux=2,3    -> Aux 2 and Aux 3
 * Accepts "1"/"aux1"/"auxtimer1" style values. Falls back to all if empty.
 */
function getSelectedAuxKeys() {
  const raw = new URLSearchParams(window.location.search).get("aux");
  if (!raw) return ALL_AUX_KEYS;

  const wanted = raw
    .split(",")
    .map((part) => {
      const digit = part.match(/[123]/);
      return digit ? `auxtimer${digit[0]}` : null;
    })
    .filter((key) => key && ALL_AUX_KEYS.includes(key));

  // Preserve canonical order and remove duplicates
  const unique = ALL_AUX_KEYS.filter((key) => wanted.includes(key));
  return unique.length > 0 ? unique : ALL_AUX_KEYS;
}

let selectedKeys = getSelectedAuxKeys();

/** Read all display options from the current URL query params. */
function getConfig() {
  const p = new URLSearchParams(window.location.search);
  const warnRaw = p.get("warn");
  const warnSeconds = warnRaw != null && Number.isFinite(Number(warnRaw)) && Number(warnRaw) >= 0
    ? Number(warnRaw)
    : null;

  const noticeRaw = p.get("notice");
  const noticeSeconds = noticeRaw != null && Number.isFinite(Number(noticeRaw)) && Number(noticeRaw) >= 0
    ? Number(noticeRaw)
    : null;

  // How many seconds early the ring should reach full. Defaults to 1 so the
  // ring completes as the display hits 0:00, rather than as it flips to -1.
  const offsetRaw = p.get("offset");
  const offsetSeconds = offsetRaw != null && Number.isFinite(Number(offsetRaw)) && Number(offsetRaw) >= 0
    ? Number(offsetRaw)
    : 1;

  return {
    transparent: p.has("transparent"),
    bg: p.get("bg"),
    color: p.get("color"),
    warnColor: p.get("warncolor"),
    warnSeconds,
    noticeColor: p.get("noticecolor"),
    noticeSeconds,
    offsetSeconds,
    fontSize: p.get("fontsize"),
    stroke: p.get("stroke"),
    fill: p.get("fill"),
    ringOutline: p.get("ringoutline"),
    ringOutlineWidth: p.get("ringoutlinewidth"),
    fontOutline: p.get("fontoutline"),
    fontOutlineWidth: p.get("fontoutlinewidth"),
    showLabels: parseToggle(p.get("labels"), true),
    stopAtZero: p.has("stopatzero"),
    flash: p.has("flash"),
    secondsFormat: p.has("seconds"),
    secondsLastMinute: p.has("lastminute"),
  };
}

// Parse an on/off style query value. Accepts off/false/no/0/hide -> false,
// on/true/yes/1/show -> true. Falls back to the provided default.
function parseToggle(raw, fallback) {
  if (raw == null) return fallback;
  const v = raw.trim().toLowerCase();
  if (["off", "false", "no", "0", "hide"].includes(v)) return false;
  if (["on", "true", "yes", "1", "show"].includes(v)) return true;
  return fallback;
}

let config = getConfig();

// Set a CSS variable when a value is provided, otherwise remove it so the
// stylesheet default applies again (used when clearing an option live).
function setVar(name, value) {
  const root = document.documentElement;
  if (value) root.style.setProperty(name, value);
  else root.style.removeProperty(name);
}

function applyConfig(cfg) {
  setVar("--bg", cfg.bg && normaliseColor(cfg.bg));
  setVar("--color", cfg.color && normaliseColor(cfg.color));
  setVar("--warn-color", cfg.warnColor && normaliseColor(cfg.warnColor));
  setVar("--notice-color", cfg.noticeColor && normaliseColor(cfg.noticeColor));
  setVar("--time-size", cfg.fontSize && withUnit(cfg.fontSize));
  setVar("--ring-width", cfg.stroke || null);
  setVar("--fill-color", cfg.fill && normaliseColor(cfg.fill));
  setVar("--ring-outline-color", cfg.ringOutline && normaliseColor(cfg.ringOutline));
  setVar("--ring-outline-width", cfg.ringOutlineWidth || null);
  setVar("--font-outline-color", cfg.fontOutline && normaliseColor(cfg.fontOutline));
  setVar("--font-outline-width", cfg.fontOutlineWidth && withUnit(cfg.fontOutlineWidth));
  document.body.classList.toggle("transparent", !!cfg.transparent);
  document.body.classList.toggle("no-labels", !cfg.showLabels);
}

// Bare numbers are treated as pixels; anything else is passed through as-is.
function withUnit(value) {
  return /^\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
}

// Allow hex colours to be passed without the leading "#" (which, unencoded in a
// URL, would start the fragment and be dropped). A bare 3/4/6/8-digit hex string
// gets a "#" prepended; named colours and rgb()/hsl() values pass through.
function normaliseColor(value) {
  if (/^[0-9a-fA-F]+$/.test(value) && [3, 4, 6, 8].includes(value.length)) {
    return `#${value}`;
  }
  return value;
}

applyConfig(config);

/**
 * Work out the WebSocket URL.
 *
 * When this page is served from Ontime's own `external/` folder the server is
 * the same host that delivered the page, so we can derive it from
 * `window.location`. Both can be overridden with query params, e.g.
 *   ?server=192.168.1.10:4001&token=abc123
 */
function getSocketUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");

  let host = params.get("server");
  let protocol;

  if (host) {
    // Explicit server override. Assume ws:// unless it already has a scheme.
    if (/^wss?:\/\//.test(host)) {
      return appendToken(host, token);
    }
    protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  } else {
    host = window.location.host;
    protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  }

  return appendToken(`${protocol}//${host}/ws`, token);
}

function appendToken(url, token) {
  if (!token) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}token=${encodeURIComponent(token)}`;
}

// ---------------------------------------------------------------------------
// Build the DOM
// ---------------------------------------------------------------------------

const stage = document.querySelector(".stage");
const template = document.getElementById("aux-card-template");

/** Map of aux key -> { root, time, label, progress } */
let cards = {};

/** (Re)build the timer cards for the currently selected keys. */
function buildCards() {
  stage.innerHTML = "";
  cards = {};
  for (const key of selectedKeys) {
    const fragment = template.content.cloneNode(true);
    const root = fragment.querySelector(".aux");
    const time = fragment.querySelector(".aux__time");
    const label = fragment.querySelector(".aux__label");
    const progress = fragment.querySelector(".ring__progress");

    label.textContent = AUX_LABELS[key];
    root.dataset.key = key;

    stage.appendChild(fragment);
    cards[key] = { root, time, label, progress };
  }
}

buildCards();

// ---------------------------------------------------------------------------
// Vertical centring correction
// ---------------------------------------------------------------------------

/**
 * Numerals don't sit in the vertical middle of their line box (fonts allocate
 * asymmetric space above/below the baseline). This measures the offset between
 * the glyph's optical centre and the line-box centre for the current font and
 * size, and exposes it as the --time-shift CSS variable so the digits land in
 * the true centre of the circle regardless of font, size or digit count.
 */
function alignDigits() {
  const sample = cards[selectedKeys[0]] && cards[selectedKeys[0]].time;
  if (!sample) return;

  const cs = getComputedStyle(sample);
  const font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;

  // Measure where the baseline sits inside a line-height:1 box.
  const probe = document.createElement("span");
  probe.style.cssText =
    "position:absolute;visibility:hidden;white-space:nowrap;" +
    `font:${font};line-height:1;`;
  probe.textContent = "8";
  const marker = document.createElement("span");
  marker.style.cssText = "display:inline-block;width:0;height:0;";
  probe.appendChild(marker);
  document.body.appendChild(probe);

  const probeRect = probe.getBoundingClientRect();
  const baselineY = marker.getBoundingClientRect().top;
  document.body.removeChild(probe);

  // Measure the glyph ink extents around the baseline.
  const ctx = document.createElement("canvas").getContext("2d");
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  const m = ctx.measureText("8");
  const glyphAscent = m.actualBoundingBoxAscent || 0;
  const glyphDescent = m.actualBoundingBoxDescent || 0;

  const glyphCentre = baselineY - (glyphAscent - glyphDescent) / 2;
  const boxCentre = probeRect.top + probeRect.height / 2;
  const shift = boxCentre - glyphCentre;

  document.documentElement.style.setProperty("--time-shift", `${shift.toFixed(2)}px`);
}

alignDigits();
// Re-measure when fonts finish loading or the viewport resizes (the default
// digit size is viewport-relative).
if (document.fonts && document.fonts.ready) document.fonts.ready.then(alignDigits);
window.addEventListener("resize", alignDigits);

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/**
 * Format milliseconds as a clock string.
 * When `secondsOnly` is set, shows a plain seconds count (e.g. 90).
 * Otherwise shows H:MM:SS when an hour or more, else M:SS.
 * Negative values (overtime on a count-down) are prefixed with "-".
 */
function formatTime(ms, secondsOnly = config.secondsFormat) {
  const negative = ms < 0;

  if (secondsOnly) {
    return (negative ? "-" : "") + String(Math.floor(Math.abs(ms) / 1000));
  }

  let totalSeconds = Math.floor(Math.abs(ms) / 1000);

  const hours = Math.floor(totalSeconds / 3600);
  totalSeconds -= hours * 3600;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds - minutes * 60;

  const pad = (n) => String(n).padStart(2, "0");

  const body =
    hours > 0
      ? `${hours}:${pad(minutes)}:${pad(seconds)}`
      : `${minutes}:${pad(seconds)}`;

  return (negative ? "-" : "") + body;
}

/**
 * Fraction (0..1) of the ring that should be filled for a count-down.
 * The ring starts empty at the full duration and reaches full when the timer
 * has `config.offsetSeconds` left, so it completes as the display reaches zero
 * (default offset 1s) rather than when the value crosses into negative.
 */
function computeProgress(aux) {
  const duration = Number(aux.duration) || 0;
  const current = Number(aux.current) || 0;
  if (duration <= 0) return 0;

  const offsetMs = config.offsetSeconds * 1000;
  // Effective span over which the ring travels from empty to full.
  const span = Math.max(1, duration - offsetMs);
  const fraction = (duration - current) / span; // elapsed portion, 0 at start
  return Math.min(1, Math.max(0, fraction));
}

function renderAux(key, aux) {
  const card = cards[key];
  if (!card || !aux) return;

  const isCountUp = aux.direction === "count-up";
  let current = Number(aux.current) || 0;

  // Optionally clamp a count-down so it stops at 0 instead of going negative.
  if (config.stopAtZero && !isCountUp && current < 0) current = 0;

  // Switch to a seconds-only display in the final minute of a count-down.
  const secondsOnly =
    config.secondsFormat ||
    (config.secondsLastMinute && !isCountUp && current < 60000);
  card.time.textContent = formatTime(current, secondsOnly);

  card.root.dataset.playback = aux.playback || "stop";
  card.root.dataset.direction = isCountUp ? "count-up" : "count-down";

  // Warning: only meaningful for a count-down nearing (or past) zero.
  const isWarning =
    !isCountUp &&
    config.warnSeconds != null &&
    current <= config.warnSeconds * 1000;
  card.root.classList.toggle("is-warning", isWarning);

  // Notice: an intermediate state before the warning kicks in.
  const isNotice =
    !isCountUp &&
    !isWarning &&
    config.noticeSeconds != null &&
    current <= config.noticeSeconds * 1000;
  card.root.classList.toggle("is-notice", isNotice);

  // Flash the digits during the warning period, if enabled.
  card.root.classList.toggle("is-flashing", isWarning && config.flash);

  // The progress ring only makes sense for a count-down. For a count-up it is
  // redundant, so leave it empty and just show white digits.
  const fraction = isCountUp ? 0 : computeProgress(aux);
  // stroke-dashoffset: 100 = empty, 0 = full (pathLength is normalised to 100)
  card.progress.style.strokeDashoffset = String(100 - fraction * 100);
}

// ---------------------------------------------------------------------------
// WebSocket handling
// ---------------------------------------------------------------------------

const statusEl = document.getElementById("status");
const statusLabel = statusEl.querySelector(".status__label");
let statusHideTimer = null;

// The pill is only meant to be visible when something is wrong. When connected
// (or in demo mode) it lingers a few seconds so the operator can confirm all is
// well, then fades out. While connecting or disconnected it stays visible.
function setStatus(state, text) {
  statusEl.className = `status status--${state}`;
  statusLabel.textContent = text;
  clearTimeout(statusHideTimer);
  if (state === "open") {
    statusHideTimer = setTimeout(() => statusEl.classList.add("status--hidden"), 4000);
  }
}

/**
 * Apply an Ontime payload. The payload may contain any subset of the runtime
 * state; we only care about the aux timer objects.
 */
const lastData = {};

function handleOntimePayload(payload) {
  if (!payload || typeof payload !== "object") return;
  for (const key of ALL_AUX_KEYS) {
    if (key in payload) {
      lastData[key] = payload[key];
      if (cards[key]) renderAux(key, payload[key]);
    }
  }
}

/** Re-render the currently shown timers from the last received data. */
function rerender() {
  for (const key of selectedKeys) {
    if (lastData[key]) renderAux(key, lastData[key]);
  }
}

let reconnectTimer = null;

function connect() {
  const url = getSocketUrl();
  setStatus("connecting", "Connecting…");

  let socket;
  try {
    socket = new WebSocket(url);
  } catch (err) {
    scheduleReconnect();
    return;
  }

  socket.onopen = () => setStatus("open", "Connected");

  socket.onmessage = (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }

    // Ontime v4 wraps messages as { tag, payload }:
    //   tag "runtime-data"  -> full state on connect
    //   tag "runtime-patch" -> incremental updates
    // Older builds use { type: "ontime" | "ontime-<field>", payload }.
    const { tag, type, payload } = message;

    if (tag === "runtime-data" || tag === "runtime-patch") {
      handleOntimePayload(payload);
    } else if (type === "ontime") {
      handleOntimePayload(payload);
    } else if (typeof type === "string" && type.startsWith("ontime-")) {
      const field = type.slice("ontime-".length);
      handleOntimePayload({ [field]: payload });
    }
  };

  socket.onclose = () => {
    setStatus("closed", "Disconnected");
    scheduleReconnect();
  };

  socket.onerror = () => {
    socket.close();
  };
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, 2000);
}

// ---------------------------------------------------------------------------
// Demo mode (?demo=1) — simulate aux timers locally without an Ontime server
// ---------------------------------------------------------------------------

function startDemo() {
  setStatus("open", "Demo mode");

  const demo = {
    auxtimer1: { duration: 300000, current: 300000, playback: "play", direction: "count-down" },
    auxtimer2: { duration: 600000, current: 0, playback: "play", direction: "count-up" },
    auxtimer3: { duration: 120000, current: 90000, playback: "pause", direction: "count-down" },
  };

  // Optional overrides (handy for demos / documentation screenshots):
  //   ?d1=8  ?d2=45  ?d3=12   set the current value (seconds) of each timer
  //   ?freeze                 hold the timers at their current value
  const params = new URLSearchParams(window.location.search);
  ["auxtimer1", "auxtimer2", "auxtimer3"].forEach((key, i) => {
    const raw = params.get(`d${i + 1}`);
    if (raw != null && Number.isFinite(Number(raw))) {
      demo[key].current = Number(raw) * 1000;
    }
  });
  const frozen = params.has("freeze");

  handleOntimePayload(demo);
  if (frozen) return;

  setInterval(() => {
    for (const key of ALL_AUX_KEYS) {
      const t = demo[key];
      if (t.playback !== "play") continue;
      t.current += t.direction === "count-up" ? 1000 : -1000;
      if (t.direction === "count-up" && t.current > t.duration) t.current = 0;
      if (t.direction === "count-down" && t.current < 0) t.current = t.duration;
    }
    handleOntimePayload(demo);
  }, 1000);
}

// ---------------------------------------------------------------------------
// Settings panel (View Parameters Editor)
// ---------------------------------------------------------------------------
// Settings live in the URL query (shareable, like Ontime's own views). The
// panel edits those params, updates the URL and re-applies everything live.

function arraysEqual(a, b) {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// Re-read config from the current URL and apply it live.
function applyFromUrl() {
  config = getConfig();
  applyConfig(config);
  const newKeys = getSelectedAuxKeys();
  if (!arraysEqual(newKeys, selectedKeys)) {
    selectedKeys = newKeys;
    buildCards();
  }
  alignDigits();
  rerender();
}

// Field definitions grouped for the form.
//   type: "text" | "number" | "flag" | "labels"
const SETTINGS_GROUPS = [
  {
    title: "Appearance",
    fields: [
      { param: "color", label: "Main colour", type: "text", placeholder: "white" },
      { param: "bg", label: "Background colour", type: "text", placeholder: "e.g. 00b140" },
      { param: "transparent", label: "Transparent background", type: "flag" },
      { param: "fill", label: "Circle fill", type: "text", placeholder: "e.g. 00000080" },
      { param: "fontsize", label: "Font size", type: "text", placeholder: "e.g. 120 or 6rem" },
      { param: "stroke", label: "Ring thickness", type: "text", placeholder: "12" },
      { param: "ringoutline", label: "Ring outline", type: "text", placeholder: "none" },
      { param: "ringoutlinewidth", label: "Ring outline width", type: "text", placeholder: "2" },
      { param: "fontoutline", label: "Font outline", type: "text", placeholder: "none" },
      { param: "fontoutlinewidth", label: "Font outline width", type: "text", placeholder: "2" },
      { param: "labels", label: "Show timer name", type: "labels" },
    ],
  },
  {
    title: "Countdown behaviour",
    fields: [
      { param: "notice", label: "Notice at (seconds)", type: "number", placeholder: "off" },
      { param: "noticecolor", label: "Notice colour", type: "text", placeholder: "orange" },
      { param: "warn", label: "Warning at (seconds)", type: "number", placeholder: "off" },
      { param: "warncolor", label: "Warning colour", type: "text", placeholder: "red" },
      { param: "flash", label: "Flash digits when warning", type: "flag" },
      { param: "stopatzero", label: "Stop at zero", type: "flag" },
      { param: "seconds", label: "Seconds-only display", type: "flag" },
      { param: "lastminute", label: "Seconds-only in last minute", type: "flag" },
      { param: "offset", label: "Ring fill offset (seconds)", type: "number", placeholder: "1" },
    ],
  },
  {
    title: "Connection",
    fields: [
      { param: "server", label: "Ontime server", type: "text", placeholder: "same as this page" },
      { param: "token", label: "Access token", type: "text", placeholder: "none" },
    ],
  },
];

// Corner-bracket icon for the fullscreen button; inward brackets when active.
function fullscreenIcon(active) {
  const pts = active
    ? ["176 80 176 176 80 176", "336 80 336 176 432 176", "80 336 176 336 176 432", "432 336 336 336 336 432"]
    : ["176 80 80 80 80 176", "336 80 432 80 432 176", "176 432 80 432 80 336", "336 432 432 432 432 336"];
  return (
    '<svg viewBox="0 0 512 512" aria-hidden="true">' +
    pts
      .map(
        (p) =>
          `<polyline points="${p}" fill="none" stroke="currentColor" ` +
          'stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/>'
      )
      .join("") +
    "</svg>"
  );
}

function initSettings() {
  const cog = document.createElement("button");
  cog.className = "settings-cog";
  cog.type = "button";
  cog.title = "View settings";
  cog.setAttribute("aria-label", "View settings");
  cog.innerHTML =
    '<svg viewBox="0 0 512 512" aria-hidden="true">' +
    '<path d="M262.29 192.31a64 64 0 1 0 57.4 57.4 64.13 64.13 0 0 0-57.4-57.4zM416.39 256a154.34 154.34 0 0 1-1.53 20.79l45.21 35.46a10.81 10.81 0 0 1 2.45 13.75l-42.77 74a10.81 10.81 0 0 1-13.14 4.59l-44.9-18.08a16.11 16.11 0 0 0-15.17 1.75A164.48 164.48 0 0 1 325 400.8a15.94 15.94 0 0 0-8.82 12.14l-6.73 47.89a11.08 11.08 0 0 1-10.68 9.17h-85.54a11.11 11.11 0 0 1-10.69-8.87l-6.72-47.82a16.07 16.07 0 0 0-9-12.22 155.3 155.3 0 0 1-21.46-12.57 16 16 0 0 0-15.11-1.71l-44.89 18.07a10.81 10.81 0 0 1-13.14-4.58l-42.77-74a10.8 10.8 0 0 1 2.45-13.75l38.21-30a16.05 16.05 0 0 0 6-14.08c-.36-4.17-.58-8.34-.58-12.5s.21-8.27.58-12.35a16 16 0 0 0-6.07-13.94l-38.19-30A10.81 10.81 0 0 1 49.48 186l42.77-74a10.81 10.81 0 0 1 13.14-4.59l44.9 18.08a16.11 16.11 0 0 0 15.17-1.75A164.48 164.48 0 0 1 187 111.2a15.94 15.94 0 0 0 8.82-12.14l6.73-47.89A11.08 11.08 0 0 1 213.23 42h85.54a11.11 11.11 0 0 1 10.69 8.87l6.72 47.82a16.07 16.07 0 0 0 9 12.22 155.3 155.3 0 0 1 21.46 12.57 16 16 0 0 0 15.11 1.71l44.89-18.07a10.81 10.81 0 0 1 13.14 4.58l42.77 74a10.8 10.8 0 0 1-2.45 13.75l-38.21 30a16.05 16.05 0 0 0-6 14.08c.36 4.16.58 8.32.58 12.49z" ' +
    'fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="32"/></svg>';

  // Fullscreen toggle button, styled like the cog and sitting just below it
  const fsBtn = document.createElement("button");
  fsBtn.className = "settings-cog settings-cog--fs";
  fsBtn.type = "button";

  const panel = document.createElement("aside");
  panel.className = "settings-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "View settings");

  const header = document.createElement("div");
  header.className = "settings-panel__header";
  header.innerHTML = "<h2>View settings</h2>";
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "settings-panel__close";
  closeBtn.title = "Close";
  closeBtn.textContent = "×";
  header.appendChild(closeBtn);
  panel.appendChild(header);

  const body = document.createElement("div");
  body.className = "settings-panel__body";
  panel.appendChild(body);

  const params = new URLSearchParams(window.location.search);

  // Which timers to show
  const auxGroup = document.createElement("fieldset");
  auxGroup.className = "settings-group";
  auxGroup.innerHTML = "<legend>Timers</legend>";
  const auxRow = document.createElement("div");
  auxRow.className = "settings-aux";
  const auxInputs = {};
  for (const n of [1, 2, 3]) {
    const wrap = document.createElement("label");
    wrap.className = "settings-check";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = selectedKeys.includes(`auxtimer${n}`);
    auxInputs[n] = cb;
    wrap.appendChild(cb);
    wrap.appendChild(document.createTextNode(` Aux ${n}`));
    auxRow.appendChild(wrap);
  }
  auxGroup.appendChild(auxRow);
  body.appendChild(auxGroup);

  const inputs = {};
  for (const group of SETTINGS_GROUPS) {
    const fs = document.createElement("fieldset");
    fs.className = "settings-group";
    const legend = document.createElement("legend");
    legend.textContent = group.title;
    fs.appendChild(legend);

    for (const field of group.fields) {
      const row = document.createElement("label");
      row.className = "settings-row";
      const span = document.createElement("span");
      span.className = "settings-row__label";
      span.textContent = field.label;

      let input;
      if (field.type === "flag") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = params.has(field.param);
        row.classList.add("settings-row--check");
      } else if (field.type === "labels") {
        input = document.createElement("input");
        input.type = "checkbox";
        input.checked = parseToggle(params.get("labels"), true);
        row.classList.add("settings-row--check");
      } else {
        input = document.createElement("input");
        input.type = field.type === "number" ? "number" : "text";
        input.value = params.get(field.param) || "";
        if (field.placeholder) input.placeholder = field.placeholder;
      }
      input.dataset.param = field.param;
      input.dataset.type = field.type;
      inputs[field.param] = input;

      row.appendChild(span);
      row.appendChild(input);
      fs.appendChild(row);
    }
    body.appendChild(fs);
  }

  // Footer actions
  const footer = document.createElement("div");
  footer.className = "settings-panel__footer";
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copy link";
  const resetBtn = document.createElement("button");
  resetBtn.type = "button";
  resetBtn.textContent = "Reset";
  footer.appendChild(copyBtn);
  footer.appendChild(resetBtn);

  const fsMenuBtn = document.createElement("button");
  fsMenuBtn.type = "button";
  fsMenuBtn.className = "settings-panel__fullscreen";
  fsMenuBtn.textContent = "Fullscreen";
  panel.appendChild(fsMenuBtn);
  panel.appendChild(footer);

  // Serialise the form back into the URL and apply it live.
  function commit() {
    const p = new URLSearchParams(window.location.search);
    const auxChecked = [1, 2, 3].filter((n) => auxInputs[n].checked);
    if (auxChecked.length === 0 || auxChecked.length === 3) p.delete("aux");
    else p.set("aux", auxChecked.join(","));

    for (const field of SETTINGS_GROUPS.flatMap((g) => g.fields)) {
      const input = inputs[field.param];
      if (field.type === "flag") {
        if (input.checked) p.set(field.param, "");
        else p.delete(field.param);
      } else if (field.type === "labels") {
        if (input.checked) p.delete("labels");
        else p.set("labels", "off");
      } else {
        const v = input.value.trim();
        if (v) p.set(field.param, v);
        else p.delete(field.param);
      }
    }

    const qs = p.toString();
    history.replaceState(null, "", location.pathname + (qs ? `?${qs}` : "") + location.hash);
    applyFromUrl();
  }

  panel.addEventListener("input", commit);
  panel.addEventListener("change", commit);

  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
    } catch {
      copyBtn.textContent = "Copy failed";
      setTimeout(() => (copyBtn.textContent = "Copy link"), 1500);
    }
  });
  resetBtn.addEventListener("click", () => {
    history.replaceState(null, "", location.pathname);
    location.reload();
  });

  // Open / close + auto-hiding UI
  let panelOpen = false;
  let idleTimer = null;
  function resetIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (!panelOpen) document.body.classList.remove("ui-active");
    }, 3000);
  }
  function showUi() {
    document.body.classList.add("ui-active");
    resetIdle();
  }
  function openPanel() {
    panelOpen = true;
    document.body.classList.add("panel-open", "ui-active");
    clearTimeout(idleTimer);
  }
  function closePanel() {
    panelOpen = false;
    document.body.classList.remove("panel-open");
    resetIdle();
  }

  // Fullscreen toggle (floating button + menu entry stay in sync)
  function updateFullscreenUi() {
    const active = !!document.fullscreenElement;
    fsBtn.innerHTML = fullscreenIcon(active);
    const label = active ? "Exit fullscreen" : "Fullscreen";
    fsBtn.title = label;
    fsBtn.setAttribute("aria-label", label);
    fsMenuBtn.textContent = label;
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else document.documentElement.requestFullscreen().catch(() => {});
  }
  fsBtn.addEventListener("click", toggleFullscreen);
  fsMenuBtn.addEventListener("click", toggleFullscreen);
  document.addEventListener("fullscreenchange", updateFullscreenUi);
  updateFullscreenUi();

  cog.addEventListener("click", () => (panelOpen ? closePanel() : openPanel()));
  closeBtn.addEventListener("click", closePanel);
  document.addEventListener("mousemove", showUi);
  document.addEventListener("mousedown", showUi);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && panelOpen) closePanel();
  });

  document.body.appendChild(cog);
  document.body.appendChild(fsBtn);
  document.body.appendChild(panel);
  resetIdle();
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

if (new URLSearchParams(window.location.search).has("demo")) {
  startDemo();
} else {
  connect();
}

initSettings();
