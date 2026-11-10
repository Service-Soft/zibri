# Changelog

What changed in each release of `zibri`, `zibri-tsx`, `zibri-tsx-compiler`, `zibri-mdx`, `zibri-testing` and `zibri-cli`. They are released together, at one version.

## 3.1.0

### Templates
- **The compiler of the templates is the package `zibri-tsx-compiler`**: the webpack loader `zibri-tsx-compiler/webpack`, the jest transform `zibri-tsx-compiler/jest` and the type check. `zibri-tsx` is the runtime a deployment renders with, and names neither the compiler nor TypeScript, so a deployment carries neither, 23 MB of TypeScript among them. Install the compiler as a devDependency, which `zi upgrade` does. `zibri/webpack` and the jest preset of `zibri-testing` use it.
- **State.** `useState` creates a state of a component, and every text and attribute of the markup reading it follows it. A state on the `value` of a field or the `checked` of a checkbox binds both ways. See [keeping the page in step with a state](https://service-soft.github.io/zibri/templates/templating/#keeping-the-page-in-step-with-a-state).
- **Conditions and lists the browser renders.** `cond && <x/>`, `cond ? <a/> : <b/>` and `items.map(item => <li key={...}/>)` reading a state render again when it changes, keyed by row. They can hold components and the `children` of the component: a branch or a row the browser builds later is copied from a template the server renders, and removing one runs the cleanups of its components. See [rendering markup that follows a state](https://service-soft.github.io/zibri/templates/templating/#rendering-markup-that-follows-a-state).
- **`onClient` may return a cleanup**, which runs when the component is removed with its branch or row.
- **`useEffect`** runs code after a state changes, with a cleanup. See [running code after a state changes](https://service-soft.github.io/zibri/templates/templating/#running-code-after-a-state-changes).
- **`useInput` and `useWritableInput`** let a component follow, or write, a state it is handed as a prop or a context. See [handing a state to another component](https://service-soft.github.io/zibri/templates/templating/#handing-a-state-to-another-component).
- **`useRef` and `useRefs`** give client code the elements they are put on. See [reaching an element from client code](https://service-soft.github.io/zibri/templates/templating/#reaching-an-element-from-client-code).
- A mistake only the render can see, such as a required ref on no element, throws in `development` and is logged in `production`.
- A `let` the markup reads and client code writes compiles with a `ZTSX016` warning, as the markup never follows it. It fails the build from 4.0.
- **Pages written in markdown.** A `.md` or `.mdx` template compiles into a page, its default export, with its frontmatter as `frontmatter`. `ZIBRI_DI_TOKENS.MDX_COMPONENTS` names the component each markdown construct renders, the code of a fenced block is highlighted with classes your stylesheet colors, and the build checks the frontmatter against the `MdxFrontmatter` you declare. A page written in markdown is also the text of an email, with the components `ZIBRI_DI_TOKENS.MDX_EMAIL_COMPONENTS` names, and an `.mdx` file imports packages for the browser with `?client`. An alert as GitHub writes it, `> [!WARNING]`, is a blockquote whose component is handed the kind as `alert`, and the component of a code span or a code block is handed the code as written as `code`. The page's headings are its export `headings`, each an `MdxHeading` with its level, text and anchor, such as for a table of contents. The new package `zibri-mdx` builds these templates. Install it as a devDependency, which `zi add pages` does, so a deployment carries none of it. See [writing a page in markdown](https://service-soft.github.io/zibri/templates/templating/#writing-a-page-in-markdown).
- **Markdown at runtime.** `<Markdown source={...}/>` renders markdown the server gets while it runs, such as from a database, as a `.md` page renders it: through the components `ZIBRI_DI_TOKENS.MDX_COMPONENTS` names, with the same props, and its text escaped. It is never compiled, and html in it is a mistake only the render can see. An application switches it on with `renderAtRuntime` of `ZIBRI_DI_TOKENS.MARKDOWN_OPTIONS` and lists `zibri-mdx` in its dependencies, which it checks for while it starts. `MarkdownService`, replaceable through `ZIBRI_DI_TOKENS.MARKDOWN_SERVICE`, resolves the page. See [rendering markdown at runtime](https://service-soft.github.io/zibri/templates/templating/#rendering-markdown-at-runtime).
- **The rest of MJML's components.** `MjHero`, `MjTable`, `MjNavbar`, `MjSocial`, `MjCarousel` and `MjAccordion` with their parts, and in the head `MjBreakpoint`, `MjFont` and `MjHtmlAttributes`, which needs the package `cheerio`. Each nests where MJML lets it. See [rendering an email](https://service-soft.github.io/zibri/templates/templating/#rendering-an-email).
- **The nesting of an email follows your own components.** What a component renders is checked against the parent its use sits in, and what you pass it, its children or another prop, against where it places them. The build follows a component of another file to the file that declares it. Such a mistake is a `ZTSX004` warning, and fails the build from 4.0. See [nesting is checked at compile time](https://service-soft.github.io/zibri/templates/templating/#nesting-is-checked-at-compile-time).
- `renderPage` of `zibri-tsx` takes `contexts`, values of contexts for every component of the page.
- `TsxUtilities.renderPage` renders a page whose props are all optional without them.

### OpenAPI explorer
- **The explorer is a page of your application**, provided under `ZIBRI_DI_TOKENS.OPEN_API_EXPLORER_TEMPLATE`, in place of swagger-ui. It belongs to the `pages` feature and is styled with Tailwind like the other pages: `zi new` and `zi upgrade` write it into `src/templates/explorer/`, and delete the files of swagger-ui. A project that changed `custom.css`, `custom.js` or `swagger-ui-init.js` has a conflict to resolve. A project without `pages` serves the documents and no explorer, and `zi add pages` adds it. See [changing the explorer](https://service-soft.github.io/zibri/endpoints/open-api/#changing-the-explorer).
- **An AsyncAPI 3.0 document of the websocket events** of each version, at `/explorer/asyncapi/<version>`, which the explorer shows in a tab beside the OpenAPI document. `@Response` on a websocket route says what it answers with. `AsyncApiService` builds it, replaceable through `ZIBRI_DI_TOKENS.ASYNC_API_SERVICE`. See [the AsyncAPI document](https://service-soft.github.io/zibri/endpoints/async-api/).
- `WebsocketServiceInterface` has an optional `getPath`, the path the AsyncAPI document names. A websocket service of your own adds it to have the path in the document. It is required from 4.0.
- The explorer shows each version at `/explorer/<version>`, and a request sent from it names its version, so it reaches the routes of that version.
- An example of an XML body follows the `xml` of its schema: the names of its elements, its attributes, its namespaces and their prefixes. It is a document the route reads.
- A file sent as an attachment is offered to download, and a request may be sent to each server the document names with a full URL.
- **The OpenAPI document names a server**: the application, at `/`, with a description. `ZIBRI_DI_TOKENS.OPEN_API_SERVERS` names others in its place, and `ZIBRI_DI_TOKENS.ASYNC_API_SERVERS` does the same for the AsyncAPI document. The explorer starts each document with its servers and their descriptions. See [naming the servers](https://service-soft.github.io/zibri/endpoints/open-api/#naming-the-servers).
- `OpenApiExplorerUtilities` reads a document for the page, and resolves its references. A reference the document cannot resolve throws while the page renders, naming it.

### Application
- **`stackTraceLimit`** says how many frames a stack trace keeps, in the process and in its thread jobs. It defaults to 50, which reaches your own code from inside a write to a data source. See [choosing how much of a stack trace to keep](https://service-soft.github.io/zibri/application/app-settings/#choosing-how-much-of-a-stack-trace-to-keep).
- A deployment carries none of what only building the application uses: `zibri` no longer names `typescript`, `ts-node`, `webpack`, `copy-webpack-plugin` and `mini-css-extract-plugin` as peers, and uses the application's own. A deployment pruned of its devDependencies had kept them, more than 40 MB. A deployment running TypeScript worker files with `enableTsWorkerFiles` lists `ts-node` and `typescript` in its `dependencies`. See [running TypeScript worker files](https://service-soft.github.io/zibri/background-work/multithreading/#running-typescript-worker-files).
- A loader the build of `zibri/webpack` uses, such as `ts-loader` or `css-loader`, that the application has not installed fails the build before it starts, naming the package to install.
- **An application without logins.** `authStrategies: []` registers no auth strategy, and no authenticator or two factor method unless the application names them, so an API open to everyone needs none of their configuration. A route that needs a login then stops the start, naming the route. An empty list was taken for a list left out, and given the default. `authenticators: []` and `twoFactorMethods: []` register none of theirs as well. See [registering strategies and authenticators](https://service-soft.github.io/zibri/auth/auth/#registering-strategies-and-authenticators).
- `resolveApplicationPackage` loads a package a plugin leaves to the application, failing with the feature it was needed for and the command that installs it.

### Generating and upgrading a project
- A build for an editor, `npm start` included, is cached in `node_modules/.cache/webpack`, so the next one compiles only what changed: a project generated with every feature builds in about 4 seconds instead of 13 the second time. The cache starts over when the build, the compiler of the templates or `zibri-mdx` changes. A build for a deployment, `--env deployment`, caches nothing, so the image stays as large as it is. See [the generated project](https://service-soft.github.io/zibri/application/project-layout/).
- The compiler of the templates compiles a template in about half the time, which shows most on pages written in markdown.
- The `test` script of a generated project runs jest with `node --experimental-vm-modules`, so jest loads a package that ships as ES modules only as it is, such as the markdown parser of `zibri-mdx`. `zi upgrade` merges it in. The jest configuration of `zibri-testing` then compiles none of them, and `esmPackages` is for a run without the flag. See [testing](https://service-soft.github.io/zibri/testing/).
- `zi new` generates a project on Tailwind 4: the theme is in the `@theme` of `assets/public/style.css`, and there is no `tailwind.config.js`. See [the generated project](https://service-soft.github.io/zibri/application/project-layout/).
- `zi upgrade` moves a project on Tailwind 3 to Tailwind 4 first, with Tailwind's own tool `npx @tailwindcss/upgrade`, which also renames the classes of your own templates. The project then merges what the release generates. See [upgrading a project](https://service-soft.github.io/zibri/#upgrading-a-project).
- The `pages` feature gives every construct of a page written in markdown a component of the pages, mapped in `src/templates/components/markdown-components.ts`, and `Heading` is as large as its `tag`, or as the level `size` names. See [the generated project](https://service-soft.github.io/zibri/application/project-layout/#pages-and-emails).
- **Documentation pages.** The new feature `docs` serves pages written in markdown at `/docs`, inside the pages of the application: a navigation of every page, the sections of a page beside it with the one being read marked, a link beside each heading that copies the address of its section, and a search that finds a page by its title, its sections and the `keywords` of its frontmatter, despite a typo. `zi add docs` adds it to a project. `DocsUtilities` gives each page its address, leads a link to another page's file to that page and lists what the search finds. See [documentation pages](https://service-soft.github.io/zibri/templates/docs/).

### Testing
- The jest configuration of `zibri-testing` fails when it is built if the application has not installed `zibri-tsx-compiler` or `ts-jest`, naming the package to install.
- **`startPageBrowser`** of `zibri-testing` opens the pages of a test server in a real Chromium. See [testing a page in a browser](https://service-soft.github.io/zibri/testing/#testing-a-page-in-a-browser).

### Documentation
- **A new documentation site**, built with Zibri from the pages in markdown. The pages sit in folders by topic, such as `auth/` for logging in and `data/` for storing data, and the address of a page names its folder, such as `https://service-soft.github.io/zibri/auth/passkeys/`. Code is colored as VS Code colors it.
- **An API reference** on the same site: every export on a page of its own, with how it is declared, its comment and its members, at `https://service-soft.github.io/zibri/api/<name>/`. A code span on a page naming an export links to it, with a badge of its kind.
- **Search** finds a page, a section or an export by its title, despite a typo or another form of a word, and a page by the keywords of its frontmatter. Press `/` to start.
- The address 3.0 gave a page or an export, such as `documents/auth.html` or `classes/AuthService.html`, sends the reader on to where it is now, with the heading or member the link names.

### Deprecated
- `zibri-tsx/compiler`, `zibri-tsx/webpack` and `zibri-tsx/jest`, which load the `zibri-tsx-compiler` your project installed, and print a `DeprecationWarning` when they do. Name `zibri-tsx-compiler`, `zibri-tsx-compiler/webpack` and `zibri-tsx-compiler/jest` instead.
- `renderPage` and `createServerRuntime` of `zibri-tsx` without an environment, which render as in `production`. Pass the environment the page is rendered in. `TsxUtilities.renderPage` does.
- What compiled templates call while they render, imported from `zibri-tsx`, such as `createServerRuntime`, `RenderServerRuntime` and `CLIENT_HOOK_SOURCES`, what the compiler formats its messages with, such as `resolveCompileError`, and what the email components are built from, imported from `zibri-tsx` or `zibri-tsx/email`, such as `defineEmailComponent` and `withDefaults`. They are on `zibri-tsx/internal`, which any release can change.

### Fixed
- A build started outside the project, such as `webpack -c api/webpack.config.js` in the root of a monorepo, wrote the types of the handlebars templates and the generated entities of the folder it was started in. It writes those of the project its `webpack.config.js` names, as it did the translation source.
- In an application, the types of zibri built on express, such as `HttpRequest`, on the OpenAPI document, such as `OpenApiSchemaObject`, on pdfmake, such as the document definitions of `PdfUtilities`, and on ws were `any`, as the packages declaring them were not installed with zibri. They are typed, so code that passed something else there is now a type error. The OpenAPI types are zibri's own: an extension, a field starting with `x-`, is `unknown`, and the scopes of an OAuth2 flow are descriptions, strings.
- An element whose tag a variable holds, such as `const Tag = 'img'; <Tag src={src}/>`, was written without the closing slash the same element written by its name has. It is written the same, `<img src="/logo.png"/>`.
- The jest transform `zibri-tsx-compiler/jest` cached a page written in markdown under the same key after `zibri-mdx` was updated, so a test rendered what the `zibri-mdx` before printed. It compiles the page again.
- An asset service whose `assetsRoute` is not `/assets` served the bundles of the `?client` packages under its own route, while `TsxUtilities.renderPage` linked them under `/assets/vendor/`. A page links them under the route of the asset service.
- A handler a nested component wraps, such as `onClick={() => onClick?.(value)}`, never ran under the Content Security Policy zibri sends. It runs.
- `MjRaw` was refused directly in `Mjml`, `MjHead`, `MjBody`, `MjWrapper`, `MjSection` and `MjGroup`, where MJML allows it. It is accepted there: in `MjHead` it adds its html to the head, and directly in `Mjml` with `position="file-start"` it writes it before the doctype.
- The `cssClass` of `MjText` was set on the `div` of its text, where MJML sets it on the cell around it. It is set on the cell, so a style or an `MjSelector` matches what it matches in MJML.
- An email imported the font Ubuntu whichever fonts it used. It imports a font MJML knows, such as Ubuntu or Roboto, when its body uses it, as MJML does.
- `onClient` ran its callback where the component called it, so a callback read what a later setup had not declared yet, and a throw in one setup stopped every later one. The callbacks run once every component is set up, each on its own. Code reading a variable right after the `onClient` assigning it reads it in the callback instead.
- A `Date` that client code reads arrived as a string, and a `Map` or `Set` as `{}`. They arrive as what they are.
- A component destructuring `children` rendered them before it ran, so they missed a context it provided. They render when read.
- The `value` of a `textarea` and a `select` was written as an attribute, which the browser ignores. It is the text of the `textarea` and the selected option.
- A `.ts` file beside the templates had no loader in the build of `zibri/webpack`.
- `npm run migrate:list`, `npm run migrate:down` and `zi migrate` of a generated project started `dist/index.js`, which the build does not write, and failed with `Cannot find module`. The `main` of its `package.json` and both scripts name `dist/bundle.js`, the file the image starts, which `zi upgrade` merges in.
- The build of `zibri/webpack` failed in a project without `src/models/generated/providers.ts`, with four errors that each named a file it could not find. It generates no entities then, and says so.
- A template in a folder of `src/templates` other than `pages`, `components`, `emails` and `email-components` was built without zibri-tsx by `zibri/webpack`, and failed when it rendered, while the tests rendered it. Every template under `src/templates` is compiled by zibri-tsx.
- Markup inside a condition or a list the browser renders that reads neither a state nor the row, such as `options.map(o => <option>{o}</option>)` of a prop, was refused for a missing key, or rendered empty when the browser built the branch. It is html of the server, the same in every copy.
- In a bundled application, the origin of every log entry was the bundle, so `levelsByOrigin` matched no file of yours. Started with `node --enable-source-maps`, as a deployment is, the origin is the source file, read from the source map. See [what source maps cost](https://service-soft.github.io/zibri/data/costs/#what-source-maps-cost).
- The generated `src/providers.ts` handed `MASTER_KEY` to `AesGcmEncryptionStrategy` as the string it was read as, 43 bytes where it takes 32, so the first value encrypted under the master key failed with `Invalid key length`, such as in the first audit cleanup at night. It decodes the variable with `Buffer.from(requireEnv('MASTER_KEY'), 'base64url')`, which `zi upgrade` merges in. A project whose `MASTER_KEY` you replaced by a string of exactly 32 characters keeps the line as it was. The application encrypts with the master key while it starts, so a key its strategy cannot use stops the start, and `AesGcmEncryptionStrategy` names the key and the length it needs. See [setting the master key](https://service-soft.github.io/zibri/data/encryption-and-hashing/#setting-the-master-key).
- Validation messages say what a value needs to be, such as `needs to be of type string` and `A password needs to be at least 15 characters long.`, where they stated it as a fact. Translations of these messages are keyed by their new text.

## 3.0.1

- Fixed a thread job queued just as the pool finished looking for work: it stayed in the queue beside a free worker until the next poll, up to two seconds later. It starts right away.

## 3.0.0

A major release. An application on 2.x needs changes before it starts on 3.0.0, and its database needs a migration. [Upgrading to 3](https://service-soft.github.io/zibri/documents/upgrading-to-3.html) lists both: what the compiler does not tell you about, and the migration for the tables Zibri ships. Back up your database first.

Zibri 3 needs node 24 or newer.

### New packages
- **`zibri-tsx`** compiles the `.tsx` templates of pages and emails at build time, in place of preact. A component can carry code that runs in the browser. See [templating](https://service-soft.github.io/zibri/templates/templating/).
- **`zibri-testing`** starts your application in a test with the router, auth, lifecycle and error handling production has. Its in-memory data source needs no database, and it starts Postgres and Valkey containers or a cluster of instances when a test asks for them. See [testing](https://service-soft.github.io/zibri/testing/).
- **`zibri/internal`** is a second entry point of `zibri`, for what only a data source, driver, parser or router of your own needs. See [releases](https://service-soft.github.io/zibri/releases/#what-is-public).

### Generating and upgrading a project
- `zi new` writes a project that builds, tests and runs as it stands, with a Dockerfile, a CI workflow and its configuration read from the environment. Pages, mailing lists, a metrics dashboard and a log email are features you choose.
- `zi add` and `zi remove` add or remove a feature later.
- `zi upgrade` merges what a new release generates into your project, the way git merges a branch.
- `zi migrate` creates a migration from what your entities changed, and records a baseline.
- The build, the jest configuration and the compiler options come from the packages: `zibri/webpack`, the `zibri-testing` preset and `zibri/tsconfig.application.json`. Updating the packages updates them.
- A deployed image names the source file and line in every stack trace.

See [getting started](https://service-soft.github.io/zibri/) and [the generated project](https://service-soft.github.io/zibri/application/project-layout/).

### Data
- **Postgres without TypeORM.** The Postgres data source talks to `pg` itself and builds its queries itself. How the schema is managed, TLS and the pooler in front of the database are options you set. See [data sources](https://service-soft.github.io/zibri/data/data-source/).
- **Valkey data source**, with the same repositories as Postgres.
- **Tenants.** Every row belongs to a tenant or is shared, and every read and write stays inside the tenant of the request. See [tenants](https://service-soft.github.io/zibri/data/tenancy/).
- **Transactions across data sources**, and a `TransactionConflictError` for a deadlock or a serialization failure.
- **Tamper-evident tables.** Append-only entities, and chained entities whose rows form a hash chain. See [tamper-evident tables](https://service-soft.github.io/zibri/data/tamper-evident-tables/).
- **What a call costs.** Every repository call has a documented number of round trips. See [costs](https://service-soft.github.io/zibri/data/costs/).

### Logging in
- **Single sign-on** through OpenID Connect (Google, Apple, Microsoft Entra ID, Keycloak), plain OAuth2 (GitHub) and SAML 2.0. See [login through a provider](https://service-soft.github.io/zibri/auth/login-through-a-provider/).
- **Directory login** against LDAP, such as Active Directory. See [login through a directory](https://service-soft.github.io/zibri/auth/login-through-a-directory/).
- **Passkeys**, to log in and as a second factor, and recovery codes beside TOTP. See [passkeys](https://service-soft.github.io/zibri/auth/passkeys/) and [two factor](https://service-soft.github.io/zibri/auth/two-factor/).
- **Services calling your API** with [API keys](https://service-soft.github.io/zibri/auth/api-keys/), [client certificates](https://service-soft.github.io/zibri/auth/client-certificates/), [tokens your application issues](https://service-soft.github.io/zibri/auth/authorization-server/) or [tokens of your identity provider](https://service-soft.github.io/zibri/auth/provider-tokens/). Tokens can be bound to a key with [DPoP](https://service-soft.github.io/zibri/auth/dpop/).
- **Roles and permissions.** Roles are rows, permissions are declared in code, at the tenant or the platform level, with wildcards. See [roles and permissions](https://service-soft.github.io/zibri/auth/roles-and-permissions/).
- **SCIM provisioning** from a tenant's identity provider. See [SCIM](https://service-soft.github.io/zibri/auth/scim/).
- **Email verification**, a required password policy, scrypt as the default hash, and an optional lock after too many wrong passwords. See [verifying email addresses](https://service-soft.github.io/zibri/auth/email-verification/) and [auth](https://service-soft.github.io/zibri/auth/auth/).
- **`AuthController`** defines the auth routes. See [the auth routes](https://service-soft.github.io/zibri/auth/auth-routes/).
- **Audit trail.** Logins, refused routes, password resets and role changes are recorded in a tamper-evident trail. See [audit trail](https://service-soft.github.io/zibri/data/audit/).

### Running in production
- **Several instances.** Cron jobs, events, mails and named locks are claimed through [leases](https://service-soft.github.io/zibri/data/leases/), so every instance is equal. See [replication](https://service-soft.github.io/zibri/data/replication/).
- **Tracing** through OpenTelemetry, and metrics labeled by route. See [tracing](https://service-soft.github.io/zibri/operations/tracing/) and [metrics](https://service-soft.github.io/zibri/operations/metrics/).
- **Backups** to S3 and SFTP beside a folder, encrypted, and key rotation for encrypted properties. See [backup](https://service-soft.github.io/zibri/data/backup/) and [encryption and hashing](https://service-soft.github.io/zibri/data/encryption-and-hashing/#rotating-a-key).
- **Limits on requests and statements**, and an HTTP client that stops calling an upstream that keeps failing.
- **XML** request and response bodies, validated against a model like JSON. See [XML](https://service-soft.github.io/zibri/endpoints/xml/).
- **Recovering failed work.** A failed cron job, event, thread job, mail or backup keeps what it failed with, and can be started again. See [recovering work that stopped](https://service-soft.github.io/zibri/background-work/troubleshooting/).

### Packages you install
Zibri installs only what every application needs. The package of each feature, such as `pg`, `nodemailer` or `socket.io`, is installed by the application that uses it, and the application names a missing one while it starts. See [optional packages](https://service-soft.github.io/zibri/#optional-packages).

### Documentation
The documentation is rewritten: one page per topic, each with its exports, the packages and tables it needs, and examples that compile. New pages cover [architecture](https://service-soft.github.io/zibri/architecture/), [deployment](https://service-soft.github.io/zibri/operations/deployment/), [configuration](https://service-soft.github.io/zibri/application/configuration/), [framework tables](https://service-soft.github.io/zibri/data/framework-tables/), a [glossary](https://service-soft.github.io/zibri/glossary/) and a [FAQ](https://service-soft.github.io/zibri/faq/).
