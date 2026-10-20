import { ConversionRefusal } from './conversion-refusal.enum.ts';

/**
 * A stored value that a property change cannot convert, and why.
 */
export type RefusedValue = {
    /**
     * The value as it is stored.
     */
    value: unknown,
    /**
     * Why it cannot be converted.
     */
    refusal: ConversionRefusal
};