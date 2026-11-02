import { SourceMapContents } from './source-map-contents.type';

/**
 * What `resolveWebpackConfiguration` needs to know about the application it builds.
 */
export type WebpackConfigurationOptions = {
    /**
     * The application's root: the folder holding its `package.json`, `src`, `assets` and `translations`.
     * Usually the `__dirname` of its webpack config.
     */
    root: string,
    /**
     * What the map beside the bundle carries: the sources for an editor, or the file and line of
     * every frame alone, for a deployment. `node --enable-source-maps` reads either.
     */
    sourceMap: SourceMapContents
};