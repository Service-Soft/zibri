# Versioning
Zibri uses the `package.json` as the single source of truth for versioning concerns.

It's used for [Handling migrations](./data-source.md#handling-migrations) and to check against endpoints supported versions.

## Defining supported versions on endpoints
Supported versions can be defined with the same syntax you would use inside your package.json:

```ts
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

## Validation
Zibri aims to provide really strong guard rails when it comes to versioning. You might have already noticed that a `versions` folder in your project gets generated when you start it up the first time with a new `package.json` version. Inside the folder, each version is saved, in addition with its configured routes at that point in time. This allows for some really strong validation when the version inside the `package.json` is bumped.

Let's say you start with version `'1.0.0'` (the default) and later on change it to `'2.0.0'`. Now Zibri can complain about any endpoint that previously used `'latest'`, `'^latest'` or `'~latest'`, because latest now means something else, so it should have something like `['^1.0.0', '^latest']` as the supported versions defined. Otherwise, any user of version `'1.0.0'` would get an error that the endpoints they spoke to just fine now no longer exist.

# Version resolution
Versions are resolved by reading from a custom query parameter (`'version'` by default), then a custom header (`'x-version'` by default). The provided value can either be:
- a concrete version, like `'1.0.0'`
- a json date, like `'2026-05-29T07:44:06.186Z'`

Zibris versioning service then handles resolving the correct version and endpoint for that header. Or throwing an error when it could not be found.

What version is resolved by the date is defined inside of the version files: They contain a startsAt and endsAt timestamp.