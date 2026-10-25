# Running mailing lists
`ZibriMailingListPlugin` manages mailing lists: subscribing, confirming subscriptions, unsubscribing and managing preferences.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriMailingListPlugin` | class | The plugin for managing mailing lists |
| `MailingListController` | class | The routes of the mailing lists. Registered by you |
| `ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [configuring the plugin](#configuring-the-plugin) |
| `MailingList`, `MailingListSubscriber`, `MailingListSubscriptionConfirmationToken` | entity | A mailing list, a subscriber to one or more lists, and the token that confirms a subscription. Stored by `ZibriMailingListPlugin` |

## Setting it up
Add `new ZibriMailingListPlugin()` to the `plugins` of your application, see [registering a plugin](./plugin.md#registering-a-plugin), and `MailingList`, `MailingListSubscriber` and `MailingListSubscriptionConfirmationToken` to the `entities` of your data source.

You provide the email and page templates it uses, such as `SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE` and `PREFERENCES_PAGE_TEMPLATE`, through the `ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS` tokens, see [configuring the plugin](#configuring-the-plugin).

Add `MailingListController` to the `controllers` of your application yourself:

```ts
// src/application-options.base.ts
import { MailingListController, OmitStrict, ZibriApplicationOptions, ZibriMailingListPlugin } from 'zibri';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Task Tracker',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    plugins: [new ZibriMailingListPlugin()],
    controllers: [MailingListController],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never'
};
```

Each [tenant](./tenancy.md) has its own mailing lists and subscribers. The links in the emails, such as the one to unsubscribe, name the tenant through [`resolveTenantUrl`](./tenancy.md#the-tenant-of-a-request), so following one opens the page in that tenant. The base email template gets them as `unsubscribeLink` and `managePreferencesLink`.

## Confirming a subscription
Every subscription is confirmed through the link of a confirmation email, including one of an address that is already on other lists. An address already on the list gets no email. The link subscribes to the list it names, once, until it expires after `CONFIRMATION_TOKEN_EXPIRES_IN_MS` (a day by default). Followed again, it shows the success page while the address is still on the list, and answers `401` once it left the list or the link expired. Expired confirmations are deleted every hour.

## Unsubscribing
The links to unsubscribe and to manage preferences carry the subscriber's id and their `secret`, which is generated when the subscriber is created and stored encrypted. A link with any other secret answers `401`. Writing a new `secret` ends every link sent before.

An unsubscribe link opens the `UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE` with `unsubscribed: false`: render a form posting to `unsubscribeUrl`. The post unsubscribes and renders the page again with `unsubscribed: true`. Every mail to a list carries the [one-click unsubscribe headers](./email.md#sending-through-something-other-than-smtp), whose post unsubscribes the same way.

## Configuring the plugin
The tokens of `ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS`. The plugin checks at startup that the required ones are provided.

| Token | Type | What it is |
|---|---|---|
| [`SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE`](#setting-it-up) | `MailingListSubscribeConfirmationEmailTemplate` | The email that asks a subscriber to confirm. Required |
| `BASE_EMAIL_TEMPLATE` | `MailingListBaseEmailTemplate` | The frame of every email to a list. Required |
| [`PREFERENCES_PAGE_TEMPLATE`](#setting-it-up) | `MailingListPreferencesPageTemplate` | Where a subscriber manages their lists. Required by `MailingListController` |
| [`UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE`](#unsubscribing) | `MailingListUnsubscribeConfirmationPageTemplate` | Where a subscriber confirms unsubscribing. Required by `MailingListController` |
| `SUBSCRIBE_SUCCESS_PAGE_TEMPLATE` | `MailingListSubscribeSuccessPageTemplate` | What a subscriber sees after confirming. Required by `MailingListController` |
| [`CONFIRMATION_TOKEN_EXPIRES_IN_MS`](#confirming-a-subscription) | `number` | How long a confirmation link works. A day by default |
| `MAILING_LIST_SERVICE` | `MailingListServiceInterface` | Subscribes, confirms and unsubscribes. `MailingListService` by default |

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `MailingList`, `MailingListSubscriber`, `MailingListSubscriptionConfirmationToken` | The plugin is registered |

## See also
- [Plugins](./plugin.md) — registering a plugin, and writing your own
- [Email](./email.md) — the queue every mail to a list goes through
- [The generated project](./project-layout.md#adding-and-removing-a-feature) — the templates `zi new` writes with `mailingList`, and adding or removing them
