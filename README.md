# Guestbook with Prometheus & Grafana

Pulumi TypeScript project that deploys the classic [Kubernetes Guestbook](https://kubernetes.io/docs/tutorials/stateless-application/guestbook/) and adds monitoring with **Prometheus** and **Grafana**.

Based on the [Pulumi kubernetes-ts-guestbook](https://github.com/pulumi/examples/blob/master/kubernetes-ts-guestbook/README.md) example, extended with:

- `kube-prometheus-stack` (Helm) for Prometheus, Alertmanager, and Grafana
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
├── kube-prometheus-stack (Prometheus, Grafana, …)
├── ServiceMonitors → guestbook frontend & redis-exporter
└── Grafana dashboard ConfigMap (auto-loaded by sidecar)
```

## Prerequisites

- [Pulumi CLI](https://www.pulumi.com/docs/install/)
- Node.js 18+
- A Kubernetes cluster and a working `kubectl` context
- Helm is **not** required on your machine; Pulumi talks to the cluster API directly

## Deploy

```bash
# 1. Install dependencies
npm install

# 2. Create / select a stack
pulumi stack init dev   # skip if the stack already exists
pulumi stack select dev

# 3. Point Pulumi at your cluster (uses current kubeconfig)
# Optional: override the Grafana admin password
pulumi config set --secret grafanaAdminPassword 'your-secure-password'

# Minikube users:
pulumi config set isMinikube true

# 4. Deploy
pulumi up
```

First install of `kube-prometheus-stack` can take several minutes while CRDs and pods come up.

## Grafana access

After a successful deploy:

```bash
pulumi stack output grafanaUrl
pulumi stack output grafanaAdminUsername
pulumi stack output grafanaAdminPassword
```

| Item | Value |
|------|--------|
| URL | Stack output `grafanaUrl` (LoadBalancer on cloud; `http://$(minikube ip):32000` on minikube) |
| Username | `admin` |
| Password | Stack config `grafanaAdminPassword` (default: `guestbook-admin`) |

Open Grafana → **Dashboards** → **Guestbook Application**.

If the LoadBalancer is still provisioning, `grafanaUrl` may show `pending`. Wait a minute and re-run `pulumi stack output grafanaUrl`.

### Minikube tip

```bash
minikube service -n monitoring kube-prometheus-stack-grafana
```

## Guestbook frontend

```bash
pulumi stack output frontendUrl
```

On cloud providers this is the LoadBalancer address. On minikube, use the NodePort from the frontend Service or `minikube service -n guestbook frontend`.

## Verify Prometheus is scraping Guestbook metrics

### 1. Check ServiceMonitors

```bash
kubectl get servicemonitors -n monitoring
# Expect: guestbook-frontend, guestbook-redis (plus chart defaults)
```

### 2. Check Prometheus targets

Port-forward Prometheus:

```bash
kubectl port-forward -n monitoring svc/kube-prometheus-stack-prometheus 9090:9090
```

Open http://localhost:9090/targets and confirm these jobs are **UP**:

- `guestbook-frontend` (nginx exporter on `:9113`)
- `guestbook-redis` (redis exporter on `:9121`)

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

Generate traffic if request metrics look empty:

```bash
FRONTEND=$(pulumi stack output frontendUrl)
for i in $(seq 1 50); do curl -s "$FRONTEND" >/dev/null; done
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
pulumi destroy
```

## Notes

- Default Grafana password is fine for demos; change it for any shared cluster.
- `kube-prometheus-stack` chart version is pinned (`65.1.0`) for reproducible installs.
- Control-plane component scrapes (etcd, scheduler, …) are disabled to keep the demo footprint small.
