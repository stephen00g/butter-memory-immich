import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let APP_VERSION = "0.0.0";
try {
  const pkgPath = path.join(__dirname, "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  if (typeof pkg.version === "string") APP_VERSION = pkg.version;
} catch {
  /* keep default */
}

const PORT = Number(process.env.PORT) || 8080;
const IMMICH_URL = (process.env.IMMICH_SERVER_URL || "").replace(/\/$/, "");
const API_KEY = process.env.IMMICH_API_KEY || "";
const SLIDE_INTERVAL_MS = Number(process.env.SLIDE_INTERVAL_MS) || 30000;
const THUMB_SIZE = process.env.IMMICH_THUMB_SIZE || "preview";

function immichHeaders(extra = {}) {
  const h = { ...extra };
  if (API_KEY) h["x-api-key"] = API_KEY;
  return h;
}

async function proxyThumbnailGet(res, immichPaths) {
  if (!IMMICH_URL) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "IMMICH_SERVER_URL is not set" }));
    return;
  }
  if (!API_KEY) {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "IMMICH_API_KEY is not set" }));
    return;
  }

  for (const immichPath of immichPaths) {
    const url = new URL(immichPath, IMMICH_URL + "/");
    const upstream = await fetch(url, {
      method: "GET",
      headers: immichHeaders({ accept: "image/*,*/*" }),
    });
    if (upstream.ok || upstream.status !== 404) {
      const buf = Buffer.from(await upstream.arrayBuffer());
      const outHeaders = {};
      upstream.headers.forEach((v, k) => {
        const lk = k.toLowerCase();
        if (lk === "transfer-encoding" || lk === "content-encoding") return;
        outHeaders[k] = v;
      });
      res.writeHead(upstream.status, outHeaders);
      res.end(buf);
      return;
    }
  }
  res.writeHead(404);
  res.end("Not found");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".webmanifest": "application/manifest+json",
};

function serveStatic(req, res, filePath) {
  const full = path.join(__dirname, "public", filePath);
  if (!full.startsWith(path.join(__dirname, "public"))) {
    res.writeHead(403);
    res.end();
    return;
  }
  fs.readFile(full, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    const ext = path.extname(full);
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if ([".html", ".js", ".css", ".webmanifest"].includes(ext)) {
      headers["Cache-Control"] = "no-store";
    }
    res.writeHead(200, headers);
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url || "/", `http://${req.headers.host}`);

  if (req.method === "GET" && u.pathname === "/health") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok");
    return;
  }

  if (req.method === "GET" && u.pathname === "/api/config") {
    res.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(
      JSON.stringify({
        slideIntervalMs: SLIDE_INTERVAL_MS,
        thumbSize: THUMB_SIZE,
        appVersion: APP_VERSION,
      })
    );
    return;
  }

  if (req.method === "GET" && u.pathname === "/api/screensaver/random") {
    if (!IMMICH_URL || !API_KEY) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Immich is not configured",
          hint: !IMMICH_URL
            ? "Set IMMICH_SERVER_URL in ConfigMap immich-screensaver-config"
            : "Set IMMICH_API_KEY in Secret immich-screensaver-secrets",
        })
      );
      return;
    }
    const count = u.searchParams.get("count") || "1";
    const headers = immichHeaders({ accept: "application/json" });

    const tryUrls = [
      `${IMMICH_URL}/api/assets/random?count=${encodeURIComponent(count)}`,
      `${IMMICH_URL}/api/asset/random`,
    ];

    (async () => {
      let lastStatus = 502;
      let lastBody = "";
      for (const randomUrl of tryUrls) {
        try {
          const r = await fetch(randomUrl, { headers });
          const text = await r.text();
          if (r.ok || r.status !== 404) {
            res.writeHead(r.status, { "Content-Type": r.headers.get("content-type") || "application/json" });
            res.end(text);
            return;
          }
          lastStatus = r.status;
          lastBody = text;
        } catch (e) {
          lastBody = String(e.message || e);
        }
      }
      res.writeHead(lastStatus, { "Content-Type": "application/json" });
      res.end(lastBody || JSON.stringify({ error: "Random asset request failed" }));
    })();
    return;
  }

  const thumbMatch = u.pathname.match(/^\/api\/screensaver\/thumbnail\/([^/]+)$/);
  if (req.method === "GET" && thumbMatch) {
    const id = thumbMatch[1];
    const qs = new URLSearchParams(u.search);
    if (!qs.has("size") && THUMB_SIZE) qs.set("size", THUMB_SIZE);
    const q = qs.toString();
    const suffix = q ? `?${q}` : "";
    (async () => {
      await proxyThumbnailGet(res, [
        `/api/assets/${id}/thumbnail${suffix}`,
        `/api/asset/${id}/thumbnail${suffix}`,
      ]);
    })();
    return;
  }

  if (req.method === "GET" && u.pathname === "/") {
    return serveStatic(req, res, "index.html");
  }

  if (req.method === "GET" && u.pathname.startsWith("/")) {
    const rel = u.pathname.slice(1);
    if (rel && !rel.includes("..")) {
      return serveStatic(req, res, rel);
    }
  }

  res.writeHead(404);
  res.end("Not found");
});

server.listen(PORT, () => {
  console.log(`immich-screensaver listening on ${PORT}`);
});
