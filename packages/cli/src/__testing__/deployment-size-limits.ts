/**
 * The most a deployment of the generated project may weigh, in bytes, by the name of its measurement.
 *
 * A size depends on what is built rather than on the machine building it, so it is held to a limit
 * instead of only being reported. A change that makes one grow past it raises the limit, and says
 * why beside it. The image is left out: its base image grows without anything here changing.
 */
export const DEPLOYMENT_SIZE_LIMITS: Record<string, number> = {
    // measured 2026-11-02 at 4.9 MB, 13.0 MB and 141.7 MB, each limit about a tenth above. dist is
    // the sandbox's deployment build: 9.7 without the map, and the map without its sources is 3.3
    // of the 11.1 it weighs with them
    bundle: 5_400_000,
    'dist, assets included': 14_300_000,
    // measured 2026-11-09 at 92.0 MB, once what only the build uses had left the deployment: the compiler of the
    // templates with TypeScript, webpack with its plugins, ts-node and the markdown printer. A package a production
    // one names stays in a deployment pruned of its devDependencies, even as an optional peer, so growing past this
    // is first a reason to look for a build package named by zibri, zibri-tsx or another production package
    'node_modules, pruned': 101_000_000
};