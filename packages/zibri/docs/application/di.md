---
keywords: [di, inject, injection, providers, ioc, container, services, tokens]
---

# Dependency injection
Dependency injection hands a class the services and values it needs. A container builds them and keeps them for as long as their scope says. Every service of the framework is registered in it too, so you can replace any of them with your own implementation.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Injectable` | decorator | Registers a class for dependency injection |
| `InjectableOptions` | type | What `@Injectable` takes: the `token` to register under, when to `register`, the `scope` and the `variant` |
| `inject` | function | Resolves an injectable/token outside of a constructor |
| `Inject` | decorator | Resolves a token for a constructor parameter |
| `InjectionToken` | class | Creates a typed token for injecting non-class values |
| `DiToken` | type | What a value is registered and injected under: a class or an `InjectionToken` |
| `DiProvider` | type | Entry type for the providers array |
| `ClassDiProvider`, `FactoryDiProvider`, `AsyncFactoryDiProvider`, `ValueDiProvider` | type, type, type, type | The four shapes of a `DiProvider`: `useClass`, `useFactory`, `useAsyncFactory` and `useValue` |
| `DiProviderWithoutToken` | type | A `DiProvider` without its `token` |
| `DiScope` | type | How long an injected value lives: `'application'`, `'request'` or `'transient'`. Defaults to `'application'` |
| `DiVariant`, `DiVariants` | class, constant | Marks an injectable as one of a kind, such as a cache or a controller, and the kinds the framework looks for |
| `defineProvider` | function | Defines a `DiProvider` entry (such as `useFactory`) |
| `TokenRecord`, `DiTokenProviderRecord`, `providersFromTokenRecord` | type, type, function | A record of DI tokens, a provider for each of its tokens, and the `DiProvider` entries the two make together |
| `NoProviderError`, `NoProviderErrorOptions` | error, type | Thrown when nothing is registered under the token being injected, and whether the container is empty altogether |
| `CircularDependencyError` | error | Thrown when a value is asked for while it is still being constructed |
| `ProviderCollisionError` | error | Thrown at startup when two plugins provide the same token and nothing says which one to use |
| `InvalidProviderError` | error | Thrown when a provider names no valid token |
| `InvalidClassMarkedWithInjectableError`, `InvalidClassReason` | error, type | Thrown at startup when `@Injectable` is on a cron job, plugin, two factor method or [auth strategy](../glossary.md#auth-strategy), which are declared through their own options instead |
| `UninjectableParameterError` | error | Thrown when a constructor parameter has no token to resolve it with, such as an interface without `@Inject` |
| `OutsideRequestScopeError`, `CapturedRequestScopeError` | error, error | Thrown when a request scoped value is asked for outside a request, or while building something that outlives one |
| `UnresolvedAsyncProviderError`, `InjectInsideAsyncFactoryError` | error, error | Thrown when an asynchronous provider is injected before it was awaited, or inside the factory of another one |
| `MissedLifecycleHooksError` | error | Thrown when a value with lifecycle hooks is first injected after the point its hooks were due |
| `ZIBRI_DI_TOKENS` | constant | Built-in DI tokens for overriding framework services |
| `GlobalErrorHandler` | type | Type of the built-in global error handler, overridable via `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER` |

## Adding new injectables
Something becomes injectable in one of two ways:
1. decorate a class with `@Injectable()`
2. add the value to your providers array

A class of your own needs only the decorator.

### Decorating a class
```ts
// src/services/task.service.ts
import { Injectable } from 'zibri';

@Injectable()
export class TaskService {
    // ...
}
```

Inject `TaskService` as a constructor parameter, or with `inject`:

```ts
// src/controllers/task.controller.ts
import { Controller, inject } from 'zibri';

import { TaskService } from '../services/task.service';

@Controller('/tasks')
export class TaskController {
    constructor(private readonly taskService: TaskService) {
        const alternative: TaskService = inject(TaskService);
    }
    // ...
}
```

### Providing a value
A value that is not a class of your own goes in the providers array, under an `InjectionToken`:

```ts
// src/providers.ts
import { defineProvider, DiProvider, InjectionToken } from 'zibri';

export const someToken = new InjectionToken<string>('some-token');

export const providers: DiProvider<unknown>[] = [
    // ...
    defineProvider({
        token: someToken,
        useFactory: () => '42'
    })
    // ...
]
```

It is injected the same way. A constructor parameter names the token with `@Inject`:

```ts
// src/controllers/tokened.controller.ts
import { Controller, Inject, inject } from 'zibri';

import { someToken } from '../providers';

@Controller('/tokened')
export class TokenedController {
    constructor(
        @Inject(someToken)
        private readonly value: string
    ) {
        const alternative: string = inject(someToken);
    }
    // ...
}
```

## Configuration
Every service of the framework is registered under a token of `ZIBRI_DI_TOKENS`. To replace one with your own implementation, provide it under that token. This error handler replaces the default one:

```ts
// src/my-error-handler.ts
import { GlobalErrorHandler } from 'zibri';

export const myErrorHandler: GlobalErrorHandler = async (error, req, res, next) => {
    // ...your custom logic
}
```

Add it to your providers array:

```ts
// src/providers.ts - one more entry in the same array
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { myErrorHandler } from './my-error-handler';

defineProvider({
    token: ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER,
    useFactory: () => myErrorHandler
});
```

The application uses your error handler in place of the default one.

Every token, with its type and its default, is listed in [configuring the framework](./configuration.md).

## Precedence
Providers are registered in one order, and the last registration for a token is the one that answers:

1. the framework's own defaults
2. the providers of each plugin, in the order the plugins are listed
3. the application's `providers` array

The application's array wins over a default and over a plugin. Inside one array the last entry for a token wins as well, so you can compose one array out of another:

```ts
// src/providers.ts
import { defineProvider, DiProvider, ZIBRI_DI_TOKENS } from 'zibri';

import { myErrorHandler } from './my-error-handler';
import { sharedProviders } from './shared-providers';

export const composedProviders: DiProvider<unknown>[] = [
    ...sharedProviders,
    defineProvider({
        token: ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER,
        useFactory: () => myErrorHandler
    })
];
```

The last entry takes the token, whatever `sharedProviders` says about it.

Two plugins providing the same token raise a `ProviderCollisionError` at startup. Name the token in the application's own providers array to choose the implementation:

```
ProviderCollisionError: The plugins "PaymentPlugin" and "InvoicingPlugin" both provide "MAILER".
Neither takes precedence over the other, so which one is used would come down to the order they are listed in.
Name the token in the application's own providers array to say which implementation to use -
that array is registered after every plugin, so what it names wins over both.
```

## Scopes
A provider's scope says how long its value lives, and therefore when a new one is built.

| Scope | |
|---|---|
| `'application'` | Built once and kept for the lifetime of the application. The default. |
| `'request'` | Built once per request and kept for as long as that request is handled. |
| `'transient'` | Built again on every injection, and kept by nothing. |

A request scoped service is built with whatever the current request knows, and every request gets its own. `CURRENT_REQUEST_CONTEXT` also answers with a websocket context, which has no HTTP headers:

```ts
// src/services/current-tenant.service.ts
import { HttpRequestContext, inject, Injectable, WebsocketRequestContext, ZIBRI_DI_TOKENS } from 'zibri';

@Injectable({ scope: 'request' })
export class CurrentTenantService {
    readonly tenantId: string = resolveTenantId();
}

function resolveTenantId(): string {
    const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    if (!(context instanceof HttpRequestContext)) {
        return 'public';
    }
    const header: string | string[] | undefined = context.request.headers['x-tenant-id'];
    return typeof header === 'string' ? header : 'public';
}
```

Injecting it from a controller method gives that request's instance, and asking twice in one request gives the same one:

```ts
// src/controllers/report.controller.ts
import { Controller, Get, inject } from 'zibri';

import { Report } from '../models';
import { CurrentTenantService } from '../services/current-tenant.service';
import { ReportService } from '../services/report.service';

@Controller('/reports')
export class ReportController {
    constructor(private readonly reports: ReportService) {}

    @Get('/')
    async list(): Promise<Report[]> {
        return this.reports.forTenant(inject(CurrentTenantService).tenantId);
    }
}
```

A request scoped value needs a request. Asking for one from a cron job, a lifecycle hook, an event subscriber or a script raises an `OutsideRequestScopeError`.

A service that lives longer than a request cannot be built out of a request scoped one. It would hand the first request's value to every request after it, so building it raises a `CapturedRequestScopeError`:

```ts
// src/services/capturing-report.service.ts
import { Injectable } from 'zibri';

import { CurrentTenantService } from './current-tenant.service';

@Injectable()
export class CapturingReportService {
    constructor(private readonly tenant: CurrentTenantService) {}
}
```

Inject it where it is used instead. A method runs inside the request that called it, so the value is that request's:

```ts
// src/services/report.service.ts
import { inject, Injectable } from 'zibri';

import { Report } from '../models';
import { CurrentTenantService } from './current-tenant.service';

@Injectable()
export class ReportService {
    private get tenant(): CurrentTenantService {
        return inject(CurrentTenantService);
    }

    async forTenant(tenantId: string): Promise<Report[]> {
        return [];
    }
}
```

Marking `ReportService` itself `scope: 'request'` works too, for a service that keeps nothing between requests.

## Values that have to be awaited
Some values exist only once something is awaited, such as a connection, a secret read from a vault
or a warmed cache. `useAsyncFactory` is awaited once, while the application initializes:

```ts
// src/providers.ts
import { defineProvider, DiProvider, InjectionToken } from 'zibri';

import { vault } from './vault';

export const vaultSecret = new InjectionToken<string>('vault-secret');

export const asyncProviders: DiProvider<unknown>[] = [
    defineProvider({
        token: vaultSecret,
        useAsyncFactory: async () => vault.read('db/password')
    })
];
```

After that it is injected like any other value, and `inject` stays synchronous:

```ts
// src/services/secret-reading-report.service.ts
import { inject, Injectable } from 'zibri';

import { vaultSecret } from '../providers';

@Injectable()
export class SecretReadingReportService {
    private readonly password: string = inject(vaultSecret);
}
```

Inside such a factory, `inject` refuses another awaited value with an
`InjectInsideAsyncFactoryError`. Name what the factory needs in `deps`, and it arrives as an
argument:

```ts
// src/providers.ts
import { defineProvider } from 'zibri';

import { connect, databaseConnection } from './database';

defineProvider({
    token: databaseConnection,
    deps: [vaultSecret],
    useAsyncFactory: async (password: string) => connect(`db://user:${password}@host`)
})
```

The container resolves `deps` first. It awaits the ones that are awaited, and builds the ones that
are classes with their own constructor parameters. The order the providers are registered in does not
matter. Two factories naming each other raise a `CircularDependencyError`.

A value from `useAsyncFactory` is built once, so it takes no scope. Register it in the application's
or a plugin's providers. One registered after the application started awaiting them raises an
`UnresolvedAsyncProviderError` when it is injected.

## What is built at startup

Initialization builds the classes that declare a [lifecycle hook](./application-lifecycle.md).
Everything else is built the moment something injects it.

```ts
// src/services/warmed-index.service.ts
import { Injectable, OnAppInit } from 'zibri';

@Injectable()
export class WarmedIndexService implements OnAppInit {
    async onAppInit(): Promise<void> {
        await this.rebuild();
    }

    async rebuild(): Promise<void> {}
}

@Injectable()
export class PriceFormatterService {
    format(amount: number): string {
        return amount.toFixed(2);
    }
}
```

`WarmedIndexService` is built during initialization, and its hook runs there. `PriceFormatterService` is built the first time something asks for it.

Importing the module that declares a class makes it resolvable, and does not build it. A service of a
package that the application never asks for costs the import and nothing more.

A hook runs for whatever exists when the application reaches it. A class first built while the
application comes up, by another class's constructor or from inside a hook, takes part in every
phase that has not finished yet. The shutdown hooks run for whatever exists when the application
shuts down, so a class declaring only those can be built at any time.

## Registering on first use
`@Injectable({ register: 'onUse' })` records the class without putting it in the container. The container finds it the first time something asks for it, and registers it then.

Use it for a class a package ships for its callers to reach when they want it.

Initialization does not build such a class, so its lifecycle hooks do not run. An application that
needs them names the class in `additionalLifecycleServices`:

```ts
// src/services/report-archive.service.ts
import { Injectable, OnAppInit } from 'zibri';

@Injectable({ register: 'onUse' })
export class ReportArchiveService implements OnAppInit {
    async onAppInit(): Promise<void> {
        await this.openArchive();
    }

    async openArchive(): Promise<void> {}
}
```

```ts
// src/index.ts
import { ZibriApplication } from 'zibri';

import { ReportArchiveService } from './services/report-archive.service';

const app: ZibriApplication = new ZibriApplication({
    name: 'invoices',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    defaultAuth: 'public',
    twoFactorAtLogin: 'never',
    controllers: [],
    websocketControllers: [],
    additionalLifecycleServices: [ReportArchiveService]
});
```

Injecting one the application did not name, after a phase whose hook it declares has finished,
raises a `MissedLifecycleHooksError`. That includes injecting it from inside a later hook while the
application comes up:

```
MissedLifecycleHooksError: "ReportArchiveService" declares a lifecycle hook and is being built for the first time now,
after the phases it asked to take part in have passed - so those hooks are not going to run.
The application initializes whatever declares a hook, and this class reached none of that:
it is registered on first use, or the token it is provided under was given to something else.
Name it in the application's additionalLifecycleServices to have it built at startup.
It was declared in /srv/api/src/services/report-archive.service.ts.
```

A class with no lifecycle hook is built the moment it is asked for.

## When resolution fails

A class is resolvable from the moment it is decorated. A class in a module that is loaded on demand,
long after the application started, resolves like any other.

A constructor parameter is resolved by its type only when that type is a class. The type is read
from the metadata TypeScript emits, which keeps classes only. An interface, a union, a generic
parameter and a primitive arrive as `Object`. So does a class that is not defined yet because two
modules import each other:

```
UninjectableParameterError: Parameter 0 of "ReportService" cannot be injected, because its type was recorded as "Object".
TypeScript writes down a built-in like that for anything that is not a class - an interface,
a union, a generic parameter, a primitive - and also for a class that is not defined yet
because two modules import each other.
Decorate the parameter with @Inject(token) to say what to resolve,
or break the import cycle if it is a class you expected to be injected.
It was declared in /srv/api/src/services/report.service.ts.
```

Name a token with `@Inject` instead:

```ts
// src/services/token-injecting-report.service.ts
import { Inject, Injectable } from 'zibri';

import { REPORT_STORAGE, ReportStorage } from '../storage';

@Injectable()
export class TokenInjectingReportService {
    constructor(
        @Inject(REPORT_STORAGE)
        private readonly storage: ReportStorage
    ) {}
}
```

The same error saying `nothing was recorded about its type` means there is no metadata at all.
Injection by type needs the `emitDecoratorMetadata` compiler option, which `tsc` and SWC offer. A
build made with esbuild, Vite or Bun names the token with `@Inject`. See
[build toolchains](../getting-started.md#build-toolchains).

Two classes that inject each other while they are built raise a `CircularDependencyError`:

```
CircularDependencyError: Circular dependency: InvoiceService -> PdfService -> InvoiceService.
Each of these is being constructed while the next one is asked for, so none of them can finish.
```

Move one of the two injections out of the constructor. A getter that calls `inject()` runs after
both instances exist:

```ts
// src/services/invoice.service.ts
import { inject, Injectable } from 'zibri';

import { PdfService } from './pdf.service';

@Injectable()
export class InvoiceService {
    private get pdfService(): PdfService {
        return inject(PdfService);
    }
}
```

## One copy per process

An application runs on exactly one copy of `zibri` in its process, since each copy has a container
and classes of its own. Two copies raise a `DuplicateFrameworkCopyError` at startup:

```
DuplicateFrameworkCopyError: 2 copies of zibri are loaded in this process.
Each one has its own container, its own record of what is injectable and its own classes,
so an injectable registered through one is invisible to the other, and an instanceof check
across them says no about a value that is exactly what it claims to be.
In a test, "jest.resetModules" or "jest.isolateModules" loads the second copy: a test that
resets the module registry goes in a file of its own, which has a registry of its own.
Otherwise, run "npm ls zibri" to see which packages pulled in more than one of it.
A package built on top of zibri should list it under "peerDependencies" rather than
"dependencies", so that it uses the copy the application already has.
```

In a test, a module registry reset loads the second copy, see
[starting your application in a test](../testing.md#starting-your-application-in-a-test).

`npm ls zibri` names the packages that installed a copy of their own. A library that builds on the
framework, such as a plugin, a shared set of injectables or a set of entities, lists `zibri` as a peer
dependency, so it uses the application's copy:

```json
{
    "peerDependencies": {
        "zibri": "^3.0.0"
    }
}
```

## Requirements
| Package | Used for |
|---|---|
| `reflect-metadata` | Injecting a constructor parameter by its declared type |

## See also
- [Configuring the framework](./configuration.md) — every token of `ZIBRI_DI_TOKENS`, with its type and default
- [Error handling](./error-handling.md) — overriding the `GlobalErrorHandler` via `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER`
- [Request context](./request-context.md) — resolving request-scoped injectables