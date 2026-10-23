import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { guestbookAppLabel } from "../config";

export interface RedisArgs {
    namespace: pulumi.Input<string>;
}

/**
 * Redis leader + replica pair used by the Guestbook frontend for reads/writes.
 */
export class Redis extends pulumi.ComponentResource {
    public readonly leaderService: k8s.core.v1.Service;
    public readonly replicaService: k8s.core.v1.Service;

    constructor(name: string, args: RedisArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:k8s:Redis", name, {}, opts);

        const childOpts: pulumi.ComponentResourceOptions = { parent: this };

        const leaderLabels = {
            app: guestbookAppLabel,
            tier: "backend",
            role: "leader",
            component: "redis-leader",
        };

        new k8s.apps.v1.Deployment(
            `${name}-leader`,
            {
                metadata: {
                    namespace: args.namespace,
                    name: "redis-leader",
                    labels: leaderLabels,
                },
                spec: {
                    selector: { matchLabels: leaderLabels },
                    replicas: 1,
                    template: {
                        metadata: {
                            labels: leaderLabels,
                            annotations: {
                                // redis-exporter scrapes the leader; these annotations
                                // keep discovery consistent if annotation-based scrape is used.
                                "prometheus.io/scrape": "false",
                            },
                        },
                        spec: {
                            containers: [
                                {
                                    name: "redis-leader",
                                    image: "redis:7.2-alpine",
                                    resources: {
                                        requests: { cpu: "100m", memory: "100Mi" },
                                        limits: { cpu: "250m", memory: "256Mi" },
                                    },
                                    ports: [{ name: "redis", containerPort: 6379 }],
                                    readinessProbe: {
                                        tcpSocket: { port: 6379 },
                                        initialDelaySeconds: 5,
                                        periodSeconds: 5,
                                    },
                                    livenessProbe: {
                                        tcpSocket: { port: 6379 },
                                        initialDelaySeconds: 15,
                                        periodSeconds: 20,
                                    },
                                },
                            ],
                        },
                    },
                },
            },
            childOpts,
        );

        this.leaderService = new k8s.core.v1.Service(
            `${name}-leader`,
            {
                metadata: {
                    namespace: args.namespace,
                    name: "redis-leader",
                    labels: leaderLabels,
                },
                spec: {
                    ports: [{ name: "redis", port: 6379, targetPort: 6379 }],
                    selector: leaderLabels,
                },
            },
            childOpts,
        );

        const replicaLabels = {
            app: guestbookAppLabel,
            tier: "backend",
            role: "replica",
            component: "redis-replica",
        };

        new k8s.apps.v1.Deployment(
            `${name}-replica`,
            {
                metadata: {
                    namespace: args.namespace,
                    name: "redis-replica",
                    labels: replicaLabels,
                },
                spec: {
                    selector: { matchLabels: replicaLabels },
                    replicas: 2,
                    template: {
                        metadata: { labels: replicaLabels },
                        spec: {
                            containers: [
                                {
                                    name: "redis-replica",
                                    // Official Guestbook replica image: connects to redis-leader via DNS.
                                    image: "pulumi/guestbook-redis-replica",
                                    resources: {
                                        requests: { cpu: "100m", memory: "100Mi" },
                                        limits: { cpu: "250m", memory: "256Mi" },
                                    },
                                    env: [{ name: "GET_HOSTS_FROM", value: "dns" }],
                                    ports: [{ name: "redis", containerPort: 6379 }],
                                },
                            ],
                        },
                    },
                },
            },
            childOpts,
        );

        this.replicaService = new k8s.core.v1.Service(
            `${name}-replica`,
            {
                metadata: {
                    namespace: args.namespace,
                    name: "redis-replica",
                    labels: replicaLabels,
                },
                spec: {
                    ports: [{ name: "redis", port: 6379, targetPort: 6379 }],
                    selector: replicaLabels,
                },
            },
            childOpts,
        );

        this.registerOutputs({
            leaderService: this.leaderService,
            replicaService: this.replicaService,
        });
    }
}
