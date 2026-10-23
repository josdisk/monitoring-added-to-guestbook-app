import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { guestbookAppLabel, guestbookNamespaceName } from "../config";

export interface ServiceMonitorsArgs {
    monitoringNamespace: pulumi.Input<string>;
    /** Ensure the prometheus-operator CRDs exist before creating these. */
    dependsOn?: pulumi.Resource[];
}

/**
 * ServiceMonitor CRs tell prometheus-operator which Guestbook Services to scrape.
 */
export class GuestbookServiceMonitors extends pulumi.ComponentResource {
    constructor(name: string, args: ServiceMonitorsArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:monitoring:ServiceMonitors", name, {}, opts);

        const childOpts: pulumi.ComponentResourceOptions = {
            parent: this,
            dependsOn: args.dependsOn,
            // CRDs come from the Helm chart; provider needs to accept unknown kinds at preview.
            customTimeouts: { create: "5m" },
        };

        // Frontend nginx-prometheus-exporter (:9113)
        new k8s.apiextensions.CustomResource(
            `${name}-frontend`,
            {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: "guestbook-frontend",
                    namespace: args.monitoringNamespace,
                    labels: {
                        app: guestbookAppLabel,
                        release: "kube-prometheus-stack",
                    },
                },
                spec: {
                    namespaceSelector: {
                        matchNames: [guestbookNamespaceName],
                    },
                    selector: {
                        matchLabels: {
                            app: guestbookAppLabel,
                            component: "frontend",
                        },
                    },
                    endpoints: [
                        {
                            port: "metrics",
                            path: "/metrics",
                            interval: "15s",
                            scrapeTimeout: "10s",
                        },
                    ],
                },
            },
            childOpts,
        );

        // Redis exporter (:9121)
        new k8s.apiextensions.CustomResource(
            `${name}-redis`,
            {
                apiVersion: "monitoring.coreos.com/v1",
                kind: "ServiceMonitor",
                metadata: {
                    name: "guestbook-redis",
                    namespace: args.monitoringNamespace,
                    labels: {
                        app: guestbookAppLabel,
                        release: "kube-prometheus-stack",
                    },
                },
                spec: {
                    namespaceSelector: {
                        matchNames: [guestbookNamespaceName],
                    },
                    selector: {
                        matchLabels: {
                            app: guestbookAppLabel,
                            component: "redis-exporter",
                        },
                    },
                    endpoints: [
                        {
                            port: "metrics",
                            path: "/metrics",
                            interval: "15s",
                            scrapeTimeout: "10s",
                        },
                    ],
                },
            },
            childOpts,
        );

        this.registerOutputs({});
    }
}
