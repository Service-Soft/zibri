---
keywords: [openapi, swagger, api docs, explorer, api documentation]
---

# The OpenAPI document
Your application describes its routes as an [OpenAPI](https://spec.openapis.org/oas/v3.1.0) 3.1 document, one for each version, built from the decorators the router mounts. An API gateway imports it, a client generator writes a client from it, a security scanner reads it, and the explorer at `/explorer` shows it in the browser.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `OpenApiService`, `OpenApiServiceInterface` | class, interface | Builds the document and serves the explorer. Replaceable through `ZIBRI_DI_TOKENS.OPEN_API_SERVICE` |
| `OpenApiDefinition` | type | The document of one version |
| `OpenApiComponentsObject` | type | The `components` of the document, `securitySchemes` among them |
| `OpenApiSecuritySchemeObject`, `OpenApiSecuritySchemeType` | type, type | How an [auth strategy](../glossary.md#auth-strategy) appears under `securitySchemes`, and the kinds of scheme, `mutualTLS` among them |
| `OpenApiReferenceObject`, `isOpenApiReferenceObject` | type, function | A `$ref` to a schema, and whether a value is one rather than a schema |
| `OpenApiSchemaObject`, `OpenApiParameterObject`, `OpenApiRequestBodyObject`, `OpenApiResponseObject`, `OpenApiMediaTypeObject`, `OpenApiHeaderObject` | type, type, type, type, type, type | The parts of the document the explorer page renders: a schema, a parameter, a request body, a response, the content of one media type, and a header |
| `OpenApiInfoObject`, `OpenApiContactObject`, `OpenApiLicenseObject`, `OpenApiTagObject`, `OpenApiExternalDocumentationObject`, `OpenApiServerVariableObject` | type, type, type, type, type, type | The `info` of the document with its contact and license, a tag, a link to documentation elsewhere, and a variable of a server URL |
| `OpenApiPaths`, `OpenApiPathItemObject`, `OpenApiOperation`, `OpenApiResponsesObject`, `OpenApiCallbackObject`, `OpenApiLinkObject` | type, type, type, type, type, type | The `paths` of the document, the operations of one path, one operation, its responses by status, a callback, and a link from a response to another operation |
| `OpenApiParameter`, `OpenApiParameterLocation`, `OpenApiParameterStyle` | type, type, type | A parameter of an operation or a reference to one, where it is sent, and how its value is written |
| `OpenApiContentObject`, `OpenApiEncodingObject`, `OpenApiExampleObject` | type, type, type | The content of a body by media type, how a property of a multipart or form body is encoded, and an example of a value |
| `OpenApiSchemas`, `OpenApiSchemaObjectType`, `OpenApiDiscriminatorObject`, `OpenApiXmlObject` | type, type, type, type | The schemas of the `components` by name, the types a schema names, the property that tells the variants of a schema apart, and how a schema is written as XML |
| `OpenApiSecurityRequirementObject`, `OpenApiOAuthFlowsObject`, `OpenApiOAuthFlowObject` | type, type, type | The schemes an operation needs with their scopes, and the OAuth2 flows of a scheme, each with its URLs and scopes |
| `OpenApiSpecificationExtensions` | type | The fields starting with `x-` an object of the document may carry, each `unknown` |
| `ZIBRI_DI_TOKENS.OPEN_API_AUTH` | DI token | Who may open the explorer and the document. Defaults to what `defaultAuth` says |
| `ZIBRI_DI_TOKENS.OPEN_API_EXPLORER_TEMPLATE` | DI token | The page of the explorer. Defaults to none, which serves the documents without an explorer |
| `ZIBRI_DI_TOKENS.OPEN_API_SERVERS`, `OpenApiServerObject` | DI token, type | The servers the document names, see [naming the servers](#naming-the-servers). Defaults to the application itself, at `/` |
| `OpenApiExplorerTemplate`, `OpenApiExplorerProps`, `OpenApiExplorerVersion` | type, type, type | The page of the explorer, the props it is rendered with, and a version it offers |
| `OpenApiExplorerUtilities` | class | Reads the document for the page: the operations by tag, the security schemes, references, the name of a type, and an example of a value as JSON or XML |
| `OpenApiExplorerTag`, `OpenApiExplorerOperation`, `OpenApiExplorerResponse`, `OpenApiExplorerHeader`, `OpenApiExplorerMethod` | type, type, type, type, type | The operations of a tag, one operation with its references resolved, one of its responses, a header of a response, and the method of an operation |
| `OpenApiExplorerSecurityScheme`, `OpenApiExampleDirection` | type, type | A security scheme under its name, and whether an example is of a request or a response |
| `OpenApiExplorerSchemaSource` | type | A document whose schemas `OpenApiExplorerUtilities` reads: the OpenAPI or the AsyncAPI document |

## Reading the document

| URL | What it answers |
|---|---|
| `/explorer` | The explorer on the document of the latest version, with a choice of every version of the application |
| `/explorer/<version>` | The explorer on the document of one version, such as `/explorer/1.0.0`. `404` for a version the application does not have |
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
| `servers` | The application, at `/`, or the ones `ZIBRI_DI_TOKENS.OPEN_API_SERVERS` names, see [naming the servers](#naming-the-servers) |
| `tags` | One for each controller. Each operation is tagged with its controller |
| `paths` | Every route of the version: its path, query and header parameters, its request body, and its responses |
| `components.securitySchemes` | One for each registered auth strategy, see [how login appears](#how-login-appears) |

A request body is described by the model of its `@Body`, and the responses by the `@Response` decorators of the route, see [defining OpenAPI responses](./creating-endpoints.md#defining-openapi-responses).

A property that is not required may also be `null`, in a request and in a response, and the document says so: `type: ['string', 'null']`. A value of several shapes is described with `oneOf`, each shape by the name it is sent with.

A route registered directly on the router is in the document as well, unless it sets `openApi: { useInOpenApi: false }`. It describes its responses and tags in `openApi`, since it has no decorators. `HEAD`, `OPTIONS` and `TRACE` routes are left out.

## How login appears
`components.securitySchemes` holds the scheme of every registered auth strategy, under its name: `jwt`, `cookie`, `api-key` and so on.

An operation that requires a login lists every strategy under `security`. One that answers anonymous callers lists none. A route that says nothing follows `defaultAuth` here as it does when it is called, see [what an undecorated route requires](../auth/auth.md#what-an-undecorated-route-requires).

A route behind a permission names it in `x-permission`, and one behind a permission of the platform in `x-platform-permission`, see [roles and permissions](../auth/roles-and-permissions.md).

## Trying a route out
The explorer lists the routes by controller. Each one shows its parameters, its request body and its responses, with
the schema and an example of each body, in JSON and in XML. A route names the permission it requires, and a route that
requires a login shows a lock, closed once you entered a login under **Authorize**. The lock opens **Authorize**.

**Execute** sends a request from the browser. The form starts with the default or the example of each parameter,
and with the example of the body. A body of `multipart/form-data` asks for each field, a file field included. The
explorer shows the status, the headers and the body of the answer, and the request as a `curl` command. A file sent as
an attachment is offered to download.

A request names the version the explorer shows in the [version header](./versioning.md#resolving-the-version-of-a-request),
so it reaches the routes of that version.

**Authorize** takes what a request logs in with, for each security scheme of the document: a token for `jwt`, a key for
`api-key`. A request sends it the way its scheme says, in a header or in the query. A cookie and a
[client certificate](../auth/client-certificates.md) are sent by the browser itself, once you are logged in or hold the
certificate. What you enter is kept in this browser until you log out.

The explorer shows the server the document names, with its description. When the document names several, you
choose the one a request is sent to, see [naming the servers](#naming-the-servers).

## Naming the servers
The document names the application as its server, at `/`, so a request goes to wherever the document was read from.
`ZIBRI_DI_TOKENS.OPEN_API_SERVERS` names others in its place, such as the address a gateway sends requests to:

```ts
// src/providers.ts
import { $ts, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

providers: [
    defineProvider({
        token: ZIBRI_DI_TOKENS.OPEN_API_SERVERS,
        useFactory: () => [
            { url: '/', description: $ts`This application` },
            { url: 'https://api.example.com', description: $ts`Production` }
        ]
    })
]
```

The page may send a request to each server named with a full URL, such as `https://api.example.com`.

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
Extend `OpenApiService` and provide it under `ZIBRI_DI_TOKENS.OPEN_API_SERVICE`. `openApiRoute` is where the explorer and the documents are served, `/explorer` by default. `createOpenApiDefinition` builds the document of one version; call it on `super` and change what it answers, such as to describe the API:

```ts
// src/services/api-docs.service.ts
import { OpenApiDefinition, OpenApiService, Route, Version, ZibriApplication } from 'zibri';

export class ApiDocsService extends OpenApiService {
    override readonly openApiRoute: Route = '/docs';

    override async createOpenApiDefinition(app: ZibriApplication, version: Version): Promise<OpenApiDefinition> {
        const definition: OpenApiDefinition = await super.createOpenApiDefinition(app, version);
        return { ...definition, info: { ...definition.info, description: 'The API of the task tracker' } };
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

## Changing the explorer
The explorer is a [page](../templates/templating.md#rendering-a-page) of your application, provided under
`ZIBRI_DI_TOKENS.OPEN_API_EXPLORER_TEMPLATE`. A project `zi new` creates with the `pages` feature holds it in
`src/templates/explorer/`, styled with Tailwind like the other pages, see [choosing the features](../application/project-layout.md#choosing-the-features):

| File | What it renders |
|---|---|
| `explorer.tsx` | The page: the name of the application, the choice of version, and the tabs |
| `explorer-open-api.tsx` | The OpenAPI document: its link, the servers and **Authorize**, and the tags with their routes |
| `explorer-operation.tsx` | One route: its summary, the permissions it requires, and its responses |
| `explorer-lock.tsx` | The lock of a route that requires a login, which opens **Authorize** |
| `explorer-bar.tsx` | The band each document starts with: its servers, and **Authorize** |
| `explorer-try-it-out.tsx` | The parameters and the body of a route, sending its request, and the answer |
| `explorer-authorize.tsx` | **Authorize**, and the dialog that takes what a request logs in with |
| `explorer-async-api.tsx` | The [AsyncAPI document](./async-api.md): its link, the server a client connects to, and the events with their messages |
| `explorer-content.tsx` | The content of one media type: its schema and its example |
| `explorer-schema.tsx` | A schema, with its properties and what it allows |
| `explorer-methods.ts` | The colors of each method, and of an event a client emits or listens to |
| `explorer-context.ts` | What the page hands its parts: the document, the credentials and the server |

The page shows the OpenAPI document and the AsyncAPI document in two tabs, the OpenAPI one first. An application with
only HTTP routes, or only websocket events, sees the one document without tabs.

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { ExplorerPage } from './templates/explorer/explorer';

defineProvider({ token: ZIBRI_DI_TOKENS.OPEN_API_EXPLORER_TEMPLATE, useFactory: () => ExplorerPage });
```

The page is rendered with an `OpenApiExplorerProps`: the name of the application, where its assets are served, every
version, the version it shows, both documents of that version, and the version header. `OpenApiExplorerUtilities`
and `AsyncApiExplorerUtilities` read the documents for it. A reference a document cannot resolve throws while the page
renders, naming the reference.

Without a template, as in a project without the `pages` feature, the application serves the documents at
`/explorer/spec/<version>` and `/explorer/asyncapi/<version>` and no explorer, and warns once when it starts.
`zi add pages` adds the explorer.

## See also
- [Creating endpoints](./creating-endpoints.md) — the decorators the document is built from
- [Versioning](./versioning.md) — the versions the explorer offers
- [The AsyncAPI document](./async-api.md) — the websocket events, in the other tab of the explorer
- [Authentication & Authorization](../auth/auth.md) — the strategies whose schemes the document names
