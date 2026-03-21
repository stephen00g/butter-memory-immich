/**
 * Keep the screen awake during fullscreen / “fill screen” mode.
 * - Screen Wake Lock API (iOS Safari 16.4+, Chrome, etc.)
 * - Hidden looping video fallback (NoSleep.js–style; see keep-awake-media.js)
 */

import { webm, mp4 } from "./keep-awake-media.js?v=1.1.6";

let wakeLock = null;
let noSleepVideo = null;

function releaseWakeLockOnly() {
  if (!wakeLock) return;
  wakeLock.release().catch(() => {});
  wakeLock = null;
}

function getOrCreateNoSleepVideo() {
  if (noSleepVideo) return noSleepVideo;
  const v = document.createElement("video");
  v.setAttribute("playsinline", "");
  v.setAttribute("webkit-playsinline", "");
  v.muted = true;
  v.setAttribute("muted", "");
  v.setAttribute("aria-hidden", "true");
  const sWebm = document.createElement("source");
  sWebm.src = webm;
  sWebm.type = "video/webm";
  const sMp4 = document.createElement("source");
  sMp4.src = mp4;
  sMp4.type = "video/mp4";
  v.appendChild(sWebm);
  v.appendChild(sMp4);
  v.className = "keep-awake-video";
  Object.assign(v.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: "1px",
    height: "1px",
    opacity: "0.02",
    pointerEvents: "none",
    zIndex: "-1",
  });
  document.body.appendChild(v);
  v.addEventListener("loadedmetadata", () => {
    if (v.duration <= 1) {
      v.setAttribute("loop", "");
    } else {
      v.addEventListener("timeupdate", () => {
        if (v.currentTime > 0.5) v.currentTime = Math.random();
      });
    }
  });
  noSleepVideo = v;
  return v;
}

/** Run in the same user-gesture turn as entering fullscreen (required on iOS). */
function tryPlayVideoFallback() {
  const v = getOrCreateNoSleepVideo();
  const p = v.play();
  if (p && typeof p.catch === "function") p.catch(() => {});
}

/**
 * Request wake lock and/or start hidden video. Call synchronously from a tap/click
 * that enters fullscreen so iOS accepts it.
 */
export function acquireStayAwake() {
  releaseWakeLockOnly();

  if ("wakeLock" in navigator) {
    navigator.wakeLock
      .request("screen")
      .then((wl) => {
        wakeLock = wl;
        wl.addEventListener("release", () => {
          wakeLock = null;
        });
      })
      .catch(() => {
        tryPlayVideoFallback();
      });
  } else {
    tryPlayVideoFallback();
  }
}

export function releaseStayAwake() {
  releaseWakeLockOnly();
  if (noSleepVideo) {
    noSleepVideo.pause();
  }
}

/** Re-acquire after tab focus or wake-lock release (browser may drop lock when hidden). */
export function initStayAwake() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return;
    if (!document.body.classList.contains("is-fullscreen")) return;
    acquireStayAwake();
  });
}
