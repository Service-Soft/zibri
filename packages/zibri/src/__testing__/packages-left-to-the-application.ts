/**
 * The packages the framework uses without declaring them, loading the application's own copy. Building an application
 * uses them, which installs them as devDependencies, and a feature it switches on, which lists them in its
 * dependencies: `ts-node` for worker files written in TypeScript, `zibri-mdx` for markdown rendered at runtime.
 *
 * A package manager keeps a package a production package names in a deployment pruned of its devDependencies, even an optional
 * peer, so declaring one of these put it into every deployment.
 */
export const PACKAGES_LEFT_TO_THE_APPLICATION: string[] = [
    'typescript',
    'ts-node',
    'webpack',
    'copy-webpack-plugin',
    'mini-css-extract-plugin',
    'zibri-tsx-compiler',
    'zibri-mdx'
];