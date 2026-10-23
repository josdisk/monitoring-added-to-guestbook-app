import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { guestbookAppLabel, guestbookNamespaceName } from "../config";

export interface RedisExporterArgs {
    namespace: pulumi.Input<string>;
    /**
     * DNS name of the Redis leader Service (host only, no port).
     * Example: redis-leader.guestbook.svc
     */
    redisHost: pulumi.Input<string>;
}

/**
 * Sidecar-style exporter that turns Redis INFO into Prometheus metrics.
 * Scraped via ServiceMonitor in the monitoring module.
 */
export class RedisExporter extends pulumi.ComponentResource {
    public readonly service: k8s.core.v1.Service;

    constructor(name: string, args: RedisExporterArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:monitoring:RedisExporter", name, {}, opts);

        const childOpts: pulumi.ComponentResourceOptions = { parent: this };

        const labels = {
            app: guestbookAppLabel,
            component: "redis-exporter",
            tier: "backend",
        };

        new k8s.apps.v1.Deployment(
            name,
            {
                metadata: {
                    namespace: args.namespace,
                    name: "redis-exporter",
                    labels,
                },
                spec: {
                    replicas: 1,
                    selector: { matchLabels: labels },
                    template: {
                        metadata: {
                            labels,
                            annotations: {
                                "prometheus.io/scrape": "true",
                                "prometheus.io/port": "9121",
                                "prometheus.io/path": "/metrics",
                            },
                        },
                        spec: {
                            containers: [
                                {
                                    name: "redis-exporter",
                                    image: "oliver006/redis_exporter:v1.58.0",
                                    env: [
                                        {
                                            name: "REDIS_ADDR",
                                            value: pulumi.interpolate`redis://${args.redisHost}:6379`,
                                        },
                                    ],
                                    ports: [{ name: "metrics", containerPort: 9121 }],
                                    resources: {
                                        requests: { cpu: "50m", memory: "64Mi" },
                                        limits: { cpu: "100m", memory: "128Mi" },
                                    },
                                    readinessProbe: {
                                        httpGet: { path: "/health", port: 9121 },
                                        initialDelaySeconds: 5,
                                        periodSeconds: 10,
                                    },
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
                    name: "redis-exporter",
                    labels,
                },
                spec: {
                    ports: [{ name: "metrics", port: 9121, targetPort: 9121 }],
                    selector: labels,
                },
            },
            childOpts,
        );

        this.registerOutputs({ service: this.service });
    }
}

/** Convenience host for the in-cluster Redis leader Service. */
export const redisLeaderHost = `${"redis-leader"}.${guestbookNamespaceName}.svc`;
