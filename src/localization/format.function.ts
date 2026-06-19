import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { GlobalRegistry } from '../global/global-registry';
import { BigNumber } from '../utilities/number.utilities';
import { CurrencyCode } from './models/currency-code.model';

// eslint-disable-next-line jsdoc/require-jsdoc
class FormatCalledWhileAppOfflineError extends InternalError {
    constructor(methodName: keyof typeof $f, options?: ErrorOptions) {
        super(
            [
                `$f.${methodName} was called while the app is still offline. Formatting would always use the default locale.`,
                'Move it inside a function/class.'
            ],
            options
        );
        this.name = 'FormatCalledWhileAppOfflineError';
    }
}

/**
 * Shortcuts for formatting values in the currently resolved locale.
 */
// eslint-disable-next-line typescript/typedef
export const $f = {
    /**
     * Formats the given date in the 'date' format.
     * @param date - The date to format.
     * @returns The formatted string.
     * @throws When used while the app is still offline, as that would lead to always using the default locale.
     */
    date(date: Date): string {
        if (GlobalRegistry.isAppOffline()) {
            throw new FormatCalledWhileAppOfflineError('date');
        }
        return inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).formatDate(date, 'date');
    },
    /**
     * Formats the given date in the 'time' format.
     * @param date - The date to format.
     * @returns The formatted string.
     * @throws When used while the app is still offline, as that would lead to always using the default locale.
     */
    time(date: Date): string {
        if (GlobalRegistry.isAppOffline()) {
            throw new FormatCalledWhileAppOfflineError('time');
        }
        return inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).formatDate(date, 'time');
    },
    /**
     * Formats the given date in the 'date-time' format.
     * @param date - The date to format.
     * @returns The formatted string.
     * @throws When used while the app is still offline, as that would lead to always using the default locale.
     */
    dateTime(date: Date): string {
        if (GlobalRegistry.isAppOffline()) {
            throw new FormatCalledWhileAppOfflineError('dateTime');
        }
        return inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).formatDate(date, 'date-time');
    },
    /**
     * Formats the given price.
     * @param price - The price to format.
     * @param currency - The currency that the price is in.
     * @returns The formatted string.
     * @throws When used while the app is still offline, as that would lead to always using the default locale.
     */
    price(price: number | bigint | BigNumber, currency: CurrencyCode): string {
        if (GlobalRegistry.isAppOffline()) {
            throw new FormatCalledWhileAppOfflineError('price');
        }
        return inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).formatPrice(price, { currency });
    },
    /**
     * Formats the given percentage.
     * @param percent - The percentage value to format.
     * @returns The formatted string.
     * @throws When used while the app is still offline, as that would lead to always using the default locale.
     */
    percent(percent: number): string {
        if (GlobalRegistry.isAppOffline()) {
            throw new FormatCalledWhileAppOfflineError('percent');
        }
        return inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).formatPercent(percent);
    }
};