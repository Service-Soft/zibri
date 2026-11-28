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
    // of the 11.1 it weighs with them.
    // The bundle measured 2026-11-16 at 5.66 MB, once undici, which zibri installs anyway, had left it. Its largest
    // parts are zibri's auth with 1.1 MB, its data sources with 0.96 MB, the application with 0.56 MB and backup with
    // 0.36 MB. It is not minified, which would save a seventh: node prints the line of the bundle an uncaught error is
    // thrown in, and a minified bundle is one line of megabytes.
    // It measured 2026-11-28 at 6.50 MB, once each plugin had an entry point of its own. Of what it grew by, 0.55 MB is
    // what every application gains in 3.3: auth with service accounts by 0.16, the WebDAV client 0.09, the storage
    // sessions 0.06 and the archive 0.03 among it. 0.3 MB is the invoicing and payment plugins, which the names 3.2
    // exported keep on `zibri` until 4.0
    // TODO 4.0: lower it by the 0.3 MB of those plugins once `zibri` no longer exports their names
    bundle: 7_100_000,
    'dist, assets included': 14_300_000,
    // measured 2026-11-09 at 92.0 MB, once what only the build uses had left the deployment: the compiler of the
    // templates with TypeScript, webpack with its plugins, ts-node and the markdown printer. A package a production
    // one names stays in a deployment pruned of its devDependencies, even as an optional peer, so growing past this
    // is first a reason to look for a build package named by zibri, zibri-tsx or another production package
    'node_modules, pruned': 101_000_000
};