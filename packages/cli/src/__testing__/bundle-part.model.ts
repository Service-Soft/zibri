/**
 * The part of a bundle one package takes, or one folder of a package of the framework.
 */
export type BundlePart = {
    /**
     * What the part is: a package, such as `pg`, a folder of the framework, such as `zibri/backup`, the
     * application's own code, or what no source map names.
     */
    name: string,
    /**
     * How many bytes of the bundle it takes.
     */
    bytes: number
};