import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import { ZIBRI_ENVIRONMENTS, ZibriEnvironment } from 'zibri';

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
 * The database this application stores everything in.
 */
export type DbEnv = {
    /**
     * DB_HOST.
     */
    readonly host: string,
    /**
     * DB_PORT.
     */
    readonly port: number,
    /**
     * DB_USERNAME.
     */
    readonly username: string,
    /**
     * DB_PASSWORD.
     */
    readonly password: string,
    /**
     * DB_DATABASE.
     */
    readonly database: string,
    /**
     * DB_SSL: whether the connection to the database is encrypted.
     */
    readonly ssl: boolean
};

/**
 * The secrets access and refresh tokens are signed and verified with.
 */
export type JwtEnv = {
    /**
     * JWT_ACCESS_SECRET.
     */
    readonly accessSecret: string,
    /**
     * JWT_REFRESH_SECRET.
     */
    readonly refreshSecret: string
};

/**
 * The first user, created on startup while the database holds none.
 */
export type DefaultAdminEnv = {
    /**
     * DEFAULT_ADMIN_EMAIL.
     */
    readonly email: string,
    /**
     * DEFAULT_ADMIN_PASSWORD.
     */
    readonly password: string
};

/**
 * The mail server outgoing email is sent through.
 */
export type SmtpEnv = {
    /**
     * SMTP_HOST.
     */
    readonly host: string,
    /**
     * SMTP_PORT.
     */
    readonly port: number,
    /**
     * SMTP_USER, or an empty string.
     */
    readonly user: string,
    /**
     * SMTP_PASSWORD, or an empty string.
     */
    readonly password: string
};

/**
 * Every variable this application reads, see ".env.example".
 */
export type Env = {
    /**
     * ENVIRONMENT: where the application runs.
     */
    readonly environment: ZibriEnvironment,
    /**
     * PORT: where the application listens.
     */
    readonly port: number,
    /**
     * BASE_URL: the url the application hands out in links it generates.
     */
    readonly baseUrl: string,
    /**
     * The database.
     */
    readonly db: DbEnv,
    /**
     * The token secrets.
     */
    readonly jwt: JwtEnv,
    /**
     * MASTER_KEY: encrypts every encrypted column.
     */
    readonly masterKey: string,
    /**
     * The first user.
     */
    readonly defaultAdmin: DefaultAdminEnv,
    /**
     * CONFIRM_PASSWORD_RESET_URL: where a password reset link points.
     */
    readonly confirmPasswordResetUrl: string,
    /**
     * The mail server.
     */
    readonly smtp: SmtpEnv,
    /**
     * EMAIL_DEFAULT_SENDER, or an empty string.
     */
    readonly emailDefaultSender: string
};

/**
 * Every variable this application reads, by what it is for.
 *
 * The one place that names a variable: a name mistyped anywhere else is a type error rather than a
 * failure once that line runs. Each property reads its variable when it is used, not when this file
 * is loaded, so a command or a test that never sends a mail needs no SMTP_HOST. A variable that is
 * unset or holds no valid value throws there, naming it.
 *
 * A variable of your own gets a property in Env and a getter here, and a line in ".env.example".
 */
export const env: Env = {
    get environment(): ZibriEnvironment {
        return resolveOneOfEnv('ENVIRONMENT', ZIBRI_ENVIRONMENTS);
    },
    get port(): number {
        return resolvePortEnv('PORT');
    },
    get baseUrl(): string {
        return resolveUrlEnv('BASE_URL');
    },
    db: {
        get host(): string {
            return resolveEnv('DB_HOST');
        },
        get port(): number {
            return resolvePortEnv('DB_PORT');
        },
        get username(): string {
            return resolveEnv('DB_USERNAME');
        },
        get password(): string {
            return resolveEnv('DB_PASSWORD');
        },
        get database(): string {
            return resolveEnv('DB_DATABASE');
        },
        get ssl(): boolean {
            return resolveBooleanEnv('DB_SSL');
        }
    },
    jwt: {
        get accessSecret(): string {
            return resolveEnv('JWT_ACCESS_SECRET');
        },
        get refreshSecret(): string {
            return resolveEnv('JWT_REFRESH_SECRET');
        }
    },
    get masterKey(): string {
        return resolveEnv('MASTER_KEY');
    },
    defaultAdmin: {
        get email(): string {
            return resolveEnv('DEFAULT_ADMIN_EMAIL');
        },
        get password(): string {
            return resolveEnv('DEFAULT_ADMIN_PASSWORD');
        }
    },
    get confirmPasswordResetUrl(): string {
        return resolveUrlEnv('CONFIRM_PASSWORD_RESET_URL');
    },
    smtp: {
        get host(): string {
            return resolveEnv('SMTP_HOST');
        },
        get port(): number {
            return resolvePortEnv('SMTP_PORT');
        },
        get user(): string {
            return getOptionalEnv('SMTP_USER');
        },
        get password(): string {
            return getOptionalEnv('SMTP_PASSWORD');
        }
    },
    get emailDefaultSender(): string {
        return getOptionalEnv('EMAIL_DEFAULT_SENDER');
    }
};

/**
 * Reads a variable the application cannot run without.
 * @deprecated Read it through {@link env}, which names every variable once: a name mistyped here
 * only fails once this line runs.
 * @param key - The name of the variable.
 * @returns Its value.
 * @throws When it is unset or empty, naming the variable.
 */
export function requireEnv(key: string): string {
    return resolveEnv(key);
}

/**
 * Reads a yes-or-no variable the application cannot run without.
 * @deprecated Read it through {@link env}, which names every variable once: a name mistyped here
 * only fails once this line runs.
 * @param key - The name of the variable, which holds "true" or "false".
 * @returns Whether it is "true".
 * @throws When it is anything but "true" or "false", naming the variable.
 */
export function requireBooleanEnv(key: string): boolean {
    return resolveBooleanEnv(key);
}

/**
 * Reads a variable the application cannot run without, which holds one of a few values.
 * @deprecated Read it through {@link env}, which names every variable once: a name mistyped here
 * only fails once this line runs.
 * @param key - The name of the variable.
 * @param values - The values it may hold.
 * @returns Its value.
 * @throws When it is unset, empty or none of the values, naming the variable and the values.
 */
export function requireOneOfEnv<T extends string>(key: string, values: readonly T[]): T {
    return resolveOneOfEnv(key, values);
}

/**
 * Reads a port the application cannot run without.
 * @deprecated Read it through {@link env}, which names every variable once: a name mistyped here
 * only fails once this line runs.
 * @param key - The name of the variable.
 * @returns The port.
 * @throws When it is unset or no whole number from 1 to 65535, naming the variable.
 */
export function requirePortEnv(key: string): number {
    return resolvePortEnv(key);
}

/**
 * Reads an http or https url the application cannot run without.
 * @deprecated Read it through {@link env}, which names every variable once: a name mistyped here
 * only fails once this line runs.
 * @param key - The name of the variable.
 * @returns The url, as it is written.
 * @throws When it is unset or no absolute http or https url, naming the variable.
 */
export function requireUrlEnv(key: string): string {
    return resolveUrlEnv(key);
}

/**
 * Reads a variable the application runs without.
 * @deprecated Read it through {@link env}, which names every variable once: a name mistyped here
 * only fails once this line runs.
 * @param key - The name of the variable.
 * @returns Its value, or an empty string when it is unset.
 */
export function optionalEnv(key: string): string {
    return getOptionalEnv(key);
}

// the readers env is built of. Not exported, so that everything else reads a variable through env, which
// names it once. A variable of another kind gets a reader of its own below them, at the end of the file,
// where "zi upgrade" merges this file without a conflict

/**
 * Reads a variable the application cannot run without.
 * @param key - The name of the variable.
 * @returns Its value.
 * @throws When it is unset or empty, naming the variable. A deployment that forgot one stops
 * here, rather than signing tokens with an empty string and finding out later.
 */
function resolveEnv(key: string): string {
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
function resolveBooleanEnv(key: string): boolean {
    const value: string = resolveEnv(key);
    if (value !== 'true' && value !== 'false') {
        throw new Error(`The environment variable "${key}" has to be "true" or "false", got "${value}".`);
    }
    return value === 'true';
}

/**
 * Reads a variable the application cannot run without, which holds one of a few values.
 * @param key - The name of the variable.
 * @param values - The values it may hold.
 * @returns Its value.
 * @throws When it is unset, empty or none of the values, naming the variable and the values. A
 * typo stops here, rather than reading as a value nobody chose.
 */
function resolveOneOfEnv<T extends string>(key: string, values: readonly T[]): T {
    const value: string = resolveEnv(key);
    const known: T | undefined = values.find(candidate => candidate === value);
    if (known == undefined) {
        throw new Error(`The environment variable "${key}" has to be one of ${values.join(', ')}, got "${value}".`);
    }
    return known;
}

/**
 * Reads a port the application cannot run without.
 * @param key - The name of the variable.
 * @returns The port.
 * @throws When it is unset or no whole number from 1 to 65535, naming the variable. A typo stops
 * here, rather than as a server that cannot listen or a database that cannot be reached.
 */
function resolvePortEnv(key: string): number {
    const value: string = resolveEnv(key);
    const port: number = Number(value);
    if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
        throw new Error(`The environment variable "${key}" has to be a port from 1 to 65535, got "${value}".`);
    }
    return port;
}

/**
 * Reads an http or https url the application cannot run without.
 * @param key - The name of the variable.
 * @returns The url, as it is written.
 * @throws When it is unset or no absolute http or https url, naming the variable. A typo stops here,
 * rather than in every link the application hands out.
 */
function resolveUrlEnv(key: string): string {
    const value: string = resolveEnv(key);
    let protocol: string | undefined;
    try {
        protocol = new URL(value).protocol;
    }
    catch {
        protocol = undefined;
    }
    if (protocol !== 'http:' && protocol !== 'https:') {
        throw new Error(`The environment variable "${key}" has to be an http or https url, got "${value}".`);
    }
    return value;
}

/**
 * Reads a variable the application runs without.
 * @param key - The name of the variable.
 * @returns Its value, or an empty string when it is unset.
 */
function getOptionalEnv(key: string): string {
    return process.env[key] ?? '';
}