import * as fs from "fs";
import * as path from "path";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";

export interface GuestbookDashboardArgs {
    namespace: pulumi.Input<string>;
}

/**
 * Publishes a Grafana dashboard ConfigMap.
 * kube-prometheus-stack's Grafana sidecar picks up ConfigMaps labeled
 * grafana_dashboard=1 and loads them automatically.
 */
export class GuestbookDashboard extends pulumi.ComponentResource {
    public readonly configMap: k8s.core.v1.ConfigMap;

    constructor(name: string, args: GuestbookDashboardArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:monitoring:Dashboard", name, {}, opts);

        const dashboardJson = fs.readFileSync(
            path.join(process.cwd(), "assets/dashboards/guestbook.json"),
            "utf8",
        );

        this.configMap = new k8s.core.v1.ConfigMap(
            name,
            {
                metadata: {
                    namespace: args.namespace,
                    name: "guestbook-grafana-dashboard",
                    labels: {
                        grafana_dashboard: "1",
                        app: "guestbook",
                    },
                },
                data: {
                    "guestbook.json": dashboardJson,
                },
            },
            { parent: this },
        );

        this.registerOutputs({ configMap: this.configMap });
    }
}
