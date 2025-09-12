import { CurrencyCode } from './currency-code.model';
import { LanguageCode } from './language-code.model';

/**
 * The options for handling localization, eg. In date or currency formatting.
 */
export type LocalizeOptions = {
    /**
     * The language code to use by default.
     */
    readonly language: LanguageCode,
    /**
     * The currency code to use by default.
     */
    readonly currency: CurrencyCode
};

/**
 * Input for modifying the localize options.
 */
export type LocalizeOptionsInput = Partial<LocalizeOptions>;