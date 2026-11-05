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
    'node_modules, pruned': 156_000_000
};