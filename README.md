# Immich screensaver

Fullscreen web UI that shows random photos from your [Immich](https://immich.app/) library. A small Node server proxies the Immich API so the **API key stays on the server** (never shipped to the browser).

### `503` on `http://<screensaver-ip>/api/screensaver/...`

That means the pod is running but **Immich env is incomplete**. Set both:

| What | Where |
|------|--------|
| **Immich server URL** | **ConfigMap** `immich-screensaver-config` → `IMMICH_SERVER_URL` (e.g. `http://192.168.68.151:2283` — use your Immich **HTTP(S) port**, usually **2283**) |
| **Immich API key** | **Secret** `immich-screensaver-secrets` → `IMMICH_API_KEY` |

After changing them, restart: `kubectl rollout restart deployment/immich-screensaver -n immich-screensaver`.

The Git manifest [`argo/manifests/01-configmap.yaml`](argo/manifests/01-configmap.yaml) defaults `IMMICH_SERVER_URL` to your LAN Immich host; you must still **create the Secret** with a real API key (Argo does not invent it).

### Settings & on-screen styles

Move the mouse to the **bottom edge** — a bar shows **Settings** and **Fullscreen**. Or press **`S`** to open Settings, **`F`** for fullscreen, **`Esc`** to close Settings. You can pick a screensaver style, **seconds per photo** (5–120), and whether to show **photo details** (place, people, date, tags when Immich provides them). Preferences are saved in **this browser’s localStorage** only (not on the server or in Git).

After upgrading, **hard-refresh** the page (or wait for a new container image) so the browser loads the latest HTML/CSS/JS. The server sends `Cache-Control: no-store` for those assets to reduce stale UI.

**Styles** (similar ideas to tvOS): **Classic**, **Ken Burns**, **Origami**, **Reflections**, **Sliding panels**, **Scrapbook**, **Holiday mobile**, **Vintage prints**.

**Photo details** use metadata from Immich’s random-asset JSON (e.g. EXIF city/state/country, GPS coordinates if no place name, people with names, capture date, tags, caption). If something is missing in Immich, it won’t appear on screen.

## Argo is synced but the pod is `ImagePullBackOff` — what to do

**Two different systems:**

| What | What checks it |
|------|----------------|
| **Git repository in Argo** | Argo CD clones your repo and applies YAML. If Argo shows **Synced**, this part is fine. |
| **Container image on GHCR** | Each node pulls `ghcr.io/...` using the **container registry**, not your Git/Argo SSH key. |

**This repo expects a Kubernetes pull secret named `ghcr-pull`** so nodes can authenticate to GHCR. That avoids **`401 Unauthorized` / `403 Forbidden`** on `https://ghcr.io/token?...`, which happen when GitHub **does not issue an anonymous pull token** for your package (common even after setting visibility to “Public”).

### 1 — Create a GitHub token for pulls

1. Open **[Fine-grained token](https://github.com/settings/personal-access-tokens/new)** (or [classic](https://github.com/settings/tokens/new)) and create a token that can **read** GitHub Packages for `ghcr.io`.
   - **Classic PAT:** enable scope **`read:packages`** (and nothing else required for pull).
   - **Fine-grained:** Resource owner **your user**, repository access include **`butter-memory-immich`**, Permissions → **Packages** → **Read**.

### 2 — Create the `docker-registry` secret (once per cluster)

Use your GitHub **username** and the token as the **password**:

```bash
kubectl create secret docker-registry ghcr-pull \
  -n immich-screensaver \
  --docker-server=ghcr.io \
  --docker-username=stephen00g \
  --docker-password='YOUR_PAT_HERE'
```

If the secret already exists, delete and recreate or use `kubectl create secret ... --dry-run=client -o yaml | kubectl apply -f -` with your preferred workflow.

### 3 — Restart the Deployment

```bash
kubectl rollout restart deployment/immich-screensaver -n immich-screensaver
```

### Verify anonymous access (optional)

If this returns JSON with `"errors"` instead of a `"token"`, anonymous pulls will fail — use the secret above.

```bash
curl -sS "https://ghcr.io/token?service=ghcr.io&scope=repository:stephen00g/immich-screensaver:pull"
```

---

## Which API permissions should the key have?

For listing random assets and serving thumbnails through the official endpoints, use:

| Permission | Why |
|------------|-----|
| **asset.read** | Random asset metadata (`GET /api/assets/random`, legacy `GET /api/asset/random`). |
| **asset.download** | Thumbnail bytes (`GET /api/assets/{id}/thumbnail` / legacy path). Immich often treats image delivery as download. |
| **asset.view** | Add if your server version still returns 403 on thumbnails with only read+download (policy differs slightly by release). |

Start with **asset.read** + **asset.download**; add **asset.view** only if thumbnails fail with 403.

Do **not** grant write/admin scopes; this app only reads.

## Configuration (nothing sensitive in app source)

| Source | Variables |
|--------|-----------|
| **ConfigMap** `immich-screensaver-config` | `IMMICH_SERVER_URL` (base URL, no trailing slash, e.g. `http://192.168.68.151:2283`), `SLIDE_INTERVAL_MS`, `IMMICH_THUMB_SIZE` (`preview` is a good default). |
| **Secret** `immich-screensaver-secrets` | `IMMICH_API_KEY` (optional for **pod** start; required for Immich API to work) |

The process reads only `process.env` (see `server.js`). IPs and keys belong in Kubernetes env, not in the repo.

**Why updates felt painful:** Argo CD continuously reapplies **Git**. If the Deployment required a Secret that did not exist, Kubernetes refused to start the container (`CreateContainerConfigError`) — image updates could not roll out. The Deployment now uses an **optional** `IMMICH_API_KEY` reference so the pod **always starts**; add the secret when you are ready. The UI returns `503` until both URL and key are set.

### Create secrets

**1 — GHCR pull** (image — see [Argo / ImagePullBackOff](#argo-is-synced-but-the-pod-is-imagepullbackoff--what-to-do) above):

```bash
kubectl create namespace immich-screensaver --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret docker-registry ghcr-pull \
  -n immich-screensaver \
  --docker-server=ghcr.io \
  --docker-username=stephen00g \
  --docker-password='PAT_WITH_read:packages'
```

**2 — Immich API key** (app actually works; skip only if you want a broken UI until later):

```bash
kubectl create secret generic immich-screensaver-secrets \
  -n immich-screensaver \
  --from-literal=IMMICH_API_KEY='YOUR_KEY_HERE'
```

### Set or change Immich URL and timing

If you did not use the Git default, or Immich listens on another port:

```bash
kubectl patch configmap immich-screensaver-config -n immich-screensaver --type merge -p \
  '{"data":{"IMMICH_SERVER_URL":"http://192.168.68.151:2283","SLIDE_INTERVAL_MS":"45000"}}'
```

Restart if needed:

```bash
kubectl rollout restart deployment/immich-screensaver -n immich-screensaver
```

### MetalLB static IP

Your MetalLB **IPAddressPool** must include the address you request. In this lab, `home-lan-pool` is documented as **`192.168.68.20`–`30`** (see `butter-argo` docs / OpenClaw notes). **`192.168.68.32` is outside that range**, which causes `AllocationFailed: ... is not allowed in config`.

The repo defaults to **`192.168.68.29`** (inside `28–30`; **`.28`** is Tdarr). Confirm nothing else uses `.29` on your cluster:

```bash
kubectl get svc -A | grep LoadBalancer
kubectl get ipaddresspool -n metallb-system -o wide
```

If `.29` is taken, try **`.30`** or expand the pool (only if your LAN routing allows it). Edit `argo/manifests/03-service.yaml` → `metallb.universe.tf/loadBalancerIPs`.

The cluster must be able to **reach** `IMMICH_SERVER_URL` from the pod network (same LAN is fine).

## Container image (GHCR)

**CI:** Pushes to `main` run [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) and publish `ghcr.io/stephen00g/immich-screensaver:1.1.1` (and `:latest`). Wait for the workflow to finish after you push, then sync Argo (or `kubectl apply -k argo/manifests`).

**Why you didn’t see UI changes after a Git push:** The app’s HTML/JS/CSS are **inside the Docker image**. Kubernetes defaults to **`imagePullPolicy: IfNotPresent`**. If the tag stayed **`1.0.0`**, nodes kept using the **cached old image** and never picked up new static files. This repo uses **`1.1.1`** (bump when UI changes) and **`imagePullPolicy: Always`** so rollouts pull fresh layers. When you change the UI again, **bump the tag** in `argo/manifests/kustomization.yaml` and `.github/workflows/docker-publish.yml` (same version in both), push `main`, let CI build, then sync.

**ImagePullBackOff / `401` / `403` on `ghcr.io/token`:** Use the **`ghcr-pull`** docker-registry secret and `imagePullSecrets` on the Deployment (already in `argo/manifests/02-deployment.yaml`). Anonymous GHCR pulls are unreliable for many user-owned packages even when marked public.

Manual build (optional):

```bash
docker build -t ghcr.io/YOUR_ORG/immich-screensaver:1.1.1 .
echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USER --password-stdin
docker push ghcr.io/YOUR_ORG/immich-screensaver:1.1.1
```

## Argo CD

- Application manifest in this repo: `argo/application.yaml`.
- If you use the `butter-argo` app-of-apps repo, a sibling Application is at `butter-argo/apps/immich-screensaver.yaml` (update `repoURL` / `targetRevision` to match your Git remote and branch).

## Local run (optional)

```bash
export IMMICH_SERVER_URL='http://192.168.68.151:2283'
export IMMICH_API_KEY='your-key'
node server.js
# open http://127.0.0.1:8080
```

Use **Fullscreen** in the HUD (or press `f`) for kiosk-style display.

## Newer Immich versions

Some releases deprecate `GET /api/assets/random` in favor of `POST /api/search/random`. This server calls `GET /api/assets/random` first, then falls back to legacy `GET /api/asset/random`. If your Immich version only supports the search endpoint, extend `server.js` to `POST /api/search/random` with the body your version expects.
