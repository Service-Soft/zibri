# Testing
You test a Zibri application by starting it and driving it over HTTP. `zibri-testing` starts it with
the router, the [auth strategies](./glossary.md#auth-strategy), the lifecycle, the data source and the error handling production
runs, so the application under test is the one that ships.

```bash
npm i -D zibri-testing
```

It peer depends on `zibri`, so the framework under test is the copy your application already has.
`zi new` sets all of this up, including a first test to copy.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `startTestServer` | function | Boots an application and hands back a `StartedTestServer` |
| `StartedTestServer` | class | The running server: `start`, `reInit`, `shutdown`, and `scratchPath`, where its application writes what it records at runtime |
| `StartTestServerOptions` | type | The application to build on, and what to change about it |
| `resolveApplicationOptions` | function | The merge itself, for a harness of your own |
| `createJestConfig`, `JestConfigOptions` | function, type | Builds the jest configuration of your tests, with the packages of your own that ship as ES modules only. Also from `zibri-testing/jest-config` |
| `createInMemoryDataSource` | function | Builds a data source class that keeps everything in this process |
| `InMemoryDataSource` | class | The data source those classes extend |
| `RoundTripCounter`, `RoundTrip` | class, type | Records each call a data source makes on its store, and the repository calls it came from |
| `createPostgresTestDataSource` | function | Builds a postgres data source class for a container the harness starts |
| `zibriFrameworkEntities` | constant | The entities a test data source declares for you: those every application needs, and those of password and JWT login, one-time passwords, migrations, [change sets](./glossary.md#change-set), caches and websockets |
| `defaultTestProviders` | constant | The providers that make a deployment's defaults workable in a test |
| `testMasterKey` | constant | The encryption [master key](./glossary.md#master-key) those providers register |
| `UnconfiguredEmailTransport` | class | A mail transport that refuses to send |
| `RecordingEmailTransport` | class | A mail transport that sends nothing and keeps what it was given, in `sends` |
| `RecordingSmsService` | class | A text message sender that sends nothing and keeps what it was given, in `sent` |
| `startFakeOAuthProvider` | function | Starts a provider inside the test, speaking [OpenID Connect](./glossary.md#openid-connect) or plain OAuth2 |
| `FakeOAuthProvider` | class | The running provider: who logs in, and what it was asked |
| `startFakeSamlProvider` | function | Starts a [SAML](./glossary.md#saml) 2.0 identity provider inside the test |
| `FakeSamlProvider` | class | The running identity provider: who logs in, what it was asked, and the logout requests it sends |
| `FakeSamlProviderOptions`, `FakeSamlIdentity`, `FakeSamlAnswerChanges`, `FakeSamlLogoutOptions` | type | How it answers, who logs in, what the next answer gets wrong, and who a logout request logs out |
| `FakeSamlRequest`, `FakeSamlAnswer`, `FakeSamlLogoutRequest` | type | What it was asked, and what it answered |
| `createFakeKeyPair`, `FakeKeyPair` | function, type | A key and its certificate: your application's SAML signing and decryption keys, or a TLS server's |
| `FakeKeyPairOptions` | type | The hosts a certificate is valid for, whether it is an authority, the authority that signs it, when it is valid, and its key usages and extended key usages |
| `FakeKeyUsage` | type | A key usage a certificate can name, such as `digitalSignature` |
| `startFakeLdapDirectory` | function | Starts a directory inside the test, speaking LDAP over TLS |
| `FakeLdapDirectory` | class | The running directory: its entries, and the binds and searches it was asked for |
| `FakeLdapDirectoryOptions`, `FakeLdapEntry`, `FakeLdapBind`, `FakeLdapSearch` | type | Its entries, and what it was asked |
| `TestBrowser` | class | Plays the browser: keeps cookies, follows no redirect on its own |
| `FakePasskeyDevice` | class | Plays a device with its browser: creates and uses passkeys |
| `FakePasskeyDeviceOptions`, `FakePasskey`, `FakePasskeyAttestation` | type | What kind of device it is, the passkeys it holds, and how it proves its model |
| `FakeDpopKey`, `FakeDpopProofOptions` | class, type | A client's key pair, signing [DPoP](./glossary.md#dpop) proofs, see [signing DPoP proofs](#signing-dpop-proofs) |
| `startFakeFidoMetadataService` | function | Starts a FIDO Metadata Service inside the test |
| `FakeFidoMetadataService` | class | The running service: the models it lists, and the attestations of their devices |
| `startDataSourceContainers` | function | Starts one container per data source that needs a server of its own |
| `CONTAINER_PROCESS_LABEL` | constant | The label on each of those containers naming the pid of the process that started it |
| `startTestCluster` | function | Boots several instances of one application against shared data sources |
| `StartedTestCluster` | class | The running cluster: `instanceAt`, `sql`, `marks`, `waitFor`, `kill`, `scaleTo`, `shutdown` |
| `ClusterInstance` | class | One replica: its `baseUrl`, its `output`, and `kill` |
| `ClusterMark` | entity | The row an instance writes to record that it, specifically, did something |
| `ClusterMarkRow` | type | A `ClusterMark` as `marks` reads it, with `at` as a JSON string |
| `clusterInstanceId` | function | Which instance the current process is |
| `defaultClusterTestEntities` | constant | The framework's entities plus `ClusterMark` |
| `defaultClusterDataSources` | constant | The postgres data source a cluster boots on |
| `defaultClusterProviders` | constant | What a cluster instance boots with |
| `JsonUtilities` | class | `parse`, and `stringify`, which writes a `bigint` as a string |
| `UUIDUtilities` | class | `generate` for a v4 uuid, and `isUuid` to check one |
| `ObjectUtilities` | class | `keys`, `values` and `entries` typed after the object, and `copyDeep` |

## Optional packages
Install these only for what needs them. Anything else in the harness works without them.

| Package | Needed by |
|---|---|
| `testcontainers` | A Postgres or ValKey data source, which the harness starts a container for |
| `ts-node` | `startTestCluster` |
| `ts-jest` | The jest configuration |
| `@peculiar/x509` | `createFakeKeyPair`, `startFakeSamlProvider`, `startFakeLdapDirectory` and `startFakeFidoMetadataService` |
| `ldapts` | `startFakeLdapDirectory` |
| `xml-crypto` | `startFakeSamlProvider` |
| `xml-encryption` | `startFakeSamlProvider` with `encryptsTo` |

## Starting your application in a test
`startTestServer` boots your application, with its data source and its lifecycle, and `start` hands
back the URL it answers at. `zi new` writes a first test:

```ts
// src/__testing__/app.test.ts
import { afterAll, beforeAll, expect, it } from '@jest/globals';
import { StartedTestServer, startTestServer } from 'zibri-testing';

import { testApplicationOptions } from './test-application-options';

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

Starting the application runs its migrations and starts every provider, which takes longer than the
five seconds jest gives a hook, so both hooks are given 30 seconds.

A test file boots the application on the modules it imports. `jest.resetModules()` and
`jest.isolateModules()` load a [second copy of `zibri`](./di.md#one-copy-per-process), and the
next boot raises a `DuplicateFrameworkCopyError`. A test that resets the module registry goes in a
file of its own: jest gives every file a registry of its own.

`testApplicationOptions` is your application as a test starts it. A test and a deployment share the
application's options, so they live in modules of their own, not inline in `index.ts`. `zi new` writes
three: the base, with everything the application is, the options a deployment starts, which add where
it keeps its data, and the same application as a test starts it:

```ts
// src/application-options.base.ts
import { MailingListController, OmitStrict, SemVerUtilities, ZibriApplicationOptions, ZibriMailingListPlugin } from 'zibri';

import { AppAuthController, PageController } from './controllers';
import { version } from '../package.json';
import { providers } from './providers';

if (!SemVerUtilities.isSemVerVersion(version)) {
    throw new Error('The version of the package.json is not valid.');
}

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Task Tracker',
    baseUrl: 'http://localhost:3000',
    plugins: [new ZibriMailingListPlugin()],
    controllers: [PageController, MailingListController, AppAuthController],
    websocketControllers: [],
    cronJobs: [],
    version,
    environment: 'development',
    defaultAuth: 'public',
    twoFactorAtLogin: 'ifEnrolled',
    providers
};
```

```ts
// src/application-options.ts
import { ZibriApplicationOptions } from 'zibri';

import { baseApplicationOptions } from './application-options.base';
import { DbDataSource } from './data-sources';

export const applicationOptions: ZibriApplicationOptions = {
    ...baseApplicationOptions,
    dataSources: [DbDataSource]
};
```

```ts
// src/__testing__/test-application-options.ts
import { ZibriApplicationOptions } from 'zibri';
import { createInMemoryDataSource, defaultTestProviders } from 'zibri-testing';

import { baseApplicationOptions } from '../application-options.base';
import { entities } from '../data-sources/db/entities';
import { repositories } from '../data-sources/db/repositories';

export const testApplicationOptions: ZibriApplicationOptions = {
    ...baseApplicationOptions,
    dataSources: [createInMemoryDataSource({ entities, repositories })],
    providers: [...baseApplicationOptions.providers ?? [], ...defaultTestProviders]
};
```

`index.ts` starts `new ZibriApplication(applicationOptions)`.

The base holds everything a test and a deployment share. Each of the two modules beside it adds the
data source it uses. Keep the production data source out of the base: importing a data source
registers it, and one registered without being deployed is refused at boot.

The test options can live anywhere `index.ts` does not reach, which keeps them out of the bundle.
`zi new` puts them in `src/__testing__/`, beside the first test.

## Configuring jest
`zi new` writes this `jest.config.mjs`:

```js
// jest.config.mjs
import { createJestConfig } from 'zibri-testing/jest-config';

export default createJestConfig({ rootDir: 'src' });
```

`createJestConfig` compiles your code with `ts-jest` and your templates with `zibri-tsx/jest`, so a
test renders the same templates the build does. A package imported with `?client` is the package
itself in a test, as it is in the server build. A test worker is restarted once it holds more than
1 GB, which keeps a long run within the memory of the machine. Every jest option you pass is kept,
`workerIdleMemoryLimit` included.

Jest cannot load a package that ships as ES modules only. Name such a package of yours in
`esmPackages`, and it is compiled like your code:

```js
// jest.config.mjs
import { createJestConfig } from 'zibri-testing/jest-config';

export default createJestConfig({ rootDir: 'src', esmPackages: ['nanoid'] });
```

The same configuration without options is a preset, which a config names with `preset: 'zibri-testing'`.

## Overriding what the application sets
`startTestServer` takes the application to build on and whatever the test changes about it. Each key
is resolved on its own: the call first, then the application, then the harness's own default. This
test starts the whole application, with one controller in place of its own:

```ts
// src/__testing__/app.test.ts
import { beforeAll } from '@jest/globals';
import { startTestServer } from 'zibri-testing';

import { TaskController } from '../controllers';
import { testApplicationOptions } from './test-application-options';

beforeAll(async () => {
    server = await startTestServer({
        application: testApplicationOptions,
        controllers: [TaskController]
    });
});
```

Every key the test leaves out, such as the version, the data source or the default auth, comes from
the application. A key replaces the application's value, so a test naming one controller gets one
controller. Spread the application's own list to keep it:
`controllers: [...baseApplicationOptions.controllers, TaskController]`.

An override that is `undefined` counts as not named, so you can build the options from a variable:

```ts
// src/__testing__/start-for-scenario.ts
import { Newable } from 'zibri';
import { StartedTestServer, startTestServer } from 'zibri-testing';

import { testApplicationOptions } from './test-application-options';

export async function startForScenario(scenario: { controllers?: Newable<unknown>[] }): Promise<StartedTestServer> {
    const controllers: Newable<unknown>[] | undefined = scenario.controllers;
    return await startTestServer({ application: testApplicationOptions, controllers });
}
```

Everything a `ZibriApplication` takes can be named this way: `controllers`, `websocketControllers`,
`cronJobs`, `providers`, `plugins`, `authStrategies`, `twoFactorMethods`, `twoFactorAtLogin`, `twoFactorFailureLimit`, `passwordFailureLimit`, `bodyParsers`, `security`,
`defaultAuth`, `version`, `name`, `baseUrl`, `dataSources`.

Without an `application` to build on, the harness boots one with no controllers on an in-process data
source, for a test of the framework itself or a quick experiment.

## Storing something
Most tests need a data source only because the application starts with one. `createInMemoryDataSource`
keeps every row in the test's process, and needs no container and no configuration.

```ts
// src/__testing__/test-application-options.ts
import { createInMemoryDataSource } from 'zibri-testing';

import { entities } from '../data-sources/db/entities';
import { repositories } from '../data-sources/db/repositories';

dataSources: [createInMemoryDataSource({ entities, repositories })]
```

The framework's own entities are added for you, so `entities` is the list your real data source
declares beside them, and `repositories` the [repositories of your own](./data-source.md#writing-a-repository-of-your-own)
it lists. `zi new` puts both lists in modules of their own, which both data sources read.
The in-process data source implements the whole [`DataSourceInterface`](./data-source.md): filters,
relations, unique declarations, transactions, migrations, change sets, [soft deletes](./glossary.md#soft-delete) and backups all
behave as they do anywhere else. A message published on it reaches every subscriber in this process.

Run a suite that tests storage itself on the database it will run against, for real DDL, connection
pooling, isolation levels and anything else whose answer depends on the database:

```ts
// src/__testing__/test-application-options.ts
import { createPostgresTestDataSource } from 'zibri-testing';

import { entities } from '../data-sources/db/entities';

dataSources: [createPostgresTestDataSource({ entities })]
```

The harness starts a container for it and points the data source at the port it was mapped to. It
also takes the credentials, and `poolSize` with `connectionTimeoutInMs` for a test that is about the
pool itself. A container takes seconds to come up, so give such a suite a timeout to match. When one
of a server's containers cannot be started, the ones that could are stopped before the error is
thrown, so nothing is left running. Whatever fails while cleaning up after a failed start is logged
as a warning, and the error thrown is the one that stopped the start.

Your application connects the way it does to a managed Postgres: as a role that owns its database
and has no other privilege. It cannot create roles or databases and is not a superuser, so a suite
fails wherever your application would need more than that in production.

Both creators build a class per call, because a data source is identified by its class. Pass
`allowOrphan: true` for one a test builds and hands to something other than the application it starts.

### Counting what a call costs
Hand `createInMemoryDataSource` a `RoundTripCounter`, and it records every call a repository makes
on the store, as `Entity.method`, and every message published on it, as `publish <channel>`. Use it to pin down what a repository call costs, and to find what
changed when it costs more:

```ts
// src/__testing__/task.repository.test.ts
import { expect, it } from '@jest/globals';
import { inject, Newable, Repository, repositoryTokenFor } from 'zibri';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { entities } from '../data-sources/db/entities';
import { Task } from '../models/task.model';

const roundTrips: RoundTripCounter = new RoundTripCounter();
const costedDataSource: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities, roundTrips });

it('updates a task with one read and one write', async () => {
    const tasks: Repository<Task> = inject(repositoryTokenFor(Task));
    const task: Task = await tasks.create({ status: 'open' });

    await roundTrips.resolveCountOf(async () => await tasks.updateById(task.id, { status: 'done' }));

    expect(roundTrips.trips.map(t => t.statement)).toEqual(['Task.find', 'Task.updateAll']);
});
```

`roundTrips.describe()` lists each call with the repository calls it came from, such as
`ChangeSetRepository.updateById > Repository.saveUpdate`.

## Where a test server writes
An application records things on disk while it runs, such as its route history. Each started server
gets a directory of its own for that, under `src/__testing__/file-output/`, and removes it when it
shuts down:

```ts
// src/__testing__/app.test.ts
import { it } from '@jest/globals';

it('writes into a directory of its own', () => {
    server.scratchPath;   // .../file-output/server-a1b2c3
});
```

It sits in the project, so you can look at what a failing test wrote. A run that fails before
`shutdown` leaves it there.

A `reInit` keeps it, so the second boot finds the route history the first one recorded, as an
application does when it restarts. Only `shutdown` clears it. Each server gets its own, so two
servers in one file never read each other's.

To seed a history, or to read one after the server is gone, name the path yourself. The harness then
leaves it alone:

```ts
// src/__testing__/version-history.test.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';
import { defaultTestProviders, StartTestServerOptions } from 'zibri-testing';

import { seededVersionsFolder } from './fixtures';

const seededVersions: StartTestServerOptions = {
    providers: [
        ...defaultTestProviders,
        defineProvider({ token: ZIBRI_DI_TOKENS.VERSIONS_PATH, useValue: seededVersionsFolder })
    ]
};
```

The paths a test server redirects this way are `VERSIONS_PATH`, `TRANSLATIONS_PATH`,
`FILE_UPLOAD_TEMP_FOLDER` and `BACKUP_TEMP_FOLDER`. The translations folder holds a `source.xlf`
with nothing to translate, so the application starts the way a deployment does. A test that serves its own fixtures names the folder they are in the same
way, with the [`ASSETS_PATH`](./assets.md) token.

## Changing how the application is configured
`reInit` builds the next application on the containers of the running one, so a container-backed
suite starts them once:

```ts
// src/__testing__/app.test.ts
import { it } from '@jest/globals';

import { ProjectController } from '../controllers';

it('runs the next application on the same containers', async () => {
    await server.reInit({ controllers: [ProjectController] });
});
```

Anything left out is taken from the application being replaced. Pass an `application` to build on a
different one. Plugins are the exception: name them each time, since an application keeps what a
plugin registered and not the plugin itself.

## What the test providers change
The scaffolded test options add `defaultTestProviders` on top of the application's own providers.
Each replaces a default that fits a deployment and not a test:

| Token | What a test server uses instead |
|---|---|
| `SCRYPT_COST` | node's older cost, so hashing a password takes milliseconds instead of a fifth of a second |
| `JWT_AUTH_OPTIONS_INPUT` | two fixed secrets, so tokens are reproducible across processes, and `requireDpop: false` |
| `CONFIRM_PASSWORD_RESET_URL`, `PASSWORD_RESET_EMAIL_TEMPLATE` | fixtures, so an application that never resets a password still starts |
| `EMAIL_CONFIG`, `EMAIL_TRANSPORT` | an `UnconfiguredEmailTransport`, which refuses to send and names the token to register a real one under, and failed mails kept `'forever'` |
| `EVENT_FAILED_RETENTION_IN_MS`, `THREAD_JOB_RETENTION_IN_MS` | `'forever'`, since they have no default |
| `AUDIT_RETENTION_IN_MS` | a year, since it has no default |
| `ENCRYPTION_MASTER_OPTIONS` | `testMasterKey`, the same 32 bytes in every process, so replicas sharing a database read each other's values |
| `CRON_SERVICE` | a stub that schedules nothing, so tests run on their own clock |
| `MULTITHREADING_SERVICE` | a stub that spawns nothing, so no worker outlives the test that started it |
| `AUTH_RATE_LIMIT_OPTIONS` | a limit above what a suite makes, so the eleventh test still reaches its endpoint |

A later provider for a token wins, so these replace the application's. A test about one of them
names its own provider for the token:

```ts
// src/__testing__/app.test.ts
import { beforeAll } from '@jest/globals';
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';
import { RecordingEmailTransport, startTestServer } from 'zibri-testing';

import { testApplicationOptions } from './test-application-options';

beforeAll(async () => {
    server = await startTestServer({
        application: testApplicationOptions,
        providers: [
            ...testApplicationOptions.providers ?? [],
            defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: new RecordingEmailTransport() })
        ]
    });
});
```

A test that wants the real cron scheduler or the real thread pool filters the two stubs out of the
list. `defaultClusterProviders` is that list, filtered that way.

A test that swaps the master encryption strategy hands `testMasterKey` back in as an old key, so the
key rows already stored stay readable.

## Logging in through a provider
`startFakeOAuthProvider` starts an OpenID Connect provider inside the test, reached over HTTP on
`127.0.0.1`. It logs in whoever its `identity` says, without asking anything. Point your
[authenticator](./glossary.md#authenticator)'s `issuer` at it, and drive the login with a `TestBrowser`, which keeps the cookies
each site sets and follows no redirect on its own:

```ts
// src/__testing__/app.test.ts
import { beforeAll, expect, it } from '@jest/globals';
import { FakeOAuthProvider, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

let provider: FakeOAuthProvider;

beforeAll(async () => {
    provider = await startFakeOAuthProvider({ clientId: 'task-tracker', clientSecret: 'secret' });
});

it('logs a user in', async () => {
    provider.identity = { subject: 'ada', email: 'ada@example.com', emailVerified: true };
    const browser: TestBrowser = new TestBrowser(baseUrl, 'https://api.example.com');

    const atProvider: string = await browser.follow('https://api.example.com/auth/federated/login/request?authenticator=company&redirectTo=https://app.example.com');
    const callback: string = await browser.follow(atProvider);
    expect(await browser.follow(callback)).toBe('https://app.example.com');
});
```

The second argument of `TestBrowser` is the `baseUrl` of your application. The browser sends what
goes there to the test server, so the callback URL your provider knows works in the test as well.

| Member | What it does |
|---|---|
| `identity`, `authenticatedAt` | Who logs in next, and when they logged in at the provider. `identity.claims` puts claims on top into every token for them, such as `groups` or `oid` |
| `denyNext(error)` | Answers the next login with an error, such as `access_denied` |
| `failNextTokenRequest(status)` | Answers the next request to the token endpoint with that status and a page, the way a gateway in front of a provider that is down does |
| `failNextDiscovery(status)` | Answers the next request for the metadata with that status and a page: 500 or more for a provider that is down, less for a URL with no provider |
| `metadataReads` | How often your application read the metadata |
| `addToNextAnswer(fields)` | Sends the next answer with more fields next to the code, the way Apple sends the user's name |
| `rewriteNextIdToken(rewrite)` | Changes the claims of the next ID token before it is signed |
| `authorizationRequests` | What your application asked the provider for |
| `tokenRequests` | What your application sent the token endpoint: the exchanges of codes, and the refreshes |
| `apiRequests` | Every request your application sent the provider's API |
| `declinedScopes` | The scopes the user leaves out whenever they are asked for them |
| `revokedTokens` | The tokens your application handed back at the revocation endpoint |
| `revokeGrantsOf(subject)` | Withdraws what a user allowed your client, the way removing an app at the provider does |
| `createJwtAccessToken(options)` | Signs an access token for an API as a JWT for `identity`, the way a mobile app or a service holds one, see [accepting a provider's tokens](./provider-tokens.md). Takes the `audience`, the `typ` (`at+jwt` by default) and claims on top, such as a `cnf` |
| `createIdToken(audience, claims)` | Signs an ID token for `identity`, issued to the client `audience`, the way a mobile app holds one once the user logged in there |
| `formPost` | An option: the provider answers with a page posting the code, like `response_mode=form_post` |
| `clientSecret` | An option: the secret of your client, or a function checking the one it sends, for a secret your application signs |
| `issuesIdToken` | An option: `false` makes it a provider that speaks plain OAuth2, issuing an access token and no ID token |
| `resources` | An option: what its API answers, by path, to a request with an access token it issued, made from who that token is for |
| `supportedPrompts` | An option: the `prompt` values it takes. A login asking for another one gets an error page, the way Google answers `prompt=login` |
| `accessTokenExpiresInSeconds` | An option: how long an access token it issues is valid. 300 by default |
| `rotatesRefreshTokens` | An option: a refresh gives out a new refresh token and refuses the old one from then on |
| `publicUrl` | An option: the URL the provider is reached at from the outside, which every URL it names starts with, such as `https://login.microsoftonline.com/organizations/v2.0` |
| `issuer` | An option: the issuer its metadata names. A `{tenantid}` in it is filled in for every token from the `tid` claim of `identity`, like Microsoft Entra ID's `organizations` and `common` endpoints. The public URL by default |
| `listeningUrl` | Where the provider listens, which its `publicUrl` resolves to |

A provider with a `publicUrl` is reached through it by your application and by the browser. Hand the
browser the URL it resolves to as the third argument, `{ [publicUrl]: provider.listeningUrl }`, and
send your application's requests to it through an [HTTP client](./http-client.md) of your own under
`ZIBRI_DI_TOKENS.HTTP_CLIENT` that does the same.

For a provider that speaks plain OAuth2, point the authenticator's endpoints and API at it too:

```ts
// src/__testing__/app.test.ts
import { beforeAll } from '@jest/globals';
import { FakeOAuthProvider, startFakeOAuthProvider } from 'zibri-testing';

let github: FakeOAuthProvider;

beforeAll(async () => {
    github = await startFakeOAuthProvider({
        clientId: 'task-tracker',
        clientSecret: 'secret',
        issuesIdToken: false,
        resources: { '/user': identity => ({ id: Number(identity.subject), name: identity.name }) }
    });
});
```

A request `TestBrowser.open` sends with `crossSiteFrom` is one another site's page sends, like a
form the provider posts: it carries that `Origin`, `Sec-Fetch-Site: cross-site`, and only the cookies a
browser sends across sites, those with `SameSite=None` and, on a GET, those with `SameSite=Lax`.

`startFakeSamlProvider` starts a SAML 2.0 identity provider the same way. Point your authenticator's
`issuer` at its `entityId` and its `identityProvider` at its `metadataUrl`. It answers with a page
posting the signed answer, which the test posts to the callback from the provider's origin:

```ts
// src/__testing__/app.test.ts
import { beforeAll, expect, it } from '@jest/globals';
import { FakeSamlAnswer, FakeSamlProvider, startFakeSamlProvider, TestBrowser } from 'zibri-testing';

let idp: FakeSamlProvider;

beforeAll(async () => {
    idp = await startFakeSamlProvider({
        serviceProviderEntityId: 'https://app.example.com/saml',
        serviceProviderLogoutUrl: 'https://api.example.com/auth/federated/company-saml/logout'
    });
});

it('logs a user in, and logs them out when they log out at the identity provider', async () => {
    idp.identity = { nameId: 'ada', attributes: { email: 'ada@example.com' } };
    const browser: TestBrowser = new TestBrowser(baseUrl, 'https://api.example.com');

    await browser.open(await browser.follow('https://api.example.com/auth/federated/login/request?authenticator=company-saml&redirectTo=https://app.example.com'));
    const answer: FakeSamlAnswer | undefined = idp.answers.at(-1);
    expect(await browser.follow(answer?.url ?? '', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: answer?.fields,
        crossSiteFrom: new URL(idp.entityId).origin
    })).toBe('https://app.example.com');

    await new TestBrowser(baseUrl, 'https://api.example.com')
        .follow(idp.createLogoutRequestUrl({ nameId: 'ada', sessionIndex: answer?.sessionIndex }));
});
```

| Member | What it does |
|---|---|
| `identity`, `authenticatedAt` | Who logs in next, with the NameID and the attributes sent, how they logged in as `authnContextClassRef`, and when they logged in at the provider |
| `denyNext(status)` | Answers the next login with a second level status, such as `urn:oasis:names:tc:SAML:2.0:status:RequestDenied` |
| `changeNextAnswer(changes)` | Gets the next answer wrong: another issuer or audience, unsolicited, expired, unsigned, signed by another key, or changed after it was signed |
| `createLogoutRequestUrl(options)` | The URL a user logging out at the provider is sent to: your logout route with a signed logout request, or one that is not signed |
| `createLogoutRequestForm(options)` | The same logout request as a form a page posts to your logout route, logged inside |
| `sendBackChannelLogout(url, options)` | Sends the logout request to your SOAP logout route without a browser, and reads what it answered and whether the answer is signed |
| `requests`, `answers` | What your application asked the provider for, the classes of authentication it asked for included, and what it answered, with the session it names |
| `logoutRequests` | The logout requests your application sent the provider |
| `logoutAnswers`, `logoutResponses` | The forms its page posted to answer your logout requests, and the logout responses your application posted to it |
| `metadataReads` | How often the metadata was read |
| `signs` | An option: whether it signs the assertion, the whole response, or both |
| `encryptsTo` | An option: the certificate of your decryption key, which it encrypts the assertion to |
| `requiresRequestsSignedBy` | An option: the certificate of your signing key, which every request has to be signed with |
| `serviceProviderLogoutUrl` | An option: your logout route, where it sends logout requests and the answers to yours |
| `logoutBindings` | An option: whether its metadata names its logout URL for redirects, posted forms or both. Redirects by default |
| `answersLogoutWith` | An option: whether it answers your logout requests with a redirect or with a page posting the answer. A redirect by default |

## Logging in with a passkey
A `FakePasskeyDevice` does what a browser and a device do with [passkeys](./passkeys.md): hand it the options your routes answer with and the origin of the page, and it answers what the browser would:

```ts
// src/__testing__/app.test.ts
import { expect, it } from '@jest/globals';
import { JsonUtilities, PasskeyRequestOptions } from 'zibri';
import { FakePasskeyDevice } from 'zibri-testing';

it('logs a user in with a passkey', async () => {
    const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
    const options: PasskeyRequestOptions = await (await fetch(`${baseUrl}/auth/login-options`, { method: 'POST' })).json();

    const res: Response = await fetch(`${baseUrl}/auth/login?authenticator=passkey`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ response: device.get(options, 'https://app.example.com') })
    });

    expect(res.status).toBe(200);
});
```

| Member | What it does |
|---|---|
| `create(options, origin)` | Creates a [passkey](./glossary.md#passkey), as `navigator.credentials.create` does |
| `get(options, origin, passkeyId)` | Uses one, as `navigator.credentials.get` does. The first one for the site unless you pick one |
| `passkeys` | The passkeys it holds, with their signature counts |
| `copy()` | A copy of the device with every passkey and count on it |
| `verifiesUser` | Whether it verifies its user before the next passkey it creates or uses |
| `synced` | An option: its passkeys are synced, like a phone's password manager keeps them, and count no signatures |
| `storesPasskeys` | An option: whether it stores its passkeys, so it offers them at a login that names none. `false` is an older security key, which refuses to create a passkey where a stored one is demanded |
| `aaguid` | An option: the model it names |
| `attestation` | An option: what it proves its model with, from a `FakeFidoMetadataService` |

`startFakeFidoMetadataService` starts a FIDO Metadata Service inside the test, signed under a root of its own. Point `metadataServiceUrl` at its `blobUrl` and `metadataServiceRootCertificates` at its `rootCertificate`. `passkeyOptions` below is what the test provides `PASSKEY_OPTIONS` with, and `allowedDevice` a device of the allowed model, which proves its model when it creates a passkey:

```ts
// src/__testing__/passkey-attestation.test.ts
import { beforeAll } from '@jest/globals';
import { PasskeyOptions } from 'zibri';
import { FakeFidoMetadataService, FakePasskeyAttestation, FakePasskeyDevice, startFakeFidoMetadataService } from 'zibri-testing';

let metadata: FakeFidoMetadataService;
let allowed: FakePasskeyAttestation;

beforeAll(async () => {
    metadata = await startFakeFidoMetadataService();
    allowed = await metadata.addModel();
});

function passkeyOptions(): PasskeyOptions {
    return {
        relyingPartyId: 'example.com',
        relyingPartyName: 'Task Tracker',
        origins: ['https://app.example.com'],
        attestation: {
            allowedAaguids: [allowed.aaguid],
            metadataServiceUrl: metadata.blobUrl,
            metadataServiceRootCertificates: [metadata.rootCertificate]
        }
    };
}

function allowedDevice(): FakePasskeyDevice {
    return new FakePasskeyDevice({ attestation: allowed });
}
```

| Member | What it does |
|---|---|
| `addModel()` | Lists a model, certified, and answers with what its devices prove themselves with |
| `createUnlistedModel(aaguid)` | A model nobody listed, naming whichever model you give |
| `reportCompromised(aaguid)` | Reports that the keys of a model have leaked |
| `downloads` | How often the list has been downloaded |
| `nextUpdate` | When the list says it is next updated |
| `close()` | Stops the service |

## Signing DPoP proofs
A `FakeDpopKey` holds a key pair the way a client does, and signs a [DPoP proof](./dpop.md) for whatever request you name. Sign the URL as your application's `baseUrl` writes it, not the address the test reaches the server at:

```ts
// src/__testing__/app.test.ts
import { expect, it } from '@jest/globals';
import { FakeDpopKey } from 'zibri-testing';

it('binds a login to the key of its proof', async () => {
    const key: FakeDpopKey = new FakeDpopKey();
    const appUrl: string = 'http://localhost:3000';

    const login: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', dpop: key.createProof('POST', `${appUrl}/auth/login`) },
        body: JSON.stringify({ email: 'ada@example.com', password: 'secret' })
    });
    const { accessToken } = await login.json();

    const me: Response = await fetch(`${baseUrl}/profile`, {
        headers: {
            authorization: `DPoP ${accessToken.value}`,
            dpop: key.createProof('GET', `${appUrl}/profile`, { accessToken: accessToken.value })
        }
    });
    expect(me.status).toBe(200);
});
```

| Member | What it does |
|---|---|
| `thumbprint` | The RFC 7638 thumbprint of the key, which a bound token names as `cnf.jkt` |
| `createProof(method, url, options)` | Signs a proof, with the `accessToken` it hashes, the `nonce`, the time it was `issuedAt` and its `jwtId` |

## Logging in through a directory
`startFakeLdapDirectory` starts a directory inside the test, for [login through a directory](./login-through-a-directory.md). It speaks LDAP over TLS with a certificate of its own: point your authenticator's `urls` at its `ldapsUrl`, or at its `ldapUrl` for StartTLS, and its `trustedCertificates` at its `certificate`:

```ts
// src/__testing__/app.test.ts
import { afterAll, beforeAll } from '@jest/globals';
import { FakeLdapDirectory, startFakeLdapDirectory } from 'zibri-testing';

let ldapDirectory: FakeLdapDirectory;

beforeAll(async () => {
    ldapDirectory = await startFakeLdapDirectory({
        entries: [
            { dn: 'cn=app,ou=services,dc=example,dc=com', password: 'service-secret', attributes: { objectClass: ['person'] } },
            {
                dn: 'uid=ada,ou=people,dc=example,dc=com',
                password: 'ada-secret',
                attributes: { objectClass: ['inetOrgPerson'], uid: ['ada'], mail: ['ada@example.com'] }
            }
        ]
    });
});

afterAll(async () => {
    await ldapDirectory.stop();
});
```

A bind in the clear is refused, a bind with a name and no password succeeds without binding as anybody, and only a connection bound with a password may search. An entry without an `entryUUID` gets one. `entryUUID`, `nsAccountLock` and `pwdAccountLockedTime` are sent only when a search asks for them by name. A search with Active Directory's in-chain rule, `(member:1.2.840.113556.1.4.1941:=<dn>)`, finds the groups an entry is a member of through other groups as well.

| Member | What it does |
|---|---|
| `entries` | The entries of the directory, which the test may change |
| `binds`, `searches` | The binds and searches it was asked for, with whether the connection was encrypted, who it was bound as and the attributes a search asked for |
| `connectionsOpened` | How many connections were opened to it |
| `ldapsUrl`, `ldapUrl` | Where it takes connections encrypted from the first byte, and ones upgraded with StartTLS |
| `certificate` | The certificate it proves who it is with |
| `dropConnections()` | Closes every open connection and goes on listening, the way an outage or a restart does to the connections your application keeps |
| `stop()` | Stops the directory |
| `password` | An option of an entry: the password a bind as it takes |
| `lockedWith` | An option of an entry: refuses every bind as it, with `invalidCredentials`, `unwillingToPerform` or `constraintViolation` |

## Testing across several instances
Some behavior exists only with more than one replica: a cron job firing on each of them, an event
that stays in the process that emitted it, a queued mail sent once per pod. Testing it takes several
processes, since a process holds one Zibri application. `startTestCluster` starts them:

```ts
// src/__testing__/cron.cluster.test.ts
import { beforeAll } from '@jest/globals';
import { FsUtilities } from 'zibri';
import { StartedTestCluster, startTestCluster } from 'zibri-testing';

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
settle the schema) or all at once, as in a rolling deploy.

### Writing the instance options module
The instances boot with what a module exports, named by its path, since a class cannot cross a
process boundary. The module default exports the same `StartTestServerOptions` a single process test
passes, `application` included, so a cluster runs the application that ships:

```ts
// src/__testing__/cron.instance-options.ts
import { CronExpression, CronJob, InitialCronConfig, InjectRepository, Repository } from 'zibri';
import { ClusterMark, clusterInstanceId, StartTestServerOptions } from 'zibri-testing';

import { currentTick } from './fixtures';

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

The parent imports this module too, to learn which containers to start, so its top level also runs in
a process that is not an instance. Read `clusterInstanceId` per tick or per request, not once on load,
as the example above does.

Without options of its own, an instance boots on `defaultClusterDataSources` (one Postgres data
source carrying `defaultClusterTestEntities`) with `defaultClusterProviders`: the single process
defaults without the cron and multithreading stubs, and with a thread pool sized for a machine running
several replicas. An application whose entities matter names its own:

```ts
// src/__testing__/tasks.instance-options.ts
import { createPostgresTestDataSource, defaultClusterProviders, defaultClusterTestEntities, StartTestServerOptions } from 'zibri-testing';

import { baseApplicationOptions } from '../application-options.base';
import { entities } from '../data-sources/db/entities';
import { testApplicationOptions } from './test-application-options';

const ownEntitiesOptions: StartTestServerOptions = {
    application: testApplicationOptions,
    dataSources: [createPostgresTestDataSource({ entities: [...defaultClusterTestEntities, ...entities] })],
    providers: [...baseApplicationOptions.providers ?? [], ...defaultClusterProviders]
};
```

### Observing what the cluster did
`ClusterMark` records which replica acted: one row per thing an instance did, carrying the instance's
id, a `kind` and a `tag` saying which occurrence of that kind it was.

The parent reads those rows from the database directly, past the code under test:

```ts
// src/__testing__/cron.cluster.test.ts
import { it } from '@jest/globals';
import { ClusterMarkRow } from 'zibri-testing';

it('sees three distinct ticks across the deployment', async () => {
    const marks: ClusterMarkRow[] = await cluster.waitFor(
        async () => await cluster.marks('cron'),
        (rows: ClusterMarkRow[]) => new Set(rows.map(r => r.tag)).size >= 3,
        { timeoutInMs: 20000 }
    );
});
```

`waitFor` reads until the cluster reaches the awaited state, so a test of work on its own schedule
waits only as long as it has to. `sql` runs any select and returns the rows as JSON, and `marks` is
the shorthand for the mark table. `clearMarks` throws away what was recorded while the cluster was
still coming up, since the first instance already runs cron jobs while the others boot.

The usual assertion is one row per tag: work the cluster owes once was done once.

```ts
// src/__testing__/cron.cluster.test.ts
import { expect } from '@jest/globals';

import { writersByTag } from './fixtures';

const duplicated: [string, string[]][] = [...writersByTag.entries()].filter(([, writers]) => writers.length > 1);
expect(duplicated).toEqual([]);
```

A cluster gets one scratch directory for all of its instances, on `cluster.scratchPath`. Killing one
instance and starting another leaves it as it is, so a replacement finds what the cluster wrote.
`cluster.shutdown()` removes it.

### Taking a replica down
`cluster.kill(id)` ends an instance and removes it from the cluster, so `scaleTo` replaces it.
`SIGTERM` runs the framework's shutdown handlers. `SIGKILL` is a crash, which shows what a replica
leaves behind when it stops without cleaning up.

```ts
// src/__testing__/cron.cluster.test.ts
import { it } from '@jest/globals';

it('carries on with one replica gone', async () => {
    await cluster.kill('instance-0', 'SIGKILL');
    await cluster.scaleTo(2);
});
```

Each instance is reached over HTTP like any other server, at `cluster.instanceAt(0).baseUrl`, so a
test can call one replica and assert against another. Everything an instance wrote to stdout and
stderr is kept on `output` and attached to whatever the harness throws, so a boot failure comes with
the instance's own output.

## See also
- [Application lifecycle](./application-lifecycle.md) — what `init`, `start` and `shutdown` run, and in which order
- [Data sources](./data-source.md) — entities, repositories and migrations, all of which the in process data source implements
- [Dependency injection](./di.md) — `defineProvider` and the tokens a test registers its own provider for
- [Replication](./replication.md) — what running several instances means, which is what a cluster test observes
- [Cron](./cron.md) — jobs, and the scheduler the test providers stub out
- [Email](./email.md) — transports, and what registering a real one for a test looks like