# Deployment

What a running Zibri application is made of, and what has to travel with it.

`zi new` generates a `Dockerfile` and a `.dockerignore` alongside the project, so a generated
application is deployable as it stands. This page describes what they express, so that a deployment
built by other means expresses the same things.

## What a deployment is

A deployment is a directory with four things in it:

```
package.json      what to install, and the version this release is
node_modules      installed for the platform the application runs on
dist              the bundle, and everything read from inside it
versions          the routes each released version served
```

The application resolves itself from the `package.json` above its entry point, so everything it
reads at a path of its own is found relative to that directory, whatever directory the process was
started from.

`dist` carries the bundle together with the assets, the compiled templates and the translations. The
build puts them there because they are read from inside it — one folder to copy, and a bundle that
answers for its own content.

`versions` sits beside `dist` instead, because the application writes to it: each release records
the routes it serves, and the release after it is checked against that record. It is committed to
version control for the same reason, and an application whose `versions` folder is absent stops at
startup and says so. That refusal is what keeps the record meaningful — an application that treated
the version it is on as the first one that ever existed would answer every later question about
compatibility from an empty history.

## Configuration

Everything that differs between one machine and the next is read from the environment. `.env.example`
is the committed list of what a deployment sets, and `src/env.ts` reads it:

- `requireEnv` stops the application at startup when a variable is unset, naming the one that is
  missing.
- `optionalEnv` answers with an empty string, for what the application runs without.

A `.env` file is read when there is one beside the application, which is how a development machine
supplies these. A deployment usually sets them directly, and `.dockerignore` keeps the local file out
of the image: an image carrying one hands its secrets to everyone the image reaches.

## Health endpoints

`zi new` generates a `HealthController` with two routes, because a process has two different states
worth asking about:

- **`GET /health/live`** — whether the process is running. This is what a restart depends on, so it
  answers on the process alone. A liveness check that reaches for the database turns an outage of
  the database into a restart loop of the application.
- **`GET /health/ready`** — whether this instance should be sent traffic. It answers `503` once the
  application begins shutting down, which is the window a rolling deploy needs: the process is still
  serving the requests it already accepted, and new ones belong to another instance.

Both routes carry `versions: 'all'`, so a version bump leaves the probe URL where the orchestrator
already looks for it, and `@Auth.skip({ allowRedundant: true })`, so the probe keeps answering when
the application switches its default to `'requireLogin'`.

An application with dependencies of its own says so in the readiness half:

```ts
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

## Shutting down

A stop signal starts an orderly shutdown: the application runs its shutdown hooks, releases the
leases it holds and closes its data sources. Send the signal to the process itself — in a container
image that means the exec form of `CMD`, so that the signal arrives at node rather than at a shell
holding it.

The readiness endpoint answers `503` for the whole of that window, so an orchestrator polling it
moves traffic away while the instance finishes what it accepted.

## What the application writes

Two paths are written while the application runs, and both live at the application root:

- `versions` — the route record described above, updated at startup when the version changes.
- `.zibri/uploads` — where an upload is written while a request is handled.

The user the application runs as owns these two. Everything else can stay read only to it, which is
what the generated image does: the bundle it is running is owned by another user entirely.

## Running more than one instance

Every instance is equal, and coordination happens through the data source rather than between
processes, so scaling out is a matter of starting more of them. [replication.md](./replication.md)
describes what that guarantees — elected cron executions, claimed events, and the leases underneath
both.

## Further reading

- [replication.md](./replication.md) — running several instances of the same application
- [versioning.md](./versioning.md) — what the `versions` folder records, and what it validates
- [application-lifecycle.md](./application-lifecycle.md) — the hooks that run on the way up and down
- [logging.md](./logging.md) — where a deployment sends what it records