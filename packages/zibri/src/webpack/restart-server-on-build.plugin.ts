import { ChildProcess, spawn } from 'node:child_process';

/**
 * What the plugin reads of a finished build.
 */
export type WebpackStats = {
    /**
     * Whether the build failed.
     */
    hasErrors: () => boolean
};

/**
 * The part of webpack's compiler the plugin uses. Typed structurally, like the plugins of
 * `zibri-tsx/webpack`, so a compiler can be stood in for.
 */
export type WebpackWatchCompiler = {
    /**
     * Whether the builds are those of `webpack --watch`.
     */
    watchMode: boolean,
    /**
     * The compiler hooks.
     */
    hooks: {
        /**
         * Runs when a build has finished.
         */
        done: {
            /**
             * Taps a handler.
             */
            tap: (name: string, onDone: (stats: WebpackStats) => void) => void
        }
    }
};

/**
 * Starts the built application after every successful build of `webpack --watch`, and stops the one
 * the build before it started.
 */
export class RestartServerOnBuildPlugin {
    private serverProcess: ChildProcess | undefined;

    /**
     * Applies the plugin to a webpack compiler.
     * @param compiler - The webpack compiler.
     */
    apply(compiler: WebpackWatchCompiler): void {
        compiler.hooks.done.tap('RestartServerOnBuildPlugin', stats => {
            if (stats.hasErrors() || !compiler.watchMode) {
                return;
            }
            // a process of its own rather than the bundle imported again: the decorator registries
            // of the previous build would still hold what it registered, and get it a second time
            this.serverProcess?.kill();
            this.serverProcess = spawn('node', ['--enable-source-maps', 'dist/bundle.js'], {
                stdio: 'inherit',
                shell: true
            });
        });
    }
}