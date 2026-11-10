import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type CopyWebpackPlugin from 'copy-webpack-plugin';
import type MiniCssExtractPlugin from 'mini-css-extract-plugin';
import type { Configuration, FileCacheOptions, NormalModuleReplacementPlugin } from 'webpack';
import type * as ZibriTsxCompilerWebpack from 'zibri-tsx-compiler/webpack';

import { GenerateSourcesOnBuildPlugin } from './generate-sources-on-build.plugin';
import { RestartServerOnBuildPlugin } from './restart-server-on-build.plugin';
import { WebpackConfigurationOptions } from './webpack-configuration-options.model';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * The stylesheet of the pages, relative to the application, and where the build writes it.
 */
const STYLESHEET: string = 'assets/public/style.css';

/**
 * The file of the application that packages are resolved from, as its own build would resolve them.
 */
const PACKAGE_FILE: string = 'package.json';

/**
 * The loader and plugins of the compiler of the templates.
 */
const TEMPLATE_COMPILER: string = 'zibri-tsx-compiler/webpack';

/**
 * The part of the webpack package the configuration constructs itself.
 */
type WebpackModule = {
    /**
     * Replaces the request of a module before it is resolved.
     */
    NormalModuleReplacementPlugin: typeof NormalModuleReplacementPlugin
};

/**
 * What webpack tells `devtoolModuleFilenameTemplate` about a module.
 */
type ModuleFilenameInfo = {
    /**
     * The module's file, relative to where webpack was started.
     */
    resourcePath: string
};

/**
 * Loads a package the way the application's own webpack config would.
 *
 * From the application rather than from this file: these are its devDependencies, and in a monorepo
 * the copy installed beside it is not the one hoisted next to the framework.
 * @param root - The application's root.
 * @param name - The package to load.
 * @returns The package's exports.
 * @throws When the application does not have it.
 */
function requireFromApplication<T>(root: string, name: string): T {
    try {
        return createRequire(path.join(root, PACKAGE_FILE))(name) as T;
    }
    catch (error) {
        throw resolveMissingPackageError(root, name, error);
    }
}

/**
 * Checks that the application has the loaders the configuration names installed.
 *
 * A loader is resolved by webpack only once a module needs it, which fails that module with a message of its own, naming
 * neither this configuration nor what to install. Resolved here, a missing one fails before the build starts.
 * @param root - The application's root.
 * @param names - The loaders.
 * @throws When the application does not have one of them.
 */
function validateLoadersInstalled(root: string, names: string[]): void {
    const resolve: NodeJS.RequireResolve = createRequire(path.join(root, PACKAGE_FILE)).resolve;
    for (const name of names) {
        try {
            resolve(name);
        }
        catch (error) {
            throw resolveMissingPackageError(root, name, error);
        }
    }
}

/**
 * The error of a package the build of the application needs, which it does not have installed.
 * @param root - The application's root.
 * @param name - The package.
 * @param cause - Why it could not be loaded.
 * @returns The error.
 */
function resolveMissingPackageError(root: string, name: string, cause: unknown): InternalError {
    return new InternalError(
        [
            `Building the application at "${root}" needs "${name}", which it does not have installed.`,
            `Run "npm i -D ${name}" there.`
        ],
        { cause }
    );
}

/**
 * The cache on disk of a build for an editor, so the next build compiles only what changed since.
 *
 * Webpack checks a module against its files, the app's own and those of the local packages it bundles from a monorepo
 * alike, as it resolves them to where they are rather than through `node_modules`. What it cannot see is the build:
 * a change to one starts the cache over.
 * @param root - The application's root.
 * @returns The cache.
 */
function resolveBuildCache(root: string): FileCacheOptions {
    const resolve: NodeJS.RequireResolve = createRequire(path.join(root, PACKAGE_FILE)).resolve;
    const configFile: string = path.join(root, 'webpack.config.js');
    // the compiler of the templates prints a page written in markdown with zibri-mdx, which it loads from the
    // application, so webpack follows its requires to neither. A project without pages has no zibri-mdx
    let printer: string[] = [];
    try {
        printer = [resolve('zibri-mdx')];
    }
    catch {
        printer = [];
    }
    return {
        type: 'filesystem',
        // beside the application, wherever webpack is started from, such as the root of a monorepo
        cacheDirectory: path.join(root, 'node_modules', '.cache', 'webpack'),
        // the maps name each source by its absolute path from where webpack was started, which no module knows
        version: process.cwd(),
        buildDependencies: {
            config: [__filename, ...existsSync(configFile) ? [configFile] : []],
            templates: [resolve(TEMPLATE_COMPILER), ...printer]
        }
    };
}

/**
 * The webpack configuration a Zibri application is built with.
 *
 * Bundles `src/index.ts` into `dist`, and `assets/public/style.css` with it when the application has
 * one, compiles the templates in `src/templates` with zibri-tsx, writes the generated entities,
 * handlebars types and translation source before every build, copies what the bundle reads at runtime
 * beside it, and restarts the application after every build of `webpack --watch`.
 *
 * The stylesheet is run through PostCSS, so an application with one installs `css-loader`,
 * `postcss-loader` and `mini-css-extract-plugin`.
 *
 * A map is written beside the bundle: with the sources in it for an editor, or with the file and
 * line of every frame alone for a deployment, which starts the application with
 * `node --enable-source-maps` so that its stack traces name them.
 *
 * A build for an editor is cached in `node_modules/.cache/webpack`, so the next one, `npm start` included, compiles
 * only what changed. A build for a deployment runs once in a fresh image, and caches nothing.
 *
 * Use it as the whole config, or change what it returns, like this.
 * ```js
 * const { resolveWebpackConfiguration } = require('zibri/webpack');
 *
 * module.exports = env => resolveWebpackConfiguration({
 *     root: __dirname,
 *     sourceMap: env.deployment ? 'file-and-line' : 'with-sources'
 * });
 * ```
 * @param options - Where the application is, and what its map carries.
 * @returns The configuration.
 */
export function resolveWebpackConfiguration(options: WebpackConfigurationOptions): Configuration {
    const { root, sourceMap } = options;
    const CopyPlugin: typeof CopyWebpackPlugin = requireFromApplication(root, 'copy-webpack-plugin');
    const ReplacementPlugin: typeof NormalModuleReplacementPlugin = requireFromApplication<WebpackModule>(root, 'webpack')
        .NormalModuleReplacementPlugin;
    // the compiler of the templates is the application's devDependency like the rest of its build
    const { ZibriTsxTypeCheckPlugin, ZibriTsxVendorPlugin }: typeof ZibriTsxCompilerWebpack = requireFromApplication(
        root,
        TEMPLATE_COMPILER
    );
    // an application without pages has no stylesheet, and none of the packages that build one
    const MiniCssPlugin: typeof MiniCssExtractPlugin | undefined = existsSync(path.join(root, STYLESHEET))
        ? requireFromApplication(root, 'mini-css-extract-plugin')
        : undefined;
    validateLoadersInstalled(root, [
        'ts-loader',
        'source-map-loader',
        'handlebars-loader',
        ...MiniCssPlugin == undefined ? [] : ['css-loader', 'postcss-loader']
    ]);

    // every template is compiled by zibri-tsx, in whichever folder of the templates it is, as the jest preset does:
    // the pages and their components, the emails and theirs, the explorer, and a folder of the project's own
    const tsxTemplateDirs: string[] = [path.join(root, 'src', 'templates')];

    return {
        target: 'node',
        context: root,
        // both come from the framework's own dependencies - requires resolved only at runtime and
        // handlebars' require.extensions - and cannot be acted on from inside an application
        ignoreWarnings: [
            { message: /Critical dependency: the request of a dependency is an expression/ },
            { message: /require\.extensions is not supported by webpack\./ }
        ],
        mode: 'none',
        // the image of a deployment copies node_modules, which a cache would only make larger
        cache: sourceMap === 'with-sources' ? resolveBuildCache(root) : false,
        entry: {
            bundle: './src/index.ts',
            ...MiniCssPlugin == undefined ? {} : { style: `./${STYLESHEET}` }
        },
        output: {
            path: path.join(root, 'dist'),
            filename: '[name].js',
            // absolute file urls, so an editor links a stack trace's frame to the source it came from
            devtoolModuleFilenameTemplate: (info: ModuleFilenameInfo) => {
                const relativePath: string = info.resourcePath.replace(/^\.\//, '');
                return `file://${path.resolve(process.cwd(), relativePath).replaceAll('\\', '/')}`;
            },
            clean: true
        },
        // the sources are two thirds of the map, and node reads only the mappings: the image is
        // served without them, and a trace still names src/env.ts:34
        devtool: sourceMap === 'with-sources' ? 'source-map' : 'nosources-source-map',
        // what the framework's dependencies reach for only when a feature asks, or never on node: the
        // optional native add-ons, the pdf stack. Bundled, a package that is not installed fails the
        // build; external, it is required at runtime by the feature that wants it, like every optional peer
        externals: Object.fromEntries([
            'pdfmake',
            'pdfkit',
            '@foliojs-fork/fontkit',
            '@foliojs-fork/linebreak',
            'osx-temperature-sensor',
            'pg-native',
            'cloudflare:sockets',
            'pg-query-stream',
            'ts-node',
            'utf-8-validate',
            'bufferutil',
            'macos-temperature-sensor',
            'express',
            'handlebars'
        ].map(name => [name, `commonjs2 ${name}`])),
        resolve: {
            extensions: ['.ts', '.tsx', '.js', '.css']
        },
        module: {
            rules: [
                {
                    // a page written in markdown is a template too
                    test: /\.(tsx|mdx?)$/,
                    include: tsxTemplateDirs,
                    use: TEMPLATE_COMPILER
                },
                {
                    test: /\.tsx?$/,
                    // only the templates themselves: a module of plain typescript beside them, such as one creating a
                    // context, is compiled like the rest of the application
                    exclude: (file: string) => file.endsWith('.tsx') && tsxTemplateDirs.some(dir => file.startsWith(`${dir}${path.sep}`)),
                    loader: 'ts-loader',
                    // without it ts-loader compiles everything the tsconfig includes, tests too, and a type
                    // error in a test then fails the build and keeps "start" from restarting the server
                    options: { onlyCompileBundledFiles: true }
                },
                {
                    test: /\.js$/,
                    enforce: 'pre',
                    use: 'source-map-loader',
                    exclude: [
                        /node_modules[/\\]node-cron/,
                        /node_modules[/\\]@jridgewell/
                    ]
                },
                {
                    test: /\.hbs$/,
                    use: [
                        {
                            loader: 'handlebars-loader',
                            options: {
                                runtime: 'handlebars/runtime',
                                knownHelpersOnly: false
                            }
                        }
                    ]
                },
                ...MiniCssPlugin == undefined
                    ? []
                    : [
                        {
                            test: /\.css$/,
                            use: [
                                MiniCssPlugin.loader,
                                {
                                    loader: 'css-loader',
                                    options: {
                                        importLoaders: 1,
                                        esModule: false
                                    }
                                },
                                'postcss-loader'
                            ]
                        }
                    ]
            ]
        },
        plugins: [
            new GenerateSourcesOnBuildPlugin(root),
            new ZibriTsxVendorPlugin({
                templateDirs: tsxTemplateDirs,
                outDir: path.join(root, 'assets', 'public', 'vendor'),
                resolveFrom: root
            }),
            // the templates skip ts-loader, which reports the type errors of the rest
            new ZibriTsxTypeCheckPlugin({
                tsconfig: path.join(root, 'tsconfig.json'),
                templateDirs: tsxTemplateDirs
            }),
            new RestartServerOnBuildPlugin(root),
            ...MiniCssPlugin == undefined ? [] : [new MiniCssPlugin({ filename: STYLESHEET })],
            // a ?client import outside a template is the package itself on the server. The compiler leaves
            // those of a template out of the server render
            new ReplacementPlugin(
                /^([^?]+)\?client$/,
                resource => resource.request = resource.request.replace(/\?client$/, '')
            ),
            new CopyPlugin({
                patterns: [
                    {
                        from: path.join(root, 'assets'),
                        to: path.join(root, 'dist', 'assets')
                    },
                    {
                        from: path.join(root, 'src', 'templates'),
                        to: path.join(root, 'dist', 'assets', 'templates')
                    },
                    // everything copied here is read back from inside the bundle. "versions" is not copied
                    // because it is the one thing that is not read from there: the application writes to it
                    // and the next release reads what this one wrote, so it lives beside "dist" and travels
                    // with a deployment on its own. It could not live inside "dist" either way - "clean"
                    // empties that folder on every build, so a snapshot written there would not survive one.
                    {
                        from: path.join(root, 'translations'),
                        to: path.join(root, 'dist', 'translations')
                    }
                ]
            })
        ]
    };
}