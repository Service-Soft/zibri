import { BigNumber } from '../../utilities/number.utilities';
import { CurrencyCode } from '../models/currency-code.model';
import { LanguageCode } from '../models/language-code.model';

/**
 * Function for formatting prices.
 */
export type FormatPriceFn = (price: number | BigNumber, currency?: CurrencyCode, language?: LanguageCode) => string;