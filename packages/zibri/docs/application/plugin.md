---
keywords: [plugins, extension, extend, module, writing a plugin]
---

# Plugin
A plugin bundles what an application is built from, such as providers, controllers, websocket controllers, data sources and [auth strategies](../glossary.md#auth-strategy), so you can reuse them across projects. Built-in plugins cover invoicing, mailing lists and payments, and you can write your own.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriPlugin` | class | Abstract base class a custom plugin extends |
| `validateEntitiesRegistered` | function | Checks at boot that the entities a plugin stores rows in are declared by a data source |
| `validateTokensRegistered` | function | Checks at boot that every token of a `TokenRecord` has a provider |
| `optionalPeer`, `hasOptionalPeer` | function, function | Loads a peer dependency a feature needs, failing with the feature it was needed for, and checks whether one is installed without loading it |
| `optionalPeerDependency` | function | Loads a package a peer dependency brings with it, resolved through the packages between them |
| `resolveApplicationPackage` | function | Loads a package your plugin names nowhere and the application installs itself, failing with the feature it was needed for and the command that installs it |

## Registering a plugin
Plugins are listed in the `plugins` option your application is built from:

```ts
// src/application-options.base.ts
import { OmitStrict, ZibriApplicationOptions, ZibriInvoicingPlugin, ZibriMailingListPlugin } from 'zibri';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Task Tracker',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    plugins: [new ZibriInvoicingPlugin(), new ZibriMailingListPlugin()],
    controllers: [],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never'
};
```

Everything a plugin lists is merged into your application, see [writing a custom plugin](#writing-a-custom-plugin).

Some plugins need configuration or controllers from you. The page of each built-in plugin says which.

## Using a built-in plugin

| Plugin | Page |
|---|---|
| `ZibriInvoicingPlugin` | [Issuing invoices](../plugins/invoicing-plugin.md) |
| `ZibriMailingListPlugin` | [Running mailing lists](../plugins/mailing-list-plugin.md) |
| `ZibriPaymentPlugin` | [Taking payments](../plugins/payment-plugin.md) |

## Writing a custom plugin
A custom plugin extends the abstract `ZibriPlugin` class:

```ts
// src/plugins/task-reminders.plugin.ts
import { CronJob, DiProvider, Newable, ZibriApplication, ZibriPlugin } from 'zibri';

export class TaskRemindersPlugin extends ZibriPlugin {

    providers: DiProvider<unknown>[] = [
        //...
    ];

    controllers: Newable<unknown>[] = [
        //...
    ];

    cronJobs: Newable<CronJob>[] = [
        //...
    ];

    async validate(app: ZibriApplication): Promise<void> {
        // Check that everything the plugin needs is available, such as that required entities are registered.
    }
}
```

These properties are merged into your application on startup, each into the application option of the same name:
- `providers`: The DI providers to register or override.
- `controllers`: The controllers to register in the app.
- `websocketControllers`: The websocket controllers to register in the app.
- `dataSources`: The data sources to register, such as one holding the plugin's own entities.
- `cronJobs`: The cron jobs to register in the app.
- `bodyParsers`: The body parsers to register. Without them, the default parsers are used.
- `authStrategies`: The auth strategies to register. Without them, the default JWT auth strategy is used.
- `authenticators`: The [authenticators](../glossary.md#authenticator) to register. Without them, the default password authenticator is used.
- `twoFactorMethods`: The two-factor methods to register. Without them, the default one-time password method is used.
- `backupTransports`: The backup transports to register.
- `additionalLifecycleServices`: The services to build at startup for their lifecycle hooks.

`validate` is called once, at the end of application initialization, after every provider, controller and websocket controller is registered and injected. Check there that everything the plugin needs is available, such as that its entities are registered on a data source, or that its required tokens are provided.

## Configuration
For configuration without a default, define two tokens. An `OPTIONS_INPUT` token whose default provider throws, so the application has to provide it in its own `providers` array. And an `OPTIONS` token that merges `OPTIONS_INPUT` with the defaults. The built-in plugins follow this pattern.

## See also
- [Issuing invoices](../plugins/invoicing-plugin.md) — the invoicing plugin
- [Running mailing lists](../plugins/mailing-list-plugin.md) — the mailing list plugin
- [Taking payments](../plugins/payment-plugin.md) — the payment plugin
- [Application lifecycle](./application-lifecycle.md) — the `validate` hook runs at the very end of application initialization, alongside other lifecycle hooks
- [Data source](../data/data-source.md) — `validate` is commonly used to check that entities a plugin needs are registered on a data source
