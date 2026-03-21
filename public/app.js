const layerA = document.getElementById("layer-a");
const layerB = document.getElementById("layer-b");
const btnFs = document.getElementById("btn-fullscreen");
const statusEl = document.getElementById("status");

let active = layerA;
let idle = layerB;
let slideIntervalMs = 30000;

function pickAsset(payload) {
  if (!payload) return null;
  if (Array.isArray(payload)) return payload[0] || null;
  if (Array.isArray(payload.assets)) return payload.assets[0] || null;
  if (payload.id) return payload;
  return null;
}

function setStatus(msg) {
  statusEl.textContent = msg || "";
}

async function loadConfig() {
  try {
    const r = await fetch("/api/config", { cache: "no-store" });
    if (!r.ok) return;
    const cfg = await r.json();
    if (typeof cfg.slideIntervalMs === "number" && cfg.slideIntervalMs >= 5000) {
      slideIntervalMs = cfg.slideIntervalMs;
    }
  } catch {
    /* defaults */
  }
}

async function fetchRandomAsset() {
  const r = await fetch("/api/screensaver/random?count=1", { cache: "no-store" });
  const text = await r.text();
  if (!r.ok) {
    throw new Error(text || `HTTP ${r.status}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON from screensaver API");
  }
  const asset = pickAsset(data);
  if (!asset?.id) {
    throw new Error("No asset id in response");
  }
  return asset.id;
}

function swapLayers() {
  const t = active;
  active = idle;
  idle = t;
  active.classList.remove("photo--hidden");
  idle.classList.add("photo--hidden");
}

function showPhoto(assetId) {
  const url = `/api/screensaver/thumbnail/${encodeURIComponent(assetId)}`;
  const img = idle;
  img.onload = () => {
    swapLayers();
    setStatus("");
  };
  img.onerror = () => {
    setStatus("Could not load image for this asset.");
  };
  img.alt = "";
  img.src = url;
}

async function tick() {
  try {
    const id = await fetchRandomAsset();
    showPhoto(id);
  } catch (e) {
    setStatus(e?.message || String(e));
  }
}

function requestFs() {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    el.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

btnFs.addEventListener("click", requestFs);

document.addEventListener("keydown", (ev) => {
  if (ev.key === "f" || ev.key === "F") requestFs();
});

await loadConfig();
await tick();
setInterval(tick, slideIntervalMs);
