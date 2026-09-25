# Testing
A Zibri application is tested by starting it and driving it over http. `zibri-testing` is what starts
it: the router, the auth strategies, the lifecycle, the data source and the error handling are the
ones production runs, and the application is the one that ships.

```bash
npm i -D zibri-testing
```

It peer depends on `zibri`, so the framework under test is the copy your application already has.
`zi new` sets all of this up, including a first test to copy.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `startTestServer` | function | Boots an application and hands back a `StartedTestServer` |
| `StartedTestServer` | class | The running server: `start`, `reInit`, `shutdown` |
| `StartTestServerOptions` | type | The application to build on, and what to change about it |
| `resolveApplicationOptions` | function | The merge itself, for a harness of your own |
| `createInMemoryDataSource` | function | Builds a data source class that keeps everything in this process |
| `InMemoryDataSource` | class | The data source those classes extend |
| `createPostgresTestDataSource` | function | Builds a postgres data source class for a container the harness starts |
| `zibriFrameworkEntities` | value | Every entity the framework itself stores rows in |
| `defaultTestProviders` | value | The providers that make a deployment's defaults workable in a test |
| `testMasterKey` | value | The encryption master key those providers register |
| `UnconfiguredEmailTransport` | class | A mail transport that refuses to send |
| `startDataSourceContainers` | function | Starts one container per data source that needs a server of its own |
| `StartedTestServer.scratchPath` | property | Where this server's application writes what it records at runtime |
| `startTestCluster` | function | Boots several instances of one application against shared data sources |
| `StartedTestCluster` | class | The running cluster: `instanceAt`, `sql`, `marks`, `waitFor`, `kill`, `scaleTo`, `shutdown` |
| `ClusterInstance` | class | One replica: its `baseUrl`, its `output`, and `kill` |
| `ClusterMark` | entity | The row an instance writes to record that it, specifically, did something |
| `clusterInstanceId` | function | Which instance the current process is |
| `defaultClusterTestEntities` | value | The framework's entities plus `ClusterMark` |
| `defaultClusterDataSources` | value | The postgres data source a cluster boots on |
| `defaultClusterProviders` | value | What a cluster instance boots with |

## Usage
### Three modules, so a test starts your application
An application's options are the thing a test and a deployment share, so they live in a module of
their own rather than inline in `index.ts`. `zi new` writes three:

```ts
// src/application-options.base.ts — everything the application is
import { JwtAuthController, MailingListController, Newable, OmitStrict, ZibriApplicationOptions, ZibriMailingListPlugin } from 'zibri';

import { PageController } from './controllers';
import { DbDataSource } from './data-sources';
import { entities } from './data-sources/db/entities';
import { version } from '../package.json';
import { providers } from './providers';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'My Api',
    baseUrl: 'http://localhost:3000',
    plugins: [new ZibriMailingListPlugin()],
    controllers: [PageController, MailingListController, JwtAuthController],
    websocketControllers: [],
    cronJobs: [],
    version,
    defaultAuth: 'public',
    providers
};
```

```ts
// src/application-options.ts — and where it keeps its data
export const applicationOptions: ZibriApplicationOptions = {
    ...baseApplicationOptions,
    dataSources: [DbDataSource]
};
```

```ts
// src/__testing__/test-application-options.ts — the same application, as a test starts it
import { CronExpression, CronJob, defineProvider, FsUtilities, InitialCronConfig, InjectRepository, Repository, ZIBRI_DI_TOKENS } from 'zibri';
import { createInMemoryDataSource, createPostgresTestDataSource, defaultClusterProviders, defaultClusterTestEntities, defaultTestProviders, StartedTestCluster, StartedTestServer, startTestServer } from 'zibri-testing';

import { ClusterMarkRow, currentTick, myFolder, OnlyThisController, OtherController, RecordingTransport, writersByTag } from './example-fixtures';

export const testApplicationOptions: ZibriApplicationOptions = {
    ...baseApplicationOptions,
    dataSources: [createInMemoryDataSource({ entities })],
    providers: [...baseApplicationOptions.providers ?? [], ...defaultTestProviders]
};
```

`index.ts` then does `new ZibriApplication(applicationOptions)` and a test does this:

```ts
// src/__testing__/home-page.test.ts
import { afterAll, beforeAll, expect, it } from '@jest/globals';

let server: StartedTestServer;
let baseUrl: string;

beforeAll(async () => {
    server = await startTestServer({ application: testApplicationOptions });
    baseUrl = await server.start();
}, 30000);

afterAll(async () => {
    await server.shutdown();
}, 30000);

it('serves the home page', async () => {
    const response: Response = await fetch(baseUrl);

    expect(response.status).toBe(200);
});
```

**Why the data source is split off.** Importing a module registers whatever it declares, and a data
source that is registered without being deployed is refused at boot — so a test module that reached
the production data source would boot an application carrying it. The base holds everything a test
and a deployment agree on; each of the two modules beside it adds the storage it uses.

Where the test options live is up to you. `zi new` puts them in `src/__testing__/` beside the first
test, because the bundler's entry point is `index.ts` and nothing it reaches imports them.

### Templates in a test
A test renders the same templates the build does, so jest compiles them with `zibri-tsx/jest`, the
counterpart of the `zibri-tsx/webpack` loader. `zi new` writes this `jest.config.mjs`:

```js
const config = {
    testEnvironment: 'node',
    rootDir: 'src',
    transform: {
        '^.+[\\/]src[\\/]templates[\\/].+\\.tsx$': 'zibri-tsx/jest',
        '^.+.tsx?$': ['ts-jest', { tsconfig: { module: 'commonjs' } }]
    },
    moduleNameMapper: {
        '^(.+)\\?client$': '$1'
    }
};

export default config;
```

The template entry comes first, since jest takes the first pattern a file matches. A package imported
with `?client` is the package itself in a test, as it is in the server build.

### What a test names, and what it inherits
`startTestServer` takes the application to build on and whatever the test changes about it. Each key
is resolved on its own: **the call first, then the application, then the harness's own default.**

```ts
// the whole application, with one controller in place of its own
beforeAll(async () => {
    server = await startTestServer({
        application: testApplicationOptions,
        controllers: [OnlyThisController]
    });
});
```

Naming the controllers says nothing about the version, the data source or the auth posture, so an
application that declares fifty things and a test that is about one of them stay one line apart. A
key replaces rather than adds to, so a test naming one controller gets one controller — spread the
application's own list to keep it: `controllers: [...baseApplicationOptions.controllers, Extra]`.

An override that came out `undefined` counts as one nobody named, so building the options from a
variable is safe:

```ts
export async function startForScenario(scenario: { controllers?: Newable<unknown>[] }): Promise<StartedTestServer> {
    const controllers: Newable<unknown>[] | undefined = scenario.controllers;
    return await startTestServer({ application: testApplicationOptions, controllers });
}
```

Everything a `ZibriApplication` takes can be named this way — `controllers`, `websocketControllers`,
`cronJobs`, `providers`, `plugins`, `authStrategies`, `twoFactorMethods`, `bodyParsers`, `security`,
`defaultAuth`, `version`, `name`, `baseUrl`, `dataSources` — plus `assetsPath`, which says where the
application serves its static assets from.

Without an `application` to build on, the harness boots one with no controllers on an in process data
source. That is what a test of the framework itself, or a quick throwaway, runs on.

### Storing something
Most tests need a data source because an application starts with one, rather than because the test
is about storage. `createInMemoryDataSource` is for those: it keeps every row in this process, so it
needs no container and no configuration.

```ts
dataSources: [createInMemoryDataSource({ entities })]
```

The framework's own entities are added for you, so `entities` is the list your real data source
declares beside them — which is why `zi new` puts that list in a module of its own and has both data
sources read it. Behind the in process one is a full [`DataSourceInterface`](./data-source.md)
implementation: filters, relations, unique declarations, transactions, migrations, change sets, soft
deletes and backups all behave as they do anywhere else.

A suite that is *about* storage belongs on the engine it will run against — real ddl, connection
pooling, isolation levels, anything whose answer depends on the database:

```ts
dataSources: [createPostgresTestDataSource({ entities })]
```

The harness starts a container for it and points the data source at the port it was mapped to. It
also takes the credentials, and `poolSize` with `connectionTimeoutInMs` for a test that is about the
pool itself. A container takes seconds to come up, so give such a suite a timeout to match.

Both creators build a class per call, because a data source is identified by its class. Pass
`allowOrphan: true` for one a test builds and hands to something other than the application it starts.

### Where a test server writes
An application records things on disk while it runs — its route history above all. Each started
server gets a directory of its own for that, under `src/__testing__/file-output/`, and takes it with
it when it shuts down:

```ts
it('writes into a directory of its own', () => {
    server.scratchPath;   // .../src/__testing__/file-output/server-a1b2c3
});
```

It sits in the project rather than in a temp folder because the first thing anyone does with a
failing test is look at what it wrote — and a run that fails before `shutdown` leaves it there.

**A `reInit` keeps it.** That is what makes a restart a restart: the second boot finds the route
history the first one recorded, which is what an application meets when it starts up on state it
left behind. Only `shutdown` clears it, and each server gets its own, so two in one file cannot read
back each other's.

A test that wants to seed a history, or read one after the server is gone, names the path itself and
the harness stays out of the way:

```ts
const ownVersionsFolder = {
    providers: [
        ...defaultTestProviders,
        defineProvider({ token: ZIBRI_DI_TOKENS.VERSIONS_PATH, useValue: myFolder })
    ]
};
```

The paths a test server redirects this way are `VERSIONS_PATH`, `TRANSLATIONS_PATH` and
`FILE_UPLOAD_TEMP_FOLDER`. `assetsPath` is not among them — assets are read, not written, so a test
points it at fixtures with the `assetsPath` option instead.

### Changing how the application is configured
Starting a server is most of what a container-backed suite costs, and the same containers can carry
several applications. `reInit` builds the next one on them:

```ts
it('runs the next application on the same containers', async () => {
    await server.reInit({ controllers: [OtherController] });
});
```

Anything left out is taken from the application being replaced, so a test that changes one thing
names one thing. Pass an `application` to build on a different one entirely. Plugins are the
exception and are named each time: an application keeps what a plugin registered rather than the
plugin itself.

### What the test providers change
`defaultTestProviders` is what the scaffolded test options layer on top of the application's own
providers. Each entry is there because the shipped default is right for a deployment and awkward for
a test:

| Token | What a test server uses instead |
|---|---|
| `SCRYPT_COST` | node's older cost, so hashing a password costs milliseconds rather than a fifth of a second |
| `JWT_AUTH_OPTIONS_INPUT` | two fixed secrets, so tokens are reproducible across processes |
| `CONFIRM_PASSWORD_RESET_URL`, `PASSWORD_RESET_EMAIL_TEMPLATE` | fixtures, so an application that never resets a password still starts |
| `EMAIL_CONFIG`, `EMAIL_TRANSPORT` | an `UnconfiguredEmailTransport`, which refuses to send and names the token to register a real one under |
| `ENCRYPTION_MASTER_OPTIONS` | `testMasterKey`, the same 32 bytes in every process, so replicas sharing a database read each other's values |
| `CRON_SERVICE` | a stub that schedules nothing, so tests run on their own clock |
| `MULTITHREADING_SERVICE` | a stub that spawns nothing, so no worker outlives the test that started it |
| `AUTH_RATE_LIMIT_OPTIONS` | a limit above what a suite makes, so the eleventh test still reaches its endpoint |

A later provider for a token wins, which is what puts these on top of the application's. A test that
is about one of them says so, and gets the shipped behavior back:

```ts
beforeAll(async () => {
    server = await startTestServer({
        application: testApplicationOptions,
        providers: [
            ...testApplicationOptions.providers ?? [],
            defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: new RecordingTransport() })
        ]
    });
});
```

The two stubs are values rather than overrides of a shipped default, so a test that wants the real
cron scheduler or the real thread pool filters them out of the list instead of appending to it —
`defaultClusterProviders` is exactly that list, filtered exactly that way.

`testMasterKey` is exported for the case that needs it: a test swapping the master encryption
strategy hands it back in as an old key, so the key rows already stored stay readable.

## Testing across several instances
Some behavior only exists with more than one replica: a cron job firing on each of them, an event
that stays in the process that emitted it, a queued mail sent as many times as there are pods. Those
need real processes — one Zibri application exists per process — which is what `startTestCluster`
gives:

```ts
import { startTestCluster } from 'zibri-testing';

let cluster: StartedTestCluster;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(__dirname, 'cron.instance-options.ts'),
        instances: 3
    });
});
```

Every instance is forked with the same options module and gets the ports of the containers the parent
started. `bootMode` decides whether they come up one after another (the default, letting the first
settle the schema) or all at once, which is what a rolling deploy does.

### The instance options module
A class cannot cross a process boundary, so what the instances boot with is named by a path. The
module default exports the same `StartTestServerOptions` a single process test passes — including
`application`, so a cluster runs the application that ships:

```ts
// cron.instance-options.ts
import { ClusterMark, clusterInstanceId, StartTestServerOptions } from 'zibri-testing';

class ClusterCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = { name: 'cluster-cron', cron: CronExpression.fromString('*/3 * * * * *') };

    constructor(
        @InjectRepository(ClusterMark)
        private readonly markRepository: Repository<ClusterMark>
    ) {
        super();
    }

    async onTick(): Promise<void> {
        await this.markRepository.create({
            instanceId: clusterInstanceId(), kind: 'cron', tag: currentTick(), at: new Date()
        });
    }
}

const cronClusterOptions: StartTestServerOptions = { cronJobs: [ClusterCronJob] };

export default cronClusterOptions;
```

The parent imports this module as well — that is how it learns which containers to start — so
anything at its top level runs in a process that is not an instance. `clusterInstanceId` is therefore
read per tick or per request rather than once on load, as the example above does.

Left to itself an instance boots on `defaultClusterDataSources` (one postgres data source carrying
`defaultClusterTestEntities`) with `defaultClusterProviders` — the single process defaults with the
cron and multithreading stubs taken back out and a thread pool sized for a machine running several
replicas, because those two subsystems are what a cluster test usually watches. An application whose
entities matter names its own:

```ts
const ownEntitiesOptions: StartTestServerOptions = {
    application: testApplicationOptions,
    dataSources: [createPostgresTestDataSource({ entities: [...defaultClusterTestEntities, ...entities] })],
    providers: [...baseApplicationOptions.providers ?? [], ...defaultClusterProviders]
};
```

### Observing what the cluster did
Which replica acted is the question every cluster test asks, and `ClusterMark` is where the answer is
recorded: one row per thing an instance did, carrying the instance's id, a `kind` and a `tag` saying
which occurrence of that kind it was.

The parent reads those straight out of the container, so the answer travels through no code path
belonging to the thing under test:

```ts
it('sees three distinct ticks across the deployment', async () => {
    const marks: ClusterMarkRow[] = await cluster.waitFor(
        async () => await cluster.marks('cron'),
        (rows: ClusterMarkRow[]) => new Set(rows.map(r => r.tag)).size >= 3,
        { timeoutInMs: 20000 }
    );
});
```

`waitFor` reads until the cluster reaches the awaited state, which is what makes a test about work
that happens on its own schedule fast and stable at once. `sql` runs any select and returns the rows
as json, `marks` is the shorthand for the mark table, and `clearMarks` throws away what was recorded
while the cluster was still assembling — the first instance is already firing cron jobs while the
others boot, and those runs describe a cluster that did not exist yet.

The canonical assertion is one row per tag: work the cluster owes once was done once.

```ts
const duplicated: [string, string[]][] = [...writersByTag.entries()].filter(([, writers]) => writers.length > 1);
expect(duplicated).toEqual([]);
```

A cluster gets one scratch directory for all of its instances, on `cluster.scratchPath`, because
they are replicas of a single deployment. Killing one and starting another leaves it alone — what a
replacement finds is what the cluster wrote — and `cluster.shutdown()` removes it.

### Taking a replica down
`cluster.kill(id)` ends an instance and removes it from the cluster, so `scaleTo` replaces it.
`SIGTERM` runs the framework's shutdown handlers; `SIGKILL` is a crash, which is the way to observe
what a replica leaves behind when it stops without cleaning up.

```ts
it('carries on with one replica gone', async () => {
    await cluster.kill('instance-0', 'SIGKILL');
    await cluster.scaleTo(2);
});
```

Each instance is addressed over http like any other server — `cluster.instanceAt(0).baseUrl` — so a
test can call one replica and assert against another. Everything an instance wrote to stdout and
stderr is kept on `output` and attached to whatever the harness throws, which is where a boot failure
explains itself.

## See also
- [Application lifecycle](./application-lifecycle.md) — what `init`, `start` and `shutdown` run, and in which order
- [Data sources](./data-source.md) — entities, repositories and migrations, all of which the in process data source implements
- [Dependency injection](./di.md) — `defineProvider` and the tokens a test registers its own provider for
- [Replication](./replication.md) — what running several instances means, which is what a cluster test observes
- [Cron](./cron.md) — jobs, and the scheduler the test providers stub out
- [Email](./email.md) — transports, and what registering a real one for a test looks like