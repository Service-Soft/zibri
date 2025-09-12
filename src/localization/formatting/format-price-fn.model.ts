import { BigNumber } from '../../utilities';
import { CurrencyCode, LanguageCode } from '../models';

/**
 * Function for formatting prices.
 */
export type FormatPriceFn = (price: number | BigNumber, currency?: CurrencyCode, language?: LanguageCode) => string;