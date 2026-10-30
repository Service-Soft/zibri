import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

import type CopyWebpackPlugin from 'copy-webpack-plugin';
import type MiniCssExtractPlugin from 'mini-css-extract-plugin';
import type { Configuration, NormalModuleReplacementPlugin } from 'webpack';
import { ZibriTsxVendorPlugin } from 'zibri-tsx/webpack';

import { GenerateSourcesOnBuildPlugin } from './generate-sources-on-build.plugin';
import { RestartServerOnBuildPlugin } from './restart-server-on-build.plugin';
import { WebpackConfigurationOptions } from './webpack-configuration-options.model';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * The stylesheet of the pages, relative to the application, and where the build writes it.
 */
const STYLESHEET: string = 'assets/public/style.css';

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
        return createRequire(path.join(root, 'package.json'))(name) as T;
    }
    catch (error) {
        throw new InternalError(
            [
                `Building the application at "${root}" needs "${name}", which it does not have installed.`,
                `Run "npm i -D ${name}" there.`
            ],
            { cause: error }
        );
    }
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
 * Use it as the whole config, or change what it returns, like this.
 * ```js
 * const { resolveWebpackConfiguration } = require('zibri/webpack');
 *
 * module.exports = resolveWebpackConfiguration({ root: __dirname });
 * ```
 * @param options - Where the application is.
 * @returns The configuration.
 */
export function resolveWebpackConfiguration(options: WebpackConfigurationOptions): Configuration {
    const { root } = options;
    const CopyPlugin: typeof CopyWebpackPlugin = requireFromApplication(root, 'copy-webpack-plugin');
    const ReplacementPlugin: typeof NormalModuleReplacementPlugin = requireFromApplication<WebpackModule>(root, 'webpack')
        .NormalModuleReplacementPlugin;
    // an application without pages has no stylesheet, and none of the packages that build one
    const MiniCssPlugin: typeof MiniCssExtractPlugin | undefined = existsSync(path.join(root, STYLESHEET))
        ? requireFromApplication(root, 'mini-css-extract-plugin')
        : undefined;

    // the template directories compiled by zibri-tsx: pages, components, and the emails and their components too
    const tsxTemplateDirs: string[] = ['pages', 'components', 'emails', 'email-components']
        .map(folder => path.join(root, 'src', 'templates', folder));

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
        devtool: 'source-map',
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
                    test: /\.tsx$/,
                    include: tsxTemplateDirs,
                    use: 'zibri-tsx/webpack'
                },
                {
                    test: /\.tsx?$/,
                    exclude: tsxTemplateDirs,
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
            new RestartServerOnBuildPlugin(root),
            ...MiniCssPlugin == undefined ? [] : [new MiniCssPlugin({ filename: STYLESHEET })],
            // a package a template imports with ?client is the package itself on the server
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