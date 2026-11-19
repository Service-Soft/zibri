import { InternalError } from '../error-handling/internal-error.model';
import { LinearRegex } from './linear-regex';

/**
 * Every declared pattern compiled so far, by the pattern as it was declared.
 */
const compiledPatterns: Map<string | RegExp, LinearRegex> = new Map();

/**
 * Utilities for the regular expressions a property or a parameter declares.
 */
export abstract class RegexUtilities {
    /**
     * Refuses a declared pattern that cannot run in time linear to the value it is tested against.
     * @param fullKey - Where the pattern is declared, for the message.
     * @param regex - The pattern as declared, if there is one.
     * @throws When the pattern uses lookarounds or backreferences.
     */
    static validateLinear(fullKey: string, regex: string | RegExp | undefined): void {
        if (regex == undefined) {
            return;
        }
        try {
            RegexUtilities.resolveLinear(regex);
        }
        catch (error) {
            throw new InternalError(
                [
                    `${fullKey}: The regex ${String(regex)} cannot be declared. ${String(error)}`,
                    'A declared regex runs in time linear to the value, which leaves out lookarounds and backreferences.'
                ],
                { cause: error }
            );
        }
    }

    /**
     * Compiles a declared pattern once, and hands back the compiled pattern every time after.
     * @param regex - The pattern as declared.
     * @returns The pattern, compiled to run in time linear to the value.
     * @throws A SyntaxError when it cannot run the pattern.
     */
    static resolveLinear(regex: string | RegExp): LinearRegex {
        const cached: LinearRegex | undefined = compiledPatterns.get(regex);
        if (cached != undefined) {
            return cached;
        }
        // a backtracking engine takes time exponential in the value for a pattern like `(a+)+$`, and
        // the value is whatever a request sent - so a declared pattern is never run by one
        const compiled: LinearRegex = regex instanceof RegExp
            ? new LinearRegex(regex.source, regex.flags)
            : new LinearRegex(regex, '');
        compiledPatterns.set(regex, compiled);
        return compiled;
    }
}