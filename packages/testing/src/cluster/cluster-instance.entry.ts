// which copy of the framework this process gets is decided before this file runs: the parent
// preloads cluster-module-paths into every thread of the instance
import { createRequire } from 'node:module';
import { AddressInfo } from 'node:net';

// eslint-disable-next-line eslintImport/no-unassigned-import
import 'reflect-metadata'; // has to come before every zibri import below: they are all decorated.
import { DataSourceInterface, DiProvider, FsPath, initDiContainer, inject, Newable, ZibriApplication, ZibriApplicationOptions } from 'zibri';

import { defaultClusterDataSources } from './cluster-data-sources';
import { requireClusterEnv } from './cluster-env.function';
import { CLUSTER_DATA_SOURCE_PORTS_ENV, CLUSTER_INSTANCE_OPTIONS_ENV, CLUSTER_SCRATCH_PATH_ENV, ClusterInstanceMessage } from './cluster-message.model';
import { defaultClusterProviders } from './cluster-providers';
import { registerAheadOfInit } from '../register-ahead-of-init.function';
import { resolveApplicationOptions } from '../resolve-application-options.function';
import { scratchProviders } from '../scratch-directory.function';
import { applyContainerPort, needsContainer, TestDataSource } from '../start-data-source-containers.function';
import { StartTestServerOptions } from '../start-test-server-options.model';

/**
 * One instance of a Zibri application, in its own process.
 *
 * This is what makes the cluster tests possible at all: GlobalRegistry is static and
 * markAppAsCreated() throws on a second ZibriApplication, so a second replica cannot exist in the
 * jest process. That constraint is itself a finding - see evaluation/02-http-runtime-core.md C7.
 *
 * Nothing is stubbed here. The instance boots the real application against the same data sources
 * every other instance is pointed at, which is the entire point.
 */

const requireModule: NodeJS.Require = createRequire(__filename);

/**
 * The name every instance of the cluster boots under.
 *
 * The same one for all of them, because they are replicas of one application rather than several
 * applications that happen to share a database. The name is not only what shows up in a log line:
 * the jwt strategy issues and verifies tokens under it, so naming each replica after itself made a
 * token minted by one of them fail to verify on any other. A test that logged in against one
 * instance and called a second got 401 for what looked like every reason except the real one.
 *
 * Which instance a process is stays available through `clusterInstanceId`, read from the
 * environment. That is the per-process identity; this is the per-application one, and they are not
 * the same thing.
 */
const CLUSTER_APP_NAME: string = 'zibri-cluster';

/**
 * Sends a message to the parent and ends the process once it is actually out.
 *
 * Exiting straight after process.send can drop the message, which would turn a boot failure with a
 * perfectly good error message back into an unexplained timeout in the parent.
 * @param message - The message to send.
 * @param code - The exit code to end with.
 */
function sendAndExit(message: ClusterInstanceMessage, code: number): void {
    // written out as well as sent: the parent buffers stderr and attaches it to the error it
    // throws, and running this file by hand - which is the quickest way to debug a boot failure -
    // has no ipc channel at all, so without this the reason would simply disappear.
    // eslint-disable-next-line no-console
    console.error(message);

    if (process.send == undefined) {
        process.exit(code);
    }
    process.send(message, undefined, undefined, () => process.exit(code));
}

/**
 * Boots the application this process exists for and tells the parent which port it listens on.
 */
async function boot(): Promise<void> {
    const optionsModulePath: string = requireClusterEnv(CLUSTER_INSTANCE_OPTIONS_ENV);
    const ports: number[] = JSON.parse(requireClusterEnv(CLUSTER_DATA_SOURCE_PORTS_ENV)) as number[];

    // the parent is the only reason this process exists. When the ipc channel goes away - jest
    // crashed, the run was interrupted - exit instead of staying behind as an orphan holding a port
    // and a connection to the shared data source.
    process.on('disconnect', () => process.exit(1));

    // loaded before the container is initialized, not after: @DataSource and @Injectable decorate at
    // module load and push onto GlobalRegistry.injectables, which initDiContainer reads exactly
    // once. A module required afterwards is never registered, and injecting anything it declares
    // fails with "no provider, did you forget @Injectable" - on a class that is decorated.
    //
    // require rather than import(), for the same reason the parent does: one module system on both
    // sides, so a module that loads here loads there too.
    // eslint-disable-next-line jsdoc/require-jsdoc
    const optionsModule: { default: StartTestServerOptions } = requireModule(optionsModulePath) as {
        // eslint-disable-next-line jsdoc/require-jsdoc
        default: StartTestServerOptions
    };
    const options: StartTestServerOptions = optionsModule.default;

    // resolved before the container is built for the same reason the parent does it early: falling
    // back builds a data source class, and building one registers it. The fallback is the same
    // module level constant the parent used, so the two cannot disagree about how many data sources
    // there are or in which order - the mapped ports are indexed by that.
    const dataSources: Newable<DataSourceInterface>[] = options.dataSources ?? defaultClusterDataSources;

    // the same resolution a single process test server does, so a scenario reads the same whether it
    // runs in one process or across several. The name is this file's own rather than the
    // application's: every replica has to boot under one name, because the jwt strategy issues and
    // verifies tokens under it, and the data sources are the ones the parent already started
    // containers for.
    const resolved: ZibriApplicationOptions = resolveApplicationOptions(options, {
        name: CLUSTER_APP_NAME,
        dataSources: () => dataSources,
        providers: defaultClusterProviders
    });
    // the directory the parent made for this cluster, so what the replicas record lands somewhere it
    // can be looked at and removed rather than beside whichever copy of the framework this process
    // loaded
    const providers: DiProvider<unknown>[] = [
        ...scratchProviders(requireClusterEnv(CLUSTER_SCRATCH_PATH_ENV) as FsPath),
        ...resolved.providers ?? []
    ];

    initDiContainer();
    // before the data sources below are built, because building one builds what it injects, and the
    // container keeps that. The auth service reaches the lease service through the two factor
    // service, so without this every replica held the default lease drain rather than its own - and
    // a drain longer than the harness waits for a replica to exit was a grant never handed back
    registerAheadOfInit(providers);

    // only the data sources that need a server of their own were given a container, and only a
    // container has a port to map. An in process one is declared like any other and skipped here.
    const withContainer: TestDataSource[] = dataSources.map(d => inject(d)).filter(needsContainer);

    if (withContainer.length !== ports.length) {
        throw new Error(`got ${ports.length} mapped ports for ${withContainer.length} data sources`);
    }
    for (const [i, dataSource] of withContainer.entries()) {
        // one port per data source, in the same order - the length check above is what says so
        const port: number | undefined = ports[i];
        if (port == undefined) {
            throw new Error(`no mapped port for the data source at position ${i}`);
        }
        applyContainerPort(dataSource, port);
    }

    const app: ZibriApplication = new ZibriApplication({
        ...resolved,
        name: CLUSTER_APP_NAME,
        baseUrl: 'http://127.0.0.1',
        dataSources,
        providers
    });

    // process.exit inside shutdown() needs no stubbing here, unlike in startTestServer: ending the
    // process is exactly what a replica should do on SIGTERM, so the parent can kill an instance
    // and watch the real shutdown path run.
    await app.init();
    await app.start(0);

    const address: string | AddressInfo | null = app.server.address();
    if (address == undefined || typeof address === 'string') {
        throw new Error('the instance could not resolve the port it is listening on');
    }

    process.send?.({ kind: 'ready', port: address.port } satisfies ClusterInstanceMessage);
}

// eslint-disable-next-line promise/prefer-await-to-callbacks
void boot().catch((error: unknown) => {
    sendAndExit(
        {
            kind: 'boot-failed',
            message: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined
        },
        1
    );
});