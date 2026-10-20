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
| `RoundTripCounter`, `RoundTrip` | class, type | Records each call a data source makes on its store, and the repository calls it came from |
| `createPostgresTestDataSource` | function | Builds a postgres data source class for a container the harness starts |
| `zibriFrameworkEntities` | value | Every entity the framework itself stores rows in |
| `defaultTestProviders` | value | The providers that make a deployment's defaults workable in a test |
| `testMasterKey` | value | The encryption master key those providers register |
| `UnconfiguredEmailTransport` | class | A mail transport that refuses to send |
| `RecordingEmailTransport` | class | A mail transport that sends nothing and keeps what it was given, in `sends` |
| `RecordingSmsService` | class | A text message sender that sends nothing and keeps what it was given, in `sent` |
| `startFakeOAuthProvider` | function | Starts a provider inside the test, speaking OpenID Connect or plain OAuth2 |
| `FakeOAuthProvider` | class | The running provider: who signs in, and what it was asked |
| `startFakeSamlProvider` | function | Starts a SAML 2.0 identity provider inside the test |
| `FakeSamlProvider` | class | The running identity provider: who signs in, what it was asked, and the logout requests it sends |
| `FakeSamlProviderOptions`, `FakeSamlIdentity`, `FakeSamlAnswerChanges`, `FakeSamlLogoutOptions` | type | How it answers, who signs in, what the next answer gets wrong, and who a logout request logs out |
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
| `FakeDpopKey`, `FakeDpopProofOptions` | class, type | A client's key pair, signing DPoP proofs, see [DPoP](#dpop) |
| `startFakeFidoMetadataService` | function | Starts a FIDO Metadata Service inside the test |
| `FakeFidoMetadataService` | class | The running service: the models it lists, and the attestations of their devices |
| `startDataSourceContainers` | function | Starts one container per data source that needs a server of its own |
| `StartedTestServer.scratchPath` | property | Where this server's application writes what it records at runtime |
| `startTestCluster` | function | Boots several instances of one application against shared data sources |
| `StartedTestCluster` | class | The running cluster: `instanceAt`, `sql`, `marks`, `waitFor`, `kill`, `scaleTo`, `shutdown` |
| `ClusterInstance` | class | One replica: its `baseUrl`, its `output`, and `kill` |
| `ClusterMark` | entity | The row an instance writes to record that it, specifically, did something |
| `clusterInstanceId` | function | Which instance the current process is |
| `clusterModulePaths` | function | The files this process loaded `zibri` and `zibri-testing` from, which every instance loads too |
| `defaultClusterTestEntities` | value | The framework's entities plus `ClusterMark` |
| `defaultClusterDataSources` | value | The postgres data source a cluster boots on |
| `defaultClusterProviders` | value | What a cluster instance boots with |

## Usage
### Three modules, so a test starts your application
An application's options are the thing a test and a deployment share, so they live in a module of
their own rather than inline in `index.ts`. `zi new` writes three:

```ts
// src/application-options.base.ts — everything the application is
import { MailingListController, Newable, OmitStrict, ZibriApplicationOptions, ZibriMailingListPlugin } from 'zibri';

import { AppAuthController, PageController } from './controllers';
import { DbDataSource } from './data-sources';
import { entities } from './data-sources/db/entities';
import { version } from '../package.json';
import { providers } from './providers';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'My Api',
    baseUrl: 'http://localhost:3000',
    plugins: [new ZibriMailingListPlugin()],
    controllers: [PageController, MailingListController, AppAuthController],
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
`cronJobs`, `providers`, `plugins`, `authStrategies`, `twoFactorMethods`, `twoFactorFailureLimit`, `bodyParsers`, `security`,
`defaultAuth`, `version`, `name`, `baseUrl`, `dataSources`.

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

Your application connects the way it does against a managed postgres: as a role that owns its
database and has no other privilege. It is neither a superuser nor able to create roles or
databases, so a suite fails wherever your application would need more than that in production.

Both creators build a class per call, because a data source is identified by its class. Pass
`allowOrphan: true` for one a test builds and hands to something other than the application it starts.

#### Counting what a call costs
Hand `createInMemoryDataSource` a `RoundTripCounter`, and it records every call a repository makes
on the store, as `Entity.method`. That is how you pin down what a repository call costs, and find out
what changed when it costs more:

```ts
import { inject, Newable, repositoryTokenFor } from 'zibri';
import { InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { Order } from './order.model';

const roundTrips: RoundTripCounter = new RoundTripCounter();
const costedDataSource: Newable<InMemoryDataSource> = createInMemoryDataSource({ entities, roundTrips });

it('updates an order with one read and one write', async () => {
    const orders: Repository<Order> = inject(repositoryTokenFor(Order));
    const order: Order = await orders.create({ status: 'new' });

    await roundTrips.resolveCountOf(async () => await orders.updateById(order.id, { status: 'sent' }));

    expect(roundTrips.trips.map(t => t.statement)).toEqual(['Order.find', 'Order.updateAll']);
});
```

`roundTrips.describe()` lists each call with the repository calls it came from, eg.
`ChangeSetRepository.updateById > Repository.saveUpdate`.

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
`FILE_UPLOAD_TEMP_FOLDER`. A test that serves its own fixtures names the folder they are in the same
way, with the [`ASSETS_PATH`](./assets.md) token.

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
| `JWT_AUTH_OPTIONS_INPUT` | two fixed secrets, so tokens are reproducible across processes, and `requireDpop: false` |
| `DPOP_NONCES` | `false`, since it has no default |
| `CONFIRM_PASSWORD_RESET_URL`, `PASSWORD_RESET_EMAIL_TEMPLATE` | fixtures, so an application that never resets a password still starts |
| `EMAIL_CONFIG`, `EMAIL_TRANSPORT` | an `UnconfiguredEmailTransport`, which refuses to send and names the token to register a real one under, and failed mails kept `'forever'` |
| `EVENT_FAILED_RETENTION_IN_MS` | `'forever'`, since it has no default |
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

### Signing in through a provider
`startFakeOAuthProvider` starts an OpenID Connect provider inside the test, reached over http on
`127.0.0.1`. It signs in whoever its `identity` says, without asking anything. Point your
authenticator's `issuer` at it, and drive the sign-in with a `TestBrowser`, which keeps the cookies
each site sets and follows no redirect on its own:

```ts
import { FakeOAuthProvider, startFakeOAuthProvider, TestBrowser } from 'zibri-testing';

let provider: FakeOAuthProvider;

beforeAll(async () => {
    provider = await startFakeOAuthProvider({ clientId: 'my-app', clientSecret: 'secret' });
});

it('signs a user in', async () => {
    provider.identity = { subject: 'alice', email: 'alice@example.com', emailVerified: true };
    const browser: TestBrowser = new TestBrowser(baseUrl, 'https://api.example.com');

    const atProvider: string = await browser.follow('https://api.example.com/auth/federated/authorize?authenticator=company&redirectTo=https://app.example.com');
    const callback: string = await browser.follow(atProvider);
    expect(await browser.follow(callback)).toBe('https://app.example.com');
});
```

The second argument of `TestBrowser` is the `baseUrl` of your application. The browser sends what
goes there to the test server, so the callback url your provider knows works in the test as well.

| Member | What it does |
|---|---|
| `identity`, `authenticatedAt` | Who the next sign-in is, and when they signed in at the provider |
| `denyNext(error)` | Answers the next sign-in with an error, eg. `access_denied` |
| `addToNextAnswer(fields)` | Sends the next answer with more fields next to the code, the way Apple sends the user's name |
| `rewriteNextIdToken(rewrite)` | Changes the claims of the next ID token before it is signed |
| `authorizationRequests` | What your application asked the provider for |
| `tokenRequests` | What your application sent the token endpoint: the exchanges of codes, and the refreshes |
| `apiRequests` | Every request your application sent the provider's api |
| `declinedScopes` | The scopes the user leaves out whenever they are asked for them |
| `revokedTokens` | The tokens your application handed back at the revocation endpoint |
| `revokeGrantsOf(subject)` | Withdraws what a user allowed your client, the way removing an app at the provider does |
| `createJwtAccessToken(options)` | Signs an access token for an api as a jwt for `identity`, the way a mobile app or a service holds one, see [accepting a provider's tokens](./provider-tokens.md). Takes the `audience`, the `typ` (`at+jwt` by default) and claims on top, such as a `cnf` |
| `createIdToken(audience, claims)` | Signs an ID token for `identity`, issued to the client `audience`, the way a mobile app holds one once the user signed in there |
| `formPost` | An option: the provider answers with a page posting the code, like `response_mode=form_post` |
| `clientSecret` | An option: the secret of your client, or a function checking the one it sends, for a secret your application signs |
| `issuesIdToken` | An option: `false` makes it a provider that speaks plain OAuth2, issuing an access token and no ID token |
| `resources` | An option: what its api answers, by path, to a request with an access token it issued, made from who that token is for |
| `supportedPrompts` | An option: the `prompt` values it takes. A sign-in asking for another one gets an error page, the way Google answers `prompt=login` |
| `accessTokenExpiresInSeconds` | An option: how long an access token it issues is valid. 300 by default |
| `rotatesRefreshTokens` | An option: a refresh gives out a new refresh token and refuses the old one from then on |

For a provider that speaks plain OAuth2, point the authenticator's endpoints and api at it too:

```ts
let github: FakeOAuthProvider;

beforeAll(async () => {
    github = await startFakeOAuthProvider({
        clientId: 'my-app',
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
import { FakeSamlAnswer, FakeSamlProvider, startFakeSamlProvider, TestBrowser } from 'zibri-testing';

let idp: FakeSamlProvider;

beforeAll(async () => {
    idp = await startFakeSamlProvider({
        serviceProviderEntityId: 'https://app.example.com/saml',
        serviceProviderLogoutUrl: 'https://api.example.com/auth/federated/company-saml/logout'
    });
});

it('signs a user in, and logs them out when they log out at the identity provider', async () => {
    idp.identity = { nameId: 'alice', attributes: { email: 'alice@example.com' } };
    const browser: TestBrowser = new TestBrowser(baseUrl, 'https://api.example.com');

    await browser.open(await browser.follow('https://api.example.com/auth/federated/authorize?authenticator=company-saml&redirectTo=https://app.example.com'));
    const answer: FakeSamlAnswer | undefined = idp.answers.at(-1);
    expect(await browser.follow(answer?.url ?? '', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: answer?.fields,
        crossSiteFrom: new URL(idp.entityId).origin
    })).toBe('https://app.example.com');

    await new TestBrowser(baseUrl, 'https://api.example.com')
        .follow(idp.createLogoutRequestUrl({ nameId: 'alice', sessionIndex: answer?.sessionIndex }));
});
```

| Member | What it does |
|---|---|
| `identity`, `authenticatedAt` | Who the next sign-in is, with the NameID and the attributes sent, and when they signed in at the provider |
| `denyNext(status)` | Answers the next sign-in with a second level status, eg. `urn:oasis:names:tc:SAML:2.0:status:RequestDenied` |
| `changeNextAnswer(changes)` | Gets the next answer wrong: another issuer or audience, unsolicited, expired, unsigned, signed by another key, or changed after it was signed |
| `createLogoutRequestUrl(options)` | The url a user logging out at the provider is sent to: your logout route with a signed logout request, or one that is not signed |
| `createLogoutRequestForm(options)` | The same logout request as a form a page posts to your logout route, signed inside |
| `sendBackChannelLogout(url, options)` | Sends the logout request to your SOAP logout route without a browser, and reads what it answered and whether the answer is signed |
| `requests`, `answers` | What your application asked the provider for, and what it answered, with the session it names |
| `logoutRequests` | The logout requests your application sent the provider |
| `logoutAnswers`, `logoutResponses` | The forms its page posted to answer your logout requests, and the logout responses your application posted to it |
| `metadataReads` | How often the metadata was read |
| `signs` | An option: whether it signs the assertion, the whole response, or both |
| `encryptsTo` | An option: the certificate of your decryption key, which it encrypts the assertion to |
| `requiresRequestsSignedBy` | An option: the certificate of your signing key, which every request has to be signed with |
| `serviceProviderLogoutUrl` | An option: your logout route, where it sends logout requests and the answers to yours |
| `logoutBindings` | An option: whether its metadata names its logout url for redirects, posted forms or both. Redirects by default |
| `answersLogoutWith` | An option: whether it answers your logout requests with a redirect or with a page posting the answer. A redirect by default |

### Passkeys
A `FakePasskeyDevice` does what a browser and a device do with [passkeys](./passkeys.md): hand it the options your routes answer with and the origin of the page, and it answers what the browser would:

```ts
import { JsonUtilities, PasskeyOptions, PasskeyRequestOptions } from 'zibri';
import { FakePasskeyDevice } from 'zibri-testing';

it('signs a user in with a passkey', async () => {
    const device: FakePasskeyDevice = new FakePasskeyDevice({ synced: true });
    const options: PasskeyRequestOptions = await (await fetch(`${baseUrl}/auth/sign-in-options`, { method: 'POST' })).json();

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
| `create(options, origin)` | Creates a passkey, as `navigator.credentials.create` does |
| `get(options, origin, passkeyId)` | Uses one, as `navigator.credentials.get` does. The first one for the site unless you pick one |
| `passkeys` | The passkeys it holds, with their signature counts |
| `copy()` | A copy of the device with every passkey and count on it |
| `verifiesUser` | Whether it verifies its user before the next passkey it creates or uses |
| `synced` | An option: its passkeys are synced, like a phone's password manager keeps them, and count no signatures |
| `storesPasskeys` | An option: whether it stores its passkeys, so it offers them at a sign-in that names none. `false` is an older security key, which refuses to create a passkey where a stored one is demanded |
| `aaguid` | An option: the model it names |
| `attestation` | An option: what it proves its model with, from a `FakeFidoMetadataService` |

`startFakeFidoMetadataService` starts a FIDO Metadata Service inside the test, signed under a root of its own. Point `metadataServiceUrl` at its `blobUrl` and `metadataServiceRootCertificates` at its `rootCertificate`:

```ts
import { FakeFidoMetadataService, FakePasskeyAttestation, startFakeFidoMetadataService } from 'zibri-testing';

let metadata: FakeFidoMetadataService;
let allowed: FakePasskeyAttestation;

beforeAll(async () => {
    metadata = await startFakeFidoMetadataService();
    allowed = await metadata.addModel();
});

// what PASSKEY_OPTIONS is provided with in the test
function passkeyOptions(): PasskeyOptions {
    return {
        relyingPartyId: 'example.com',
        relyingPartyName: 'Example',
        origins: ['https://app.example.com'],
        attestation: {
            allowedAaguids: [allowed.aaguid],
            metadataServiceUrl: metadata.blobUrl,
            metadataServiceRootCertificates: [metadata.rootCertificate]
        }
    };
}

// a device of the allowed model, which proves it when it creates a passkey
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

### DPoP
A `FakeDpopKey` holds a key pair the way a client does, and signs a [DPoP proof](./dpop.md) for whatever request you name. Sign the url as your application's `baseUrl` writes it, which is not where the test reaches the server:

```ts
import { FakeDpopKey } from 'zibri-testing';

it('binds a login to the key of its proof', async () => {
    const key: FakeDpopKey = new FakeDpopKey();
    const appUrl: string = 'http://localhost:3000';

    const login: Response = await fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', dpop: key.createProof('POST', `${appUrl}/auth/login`) },
        body: JSON.stringify({ email: 'anna@example.com', password: 'secret' })
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

### A fake directory
`startFakeLdapDirectory` starts a directory inside the test, for [sign-in through a directory](./sign-in-through-a-directory.md). It speaks LDAP over TLS with a certificate of its own: point your authenticator's `urls` at its `ldapsUrl`, or at its `ldapUrl` for StartTLS, and its `trustedCertificates` at its `certificate`:

```ts
import { FakeLdapDirectory, startFakeLdapDirectory } from 'zibri-testing';

let ldapDirectory: FakeLdapDirectory;

beforeAll(async () => {
    ldapDirectory = await startFakeLdapDirectory({
        entries: [
            { dn: 'cn=app,ou=services,dc=example,dc=com', password: 'service-secret', attributes: { objectClass: ['person'] } },
            {
                dn: 'uid=alice,ou=people,dc=example,dc=com',
                password: 'alice-secret',
                attributes: { objectClass: ['inetOrgPerson'], uid: ['alice'], mail: ['alice@example.com'] }
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
| `binds`, `searches` | The binds and searches it was asked for, with whether the connection was encrypted and who it was bound as |
| `ldapsUrl`, `ldapUrl` | Where it takes connections encrypted from the first byte, and ones upgraded with StartTLS |
| `certificate` | The certificate it proves who it is with |
| `stop()` | Stops the directory |
| `password` | An option of an entry: the password a bind as it takes |
| `lockedWith` | An option of an entry: refuses every bind as it, with `invalidCredentials`, `unwillingToPerform` or `constraintViolation` |

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
        instanceOptions: FsUtilities.getPath(import.meta.dirname, 'cron.instance-options.ts'),
        instances: 3
    });
});
```

Every instance is forked with the same options module and gets the ports of the containers the parent
started. `bootMode` decides whether they come up one after another (the default, letting the first
settle the schema) or all at once, which is what a rolling deploy does.

An instance loads the same copies of `zibri` and `zibri-testing` as the test that started it, and
compiles the TypeScript it boots from as it loads it, which needs the optional peer dependency
`oxc-transform` installed.

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