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
| `ZIBRI_INVOICING_PLUGIN_DI_TOKENS` | DI tokens | Configuration tokens for `ZibriInvoicingPlugin` (eg. `COMPANY_INFO_SERVICE`, `OPTIONS_INPUT`) |
| `CompanyInfoServiceInterface`, `CompanyInfo` | type | What the service under `COMPANY_INFO_SERVICE` answers: the company a tenant issues its invoices as |
| `ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS` | DI tokens | Configuration tokens for `ZibriMailingListPlugin` (eg. email/page templates) |
| `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS` | DI tokens | Configuration tokens for `ZibriPaymentPlugin` (eg. `OPTIONS_INPUT`) |

## Usage
### Registering a plugin
Plugins are listed in the `plugins` option your application is built from:

```ts
// src/application-options.base.ts
import { MailingListController, OmitStrict, ZibriApplicationOptions, ZibriInvoicingPlugin, ZibriMailingListPlugin } from 'zibri';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'My Api',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    plugins: [new ZibriInvoicingPlugin(), new ZibriMailingListPlugin()],
    controllers: [],
    websocketControllers: [],
    defaultAuth: 'public'
};
```

Any providers, controllers, cron jobs, body parsers and auth strategies contributed by a plugin are automatically merged into your application.
<br>
Some plugins also require you to provide configuration or additional controllers yourself, take a look at the built-in plugins below for details.

### Built-in plugins
#### ZibriInvoicingPlugin
Adds support for generating invoices, including invoice numbering, tax calculation and PDF rendering (with EN16931/XRechnung/Peppol conformance).
<br>
Each [tenant](./tenancy.md) issues its own invoices: an invoice belongs to the tenant it is created in, and each tenant numbers its invoices on its own. Tell the plugin which company a tenant issues them as, with its address, tax number, bank details and logo, through a service under `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE`. An application using the plugin without one does not start:

```ts
// src/services/company-info.service.ts
import { CompanyInfo, CompanyInfoServiceInterface, inject, Repository, repositoryTokenFor } from 'zibri';

import { TenantSettings } from '../models/tenant-settings.model';

export class CompanyInfoService implements CompanyInfoServiceInterface {
    async resolveCompanyInfo(tenantId: string): Promise<CompanyInfo> {
        const settings: Repository<TenantSettings> = inject(repositoryTokenFor(TenantSettings));
        return (await settings.findOne({ where: { tenantId }, acrossTenants: true })).companyInfo;
    }
}
```

```ts
// src/providers.ts
import { defineProvider, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE, useClass: CompanyInfoService });
```

The pdf and the electronic invoice of an invoice name the company of the invoice's own tenant. Labels, font sizes and the numbering format are the same for every tenant, and go into `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT`.

#### ZibriMailingListPlugin
Adds support for managing mailing lists, including subscribing, confirming subscriptions, unsubscribing and managing preferences.
<br>
Each [tenant](./tenancy.md) has its own mailing lists and subscribers. The links in the emails, such as the one to unsubscribe, name the tenant through [`resolveTenantUrl`](./tenancy.md#the-tenant-of-a-request), so following one opens the page in that tenant. The base email template gets them as `unsubscribeLink` and `managePreferencesLink`.
<br>
It requires you to provide the email/page templates it uses (eg. `SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE`, `PREFERENCES_PAGE_TEMPLATE`) via the `ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS` tokens.
<br>
Unlike the other built-in plugins it does not register its own controller, so you need to add the `MailingListController` to your application's `controllers` yourself:

```ts
// src/application-options.base.ts
export const withMailingList: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    ...baseApplicationOptions,
    plugins: [new ZibriMailingListPlugin()],
    controllers: [...baseApplicationOptions.controllers, MailingListController]
};
```

#### ZibriPaymentPlugin
Adds support for handling payments via configurable payment providers (eg. `PayPalPaymentProvider`) and payment methods.
<br>
It requires you to provide your payment methods and providers via `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT`, as there is no sensible default for it. The providers are the same for every tenant, and each payment belongs to the [tenant](./tenancy.md) it is made in: a `transactionId` is unique among the payments of its tenant.

A step of a payment - confirming, collecting, cancelling, refunding - is decided by the payment as it is stored, one step of a payment at a time across every instance, and the payment you pass is updated with the result. A step the stored status does not allow answers `409`, and so does a `transactionId` that is already used; payment data that is not valid answers `400`. `FAILED` means the provider declined. Every call that moves money carries an idempotency key, so you can repeat the step.

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
