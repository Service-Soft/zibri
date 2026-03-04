/**
 * Utilities for masking sensitive information like eg. Banking data.
 */
export abstract class MaskUtilities {
    /**
     * Masks the given input string.
     * @param input - The sensitive info that should be masked.
     * @returns The first and last two characters of the given string, with any chars in between being replaced with *.
     */
    static mask(input: string): string {
        if (input.length <= 3) {
            return input;
        }
        const starsCount: number = input.length - 3;
        return input[0] + '*'.repeat(starsCount) + input.slice(-2);
    }
}