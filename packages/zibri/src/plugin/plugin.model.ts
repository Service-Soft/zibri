import { ZibriApplication } from '../application/application.ts';
import { Authenticators } from '../auth/authenticators/authenticators.model.ts';
import { AuthStrategies } from '../auth/strategies/auth-strategies.model.ts';
import { CronJob } from '../cron/cron-job.model.ts';
import { DiProvider } from '../di/models/di-provider.model.ts';
import { AnyBodyParser } from '../parsing/body-parser.interface.ts';
import { Newable } from '../types/newable.type.ts';

/**
 * A bundle of providers, controllers, cronJobs, bodyParsers, authStrategies and authenticators.
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
    bodyParsers: Newable<AnyBodyParser>[] = [];
    /**
     * The auth strategies to register.
     *
     * If nothing is provided, the Zibri default jwt auth strategy will be used.
     */
    authStrategies: AuthStrategies = [];
    /**
     * The authenticators to register.
     *
     * If nothing is provided, the Zibri default password authenticator will be used.
     */
    authenticators: Authenticators = [];
    /**
     * Validates that the plugin can work correctly. This should check that all entities exist,
     * all required providers exist etc.
     *
     * It's called at the end of app initialization, so that data sources etc. Should all be available.
     */
    abstract validate(app: ZibriApplication): void | Promise<void>;
}