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

`versions` sits beside `dist`, because the application writes to it: each release records the routes
it serves, and the release after it is checked against that record. Commit it to version control,
and copy it into every deployment. The folder is required. Create it empty to start recording from
the current version.

## Configuration

Everything that differs between one machine and the next is read from the environment. `.env.example`
is the committed list of what a deployment sets, and `src/env.ts` reads it:

- `requireEnv` stops the application at startup when a variable is unset, naming the one that is
  missing.
- `optionalEnv` answers with an empty string, for what the application runs without.

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
its default to `'requireLogin'`.

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
leases it holds and closes its data sources. Send the signal to the process itself. In a container
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

Three paths are written while the application runs, and all of them live at the application root:

- `versions`: the route record described above, updated at startup when the version changes.
- `.zibri/uploads`: where an upload is written while a request is handled.
- `.zibri/backups`: where a [backup](./backup.md) is staged on its way to and from a transport.

The user the application runs as owns these three. Everything else stays read only to it: the generated `Dockerfile` hands the `node` user `versions` and `.zibri`, and leaves the bundle and its dependencies to the build.

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

`versions` stays as the image ships it. The application writes to it only when the record does not hold the version it runs, so build the image from a `versions` folder that already records the release. A read-only container that starts on a version its record lacks stops at startup.

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
