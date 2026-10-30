import { ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';

import { Ms } from '../utilities/ms';

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
 * How long the application a build started may take to stop before it is killed.
 */
const STOP_TIMEOUT_IN_MS: number = 10 * Ms.SECOND;

/**
 * Starts the built application after every successful build of `webpack --watch`, once the one the
 * build before it started has stopped.
 */
export class RestartServerOnBuildPlugin {
    private serverProcess: ChildProcess | undefined;

    // a build finishing while the application of the one before is still stopping waits for that
    // restart, so two builds in quick succession never start two applications
    private restarting: Promise<void> = Promise.resolve();

    /**
     * Creates the plugin.
     * @param root - The root of the application, which `dist/bundle.js` is in.
     */
    constructor(private readonly root: string) {}

    /**
     * Applies the plugin to a webpack compiler.
     * @param compiler - The webpack compiler.
     */
    apply(compiler: WebpackWatchCompiler): void {
        compiler.hooks.done.tap('RestartServerOnBuildPlugin', stats => {
            if (stats.hasErrors() || !compiler.watchMode) {
                return;
            }
            // eslint-disable-next-line promise/prefer-await-to-then
            this.restarting = this.restarting.then(async () => {
                await this.stop();
                // a process of its own rather than the bundle imported again: the decorator registries
                // of the previous build would still hold what it registered, and get it a second time.
                // Without a shell, so stopping it signals the application rather than a shell around it
                this.serverProcess = spawn(process.execPath, ['--enable-source-maps', path.join('dist', 'bundle.js')], {
                    cwd: this.root,
                    stdio: 'inherit'
                });
            });
        });
    }

    // round-2 11 §W1: the next application was started the moment this one was told to stop, while it
    // still held its port
    private async stop(): Promise<void> {
        const running: ChildProcess | undefined = this.serverProcess;
        if (running == undefined || running.exitCode != undefined || running.signalCode != undefined) {
            return;
        }
        const exited: Promise<void> = new Promise(resolve => running.once('exit', () => resolve()));
        running.kill();
        const timeout: NodeJS.Timeout = setTimeout(() => running.kill('SIGKILL'), STOP_TIMEOUT_IN_MS);
        await exited;
        clearTimeout(timeout);
    }
}