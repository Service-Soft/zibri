import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { LocalizeServiceInterface } from './localize-service.interface';
import { LocaleCode } from './models/locale-code.model';

/**
 * Runs the given function in a locale, through `runInLocale` of the localize service: `$ts`, `$f`, the formatting
 * methods and every template rendered inside it, every await included, use it in place of the locale of the
 * request. The locale is matched to a supported one, so `de-AT` runs in `de`. One that matches none, null and
 * undefined run in the default locale.
 *
 * A localize service of your own without `runInLocale` runs the function as it is, in the locale it resolves.
 * @param locale - The locale to run in, such as the one of the user a mail is for.
 * @param fn - The function to run.
 * @returns The result of the function.
 */
export function runInLocale<T>(locale: LocaleCode | null | undefined, fn: () => T): T {
    const localizeService: LocalizeServiceInterface = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE);
    // optional until 4.0: a localize service written for 3.2 has none, and goes on translating in the locale it
    // resolves, the one of the request, as it did
    return localizeService.runInLocale == undefined ? fn() : localizeService.runInLocale(locale, fn);
}