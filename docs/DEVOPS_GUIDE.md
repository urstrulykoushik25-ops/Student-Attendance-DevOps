# DevOps Guide — AttendX

This guide walks through installing and running every tool used by the project:

- Docker Desktop (Windows) and Docker Compose
- Jenkins (custom Docker image with Configuration as Code)
- Kubernetes (Docker Desktop's built-in single-node cluster)
- Selenium WebDriver (local Chrome and containerized Selenium Grid)

It also documents the CI/CD pipeline, the ten end-to-end test cases, troubleshooting, and security
hardening. All commands are written for **Windows PowerShell**, with notes for macOS/Linux where
they differ.

---

## 0. What you will have at the end

| Tool | Address / command | Purpose |
| --- | --- | --- |
| AttendX (Compose) | <http://localhost:3000> | Application |
| Jenkins | <http://localhost:8080> | CI/CD server (`admin` / `admin123`) |
| Jenkins job | `student-attendance-pipeline` | Build → test → containerize → deploy |
| AttendX (Kubernetes) | <http://localhost:30080> | App in a pod with a PVC (via port-forward on Docker Desktop) |
| Selenium | ephemeral container per build | Real Chrome E2E tests |

Recommended machine: 4 CPU cores, 8 GB RAM, 20 GB free disk. Docker Desktop should have at least
4 GB of memory allocated (8 GB is comfortable when Jenkins, Chrome and Kubernetes run together).

---

## 1. Install Docker Desktop on Windows

### 1.1 Enable WSL 2

Docker Desktop uses the WSL 2 backend. In an **Administrator** PowerShell window:

```powershell
wsl --install
```

Restart Windows if prompted. Then verify:

```powershell
wsl --status
wsl --list --verbose
```

If WSL is already installed, update it:

```powershell
wsl --update
```

### 1.2 Install Docker Desktop

Use winget (recommended):

```powershell
winget install --id Docker.DockerDesktop -e --accept-source-agreements --accept-package-agreements
```

Or download the installer from <https://www.docker.com/products/docker-desktop/> and run it.

After installation:

1. Start **Docker Desktop**.
2. Accept the license and finish onboarding.
3. Open **Settings → General** and confirm **Use the WSL 2 based engine** is selected.
4. Open **Settings → Resources** and give Docker at least **4 GB** of memory.
5. Click **Apply & restart**.

### 1.3 Verify Docker

```powershell
docker version
docker compose version
docker info
```

Expected: a client and server version, Compose v2+, and a Linux engine. If `docker version` shows
only the client, Docker Desktop is not running or the engine is still starting.

### 1.4 Common Docker installation issues

| Symptom | Fix |
| --- | --- |
| `error during connect` / named pipe not found | Start Docker Desktop and wait for the whale icon to stop animating |
| WSL 2 installation is incomplete | Run `wsl --update`, reboot, then restart Docker Desktop |
| `docker compose` is not a command | Update Docker Desktop; Compose v2 ships with it |
| Port 3000/8080 already in use | Stop the conflicting process or change the host port in `docker-compose.yml` |
| Containers exit with code 139 | Usually a native module/architecture issue; this project uses built-in `node:sqlite`, so rebuild with `docker compose build --no-cache` |

---

## 2. Install Git, Node.js and kubectl

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Kubernetes.kubectl -e
```

Restart the terminal, then verify:

```powershell
git --version
node --version       # must be 24.x or newer
npm --version
kubectl version --client
```

> **Node.js 24 is required** for the built-in `node:sqlite` module. Node 22 and older do not provide
> the stable `DatabaseSync` API used by `src/db.js`.

---

## 3. Get the project and run it locally

```powershell
git clone <your-repository-url> student-attendance-devops
cd student-attendance-devops
npm install
npm run seed
npm start
```

Open <http://localhost:3000>. Stop the server with `Ctrl+C`.

Run the tests before containerizing:

```powershell
npm run test:api
# 13 tests pass

# Selenium uses the installed Chrome by default:
npm run test:selenium
# 9 tests pass
```

If Chrome is not installed, install it or use the containerized Selenium grid described in
section 8.

---

## 4. Run the application in Docker

### 4.1 Understand the image

`Dockerfile` is a multi-stage build:

1. **deps** — `npm ci --omit=dev` on `node:24-bookworm-slim`.
2. **runtime** — copies production dependencies, `src/`, `public/`, creates `/app/data`, and runs
   as the unprivileged `node` user.

The image exposes port `3000`, declares `/app/data` as a volume, and has a Node-based health check
that calls `/api/health`.

### 4.2 Build and run manually

```powershell
docker build -t student-attendance:local .
docker run -d --name attendance-app -p 3000:3000 `
  -e SEED_DEMO=true `
  -e DB_PATH=/app/data/attendance.db `
  -v attendance-data:/app/data `
  student-attendance:local
```

Verify:

```powershell
docker ps --filter name=attendance-app
docker logs -f attendance-app
Invoke-RestMethod http://localhost:3000/api/health
```

Open <http://localhost:3000>. Data survives container replacement because it is stored in the
`attendance-data` volume.

Stop and remove:

```powershell
docker rm -f attendance-app
```

### 4.3 Run the full stack with Compose

`docker-compose.yml` defines:

- `app` — AttendX on port `3000`, health check, named volume, `SEED_DEMO=true`
- `jenkins` — custom Jenkins image on ports `8080` and `50000`, Docker socket, project mount,
  kubeconfig mount, health check

Start:

```powershell
docker compose up -d --build
docker compose ps
```

Follow logs:

```powershell
docker compose logs -f app
docker compose logs -f jenkins
```

Open <http://localhost:3000> and <http://localhost:8080>.

Useful operations:

```powershell
# Rebuild only the app after code changes
docker compose up -d --build app

# Open a shell in the app container
docker compose exec app sh

# Inspect the SQLite file
docker compose exec app node -e "const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync('/app/data/attendance.db');console.log(db.prepare('select count(*) as n from students').get())"

# Stop, keep volumes
docker compose down

# Stop and delete data
docker compose down -v
```

### 4.4 Back up and restore SQLite

```powershell
# Backup
docker run --rm -v student-attendance-data:/data -v ${PWD}:/backup alpine `
  sh -c "cp /data/attendance.db /backup/attendance-backup.db"

# Restore (stop the app first)
docker compose stop app
docker run --rm -v student-attendance-data:/data -v ${PWD}:/backup alpine `
  sh -c "cp /backup/attendance-backup.db /data/attendance.db"
docker compose start app
```

---

## 5. Install and run Jenkins (in Docker)

Jenkins is **not installed natively**. It runs as a container built from `jenkins/Dockerfile`, which
makes the setup reproducible and keeps the host clean.

### 5.1 What the custom image contains

- Base: `jenkins/jenkins:lts-jdk21`
- Docker CLI + Compose plugin (uses the host Docker daemon through the mounted socket)
- `kubectl`
- `git`, `curl`, `jq`, CA certificates
- Jenkins plugins from `jenkins/plugins.txt`
- JCasC configuration from `jenkins/casc/jenkins.yaml`

### 5.2 Build the image

```powershell
docker compose build jenkins
```

The first build downloads the Jenkins base image and roughly 100 plugin dependencies; expect a few
minutes.

### 5.3 Start Jenkins

```powershell
docker compose up -d jenkins
```

Or start everything and wait for Jenkins automatically:

```powershell
.\scripts\setup-jenkins.ps1
```

Wait until the health check is green:

```powershell
docker compose ps
# attendance-jenkins ... Up (healthy)
```

The setup wizard is disabled (`-Djenkins.install.runSetupWizard=false`). JCasC creates:

- the local admin user `admin` / `admin123`
- the pipeline job `student-attendance-pipeline`
- the Jenkins URL `http://localhost:8080/`

Open <http://localhost:8080> and sign in.

### 5.4 How JCasC works

`jenkins/casc/jenkins.yaml` is mounted/copied into the image and referenced by
`CASC_JENKINS_CONFIG`. On startup Jenkins applies it. The job uses the Git SCM URL
`file:///workspace/student-attendance-devops`, which is the read-only bind mount of this project
inside the Jenkins container.

If you move the project, update both:

- the volume mapping in `docker-compose.yml`
- the `url(...)` in `jenkins/casc/jenkins.yaml`

Then recreate Jenkins:

```powershell
docker compose up -d --force-recreate jenkins
```

### 5.5 Trigger the pipeline

From the UI:

1. Open <http://localhost:8080/job/student-attendance-pipeline/>.
2. Click **Build Now**.
3. Open the build → **Console Output**.

From PowerShell:

```powershell
.\scripts\trigger-jenkins.ps1
```

The script obtains a CSRF crumb, queues the build, waits for completion and exits non-zero on
failure. To queue without waiting:

```powershell
.\scripts\trigger-jenkins.ps1 -NoWait
```

### 5.6 Pipeline stages

| Stage | What it does | Key commands |
| --- | --- | --- |
| Checkout | Clones `main` from the mounted repository | `checkout scm`, `git rev-parse` |
| API tests | Builds the test image and runs the API suite | `docker build -f Dockerfile.test`, `npm run test:api` |
| Build application image | Builds tagged and `latest` images | `docker build -t student-attendance:$BUILD_NUMBER .` |
| Selenium E2E | Creates an isolated network, starts the app + Chrome, waits for health, runs the UI suite | `docker network create`, `docker run selenium/standalone-chrome`, `npm run test:selenium` |
| Deploy to Kubernetes | Skipped when no cluster is reachable; otherwise applies manifests and updates the image | `kubectl apply -k k8s/`, `kubectl set image`, `kubectl rollout status` |

The pipeline always runs `cleanWs()` and removes the temporary containers/network with a shell
trap, so failed builds do not leave orphaned resources.

### 5.7 Jenkins data and updates

- Jenkins home: Docker volume `student-attendance-jenkins-home`
- To reset Jenkins completely:

```powershell
docker compose rm -sf jenkins
docker volume rm student-attendance-jenkins-home
docker compose up -d --build jenkins
```

- To add a plugin: append it to `jenkins/plugins.txt`, rebuild the image, recreate the container.
- To change the admin password: edit `jenkins/casc/jenkins.yaml`, then recreate Jenkins.

### 5.8 Jenkins troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Jenkins page does not load | Wait for startup; `docker compose logs -f jenkins` |
| `permission denied` on `/var/run/docker.sock` | The service runs as `root`; confirm `user: root` in `docker-compose.yml` |
| Pipeline cannot clone `file:///workspace/...` | Check the project mount and that the host directory is a Git repository with a `main` branch |
| `docker: not found` in a pipeline | Rebuild the Jenkins image; the Docker CLI is installed in `jenkins/Dockerfile` |
| `kubectl` stage is skipped | Expected when no cluster is reachable; enable Kubernetes and mount the kubeconfig |
| Plugin installation fails during build | Check network/proxy access to `updates.jenkins.io`; retry `docker compose build --no-cache jenkins` |

---

## 6. Install and enable Kubernetes

### 6.1 Enable Docker Desktop Kubernetes

1. Open **Docker Desktop → Settings → Kubernetes**.
2. Check **Enable Kubernetes**.
3. Leave the default single-node cluster.
4. Click **Apply & restart**.
5. Wait until the Kubernetes indicator is green (the first start downloads control-plane images).

You can also run the helper script, which updates Docker Desktop's settings store, restarts it and
waits for the cluster:

```powershell
.\scripts\enable-k8s.ps1
```

The script sets `KubernetesEnabled=true`, `KubernetesMode=kind` and one node in Docker Desktop's
settings store. Recent Docker Desktop versions use these Go field names; the dotted GUI keys
(`kubernetes.enabled`) are reported as unknown and ignored. The script backs up the original
settings file to `settings-store.json.bak`.

Verify:

```powershell
kubectl cluster-info
kubectl get nodes
```

Expected: one node named `desktop-control-plane` (or similar) with status `Ready`.

> The project's manifests are plain Kubernetes YAML and work with any cluster (Docker Desktop,
> kind, minikube, k3d, AKS/EKS/GKE). The NodePort `30080` assumes a local cluster; Docker Desktop
> users should use the port-forward helper described in section 6.4.

### 6.2 Build the application image

```powershell
docker build -t student-attendance:latest .
```

### 6.3 Make the image visible to the cluster

Docker Desktop's Kubernetes node is kind-based and has its own containerd image store. A host image
is **not** automatically visible inside the cluster. Load it explicitly with the helper script:

```powershell
.\scripts\load-image-k8s.ps1 -Image student-attendance:latest
```

The script saves the image, streams the archive into the control-plane container over stdin and
imports it into the `k8s.io` containerd namespace. The manual equivalent is:

```powershell
# Docker Desktop hides system containers from docker ps, but the name resolves
$node = "desktop-control-plane"
docker inspect $node *> $null
if ($LASTEXITCODE -ne 0) { throw "Kubernetes node container not found. Is Kubernetes enabled?" }

# Save, stream and import the image
docker save student-attendance:latest -o "$env:TEMP\student-attendance.tar"
cmd /c "type ""$env:TEMP\student-attendance.tar"" | docker exec -i $node sh -c ""cat > /tmp/student-attendance.tar"""
docker exec $node ctr -n k8s.io images import /tmp/student-attendance.tar
docker exec $node ctr -n k8s.io images ls | Select-String student-attendance
```

> `docker cp` currently returns success but does not copy files into Docker Desktop's hidden kind
> node. Streaming through `docker exec -i` is reliable. The helper script and the Jenkins pipeline
> both use this method.

If your Docker Desktop version names the node differently, list candidates:

```powershell
docker ps -a --format "table {{.Names}}\t{{.Image}}"
docker inspect desktop-control-plane k8s-control-plane kind-control-plane
```

Look for a container running a `kindest/node` image.

> **Why this matters:** the Deployment uses `imagePullPolicy: IfNotPresent`. Without the import,
> the pod stays in `ImagePullBackOff`/`ErrImageNeverPull`.

### 6.4 Deploy

```powershell
.\scripts\deploy-k8s.ps1
```

Or manually:

```powershell
kubectl apply -k k8s/
kubectl -n student-attendance rollout status deployment/attendance-app --timeout=180s
kubectl -n student-attendance get pods,svc,pvc
```

Docker Desktop's kind-based cluster does **not** publish NodePorts to Windows in current versions.
Keep a port-forward running to reach the app at the documented URL:

```powershell
.\scripts\port-forward-k8s.ps1
# http://localhost:30080
```

On kind/minikube clusters configured with extra port mappings, the NodePort is reachable directly.
Inside the cluster the Service always works:
`http://attendance-app.student-attendance.svc.cluster.local`.

### 6.5 Inspect and operate

```powershell
# Pods, service, PVC
kubectl -n student-attendance get all,pvc

# Logs
kubectl -n student-attendance logs deployment/attendance-app -f

# Describe a failing pod
kubectl -n student-attendance describe pod -l app.kubernetes.io/name=attendance-app

# Port-forward instead of NodePort
kubectl -n student-attendance port-forward svc/attendance-app 3001:80
# open http://localhost:3001

# Restart the pod (data survives on the PVC)
kubectl -n student-attendance rollout restart deployment/attendance-app
```

### 6.6 How Jenkins deploys to Kubernetes

`docker-compose.yml` mounts the project's generated kubeconfig directory:

```yaml
- ${KUBE_CONFIG_DIR:-./.kube}:/var/jenkins_home/.kube:ro
```

and sets:

```yaml
KUBECONFIG: "/var/jenkins_home/.kube/config"
```

The host kubeconfig cannot be mounted directly: Docker Desktop publishes the API at
`https://127.0.0.1:<random-port>`, which points at the Jenkins container itself. Run
`scripts/sync-kubeconfig.ps1` (or `setup-jenkins.ps1`, which calls it) to write `./.kube/config`
with:

- server `https://host.docker.internal:<port>`
- `tls-server-name: kubernetes` so the Docker Desktop certificate verifies

Re-run the sync after every Docker Desktop restart because the published port changes. The Jenkins
pipeline checks `kubectl version --request-timeout=5s`; if the cluster is reachable, it applies the
manifests, runs:

```bash
kubectl -n student-attendance set image deployment/attendance-app \
  attendance-app="student-attendance:$BUILD_NUMBER"
kubectl -n student-attendance rollout status deployment/attendance-app --timeout=180s
```

The pipeline probes the well-known node names with `docker inspect` (Docker Desktop hides system
containers from `docker ps`), streams the build image into the node and imports it into the
`k8s.io` containerd namespace before running `kubectl set image`. After the rollout it runs an
in-cluster health check through the Service. If you prefer to import manually:

```powershell
$tag = "<build-number>"
.\scripts\load-image-k8s.ps1 -Image "student-attendance:$tag"
```

Alternatively, push the image to a registry that the cluster can reach and update `k8s/` with the
registry-qualified name.

### 6.7 Kubernetes troubleshooting

| Symptom | Fix |
| --- | --- |
| `kubectl` connection refused | Enable Kubernetes and wait for green; `kubectl config current-context` |
| Pod `ImagePullBackOff` / `ErrImageNeverPull` | Import the image into the node (section 6.3) or push to a registry |
| Pod `Pending`, PVC unbound | Check `kubectl -n student-attendance describe pvc attendance-data`; Docker Desktop provides a default StorageClass |
| `rollout status` times out | `kubectl -n student-attendance describe pod ...`, check probes and logs |
| Port 30080 already in use | Change `nodePort` in `k8s/service.yaml` and redeploy |
| Data lost after redeploy | `kubectl delete -k k8s/` deletes the namespace and PVC. Back up first, or delete only the Deployment/Service to keep data |

### 6.8 Clean up Kubernetes

```powershell
kubectl delete -k k8s/
```

`kubectl delete -k k8s/` includes the Namespace, so it deletes the PVC and the SQLite data with it.
To keep the data, delete only the Deployment/Service and leave the PVC:

```powershell
kubectl -n student-attendance delete deployment attendance-app
kubectl -n student-attendance delete service attendance-app
```

To keep the namespace and PVC but remove the app, this is the safer cleanup during development.

---

## 7. Docker Compose reference

`docker-compose.yml` (abridged):

```yaml
services:
  app:
    build: .
    image: student-attendance:local
    container_name: attendance-app
    ports: ["3000:3000"]
    environment:
      NODE_ENV: production
      PORT: "3000"
      DB_PATH: /app/data/attendance.db
      SEED_DEMO: "true"
    volumes:
      - attendance-data:/app/data
    healthcheck: ...
    restart: unless-stopped

  jenkins:
    build: ./jenkins
    image: student-attendance-jenkins:local
    container_name: attendance-jenkins
    user: root
    ports: ["8080:8080", "50000:50000"]
    environment:
      JAVA_OPTS: "-Djenkins.install.runSetupWizard=false -Duser.timezone=Asia/Kolkata"
      CASC_JENKINS_CONFIG: /usr/share/jenkins/ref/casc/jenkins.yaml
      KUBECONFIG: /var/jenkins_home/.kube/config
    volumes:
      - jenkins-home:/var/jenkins_home
      - /var/run/docker.sock:/var/run/docker.sock
      - ./:/workspace/student-attendance-devops:ro
      - ${KUBE_CONFIG_DIR:-./.kube}:/var/jenkins_home/.kube:ro
    healthcheck: ...
    restart: unless-stopped
```

Key points:

- `app` and `jenkins` share the host Docker daemon; Jenkins builds images that are immediately
  available to the host (and to Compose).
- The project is mounted **read-only** into Jenkins at `/workspace/student-attendance-devops`.
- Jenkins home is a named volume so jobs/builds survive container recreation.
- The app database is a named volume, not a bind mount, so it works identically on Windows/macOS.

---

## 8. Selenium testing

### 8.1 Test architecture

`tests/selenium.test.js` uses Selenium WebDriver 4 with Chrome:

- Local run: Selenium Manager downloads/uses the installed Chrome and driver automatically.
- CI run: the test container connects to `selenium/standalone-chrome` over a Docker network.
- The suite creates its own students with unique roll numbers and writes attendance for
  `2024-01`, so it does not depend on the demo seed.

Environment variables:

| Variable | Example | Meaning |
| --- | --- | --- |
| `BASE_URL` | `http://localhost:3000` | Application under test |
| `SELENIUM_REMOTE_URL` | `http://localhost:4444/wd/hub` | Selenium Grid/standalone endpoint |

### 8.2 Run against local Chrome

```powershell
$env:BASE_URL = 'http://localhost:3000'
npm run test:selenium
```

### 8.3 Run against a Selenium container

```powershell
docker run -d --name selenium -p 4444:4444 --shm-size=2g selenium/standalone-chrome:latest
$env:SELENIUM_REMOTE_URL = 'http://localhost:4444/wd/hub'
$env:BASE_URL = 'http://host.docker.internal:3000'
npm run test:selenium
docker rm -f selenium
```

If the app runs in Compose on the same Docker network, use the service name instead:

```powershell
docker network create attendance-test
docker network connect attendance-test attendance-app
docker run -d --name selenium --network attendance-test --shm-size=2g selenium/standalone-chrome:latest
$env:SELENIUM_REMOTE_URL = 'http://localhost:4444/wd/hub'
$env:BASE_URL = 'http://attendance-app:3000'
npm run test:selenium
```

### 8.4 The ten test cases in detail

| # | Scenario | Steps | Expected result |
| --- | --- | --- | --- |
| 1 | Attendance page lists the class | Open `/attendance.html?date=2024-02-15` | Every registered student appears with roll number and name; seven period columns are visible |
| 2 | Mark all seven periods + Mark All | Click **Mark All Present**, verify every cell shows `P`; click **Mark All Absent**, verify every cell shows `A`; click **Mark All Present** again, then Save | Both bulk actions update all seven periods for all students; toast confirms save; API returns seven `present` values for that student/date |
| 3 | Reload saved attendance | Reopen the same date | Cells still show `P` and the `is-present` style |
| 4 | Missing/duplicate student validation | Open Add Student, submit empty; then submit an existing roll number | Inline "Roll number is required"; then "already exists" (HTTP 409) |
| 5 | Duplicate attendance prevention | POST the same 7 records twice for a unique date | Both saves return `saved: 7`; `recordCount` stays 7; no duplicate rows |
| 6 | Monthly totals | Open `/reports.html?month=2024-01` | Attended = 60, absent = 10 for the 10-day/7-period fixture |
| 7 | Percentage | Read the percentage cell | `85.71%` |
| 8 | Threshold filter | Read the Beta row; click "Below threshold" | Beta is flagged; filter includes Beta and excludes Alpha |
| 9 | Report + CSV | Check report table/export button; GET `/api/reports/monthly.csv` | CSV content type, header and values (including `42.86` and `YES`) |
| 10 | Persistence after restart | API test starts a server on a temp DB, saves data, closes it, starts a new server on the same DB | Student and attendance are still present |

The tenth case is intentionally an API-level restart test: it restarts the Node process and
re-opens the same SQLite file, which is more deterministic than restarting a browser session and
directly verifies the persistence guarantee.

### 8.5 Test data

The Selenium suite uses roll numbers prefixed with `E2E` and a timestamp suffix, so repeated runs
do not collide. It writes 10 days × 7 periods for four students in `2024-01`:

- Alpha: 6 periods/day → 60/70 = 85.71%
- Beta: 3 periods/day → 30/70 = 42.86%
- Gamma: all periods → 70/70 = 100%
- Delta: 52/70 = 74.29%

This makes threshold filtering deterministic at the default 75%.

---

## 9. End-to-end demo (copy/paste)

```powershell
# 1. Start the app + Jenkins
docker compose up -d --build
.\scripts\setup-jenkins.ps1

# 2. Verify the app
Invoke-RestMethod http://localhost:3000/api/health
.\scripts\smoke-test.ps1

# 3. Run the pipeline (API + Selenium + optional K8s deploy)
.\scripts\trigger-jenkins.ps1

# 4. Deploy to Kubernetes
docker build -t student-attendance:latest .
# import the image (section 6.3)
.\scripts\deploy-k8s.ps1
Invoke-RestMethod http://localhost:30080/api/health

# 5. Clean up
kubectl delete -k k8s/
docker compose down
```

---

## 10. Troubleshooting matrix

| Area | Symptom | Likely cause | Fix |
| --- | --- | --- | --- |
| Docker | `port is already allocated` | Another container/process uses 3000/8080 | `docker ps`, stop the process, or change the host port |
| Docker | App unhealthy | DB path/permissions | Check `docker logs attendance-app`; ensure `/app/data` is writable by `node` |
| Docker | Data disappears | Container recreated without volume | Use the named volume; never `docker compose down -v` unless resetting |
| Jenkins | 503/blank page during startup | Plugins/JCasC still loading | Wait 1–3 min; `docker compose logs -f jenkins` |
| Jenkins | `No such DSL method 'pipelineJob'` | Job DSL plugin missing | Rebuild image; check `jenkins/plugins.txt` |
| Jenkins | `git: command not found` | Image build failed/old image | `docker compose build --no-cache jenkins` |
| Jenkins | `Cannot connect to the Docker daemon` | Socket not mounted | Confirm `/var/run/docker.sock` volume and Docker Desktop running |
| Jenkins | Pipeline fails at Selenium | Chrome grid not ready / shm too small | The pipeline waits 120 s; keep `--shm-size=2g`; check `docker logs selenium-ci-*` |
| Jenkins | Pipeline cannot find job | JCasC not applied | Recreate Jenkins; check logs for `Configuration as Code` |
| K8s | `connection refused` | Cluster disabled | Enable Kubernetes, wait for green |
| K8s | `ImagePullBackOff` | Image not in cluster | Import with `ctr` or push to a registry |
| K8s | PVC pending | No default StorageClass | Docker Desktop provides one; check `kubectl get storageclass` |
| K8s | 30080 unreachable | NodePort/firewall | `kubectl get svc`; try `port-forward` |
| Tests | Selenium can't start Chrome | Chrome/driver mismatch | Let Selenium Manager resolve it, or use the Selenium container |
| Tests | Duplicate roll number | Previous failed run left data | Tests use unique suffixes; reset the DB for a clean slate |
| Node | `node:sqlite` not found | Node < 24 | Install Node 24 LTS or newer |

---

## 11. Security hardening

The demo is intentionally easy to run. For anything beyond a local lab:

1. **Jenkins credentials** — change `admin123` in `jenkins/casc/jenkins.yaml`; use a strong password
   or integrate LDAP/OIDC. Remove the demo user from source control.
2. **Docker socket** — mounting `/var/run/docker.sock` gives Jenkins root-equivalent control of the
   host. Prefer a dedicated Jenkins agent, rootless Docker, or a remote Docker host. Restrict who
   can create/modify jobs.
3. **Jenkins URL/TLS** — put Jenkins behind a reverse proxy with HTTPS; set the correct external URL
   in JCasC.
4. **Application auth** — AttendX has no login. Add authentication/authorization before exposing it.
5. **Database** — SQLite is single-writer. Keep one replica and `Recreate`; back up the volume/PVC.
   For multi-user production, migrate to PostgreSQL.
6. **Secrets** — use Kubernetes Secrets or a vault for credentials; do not bake them into images.
7. **Images** — pin base image digests and plugin versions; scan images (Docker Scout/Trivy).
8. **Network** — bind Jenkins to localhost or a private network; do not publish port 8080 publicly.
9. **Backups** — schedule backups of `attendance-data` and `jenkins-home`; test restores.
10. **Updates** — keep Docker Desktop, Jenkins LTS, plugins, Node and kubectl patched.

---

## 12. Verification checklist

The checklist below was completed successfully in the validation run on October 28, 2026
(Docker Desktop 4.97.0, Kubernetes 1.36.1). Re-run it to verify your own environment.

- [x] `docker version` and `docker compose version` work.
- [x] `docker compose up -d --build` starts `attendance-app` and `attendance-jenkins`.
- [x] <http://localhost:3000> loads; `/api/health` returns `status: ok`.
- [x] `docker compose ps` shows both containers healthy.
- [x] <http://localhost:8080> loads; `admin` / `admin123` works.
- [x] `student-attendance-pipeline` exists and a build succeeds.
- [x] Jenkins console shows 13 API tests and 9 Selenium tests passing.
- [x] `kubectl get nodes` shows a Ready node.
- [x] `.\scripts\deploy-k8s.ps1` completes and <http://localhost:30080> loads via port-forward.
- [x] `kubectl -n student-attendance get pvc` shows `Bound`.
- [x] Restarting the pod keeps attendance data.
- [x] `.\scripts\smoke-test.ps1` passes against the chosen URL.

---

## 13. Cleanup / uninstall

```powershell
# Stop the Compose stack and remove its volumes
docker compose down -v

# Remove the Kubernetes resources
kubectl delete -k k8s/

# Optional: remove local images
docker rmi student-attendance:local student-attendance:latest student-attendance-jenkins:local

# Optional: disable Kubernetes in Docker Desktop
# Settings → Kubernetes → uncheck Enable Kubernetes → Apply & restart
```

To uninstall Docker Desktop itself, use **Settings → Troubleshoot → Uninstall** or
`winget uninstall Docker.DockerDesktop`.
