# Localization
Translations are XLIFF files, the XML format translation tools read and write. Before every build,
each string your code marks for translation, tsx templates included, is written to
`translations/source.xlf`, which you commit. You provide a file for each other locale, such as
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
| `generateSourceXlf`, `SourceTranslationOrigin` | function, type | Writes `translations/source.xlf` from the strings marked for translation in the origins you name. The build calls it for your project and Zibri |
| `ScannedTranslationOrigin`, `ShippedTranslationOrigin` | type, type | An origin as files to scan, and an origin as the `source.xlf` a library ships |
| `defineDateFormat` | function | Defines a date/time/date-time format for a supported locale |
| `dateFormatTokens`, `DateFormatToken` | constant, type | The tokens a date format is built from, such as `DD` and `YYYY` |
| `DateFormatString`, `DefinedDateFormatString` | type, type | A format string checked against the tokens, and the format `defineDateFormat` returns |
| `DateFormatShortcut` | type | The default formats of a locale by name: `'date'`, `'date-time'` and `'time'` |
| `ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT` | DI token | Configures supported locales, default locale and locale resolution |
| `LocalizeOptions`, `LocalizeOptionsInput`, `LocaleConfiguration` | type, type, type | The localize options in effect, the ones your application sets, and the currency and default formats of one locale |
| `ZIBRI_DI_TOKENS.LOCALIZE_SERVICE` | DI token | Injects `LocalizeServiceInterface` |
| `LocalizeServiceInterface` | interface | Contract for `formatPrice`, `getCurrencyMinorUnits`, `formatPercent` and `formatDate` |
| `LocalizeService` | class | The default `LocalizeServiceInterface`. Replaceable through ZIBRI_DI_TOKENS.LOCALIZE_SERVICE |
| `TEXT_COLLATOR_OPTIONS` | constant | The collator options text is ordered with, for ordering text in your own code the same way |
| `FormatPriceOptions`, `FormatDateOptions`, `FormatPercentOptions` | type, type, type | The currency, locale, format and time zone `formatPrice`, `formatDate` and `formatPercent` use |
| `LocaleCode` | type | Type of a supported locale code (such as `'en-US'`, `'de'`) |
| `resolveLocaleCode` | function | Finds the best match for a locale among the available ones |
| `currencyCodes`, `currencyCodeEnum`, `CurrencyCode` | constant, constant, type | The ISO 4217 currency codes as a list, as an enum shaped object for `@Property.string({ enum })`, and as a type |
| `Timezone` | type | Type of an IANA time zone name (such as `'UTC'`, `'Europe/Berlin'`) |
| `timezones` | constant | Every name `Timezone` allows, as a list |
| `Month`, `monthLabels`, `Weekday`, `weekdayLabels` | enum, constant, enum, constant | The months and weekdays as a JavaScript `Date` numbers them, and a translatable label for each |

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

An expression in the template is a placeholder, numbered by its position:

```ts
// src/services/greeting.service.ts
import { $t, TranslationToken } from 'zibri';

import { user } from './user';

const greeting: TranslationToken = $t`Hello ${user.firstName} ${user.lastName}`;
// source → 'Hello {$1} {$2}'
```

Name a placeholder by handing `$t` an object with one key:

```ts
// src/services/named-greeting.service.ts
import { $t, TranslationToken } from 'zibri';

import { user } from './user';

const namedGreeting: TranslationToken = $t`Hello ${{ firstName: user.firstName }} ${{ lastName: user.lastName }}`;
// source → 'Hello {firstName} {lastName}'
```

Write the object inline, as above. Building `source.xlf` reads the code without running it, so it
finds the name in an object written there and numbers every other placeholder. A variable holding an
object with one key is named when the code runs, and its translation is then never found.

In your translation files, placeholders can be freely reordered to suit the target language:

```xml
<!-- de.xlf -->
<trans-unit id="Hello {firstName} {lastName}" xml:space="preserve">
    <source>Hello <x id="firstName" equiv-text="{firstName}"/> <x id="lastName" equiv-text="{lastName}"/></source>
    <target>Hallo {lastName} {firstName}</target>
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
            <trans-unit id="Hello {firstName} {lastName}" xml:space="preserve">
                <source>Hello <x id="firstName" equiv-text="{firstName}"/> <x id="lastName" equiv-text="{lastName}"/></source>
                <target>Hallo {lastName} {firstName}</target>
            </trans-unit>
        </body>
    </file>
</xliff>
```

A placeholder in a `<target>` is written as `{name}`, or kept as the `<x/>` of the `<source>`. Braces
around any other name are text, and `{{` and `}}` are a single brace, so `{{firstName}}` is the text
`{firstName}`.

A translation file is `translations/<locale>.xlf`. On startup, a warning names every
`<trans-unit>` of `source.xlf` that has no `<target>` in a locale's file, and every `<target>` that
leaves out a placeholder of its `<source>`.

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

        // Format a percent, with up to three decimals
        this.localizeService.formatPercent(85.6, { locale });
        // en-US → '85.6%'
        // de    → '85,6 %'

        // Format a date using the locale's default date format
        this.localizeService.formatDate(new Date(), 'date', { locale });
        // en-US → '06/13/2026'
        // de    → '13.06.2026'

        // Format a date using the locale's default time format
        this.localizeService.formatDate(new Date(), 'time', { locale });
        // en-US → '3:45 PM'
        // de    → '15:45'

        // Format a date using the locale's default date-time format
        this.localizeService.formatDate(new Date(), 'date-time', { locale });
        // en-US → '06/13/2026 3:45 PM'
        // de    → '13.06.2026 15:45'

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
    localizeService.formatDate(order.placedAt, 'date-time', { locale });
    localizeService.formatDate(order.placedAt, 'date-time', { locale, timezone: customer.timezone });
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
