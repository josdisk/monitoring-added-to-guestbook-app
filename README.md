# Guestbook with Prometheus & Grafana

Pulumi TypeScript project that deploys the classic [Kubernetes Guestbook](https://kubernetes.io/docs/tutorials/stateless-application/guestbook/) and adds monitoring with **Prometheus** and **Grafana**.

Based on the [Pulumi kubernetes-ts-guestbook](https://github.com/pulumi/examples/blob/master/kubernetes-ts-guestbook/README.md) example, extended with:

- `kube-prometheus-stack` (Helm) for Prometheus and Grafana (Alertmanager is disabled to keep the demo small)
- nginx reverse proxy + `nginx-prometheus-exporter` on the frontend (request metrics)
- `redis_exporter` for Redis metrics
- `ServiceMonitor` resources so prometheus-operator discovers Guestbook targets
- A starter Grafana dashboard (request rate, Redis, pod CPU/memory)

## Architecture

```
guestbook namespace
├── redis-leader / redis-replica
├── frontend (PHP + nginx proxy + nginx-exporter)
└── redis-exporter

monitoring namespace
├── kube-prometheus-stack (Prometheus + Grafana)
├── ServiceMonitors → guestbook frontend & redis-exporter
└── Grafana dashboard ConfigMap (auto-loaded by sidecar)
```

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- Node.js 18+
- A Kubernetes cluster and a working `kubectl` context  
  (minikube works; aim for ~3 CPUs and ~6GB RAM so Prometheus/Grafana fit)
- Helm is **not** required on your machine; Pulumi talks to the cluster API directly

## Deploy

```bash
# 1. Install dependencies
npm install

# 2. Log in to Pulumi (local file backend is fine for a demo)
pulumi login --local
# Local backend needs a passphrase in this shell:
export PULUMI_CONFIG_PASSPHRASE='guestbook-demo'

# 3. Create / select a stack
pulumi stack init dev   # skip if the stack already exists
pulumi stack select dev

# 4. Config
# Optional: override the Grafana admin password
pulumi config set --secret grafanaAdminPassword 'your-secure-password'

# Minikube users (NodePort instead of LoadBalancer; 1 frontend replica):
pulumi config set isMinikube true

# 5. Deploy
pulumi up
```

First install of `kube-prometheus-stack` can take several minutes while images pull and pods come up. The Helm release timeout is set to 15 minutes for smaller clusters.

## Grafana access

After a successful deploy:

```bash
pulumi stack output grafanaUrl
pulumi stack output grafanaAdminUsername
pulumi stack output grafanaAdminPassword --show-secrets
```

| Item | Value |
|------|--------|
| URL | Stack output `grafanaUrl` (LoadBalancer on cloud; NodePort `32000` on minikube) |
| Username | `admin` |
| Password | Stack config `grafanaAdminPassword` (default: `guestbook-admin`) |

Open Grafana → **Dashboards** → **Guestbook Application**.

If the LoadBalancer is still provisioning, `grafanaUrl` may show `pending`. Wait a minute and re-run `pulumi stack output grafanaUrl`.

### Reliable access via port-forward (recommended on minikube / Docker Desktop)

`minikube service` can hang on Docker Desktop for macOS. Port-forward is the reliable path:

```bash
# Leave each command running in its own terminal
kubectl port-forward -n monitoring svc/kube-prometheus-stack-grafana 13000:80
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 19090:9090
kubectl port-forward -n guestbook svc/frontend 18080:80
```

Then open:

| Service | URL |
|---------|-----|
| Grafana | http://127.0.0.1:13000 (admin / guestbook-admin) |
| Prometheus targets | http://127.0.0.1:19090/targets |
| Guestbook app | http://127.0.0.1:18080 |

Ports `13000` / `19090` / `18080` avoid common conflicts with local Grafana/Prometheus on `3000` / `9090`.

### Minikube NodePort (optional)

```bash
minikube service -n monitoring kube-prometheus-stack-grafana
# Grafana NodePort is fixed at 32000 when isMinikube=true
```

## Guestbook frontend

```bash
pulumi stack output frontendUrl
```

On cloud providers this is the LoadBalancer URL. On minikube the output points you at NodePort / `minikube service`; the port-forward above is usually easier.

## Verify Prometheus is scraping Guestbook metrics

### 1. Check ServiceMonitors

```bash
kubectl get servicemonitors -n monitoring
# Expect: guestbook-frontend, guestbook-redis (plus chart defaults)
```

### 2. Check Prometheus targets

With the Prometheus port-forward running, open http://127.0.0.1:19090/targets and confirm these are **UP**:

- `serviceMonitor/monitoring/guestbook-frontend/0` (nginx exporter on `:9113`)
- `serviceMonitor/monitoring/guestbook-redis/0` (redis exporter on `:9121`)

### 3. Run a few PromQL queries

In Prometheus → Graph, or Grafana Explore:

```promql
# Frontend request rate (needs a bit of traffic)
sum(rate(nginx_http_requests_total{namespace="guestbook"}[5m]))

# Redis is up
redis_up{namespace="guestbook"}

# Guestbook pod CPU
sum(rate(container_cpu_usage_seconds_total{namespace="guestbook", container!="", container!="POD"}[5m])) by (pod)
```

Generate traffic if request metrics look empty (with the frontend port-forward up):

```bash
for i in $(seq 1 50); do curl -s http://127.0.0.1:18080/ >/dev/null; done
```

### 4. Annotation-based discovery (backup path)

Frontend and redis-exporter pods also carry:

```text
prometheus.io/scrape: "true"
prometheus.io/port:   "9113" | "9121"
prometheus.io/path:   "/metrics"
```

Primary discovery in this project is via **ServiceMonitor**; annotations are there for clusters that scrape by annotation instead.

## Project layout

```text
index.ts                 # stack entry + outputs
src/
  config.ts              # shared config
  guestbook/             # Redis + frontend
  monitoring/            # Helm stack, exporters, ServiceMonitors, dashboard
assets/
  nginx/proxy.conf       # frontend reverse proxy + stub_status
  dashboards/guestbook.json
```

## Tear down

```bash
export PULUMI_CONFIG_PASSPHRASE='guestbook-demo'   # if using local backend
pulumi destroy
```

## Notes

- Default Grafana password (`guestbook-admin`) is fine for demos; change it for any shared cluster.
- `kube-prometheus-stack` chart version is pinned (`65.1.0`) for reproducible installs.
- Alertmanager and control-plane scrapes (etcd, scheduler, …) are disabled to keep the demo footprint small.
- On minikube the frontend runs with 1 replica (3 on cloud) so the stack fits in ~6GB of cluster memory.
- If a browser shows `ERR_CONNECTION_REFUSED`, the `kubectl port-forward` process for that port has stopped — start it again and retry.
