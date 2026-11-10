---
keywords: [newsletter, mailing list, subscribers, unsubscribe, campaigns]
---

# Running mailing lists
`ZibriMailingListPlugin` manages mailing lists: subscribing, confirming subscriptions, unsubscribing and managing preferences.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriMailingListPlugin` | class | The plugin for managing mailing lists |
| `MailingListController` | class | The routes of the mailing lists, below the path of your controller extending it |
| `ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [configuring the plugin](#configuring-the-plugin) |
| `MailingListServiceInterface`, `MailingListService` | interface, class | Subscribes, confirms, unsubscribes, deletes a list and queues the emails to a list. Replaceable through `ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.MAILING_LIST_SERVICE` |
| `MailingListQueueEmailData`, `MailingListSubscriberCreateData` | type, class | What an email to a list is queued with, and what a new subscriber is created with |
| `UpdateMailingListPreferences` | class | The lists a subscriber chooses on the preferences page |
| `MailingList`, `MailingListSubscriber`, `MailingListSubscriptionConfirmationToken` | entity | A mailing list, a subscriber to one or more lists, and the token that confirms a subscription. Stored by `ZibriMailingListPlugin` |
| `MailingListBaseEmailTemplate`, `MailingListBaseEmailTemplateProps`, `MailingListTemplateData` | type, type, type | The frame of every email to a list, its props, and the data about the list it is given |
| `MailingListSubscribeConfirmationEmailTemplate`, `MailingListSubscribeConfirmationEmailTemplateProps` | type, type | The email that asks a subscriber to confirm, and its props |
| `MailingListPreferencesPageTemplate`, `MailingListPreferencesPageTemplateProps` | type, type | The page where a subscriber manages their lists, and its props |
| `MailingListUnsubscribeConfirmationPageTemplate`, `MailingListUnsubscribeConfirmationPageTemplateProps` | type, type | The page an unsubscribe link opens, asking to confirm and then saying it is done, and its props |
| `MailingListSubscribeSuccessPageTemplate`, `MailingListSubscribeSuccessPageTemplateProps` | type, type | What a subscriber sees after confirming, and its props |

## Setting it up
Add `new ZibriMailingListPlugin()` to the `plugins` of your application, see [registering a plugin](../application/plugin.md#registering-a-plugin), and `MailingList`, `MailingListSubscriber` and `MailingListSubscriptionConfirmationToken` to the `entities` of your data source.

You provide the email and page templates it uses, such as `SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE` and `PREFERENCES_PAGE_TEMPLATE`, through the `ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS` tokens, see [configuring the plugin](#configuring-the-plugin).

Extend `MailingListController` with a `@Controller` of your own, at the path you choose:

```ts
// src/controllers/mailing-list.controller.ts
import { Controller, MailingListController } from 'zibri';

@Controller('/mailing-lists', { versions: 'all' })
export class AppMailingListController extends MailingListController {}
```

Add it to the `controllers` of your application:

```ts
// src/application-options.base.ts
import { OmitStrict, ZibriApplicationOptions, ZibriMailingListPlugin } from 'zibri';

import { AppMailingListController } from './controllers/mailing-list.controller';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Task Tracker',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    plugins: [new ZibriMailingListPlugin()],
    controllers: [AppMailingListController],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never'
};
```

The links in the emails point at the path of your controller, below the `baseUrl` of the application, unless your [frontend shows the pages](#showing-the-pages-in-your-frontend). The routes are public whatever `defaultAuth` says, as a subscriber follows a link without logging in.

Each [tenant](../data/tenancy.md) has its own mailing lists and subscribers. The links in the emails, such as the one to unsubscribe, name the tenant through [`resolveTenantUrl`](../data/tenancy.md#the-tenant-of-a-request), so following one opens the page in that tenant. The base email template gets them as `unsubscribeLink` and `managePreferencesLink`.

## Confirming a subscription
Every subscription is confirmed through the link of a confirmation email, including one of an address that is already on other lists. An address already on the list gets no email. The link subscribes to the list it names, once, until it expires after `CONFIRMATION_TOKEN_EXPIRES_IN_MS` (a day by default). Followed again, it shows the success page while the address is still on the list, and answers `401` once it left the list or the link expired. Expired confirmations are deleted every hour.

## Unsubscribing
The links to unsubscribe and to manage preferences carry the subscriber's id and their `secret`, which is generated when the subscriber is created and stored encrypted. A link with any other secret answers `401`. Writing a new `secret` ends every link sent before.

An unsubscribe link opens the `UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE` with `unsubscribed: false`: render a form posting to `unsubscribeUrl`. The post unsubscribes and renders the page again with `unsubscribed: true`. Every mail to a list carries the [one-click unsubscribe headers](../templates/email.md#sending-through-something-other-than-smtp), whose post unsubscribes the same way.

An address is kept only while it is on a list. Leaving its last list deletes the subscriber: by unsubscribing, by choosing no list on the preferences page, or with the list itself. Delete a list with `deleteList` of the mailing list service, which deletes the subscribers it was the last list of. Once a subscriber is deleted, the links of the mails sent to them answer `401`.

## Showing the pages in your frontend
Set `PAGES_URL` to where your frontend shows the pages, such as `https://app.example.com/newsletter`. The links to confirm a subscription, to unsubscribe and to manage preferences then point below it, with the paths of the routes of `MailingListController`:

| Link | Path below `PAGES_URL` |
|---|---|
| Confirming a subscription | `/<listId>/subscribe/<token>` |
| Unsubscribing | `/<listId>/unsubscribe?subscriberId=…&secret=…` |
| Managing preferences | `/preferences?subscriberId=…&secret=…` |

Your frontend reads the list id, the token, `subscriberId` and `secret` from the link, and calls routes of your application that pass them to the mailing list service, such as `confirmSubscription` and `resolveSubscriberOfLink`.

The [one-click unsubscribe](../templates/email.md#sending-through-something-other-than-smtp) of every mail stays at your controller, as a mailbox provider posts to it. Keep `AppMailingListController` registered for it.

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
| [`PAGES_URL`](#showing-the-pages-in-your-frontend) | `string` | Where the pages the links of the emails open are. The path of your controller by default |
| `MAILING_LIST_SERVICE` | `MailingListServiceInterface` | Subscribes, confirms and unsubscribes. `MailingListService` by default |

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `MailingList`, `MailingListSubscriber`, `MailingListSubscriptionConfirmationToken` | The plugin is registered |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Plugins](../application/plugin.md) — registering a plugin, and writing your own
- [Email](../templates/email.md) — the queue every mail to a list goes through
- [The generated project](../application/project-layout.md#adding-and-removing-a-feature) — the templates `zi new` writes with `mailingList`, and adding or removing them
