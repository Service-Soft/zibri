# Deployment

What a running Zibri application is made of, and what has to travel with it.

`zi new` generates a `Dockerfile` and a `.dockerignore` alongside the project, so a generated
application is deployable as it stands. A deployment built by other means needs the same things.

## What a deployment is

A deployment is a directory with these entries:

```
package.json      what to install, and the version this release is
node_modules      installed for the platform the application runs on
dist              the bundle, and everything read from inside it
versions          the routes each released version served
```

The application resolves itself from the `package.json` above its entry point, so everything it
reads at a path of its own is found relative to that directory, whatever directory the process was
started from.

`dist` carries the bundle together with the assets, the compiled templates and the translations,
which the bundle reads from inside it. Copy the one folder.

With `bundle.js.map` beside the bundle, a stack trace names the source file and line of every frame.
The Dockerfile builds it with `npm run build -- --env deployment`, which leaves the sources themselves
out of it, and starts the application with `node --enable-source-maps`. A deployment of your own does
both.

`versions` sits beside `dist`: each release records the routes it serves, and the release after it is
checked against that record. A release is recorded when the application starts in development. Commit
the folder to version control, and copy it into every deployment, where the application only reads it
and refuses to start on a version it does not record, see [versioning](./versioning.md).

## Configuration

Everything that differs between one machine and the next is read from the environment. `.env.example`
is the committed list of what a deployment sets, and `src/env.ts` reads it:

- `requireEnv` stops the application at startup when a variable is unset, naming the one that is
  missing.
- `requireBooleanEnv` does the same, and also when a variable holds anything but `true` or `false`.
- `requireOneOfEnv` does the same, and also when a variable holds none of the values it may hold.
- `requirePortEnv` does the same, and also when a variable holds no port from 1 to 65535.
- `requireUrlEnv` does the same, and also when a variable holds no absolute HTTP or HTTPS URL.
- `optionalEnv` answers with an empty string, for what the application runs without.

A variable of another kind gets a reader of its own in `src/env.ts`, which checks the value and stops
the application naming the variable:

```ts
// src/env.ts
export function requireBatchSizeEnv(key: string): number {
    const value: string = process.env[key] ?? '';
    const size: number = Number(value);
    if (!Number.isInteger(size) || size < 1 || size > 100) {
        throw new Error(`The environment variable "${key}" has to be a whole number from 1 to 100, got "${value}".`);
    }
    return size;
}
```

Read every variable where the module that uses it is loaded, as the generated files do, and a
deployment with a wrong value stops before it serves anything.

A deployment sets `ENVIRONMENT=production`, and `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and
`SMTP_PASSWORD` for the mail server. In production the application does not start without a mail
server, see [saying where the application runs](./architecture.md#saying-where-the-application-runs).

A `.env` file is read when there is one beside the application, which is how a development machine
supplies these. A deployment usually sets them directly, and `.dockerignore` keeps the local file out
of the image: an image carrying one hands its secrets to everyone the image reaches.

## HTTPS

The application serves plain HTTP/1.1. HTTPS is terminated in front of it, by the load balancer,
ingress or reverse proxy that receives the traffic, which is also where certificates are renewed.
The same proxy speaks HTTP/2 or HTTP/3 to clients and HTTP/1.1 to the application.

Tell the application how many proxies stand in front of it with `security.trustProxy`, see
[running behind a proxy](./app-settings.md#running-behind-a-proxy). With it set, a request that
reached the proxy over HTTPS counts as HTTPS, so session cookies are marked `Secure` and HSTS is sent.

Services that call your API with a client certificate show it to the proxy, which forwards it, see
[client certificates](./client-certificates.md).

## Health endpoints

`zi new` generates a `HealthController` with two routes:

- **`GET /health/live`**: whether the process is running. An orchestrator restarts the process when
  it fails, so it answers on the process alone. A liveness check that reads the database turns an
  outage of the database into a restart loop of the application.
- **`GET /health/ready`**: whether this instance should be sent traffic. It answers `503` once the
  application begins shutting down. The instance still finishes the requests it already accepted,
  and new ones go to another instance.

Both routes carry `versions: 'all'`, so the probe URL stays the same across a version bump. Both carry
`@Auth.skip({ allowRedundant: true })`, so the probe keeps answering when the application switches
its default to `'isLoggedIn'`.

An application with dependencies of its own checks them in the readiness half:

```ts
// src/controllers/health.controller.ts
import { $ts, Auth, Controller, Get, GlobalRegistry, ServiceUnavailableError } from 'zibri';

@Auth.skip({ allowRedundant: true })
@Controller('/health', { versions: 'all' })
export class HealthController {

    @Get('/live')
    live(): { status: string } {
        return { status: 'ok' };
    }

    @Get('/ready')
    async ready(): Promise<{ status: string }> {
        if (!GlobalRegistry.isAppStarted()) {
            throw new ServiceUnavailableError($ts`This instance is shutting down.`);
        }
        // whatever this application needs before it is worth sending a request to
        return { status: 'ok' };
    }
}
```

`GlobalRegistry.isAppStarted()` is true from the moment the application listens until the moment it
begins shutting down. `start()` runs the startup hooks and only then listens, so the first request an
instance accepts arrives at an application that is fully built.

Keep a database every instance shares out of the readiness check: when that database is slow, a
check that reads it takes every instance out of rotation at once.

## Shutting down

A stop signal starts an orderly shutdown: the application runs its shutdown hooks, releases the
[leases](./glossary.md#lease) it holds and closes its data sources. Send the signal to the process itself. In a container
image, use the exec form of `CMD`, so the signal reaches Node and not a shell.

The readiness endpoint answers `503` for the whole of that window, so an orchestrator polling it
moves traffic away while the instance finishes what it accepted.

### Draining traffic before shutting down

A load balancer takes a moment to stop sending requests to an instance: the endpoint change travels
through kube-proxy, an ingress controller or a proxy's own configuration. Requests keep arriving for
a few seconds after readiness reports not ready. The sequence is:

1. readiness reports not ready, and the balancer starts removing the instance
2. the instance **keeps serving normally** for a few seconds
3. the instance stops accepting connections and drains what is open

A `preStop` hook gives you step 2. It sleeps while the instance serves traffic as usual:

```yaml
lifecycle:
  preStop:
    exec:
      command: ['sleep', '5']   # longer than your ingress takes to notice
terminationGracePeriodSeconds: 45
```

The grace period covers the sleep, plus the HTTP drain, plus the lease drain, plus your own hooks, see
[shutting down](./replication.md#shutting-down). The application handles everything from the
SIGTERM on. Size the sleep before it in your manifest.

## What the application writes

Two paths are written while the application runs in production, and both live in `.zibri` at the application root:

- `.zibri/uploads`: where an upload is written while a request is handled.
- `.zibri/backups`: where a [backup](./backup.md) is staged on its way to and from a transport.

`versions`, the route record described above, is written in development only. The user the application runs as owns `.zibri`. Everything else stays read only to it: the generated `Dockerfile` hands the `node` user `.zibri`, and leaves `versions`, the bundle and its dependencies to the build.

To keep the image unwritable for any user, run the container with a read-only root filesystem and mount a writable directory at `.zibri`. It can be empty and live as long as the container:

```yaml
securityContext:
  readOnlyRootFilesystem: true
volumeMounts:
  - name: zibri
    mountPath: /app/.zibri
volumes:
  - name: zibri
    emptyDir: {}
```

With Docker, the same is `docker run --read-only --tmpfs /app/.zibri`, and with Docker Compose:

```yaml
services:
  api:
    image: api   # the image your Dockerfile builds
    read_only: true
    tmpfs:
      - /app/.zibri
```

> [!WARNING]
> A [restore](./backup.md#a-restore-of-several-resources) killed halfway is put back at the next start from the snapshots it keeps in `.zibri/backups`. A container restarted with an empty `.zibri` has none of them, and the resources stay half restored. Restore on an instance whose `.zibri/backups` outlives its container, such as one with a persistent volume there or `ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER` pointing at one.

`versions` stays as the image ships it, so build the image from a `versions` folder that already records the release. A container that starts on a version the record lacks stops at startup, and the error says how to record it.

## What the application is made of

Generate the software bill of materials for your application. It lists Zibri and every package it
brings, at the versions your application installed:

```sh
npm sbom --sbom-format cyclonedx --omit dev > sbom.cdx.json
```

Every package Zibri installs, the [optional ones](./getting-started.md#optional-packages) included,
is under one of these licenses: MIT, MIT-0, ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, 0BSD,
BlueOak-1.0.0, CC0-1.0, Unlicense or Zlib. The one exception is `caniuse-lite` (CC-BY-4.0), browser
support data that `zibri/webpack` reads while it builds. It is not part of the bundle, and a generated
project's image leaves it out with the other dev dependencies. A release ships with no known high or
critical advisory among them.

## Running more than one instance

Every instance is equal, and coordination happens through the data source, so you scale out by
starting more of them. [replication.md](./replication.md) describes what that guarantees: elected cron
executions, claimed events, and the leases underneath both.

## See also

- [Replication](./replication.md) — running several instances of the same application
- [Versioning](./versioning.md) — what the `versions` folder records, and what it validates
- [Application lifecycle](./application-lifecycle.md) — the hooks that run on the way up and down
- [Logging](./logging.md) — where a deployment sends what it records
- [Recovering work that stopped](./troubleshooting.md) — what to do when a job, an event, a mail or a backup failed
