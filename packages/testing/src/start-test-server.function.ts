import { AddressInfo } from 'node:net';

import { DataSourceInterface, DiProvider, FsPath, initDiContainer, inject, LoggerInterface, Newable, PostgresDataSource, ZIBRI_DI_TOKENS, ZibriApplication, ZibriApplicationOptions } from 'zibri';

import { createInMemoryDataSource } from './in-memory-data-source/create-in-memory-data-source.function.ts';
import { registerAheadOfInit } from './register-ahead-of-init.function.ts';
import { ApplicationOptionsFallback, resolveApplicationOptions } from './resolve-application-options.function.ts';
import { createScratchDirectory, removeScratchDirectory, scratchProviders } from './scratch-directory.function.ts';
import { applyContainerPort, needsContainer, runAsSuperuser, StartedDataSourceContainer, startDataSourceContainers } from './start-data-source-containers.function.ts';
import { StartTestServerOptions } from './start-test-server-options.model.ts';
import { defaultTestProviders } from './test-providers.ts';

/**
 * What a test server falls back to for whatever neither the call nor the application named.
 *
 * An application with no controllers on an in process data source, which needs neither
 * configuration nor a container.
 */
const testServerFallback: ApplicationOptionsFallback = {
    name: 'test',
    dataSources: () => [createInMemoryDataSource()],
    providers: defaultTestProviders
};

const noOp: () => void = () => {};

/**
 * A test server that has been initialized, and everything that can be done with it.
 */
export class StartedTestServer {
    private readonly containerPorts: Map<Newable<DataSourceInterface>, number>;

    constructor(
        private app: ZibriApplication,
        private readonly containers: StartedDataSourceContainer[],
        /**
         * Where this server's application writes what it records at runtime.
         *
         * One per started server, and removed when it shuts down, so that what a suite finds on disk
         * is what its own run wrote. A test that asserts on those files needs to be able to find
         * them, and a failing one is read before anything else.
         */
        readonly scratchPath: FsPath
    ) {
        this.containerPorts = new Map(containers.map(c => [c.dataSourceClass, c.port]));
    }

    private reApplyContainerPorts(): void {
        for (const [dataSourceClass, port] of this.containerPorts) {
            const dataSource: DataSourceInterface = inject(dataSourceClass);
            if (needsContainer(dataSource)) {
                applyContainerPort(dataSource, port);
            }
        }
    }

    /**
     * Starts listening on a port the operating system picks.
     * @returns The base url the server is reachable at.
     */
    async start(): Promise<string> {
        await this.app.start(0);
        const address: string | AddressInfo | null = this.app.server.address();
        if (address == undefined || typeof address === 'string') {
            throw new Error('Failed to resolve test server port.');
        }
        const host: string = address.address === '::' || address.address === '0.0.0.0'
            ? '127.0.0.1'
            : address.address;
        return `http://${host}:${address.port}`;
    }

    /**
     * Runs statements as the superuser of the server a postgres data source was given.
     *
     * For what a test has to arrange that the application's own role may not do: another role, or a
     * grant across roles. Everything the application itself does stays with the role it connects as.
     * @param dataSourceClass - The data source whose server and database the statements run against.
     * @param statements - The statements, each run on its own.
     * @throws When the data source got no postgres container, or a statement is refused.
     */
    async runAsSuperuser(dataSourceClass: Newable<DataSourceInterface>, statements: string[]): Promise<void> {
        const started: StartedDataSourceContainer | undefined = this.containers.find(c => c.dataSourceClass === dataSourceClass);
        const dataSource: DataSourceInterface = inject(dataSourceClass);
        if (started == undefined || !(dataSource instanceof PostgresDataSource)) {
            throw new Error(`${dataSourceClass.name} runs on no postgres container of this server`);
        }
        await runAsSuperuser(started.container, dataSource, statements);
    }

    /**
     * Shuts the application down, stops every container that was started for it, and removes what it
     * wrote.
     */
    async shutdown(): Promise<void> {
        await this.app.shutdown();
        await Promise.all(this.containers.map(c => c.container.stop()));
        removeScratchDirectory(this.scratchPath);
    }

    /**
     * Builds a second application on the containers this one already started.
     *
     * What a test uses to change how the application is configured without paying for a container
     * again, which is most of what starting one costs.
     * @param options - What the replacement application is built from. Anything left out is taken
     * from the application that is being replaced, or from the `application` named here.
     */
    async reInit(options: StartTestServerOptions = {}): Promise<void> {
        const previous: ZibriApplicationOptions = {
            ...this.app.options,
            // the one thing that cannot be inherited: an application keeps what a plugin registered
            // rather than the plugin, so a reInit that does not name one starts without it
            plugins: []
        };

        await this.app.shutdown();

        const resolved: ZibriApplicationOptions = resolveApplicationOptions(
            { ...options, application: options.application ?? previous },
            testServerFallback
        );
        // the same directory, re-registered rather than inherited: a reInit that names its own
        // providers replaces the list these were in, and losing them would point the restart at
        // the application's real folders. Pointing it at a *fresh* directory would be worse
        // still - a restart that finds nothing is not a restart.
        const providers: DiProvider<unknown>[] = [...scratchProviders(this.scratchPath), ...resolved.providers ?? []];

        // Nothing may be injected above this line. Shutting an application down discards its
        // container, so the previous call left the process with none - and a `reInit` whose init
        // threw discarded a second one on its way out. Filling the replacement is therefore the
        // first thing to happen, and the logger below comes out of it rather than out of the
        // container that is already gone.
        initDiContainer();
        registerAheadOfInit(providers);

        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        logger.info('re initializes test server...');
        const info: typeof logger.info = logger.info;
        logger.info = noOp;

        this.reApplyContainerPorts();

        this.app = new ZibriApplication({ ...resolved, providers });

        try {
            await this.app.init();
        }
        catch (error) {
            // a failed init can still have connected a data source in beforeAppInit - shut down
            // whatever was actually constructed so the containers below don't outlive this call
            await this.app.shutdown();
            throw error;
        }

        logger.info = info;
        logger.info('test server re initialized');
    }
}

/**
 * Starts a real Zibri application for a test to drive.
 *
 * Everything about it is the application that ships: the router, the auth strategies, the data
 * source and the lifecycle are the ones production runs. What a test decides is what goes into it,
 * and `application` is how it says "the one I am testing".
 * @param options - What the application is built from. Without an `application` to build on, this
 * boots one with no controllers on an in process data source, which needs neither configuration nor
 * a container.
 * @returns The started server, which the test is responsible for shutting down.
 */
export async function startTestServer(options: StartTestServerOptions = {}): Promise<StartedTestServer> {
    // resolved before the container is built, not after. Falling back builds a data source class,
    // and building one registers it - so doing this later puts it in GlobalRegistry.injectables
    // after initDiContainer already read that list, and injecting it then fails with "no provider,
    // did you forget @Injectable" on a class that is decorated.
    const resolved: ZibriApplicationOptions = resolveApplicationOptions(options, testServerFallback);

    // one per server, and taken with it on shutdown. First in the providers rather than last, so a
    // suite that names one of these paths itself still wins.
    const scratchPath: FsPath = createScratchDirectory();
    const applicationOptions: ZibriApplicationOptions = {
        ...resolved,
        providers: [...scratchProviders(scratchPath), ...resolved.providers ?? []]
    };

    // so that the injects below this line have a container to answer from. The previous application's
    // shutdown already discarded its own, so this fills a fresh one rather than adding to a used one.
    initDiContainer();
    registerAheadOfInit(applicationOptions.providers ?? []);

    const containers: StartedDataSourceContainer[] = await startDataSourceContainers(applicationOptions.dataSources ?? []);

    const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
    logger.info('initializes test server...');
    // what a booting application says about itself is a page of it, and a suite starting a server
    // per test file says it once per file about an application the test did not ask questions about.
    // Restored at the end, so anything logged after the server is up still reaches the run.
    const info: typeof logger.info = logger.info;
    logger.info = noOp;

    const app: ZibriApplication = new ZibriApplication(applicationOptions);

    try {
        await app.init();
    }
    catch (error) {
        // a failed init can still have connected a data source in beforeAppInit, and the containers
        // above are already running - no StartedTestServer is ever returned to clean either of them
        // up, so both have to be torn down here or they outlive this call. The scratch directory
        // stays: a boot that failed is exactly the case where what it managed to write is worth
        // looking at, and the next run's is a directory of its own.
        logger.info = info;
        await app.shutdown();
        await Promise.all(containers.map(c => c.container.stop()));
        throw error;
    }

    logger.info = info;
    logger.info('test server initialized');

    return new StartedTestServer(app, containers, scratchPath);
}