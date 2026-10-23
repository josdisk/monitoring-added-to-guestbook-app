import * as fs from "fs";
import * as path from "path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { guestbookAppLabel, isMinikube } from "../config";

export interface FrontendArgs {
    namespace: pulumi.Input<string>;
}

/**
 * Guestbook PHP frontend with an nginx reverse proxy and nginx-prometheus-exporter sidecar.
 *
 * Traffic flow:
 *   Service :80 -> nginx :8080 -> PHP :80
 * Prometheus scrapes the exporter on :9113 (nginx stub_status request counters).
 */
export class Frontend extends pulumi.ComponentResource {
    public readonly service: k8s.core.v1.Service;
    public readonly deployment: k8s.apps.v1.Deployment;
    public readonly endpoint: pulumi.Output<string>;

    constructor(name: string, args: FrontendArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:k8s:Frontend", name, {}, opts);

        const childOpts: pulumi.ComponentResourceOptions = { parent: this };

        const labels = {
            app: guestbookAppLabel,
            tier: "frontend",
            component: "frontend",
        };

        // Resolve from the project root so this works whether Pulumi runs
        // TypeScript directly or from a compiled bin/ output.
        const nginxConf = fs.readFileSync(
            path.join(process.cwd(), "assets/nginx/proxy.conf"),
            "utf8",
        );

        const nginxConfig = new k8s.core.v1.ConfigMap(
            `${name}-nginx`,
            {
                metadata: {
                    namespace: args.namespace,
                    name: "frontend-nginx-config",
                    labels,
                },
                data: {
                    "default.conf": nginxConf,
                },
            },
            childOpts,
        );

        this.deployment = new k8s.apps.v1.Deployment(
            name,
            {
                metadata: {
                    namespace: args.namespace,
                    name: "frontend",
                    labels,
                },
                spec: {
                    replicas: 3,
                    selector: { matchLabels: labels },
                    template: {
                        metadata: {
                            labels,
                            annotations: {
                                "prometheus.io/scrape": "true",
                                "prometheus.io/port": "9113",
                                "prometheus.io/path": "/metrics",
                            },
                        },
                        spec: {
                            volumes: [
                                {
                                    name: "nginx-config",
                                    configMap: { name: nginxConfig.metadata.name },
                                },
                            ],
                            containers: [
                                {
                                    name: "frontend",
                                    image: "pulumi/guestbook-php-redis",
                                    resources: {
                                        requests: { cpu: "100m", memory: "100Mi" },
                                        limits: { cpu: "250m", memory: "256Mi" },
                                    },
                                    env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                                    ports: [{ name: "http-php", containerPort: 80 }],
                                },
                                {
                                    name: "nginx-proxy",
                                    image: "nginx:1.25-alpine",
                                    resources: {
                                        requests: { cpu: "50m", memory: "64Mi" },
                                        limits: { cpu: "100m", memory: "128Mi" },
                                    },
                                    ports: [
                                        { name: "http", containerPort: 8080 },
                                        { name: "stub", containerPort: 8081 },
                                    ],
                                    volumeMounts: [
                                        {
                                            name: "nginx-config",
                                            mountPath: "/etc/nginx/conf.d",
                                            readOnly: true,
                                        },
                                    ],
                                    readinessProbe: {
                                        httpGet: { path: "/", port: 8080 },
                                        initialDelaySeconds: 5,
                                        periodSeconds: 5,
                                    },
                                },
                                {
                                    name: "nginx-exporter",
                                    image: "nginx/nginx-prometheus-exporter:1.1.0",
                                    args: [
                                        "--nginx.scrape-uri=http://127.0.0.1:8081/stub_status",
                                    ],
                                    resources: {
                                        requests: { cpu: "20m", memory: "32Mi" },
                                        limits: { cpu: "50m", memory: "64Mi" },
                                    },
                                    ports: [{ name: "metrics", containerPort: 9113 }],
                                },
                            ],
                        },
                    },
                },
            },
            childOpts,
        );

        this.service = new k8s.core.v1.Service(
            name,
            {
                metadata: {
                    namespace: args.namespace,
                    name: "frontend",
                    labels,
                    annotations: {
                        "prometheus.io/scrape": "true",
                        "prometheus.io/port": "9113",
                        "prometheus.io/path": "/metrics",
                    },
                },
                spec: {
                    type: isMinikube ? "NodePort" : "LoadBalancer",
                    ports: [
                        { name: "http", port: 80, targetPort: 8080 },
                        // Keep metrics reachable in-cluster for ServiceMonitor targets.
                        { name: "metrics", port: 9113, targetPort: 9113 },
                    ],
                    selector: labels,
                },
            },
            childOpts,
        );

        this.endpoint = isMinikube
            ? this.service.spec.ports.apply((ports) => {
                  const http = ports?.find((p) => p.name === "http");
                  return `NodePort ${http?.nodePort ?? "pending"} — run: minikube service -n guestbook frontend`;
              })
            : this.service.status.apply((status) => {
                  const ingress = status?.loadBalancer?.ingress?.[0];
                  if (!ingress) {
                      return "pending — waiting for LoadBalancer";
                  }
                  const host = ingress.hostname ?? ingress.ip;
                  return `http://${host}`;
              });

        this.registerOutputs({
            service: this.service,
            deployment: this.deployment,
            endpoint: this.endpoint,
        });
    }
}
