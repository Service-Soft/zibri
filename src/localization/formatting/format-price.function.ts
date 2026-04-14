import { FormatPriceFn } from './format-price-fn.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BigNumber } from '../../utilities/big-number.utilities';
import { CurrencyCode } from '../models/currency-code.model';
import { LanguageCode } from '../models/language-code.model';
import { LocalizeOptions } from '../models/localize-options.model';

/**
 * Default implementation for formatting prices.
 * @param price - The price to format.
 * @param currency - The currency code to be used for formatting. Defaults to the currency provided in ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS.
 * @param language - The language code to be used for formatting. Defaults to the language provided in ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS.
 */
export const formatPrice: FormatPriceFn = (
    price: number | BigNumber,
    currency: CurrencyCode = inject<LocalizeOptions>(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).currency,
    language: LanguageCode = inject<LocalizeOptions>(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).language
) => {
    const v: number = typeof price === 'number' ? price : price.toNumber();
    return v.toLocaleString(language, { style: 'currency', currency });
};