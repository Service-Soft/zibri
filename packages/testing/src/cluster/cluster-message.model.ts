/**
 * Everything that crosses the boundary between the jest process and a cluster instance.
 *
 * Deliberately small. Instances are driven over http like any other server - the parent holds one
 * base url per instance, so it can already address a specific one - and observed through the data
 * source. Ipc is only used for the handshake, where http cannot help:
 *
 * - the parent has to learn which port the instance bound, because it starts on port 0
 * - a boot failure has to come back as the error that caused it, not as a timeout with no reason.
 *
 * A class cannot be sent over ipc, so nothing here refers to one. An instance is configured by the
 * path of a module that it imports itself, which is why the only thing that has to travel is the
 * port each of the declared data sources ended up on. Nothing here knows what kind of storage those
 * are - that stays where it belongs, in the data source.
 */

/**
 * The environment variable through which an instance learns its own id.
 */
export const CLUSTER_INSTANCE_ID_ENV: string = 'ZIBRI_CLUSTER_INSTANCE_ID';

/**
 * The environment variable holding the absolute path of the module that default exports the
 * StartTestServerOptions every instance boots with.
 */
export const CLUSTER_INSTANCE_OPTIONS_ENV: string = 'ZIBRI_CLUSTER_INSTANCE_OPTIONS';

/**
 * The environment variable holding the host ports the declared data sources got mapped to, as a
 * json number array in the order they are declared in.
 */
export const CLUSTER_DATA_SOURCE_PORTS_ENV: string = 'ZIBRI_CLUSTER_DATA_SOURCE_PORTS';

/**
 * The environment variable holding where the parent loaded `zibri` and `zibri-testing` from, as a
 * json object of package name to absolute file path.
 *
 * An instance is a plain node process, so a bare `zibri` in it resolves through `node_modules` to
 * the built package - while the options module it boots from reaches the framework however its own
 * imports say, which inside this repository is the source tree beside it. Two files, two copies,
 * and the framework refuses the second one. This is how the instance is told which copy the parent
 * is using, so that both processes agree on exactly one.
 */
export const CLUSTER_MODULE_PATHS_ENV: string = 'ZIBRI_CLUSTER_MODULE_PATHS';

/**
 * The environment variable holding the directory the instances write into.
 *
 * One for the cluster rather than one per instance: they are replicas of a single deployment, and
 * they shared this before it was a directory anybody chose - the framework resolved it relative to
 * itself, which is the same folder in every process. The parent removes it when the cluster stops.
 */
export const CLUSTER_SCRATCH_PATH_ENV: string = 'ZIBRI_CLUSTER_SCRATCH_PATH';

/**
 * Sent once the instance has booted and is listening.
 */
export type ClusterReadyMessage = {
    /**
     * Discriminator.
     */
    kind: 'ready',
    /**
     * The port the instance's http server ended up on.
     */
    port: number
};

/**
 * Sent when the instance could not boot at all.
 */
export type ClusterBootFailedMessage = {
    /**
     * Discriminator.
     */
    kind: 'boot-failed',
    /**
     * The message of whatever went wrong.
     */
    message: string,
    /**
     * The stack of whatever went wrong, when there was one.
     */
    stack?: string
};

/**
 * Any message an instance sends back to the parent.
 */
export type ClusterInstanceMessage = ClusterReadyMessage | ClusterBootFailedMessage;