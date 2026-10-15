# Dependency Injection
The Dependency Injection system is one of the most fundamental building blocks of Zibri.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Injectable` | decorator | Registers a class for dependency injection |
| `inject` | function | Resolves an injectable/token outside of a constructor |
| `Inject` | decorator | Resolves a token for a constructor parameter |
| `InjectionToken` | class | Creates a typed token for injecting non-class values |
| `DiProvider` | type | Entry type for the providers array |
| `defineProvider` | function | Defines a `DiProvider` entry (eg. `useFactory`) |
| `ZIBRI_DI_TOKENS` | object | Built-in DI tokens for overriding framework services |
| `GlobalErrorHandler` | type | Type of the built-in global error handler, overridable via `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER` |

## Usage
### Adding new injectables
To make something injectable there are 2 ways:
1. decorate a class with `@Injectable()`
2. add the value to your providers array

In most cases, you will probably just have to decorate a class:

#### With @Injectable
```ts
// src/services/test.service.ts
import { Controller, defineProvider, DiProvider, Get, HttpRequestContext, Inject, inject, Injectable, InjectionToken, WebsocketRequestContext, ZIBRI_DI_TOKENS } from 'zibri';

import { connect, databaseConnection, PdfService, Report, REPORT_STORAGE, ReportStorage, sharedProviders, vault } from './example-setup';

@Injectable()
export class TestService {
    // ...
}
```

Now you can easily inject the TestService either by adding it to a constructor or by using the `inject` helper:

```ts
// src/controllers/test.controller.ts
import { Controller, inject } from 'zibri';

@Controller('/tests')
export class TestController {
    constructor(private readonly testService: TestService) {
        const alternative: TestService = inject(TestService);
    }
    // ...
}
```

#### With the providers array
Alternatively, you can also add them to the providers array:

```ts
// src/providers.ts
import { DiProvider, defineProvider, InjectionToken, ZIBRI_DI_TOKENS } from 'zibri';

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

And then inject them the same way before, with the constructor approach needing an additional decorator:

```ts
// src/controllers/tokened.controller.ts
import { Controller, Inject, inject } from 'zibri';

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
Bascially every service/functionality of the framework is registered for dependency injection. That makes it really easy for you to replace something with your own implementation if you need more functionality than the builtin solutions.

Let's say that you want for example to replace the default error handler with the following one:

```ts
// src/my-error-handler.ts
import { GlobalErrorHandler } from 'zibri';

export const myErrorHandler: GlobalErrorHandler = async (error, req, res, next) => {
    // ...your custom logic
}
```

For that you can simply add it to your providers array:

```ts
// src/providers.ts - one more entry in the same array
defineProvider({
    token: ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER,
    useFactory: () => myErrorHandler
});
```

That's it! From now on, your custom error handler will be used instead of the default one provided by Zibri.

## Precedence
Providers are registered in one order, and the last registration for a token is the one that answers:

1. the framework's own defaults
2. the providers of each plugin, in the order the plugins are listed
3. the application's `providers` array

So the array above wins over a default and over a plugin. Inside a single array the last entry for a token wins as well, which is what lets one array be composed out of another:

```ts
// src/providers.ts
export const composedProviders: DiProvider<unknown>[] = [
    ...sharedProviders,
    // takes the token, whatever sharedProviders says about it
    defineProvider({
        token: ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER,
        useFactory: () => myErrorHandler
    })
];
```

Two plugins providing the same token is the one case that order settles by accident: the winner would be whichever plugin comes first in `plugins`, an order chosen for other reasons. Zibri refuses it:

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

A request scoped service is built with whatever the current request knows, and every request gets its own:

```ts
// src/services/current-tenant.service.ts
import { Injectable, inject, ZIBRI_DI_TOKENS } from 'zibri';

@Injectable({ scope: 'request' })
export class CurrentTenantService {
    readonly tenantId: string = resolveTenantId();
}

function resolveTenantId(): string {
    // the token answers with a websocket context too, which carries no http headers at all
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
@Controller('/reports')
export class ReportController {
    constructor(private readonly reports: ReportService) {}

    @Get('/')
    async list(): Promise<Report[]> {
        return this.reports.forTenant(inject(CurrentTenantService).tenantId);
    }
}
```

Two rules keep the scope honest, both of them errors rather than surprises:

**A request scoped value needs a request.** Asking for one from a cron job, a lifecycle hook, an event subscriber or a script raises an `OutsideRequestScopeError`, because there is nothing there to bound its life.

**Something longer lived cannot be built out of one.** A service that is kept for the application would hold the first request's value and hand it to every request after that, so building one raises a `CapturedRequestScopeError`:

```ts
@Injectable()
export class CapturingReportService {
    // CapturedRequestScopeError: the service outlives the request asking for it
    constructor(private readonly tenant: CurrentTenantService) {}
}
```

Reach for it where it is used instead. A method runs inside whichever request called it, so the value is that request's:

```ts
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

Marking `ReportService` itself `scope: 'request'` works too, and is the right answer when it has nothing to say between requests.

## Values that have to be awaited
Some values do not exist until something has been waited for — a connection, a secret read from a
vault, a warmed cache. `useAsyncFactory` is awaited once, while the application initializes:

```ts
// src/providers.ts
export const vaultSecret = new InjectionToken<string>('vault-secret');

export const asyncProviders: DiProvider<unknown>[] = [
    defineProvider({
        token: vaultSecret,
        useAsyncFactory: async () => vault.read('db/password')
    })
];
```

From then on it is a value like any other, which is what keeps `inject` synchronous everywhere else:

```ts
@Injectable()
export class SecretReadingReportService {
    private readonly password: string = inject(vaultSecret);
}
```

Because it is resolved before the rest of the application exists, such a factory is the one place
`inject` is refused — what it found there would be whatever happened to be built already, which
comes down to the order providers were registered in. Say what the factory needs with `deps`, and it
arrives as an argument:

```ts
defineProvider({
    token: databaseConnection,
    deps: [vaultSecret],
    useAsyncFactory: async (password: string) => connect(`db://user:${password}@host`)
})
```

The container resolves those first — awaiting whichever of them is itself awaited, and following the
constructor parameters of whichever is a class — so the order the two are registered in does not
matter, and two of them naming each other is a `CircularDependencyError` rather than a hang.

Only a value that is built once can be awaited, so `useAsyncFactory` has no scope to choose. It also
has to be registered before initialization: something first built inside a request is something
nothing is left to wait for, and asking for it then raises an `UnresolvedAsyncProviderError`.

## What is built at startup

Initialization builds the values that have something to do before their first use, and a class says
so by declaring a [lifecycle hook](./application-lifecycle.md). Everything else is built the moment
something injects it.

```ts
import { Injectable, OnAppInit } from 'zibri';

// built during initialization, and its hook runs there
@Injectable()
export class WarmedIndexService implements OnAppInit {
    async onAppInit(): Promise<void> {
        await this.rebuild();
    }

    async rebuild(): Promise<void> {}
}

// built the first time something asks for it
@Injectable()
export class PriceFormatterService {
    format(amount: number): string {
        return amount.toFixed(2);
    }
}
```

Importing the module that declares a class is what makes it resolvable, and that is all it does:
registering a class and building one are separate, so a package whose services an application never
asks for costs it the import and nothing further.

**A hook runs for whatever exists when the application reaches it.** A class first built while the
application comes up — by another class's constructor, or from inside a hook — takes part in every
phase that has not finished yet. The shutdown hooks run for whatever exists when the application
shuts down, so a class declaring only those can be built at any time.

## Registering on first use
`@Injectable({ register: 'onUse' })` records the class without putting it in the container. The container finds it the first time something asks for it, and registers it then.

Use it for a class whose resolution is worth deferring past registration itself, such as one a
package ships for its callers to reach when they want it.

**Nothing provides such a class, so initialization has nothing to build** — which is right for the
callers who never ask for it, and leaves the ones who do asking after the phases have gone by. An
application that means to run one names it:

```ts
import { Injectable, OnAppInit, ZibriApplication } from 'zibri';

@Injectable({ register: 'onUse' })
export class ReportArchiveService implements OnAppInit {
    async onAppInit(): Promise<void> {
        await this.openArchive();
    }

    async openArchive(): Promise<void> {}
}

const app: ZibriApplication = new ZibriApplication({
    name: 'invoices',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    defaultAuth: 'public',
    controllers: [],
    websocketControllers: [],
    additionalLifecycleServices: [ReportArchiveService]
});
```

Injecting one that the application did not name, once a phase whose hook it declares has finished,
raises a `MissedLifecycleHooksError` rather than handing back a service that was never prepared. That
includes being reached from inside a later hook while the application comes up:

```
MissedLifecycleHooksError: "ReportArchiveService" declares a lifecycle hook and is being built for the first time now,
after the phases it asked to take part in have passed - so those hooks are not going to run.
The application initializes whatever declares a hook, and this class reached none of that:
it is registered on first use, or the token it is provided under was given to something else.
Name it in the application's additionalLifecycleServices to have it built at startup.
It was declared in /srv/api/src/services/report-archive.service.ts.
```

A class with no lifecycle hook is unaffected: there is nothing for it to have missed, so it is built
the moment it is asked for.

## When resolution fails

**A class is resolvable from the moment it is decorated.** `@Injectable` records the class globally,
and the container consults that record whenever it is asked for something it does not already hold —
so a class in a module that is loaded on demand, long after the application started, resolves like
any other.

**A constructor parameter can be resolved by its type only when that type is a class.** The
container reads parameter types from the metadata TypeScript emits, and that metadata keeps a class
and loses everything else — an interface, a union, a generic parameter and a primitive all arrive as
`Object`, as does a class that two modules import from each other, because it is not defined yet at
the point the decorator runs:

```
UninjectableParameterError: Parameter 0 of "ReportService" cannot be injected, because its type was recorded as "Object".
TypeScript writes down a built-in like that for anything that is not a class - an interface,
a union, a generic parameter, a primitive - and also for a class that is not defined yet
because two modules import each other.
Decorate the parameter with @Inject(token) to say what to resolve,
or break the import cycle if it is a class you expected to be injected.
It was declared in /srv/api/src/services/report.service.ts.
```

Name the token instead, and the type stops mattering:

```ts
@Injectable()
export class TokenInjectingReportService {
    constructor(
        @Inject(REPORT_STORAGE)
        private readonly storage: ReportStorage
    ) {}
}
```

The same error, saying `nothing was recorded about its type`, means there is no metadata to read at
all. Injection by declared type reads what `emitDecoratorMetadata` writes down, so it is available
wherever that option is on — `tsc` and SWC both offer it, and naming the token is how a build made
with esbuild, Vite or Bun says the same thing. See
[build toolchains](./getting-started.md#build-toolchains).

**Two things that need each other while being built cannot be built.** The container caches an
instance only once its provider has returned, so a token asked for again while it is still being
constructed has no answer:

```
CircularDependencyError: Circular dependency: InvoiceService -> PdfService -> InvoiceService.
Each of these is being constructed while the next one is asked for, so none of them can finish.
```

The way out is in the message: move one of the two injections out of construction. A method that
calls `inject()` runs after both instances exist, so the cycle never forms:

```ts
@Injectable()
export class InvoiceService {
    // not in the constructor, because PdfService asks for this one back
    private get pdfService(): PdfService {
        return inject(PdfService);
    }
}
```

## One copy per process

The container, the record of what is injectable and the classes everything is built out of all
belong to the copy of `zibri` they were loaded from, so an application runs on exactly one copy.
Starting up checks that:

```
DuplicateFrameworkCopyError: 2 copies of zibri are loaded in this process.
Each one has its own container, its own record of what is injectable and its own classes,
so an injectable registered through one is invisible to the other, and an instanceof check
across them says no about a value that is exactly what it claims to be.
Run "npm ls zibri" to see which packages pulled in more than one of it.
A package built on top of zibri should list it under "peerDependencies" rather than
"dependencies", so that it uses the copy the application already has.
```

`npm ls zibri` names the packages that asked for it, and the fix is in whichever of them installed
its own. A library that builds on the framework — a plugin, a shared set of injectables, a set of
entities — belongs on the application's copy, which is what a peer dependency says:

```json
{
    "peerDependencies": {
        "zibri": "^3.0.0"
    }
}
```

## See also
- [Error handling](./error-handling.md) — overriding the `GlobalErrorHandler` via `ZIBRI_DI_TOKENS.GLOBAL_ERROR_HANDLER`
- [Request context](./request-context.md) — resolving request-scoped injectables