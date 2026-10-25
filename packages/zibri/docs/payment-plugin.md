# Taking payments
`ZibriPaymentPlugin` handles payments through the payment providers, such as `PayPalPaymentProvider`, and payment methods you configure.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriPaymentPlugin` | class | The plugin for handling payments |
| `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [configuring the plugin](#configuring-the-plugin) |
| `Payment` | entity | A payment made through a payment provider. Stored by `ZibriPaymentPlugin` |

## Setting it up
Add `new ZibriPaymentPlugin()` to the `plugins` of your application, see [registering a plugin](./plugin.md#registering-a-plugin), and `Payment` to the `entities` of your data source.

You provide your payment methods and providers through `ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.OPTIONS_INPUT`. It is required. The providers are the same for every tenant, and each payment belongs to the [tenant](./tenancy.md) it is made in: a `transactionId` is unique among the payments of its tenant.

## Taking the steps of a payment
A step of a payment, such as confirming, collecting, canceling or refunding, is decided by the payment as it is stored, one step of a payment at a time across every instance, and the payment you pass is updated with the result. A step the stored status does not allow answers `409`, and so does a `transactionId` that is already used; payment data that is not valid answers `400`. `FAILED` means the provider declined.

## Stating an amount
The `amount` of a payment is a `BigNumber`, which holds it exactly, and travels through json as a string. It has at most as many decimals as its currency: an amount for `PayPalPaymentProvider` in `HUF`, `JPY` or `TWD` has none, in any other currency two. One with more answers `400`. Every call that moves money carries an idempotency key, so you can repeat the step.

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

## See also
- [Plugins](./plugin.md) — registering a plugin, and writing your own
- [Tenancy](./tenancy.md) — the tenant a payment belongs to
