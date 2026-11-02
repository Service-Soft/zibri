// an entry point of its own, which a webpack config loads before anything else of the framework -
// and the decorated classes the build reaches for need this, like they do behind the main one
// eslint-disable-next-line eslintImport/no-unassigned-import
import 'reflect-metadata';

export * from './resolve-webpack-configuration.function';
export * from './webpack-configuration-options.model';
export * from './source-map-contents.type';
export * from './restart-server-on-build.plugin';
export * from './generate-sources-on-build.plugin';