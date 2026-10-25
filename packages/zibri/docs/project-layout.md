# The generated project
`zi new` writes an application that builds, tests and runs as it stands. Every file it writes is
listed here with what it is for and the page that explains it, followed by the features a project is
generated with or without, and how to add or remove one later.

## Making the first changes
Most changes start in four places:

- `src/controllers/` for the routes, see [creating endpoints](./creating-endpoints.md)
- `src/models/` for what the application stores, see [data source](./data-source.md#defining-entities)
- `src/providers.ts` for configuration, see [dependency injection](./di.md#configuration)
- `.env` for the values that differ between machines, see [configuring the project](./getting-started.md#configuring-the-project)

## Starting and configuring the application

| File | What it is for |
|---|---|
| `src/index.ts` | Starts the application: builds it, creates the default data, then listens on `PORT` |
| `src/application-options.base.ts` | The controllers, plugins, providers and auth settings, see [architecture](./architecture.md#the-application) |
| `src/application-options.ts` | The same options with the production data source added |
| `src/providers.ts` | The values the framework reads through `ZIBRI_DI_TOKENS`: the master key, the jwt secrets, the mail transport and the templates it renders, see [configuring the framework](./configuration.md) |
| `src/env.ts` | `requireEnv` and `optionalEnv`, which read the environment |
| `.env.example` | Every variable the application reads, with the secrets left blank. Committed |
| `.env` | The values, with a secret generated for each blank. Git ignored |
| `src/create-default-data.function.ts` | Creates the roles and the first administrator on startup, when they are missing, in one transaction. With the administrator, it creates the tenant `Default` and their membership in it as its `admin` |

## Building

| File | What it is for |
|---|---|
| `package.json` | The dependencies, and the `start`, `build` and `test` scripts |
| `tsconfig.json` | Extends `zibri/tsconfig.application.json`, see [build toolchains](./getting-started.md#build-toolchains) |
| `webpack.config.js` | The build `zibri/webpack` ships. It bundles `src/index.ts` and the stylesheet into `dist` |
| `postcss.config.js` | Runs Tailwind and autoprefixer over the stylesheet |
| `tailwind.config.js` | The colors and shadows of the pages and emails |
| `src/tsx.d.ts` | Declares the `chart.js?client` import the metrics charts run in the browser, see [running code in the browser](./templating.md#running-code-in-the-browser) |
| `translations/` | The translation source the build extracts, see [providing translations](./localization.md#providing-translations) |
| `.gitignore` | Keeps `node_modules`, `dist`, `.zibri` and `.env` out of version control |

## Storing data

| File | What it is for |
|---|---|
| `src/data-sources/db/db.data-source.ts` | The Postgres data source, connected through the `DB_` variables, see [defining a data source](./data-source.md#defining-a-data-source) |
| `src/data-sources/db/entities.ts` | Every entity the data source stores: your own and the ones the framework keeps rows in, each listed under Requirements on the page of its feature, see [defining a data source](./data-source.md#defining-a-data-source) |
| `src/data-sources/db/repositories.ts` | The repositories of your own the data source lists: those of the users, memberships and roles, see [writing a repository of your own](./data-source.md#writing-a-repository-of-your-own) |
| `src/data-sources/db/migrations/index.ts` | Your migrations, once the data source switches to `'migrations'`, see [handling migrations](./data-source.md#handling-migrations) |
| `src/data-sources/db/index.ts`, `src/data-sources/index.ts` | Export the data source |
| `src/models/generated/providers.ts` | The OpenAPI documents the build generates entity classes from. Empty |
| `versions/` | The routes each released version served, see [versioning](./versioning.md#checking-a-new-version-against-the-earlier-ones). Committed |

## Users, roles and permissions

| File | What it is for |
|---|---|
| `src/models/user.model.ts` | The user, and the data a user is created with, see [creating and registering user models](./auth.md#creating-and-registering-user-models) |
| `src/models/membership.model.ts` | The membership of a user in a tenant, see [members and their roles](./tenancy.md#members-and-their-roles) |
| `src/models/tenant.model.ts` | A tenant, with a unique name: its id is the tenant id of every row it holds, see [tenants](./tenancy.md) |
| `src/models/role.model.ts` | A role, with a description, see [roles](./roles-and-permissions.md#roles) |
| `src/models/roles.enum.ts`, `src/models/platform-roles.enum.ts` | The names of the roles the application starts with |
| `src/models/permissions.ts` | Every permission of the application, see [declaring permissions](./roles-and-permissions.md#declaring-permissions) |
| `src/models/index.ts` | Exports the models |
| `src/repositories/user.repository.ts` | The repository the framework reads users through |
| `src/repositories/membership.repository.ts` | The repository the framework reads memberships through |
| `src/repositories/role.repository.ts` | The repository the framework reads roles through |
| `src/repositories/index.ts` | Exports the repositories |

## Answering requests

| File | What it is for |
|---|---|
| `src/controllers/auth.controller.ts` | The login, logout, password reset and second factor routes under `/auth`, see [auth routes](./auth-routes.md) |
| `src/controllers/health.controller.ts` | `/health/live` and `/health/ready`, see [health endpoints](./deployment.md#health-endpoints) |
| `src/controllers/page.controller.ts` | The home page at `/` and the assets explorer at `/assets` |
| `src/controllers/index.ts` | Exports the controllers |
| `src/cron/index.ts` | Your cron jobs, see [cron](./cron.md). Empty |
| `src/services/index.ts` | Your services, see [dependency injection](./di.md). Empty |

## Pages and emails

| File | What it is for |
|---|---|
| `src/templates/components/` | The building blocks of the pages, see [rendering a page](./templating.md#rendering-a-page) |
| `src/templates/pages/home.tsx` | The home page |
| `src/templates/pages/assets.tsx` | The assets explorer, see [browsing the assets](./assets.md#browsing-the-assets) |
| `src/templates/pages/error.tsx` | The page an error answers a browser with, see [rendering an error page](./error-handling.md#rendering-an-error-page) |
| `src/templates/pages/mailing-list-preferences.tsx` | Where a subscriber manages their mailing lists |
| `src/templates/pages/mailing-list-unsubscribe-confirmation.tsx` | What a subscriber sees after unsubscribing |
| `src/templates/pages/subscribe-success.tsx` | What a subscriber sees after confirming |
| `src/templates/pages/metrics/` | An example of a page with charts that run in the browser: a metrics dashboard. The link to it on the home page is commented out until a controller of yours renders it, see [metrics](./metrics.md) |
| `src/templates/components/chart.tsx`, `src/templates/components/stat-card.tsx` | The charts and figures of the metrics dashboard |
| `src/templates/email-components/` | The building blocks of the emails, see [rendering an email](./templating.md#rendering-an-email) |
| `src/templates/emails/password-reset.tsx` | The password reset email |
| `src/templates/emails/mailing-list-subscribe-confirmation.tsx` | The email that asks a subscriber to confirm |
| `src/templates/emails/log.tsx` | An example of an email built from data: it lists log entries, for a log transport of your own, see [logging](./logging.md) |
| `assets/public/style.css` | The stylesheet, which the build runs through Tailwind |
| `assets/public/open-api/` | The files of the OpenAPI explorer at `/explorer` |
| `assets/public/lib/` | The date adapter the metrics charts load |
| `assets/public/metrics.svg` | The icon of the commented out link to the metrics dashboard |
| `assets/public/` | The images the pages and emails show, and the favicon, see [assets](./assets.md) |

## Testing

| File | What it is for |
|---|---|
| `jest.config.mjs` | Names the `zibri-testing` preset, see [configuring jest](./testing.md#configuring-jest) |
| `src/__testing__/test-application-options.ts` | The application on an in-memory data source, with the test providers on top, see [starting your application in a test](./testing.md#starting-your-application-in-a-test) |
| `src/__testing__/health.test.ts` | A first test, which asks whether the application is ready |
| `src/__testing__/home-page.test.ts` | A test that asks for the home page |

## Deploying

| File | What it is for |
|---|---|
| `Dockerfile` | Builds the image the application runs in, see [deployment](./deployment.md) |
| `.dockerignore` | Keeps `node_modules`, `dist` and `.env` out of the image |
| `.github/workflows/ci.yml` | Installs, builds and tests every pull request. Written with `github` |
| `zibri-scaffold.json` | What `zi new` generated, which `zi upgrade` merges from, see [upgrading a project](./getting-started.md#upgrading-a-project). Committed |

## Choosing the features
The tables above list a project with every feature. Without any, the project is a JSON API: the
auth and health routes, the OpenAPI explorer, the password reset email and everything to build,
test and deploy it.

| Feature | What it adds | Needs |
|---|---|---|
| `pages` | The home page, the assets explorer, the error page, their components, and the stylesheet with `postcss.config.js` and `tailwind.config.js` | |
| `mailingList` | The [mailing list plugin](./mailing-list-plugin.md), with its pages, its email, its providers and its entities | `pages` |
| `metricsDashboard` | An example of a page with charts that run in the browser, rendered by nothing until a controller of yours does, and the `chart.js` dependency | `pages` |
| `logEmail` | An example of an email built from data, rendered by nothing until a log transport of yours does | |

`zi new` asks for them, with every one but `mailingList` checked. On the command line they are a
comma separated list, or `none`:

```sh
zi new api github requireLogin none
```

## Adding and removing a feature
Run `zi add` or `zi remove` in your project with the features, comma separated:

```sh
zi add mailingList
zi remove metricsDashboard,logEmail
```

`zi add` writes the files of the feature and installs what it needs. `zi remove` deletes the files
of the feature you never changed, keeps the ones you did, and uninstalls what only it needs. Both
merge the lines of the feature into or out of the files it shares with the rest of the project, such
as `src/application-options.base.ts`, the way [`zi upgrade`](./getting-started.md#upgrading-a-project)
merges a release. Commit before you run them, and commit the result.

The project has to be generated by the release of the cli you run. Bring it there with `zi upgrade`
first.

## See also
- [Getting started](./getting-started.md) — creating, configuring and upgrading a project
- [Architecture](./architecture.md) — how the pieces of an application fit together
- [Deployment](./deployment.md) — what the image runs, and what it writes
