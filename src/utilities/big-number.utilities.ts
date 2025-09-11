import BigNumberJs from 'bignumber.js';

/**
 * Numbers with increased precision. (No rounding errors).
 */
export type BigNumber = BigNumberJs;

/**
 * Provides functionality around calculating with high precision.
 */
export abstract class BigNumberUtilities {
    /**
     * Creates a BigNumber from the provided input.
     * @param value - The number value to create from.
     * @returns A new BigNumber.
     */
    static new(value: number): BigNumber {
        return new BigNumberJs(value);
    }

    /**
     * Precisely multiplies the given values.
     * @param value1 - The first number to multiply.
     * @param value2 - The second number to multiply.
     * @returns The precise result as BigNumber.
     */
    static multiply(value1: number | BigNumber, value2: number | BigNumber): BigNumber {
        return new BigNumberJs(value1).multipliedBy(new BigNumberJs(value2));
    }

    /**
     * Precisely divides the first value by the second value.
     * @param dividend - The value that will be divided.
     * @param divisor - The value that divides the first value.
     * @returns The precise result as BigNumber.
     */
    static divide(dividend: number | BigNumber, divisor: number | BigNumber): BigNumber {
        return new BigNumberJs(dividend).dividedBy(new BigNumberJs(divisor));
    }

    /**
     * Precisely adds the given values.
     * @param value1 - The first number for the addition.
     * @param value2 - The second number for the addition.
     * @returns The precise result as BigNumber.
     */
    static add(value1: number | BigNumber, value2: number | BigNumber): BigNumber {
        return new BigNumberJs(value1).plus(new BigNumberJs(value2));
    }
}