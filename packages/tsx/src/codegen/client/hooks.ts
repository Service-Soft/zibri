import { toScriptJson } from '../../runtime/script-json';

/**
 * Placeholders inside the client hook sources that {@link substituteHookPlaceholders} replaces with
 * render-time data supplied to `renderPage`.
 */
// eslint-disable-next-line typescript/typedef
export const HOOK_PLACEHOLDERS = {
    /**
     * Replaced with a JSON object of locale -> (source -> translation).
     */
    translations: '__ZIBRI_TRANSLATIONS__',
    /**
     * Replaced with the active locale code string.
     */
    locale: '__ZIBRI_LOCALE__',
    /**
     * Replaced with a JSON object of locale format options (date/time/currency formats).
     */
    formatOptions: '__ZIBRI_LOCALE_FORMAT__'
} as const;

/**
 * Client-side, dependency-free source of the framework hooks the client script may reference.
 * The `$t`/`$ts` translation tables and `$f` format options are placeholders filled per render.
 */
export const CLIENT_HOOK_SOURCES: Readonly<Record<string, string>> = {
    onClient: 'const onClient = (fn) => { fn(); };',
    onServer: 'const onServer = () => {};',
    $t: [
        'const $t = (strings, ...values) => {',
        '    const params = {}; let source = \'\';',
        '    for (let i = 0; i < strings.length; i++) {',
        '        source += strings[i].replaceAll(\'{\', \'{{\').replaceAll(\'}\', \'}}\');',
        '        if (i < values.length) {',
        '            const value = values[i]; let key;',
        '            if (value !== null && typeof value === \'object\' && !Array.isArray(value) && Object.keys(value).length === 1) {',
        '                const entry = Object.entries(value)[0]; key = entry[0]; params[key] = entry[1];',
        '            } else { key = \'$\' + (i + 1); params[key] = value; }',
        '            source += \'{\' + key + \'}\';',
        '        }',
        '    }',
        `    const translations = ${HOOK_PLACEHOLDERS.translations};`,
        '    return { source, params, getValue: (locale) => {',
        // Locale resolution mirrors zibri's $t: exact, then two-part, then language, then any
        // variant of the language.
        '        let resolvedLocale;',
        '        const available = Object.keys(translations);',
        '        if (available.includes(locale)) { resolvedLocale = locale; }',
        '        else {',
        '            const parts = locale.split(\'-\');',
        '            const language = parts[0]; const second = parts[1]; const third = parts[2];',
        '            if (third) {',
        '                const twoPartLocale = language + \'-\' + second;',
        '                if (available.includes(twoPartLocale)) { resolvedLocale = twoPartLocale; }',
        '            }',
        '            if (available.includes(language)) { resolvedLocale ??= language; }',
        '            resolvedLocale ??= available.find((l) => l.startsWith(language + \'-\'));',
        '        }',
        '        const res = resolvedLocale ? (translations[resolvedLocale]?.[source] ?? source) : source;',
        // eslint-disable-next-line stylistic/max-len
        '        return res.replaceAll(/{{|}}|{([^}]+)}/g, (match, name) => match === \'{{\' ? \'{\' : match === \'}}\' ? \'}\' : (name != undefined && name in params ? String(params[name]) : match));',
        '    } };',
        '};'
    ].join('\n'),
    $ts: [`const $ts = (strings, ...values) => $t(strings, ...values).getValue(${HOOK_PLACEHOLDERS.locale});`].join('\n'),
    $f: [
        'const $f = (function () {',
        `    const opts = ${HOOK_PLACEHOLDERS.formatOptions};`,
        '    const pad = (n) => String(n).padStart(2, \'0\');',
        '    const fmt = (d, f) => {',
        '        const h = d.getHours(); const h12 = h % 12 || 12;',
        '        return f.replace(/YYYY|YY|MM|DD|HH|hh|h|mm|ss|A|a/g, (t) => ({',
        '            YYYY: d.getFullYear(), YY: String(d.getFullYear()).slice(-2),',
        '            MM: pad(d.getMonth() + 1), DD: pad(d.getDate()),',
        '            HH: pad(h), hh: pad(h12), h: h12,',
        '            mm: pad(d.getMinutes()), ss: pad(d.getSeconds()),',
        '            A: h < 12 ? \'AM\' : \'PM\', a: h < 12 ? \'am\' : \'pm\'',
        '        })[t] ?? t);',
        '    };',
        '    return {',
        '        date: (d) => fmt(new Date(d), opts.dateFormat),',
        '        time: (d) => fmt(new Date(d), opts.timeFormat),',
        '        dateTime: (d) => fmt(new Date(d), opts.dateTimeFormat),',
        '        price: (a, c) => Number(a).toLocaleString(opts.locale, { style: \'currency\', currency: c || opts.currencyCode }),',
        '        percent: (v) => v.toLocaleString(opts.locale, { style: \'percent\' })',
        '    };',
        '})();'
    ].join('\n')
};

/**
 * Render-time data used to fill the hook placeholders.
 */
export type HookData = {
    /**
     * Translations by locale then source string.
     */
    translations: unknown,
    /**
     * The active locale code.
     */
    locale: string,
    /**
     * The locale format options for `$f`.
     */
    formatOptions: unknown
};

/**
 * Substitutes the hook placeholders in a hook source with JSON-serialized render-time data.
 * @param source - The hook source containing placeholders.
 * @param data - The render-time data.
 * @returns The source with placeholders replaced.
 */
export function substituteHookPlaceholders(source: string, data: HookData): string {
    // Function replacers are required: the serialized data can contain `$$`, `$&` and friends,
    // which a string replacement would interpret as substitution patterns.
    return source
        .replaceAll(HOOK_PLACEHOLDERS.translations, () => toScriptJson(data.translations))
        .replaceAll(HOOK_PLACEHOLDERS.locale, () => toScriptJson(data.locale))
        .replaceAll(HOOK_PLACEHOLDERS.formatOptions, () => toScriptJson(data.formatOptions));
}