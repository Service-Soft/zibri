import { optionalPeer } from './optional-peer.function.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';

/**
 * A pattern compiled to run in time linear to the value it is tested against.
 */
type LinearRegex = {
    /**
     * Whether the value matches the pattern.
     */
    test: (value: string) => boolean
};

/**
 * What the `re2` package exports: a class like RegExp, backed by an engine that never backtracks.
 */
type LinearRegexConstructor = new (pattern: string, flags: string) => LinearRegex;

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
     * @throws When the pattern uses lookarounds or backreferences, or `re2` is not installed.
     */
    static validateLinear(fullKey: string, regex: string | RegExp | undefined): void {
        if (regex == undefined) {
            return;
        }
        // loaded on its own first, so that whatever compiling throws below is the pattern being refused.
        // Told apart by where it was thrown rather than by its class: re2 is a native addon, and the
        // SyntaxError it throws is not the one of every realm it can be called from
        RegexUtilities.loadLinearRegex();
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
     * @throws When `re2` is not installed, or a SyntaxError when it cannot run the pattern.
     */
    static resolveLinear(regex: string | RegExp): LinearRegex {
        const cached: LinearRegex | undefined = compiledPatterns.get(regex);
        if (cached != undefined) {
            return cached;
        }
        // a backtracking engine takes time exponential in the value for a pattern like `(a+)+$`, and
        // the value is whatever a request sent - so a declared pattern is never run by one. The
        // flags g and y make `test` remember where the last match ended, which would carry over from
        // one request to the next on a pattern that is compiled once
        const Linear: LinearRegexConstructor = RegexUtilities.loadLinearRegex();
        const compiled: LinearRegex = regex instanceof RegExp
            ? new Linear(regex.source, regex.flags.replaceAll(/[gy]/g, ''))
            : new Linear(regex, '');
        compiledPatterns.set(regex, compiled);
        return compiled;
    }

    private static loadLinearRegex(): LinearRegexConstructor {
        return optionalPeer<LinearRegexConstructor>('re2', 'A declared "regex"');
    }
}