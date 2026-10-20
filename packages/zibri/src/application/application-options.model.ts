import { TwoFactorFailureLimit } from '../auth/2fa/two-factor-failure-limit.model.ts';
import { TwoFactorMethods } from '../auth/2fa/two-factor-methods.model.ts';
import { Authenticators } from '../auth/authenticators/authenticators.model.ts';
import { AuthStrategies } from '../auth/strategies/auth-strategies.model.ts';
import { BackupTransportInterface } from '../backup/transports/backup-transport.interface.ts';
import { CronJob } from '../cron/cron-job.model.ts';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface.ts';
import { DiProvider } from '../di/models/di-provider.model.ts';
import { CorsOptions } from '../http/cors.middleware.ts';
import { KnownHeader } from '../http/known-header.enum.ts';
import { AnyBodyParser } from '../parsing/body-parser.interface.ts';
import { ZibriPlugin } from '../plugin/plugin.model.ts';
import { DeepPartial } from '../types/deep-partial.type.ts';
import { Newable } from '../types/newable.type.ts';
import { OmitStrict } from '../types/omit-strict.type.ts';
import { SemVerVersion } from '../versioning/sem-ver.utilities.ts';

/**
 * Configuration options for strict transport security / hsts.
 */
export type HstsOptions = {
    /**
     * The maximum age for which strict transport should be enabled. Defaults to 2 years.
     */
    maxAgeSeconds: number,
    /**
     * Whether or not subdomains should be included. Defaults to true.
     */
    includeSubDomains: boolean,
    /**
     * Whether or not this url should be put on a preload list. Defaults to false.
     */
    preload: boolean
};

/**
 * What a route that carries no `@Auth` decorator of its own requires.
 *
 * `'public'` lets it through unauthenticated, which is what an api that is open by design wants.
 * `'requireLogin'` refuses it to anyone who is not logged in, so forgetting a decorator costs a 401
 * in development rather than a world writable endpoint in production.
 *
 * Deliberately only these two. Every other check - a role, ownership, a second factor - resolves a
 * user first, so `'requireLogin'` is implied by all of them: whether a route's own decorators
 * replace the default or combine with it is a question that cannot be answered wrong. An
 * application wide role would make that question real, and every answer to it is defensible, which
 * is the reliable sign the next reader will assume the other one.
 */
export type DefaultAuth = 'public' | 'requireLogin';

/**
 * The global security options for a Zibri application.
 */
export type ZibriApplicationSecurityOptions = {
    /**
     * Some headers to set.
     */
    headers: {
        /**
         * Configuration for the strict transport security / hsts header.
         */
        [KnownHeader.STRICT_TRANSPORT_SECURITY]: boolean | HstsOptions
    },
    /**
     * Which browser origins may call this api, and what they may send.
     *
     * Defaults to every origin without credentials, which is the only default a framework can pick:
     * the right answer is a list of the deployment's own front ends, and it does not know them.
     */
    cors: CorsOptions,
    /**
     * How many proxies sit in front of this application, or which ones to believe.
     *
     * Anything behind a load balancer or ingress sees the proxy's address as the client's and the
     * connection as plain http, because that is what the last hop really was. The forwarded headers
     * carry the truth, and this says how much of them to believe: a number of hops, a subnet or
     * address to trust, or true for everything.
     *
     * Defaults to false, which is the only safe default: every one of those headers is attacker
     * supplied until something in front of the application overwrites them. Believing them
     * unconditionally hands anyone a client address of their choosing - and with it whatever is
     * keyed by it, a rate limit above all.
     */
    trustProxy: boolean | number | string | string[]
};

/**
 * The security options as an application states them.
 *
 * Every header has a default, so naming one of them is a change to that one rather than a
 * declaration of all of them - `cors` is the exception, because `origins` is the whole decision and
 * there is no half of it that means anything.
 */
export type ZibriApplicationSecurityOptionsInput = DeepPartial<OmitStrict<ZibriApplicationSecurityOptions, 'cors'>> & {
    /**
     * Which browser origins may call this api, and what they may send.
     */
    cors?: CorsOptions
};

/**
 * All options for a Zibri application.
 */
export type ZibriApplicationOptions = {
    /**
     * The name of the app.
     */
    name: string,
    /**
     * The base url of the app.
     * Eg. Http://localhost:3000.
     */
    baseUrl: string,
    /**
     * The SemVer version of the app.
     *
     * Is also used by migrations by default.
     */
    version: SemVerVersion,
    /**
     * The controllers to register in the app.
     */
    controllers: Newable<unknown>[],
    /**
     * Services to build while the app initializes, on top of the ones it finds by itself.
     *
     * Normally empty. Initialization builds whatever has something to do before its first use, which
     * a class says by declaring a lifecycle hook, so an ordinary service belongs nowhere on this
     * list. What belongs here is a class that declares a hook and that nothing provides: one marked
     * `@Injectable({ register: 'onUse' })`, or one a package ships for its callers to reach
     * dynamically. Listing it is how the application says it means to run it, and startup refuses a
     * class whose hooks could never run rather than leaving that to be found later.
     */
    additionalLifecycleServices?: Newable<unknown>[],
    /**
     * The websocket controllers to register in the app.
     */
    websocketControllers: Newable<unknown>[],
    /**
     * What a route that carries no `@Auth` decorator of its own requires.
     *
     * Has no default: an api that is open by design and an
     * api that guards everything are both ordinary, and a framework picking either one silently
     * makes "you forgot to say" indistinguishable from "you said this". Required instead, so the
     * question is answered once, in the one place where it is answerable, by the compiler rather
     * than by a startup warning nobody reads.
     *
     * A route opts back out with `@Auth.skip()`, on the route or on the whole controller.
     */
    defaultAuth: DefaultAuth,
    /**
     * Globals security settings, like eg. Hsts.
     */
    security?: ZibriApplicationSecurityOptionsInput,
    /**
     * The data sources to register in the app.
     */
    dataSources?: Newable<DataSourceInterface>[],
    /**
     * The DI providers to register/override.
     */
    providers?: DiProvider<unknown>[],
    /**
     * The body parsers to register.
     *
     * If nothing is provided, the Zibri default parsers will be used.
     */
    bodyParsers?: Newable<AnyBodyParser>[],
    /**
     * The auth strategies to register.
     *
     * If nothing is provided, the Zibri default jwt auth strategy will be used.
     */
    authStrategies?: AuthStrategies,
    /**
     * The authenticators to register.
     *
     * If nothing is provided, the Zibri default password authenticator will be used.
     */
    authenticators?: Authenticators,
    /**
     * The two factor methods to register.
     *
     * If nothing is provided, the Zibri default otp two factor method will be used.
     */
    twoFactorMethods?: TwoFactorMethods,
    /**
     * Whether a user's second factor is locked after too many wrong codes in a row, and what the lock
     * refuses.
     *
     * Defaults to `false`, which locks nothing.
     */
    twoFactorFailureLimit?: TwoFactorFailureLimit,
    /**
     * The cron jobs to register in the app.
     */
    cronJobs?: Newable<CronJob>[],
    /**
     * The configured backup transports of the app.
     */
    backupTransports?: Newable<BackupTransportInterface>[],
    /**
     * The plugins to be used.
     */
    plugins?: ZibriPlugin[]
};