const STORAGE_KEY = "immich-screensaver-settings";

const MODES = [
  {
    id: "classic",
    label: "Classic",
    desc: "A traditional slideshow — one photo at a time with gentle crossfades.",
  },
  {
    id: "ken-burns",
    label: "Ken Burns",
    desc: "Slow pan and zoom across each photo for a cinematic look.",
  },
  {
    id: "origami",
    label: "Origami",
    desc: "Photos unfold into view with a folded-paper style entrance.",
  },
  {
    id: "reflections",
    label: "Reflections",
    desc: "Photos sit above a soft mirrored reflection, like a glossy surface.",
  },
  {
    id: "sliding-panels",
    label: "Photo collage",
    desc: "A bento-style grid of random-sized tiles; the layout reshuffles on each interval.",
  },
  {
    id: "scrapbook",
    label: "Scrapbook",
    desc: "Photos look taped onto a page with a warm paper frame.",
  },
  {
    id: "holiday-mobile",
    label: "Holiday mobile",
    desc: "A gentle sway, as if photos hung from a slowly turning mobile.",
  },
  {
    id: "vintage",
    label: "Vintage prints",
    desc: "White borders and a subtle sepia tone, like old snapshots.",
  },
];

const KB_CLASSES = ["kb-a", "kb-b", "kb-c", "kb-d"];

const layerA = document.getElementById("layer-a");
const layerB = document.getElementById("layer-b");
const stackMode = document.getElementById("stack-mode");
const collageMode = document.getElementById("collage-mode");
const bentoGrid = document.getElementById("bento-grid");
const stage = document.getElementById("stage");
const btnFs = document.getElementById("btn-fullscreen");
const btnExitImmersive = document.getElementById("btn-exit-immersive");
const btnSettings = document.getElementById("btn-settings");
const statusEl = document.getElementById("status");
const photoInfoEl = document.getElementById("photo-info");
const settingsBackdrop = document.getElementById("settings-backdrop");
const settingsDialog = document.getElementById("settings-dialog");
const btnSettingsClose = document.getElementById("btn-settings-close");
const settingMode = document.getElementById("setting-mode");
const settingInterval = document.getElementById("setting-interval");
const settingIntervalValue = document.getElementById("setting-interval-value");
const settingShowInfo = document.getElementById("setting-show-info");
const modeDesc = document.getElementById("mode-desc");
const settingsVersionEl = document.getElementById("settings-version");

let activeLayer = layerA;
let idleLayer = layerB;
let slideIntervalMs = 30000;
let tickTimer = null;
/** Avoid resetting stage classes every tick — that restarted CSS animations and caused visible “jumps”. */
let appliedStageMode = null;

const settings = {
  mode: "classic",
  intervalSec: 30,
  showInfo: true,
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.intervalSec === "number") settings.intervalSec = parsed.intervalSec;
      if (typeof parsed.mode === "string") settings.mode = parsed.mode;
      if (typeof parsed.showInfo === "boolean") settings.showInfo = parsed.showInfo;
    }
  } catch {
    /* ignore */
  }
}

function saveSettings() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      version: 1,
      mode: settings.mode,
      intervalSec: settings.intervalSec,
      showInfo: settings.showInfo,
    })
  );
}

function applyIntervalToCss() {
  const sec = Math.max(5, settings.intervalSec);
  slideIntervalMs = sec * 1000;
  document.documentElement.style.setProperty("--slide-duration", `${sec}s`);
}

function pickAsset(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload[0] || null;
  if (Array.isArray(payload.assets)) return payload.assets[0] || null;
  if (payload.id) return payload;
  return null;
}

function formatDate(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

function personName(p) {
  if (!p || typeof p !== "object") return "";
  return p.name || p.person?.name || "";
}

/** Build overlay lines from Immich asset JSON */
function extractPhotoInfo(asset) {
  const lines = [];
  if (!asset || typeof asset !== "object") return lines;

  const exif = asset.exifInfo || {};

  const placeParts = [exif.city, exif.state, exif.country].filter(
    (x) => typeof x === "string" && x.trim()
  );
  if (placeParts.length) {
    lines.push({ label: "Place", text: placeParts.join(", ") });
  } else if (
    typeof exif.description === "string" &&
    exif.description.trim() &&
    !exif.description.includes("http")
  ) {
    lines.push({ label: "Description", text: exif.description.trim() });
  }

  if (
    !placeParts.length &&
    typeof exif.latitude === "number" &&
    typeof exif.longitude === "number"
  ) {
    lines.push({
      label: "Location",
      text: `${exif.latitude.toFixed(4)}, ${exif.longitude.toFixed(4)}`,
    });
  }

  const people = asset.people;
  if (Array.isArray(people) && people.length) {
    const names = people.map(personName).filter(Boolean);
    if (names.length) lines.push({ label: "People", text: names.join(", ") });
  }

  if (typeof exif.description === "string" && exif.description.trim() && placeParts.length) {
    lines.push({ label: "Caption", text: exif.description.trim() });
  }

  const dateRaw =
    exif.dateTimeOriginal ||
    asset.fileCreatedAt ||
    asset.localDateTime ||
    asset.createdAt;
  if (dateRaw) lines.push({ label: "Date", text: formatDate(dateRaw) });

  if (Array.isArray(asset.tags) && asset.tags.length) {
    const tagLabels = asset.tags
      .map((t) => (typeof t === "string" ? t : t.name || t.value))
      .filter(Boolean);
    if (tagLabels.length) lines.push({ label: "Tags", text: tagLabels.join(", ") });
  }

  return lines;
}

function renderPhotoInfo(asset) {
  if (!settings.showInfo) {
    photoInfoEl.hidden = true;
    photoInfoEl.innerHTML = "";
    return;
  }
  const lines = extractPhotoInfo(asset);
  if (!lines.length) {
    photoInfoEl.hidden = true;
    photoInfoEl.innerHTML = "";
    return;
  }
  photoInfoEl.hidden = false;
  photoInfoEl.innerHTML = lines
    .map(
      (l) =>
        `<div class="photo-info__line"><span class="photo-info__label">${escapeHtml(
          l.label
        )}</span><span class="photo-info__text">${escapeHtml(l.text)}</span></div>`
    )
    .join("");
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

async function loadServerDefaults() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (!r.ok) return;
    const cfg = await r.json();
    const hasLocal = localStorage.getItem(STORAGE_KEY);
    if (!hasLocal && typeof cfg.slideIntervalMs === "number" && cfg.slideIntervalMs >= 5000) {
      settings.intervalSec = Math.round(cfg.slideIntervalMs / 1000);
    }
    if (settingsVersionEl && typeof cfg.appVersion === "string") {
      settingsVersionEl.textContent = `Version ${cfg.appVersion}`;
    }
  } catch {
    /* ignore */
  }
}

async function fetchRandomAssets(count) {
  const r = await fetch(`/api/screensaver/random?count=${count}`, { cache: "no-store" });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `HTTP ${r.status}`);
  const data = JSON.parse(text);
  if (Array.isArray(data)) return data.filter((a) => a?.id);
  if (Array.isArray(data.assets)) return data.assets.filter((a) => a?.id);
  const one = pickAsset(data);
  return one ? [one] : [];
}

function getMainImg(layerEl) {
  return layerEl.querySelector(".slide-main .photo");
}

function getReflectImg(layerEl) {
  return layerEl.querySelector(".slide-reflection .photo--reflect");
}

function setLayerImageSources(layerEl, path) {
  const main = getMainImg(layerEl);
  const ref = getReflectImg(layerEl);
  if (main) main.src = path;
  if (ref) ref.src = path;
}

function randomKbClass() {
  return KB_CLASSES[Math.floor(Math.random() * KB_CLASSES.length)];
}

function swapStackLayers() {
  const t = activeLayer;
  activeLayer = idleLayer;
  idleLayer = t;
  activeLayer.classList.remove("slide-layer--hidden");
  idleLayer.classList.add("slide-layer--hidden");
}

function applyStageMode() {
  const m = settings.mode;
  if (appliedStageMode === m) return;
  appliedStageMode = m;

  stage.className = "stage";
  stage.classList.add(`mode-${m}`);

  const isCollage = m === "sliding-panels";
  stackMode.hidden = isCollage;
  collageMode.hidden = !isCollage;
}

function scheduleTick() {
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(() => {
    tick().catch((e) => setStatus(e?.message || String(e)));
  }, slideIntervalMs);
}

async function tickStack() {
  const assets = await fetchRandomAssets(1);
  const asset = assets[0];
  if (!asset?.id) throw new Error("No asset from Immich");

  if (settings.mode === "scrapbook") {
    const deg = (Math.random() * 6 - 3).toFixed(2);
    stage.style.setProperty("--scrap-rot", `${deg}deg`);
  }

  const url = `/api/screensaver/thumbnail/${encodeURIComponent(asset.id)}`;
  const img = getMainImg(idleLayer);

  KB_CLASSES.forEach((c) => idleLayer.classList.remove(c));
  if (settings.mode === "ken-burns") idleLayer.classList.add(randomKbClass());

  img.onload = () => {
    swapStackLayers();
    renderPhotoInfo(asset);
    setStatus("");
  };
  img.onerror = () => setStatus("Could not load image for this asset.");

  setLayerImageSources(idleLayer, url);
}

/** Random tiling partition: splits the rectangle until we have `targetPieces` cells (sizes change each tick). */
function randomPartition(cols, rows, targetPieces) {
  const rects = [{ c: 0, r: 0, w: cols, h: rows }];
  while (rects.length < targetPieces) {
    const idx = rects.findIndex((rect) => rect.w > 1 || rect.h > 1);
    if (idx === -1) break;
    const rect = rects[idx];
    const canH = rect.h >= 2;
    const canV = rect.w >= 2;
    let horizontal;
    if (canH && canV) horizontal = Math.random() < 0.5;
    else horizontal = canH;
    let a;
    let b;
    if (horizontal) {
      const split = 1 + Math.floor(Math.random() * (rect.h - 1));
      a = { c: rect.c, r: rect.r, w: rect.w, h: split };
      b = { c: rect.c, r: rect.r + split, w: rect.w, h: rect.h - split };
    } else {
      const split = 1 + Math.floor(Math.random() * (rect.w - 1));
      a = { c: rect.c, r: rect.r, w: split, h: rect.h };
      b = { c: rect.c + split, r: rect.r, w: rect.w - split, h: rect.h };
    }
    rects.splice(idx, 1, a, b);
  }
  return rects;
}

const BENTO_COLS = 12;
const BENTO_ROWS = 8;

async function tickCollage() {
  const targetPieces = 8 + Math.floor(Math.random() * 7);
  const blocks = randomPartition(BENTO_COLS, BENTO_ROWS, targetPieces);
  const n = blocks.length;

  let assets = await fetchRandomAssets(n);
  while (assets.length < n && assets.length > 0) {
    assets.push(assets[assets.length - 1]);
  }
  if (!assets.length) throw new Error("No assets for collage");

  bentoGrid.replaceChildren();
  bentoGrid.style.gridTemplateColumns = `repeat(${BENTO_COLS}, 1fr)`;
  bentoGrid.style.gridTemplateRows = `repeat(${BENTO_ROWS}, 1fr)`;

  let loaded = 0;
  const total = n;
  const infoAsset = assets[0];

  blocks.forEach((b, i) => {
    const asset = assets[i] || assets[0];
    const cell = document.createElement("div");
    cell.className = "bento-cell";
    cell.style.gridColumn = `${b.c + 1} / span ${b.w}`;
    cell.style.gridRow = `${b.r + 1} / span ${b.h}`;
    const img = document.createElement("img");
    img.className = "bento-img";
    img.alt = "";
    img.decoding = "async";
    img.onload = () => {
      img.classList.add("bento-img--loaded");
      loaded += 1;
      if (loaded === total) {
        renderPhotoInfo(infoAsset);
        setStatus("");
      }
    };
    img.onerror = () => setStatus("Could not load a collage image.");
    img.src = `/api/screensaver/thumbnail/${encodeURIComponent(asset.id)}`;
    cell.appendChild(img);
    bentoGrid.appendChild(cell);
  });
}

async function tick() {
  applyStageMode();
  if (settings.mode === "sliding-panels") await tickCollage();
  else await tickStack();
}

function populateSettingsForm() {
  settingMode.innerHTML = MODES.map(
    (m) => `<option value="${m.id}">${escapeHtml(m.label)}</option>`
  ).join("");
  settingMode.value = MODES.some((m) => m.id === settings.mode) ? settings.mode : "classic";
  settingInterval.value = String(settings.intervalSec);
  settingIntervalValue.textContent = `${settings.intervalSec}s`;
  settingShowInfo.checked = settings.showInfo;
  updateModeDesc();
}

function updateModeDesc() {
  const m = MODES.find((x) => x.id === settingMode.value);
  modeDesc.textContent = m?.desc || "";
}

async function openSettings() {
  populateSettingsForm();
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (r.ok && settingsVersionEl) {
      const cfg = await r.json();
      settingsVersionEl.textContent =
        typeof cfg.appVersion === "string" ? `Version ${cfg.appVersion}` : "";
    }
  } catch {
    /* keep previous label */
  }
  settingsBackdrop.hidden = false;
  settingsDialog.hidden = false;
  document.body.classList.add("settings-open");
  settingMode.focus();
}

function closeSettings() {
  settingsBackdrop.hidden = true;
  settingsDialog.hidden = true;
  document.body.classList.remove("settings-open");
  saveSettings();
  applyIntervalToCss();
  applyStageMode();
  scheduleTick();
  tick().catch((e) => setStatus(e?.message || String(e)));
}

function fullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement;
}

function exitMobileImmersive() {
  document.body.classList.remove("mobile-immersive");
}

function enterMobileImmersive() {
  document.body.classList.add("mobile-immersive");
}

function updateFullscreenChrome() {
  const fs = !!fullscreenElement();
  const immersive = document.body.classList.contains("mobile-immersive");
  document.body.classList.toggle("is-fullscreen", fs || immersive);
  if (fs || immersive) closeSettings();
}

document.addEventListener("fullscreenchange", updateFullscreenChrome);
document.addEventListener("webkitfullscreenchange", updateFullscreenChrome);

function requestFs() {
  if (document.body.classList.contains("mobile-immersive")) {
    exitMobileImmersive();
    updateFullscreenChrome();
    return;
  }
  const el = document.documentElement;
  if (fullscreenElement()) {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    exit?.call(document)?.catch(() => {});
    return;
  }
  const req = el.requestFullscreen || el.webkitRequestFullscreen;
  if (req) {
    Promise.resolve(req.call(el)).catch(() => {
      enterMobileImmersive();
      updateFullscreenChrome();
    });
  } else {
    enterMobileImmersive();
    updateFullscreenChrome();
  }
}

btnFs.addEventListener("click", requestFs);
btnExitImmersive.addEventListener("click", () => {
  exitMobileImmersive();
  updateFullscreenChrome();
});
btnSettings.addEventListener("click", openSettings);
btnSettingsClose.addEventListener("click", closeSettings);
settingsBackdrop.addEventListener("click", closeSettings);

settingMode.addEventListener("change", () => {
  settings.mode = settingMode.value;
  updateModeDesc();
  saveSettings();
});

settingInterval.addEventListener("input", () => {
  settings.intervalSec = Number(settingInterval.value);
  settingIntervalValue.textContent = `${settings.intervalSec}s`;
  saveSettings();
});

settingShowInfo.addEventListener("change", () => {
  settings.showInfo = settingShowInfo.checked;
  saveSettings();
});

function isTypingInField(target) {
  const tag = target?.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target?.isContentEditable) return true;
  return false;
}

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape" && !settingsDialog.hidden) {
    closeSettings();
    return;
  }
  if (ev.key === "Escape" && settingsDialog.hidden && document.body.classList.contains("mobile-immersive")) {
    exitMobileImmersive();
    updateFullscreenChrome();
    return;
  }
  if (ev.key === "f" || ev.key === "F") {
    if (!isTypingInField(ev.target)) requestFs();
    return;
  }
  if (ev.key === "s" || ev.key === "S") {
    if (isTypingInField(ev.target)) return;
    if (!settingsDialog.hidden) return;
    ev.preventDefault();
    openSettings();
  }
});

await loadServerDefaults();
loadSettings();
applyIntervalToCss();
appliedStageMode = null;
applyStageMode();
populateSettingsForm();
updateFullscreenChrome();

await tick().catch((e) => setStatus(e?.message || String(e)));
scheduleTick();
