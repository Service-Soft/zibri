// the class itself rather than an alias for it, so that the name means a value as well as a type.
// A property declares the type it holds and the framework checks that declaration against the
// format the property carries - which it can only do for a name that exists at runtime, and a type
// alias is not one.
import BigNumber from 'bignumber.js';

import { AnyNumber } from '../data-source/models/where/number-where-filter.model';

/**
 * Number with increased precision. (No rounding errors).
 */
export { BigNumber };

/**
 * Provides functionality around calculating with high precision.
 */
export abstract class NumberUtilities {
    /**
     * Creates a BigNumber from the provided input.
     * @param value - The number value to create from.
     * @returns A new BigNumber.
     */
    static new(value: number | bigint): BigNumber {
        return new BigNumber(value);
    }

    /**
     * Precisely multiplies the given values.
     * @param value1 - The first number to multiply.
     * @param value2 - The second number to multiply.
     * @returns The precise result as BigNumber.
     */
    static multiply(value1: AnyNumber, value2: AnyNumber): BigNumber {
        return new BigNumber(value1).multipliedBy(new BigNumber(value2));
    }

    /**
     * Precisely divides the first value by the second value.
     * @param dividend - The value that will be divided.
     * @param divisor - The value that divides the first value.
     * @returns The precise result as BigNumber.
     */
    static divide(dividend: AnyNumber, divisor: AnyNumber): BigNumber {
        return new BigNumber(dividend).dividedBy(new BigNumber(divisor));
    }

    /**
     * Precisely adds the given values.
     * @param value1 - The first number for the addition.
     * @param value2 - The second number for the addition.
     * @returns The precise result as BigNumber.
     */
    static add(value1: AnyNumber, value2: AnyNumber): BigNumber {
        return new BigNumber(value1).plus(new BigNumber(value2));
    }

    /**
     * Precisely subtracts the given values.
     * @param value1 - The first number for the subtraction.
     * @param value2 - The second number for the subtraction.
     * @returns The precise result as BigNumber.
     */
    static subtract(value1: AnyNumber, value2: AnyNumber): BigNumber {
        return new BigNumber(value1).minus(new BigNumber(value2));
    }

    /**
     * Rounds the given value to the given number of decimals, half away from zero, the way a
     * commercial amount is rounded: 0.125 becomes 0.13, and -0.125 becomes -0.13.
     * @param value - The value to round.
     * @param decimals - How many decimals it keeps.
     * @returns The rounded value as BigNumber.
     */
    static round(value: AnyNumber, decimals: number): BigNumber {
        return new BigNumber(value).decimalPlaces(decimals, BigNumber.ROUND_HALF_UP);
    }

    /**
     * Precisely compares the given values, whichever of the shapes a number takes they are.
     *
     * The operators cannot do this. A BigNumber is an object, so `<` compares what it stringifies
     * to and `===` compares which object it is - two of them holding the same number are not equal.
     * A bigint and a number are worse than that: `1n === 1` is false and `1n < 1` is false too, so
     * reading the two results together says one is greater than the other.
     *
     * Precise in both directions: nothing is narrowed to a double on the way in, so two values that
     * differ past what a double holds compare as the different numbers they are.
     * @param value1 - The number to compare.
     * @param value2 - The number to compare it against.
     * @returns -1 when the first is smaller, 1 when it is bigger, 0 when they are the same number,
     * and NaN when either of them is not a number at all.
     */
    static compare(value1: AnyNumber, value2: AnyNumber): number {
        return new BigNumber(value1).comparedTo(new BigNumber(value2)) ?? Number.NaN;
    }
}