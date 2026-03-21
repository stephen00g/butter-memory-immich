# Immich screensaver

Fullscreen web UI that shows random photos from your [Immich](https://immich.app/) library. A small Node server proxies the Immich API so the **API key stays on the server** (never shipped to the browser).

## Argo is synced but the pod is `ImagePullBackOff` — what to do

**Two different systems:**

| What | What checks it |
|------|----------------|
| **Git repository in Argo** | Argo CD clones your repo and applies YAML. If Argo shows **Synced**, this part is fine. |
| **Container image on GHCR** | Each node runs `docker pull ghcr.io/...` **without** your Git credentials. That uses the **container registry** only. |

A **private GitHub repo** usually produces a **private GHCR package**. Anonymous pulls then get **403**, so the pod stays in **ImagePullBackOff** even though Argo is green.

**Fix (pick one):**

### A — Make the GHCR package public (simplest for a homelab)

Your **code repo** can stay private; only the **package** visibility changes.

1. Open **[Your packages on GitHub](https://github.com/stephen00g?tab=packages)** (or **Profile → Packages**).
2. Open the package **`immich-screensaver`** (published by this repo’s Actions).
3. **Package settings** (right sidebar) → **Change package visibility** → **Public** → confirm.
4. Restart the workload so Kubernetes retries the pull:
   ```bash
   kubectl rollout restart deployment/immich-screensaver -n immich-screensaver
   ```

### B — Keep the package private

Create a GitHub [Personal Access Token](https://github.com/settings/tokens) with **`read:packages`**, then create a pull secret and attach it to the pod. See [Container image (GHCR)](#container-image-ghcr) → **Private GHCR + `imagePullSecrets`** below.

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

## Container image (GHCR)

**CI:** Pushes to `main` run [`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml) and publish `ghcr.io/stephen00g/immich-screensaver:1.0.0` (and `:latest`). Wait for the workflow to finish after you push, then refresh the Deployment.

**ImagePullBackOff / `403 Forbidden` from `ghcr.io/token`:** The cluster is pulling **anonymously**. Either:

1. **Make the package public** (simplest for a homelab): GitHub → your profile → **Packages** → **immich-screensaver** → **Package settings** → **Change package visibility** → Public. Anonymous nodes can pull.
2. **Keep the package private** and add a pull secret + `imagePullSecrets` on the Deployment (see below).

Manual build (optional):

```bash
docker build -t ghcr.io/YOUR_ORG/immich-screensaver:1.0.0 .
echo "$GITHUB_TOKEN" | docker login ghcr.io -u YOUR_USER --password-stdin
docker push ghcr.io/YOUR_ORG/immich-screensaver:1.0.0
```

### Private GHCR + `imagePullSecrets`

Create a [PAT](https://github.com/settings/tokens) with **`read:packages`** (and `write:packages` if you push from CI elsewhere), then:

```bash
kubectl create secret docker-registry ghcr-pull \
  -n immich-screensaver \
  --docker-server=ghcr.io \
  --docker-username=stephen00g \
  --docker-password='YOUR_PAT'
```

Patch the Deployment (or add under `spec.template.spec` in `02-deployment.yaml`):

```yaml
imagePullSecrets:
  - name: ghcr-pull
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
