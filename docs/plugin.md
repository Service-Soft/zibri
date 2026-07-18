# Plugin
Plugins are a way to bundle providers, controllers, cron jobs, body parsers and auth strategies so that they can be reused across projects.
<br>
Zibri ships with a few built-in plugins for common concerns (invoicing, mailing lists, payments), but you can also write your own.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriPlugin` | class | Abstract base class a custom plugin extends |
| `ZibriInvoicingPlugin` | class | Built-in plugin for invoice numbering, tax calculation and PDF rendering |
| `ZibriMailingListPlugin` | class | Built-in plugin for managing mailing lists |
| `ZibriPaymentPlugin` | class | Built-in plugin for handling payments |
| `MailingListController` | class | Controller for the mailing list plugin, must be registered manually |
| `ZIBRI_INVOICING_PLUGIN_DI_TOKENS` | DI tokens | Configuration tokens for `ZibriInvoicingPlugin` (eg. `OPTIONS_INPUT`) |
| `ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS` | DI tokens | Configuration tokens for `ZibriMailingListPlugin` (eg. email/page templates) |
| `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS` | DI tokens | Configuration tokens for `ZibriPaymentPlugin` (eg. `OPTIONS_INPUT`) |

## Usage
### Registering a plugin
Plugins are passed to the `plugins` option of the `ZibriApplication`:

```ts
import { ZibriApplication, ZibriInvoicingPlugin, ZibriMailingListPlugin } from 'zibri';

const app: ZibriApplication = new ZibriApplication({
    name: 'My Api',
    baseUrl: 'http://localhost:3000',
    plugins: [new ZibriInvoicingPlugin(), new ZibriMailingListPlugin()],
    //...
});
```

Any providers, controllers, cron jobs, body parsers and auth strategies contributed by a plugin are automatically merged into your application.
<br>
Some plugins also require you to provide configuration or additional controllers yourself, take a look at the built-in plugins below for details.

### Built-in plugins
#### ZibriInvoicingPlugin
Adds support for generating invoices, including invoice numbering, tax calculation and PDF rendering (with EN16931/XRechnung/Peppol conformance).
<br>
It requires you to provide company information via the `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT` token, as there is no sensible default for it:

```ts
import { defineProvider, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
    useFactory: () => ({
        companyInfo: {
            address: { street: '', number: '', postcode: '', city: '', countryId: '' },
            name: '',
            fullName: '',
            email: '',
            phone: ''
        }
    })
});
```

#### ZibriMailingListPlugin
Adds support for managing mailing lists, including subscribing, confirming subscriptions, unsubscribing and managing preferences.
<br>
It requires you to provide the email/page templates it uses (eg. `SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE`, `PREFERENCES_PAGE_TEMPLATE`) via the `ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS` tokens.
<br>
Unlike the other built-in plugins it does not register its own controller, so you need to add the `MailingListController` to your application's `controllers` yourself:

```ts
import { MailingListController, ZibriApplication, ZibriMailingListPlugin } from 'zibri';

const app: ZibriApplication = new ZibriApplication({
    //...
    plugins: [new ZibriMailingListPlugin()],
    controllers: [MailingListController]
});
```

#### ZibriPaymentPlugin
Adds support for handling payments via configurable payment providers (eg. `PayPalPaymentProvider`) and payment methods.
<br>
Just like the invoicing plugin, it requires you to provide your payment methods and providers via `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT`, as there is no sensible default for it.

### Writing a custom plugin
A custom plugin extends the abstract `ZibriPlugin` class:

```ts
import { CronJob, DiProvider, Newable, ZibriApplication, ZibriPlugin } from 'zibri';

export class MyPlugin extends ZibriPlugin {

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
        // Check that everything the plugin needs is available, eg. that required entities are registered.
    }
}
```

It exposes the following properties which get merged into your application on startup:
- `providers`: The DI providers to register/override.
- `controllers`: The controllers to register in the app.
- `cronJobs`: The cron jobs to register in the app.
- `bodyParsers`: The body parsers to register. If nothing is provided, the Zibri default parsers will be used.
- `authStrategies`: The auth strategies to register. If nothing is provided, the Zibri default jwt auth strategy will be used.

The abstract `validate` method is called once, at the very end of application initialization, after all providers, controllers and websocket controllers have already been registered and injected.
<br>
This is the place to check that everything the plugin needs is actually available, eg. that required entities are registered on a data source, or that required tokens have been provided.

## Configuration
If your plugin needs configuration that has no sensible default, it is common to define an `OPTIONS_INPUT` token whose default provider throws an error, forcing the app to supply it via its own `providers` array, and an `OPTIONS` token that derives the effective options from `OPTIONS_INPUT` plus defaults. Take a look at the built-in plugins for an example of this pattern.

## See also
- [Application lifecycle](./application-lifecycle.md) — the `validate` hook runs at the very end of application initialization, alongside other lifecycle hooks
- [Data source](./data-source.md) — `validate` is commonly used to check that entities a plugin needs are registered on a data source
