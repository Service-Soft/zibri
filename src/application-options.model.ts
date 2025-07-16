import { AuthStrategies } from './auth';
import { CronJob } from './cron';
import { BaseDataSource } from './data-source';
import { DiProvider } from './di';
import { BodyParserInterface } from './parsing';
import { Newable, Version } from './types';

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
     * The data sources to register in the app.
     */
    dataSources?: Newable<BaseDataSource>[],
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
     * The cron jobs to register in the app.
     */
    cronJobs?: Newable<CronJob>[]
};