# Localization
Zibri uses the `XLIFF` standard for its translation system by default.

It automatically generates a `source.xlf` file on startup based on all strings in your code base marked for translation.
This works in tsx files as well.

The generated file is written to `src/translations/source.xlf` and tracked in version control.
Translation files for other locales (eg. `de.xlf`) should live alongside it in the same directory and need to be provided by you.

Zibri also comes with a localize service that handles things like [formatting](#formatting).

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `$t` | function | Marks a string for translation, returning a `TranslationToken` |
| `$ts` | function | Marks a string for translation and resolves it immediately using the automatically resolved locale |
| `TranslationToken` | class | Represents a marked string; use `.getValue(locale)` to translate it |
| `defineDateFormat` | function | Defines a date/time/date-time format for a supported locale |
| `defineProvider` | function | Registers a DI provider, eg. for `ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT` |
| `ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT` | DI token | Configures supported locales, default locale and locale resolution |
| `ZIBRI_DI_TOKENS.LOCALIZE_SERVICE` | DI token | Injects `LocalizeServiceInterface` |
| `LocalizeServiceInterface` | interface | Contract for `formatPrice`, `formatPercent` and `formatDate` |
| `LocaleCode` | type | Type of a supported locale code (eg. `'en-US'`, `'de'`) |

## Usage
### Marking strings for translation
To mark a string for translation you can use `$t`:

```ts
import { $t } from 'zibri';

const exampleToken: TranslationToken = $t`Example token`;
const englishTokenTranslation: string = exampleToken.getValue('en-US');
const germanTokenTranslation: string = exampleToken.getValue('de');
```

Or `$ts` if you want to translate them directly using the [automatically resolved locale](#automatically-resolve-locales):

```ts
import { $ts } from 'zibri';

const automaticTokenTranslation: string = $ts`Example token`;
```

### String parameters

Template parameters are supported and automatically named from the expression they contain:

```ts
import { $t } from 'zibri';

const token: TranslationToken = $t`Hello ${user.firstName} ${user.lastName}`;
// source → 'Hello {user.firstName} {user.lastName}'
```

For complex expressions, the full expression text is used as the placeholder name:

```ts
const token: TranslationToken = $t`Total: ${formatPrice(order.total)} for ${order.items.length} items`;
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

### Configuring supported locales
Any locale you want to support must be defined by providing a them to `ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT`:

```ts
// providers.ts
import { defineDateFormat, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

// ...
    defineProvider({
        token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
        useValue: {
            // You can also specify what locale to use by default
            // defaultLocale: 'de',
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

As you can see, besides the actual locale, you also have to define what currency is used and some default date formats.

### Providing translations

Once the `source.xlf` has been generated, copy it and rename it to the target locale (eg. `de.xlf`).
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

Translation files are located at `src/translations/locale.xlf`. Zibri will warn on startup if any `<trans-unit>` from `source.xlf` is missing a `<target>` in a locale file.

The `<source>` element and `<note>` are informational, only the `<target>` is read at runtime.
Standard XLIFF editors can open these files directly.

### Automatically resolve locales
In a lot of cases, you want to use a locale based on the requesting user.

Zibri resolves that from:
1. the `'locale'` query parameter<br>
   (can be configured via `ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT`)
2. the `'accept-language'` header
3. the default locale as defined by the `ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT`

> Please note that resolved locales don't always need to exact match a supported locale. If you have `'en-US'` as a supported loale for example and the resolved locale is `'en'`, than that will match for translations and date formats. The only exception here is currency, something like `'USD'` will always have to exact match `'en-US'`.

### Formatting
Formatting dates, currencies, percentages etc. is also part of the localization system. For that you can use inject the `ZIBRI_DI_TOKENS.LOCALIZE_SERVICE` and use its `formatPrice`, `formatPercent` and `formatDate` methods:

```ts
import { Inject, LocaleCode, LocalizeServiceInterface, ZIBRI_DI_TOKENS } from 'zibri';

class ExampleService {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE)
        private localizeService: LocalizeServiceInterface
    )

    formatExamples(locale: LocaleCode): void {
        // Format a price using the locale's configured currency
        this.localizeService.formatPrice(19.99, { locale });
        // en-US → '$19.99'
        // de    → '19,99 €'

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

## See also
- [Request context](./request-context.md) — reading the resolved locale (`CURRENT_LOCALE`) from the current request
- [Templating](./templating.md) — the `$t`/`$ts`/`$f` hooks available in tsx components

