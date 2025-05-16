const path = require('path');
const { spawn } = require('child_process');
const CopyPlugin = require('copy-webpack-plugin');
const { IgnorePlugin } = require('webpack');

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

/** @type {import('webpack').Configuration} */
module.exports = {
    target: 'node',
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
        extensions: ['.ts', '.js'],
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
            },
        ],
    },
    plugins: [
        new OnBuildSuccessPlugin(),
        new CopyPlugin({
            patterns: [
                {
                    from: path.resolve(__dirname, 'assets'),
                    to: path.resolve(__dirname, 'dist/assets'),
                    noErrorOnMissing: true,
                },
            ],
        }),
        new IgnorePlugin({ resourceRegExp: /^pg-native$|^cloudflare:sockets$/ })
    ]
};
