import { onClient } from './on-client.hook';
import { onServer } from './on-server.hook';
import type { LocaleCode } from '../../localization/models/locale-code.model';
import type { TranslatedString } from '../../localization/models/translated-string.model';
import type { TranslationToken } from '../../localization/translate.function';

// eslint-disable-next-line jsdoc/require-param, jsdoc/require-returns
/**
 * A variant of the $t function that uses no external dependencies and is able to run inside of tsx files.
 */
function $t(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
): TranslationToken {
    const params: Record<string, unknown> = {};
    let source: string = '';

    for (let i: number = 0; i < strings.length; i++) {
        source += strings[i].replaceAll('{', '{{').replaceAll('}', '}}');

        if (i < values.length) {
            const value: unknown = values[i];
            let key: string;

            if (value !== null
                && typeof value === 'object'
                && !Array.isArray(value)
                && Object.keys(value).length === 1
            ) {
                // eslint-disable-next-line typescript/no-unsafe-assignment
                const [name, val] = Object.entries(value)[0];
                key = name;
                params[key] = val;
            }
            else {
                key = `$${i + 1}`;
                params[key] = value;
            }

            source += `{${key}}`;
        }
    }

    return {
        source,
        params,
        getValue: (locale: LocaleCode) => {
            // eslint-disable-next-line stylistic/max-len
            const translations: Partial<Record<LocaleCode, Partial<Record<string, string>>>> = 'TRANSLATIONS_PLACEHOLDER' as unknown as Partial<Record<LocaleCode, Partial<Record<string, string>>>>;

            let resolvedLocale: LocaleCode | undefined;
            const available: LocaleCode[] = Object.keys(translations) as LocaleCode[];
            if (available.includes(locale)) {
                resolvedLocale = locale;
            }
            else {
                const [language, second, third] = locale.split('-');
                if (third) {
                    const twoPartLocale: LocaleCode = `${language}-${second}` as LocaleCode;
                    if (available.includes(twoPartLocale)) {
                        resolvedLocale = twoPartLocale;
                    }
                }
                if (available.includes(language as LocaleCode)) {
                    resolvedLocale ??= language as LocaleCode;
                }
                resolvedLocale ??= available.find((locale) => locale.startsWith(`${language}-`));
            }

            const res: string = resolvedLocale ? translations[resolvedLocale]?.[source] ?? source : source;
            return res.replaceAll(/{{|}}|{([^}]+)}/g, (match, name?: string) => {
                if (match === '{{') {
                    return '{';
                }
                if (match === '}}') {
                    return '}';
                }
                return name != undefined && name in params ? String(params[name]) : match;
            }) as TranslatedString;
        }
    };
}

// eslint-disable-next-line jsdoc/require-param, jsdoc/require-returns
/**
 * A variant of the $ts function that uses no external dependencies and is able to run inside of tsx files.
 */
function $ts(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
): string {
    const locale: LocaleCode = 'LOCALE_CODE_PLACEHOLDER' as LocaleCode;
    return $t(strings, ...values).getValue(locale);
}

/**
 * Names of additional hooks that can't be provided via preactHooks.
 */
export const preactAdditionalHookNames: string[] = ['$f'];

/**
 * All preact hooks that are available.
 */
// eslint-disable-next-line typescript/typedef
export const preactHooks = [onClient, onServer, $t, $ts] as const;