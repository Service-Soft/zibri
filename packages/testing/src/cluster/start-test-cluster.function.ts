import { ChildProcess, fork } from 'node:child_process';
import { createRequire } from 'node:module';

import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { ExecResult } from 'testcontainers';
import { DataSourceInterface, DiContainer, FsPath, FsUtilities, initDiContainer, inject, Newable, PostgresDataSource } from 'zibri';

import { defaultClusterDataSources } from './cluster-data-sources';
import { ClusterMarkRow } from './cluster-mark.model';
import { CLUSTER_DATA_SOURCE_PORTS_ENV, CLUSTER_INSTANCE_ID_ENV, CLUSTER_INSTANCE_OPTIONS_ENV, CLUSTER_MODULE_PATHS_ENV, CLUSTER_SCRATCH_PATH_ENV, ClusterInstanceMessage } from './cluster-message.model';
import { clusterModulePaths } from './cluster-module-paths';
import { createScratchDirectory, removeScratchDirectory } from '../scratch-directory.function';
import { StartedDataSourceContainer, startDataSourceContainers } from '../start-data-source-containers.function';
import { StartTestServerOptions } from '../start-test-server-options.model';

const requireModule: NodeJS.Require = createRequire(__filename);

/**
 * The entry point each instance is forked with.
 *
 * Named by this file's own extension, which is what makes the harness work from both sides of the
 * build: `.ts` beside these sources, `.js` in the `dist` a consumer installs. Hardcoding either one
 * leaves the other forking a file that is not there.
 */
const instanceEntry: FsPath = FsUtilities.getPath(__dirname, `cluster-instance.entry${__filename.endsWith('.ts') ? '.ts' : '.js'}`);

/**
 * The module that points the shared packages at the parent's files, preloaded into each instance.
 *
 * Named by this file's own extension, for the same reason as {@link instanceEntry}.
 */
const modulePathsPreload: FsPath = FsUtilities.getPath(__dirname, `cluster-module-paths${__filename.endsWith('.ts') ? '.ts' : '.js'}`);

const bootTimeoutInMs: number = 15000;

const killTimeoutInMs: number = 5000;

/**
 * Runs a statement inside the container of one data source and returns its raw output.
 */
type SqlRunner = (statement: string) => Promise<string>;

/**
 * Whether the instances of a cluster boot one after another or all at once.
 */
export type ClusterBootMode = 'sequential' | 'simultaneous';

/**
 * Configuration for {@link StartedTestCluster.waitFor}.
 */
export type WaitForOptions = {
    /**
     * How long to keep reading before giving up. Defaults to 15000.
     */
    timeoutInMs?: number,
    /**
     * How long to wait between reads. Defaults to 250.
     */
    intervalInMs?: number
};

/**
 * One running instance of the cluster.
 *
 * Addressed over http like any other server. The parent holds one base url per instance, so it can
 * always reach exactly the one it means - ipc carries the boot handshake and nothing else.
 */
export class ClusterInstance {
    private readonly outputChunks: string[] = [];

    private readonly readyPromise: Promise<void>;

    private port: number = 0;

    private exited: boolean = false;

    private killedOnPurpose: boolean = false;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The base url the instance's http server is reachable under.
     * @throws When the instance is not listening.
     */
    get baseUrl(): string {
        if (this.port === 0) {
            throw new Error(`the cluster instance "${this.id}" is not listening`);
        }
        return `http://127.0.0.1:${this.port}`;
    }

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * Everything the instance has written to stdout and stderr so far.
     */
    get output(): string {
        return this.outputChunks.join('');
    }

    constructor(readonly id: string, private readonly child: ChildProcess) {
        // buffered rather than inherited: several instances logging at info level otherwise bury
        // the assertion that failed. It is attached to whatever error the harness throws instead.
        this.child.stdout?.on('data', (chunk: Buffer) => this.outputChunks.push(chunk.toString()));
        this.child.stderr?.on('data', (chunk: Buffer) => this.outputChunks.push(chunk.toString()));

        this.readyPromise = new Promise<void>((resolve, reject) => {
            const timeout: NodeJS.Timeout = setTimeout(
                () => reject(new Error(`the cluster instance "${id}" did not become ready within ${bootTimeoutInMs}ms\n${this.output}`)),
                bootTimeoutInMs
            );
            timeout.unref();

            this.child.on('message', (raw: unknown) => {
                const message: ClusterInstanceMessage = raw as ClusterInstanceMessage;
                clearTimeout(timeout);
                if (message.kind === 'ready') {
                    this.port = message.port;
                    resolve();
                    return;
                }
                reject(new Error(
                    `the cluster instance "${id}" failed to boot: ${message.message}\n${message.stack ?? ''}\n${this.output}`
                ));
            });

            this.child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
                this.exited = true;
                clearTimeout(timeout);
                const reason: string = signal != undefined ? `signal ${signal}` : `code ${code}`;
                // a no-op once the instance became ready, which is the normal case
                reject(new Error(`the cluster instance "${id}" exited with ${reason}\n${this.output}`));

                if (!this.killedOnPurpose) {
                    // an instance dying by itself would otherwise show up as a timeout somewhere
                    // else entirely, long after the output explaining it could still be found
                    // eslint-disable-next-line no-console
                    console.error(`the cluster instance "${id}" exited on its own with ${reason}\n${this.output}`);
                }
            });
        });

        // the parent may well be awaiting a different instance at the moment this one fails
        void this.readyPromise.catch(() => undefined);
    }

    /**
     * Resolves once the instance is listening, rejects with the reason it never got there.
     */
    async whenReady(): Promise<void> {
        await this.readyPromise;
    }

    /**
     * Ends the instance.
     *
     * SIGTERM runs the framework's own shutdown handlers, SIGKILL is a crash - which is the only
     * way to observe what a replica leaves behind when it dies without cleaning up.
     * @param signal - The signal to end it with. Defaults to SIGTERM.
     */
    async kill(signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
        if (this.exited) {
            return;
        }
        this.killedOnPurpose = true;
        const exited: Promise<void> = new Promise<void>(resolve => this.child.once('exit', () => resolve()));
        this.child.kill(signal);
        const hardKill: NodeJS.Timeout = setTimeout(() => this.child.kill('SIGKILL'), killTimeoutInMs);
        hardKill.unref();
        await exited;
        clearTimeout(hardKill);
    }
}

/**
 * Builds the runner that queries the given container, when its data source is one that answers sql.
 *
 * The only place in the harness that knows a concrete storage technology. Everything else - how
 * instances are configured, started, addressed and killed - works for any data source
 * startDataSourceContainers supports.
 * @param started - The started container to build a runner for.
 * @returns The runner, or undefined when that data source does not answer sql.
 */
function createSqlRunner(started: StartedDataSourceContainer): SqlRunner | undefined {
    const dataSource: DataSourceInterface = inject(started.dataSourceClass);
    if (!(dataSource instanceof PostgresDataSource) || !(started.container instanceof StartedPostgreSqlContainer)) {
        return undefined;
    }
    const container: StartedPostgreSqlContainer = started.container;
    const username: string = dataSource.options.username ?? 'postgres';
    const database: string = dataSource.options.database ?? 'db';

    return async (statement: string) => {
        const result: ExecResult = await container.exec(
            // eslint-disable-next-line cspell/spellchecker
            ['psql', '--username', username, '--dbname', database, '--no-align', '--tuples-only', '--command', statement]
        );
        if (result.exitCode !== 0) {
            throw new Error(`the statement failed with exit code ${result.exitCode}:\n${statement}\n${result.output}`);
        }
        return result.output;
    };
}

/**
 * A running cluster: several instances of one application against one shared set of data sources.
 *
 * Observations are made from here, never from an instance. The query goes through the container
 * rather than through any repository, so nothing about the answer shares a code path with the thing
 * being asserted about.
 */
export class StartedTestCluster {
    private readonly startedInstances: ClusterInstance[] = [];

    /**
     * The instances this cluster has ended, kept for their output.
     *
     * What a replica wrote on its way down is usually what explains a takeover that never happened,
     * and by the time a test notices, the replica is no longer among the running ones.
     */
    private readonly endedInstances: ClusterInstance[] = [];

    private nextInstanceIndex: number = 0;

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The instances that are currently running, in the order they were started.
     */
    get instances(): readonly ClusterInstance[] {
        return this.startedInstances;
    }

    constructor(
        readonly containers: StartedDataSourceContainer[],
        private readonly sqlRunners: (SqlRunner | undefined)[],
        private readonly instanceOptionsPath: FsPath,
        /**
         * Where the instances write what they record at runtime.
         *
         * One for the cluster, because they are replicas of a single deployment. Killing an instance
         * and starting another leaves it alone - what a replacement finds is what the cluster wrote.
         */
        readonly scratchPath: FsPath
    ) {}

    /**
     * The instance with the given id.
     * @param id - The id of the instance.
     * @returns The instance.
     * @throws When this cluster has no such instance.
     */
    instance(id: string): ClusterInstance {
        const found: ClusterInstance | undefined = this.startedInstances.find(i => i.id === id);
        if (!found) {
            throw new Error(`this cluster has no instance "${id}", only ${this.startedInstances.map(i => i.id).join(', ')}`);
        }
        return found;
    }

    /**
     * The instance at the given position, in the order they were started.
     *
     * What a test uses to address one replica of the several it asked for. The count is the count
     * the test set up, so there is always one there - said once here rather than at each of the
     * places that would otherwise have to check what they just destructured.
     * @param index - The position, counting from zero.
     * @returns The instance.
     * @throws When this cluster has no instance at that position.
     */
    instanceAt(index: number): ClusterInstance {
        const found: ClusterInstance | undefined = this.startedInstances[index];
        if (!found) {
            throw new Error(`this cluster has no instance at position ${index}, it has ${this.startedInstances.length}`);
        }
        return found;
    }

    /**
     * Ends one instance and removes it from the cluster.
     *
     * What a test uses to take a replica down, rather than ClusterInstance.kill: that one only ends
     * the process, so the cluster would still count it and scaleTo would not replace it.
     * @param id - The id of the instance to end.
     * @param signal - The signal to end it with. Defaults to SIGTERM.
     */
    async kill(id: string, signal: NodeJS.Signals = 'SIGTERM'): Promise<void> {
        const instance: ClusterInstance = this.instance(id);
        await instance.kill(signal);
        this.startedInstances.splice(this.startedInstances.indexOf(instance), 1);
        this.endedInstances.push(instance);
    }

    /**
     * Brings the cluster to the given number of instances, starting or killing as needed.
     * @param count - How many instances the cluster should have afterwards.
     * @param bootMode - How newly started instances boot. Defaults to sequential.
     */
    async scaleTo(count: number, bootMode: ClusterBootMode = 'sequential'): Promise<void> {
        while (this.startedInstances.length > count) {
            const removed: ClusterInstance | undefined = this.startedInstances.pop();
            if (removed) {
                await removed.kill();
                this.endedInstances.push(removed);
            }
        }

        const toStart: number = count - this.startedInstances.length;
        if (toStart <= 0) {
            return;
        }

        if (bootMode === 'simultaneous') {
            const started: ClusterInstance[] = [];
            for (let i: number = 0; i < toStart; i++) {
                started.push(this.forkInstance());
            }
            this.startedInstances.push(...started);
            await Promise.all(started.map(s => s.whenReady()));
            return;
        }

        for (let i: number = 0; i < toStart; i++) {
            const instance: ClusterInstance = this.forkInstance();
            this.startedInstances.push(instance);
            await instance.whenReady();
        }
    }

    /**
     * Reads from one of the cluster's data sources, straight through its container.
     * @param statement - A select statement. Rows come back as json, so dates and nulls survive.
     * @param dataSourceIndex - Which of the declared data sources to read. Defaults to the first.
     * @returns The rows the statement selected.
     * @throws When that data source does not answer sql, or the statement failed.
     */
    async sql<T>(statement: string, dataSourceIndex: number = 0): Promise<T[]> {
        const output: string = await this.runStatement(
            `select coalesce(json_agg(t), '[]'::json) from (${statement}) t`,
            dataSourceIndex
        );
        return JSON.parse(output.trim()) as T[];
    }

    /**
     * Reads the marks the instances wrote, oldest first.
     * @param kind - Only read marks of this kind. Reads all of them when left out.
     * @returns The marks.
     */
    async marks(kind?: string): Promise<ClusterMarkRow[]> {
        const where: string = kind == undefined ? '' : ` where "kind" = '${kind}'`;
        return await this.sql<ClusterMarkRow>(
            `select "instanceId", "kind", "tag", "at" from cluster_mark${where} order by "at"`
        );
    }

    /**
     * Throws away every mark written so far, so a test starts from an assembled cluster.
     *
     * Waiting for the instances is not enough, and there is nothing better to wait for: cron jobs
     * are scheduled in afterAppInit, which runs inside init(), so the first instance is already
     * firing them while the others are still booting - before it is even listening. Those runs are
     * real, but they describe a cluster that did not exist yet, and left in place they look exactly
     * like a job that correctly ran on one replica only.
     * @param dataSourceIndex - Which data source to clear. Defaults to the first.
     */
    async clearMarks(dataSourceIndex: number = 0): Promise<void> {
        await this.runStatement('delete from cluster_mark', dataSourceIndex);
    }

    /**
     * Runs one statement and hands back whatever the data source printed.
     * @param statement - The statement to run.
     * @param dataSourceIndex - Which data source to run it against.
     * @returns The raw output.
     * @throws When that data source does not answer sql.
     */
    private async runStatement(statement: string, dataSourceIndex: number): Promise<string> {
        const run: SqlRunner | undefined = this.sqlRunners[dataSourceIndex];
        if (run == undefined) {
            throw new Error(`data source ${dataSourceIndex} of this cluster does not answer sql`);
        }
        return await run(statement);
    }

    /**
     * Reads until the cluster reaches the awaited state.
     *
     * Cluster work happens on its own schedule, so a test that sleeps a fixed amount is either slow
     * or flaky. This is neither.
     * @param read - Reads the current state.
     * @param isDone - Decides whether what was read is what the test is waiting for.
     * @param options - How long to wait, and how often to look.
     * @returns The first read that satisfied isDone.
     * @throws When it never did, with the output of every instance this cluster has run.
     */
    async waitFor<T>(
        read: () => Promise<T>,
        isDone: (value: T) => boolean,
        options: WaitForOptions = {}
    ): Promise<T> {
        const { timeoutInMs = 15000, intervalInMs = 250 }: WaitForOptions = options;
        const deadline: number = Date.now() + timeoutInMs;
        let value: T = await read();
        while (!isDone(value)) {
            if (Date.now() > deadline) {
                // the replicas' own output, because the state a test waits for is the end of
                // something one of them did or failed to do, and only its log says which
                const outputs: string = [...this.startedInstances, ...this.endedInstances]
                    .map(i => `${i.id}:\n${i.output}`)
                    .join('\n');
                throw new Error(
                    `the cluster did not reach the awaited state within ${timeoutInMs}ms, last read ${JSON.stringify(value)}\n${outputs}`
                );
            }
            await new Promise<void>(resolve => {
                setTimeout(resolve, intervalInMs);
            });
            value = await read();
        }
        return value;
    }

    /**
     * Ends every instance, stops every container, and removes what the instances wrote.
     */
    async shutdown(): Promise<void> {
        await Promise.all(this.startedInstances.map(i => i.kill()));
        this.startedInstances.length = 0;
        await Promise.all(this.containers.map(c => c.container.stop()));
        removeScratchDirectory(this.scratchPath);
    }

    /**
     * Starts one more instance.
     * @returns The instance, which is not listening yet.
     */
    private forkInstance(): ClusterInstance {
        const id: string = `instance-${this.nextInstanceIndex++}`;
        const child: ChildProcess = fork(instanceEntry, [], {
            // the directory the test run started from, which is where the project's tsconfig and
            // node_modules are - the instance loads the caller's own options module through ts-node
            // and has to resolve both the way the caller would.
            cwd: process.cwd(),
            // jest's transform only exists inside the jest process, so the instance needs a
            // typescript hook of its own. ts-node rather than swc: it is already a peer dependency,
            // and it is the same compiler the framework is built with, so emitDecoratorMetadata
            // behaves identically instead of merely similarly.
            // The module paths are preloaded rather than imported by the entry, because a worker
            // thread starts with the execArgv of the thread that created it and never runs the entry:
            // imported there, they reached the instance's main thread only, and every thread job
            // loaded the built packages instead of the copy the instance runs.
            execArgv: ['-r', 'ts-node/register', '-r', modulePathsPreload],
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
            env: {
                ...process.env,
                TS_NODE_TRANSPILE_ONLY: 'true',
                TS_NODE_COMPILER_OPTIONS: '{"module":"commonjs"}',
                // which copy of the framework to use. A bare `zibri` in the instance resolves
                // through node_modules to the built package, while the options module it boots from
                // reaches the framework however its own imports say - inside this repository, the
                // source tree beside it. That is two copies in one process, and the framework
                // refuses the second one.
                [CLUSTER_MODULE_PATHS_ENV]: JSON.stringify(clusterModulePaths()),
                [CLUSTER_SCRATCH_PATH_ENV]: this.scratchPath,
                [CLUSTER_INSTANCE_ID_ENV]: id,
                [CLUSTER_INSTANCE_OPTIONS_ENV]: this.instanceOptionsPath,
                [CLUSTER_DATA_SOURCE_PORTS_ENV]: JSON.stringify(this.containers.map(c => c.port))
            }
        });
        return new ClusterInstance(id, child);
    }
}

/**
 * Configuration for {@link startTestCluster}.
 */
export type StartTestClusterOptions = {
    /**
     * The path of the module that default exports the StartTestServerOptions every instance boots
     * with.
     *
     * A path rather than the options themselves, because a class cannot cross a process boundary.
     * Both sides import the module: the parent to learn which containers to start, the instances to
     * actually boot. Nothing at its top level may assume it is running inside an instance -
     * clusterInstanceId() has to be read per request, not once on load, or the parent's import of
     * it throws.
     */
    instanceOptions: FsPath,
    /**
     * How many instances to boot. Defaults to 2.
     */
    instances?: number,
    /**
     * How the instances boot. Defaults to sequential.
     *
     * Sequential lets the first instance settle the schema before the rest connect. Simultaneous is
     * what a rolling deploy actually does, and is the point of the migration findings - but until
     * those are fixed it also makes every other test fail on a ddl collision rather than on what it
     * set out to assert.
     */
    bootMode?: ClusterBootMode
};

/**
 * Starts several instances of one application against one shared set of data sources.
 *
 * Everything that only goes wrong with more than one replica needs this: a cron job firing on each
 * of them, an event that never leaves the process that emitted it, a queued mail sent as many times
 * as there are pods.
 * @param options - What to boot, and how much of it.
 * @returns The running cluster.
 */
export async function startTestCluster(options: StartTestClusterOptions): Promise<StartedTestCluster> {
    const { instanceOptions, instances = 2, bootMode = 'sequential' }: StartTestClusterOptions = options;

    // loaded before the container is initialized, not after: @DataSource decorates at module load
    // and pushes onto GlobalRegistry.injectables, while initDiContainer reads that list once. A
    // module required afterwards is never registered, and injecting it fails with "no provider,
    // did you forget @Injectable" - on a class that is decorated.
    //
    // require rather than import(): under module nodenext typescript keeps a dynamic import as a
    // real one, and jest's commonjs runtime refuses it without --experimental-vm-modules. Both
    // sides of the harness run as commonjs, so this is what the module system actually is.
    // eslint-disable-next-line jsdoc/require-jsdoc
    const optionsModule: { default: StartTestServerOptions } = requireModule(instanceOptions) as {
        // eslint-disable-next-line jsdoc/require-jsdoc
        default: StartTestServerOptions
    };

    // resolved before the container is built, not after. Falling back builds a data source class,
    // and building one registers it - so doing this later puts it in GlobalRegistry.injectables
    // after initDiContainer already read that list, and injecting it then fails exactly like a
    // module loaded too late does.
    //
    // The fallback is a module level constant rather than a call, so the parent and each instance
    // resolve the same array: they have to agree on how many data sources there are and in which
    // order, because the mapped ports are indexed by that.
    const dataSources: Newable<DataSourceInterface>[] = optionsModule.default.dataSources ?? defaultClusterDataSources;

    // reading a data source's options means injecting it, which needs a container - the same reset
    // startTestServer does. No application is created here, so nothing else uses it.
    DiContainer.reset();
    initDiContainer();

    const containers: StartedDataSourceContainer[] = await startDataSourceContainers(dataSources);
    const sqlRunners: (SqlRunner | undefined)[] = containers.map(c => createSqlRunner(c));

    const cluster: StartedTestCluster = new StartedTestCluster(
        containers,
        sqlRunners,
        instanceOptions,
        createScratchDirectory()
    );
    try {
        await cluster.scaleTo(instances, bootMode);
    }
    catch (error) {
        // the containers are already running, and no cluster is ever returned that could stop them
        await cluster.shutdown();
        throw error;
    }
    return cluster;
}