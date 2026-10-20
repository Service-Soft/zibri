import { CLUSTER_INSTANCE_ID_ENV } from './cluster-message.model.ts';

/**
 * Reads a variable that the parent has to have set on a cluster instance.
 * @param key - The name of the environment variable.
 * @returns Its value.
 * @throws When the process was not started as a cluster instance, or the parent forgot it.
 */
export function requireClusterEnv(key: string): string {
    const value: string | undefined = process.env[key];
    if (value == undefined) {
        throw new Error(`the cluster instance was started without ${key}`);
    }
    return value;
}

/**
 * The id of the instance this process is.
 *
 * Throws rather than falling back to a placeholder: an instance that cannot say which one it is
 * would let a test group marks by an id that is the same everywhere, and pass while proving
 * nothing.
 * @returns The instance id.
 * @throws When this process is not a cluster instance.
 */
export function clusterInstanceId(): string {
    return requireClusterEnv(CLUSTER_INSTANCE_ID_ENV);
}