import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { guestbookNamespaceName } from "../config";
import { Frontend } from "./frontend";
import { Redis } from "./redis";

/**
 * Full Guestbook application: namespace, Redis, and PHP frontend.
 */
export class Guestbook extends pulumi.ComponentResource {
    public readonly namespace: k8s.core.v1.Namespace;
    public readonly redis: Redis;
    public readonly frontend: Frontend;

    constructor(name: string, opts?: pulumi.ComponentResourceOptions) {
        super("guestbook:k8s:Guestbook", name, {}, opts);

        const childOpts: pulumi.ComponentResourceOptions = { parent: this };

        this.namespace = new k8s.core.v1.Namespace(
            `${name}-ns`,
            {
                metadata: {
                    name: guestbookNamespaceName,
                    labels: { app: "guestbook" },
                },
            },
            childOpts,
        );

        this.redis = new Redis(
            `${name}-redis`,
            { namespace: this.namespace.metadata.name },
            childOpts,
        );

        this.frontend = new Frontend(
            `${name}-frontend`,
            { namespace: this.namespace.metadata.name },
            { ...childOpts, dependsOn: [this.redis.leaderService, this.redis.replicaService] },
        );

        this.registerOutputs({
            namespace: this.namespace,
            frontendEndpoint: this.frontend.endpoint,
        });
    }
}
