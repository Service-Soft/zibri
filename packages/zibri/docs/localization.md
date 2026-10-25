# Localization
Translations are XLIFF files, the XML format translation tools read and write. Before every build,
each string your code marks for translation, tsx templates included, is written to
`src/translations/source.xlf`, which you commit. You provide a file for each other locale, such as
`de.xlf`, in the same folder.

The localize service [formats](#formatting) dates, prices and percentages for a locale, and orders
text.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `$t` | function | Marks a string for translation, returning a `TranslationToken` |
| `$ts` | function | Marks a string for translation and resolves it immediately using the automatically resolved locale |
| `TranslationToken` | class | Represents a marked string; use `.getValue(locale)` to translate it |
| `TranslatedString` | type | A string that is translated already, as `$ts` and `getValue` return it |
| `defineDateFormat` | function | Defines a date/time/date-time format for a supported locale |
| `ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT` | DI token | Configures supported locales, default locale and locale resolution |
| `ZIBRI_DI_TOKENS.LOCALIZE_SERVICE` | DI token | Injects `LocalizeServiceInterface` |
| `LocalizeServiceInterface` | interface | Contract for `formatPrice`, `getCurrencyMinorUnits`, `formatPercent` and `formatDate` |
| `LocaleCode` | type | Type of a supported locale code (such as `'en-US'`, `'de'`) |
| `Timezone` | type | Type of an IANA time zone name (such as `'UTC'`, `'Europe/Berlin'`) |

## Marking strings for translation
To mark a string for translation you can use `$t`:

```ts
// src/services/task-label.service.ts
import { $t, TranslationToken } from 'zibri';

const taskCreated: TranslationToken = $t`Task created`;
const englishTaskCreated: string = taskCreated.getValue('en-US');
const germanTaskCreated: string = taskCreated.getValue('de');
```

Or `$ts` if you want to translate them directly using the [automatically resolved locale](#resolving-the-locale-of-a-request):

```ts
// src/services/task-label.service.ts
import { $ts } from 'zibri';

const taskCreatedForThisRequest: string = $ts`Task created`;
```

## Adding parameters to a string

Template parameters are supported and automatically named from the expression they contain:

```ts
// src/services/greeting.service.ts
import { $t, TranslationToken } from 'zibri';

import { user } from './user';

const greeting: TranslationToken = $t`Hello ${user.firstName} ${user.lastName}`;
// source → 'Hello {user.firstName} {user.lastName}'
```

For complex expressions, the full expression text is used as the placeholder name:

```ts
// src/services/order-summary.service.ts
import { $t, TranslationToken } from 'zibri';

import { formatPrice } from './format-price';
import { order } from './order';

const total: TranslationToken = $t`Total: ${formatPrice(order.total)} for ${order.items.length} items`;
// source → 'Total: {formatPrice(order.total)} for {order.items.length} items'
```

In your translation files, placeholders can be freely reordered to suit the target language:

```xml
<!-- de.xlf -->
<trans-unit id="Hello {user.firstName} {user.lastName}" xml:space="preserve">
    <source>Hello <x id="user.firstName" equiv-text="{user.firstName}"/> <x id="user.lastName" equiv-text="{user.lastName}"/></source>
    <target>Hallo {user.lastName} {user.firstName}</target>
</trans-unit>
```

## Configuring supported locales
The locales you support are listed in `ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT`:

```ts
// src/providers.ts
import { defineDateFormat, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

// ...
    defineProvider({
        token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
        useValue: {
            supportedLocales: {
                'en-US': {
                    currencyCode: 'USD',
                    defaultDateFormat: defineDateFormat('MM/DD/YYYY'),
                    defaultDateTimeFormat: defineDateFormat('MM/DD/YYYY h:mm A'),
                    defaultTimeFormat: defineDateFormat('h:mm A')
                },
                de: {
                    currencyCode: 'EUR',
                    defaultDateFormat: defineDateFormat('DD.MM.YYYY'),
                    defaultDateTimeFormat: defineDateFormat('DD.MM.YYYY HH:mm'),
                    defaultTimeFormat: defineDateFormat('HH:mm')
                }
            }
        }
    })
// ...
```

Each locale names its currency and its default date, date-time and time formats. `defaultLocale`
names the locale used by default, `'en-US'` unless you set it.

## Providing translations

Once the `source.xlf` has been generated, copy it and rename it to the target locale (such as `de.xlf`).
Add a `target-language` attribute to the `<file>` element and fill in `<target>` for each `<trans-unit>`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xliff version="1.2" xmlns="urn:oasis:names:tc:xliff:document:1.2">
    <file source-language="en-US" target-language="de" datatype="plaintext" original="project">
        <body>
            <trans-unit id="Monday" xml:space="preserve">
                <source>Monday</source>
                <target>Montag</target>
            </trans-unit>
            <trans-unit id="Hello {user.firstName} {user.lastName}" xml:space="preserve">
                <source>Hello <x id="user.firstName" equiv-text="{user.firstName}"/> <x id="user.lastName" equiv-text="{user.lastName}"/></source>
                <target>Hallo {user.lastName} {user.firstName}</target>
            </trans-unit>
        </body>
    </file>
</xliff>
```

A translation file is `src/translations/<locale>.xlf`. On startup, a warning names every
`<trans-unit>` of `source.xlf` that has no `<target>` in a locale's file.

The `<source>` element and `<note>` are informational. Only the `<target>` is read at runtime.
Standard XLIFF editors open these files directly.

An application whose `translations` folder holds no `source.xlf` serves every string as it is written
in the code, and logs a warning saying so on startup.

Point the folder translations are read from somewhere else with the `TRANSLATIONS_PATH` token:

```ts
// src/providers.ts
import { defineProvider, FsUtilities, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.TRANSLATIONS_PATH,
    useFactory: () => FsUtilities.getPath('/var/lib/my-app/translations')
})
```

## Resolving the locale of a request
The locale of a request is resolved from, in this order:
1. the `'locale'` query parameter, named by `localeQueryParam` of `ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT`
2. the `'accept-language'` header
3. the `defaultLocale` of `ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT`

A requested locale resolves to a supported locale of the same language. With `'en-US'` supported, a
request for `'en'` or `'en-GB'` resolves to `'en-US'`. `TranslationToken.getValue` resolves the locale
it is given the same way.

`formatPrice` and `formatDate` take the locale you pass them as it is written. Pass a supported locale,
or the locale of the request.

## Formatting
The localize service formats dates, prices and percentages. Inject it with
`ZIBRI_DI_TOKENS.LOCALIZE_SERVICE` and call `formatPrice`, `formatPercent` or `formatDate`:

```ts
// src/services/report.service.ts
import { Inject, LocaleCode, LocalizeServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';

class ReportService {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE)
        private localizeService: LocalizeServiceInterface
    ) {}

    formatValues(locale: LocaleCode): void {
        // Format a price using the locale's configured currency
        this.localizeService.formatPrice(19.99, { locale });
        // en-US → '$19.99'
        // de    → '19,99 €'

        // How many decimals an amount in a currency has, which a price is formatted with
        this.localizeService.getCurrencyMinorUnits('JPY');
        // → 0

        // Format a percentage
        this.localizeService.formatPercent(0.856, { locale });
        // en-US → '85.6%'
        // de    → '85,6 %'

        // Format a date using the locale's default date format
        this.localizeService.formatDate(new Date(), 'date', { locale });
        // en-US → '06/13/2026'
        // de    → '13.06.2026'

        // Format a date using the locale's default time format
        this.localizeService.formatDate(new Date(), 'time', { locale });
        // en-US → '3:45 AM'
        // de    → '15:45 Uhr'

        // Format a date using the locale's default date-time format
        this.localizeService.formatDate(new Date(), 'date-time', { locale });
        // en-US → '06/13/2026 3:45 AM'
        // de    → '13.06.2026 15:45 Uhr'

        // Or with a specific format, overriding the locale default
        this.localizeService.formatDate(new Date(), 'YYYY', { locale });
        // → '2026'
    }
}
```

## Which zone a date is read in
A `Date` is an instant. A time zone says which calendar day and hour that instant falls on: the same moment is `2024-01-01 02:30` in UTC and `2023-12-31 21:30` in New York.

`formatDate` reads the instant in the `defaultTimezone` of the localize options, which is `'UTC'`:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
    useValue: { defaultTimezone: 'Europe/Berlin' }
})
```

The default ignores the zone of the machine, so one instant reads the same wherever the code runs.

State a zone per call to override it. The first call below reads the instant in the default zone, the
second in the customer's own zone, for something addressed to them:

```ts
// src/services/order-date.service.ts
import { LocaleCode, LocalizeServiceInterface } from 'zibri';

import { customer } from './customer';
import { order } from './order';

export function formatPaidAt(localizeService: LocalizeServiceInterface, locale: LocaleCode): void {
    localizeService.formatDate(order.paidAt, 'date-time', { locale });
    localizeService.formatDate(order.paidAt, 'date-time', { locale, timezone: customer.timezone });
}
```

`Timezone` is a union of the IANA zone names, so a typo is a compile error.

The zone is a formatting argument, like the locale. One instant can read as the customer's local time in an email, and as the issuer's time on a document.

## Which order text is in
Languages order text differently: Swedish sorts `ä` after `z`, where German sorts it with `a`. Text is ordered by the rules of `defaultLocale`, on every data source. An `order`, a page of a keyset walk and an `after` filter agree wherever they run. Text is ordered alphabetically: `alpha` comes before `Bravo`.

> [!NOTE]
> Text has one order for the whole application. A request in another locale gets the same order.

An application whose supported locales order text differently sets `textOrder` to `'defaultLocale'`,
which serves every supported locale and orders text by the rules of the default one. See
[why some options have no default](./faq.md#why-do-some-options-have-no-default):

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
    useValue: { defaultLocale: 'de-DE', textOrder: 'defaultLocale' }
})
```

`compareText` orders text the same way, for text you sort yourself:

```ts
// src/services/task-title.service.ts
import { LocalizeServiceInterface } from 'zibri';

export function sortTitles(localizeService: LocalizeServiceInterface, titles: string[]): string[] {
    return [...titles].sort((a, b) => localizeService.compareText(a, b));
}
```

## Requirements
| Package | Used for |
|---|---|
| `typescript` | Finding the strings marked for translation when `source.xlf` is written. You install it |

## See also
- [Request context](./request-context.md) — reading the resolved locale (`CURRENT_LOCALE`) from the current request
- [Templating](./templating.md) — the `$t`/`$ts`/`$f` hooks available in tsx components
- [Cron](./cron.md) — `defaultTimezone` as the zone a schedule is read in
- [Data source](./data-source.md) — ordering and filtering the text that order applies to
