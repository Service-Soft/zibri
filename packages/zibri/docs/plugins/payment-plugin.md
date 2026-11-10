---
keywords: [payments, pay, checkout, paypal, payment provider]
---

# Taking payments
`ZibriPaymentPlugin` handles payments through the payment providers, such as `PayPalPaymentProvider`, and payment methods you configure.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriPaymentPlugin` | class | The plugin for handling payments |
| `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [configuring the plugin](#configuring-the-plugin) |
| `PaymentPluginOptionsInput`, `PaymentPluginOptions` | type, type | Your payment methods, your payment providers and which provider takes which method, via `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT`. Required |
| `PaymentServiceInterface`, `PaymentService` | interface, class | Takes the steps of a payment. Replaceable through `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.PAYMENT_SERVICE` |
| `Payment` | entity | A payment made through a payment provider. Stored by `ZibriPaymentPlugin` |
| `PaymentStatus` | enum | Where a payment stands: `CREATED`, `RESERVED`, `PAID`, `CANCELLED`, `REFUNDED` or `FAILED` |
| `KnownPaymentMethod`, `PaymentMethod` | enum, type | A payment method, one of the known ones such as `PAY_PAL` and `CREDIT_CARD`, or a name of your own |
| `PaymentDataForMethod`, `ValidatedPaymentDataForMethod`, `PaymentForMethod`, `PaymentReservationForMethod` | type, type, type, type | The data a payment of a method is made with, that data once validated, and the payment and reservation it results in, typed by the provider of the method |
| `AllowedReservationMethods`, `AllowedCancellationMethods`, `AllowedRefundMethods` | type, type, type | The configured methods whose provider can reserve, cancel or refund a payment |
| `MethodsCoveredByProviders` | type | The methods your providers take between them. Every method of a `PaymentServiceInterface` is one of them |
| `PaymentProviderInterface`, `AnyPaymentProviderInterface`, `DefaultPaymentProviderArray` | interface, interface, type | What a payment provider implements, and the loosely typed provider and provider list the plugin tokens hold |
| `PayPalPaymentProvider`, `PayPalPaymentProviderOptions`, `PayPalEnv` | class, type, type | Takes payments through the PayPal API, built with a client id, a client secret and the `sandbox` or `live` environment |
| `PayPalPaymentData`, `PayPalValidatedPaymentData`, `PayPalPaymentProviderPaymentData` | class, type, type | The data a PayPal payment is made with, that data once validated, and what the provider keeps on the payment |
| `PaymentReconciliationCronJob` | cron job | Asks the providers every hour what became of payments nobody confirmed, see [abandoned payments](#settling-abandoned-payments). Registered for you |

## Setting it up
Add `new ZibriPaymentPlugin()` to the `plugins` of your application, see [registering a plugin](../application/plugin.md#registering-a-plugin), and `Payment` to the `entities` of your data source.

You provide your payment methods and providers through `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT`. It is required. Each method can go through a provider of its own, such as PayPal payments through `PayPalPaymentProvider` and card payments through another provider. The data, the payment and the steps of a method are typed by the provider that supports it. When several of your providers support a method, they are typed by all of them. The providers are the same for every tenant, and each payment belongs to the [tenant](../data/tenancy.md) it is made in: a `transactionId` is unique among the payments of its tenant.

## Taking the steps of a payment
A step of a payment, such as confirming, collecting, canceling or refunding, is decided by the payment as it is stored, one step of a payment at a time across every instance, and the payment you pass is updated with the result. A step the stored status does not allow answers `409`, and so does a `transactionId` that is already used; payment data that is not valid answers `400`. `FAILED` means the provider declined.

## Stating an amount
The `amount` of a payment is a `BigNumber`, which holds it exactly, and travels through json as a string. It has at most as many decimals as its currency: an amount for `PayPalPaymentProvider` in `HUF`, `JPY` or `TWD` has none, in any other currency two. One with more answers `400`. Every call that moves money carries an idempotency key, so you can repeat the step.

## Settling abandoned payments
A buyer who leaves the checkout leaves a payment at `CREATED`. Once its provider's `approvalWindowInMs` has passed, `PaymentReconciliationCronJob` asks the provider what became of it and records the answer:

| The provider says | The payment becomes |
|---|---|
| The money was captured | `PAID` |
| The money is held | `RESERVED` |
| The capture was declined | `FAILED` |
| The money is still moving | `CREATED`, asked again on the next pass |
| Nothing moved | `CANCELLED` |

A cancelled payment keeps its `transactionId`. A new checkout attempt sends a new one.

`PayPalPaymentProvider` gives its buyers one day to approve. Set `approvalWindowInMs` in `PayPalPaymentProviderOptions` for another window. A provider of your own implements `approvalWindowInMs` and `reconcilePayment`.

A payment the provider cannot be asked about stays as it is, and the job's run is recorded as failed, see [when a tick throws](../background-work/cron.md#when-a-tick-throws).

## Configuring the plugin
The tokens of `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS`. The plugin checks at startup that the required ones are provided.

| Token | Type | What it is |
|---|---|---|
| [`OPTIONS_INPUT`](#setting-it-up) | `PaymentPluginOptionsInput` | Your payment methods and payment providers. Required |
| `OPTIONS` | `PaymentPluginOptions` | `OPTIONS_INPUT` as it is in effect. Read, not provided |
| `PAYMENT_SERVICE` | `PaymentServiceInterface` | Takes the steps of a payment. `PaymentService` by default |

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `Payment` | The plugin is registered |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Plugins](../application/plugin.md) — registering a plugin, and writing your own
- [Tenancy](../data/tenancy.md) — the tenant a payment belongs to
