/**
 * Keep the screen awake during fullscreen / “fill screen” mode.
 *
 * iOS Safari: user activation does NOT survive Promise.then/catch/microtasks — so
 * `video.play()` must run in the same synchronous turn as the tap. Wake Lock alone
 * can resolve while the screen still dims; we always start a muted inline video too.
 *
 * Sources: NoSleep.js–style media (keep-awake-media.js), Screen Wake Lock API.
 */

import { webm } from "./keep-awake-media.js?v=1.1.7";

/** Real H.264 file (see repo `public/keep-awake.mp4`) — iOS often fails on data-URI / tiny broken MP4s. */
const KEEP_AWAKE_MP4 = "/keep-awake.mp4?v=1.1.7";

let wakeLock = null;
let noSleepVideo = null;
let heartbeatTimer = null;

function releaseWakeLockOnly() {
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = window.setInterval(() => {
    if (!document.body.classList.contains("is-fullscreen")) return;
    const v = noSleepVideo;
    if (!v || !v.paused) return;
    v.play().catch(() => {});
  }, 4000);
}

function getOrCreateNoSleepVideo() {
  if (noSleepVideo) return noSleepVideo;
  const v = document.createElement("video");
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.setAttribute("muted", "");
  v.muted = true;
  v.defaultMuted = true;
  v.setAttribute("preload", "auto");
  v.preload = "auto";
  v.setAttribute("aria-hidden", "true");
  v.setAttribute("loop", "");
  /** Safari picks the first source it can decode — MP4 must come first on iOS. */
  const sMp4 = document.createElement("source");
  sMp4.src = KEEP_AWAKE_MP4;
  sMp4.type = "video/mp4";
  const sWebm = document.createElement("source");
  sWebm.src = webm;
  sWebm.type = "video/webm";
  v.appendChild(sMp4);
  v.appendChild(sWebm);
  v.className = "keep-awake-video";
  Object.assign(v.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "2px",
    height: "2px",
    opacity: "0.02",
    pointerEvents: "none",
    zIndex: "1",
  });
  document.body.appendChild(v);
  v.addEventListener("loadedmetadata", () => {
    if (v.duration > 1) {
      v.removeAttribute("loop");
      v.addEventListener("timeupdate", () => {
        if (v.currentTime > 0.5) v.currentTime = Math.random();
      });
    }
  });
  noSleepVideo = v;
  return v;
}

/**
 * MUST run synchronously inside the same user gesture as the tap (touchend/click).
 * iOS will reject play() if this runs in a Promise callback.
 */
function playNoSleepVideoNow() {
  const v = getOrCreateNoSleepVideo();
  const p = v.play();
  if (p && typeof p.catch === "function") {
    p.catch(() => {});
  }
}

function requestWakeLockAsync() {
  if (!("wakeLock" in navigator)) return;
  releaseWakeLockOnly();
  navigator.wakeLock
    .request("screen")
    .then((wl) => {
      wakeLock = wl;
      wl.addEventListener("release", () => {
        wakeLock = null;
      });
    })
    .catch(() => {});
}

/**
 * Call from a direct tap/click handler (Fullscreen, or tap on stage in fullscreen).
 * Order: hidden video play first (sync), then wake lock (async is OK for the lock object).
 */
export function acquireStayAwake() {
  playNoSleepVideoNow();
  requestWakeLockAsync();
  startHeartbeat();
}

export function releaseStayAwake() {
  stopHeartbeat();
  releaseWakeLockOnly();
  if (noSleepVideo) {
    noSleepVideo.pause();
  }
}

/** Create the video element early so metadata can load before the user hits Fullscreen. */
export function preloadStayAwakeAssets() {
  getOrCreateNoSleepVideo();
}

export function initStayAwake() {
  preloadStayAwakeAssets();

  /** Prime inline video on first touch/click so a later Fullscreen tap can play() reliably on iOS. */
  let primed = false;
  const primeOnce = () => {
    if (primed) return;
    primed = true;
    playNoSleepVideoNow();
    if (noSleepVideo) noSleepVideo.pause();
  };
  document.addEventListener("touchstart", primeOnce, { capture: true, passive: true, once: true });
  document.addEventListener("click", primeOnce, { capture: true, once: true });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!document.body.classList.contains("is-fullscreen")) return;
    playNoSleepVideoNow();
    requestWakeLockAsync();
  });
}
