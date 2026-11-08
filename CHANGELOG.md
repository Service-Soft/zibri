# Changelog

What changed in each release of `zibri`, `zibri-tsx`, `zibri-testing` and `zibri-cli`. The four are released together, at one version.

## 3.1.0

### Templates
- **State.** `useState` creates a state of a component, and every text and attribute of the markup reading it follows it. A state on the `value` of a field or the `checked` of a checkbox binds both ways. See [keeping the page in step with a state](https://service-soft.github.io/zibri/documents/templating.html#keeping-the-page-in-step-with-a-state).
- **Conditions and lists the browser renders.** `cond && <x/>`, `cond ? <a/> : <b/>` and `items.map(item => <li key={...}/>)` reading a state render again when it changes, keyed by row. They can hold components and the `children` of the component: a branch or a row the browser builds later is copied from a template the server renders, and removing one runs the cleanups of its components. See [rendering markup that follows a state](https://service-soft.github.io/zibri/documents/templating.html#rendering-markup-that-follows-a-state).
- **`onClient` may return a cleanup**, which runs when the component is removed with its branch or row.
- **`useEffect`** runs code after a state changes, with a cleanup. See [running code after a state changes](https://service-soft.github.io/zibri/documents/templating.html#running-code-after-a-state-changes).
- **`useInput` and `useWritableInput`** let a component follow, or write, a state it is handed as a prop or a context. See [handing a state to another component](https://service-soft.github.io/zibri/documents/templating.html#handing-a-state-to-another-component).
- **`useRef` and `useRefs`** give client code the elements they are put on. See [reaching an element from client code](https://service-soft.github.io/zibri/documents/templating.html#reaching-an-element-from-client-code).
- A mistake only the render can see, such as a required ref on no element, throws in `development` and is logged in `production`.
- A `let` the markup reads and client code writes compiles with a `ZTSX016` warning, as the markup never follows it. It fails the build from 4.0.

### OpenAPI explorer
- **The explorer is a page of your application**, provided under `ZIBRI_DI_TOKENS.OPEN_API_EXPLORER_TEMPLATE`, in place of swagger-ui. It belongs to the `pages` feature and is styled with Tailwind like the other pages: `zi new` and `zi upgrade` write it into `src/templates/explorer/`, and delete the files of swagger-ui. A project that changed `custom.css`, `custom.js` or `swagger-ui-init.js` has a conflict to resolve. A project without `pages` serves the documents and no explorer, and `zi add pages` adds it. See [changing the explorer](https://service-soft.github.io/zibri/documents/open-api.html#changing-the-explorer).
- **An AsyncAPI 3.0 document of the websocket events** of each version, at `/explorer/asyncapi/<version>`, which the explorer shows in a tab beside the OpenAPI document. `@Response` on a websocket route says what it answers with. `AsyncApiService` builds it, replaceable through `ZIBRI_DI_TOKENS.ASYNC_API_SERVICE`. See [the AsyncAPI document](https://service-soft.github.io/zibri/documents/async-api.html).
- `WebsocketServiceInterface` has an optional `getPath`, the path the AsyncAPI document names. A websocket service of your own adds it to have the path in the document. It is required from 4.0.
- The explorer shows each version at `/explorer/<version>`, and a request sent from it names its version, so it reaches the routes of that version.
- An example of an XML body follows the `xml` of its schema: the names of its elements, its attributes, its namespaces and their prefixes. It is a document the route reads.
- A file sent as an attachment is offered to download, and a request may be sent to each server the document names with a full URL.
- **The OpenAPI document names a server**: the application, at `/`, with a description. `ZIBRI_DI_TOKENS.OPEN_API_SERVERS` names others in its place, and `ZIBRI_DI_TOKENS.ASYNC_API_SERVERS` does the same for the AsyncAPI document. The explorer starts each document with its servers and their descriptions. See [naming the servers](https://service-soft.github.io/zibri/documents/open-api.html#naming-the-servers).
- `OpenApiExplorerUtilities` reads a document for the page, and resolves its references. A reference the document cannot resolve throws while the page renders, naming it.

### Application
- **`stackTraceLimit`** says how many frames a stack trace keeps, in the process and in its thread jobs. It defaults to 50, which reaches your own code from inside a write to a data source. See [choosing how much of a stack trace to keep](https://service-soft.github.io/zibri/documents/app-settings.html#choosing-how-much-of-a-stack-trace-to-keep).

### Generating and upgrading a project
- `zi new` generates a project on Tailwind 4: the theme is in the `@theme` of `assets/public/style.css`, and there is no `tailwind.config.js`. See [the generated project](https://service-soft.github.io/zibri/documents/project-layout.html).
- `zi upgrade` moves a project on Tailwind 3 to Tailwind 4 first, with Tailwind's own tool `npx @tailwindcss/upgrade`, which also renames the classes of your own templates. The project then merges what the release generates. See [upgrading a project](https://service-soft.github.io/zibri/documents/getting-started.html#upgrading-a-project).

### Testing
- **`startPageBrowser`** of `zibri-testing` opens the pages of a test server in a real Chromium. See [testing a page in a browser](https://service-soft.github.io/zibri/documents/testing.html#testing-a-page-in-a-browser).

### Deprecated
- `renderPage` and `createServerRuntime` of `zibri-tsx` without an environment, which render as in `production`. Pass the environment the page is rendered in. `TsxUtilities.renderPage` does.

### Fixed
- A handler a nested component wraps, such as `onClick={() => onClick?.(value)}`, never ran under the Content Security Policy zibri sends. It runs.
- `onClient` ran its callback where the component called it, so a callback read what a later setup had not declared yet, and a throw in one setup stopped every later one. The callbacks run once every component is set up, each on its own. Code reading a variable right after the `onClient` assigning it reads it in the callback instead.
- A `Date` that client code reads arrived as a string, and a `Map` or `Set` as `{}`. They arrive as what they are.
- A component destructuring `children` rendered them before it ran, so they missed a context it provided. They render when read.
- The `value` of a `textarea` and a `select` was written as an attribute, which the browser ignores. It is the text of the `textarea` and the selected option.
- A `.ts` file beside the templates had no loader in the build of `zibri/webpack`.
- A template in a folder of `src/templates` other than `pages`, `components`, `emails` and `email-components` was built without zibri-tsx by `zibri/webpack`, and failed when it rendered, while the tests rendered it. Every template under `src/templates` is compiled by zibri-tsx.
- Markup inside a condition or a list the browser renders that reads neither a state nor the row, such as `options.map(o => <option>{o}</option>)` of a prop, was refused for a missing key, or rendered empty when the browser built the branch. It is html of the server, the same in every copy.
- In a bundled application, the origin of every log entry was the bundle, so `levelsByOrigin` matched no file of yours. Started with `node --enable-source-maps`, as a deployment is, the origin is the source file, read from the source map. See [what source maps cost](https://service-soft.github.io/zibri/documents/costs.html#what-source-maps-cost).
- The generated `src/providers.ts` handed `MASTER_KEY` to `AesGcmEncryptionStrategy` as the string it was read as, 43 bytes where it takes 32, so the first value encrypted under the master key failed with `Invalid key length`, such as in the first audit cleanup at night. It decodes the variable with `Buffer.from(requireEnv('MASTER_KEY'), 'base64url')`, which `zi upgrade` merges in. A project whose `MASTER_KEY` you replaced by a string of exactly 32 characters keeps the line as it was. The application encrypts with the master key while it starts, so a key its strategy cannot use stops the start, and `AesGcmEncryptionStrategy` names the key and the length it needs. See [setting the master key](https://service-soft.github.io/zibri/documents/encryption-and-hashing.html#setting-the-master-key).
- Validation messages say what a value needs to be, such as `needs to be of type string` and `A password needs to be at least 15 characters long.`, where they stated it as a fact. Translations of these messages are keyed by their new text.

## 3.0.1

- Fixed a thread job queued just as the pool finished looking for work: it stayed in the queue beside a free worker until the next poll, up to two seconds later. It starts right away.

## 3.0.0

A major release. An application on 2.x needs changes before it starts on 3.0.0, and its database needs a migration. [Upgrading to 3](https://service-soft.github.io/zibri/documents/upgrading-to-3.html) lists both: what the compiler does not tell you about, and the migration for the tables Zibri ships. Back up your database first.

Zibri 3 needs node 24 or newer.

### New packages
- **`zibri-tsx`** compiles the `.tsx` templates of pages and emails at build time, in place of preact. A component can carry code that runs in the browser. See [templating](https://service-soft.github.io/zibri/documents/templating.html).
- **`zibri-testing`** starts your application in a test with the router, auth, lifecycle and error handling production has. Its in-memory data source needs no database, and it starts Postgres and Valkey containers or a cluster of instances when a test asks for them. See [testing](https://service-soft.github.io/zibri/documents/testing.html).
- **`zibri/internal`** is a second entry point of `zibri`, for what only a data source, driver, parser or router of your own needs. See [releases](https://service-soft.github.io/zibri/documents/releases.html#what-is-public).

### Generating and upgrading a project
- `zi new` writes a project that builds, tests and runs as it stands, with a Dockerfile, a CI workflow and its configuration read from the environment. Pages, mailing lists, a metrics dashboard and a log email are features you choose.
- `zi add` and `zi remove` add or remove a feature later.
- `zi upgrade` merges what a new release generates into your project, the way git merges a branch.
- `zi migrate` creates a migration from what your entities changed, and records a baseline.
- The build, the jest configuration and the compiler options come from the packages: `zibri/webpack`, the `zibri-testing` preset and `zibri/tsconfig.application.json`. Updating the packages updates them.
- A deployed image names the source file and line in every stack trace.

See [getting started](https://service-soft.github.io/zibri/documents/getting-started.html) and [the generated project](https://service-soft.github.io/zibri/documents/project-layout.html).

### Data
- **Postgres without TypeORM.** The Postgres data source talks to `pg` itself and builds its queries itself. How the schema is managed, TLS and the pooler in front of the database are options you set. See [data sources](https://service-soft.github.io/zibri/documents/data-source.html).
- **Valkey data source**, with the same repositories as Postgres.
- **Tenants.** Every row belongs to a tenant or is shared, and every read and write stays inside the tenant of the request. See [tenants](https://service-soft.github.io/zibri/documents/tenancy.html).
- **Transactions across data sources**, and a `TransactionConflictError` for a deadlock or a serialization failure.
- **Tamper-evident tables.** Append-only entities, and chained entities whose rows form a hash chain. See [tamper-evident tables](https://service-soft.github.io/zibri/documents/tamper-evident-tables.html).
- **What a call costs.** Every repository call has a documented number of round trips. See [costs](https://service-soft.github.io/zibri/documents/costs.html).

### Logging in
- **Single sign-on** through OpenID Connect (Google, Apple, Microsoft Entra ID, Keycloak), plain OAuth2 (GitHub) and SAML 2.0. See [login through a provider](https://service-soft.github.io/zibri/documents/login-through-a-provider.html).
- **Directory login** against LDAP, such as Active Directory. See [login through a directory](https://service-soft.github.io/zibri/documents/login-through-a-directory.html).
- **Passkeys**, to log in and as a second factor, and recovery codes beside TOTP. See [passkeys](https://service-soft.github.io/zibri/documents/passkeys.html) and [two factor](https://service-soft.github.io/zibri/documents/two-factor.html).
- **Services calling your API** with [API keys](https://service-soft.github.io/zibri/documents/api-keys.html), [client certificates](https://service-soft.github.io/zibri/documents/client-certificates.html), [tokens your application issues](https://service-soft.github.io/zibri/documents/authorization-server.html) or [tokens of your identity provider](https://service-soft.github.io/zibri/documents/provider-tokens.html). Tokens can be bound to a key with [DPoP](https://service-soft.github.io/zibri/documents/dpop.html).
- **Roles and permissions.** Roles are rows, permissions are declared in code, at the tenant or the platform level, with wildcards. See [roles and permissions](https://service-soft.github.io/zibri/documents/roles-and-permissions.html).
- **SCIM provisioning** from a tenant's identity provider. See [SCIM](https://service-soft.github.io/zibri/documents/scim.html).
- **Email verification**, a required password policy, scrypt as the default hash, and an optional lock after too many wrong passwords. See [verifying email addresses](https://service-soft.github.io/zibri/documents/email-verification.html) and [auth](https://service-soft.github.io/zibri/documents/auth.html).
- **`AuthController`** defines the auth routes. See [the auth routes](https://service-soft.github.io/zibri/documents/auth-routes.html).
- **Audit trail.** Logins, refused routes, password resets and role changes are recorded in a tamper-evident trail. See [audit trail](https://service-soft.github.io/zibri/documents/audit.html).

### Running in production
- **Several instances.** Cron jobs, events, mails and named locks are claimed through [leases](https://service-soft.github.io/zibri/documents/leases.html), so every instance is equal. See [replication](https://service-soft.github.io/zibri/documents/replication.html).
- **Tracing** through OpenTelemetry, and metrics labeled by route. See [tracing](https://service-soft.github.io/zibri/documents/tracing.html) and [metrics](https://service-soft.github.io/zibri/documents/metrics.html).
- **Backups** to S3 and SFTP beside a folder, encrypted, and key rotation for encrypted properties. See [backup](https://service-soft.github.io/zibri/documents/backup.html) and [encryption and hashing](https://service-soft.github.io/zibri/documents/encryption-and-hashing.html#rotating-a-key).
- **Limits on requests and statements**, and an HTTP client that stops calling an upstream that keeps failing.
- **XML** request and response bodies, validated against a model like JSON. See [XML](https://service-soft.github.io/zibri/documents/xml.html).
- **Recovering failed work.** A failed cron job, event, thread job, mail or backup keeps what it failed with, and can be started again. See [recovering work that stopped](https://service-soft.github.io/zibri/documents/troubleshooting.html).

### Packages you install
Zibri installs only what every application needs. The package of each feature, such as `pg`, `nodemailer` or `socket.io`, is installed by the application that uses it, and the application names a missing one while it starts. See [optional packages](https://service-soft.github.io/zibri/documents/getting-started.html#optional-packages).

### Documentation
The documentation is rewritten: one page per topic, each with its exports, the packages and tables it needs, and examples that compile. New pages cover [architecture](https://service-soft.github.io/zibri/documents/architecture.html), [deployment](https://service-soft.github.io/zibri/documents/deployment.html), [configuration](https://service-soft.github.io/zibri/documents/configuration.html), [framework tables](https://service-soft.github.io/zibri/documents/framework-tables.html), a [glossary](https://service-soft.github.io/zibri/documents/glossary.html) and a [FAQ](https://service-soft.github.io/zibri/documents/faq.html).
