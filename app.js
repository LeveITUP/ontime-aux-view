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

const AUX_KEYS = getSelectedAuxKeys();

/**
 * Read display options from query params.
 *   ?transparent          -> transparent background (for vMix / OBS overlays)
 *   ?color=<css colour>   -> main colour of the ring and digits (default white)
 *   ?warn=<seconds>       -> turn red when a count-down has this many seconds left
 *   ?warncolor=<css col>  -> colour to use for the warning (default red)
 *   ?seconds              -> show a plain seconds count (90) instead of M:SS (1:30)
 */
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
    color: p.get("color"),
    warnColor: p.get("warncolor"),
    warnSeconds,
    noticeColor: p.get("noticecolor"),
    noticeSeconds,
    offsetSeconds,
    fontSize: p.get("fontsize"),
    stroke: p.get("stroke"),
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

const config = getConfig();

function applyConfig(cfg) {
  const root = document.documentElement;
  if (cfg.color) root.style.setProperty("--color", cfg.color);
  if (cfg.warnColor) root.style.setProperty("--warn-color", cfg.warnColor);
  if (cfg.noticeColor) root.style.setProperty("--notice-color", cfg.noticeColor);
  if (cfg.fontSize) root.style.setProperty("--time-size", withUnit(cfg.fontSize));
  if (cfg.stroke) root.style.setProperty("--ring-width", cfg.stroke);
  if (cfg.transparent) document.body.classList.add("transparent");
  if (!cfg.showLabels) document.body.classList.add("no-labels");
}

// Bare numbers are treated as pixels; anything else is passed through as-is.
function withUnit(value) {
  return /^\d+(\.\d+)?$/.test(value) ? `${value}px` : value;
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
const cards = {};

for (const key of AUX_KEYS) {
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
  const sample = cards[AUX_KEYS[0]] && cards[AUX_KEYS[0]].time;
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

function setStatus(state, text) {
  statusEl.className = `status status--${state}`;
  statusLabel.textContent = text;
}

/**
 * Apply an Ontime payload. The payload may contain any subset of the runtime
 * state; we only care about the aux timer objects.
 */
function handleOntimePayload(payload) {
  if (!payload || typeof payload !== "object") return;
  for (const key of AUX_KEYS) {
    if (key in payload) {
      renderAux(key, payload[key]);
    }
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
    for (const key of AUX_KEYS) {
      const t = demo[key];
      if (t.playback !== "play") continue;
      t.current += t.direction === "count-up" ? 1000 : -1000;
      if (t.direction === "count-up" && t.current > t.duration) t.current = 0;
      if (t.direction === "count-down" && t.current < 0) t.current = t.duration;
    }
    handleOntimePayload(demo);
  }, 1000);
}

if (new URLSearchParams(window.location.search).has("demo")) {
  startDemo();
} else {
  connect();
}
