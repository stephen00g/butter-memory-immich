# Immich screensaver

Fullscreen web UI that shows random photos from your [Immich](https://immich.app/) library. A small Node server proxies the Immich API so the **API key stays on the server** (never shipped to the browser).

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
| **Secret** `immich-screensaver-secrets` | `IMMICH_API_KEY` |

The process reads only `process.env` (see `server.js`). IPs and keys belong in Kubernetes env, not in the repo.

### Create secrets (required before the Deployment can run)

**1 — GHCR pull** (image — see [Argo / ImagePullBackOff](#argo-is-synced-but-the-pod-is-imagepullbackoff--what-to-do) above):

```bash
kubectl create namespace immich-screensaver --dry-run=client -o yaml | kubectl apply -f -

kubectl create secret docker-registry ghcr-pull \
  -n immich-screensaver \
  --docker-server=ghcr.io \
  --docker-username=stephen00g \
  --docker-password='PAT_WITH_read:packages'
```

**2 — Immich API key** (app config):

```bash
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

## Container image (GHCR)

**CI:** Pushes to `main` run [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) and publish `ghcr.io/stephen00g/immich-screensaver:1.0.0` (and `:latest`). Wait for the workflow to finish after you push, then refresh the Deployment.

**ImagePullBackOff / `401` / `403` on `ghcr.io/token`:** Use the **`ghcr-pull`** docker-registry secret and `imagePullSecrets` on the Deployment (already in `argo/manifests/02-deployment.yaml`). Anonymous GHCR pulls are unreliable for many user-owned packages even when marked public.

Manual build (optional):

```bash
docker build -t ghcr.io/YOUR_ORG/immich-screensaver:1.0.0 .
echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USER --password-stdin
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
