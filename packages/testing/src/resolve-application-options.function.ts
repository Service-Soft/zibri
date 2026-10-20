import { DataSourceInterface, DiProvider, Newable, ZibriApplicationOptions } from 'zibri';

import { StartTestServerOptions } from './start-test-server-options.model.ts';

/**
 * What a harness falls back to for whatever neither the call nor the application named.
 */
export type ApplicationOptionsFallback = {
    /**
     * The name the application boots under.
     *
     * A cluster needs its own, because every replica has to boot under the same one: the jwt
     * strategy issues and verifies tokens under the application name.
     */
    name: string,
    /**
     * The data sources to boot on.
     *
     * A function rather than a value: building a data source class registers it, and one that is
     * registered without being deployed is refused at boot - so the fallback is only built when it
     * is the one being used.
     */
    dataSources: () => Newable<DataSourceInterface>[],
    /**
     * The DI providers to boot with.
     */
    providers: DiProvider<unknown>[]
};

/**
 * Builds the options one application is created from, out of what the call named, what the
 * application it is a test of declares, and the harness's own defaults - in that order.
 *
 * The precedence is the whole design: a test names the one key it is about, the application
 * supplies everything else it ships with, and the harness fills in only what is left. That is what
 * makes a test a test of an application rather than of a server assembled to resemble one.
 * @param options - What the call named, including the application to build on.
 * @param fallback - What to use for whatever neither of them names.
 * @returns The options to hand a `ZibriApplication`.
 */
export function resolveApplicationOptions(
    options: StartTestServerOptions,
    fallback: ApplicationOptionsFallback
): ZibriApplicationOptions {
    // an absent application is an empty base rather than a case of its own, so every line below
    // reads the same way whether or not there is one
    const base: Partial<ZibriApplicationOptions> = options.application ?? {};

    // the two options with no array to fall back on. Spread conditionally rather than assigned,
    // because `ZibriApplication` fills its own defaults in behind a spread of what it was given -
    // so a key that is *present and undefined* takes the default away, and `bodyParsers: undefined`
    // is a TypeError at construction rather than the two default parsers.
    const security: Pick<ZibriApplicationOptions, 'security'> | Record<string, never>
        = options.security ?? base.security
            ? { security: options.security ?? base.security }
            : {};
    const bodyParsers: Pick<ZibriApplicationOptions, 'bodyParsers'> | Record<string, never>
        = options.bodyParsers ?? base.bodyParsers
            ? { bodyParsers: options.bodyParsers ?? base.bodyParsers }
            : {};

    // written out key by key rather than spread, because `??` treats an explicitly undefined
    // override as absent and a spread does not - and an override built from a variable that came
    // out undefined means "I did not name this", never "boot without it".
    //
    // A new *required* application option breaks this function until it is listed, which is the
    // point at which to decide what a test server should do with it.
    return {
        ...security,
        ...bodyParsers,
        name: options.name ?? base.name ?? fallback.name,
        baseUrl: options.baseUrl ?? base.baseUrl ?? 'http://localhost:3000',
        version: options.version ?? base.version ?? '1.0.0',
        controllers: options.controllers ?? base.controllers ?? [],
        websocketControllers: options.websocketControllers ?? base.websocketControllers ?? [],
        // an explicit choice by the caller or by the application rather than a framework default,
        // because the framework has none: a test is usually about something other than auth, and
        // one that is about the other posture asks for it.
        defaultAuth: options.defaultAuth ?? base.defaultAuth ?? 'public',
        dataSources: options.dataSources ?? base.dataSources ?? fallback.dataSources(),
        providers: options.providers ?? base.providers ?? fallback.providers,
        // an empty array (rather than undefined) so ZibriApplication's own JwtAuthStrategy fallback
        // still applies
        authStrategies: options.authStrategies ?? base.authStrategies ?? [],
        // the same, for ZibriApplication's own PasswordAuthenticator fallback
        authenticators: options.authenticators ?? base.authenticators ?? [],
        twoFactorMethods: options.twoFactorMethods ?? base.twoFactorMethods ?? [],
        // false rather than undefined, which is what ZibriApplication falls back to anyway
        twoFactorFailureLimit: options.twoFactorFailureLimit ?? base.twoFactorFailureLimit ?? false,
        cronJobs: options.cronJobs ?? base.cronJobs ?? [],
        additionalLifecycleServices: options.additionalLifecycleServices
            ?? base.additionalLifecycleServices
            ?? [],
        plugins: options.plugins ?? base.plugins ?? []
    };
}