/**
 * What `resolveWebpackConfiguration` needs to know about the application it builds.
 */
export type WebpackConfigurationOptions = {
    /**
     * The application's root: the folder holding its `package.json`, `src`, `assets` and `translations`.
     * Usually the `__dirname` of its webpack config.
     */
    root: string
};