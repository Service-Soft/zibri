import { spawnSync, SpawnSyncReturns } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { testFileFolder } from '../__testing__/constants';
import { Ms } from '../utilities/ms';
import { UUIDUtilities } from '../utilities/uuid.utilities';

/**
 * The files of a project built the way `zi new` sets one up: the shipped webpack configuration, with two
 * services logging from files of their own. Its transport admits warnings, and the debug entries of one
 * of the two, and prints each entry it is handed as `message|origin`. It prints the file a class of the
 * first one is declared in the same way, as `declared|file`.
 */
const PROJECT_FILES: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'bundled-source-files', version: '1.0.0', private: true }),
    'tsconfig.json': JSON.stringify({ compilerOptions: { outDir: 'dist' }, extends: 'zibri/tsconfig.application.json', include: ['src'] }),
    'webpack.config.js': `
        const { resolveWebpackConfiguration } = require('zibri/webpack');

        module.exports = env => resolveWebpackConfiguration({
            root: __dirname,
            sourceMap: env.deployment ? 'file-and-line' : 'with-sources'
        });
    `,
    'assets/.gitkeep': '',
    'translations/.gitkeep': '',
    'src/templates/.gitkeep': '',
    'src/models/generated/providers.js': 'module.exports = { providers: [] };',
    'src/services/payment.service.ts': `
        import { Injectable, LoggerInterface } from 'zibri';

        @Injectable({ register: 'onUse' })
        export class PaymentService {}

        export function capturePayment(logger: LoggerInterface): void {
            logger.warn('payment warning');
            logger.debug('payment debug');
        }
    `,
    'src/services/sync.service.ts': `
        import { LoggerInterface } from 'zibri';

        export function syncOrders(logger: LoggerInterface): void {
            logger.warn('sync warning');
            logger.debug('sync debug');
        }
    `,
    'src/index.ts': `
        import { BaseLoggerTransportConfig, GlobalRegistry, Log, Logger, LoggerTransport, LogLevel, Ms } from 'zibri';
        import { initDiContainer, MetadataUtilities } from 'zibri/internal';

        import { capturePayment, PaymentService } from './services/payment.service';
        import { syncOrders } from './services/sync.service';

        initDiContainer();
        GlobalRegistry.markAppAsCreated();

        const transport: LoggerTransport<BaseLoggerTransportConfig> = LoggerTransport.create<BaseLoggerTransportConfig>(
            { name: 'PrintingTransport', level: LogLevel.WARN, register: 'directly', levelsByOrigin: { '/services/payment': LogLevel.DEBUG } },
            (logs: Log[]) => {
                for (const log of logs) {
                    console.log(log.message + '|' + log.context.origin);
                }
            }
        );
        const logger: Logger = new Logger([transport], {
            [LogLevel.DEBUG]: Ms.WEEK,
            [LogLevel.INFO]: Ms.WEEK,
            [LogLevel.WARN]: Ms.WEEK,
            [LogLevel.ERROR]: Ms.WEEK,
            [LogLevel.CRITICAL]: Ms.WEEK
        }, 1000, 0);

        console.log('declared|' + MetadataUtilities.getFilePath(PaymentService));
        capturePayment(logger);
        syncOrders(logger);

        void logger.flush().then(() => process.exit(0));
    `
};

// what a deployment runs: everything in one file, so the frames of the logger and of whoever called it
// name the same path. The suite beside this one logs from a file of its own, where they never do
describe.each([
    { build: 'a deployment', buildArgs: ['--env', 'deployment'] },
    { build: 'development', buildArgs: [] }
])('the source files, in the bundle of $build', ({ buildArgs }) => {
    const projectDir: string = path.join(testFileFolder, `bundled-source-files-${UUIDUtilities.generate()}`);
    const bundle: string = path.join('dist', 'bundle.js');
    let printed: string[];
    let printedWithoutSourceMaps: string[];

    /**
     * Runs node in the project.
     * @param args - What node is started with.
     * @returns What it printed.
     * @throws With all it printed when it fails, since webpack reports a failed build on stdout.
     */
    function runNode(args: string[]): string {
        const result: SpawnSyncReturns<string> = spawnSync(process.execPath, args, { cwd: projectDir, encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error(`node ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
        }
        return result.stdout;
    }

    /**
     * Finds the origin of what the project printed.
     * @param lines - What it printed.
     * @param message - The message of the entry.
     * @returns Its origin, or undefined when it was not printed.
     */
    function findOrigin(lines: string[], message: string): string | undefined {
        return lines.find(line => line.startsWith(`${message}|`))?.split('|')[1];
    }

    beforeAll(async () => {
        for (const [file, content] of Object.entries(PROJECT_FILES)) {
            const filePath: string = path.join(projectDir, file);
            await mkdir(path.dirname(filePath), { recursive: true });
            await writeFile(filePath, content);
        }

        // as a generated project builds and starts it, in its Dockerfile and in "npm start"
        runNode([require.resolve('webpack-cli/bin/cli.js'), ...buildArgs]);
        printed = runNode(['--enable-source-maps', bundle]).trim().split('\n');
        printedWithoutSourceMaps = runNode([bundle]).trim().split('\n');
    }, Ms.MINUTE * 10);

    afterAll(async () => {
        await rm(projectDir, { recursive: true, force: true });
    });

    it('names the file that logged an entry', () => {
        expect(findOrigin(printed, 'payment warning')).toContain('/services/payment');
        expect(findOrigin(printed, 'sync warning')).toContain('/services/sync');
    });

    it('applies the level of the file that logged an entry, and only to that file', () => {
        expect(findOrigin(printed, 'payment debug')).toBeDefined();
        expect(findOrigin(printed, 'sync debug')).toBeUndefined();
    });

    it('names the file a class is declared in', () => {
        expect(findOrigin(printed, 'declared')).toContain('/services/payment.service');
    });

    // every frame names the bundle then, and calling that the origin would be the same answer for every entry
    it('answers unknown when the process is started without source maps', () => {
        expect(findOrigin(printedWithoutSourceMaps, 'payment warning')).toBe('unknown');
        expect(findOrigin(printedWithoutSourceMaps, 'payment debug')).toBeUndefined();
    });
});
