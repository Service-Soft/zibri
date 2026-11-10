/**
 * One of the framework's own packages, which a project installs at the release matching the cli.
 */
export type FrameworkPackage = {
    /**
     * Where the package lives in this repository, under `packages`.
     */
    folder: 'zibri' | 'testing' | 'mdx' | 'tsx-compiler',
    /**
     * Its name on npm.
     */
    name: string
};