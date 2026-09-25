const path = require('path');
const { spawn } = require('child_process');
const CopyPlugin = require('copy-webpack-plugin');
const { generateHandlebarTypeFiles, generateEntityFiles, generateSourceXlf, resolveZibriRoot } = require('zibri');
const { ZibriTsxVendorPlugin } = require('zibri-tsx/webpack');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');
const { NormalModuleReplacementPlugin } = require('webpack');

/**
 * The template directories that are compiled by zibri-tsx: pages, components, and
 * the emails and their components too.
 */
const tsxTemplateDirs = [
    path.resolve(__dirname, 'src', 'templates', 'pages'),
    path.resolve(__dirname, 'src', 'templates', 'components'),
    path.resolve(__dirname, 'src', 'templates', 'emails'),
    path.resolve(__dirname, 'src', 'templates', 'email-components')
];

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
        compiler.hooks.beforeCompile.tapPromise(
            'HandlebarsTypegenPlugin',
            () => generateHandlebarTypeFiles()
        );
    }
}

class EntityGenerationPlugin {
    /** @type {import('webpack').WebpackPluginFunction } */
    apply(compiler) {
        compiler.hooks.beforeCompile.tapPromise(
            'EntityGenerationPlugin',
            () => generateEntityFiles()
        );
    }
}

class LocalizationPlugin {
    /** @type {import('webpack').WebpackPluginFunction } */
    apply(compiler) {
        compiler.hooks.beforeCompile.tapPromise('LocalizationPlugin', async () => {
            const frameworkSrc = path.join(resolveZibriRoot(), 'src');
            const projectSrc = path.resolve(compiler.context, 'src');
            await generateSourceXlf([
                {
                    origin: 'zibri',
                    originLocale: 'en-US',
                    patterns: { include: `${frameworkSrc}/**/*.{ts,tsx}`, exclude: '**/*.test.{ts,tsx}' }
                },
                {
                    origin: 'project',
                    originLocale: 'en-US',
                    patterns: { include: `${projectSrc}/**/*.{ts,tsx}`, exclude: '**/*.test.{ts,tsx}' }
                }
            ]);
        });
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
    entry: {
        bundle: './src/index.ts',
        style: './assets/public/style.css'
    },
    output: {
        path: path.resolve(__dirname, 'dist'),
        filename: '[name].js',
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
        sqlite3: 'commonjs2 sqlite3',
        ioredis: 'commonjs2 ioredis',
        mysql2: 'commonjs2 mysql2',
        mongodb: 'commonjs2 mongodb',
        '@sap\/hana-client': 'commonjs2 @sap\/hana-client',
        '@sap\/hana-client\/extension\/Stream': 'commonjs2 @sap\/hana-client\/extension\/Stream',
        'ts-node': 'commonjs2 ts-node',
        'utf-8-validate': 'commonjs2 utf-8-validate',
        bufferutil: 'commonjs2 bufferutil',
        'macos-temperature-sensor': 'commonjs2 macos-temperature-sensor',
        express: 'commonjs2 express',
        typeorm: 'commonjs2 typeorm',
        handlebars: 'commonjs2 handlebars'
    },
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
                use: 'ts-loader'
            },
            {
                test: /\.js$/,
                enforce: 'pre',
                use: 'source-map-loader',
                exclude: [
                    /node_modules[\/\\]node-cron/,
                    /node_modules\/@jridgewell/
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
            {
                test: /\.css$/,
                use: [
                    MiniCssExtractPlugin.loader,
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
    },
    plugins: [
        new HandlebarsTypegenPlugin(),
        new ZibriTsxVendorPlugin({
            templateDirs: tsxTemplateDirs,
            outDir: path.resolve(__dirname, 'assets', 'public', 'vendor'),
            resolveFrom: __dirname
        }),
        new EntityGenerationPlugin(),
        new LocalizationPlugin(),
        new OnBuildSuccessPlugin(),
        new MiniCssExtractPlugin({ filename: 'assets/public/style.css' }),
        new NormalModuleReplacementPlugin(
            /^([^?]+)\?client$/,
            (resource) => resource.request = resource.request.replace(/\?client$/, '')
        ),
        new CopyPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, 'assets'),
                    to: path.resolve(__dirname, 'dist', 'assets')
                },
                {
                    from: path.resolve(__dirname, 'src', 'templates'),
                    to: path.resolve(__dirname, 'dist', 'assets', 'templates')
                },
                {
                    from: path.resolve(__dirname, 'translations'),
                    to: path.resolve(__dirname, 'dist', 'translations')
                }
            ]
        })
    ]
};