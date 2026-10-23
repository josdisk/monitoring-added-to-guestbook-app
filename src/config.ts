import * as pulumi from "@pulumi/pulumi";

/**
 * Shared stack configuration.
 * isMinikube switches external services to NodePort/ClusterIP because
 * minikube does not provision cloud LoadBalancers.
 */
const config = new pulumi.Config();

export const isMinikube = config.getBoolean("isMinikube") ?? false;

/** Grafana admin user is always "admin"; password comes from stack config. */
export const grafanaAdminUser = "admin";
export const grafanaAdminPassword =
    config.getSecret("grafanaAdminPassword") ??
    pulumi.output("guestbook-admin");

export const guestbookNamespaceName = "guestbook";
export const monitoringNamespaceName = "monitoring";

/** Labels applied across Guestbook workloads so ServiceMonitors can select them. */
export const guestbookAppLabel = "guestbook";
