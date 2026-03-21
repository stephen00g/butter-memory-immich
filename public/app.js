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
    label: "Sliding panels",
    desc: "tvOS-style: five tall columns, each photo drifting slowly on its own (parallax collage).",
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
const panelsMode = document.getElementById("panels-mode");
const stage = document.getElementById("stage");
const btnFs = document.getElementById("btn-fullscreen");
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

  const isPanels = m === "sliding-panels";
  stackMode.hidden = isPanels;
  panelsMode.hidden = !isPanels;
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

async function tickPanels() {
  let assets = await fetchRandomAssets(5);
  while (assets.length < 5 && assets.length > 0) {
    assets.push(assets[assets.length - 1]);
  }
  const imgs = panelsMode.querySelectorAll(".panel-img");
  let loaded = 0;
  const total = Math.min(assets.length, imgs.length);
  if (!total) throw new Error("No assets for panels");

  for (let i = 0; i < total; i++) {
    const a = assets[i];
    const el = imgs[i];
    el.classList.add("panel-img--loading");
    el.onload = () => {
      el.classList.remove("panel-img--loading");
      loaded += 1;
      if (loaded === total) {
        renderPhotoInfo(assets[0]);
        setStatus("");
      }
    };
    el.onerror = () => {
      el.classList.remove("panel-img--loading");
      setStatus("Could not load a panel image.");
    };
    el.src = `/api/screensaver/thumbnail/${encodeURIComponent(a.id)}`;
  }
}

async function tick() {
  applyStageMode();
  if (settings.mode === "sliding-panels") await tickPanels();
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

function openSettings() {
  populateSettingsForm();
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

function updateFullscreenChrome() {
  document.body.classList.toggle("is-fullscreen", !!document.fullscreenElement);
  if (document.fullscreenElement) closeSettings();
}

document.addEventListener("fullscreenchange", updateFullscreenChrome);
document.addEventListener("webkitfullscreenchange", updateFullscreenChrome);

function requestFs() {
  const el = document.documentElement;
  if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
  else document.exitFullscreen?.().catch(() => {});
}

btnFs.addEventListener("click", requestFs);
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
