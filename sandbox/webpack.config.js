/* eslint-disable jsdoc/require-description */
const path = require('path');
const { spawn } = require('child_process');
const CopyPlugin = require('copy-webpack-plugin');
const { IgnorePlugin } = require('webpack');
const { generateHandlebarTypeFiles } = require('zibri');

class OnBuildSuccessPlugin {
    /** @type {import('webpack').WebpackPluginFunction } */
    apply(compiler) {
        compiler.hooks.done.tap('OnBuildSuccessPlugin', stats => {
            if (stats.hasErrors() || compiler.watchMode === false) {
                return;
            }

            if (this.serverProcess) {
                this.serverProcess.kill();
            }
            this.serverProcess = spawn('node', ['--enable-source-maps', 'dist/bundle.js'], {
                stdio: 'inherit',
                shell: true
            });
        });
    }
}

class HandlebarsTypegenPlugin {
    /** @type {import('webpack').WebpackPluginFunction } */
    apply(compiler) {
        // on every rebuild (and initial build), run our stub generator first
        compiler.hooks.beforeCompile.tapPromise(
            'HandlebarsTypegenPlugin',
            () => generateHandlebarTypeFiles()
        );
    }
}

/** @type {import('webpack').Configuration} */
module.exports = {
    target: 'node',
    ignoreWarnings: [
        (warning) => {
            if (
                warning.message.includes('Critical dependency: the request of a dependency is an expression')
                || warning.message.includes('require.extensions is not supported by webpack.')
            ) {
                return true;
            }
            return false;
        }
    ],
    mode: 'none',
    entry: './src/index.ts',
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: 'bundle.js',
        devtoolModuleFilenameTemplate: info => {
            // info.resourcePath is the original filename (e.g. './src/controllers/test.controller.ts')
            // We strip leading './' and make it absolute for editors to link
            const relPath = info.resourcePath.replace(/^\.\//, '');
            return `file://${path.resolve(process.cwd(), relPath).replace(/\\/g, '/')}`;
        },
        clean: true
    },
    devtool: 'source-map',
    externals: [],
    resolve: {
        extensions: ['.ts', '.js']
    },
    module: {
        rules: [
            {
                test: /\.tsx?$/,
                use: 'ts-loader'
            },
            {
                test: /\.js$/,
                enforce: 'pre',
                use: 'source-map-loader',
                exclude: [/node_modules[\/\\]node-cron/]
            },
            {
                test: /\.hbs$/,
                use: [
                    {
                        loader: 'handlebars-loader',
                        options: {
                            // if you want to precompile
                            runtime: 'handlebars/runtime',
                            knownHelpersOnly: false
                        }
                    }
                ]
            }
        ]
    },
    plugins: [
        new HandlebarsTypegenPlugin(),
        new OnBuildSuccessPlugin(),
        new CopyPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, 'assets'),
                    to: path.resolve(__dirname, 'dist', 'assets'),
                    noErrorOnMissing: true
                },
                {
                    from: path.resolve(__dirname, 'src', 'templates'),
                    to: path.resolve(__dirname, 'dist', 'assets', 'templates'),
                    noErrorOnMissing: true
                }
            ]
        }),
        new IgnorePlugin({
            // eslint-disable-next-line stylistic/max-len
            resourceRegExp: /^pg-native$|^cloudflare:sockets$|^react-native-sqlite-storage$|^@google-cloud\/spanner$|^mssql$|^sql.js$|^redis$|^pg-query-stream$|^typeorm-aurora-data-api-driver$|^oracledb$|^mysql$|^hdb-pool$|^better-sqlite3$|^ioredis$|^mysql2$|^mongodb$|^@sap\/hana-client$|^@sap\/hana-client\/extension\/Stream$/
        })
    ]
};