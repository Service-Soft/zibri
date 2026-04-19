import { TwoFactorMethods } from './auth/2fa/two-factor-methods.model';
import { AuthStrategies } from './auth/strategies/auth-strategies.model';
import { CronJob } from './cron/cron-job.model';
import { DataSourceInterface } from './data-source/data-sources/data-source.interface';
import { DiProvider } from './di/models/di-provider.model';
import { KnownHeader } from './http/known-header.enum';
import { BodyParserInterface } from './parsing/body-parser.interface';
import { ZibriPlugin } from './plugin/plugin.model';
import { DeepPartial } from './types/deep-partial.type';
import { Newable } from './types/newable.type';
import { Version } from './types/version.type';

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
 * The global security options for a zibri application.
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
    }
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
    version: Version,
    /**
     * The controllers to register in the app.
     */
    controllers: Newable<unknown>[],
    /**
     * The websocket controllers to register in the app.
     */
    websocketControllers: Newable<unknown>[],
    /**
     * Globals security settings, like eg. Hsts.
     */
    security?: DeepPartial<ZibriApplicationSecurityOptions>,
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
    bodyParsers?: Newable<BodyParserInterface>[],
    /**
     * The auth strategies to register.
     *
     * If nothing is provided, the Zibri default jwt auth strategy will be used.
     */
    authStrategies?: AuthStrategies,
    /**
     * The two factor methods to register.
     *
     * If nothing is provided, the Zibri default otp two factor method will be used.
     */
    twoFactorMethods?: TwoFactorMethods,
    /**
     * The cron jobs to register in the app.
     */
    cronJobs?: Newable<CronJob>[],
    /**
     * The plugins to be used.
     */
    plugins?: ZibriPlugin[]
};