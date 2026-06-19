import { LocaleCode } from './models/locale-code.model';
import { TranslationRegistry } from './translation.registry';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { GlobalRegistry } from '../global/global-registry';
import { ObjectUtilities } from '../utilities/object.utilities';
import { TranslatedString } from './models/translated-string.model';
import { InternalError } from '../error-handling/internal-error.model';

/**
 * Definition of a value marked with $translate``.
 */
export class TranslationToken {
    private constructor(readonly source: string, readonly params: Readonly<Record<string, unknown>>) {}

    /**
     * Gets the tokens translation string for the given value.
     * @param locale - The locale to get the translation string for.
     * @returns The translation string.
     */
    getValue(locale: LocaleCode): TranslatedString {
        const res: string = TranslationRegistry.findTranslation(locale, this.source) ?? this.source;
        return res.replaceAll(/{{|}}|{([^}]+)}/g, (match, name?: string) => {
            if (match === '{{') {
                return '{';
            }
            if (match === '}}') {
                return '}';
            }
            return name != undefined && name in this.params ? String(this.params[name]) : match;
        }) as TranslatedString;
    }
}

/**
 * Marks the given string for translation.
 * @param strings - The parts of the template string literal.
 * @param values - Any parameters used in the template string.
 * @returns A translation token that can be used to return specific translations of the string.
 */
export function $t(
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

            if (isSingleKeyObject(value)) {
                // Transform ran — use the named key
                const [name, val] = ObjectUtilities.entries(value)[0];
                key = name;
                params[key] = val;
            }
            else {
                // Transform did not run (e.g. Jest) — fall back to positional
                key = `$${i + 1}`;
                params[key] = value;
            }

            source += `{${key}}`;
        }
    }

    // eslint-disable-next-line typescript/no-unsafe-return, typescript/no-unsafe-call, typescript/no-explicit-any
    return new (TranslationToken as any)(source, params);
}

/**
 * Marks the given string for translation and translates it in place.
 * @param strings - The parts of the template string literal.
 * @param values - Any parameters used in the template string.
 * @returns The translated string using the ZIBRI_DI_TOKENS.LOCALIZE_SERVICE resolveSupportedLocale method.
 * @throws When this is used before app initialization.
 */
export function $ts(
    strings: TemplateStringsArray,
    ...values: readonly unknown[]
): TranslatedString {
    if (GlobalRegistry.isAppOffline()) {
        throw new InternalError([
            '$ts was called while the app is still offline. Translations would always use the default locale.',
            'Move it inside a function/class, or use $t for module-level constants.'
        ].join('\n'));
    }
    const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    const locale: LocaleCode = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(context);
    return $t(strings, ...values).getValue(locale);
}

// eslint-disable-next-line jsdoc/require-jsdoc
function isSingleKeyObject(value: unknown): value is Record<string, unknown> {
    return value !== null
        && typeof value === 'object'
        && !Array.isArray(value)
        && ObjectUtilities.keys(value).length === 1;
}