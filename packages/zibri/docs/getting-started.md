---
keywords: [install, installation, setup, quick start, new project, zi new, cli, requirements]
---

# Getting started

`zi new` creates an application that builds, tests and runs as it stands. Its configuration comes from the environment, so the same project can run on a development machine and in a deployment.

## Requirements

Zibri runs on Node.js 24 and every maintained release after it, on Linux, macOS and Windows. A new Node.js release line is tested as soon as it ships.

The template compiler and source translation extraction use the TypeScript version installed by your project: 5.9 or 6.

Some features need packages that are not installed with Zibri. The `Requirements` section on each feature's documentation page lists the packages it needs.

## Installing the CLI

Install [zibri-cli](https://www.npmjs.com/package/zibri-cli):

```sh
npm i -g zibri-cli
```

## Creating a project

Run:

```sh
zi new
```

The CLI asks four questions:

| Question | Answers |
|---|---|
| The project name | Any npm package name |
| Whether to add a continuous integration workflow | `github` or `none` |
| What a route without `@Auth` requires, see [what an undecorated route requires](./auth/auth.md#what-an-undecorated-route-requires) | `isLoggedIn`: the route requires a logged-in user and otherwise answers `401`. `public`: the route is accessible to anyone unless you protect it. |
| Which features to include, see [choosing the features](./application/project-layout.md#choosing-the-features) | Any of `pages`, `docs`, `mailingList`, `metricsDashboard` and `logEmail`, or `none` |

Without optional features, the generated project is still a JSON API.

You can provide all four answers on the command line instead. The features are a comma-separated list:

```sh
zi new <name> <github|none> <isLoggedIn|public> <features|none>
```

For example, to create an API without optional features and with a GitHub Actions workflow:

```sh
zi new my-api github isLoggedIn none
```

With `github`, the project gets `.github/workflows/ci.yml`. It installs, builds and tests the project on every pull request and every push to `main`. The workflow starts without a `.env` file, so it copies `.env.example` and fills each blank secret with a value generated for that run.

## Configuring the project

A generated project reads the values that differ between machines from the environment: where it runs, the port it listens on, the database it connects to, the secrets it uses, the mail server, and the first administrator it creates.

Two files describe the configuration:

- **`.env.example`** is the committed list of every environment variable the project reads. Secrets and `ENVIRONMENT` are left blank. It tells a deployment, or someone cloning the repository, what has to be set.
- **`.env`** contains the values for the current machine and is git ignored. `zi new` creates it with a freshly generated value for each blank secret and `ENVIRONMENT=development`, so the new project runs as it stands. In development, emails are logged instead of sent; see [saying where the application runs](./architecture.md#saying-where-the-application-runs).

A production deployment sets `ENVIRONMENT=production` and the mail server variables `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASSWORD`. The application does not start in production without a mail server. See [configuration](./operations/deployment.md#configuration) for the environment readers, validation and deployment setup.

A deployment can set environment variables directly and does not need a `.env` file. The file is loaded when it exists beside the application and skipped when it does not. Keep `.env` out of deployment images; the generated `.dockerignore` does this for you.

## Starting the application

Go into the generated project directory and run `npm start`. For the example above:

```sh
cd my-api
npm start
```

The first start in development records the routes served by the project's version in the `versions` directory. Commit that directory: each later release is checked against the routes recorded by earlier releases. See [checking a new version against the earlier ones](./endpoints/versioning.md#checking-a-new-version-against-the-earlier-ones).

## See also

- [The generated project](./application/project-layout.md) — what each file `zi new` writes, and how to add or remove a feature
- [Architecture](./architecture.md) — how the pieces of an application fit together
- [Creating endpoints](./endpoints/creating-endpoints.md) — build your first API endpoint
- [Dependency injection](./application/di.md) — how Zibri wires up services and providers
- [Deployment](./operations/deployment.md) — build and run the application in production
