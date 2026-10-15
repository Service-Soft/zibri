import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

/**
 * Loads the ".env" beside the application, when there is one.
 *
 * Here rather than in the entry point because imports are evaluated before any statement in
 * it: by the time start() could load anything, every module that reads a variable has already
 * read it. Anything reaching for a variable imports this file, so the file is loaded first by
 * construction.
 *
 * A missing ".env" is not an error. A deployment usually sets its variables directly, and
 * writing them to disk there is the thing to avoid rather than the thing to require.
 */
if (existsSync('.env')) {
    // assigned here rather than through process.loadEnvFile, which writes to the environment of the
    // process itself: jest hands each test file a copy of that, taken before this line ran
    for (const [key, value] of Object.entries(parseEnv(readFileSync('.env', 'utf8')))) {
        // a variable the environment already sets wins over the file, as with process.loadEnvFile
        process.env[key] ??= value;
    }
}

/**
 * Reads a variable the application cannot run without.
 * @param key - The name of the variable.
 * @returns Its value.
 * @throws When it is unset or empty, naming the variable. A deployment that forgot one stops
 * here, rather than signing tokens with an empty string and finding out later.
 */
export function requireEnv(key: string): string {
    const value: string | undefined = process.env[key];
    if (value == undefined || value === '') {
        throw new Error(`The environment variable "${key}" is not set. See .env.example.`);
    }
    return value;
}

/**
 * Reads a yes-or-no variable the application cannot run without.
 * @param key - The name of the variable, which holds "true" or "false".
 * @returns Whether it is "true".
 * @throws When it is anything but "true" or "false", naming the variable. A typo stops here,
 * rather than reading as "false" and turning off what it was meant to turn on.
 */
export function requireBooleanEnv(key: string): boolean {
    const value: string = requireEnv(key);
    if (value !== 'true' && value !== 'false') {
        throw new Error(`The environment variable "${key}" has to be "true" or "false", got "${value}".`);
    }
    return value === 'true';
}

/**
 * Reads a variable the application runs without.
 * @param key - The name of the variable.
 * @returns Its value, or an empty string when it is unset.
 */
export function optionalEnv(key: string): string {
    return process.env[key] ?? '';
}