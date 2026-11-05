# The OpenAPI document
Your application describes its routes as an [OpenAPI](https://spec.openapis.org/oas/v3.1.0) 3.1 document, one for each version, built from the decorators the router mounts. An API gateway imports it, a client generator writes a client from it, a security scanner reads it, and the explorer at `/explorer` shows it in the browser.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `OpenApiService`, `OpenApiServiceInterface` | class, interface | Builds the document and serves the explorer. Replaceable through `ZIBRI_DI_TOKENS.OPEN_API_SERVICE` |
| `OpenApiDefinition` | type | The document of one version |
| `OpenApiComponentsObject` | type | The `components` of the document, `securitySchemes` among them |
| `OpenApiSecuritySchemeObject`, `OpenApiSecuritySchemeType` | type, type | How an [auth strategy](./glossary.md#auth-strategy) appears under `securitySchemes`, and the kinds of scheme, `mutualTLS` among them |
| `OpenApiReferenceObject`, `isOpenApiReferenceObject` | type, function | A `$ref` to a schema, and whether a value is one rather than a schema |
| `ZIBRI_DI_TOKENS.OPEN_API_AUTH` | DI token | Who may open the explorer and the document. Defaults to what `defaultAuth` says |

## Reading the document

| URL | What it answers |
|---|---|
| `/explorer` | The explorer, with a choice of every version of the application, the latest first |
| `/explorer/spec/<version>` | The document of one version as JSON, such as `/explorer/spec/1.0.0`. `404` for a version the application does not have |

The versions are the ones the application records, see [versioning](./versioning.md). Each document is built when the application starts, so it describes the routes of the build that is running.

To hand the document to a gateway or a client generator, download it from a running instance:

```bash
curl -o openapi.json https://api.example.com/explorer/spec/1.0.0
```

## What the document describes

| Part | What it holds |
|---|---|
| `info` | The `name` of the application as `title`, and the version as `version` |
| `tags` | One for each controller. Each operation is tagged with its controller |
| `paths` | Every route of the version: its path, query and header parameters, its request body, and its responses |
| `components.securitySchemes` | One for each registered auth strategy, see [how login appears](#how-login-appears) |

A request body is described by the model of its `@Body`, and the responses by the `@Response` decorators of the route, see [defining OpenAPI responses](./creating-endpoints.md#defining-openapi-responses).

A property that is not required may also be `null`, in a request and in a response, and the document says so: `type: ['string', 'null']`. A value of several shapes is described with `oneOf`, each shape by the name it is sent with.

A route registered directly on the router is in the document as well, unless it sets `openApi: { useInOpenApi: false }`. It describes its responses and tags in `openApi`, since it has no decorators. `HEAD`, `OPTIONS` and `TRACE` routes are left out.

## How login appears
`components.securitySchemes` holds the scheme of every registered auth strategy, under its name: `jwt`, `cookie`, `api-key` and so on.

An operation that requires a login lists every strategy under `security`. One that answers anonymous callers lists none. A route that says nothing follows `defaultAuth` here as it does when it is called, see [what an undecorated route requires](./auth.md#what-an-undecorated-route-requires).

A route behind a permission names it in `x-permission`, and one behind a permission of the platform in `x-platform-permission`, see [roles and permissions](./roles-and-permissions.md).

## Restricting the explorer
The explorer, the scripts it loads and the documents follow `defaultAuth`, like every route that says nothing of its own. An application that requires a login by default answers an anonymous caller with `401`. A browser opens the explorer by navigating to it, and a navigation carries no `Authorization` header, so with a bearer token login the explorer stays closed to a browser.

`ZIBRI_DI_TOKENS.OPEN_API_AUTH` decides it independent of `defaultAuth`. It takes the configuration a manually registered route takes, so the explorer can be open to everyone, require a login or require a permission. `{ skip: true }` opens it to everyone:

```typescript
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

providers: [
    defineProvider({ token: ZIBRI_DI_TOKENS.OPEN_API_AUTH, useFactory: () => ({ skip: true }) })
]
```

A project `zi new` creates provides `{ skip: true }` in every environment. The document lists every route, every model and the permission each route asks for, so remove that provider where the document is not meant to be public.

A permission puts it behind that permission, whatever the default is:

```typescript
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { PlatformPermissions } from './models/permissions';

providers: [
    defineProvider({
        token: ZIBRI_DI_TOKENS.OPEN_API_AUTH,
        useFactory: () => ({ hasPlatformPermission: { permission: PlatformPermissions.API_DOCS_READ } })
    })
]
```

In a browser, the explorer then opens with a cookie session, which the navigation carries, and not with a bearer token. Under a token-only strategy, anything that can set a header, such as a code generator or a client library, still reads the document.

## Moving the explorer and changing the document
Extend `OpenApiService` and provide it under `ZIBRI_DI_TOKENS.OPEN_API_SERVICE`. `openApiRoute` is where the explorer and the documents are served, `/explorer` by default. `createOpenApiDefinition` builds the document of one version; call it on `super` and change what it answers, such as to name the server a gateway sends requests to:

```ts
// src/services/api-docs.service.ts
import { OpenApiDefinition, OpenApiService, Route, Version, ZibriApplication } from 'zibri';

export class ApiDocsService extends OpenApiService {
    override readonly openApiRoute: Route = '/docs';

    override async createOpenApiDefinition(app: ZibriApplication, version: Version): Promise<OpenApiDefinition> {
        const definition: OpenApiDefinition = await super.createOpenApiDefinition(app, version);
        return { ...definition, servers: [{ url: 'https://api.example.com' }] };
    }
}
```

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { ApiDocsService } from './services/api-docs.service';

defineProvider({ token: ZIBRI_DI_TOKENS.OPEN_API_SERVICE, useClass: ApiDocsService });
```

The explorer is then at `/docs`, and the document of version `1.0.0` at `/docs/spec/1.0.0`.

## Changing the look of the explorer
The files of the explorer are your application's own, in `assets/public/open-api/`:

| File | What it does |
|---|---|
| `custom.css` | Styles the explorer |
| `custom.js` | Shows the logo and the name of the application, and the permission each route requires |
| `swagger-ui-init.js` | Opens the explorer on the document of every version, the latest first |

The page hands the two scripts the name of the application, the logo and the documents as JSON, in the element `zibri-explorer-config`.

## See also
- [Creating endpoints](./creating-endpoints.md) — the decorators the document is built from
- [Versioning](./versioning.md) — the versions the explorer offers
- [Authentication & Authorization](./auth.md) — the strategies whose schemes the document names
