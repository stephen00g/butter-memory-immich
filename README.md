# Immich screensaver

Fullscreen web UI that shows random photos from your [Immich](https://immich.app/) library. A small Node server proxies the Immich API so the **API key stays on the server** (never shipped to the browser).

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
| **Secret** `immich-screensaver-secrets` | `IMMICH_API_KEY` |

The process reads only `process.env` (see `server.js`). IPs and keys belong in Kubernetes env, not in the repo.

### Create the secret (required before Argo can sync the Deployment)

```bash
kubectl create namespace immich-screensaver --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret generic immich-screensaver-secrets \
  -n immich-screensaver \
  --from-literal=IMMICH_API_KEY='YOUR_KEY_HERE'
```

### Set Immich URL and timing

```bash
kubectl patch configmap immich-screensaver-config -n immich-screensaver --type merge -p \
  '{"data":{"IMMICH_SERVER_URL":"http://192.168.68.151:2283","SLIDE_INTERVAL_MS":"45000"}}'
```

Restart if needed:

```bash
kubectl rollout restart deployment/immich-screensaver -n immich-screensaver
```

### MetalLB static IP

Edit `argo/manifests/03-service.yaml` annotation `metallb.universe.tf/loadBalancerIPs` to a free address in your pool (example in repo: `192.168.68.32` — change it). Same pattern as your Tdarr app.

The cluster must be able to **reach** `IMMICH_SERVER_URL` from the pod network (same LAN is fine).

## Container image

Build and push, then align `argo/manifests/kustomization.yaml` `images` with your registry:

```bash
docker build -t ghcr.io/YOUR_ORG/immich-screensaver:1.0.0 .
docker push ghcr.io/YOUR_ORG/immich-screensaver:1.0.0
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
