import { Guestbook } from "./src/guestbook";
import { MonitoringStack } from "./src/monitoring";
import { grafanaAdminUser } from "./src/config";

/**
 * Entry point: Guestbook application + Prometheus/Grafana monitoring.
 *
 * Deploy with:
 *   pulumi stack select dev
 *   pulumi up
 */

const guestbook = new Guestbook("guestbook");

const monitoring = new MonitoringStack("monitoring", {
    guestbookNamespace: guestbook.namespace.metadata.name,
});

// --- Stack outputs (shown after `pulumi up`) ---

export const frontendUrl = guestbook.frontend.endpoint;

export const grafanaUrl = monitoring.grafanaUrl;
export const grafanaAdminUsername = monitoring.grafanaAdminUser;
export const grafanaAdminPassword = monitoring.grafanaAdminPassword;

export const guestbookNamespace = guestbook.namespace.metadata.name;
export const monitoringNamespace = monitoring.namespace.metadata.name;

/** Quick reference printed in stack outputs. */
export const accessSummary = {
    grafanaUser: grafanaAdminUser,
    note: "Use grafanaUrl + grafanaAdminPassword outputs to sign in. Default password is guestbook-admin unless overridden via pulumi config.",
};
