import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import {
    grafanaAdminPassword,
    grafanaAdminUser,
    isMinikube,
    monitoringNamespaceName,
} from "../config";
import { GuestbookDashboard } from "./dashboard";
import { RedisExporter, redisLeaderHost } from "./redis-exporter";
import { GuestbookServiceMonitors } from "./servicemonitors";

export interface MonitoringStackArgs {
    guestbookNamespace: pulumi.Input<string>;
}

/**
 * Deploys kube-prometheus-stack (Prometheus + Grafana) via Helm,
 * plus Guestbook-specific exporters, ServiceMonitors, and a starter dashboard.
 */
export class MonitoringStack extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly helmRelease: k8s.helm.v3.Release;
    public readonly grafanaUrl: pulumi.Output<string>;
    public readonly grafanaAdminUser: pulumi.Output<string>;
    public readonly grafanaAdminPassword: pulumi.Output<string>;

    constructor(name: string, args: MonitoringStackArgs, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:monitoring:Stack", name, {}, opts);

        const childOpts: pulumi.ComponentResourceOptions = { parent: this };

        this.namespace = new k8s.core.v1.Namespace(
            `${name}-ns`,
            {
                metadata: {
                    name: monitoringNamespaceName,
                    labels: { app: "monitoring" },
                },
            },
            childOpts,
        );

        const grafanaServiceType = isMinikube ? "NodePort" : "LoadBalancer";

        this.helmRelease = new k8s.helm.v3.Release(
            `${name}-kube-prometheus`,
            {
                name: "kube-prometheus-stack",
                chart: "kube-prometheus-stack",
                version: "65.1.0",
                namespace: this.namespace.metadata.name,
                repositoryOpts: {
                    repo: "https://prometheus-community.github.io/helm-charts",
                },
                values: {
                    // Allow ServiceMonitors from any namespace / without the chart's release label.
                    prometheus: {
                        prometheusSpec: {
                            serviceMonitorSelectorNilUsesHelmValues: false,
                            podMonitorSelectorNilUsesHelmValues: false,
                            ruleSelectorNilUsesHelmValues: false,
                            serviceMonitorNamespaceSelector: {},
                            retention: "7d",
                            resources: {
                                requests: { cpu: "200m", memory: "512Mi" },
                                limits: { cpu: "1", memory: "2Gi" },
                            },
                        },
                    },
                    alertmanager: {
                        enabled: true,
                    },
                    grafana: {
                        enabled: true,
                        adminUser: grafanaAdminUser,
                        adminPassword: grafanaAdminPassword,
                        service: {
                            type: grafanaServiceType,
                            port: 80,
                            // Stable NodePort on minikube so docs stay accurate.
                            ...(isMinikube ? { nodePort: 32000 } : {}),
                        },
                        sidecar: {
                            dashboards: {
                                enabled: true,
                                label: "grafana_dashboard",
                                labelValue: "1",
                                searchNamespace: "ALL",
                            },
                        },
                        // Pre-select Prometheus as the default datasource.
                        datasources: {
                            "datasources.yaml": {
                                apiVersion: 1,
                                datasources: [
                                    {
                                        name: "Prometheus",
                                        type: "prometheus",
                                        url: "http://kube-prometheus-stack-prometheus:9090",
                                        access: "proxy",
                                        isDefault: true,
                                    },
                                ],
                            },
                        },
                    },
                    // Keep the install lean for a demo cluster.
                    kubeEtcd: { enabled: false },
                    kubeControllerManager: { enabled: false },
                    kubeScheduler: { enabled: false },
                    kubeProxy: { enabled: false },
                },
                // CRDs are large; give Helm enough time on first install.
                timeout: 600,
            },
            { ...childOpts, dependsOn: [this.namespace] },
        );

        const redisExporter = new RedisExporter(
            `${name}-redis-exporter`,
            {
                namespace: args.guestbookNamespace,
                redisHost: redisLeaderHost,
            },
            { ...childOpts, dependsOn: [this.helmRelease] },
        );

        new GuestbookServiceMonitors(
            `${name}-servicemonitors`,
            {
                monitoringNamespace: this.namespace.metadata.name,
                dependsOn: [this.helmRelease, redisExporter.service],
            },
            childOpts,
        );

        new GuestbookDashboard(
            `${name}-dashboard`,
            { namespace: this.namespace.metadata.name },
            { ...childOpts, dependsOn: [this.helmRelease] },
        );

        this.grafanaAdminUser = pulumi.output(grafanaAdminUser);
        this.grafanaAdminPassword = grafanaAdminPassword;

        // Resolve the Grafana Service created by the Helm chart.
        const grafanaService = k8s.core.v1.Service.get(
            `${name}-grafana-svc`,
            pulumi.interpolate`${monitoringNamespaceName}/kube-prometheus-stack-grafana`,
            { parent: this, dependsOn: [this.helmRelease] },
        );

        this.grafanaUrl = isMinikube
            ? pulumi.output("http://$(minikube ip):32000")
            : grafanaService.status.apply((status) => {
                  const ingress = status?.loadBalancer?.ingress?.[0];
                  if (!ingress) {
                      return "pending — run `pulumi stack output grafanaUrl` after the LoadBalancer is ready";
                  }
                  const host = ingress.hostname ?? ingress.ip;
                  return `http://${host}`;
              });

        this.registerOutputs({
            grafanaUrl: this.grafanaUrl,
            grafanaAdminUser: this.grafanaAdminUser,
            grafanaAdminPassword: this.grafanaAdminPassword,
        });
    }
}
