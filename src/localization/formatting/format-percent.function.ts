import { FormatPercentFn } from './format-percent-fn.model';

/**
 * Default implementation for formatting percentages.
 * @param percent - The percent to format.
 */
export const formatPercent: FormatPercentFn = (percent: number) => {
    return percent.toLocaleString('de', { style: 'percent' });
};