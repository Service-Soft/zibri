# Versioning
The version of your application is the one in its `package.json`. It decides which [migrations](./data-source.md#handling-migrations) run, and which endpoints a request for a version reaches.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `SupportedVersionsOptions` | type | Type of the `versions` option on controllers/routes |
| `VersionMatcher` | type | One entry of `versions`: `'latest'`, `'^latest'`, `'~latest'`, a version, or one or two ranges |
| `SemVerRange` | type | A range of versions, such as `^1.2`, `~1.2.3` or `>=1.0.0` |
| `SemVerMatcher` | type | A `VersionMatcher` without the `latest` forms |
| `SemVerUtilities` | class | `isSemVerVersion`, `compare` and `matches` for versions in the SemVer format |
| `Version` | type | One version of the application: its `value`, such as `1.0.0` |
| `VersionFile` | class | A version as its version file holds it: its `value`, when it starts and ends, and its routes |
| `StoredRoute`, `StoredRouteVersions` | class, type | A route as a version file holds it, and the versions it supports: `'all'`, or matchers |
| `VersioningServiceInterface` | interface | Resolves the correct version/endpoint for an incoming request |
| `VersioningService` | class | Default implementation of `VersioningServiceInterface`. Replaceable through ZIBRI_DI_TOKENS.VERSIONING_SERVICE |

## Defining supported versions on endpoints
Supported versions are written as version ranges, the way your `package.json` writes them:

```ts
// src/controllers/task.controller.ts
import { Controller, Get } from 'zibri';

@Controller('/tasks', { versions: ['^1.0.0'] })
export class TaskController {
    @Get('/summary')
    getSummary(): { open: number } {
        return { open: 3 };
    }

    @Get('/board', { versions: ['^2'] })
    getBoard(): { columns: string[] } {
        return { columns: ['open', 'done'] };
    }

    @Get('/activity', { versions: ['^latest'] })
    getActivity(): { events: string[] } {
        return { events: [] };
    }
}
```

Versions are defined on the controller or on the route.

The version `'latest'` is the current highest major version. Controllers and routes support `'^latest'` by default.

## Checking a new version against the earlier ones
The `versions` folder of your project, which `zi new` creates, holds each version with the routes it served. When you raise the version in `package.json`, the routes of the new version are checked against what the earlier ones recorded.

Commit the folder, and ship it with what you deploy: the next release is checked against what this one recorded. The folder is required, and an empty one lets the application record a first version. [deployment.md](./deployment.md) describes where the folder sits in a deployment.

The folder sits beside your `package.json`, whichever directory the application is started from. Point it somewhere else with the `VERSIONS_PATH` token:

```ts
// src/providers.ts
import { defineProvider, FsUtilities, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.VERSIONS_PATH,
    useFactory: () => FsUtilities.getPath('/var/lib/task-tracker/versions')
})
```

An application at version `'1.0.0'`, the default, moves to `'2.0.0'`. Every endpoint that supported `'latest'`, `'^latest'` or `'~latest'` is reported, because `latest` then means `2`. Give it `['^1.0.0', '^latest']`, so a client of version `'1.0.0'` keeps reaching it.

## Resolving the version of a request
The version of a request is read from a query parameter, `'version'` by default, then from a header, `'x-version'` by default. Its value is either:
- a version, like `'1.0.0'`
- a JSON date, like `'2026-05-29T07:44:06.186Z'`

The versioning service resolves the version and the endpoint that serves it, and throws an error when there is none.

A date resolves to the version whose `startsAt` and `endsAt` in its version file enclose it.

## Version files
Each file holds the version, its startsAt and endsAt timestamps, and the routes it served. A route's versions name their shape, as described in [A value of several shapes](./models.md#a-value-of-several-shapes):

```json
{
    "value": "1.0.0",
    "startsAt": "2026-05-27T08:11:12.332Z",
    "routes": [
        { "key": "GET /explorer", "versions": { "shape": "All", "value": "all" } },
        { "key": "GET /tasks/", "versions": { "shape": "Matchers", "value": ["^latest"] } }
    ]
}
```

An application whose version files hold versions without their shape, like `"versions": "all"` or `"versions": ["^latest"]`, stops at startup and lists every such route with how to rewrite it.

Instances starting at the same time from one versions folder record a new version once, and each of them starts from what was recorded.

## See also
- [Deployment](./deployment.md) — where the `versions` folder sits in a deployment, and what carries it there
- [Data source](./data-source.md) — versioning drives migration handling via `package.json`
- [Request context](./request-context.md) — the query parameter/header used to resolve a version come from the incoming request
- [Error handling](./error-handling.md) — the error thrown when a version cannot be resolved
