/* eslint-disable jsdoc/require-description */
const path = require('path');
const { spawn } = require('child_process');
const CopyPlugin = require('copy-webpack-plugin');
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
    externals: {
        pdfmake: 'commonjs2 pdfmake',
        pdfkit: 'commonjs2 pdfkit',
        '@foliojs-fork/fontkit': 'commonjs2 @foliojs-fork/fontkit',
        '@foliojs-fork/linebreak': 'commonjs2 @foliojs-fork/linebreak',
        'osx-temperature-sensor': 'commonjs2 osx-temperature-sensor',
        'pg-native': 'commonjs2 pg-native',
        'cloudflare:sockets': 'commonjs2 cloudflare:sockets',
        'react-native-sqlite-storage': 'commonjs2 react-native-sqlite-storage',
        '@google-cloud\/spanner': 'commonjs2 @google-cloud\/spanner',
        mssql: 'commonjs2 mssql',
        'sql.js': 'commonjs2 sql.js',
        redis: 'commonjs2 redis',
        'pg-query-stream': 'commonjs2 pg-query-stream',
        'typeorm-aurora-data-api-driver': 'commonjs2 typeorm-aurora-data-api-driver',
        oracledb: 'commonjs2 oracledb',
        mysql: 'commonjs2 mysql',
        'hdb-pool': 'commonjs2 hdb-pool',
        'better-sqlite3': 'commonjs2 better-sqlite3',
        ioredis: 'commonjs2 ioredis',
        mysql2: 'commonjs2 mysql2',
        mongodb: 'commonjs2 mongodb',
        '@sap\/hana-client': 'commonjs2 @sap\/hana-client',
        '@sap\/hana-client\/extension\/Stream': 'commonjs2 @sap\/hana-client\/extension\/Stream',
        'utf-8-validate': 'utf-8-validate',
        bufferutil: 'bufferutil'
    },
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
                exclude: [
                    /node_modules[\/\\]node-cron/,
                    /node_modules\/xmlbuilder2/,
                    /node_modules\/@oozcitak/
                ]
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
        })
    ]
};