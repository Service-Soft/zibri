# Versioning
Zibri uses the `package.json` as the single source of truth for versioning concerns.

It's used for [Handling migrations](./data-source.md#handling-migrations) and to check against endpoints supported versions.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `SupportedVersionsOptions` | type | Type of the `versions` option on controllers/routes |
| `VersioningServiceInterface` | interface | Resolves the correct version/endpoint for an incoming request |

## Usage
### Defining supported versions on endpoints
Supported versions can be defined with the same syntax you would use inside your package.json:

```ts
// src/controllers/validated.controller.ts
import { Controller, defineProvider, FsUtilities, Get, ZIBRI_DI_TOKENS } from 'zibri';

@Controller('/some', { versions: ['^1.0.0'] })
class ValidatedController {
    @Get('/endpoint-v1')
    getEndpoint(): { ok: boolean } {
        return { ok: true };
    }

    @Get('/endpoint-v2', { versions: ['^2'] })
    getEndpointV2(): { ok: boolean } {
        return { ok: true };
    }

    @Get('/endpoint-latest', { versions: ['^latest'] })
    getEndpointLatest(): { ok: boolean } {
        return { ok: true };
    }
}
```

As you can see, versions can either be defined on the controller or on the route level.

There is also the special `'latest'` version, which resolves to the current highest major version. By default controllers and routes support the version `'^latest'`.

### Validation
Zibri aims to provide really strong guard rails when it comes to versioning. You might have already noticed the `versions` folder in your project, which `zi new` creates. Each version is saved inside it, together with the routes it was configured with at that point in time. This allows for some really strong validation when the version inside the `package.json` is bumped.

The folder belongs to your project, so commit it and ship it with whatever you deploy — the release after this one is checked against what this one recorded. An application whose `versions` folder is absent stops at startup and names the path it looked in, and an empty folder is what it takes as permission to record a first version. [deployment.md](./deployment.md) describes where it sits in a deployment.

The folder sits beside your `package.json`, so it stays put no matter which directory the app was started from. Point it somewhere else with the `VERSIONS_PATH` token:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.VERSIONS_PATH,
    useFactory: () => FsUtilities.getPath('/var/lib/my-app/versions')
})
```

Let's say you start with version `'1.0.0'` (the default) and later on change it to `'2.0.0'`. Now Zibri can complain about any endpoint that previously used `'latest'`, `'^latest'` or `'~latest'`, because latest now means something else, so it should have something like `['^1.0.0', '^latest']` as the supported versions defined. Otherwise, any user of version `'1.0.0'` would get an error that the endpoints they spoke to just fine now no longer exist.

### Version resolution
Versions are resolved by reading from a custom query parameter (`'version'` by default), then a custom header (`'x-version'` by default). The provided value can either be:
- a concrete version, like `'1.0.0'`
- a json date, like `'2026-05-29T07:44:06.186Z'`

Zibris versioning service then handles resolving the correct version and endpoint for that header. Or throwing an error when it could not be found.

What version is resolved by the date is defined inside of the version files: They contain a startsAt and endsAt timestamp.

### Version files
Each file holds the version, its startsAt and endsAt timestamps, and the routes it served. A route's versions name their shape, as described in [A value of several shapes](./models.md#a-value-of-several-shapes):

```json
{
    "value": "1.0.0",
    "startsAt": "2026-05-27T08:11:12.332Z",
    "routes": [
        { "key": "GET /explorer", "versions": { "shape": "All", "value": "all" } },
        { "key": "GET /tests/", "versions": { "shape": "Matchers", "value": ["^latest"] } }
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
