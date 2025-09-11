import { ZibriApplication } from '../application';
import { AuthStrategies } from '../auth';
import { CronJob } from '../cron';
import { DiProvider } from '../di';
import { BodyParserInterface } from '../parsing';
import { Newable } from '../types';

/**
 * A bundle of providers, controllers, cronJobs, bodyParsers and authStrategies.
 */
export abstract class ZibriPlugin {
    /**
     * The DI providers to register/override.
     */
    providers: DiProvider<unknown>[] = [];
    /**
     * The controllers to register in the app.
     */
    controllers: Newable<unknown>[] = [];
    /**
     * The cron jobs to register in the app.
     */
    cronJobs: Newable<CronJob>[] = [];
    /**
     * The body parsers to register.
     *
     * If nothing is provided, the Zibri default parsers will be used.
     */
    bodyParsers: Newable<BodyParserInterface>[] = [];
    /**
     * The auth strategies to register.
     *
     * If nothing is provided, the Zibri default jwt auth strategy will be used.
     */
    authStrategies: AuthStrategies = [];
    /**
     * Validates that the plugin can work correctly. This should check that all entities exist,
     * all required providers exist etc.
     *
     * It's called after the initialization of the app, so that data sources etc. Should all be available.
     */
    abstract validate(app: ZibriApplication): void | Promise<void>;
}