import { ZibriApplication } from '../application/application';
import { TwoFactorMethods } from '../auth/2fa/two-factor-methods.model';
import { Authenticators } from '../auth/authenticators/authenticators.model';
import { AuthStrategies } from '../auth/strategies/auth-strategies.model';
import { BackupTransportInterface } from '../backup/transports/backup-transport.interface';
import { CronJob } from '../cron/cron-job.model';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { DiProvider } from '../di/models/di-provider.model';
import { AnyBodyParser } from '../parsing/body-parser.interface';
import { Newable } from '../types/newable.type';

/**
 * A bundle of what an application is built from: providers, controllers, websocket controllers, data
 * sources, cron jobs, body parsers, auth strategies, authenticators, two factor methods, backup
 * transports and lifecycle services.
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
     * The websocket controllers to register in the app.
     */
    websocketControllers: Newable<unknown>[] = [];
    /**
     * The data sources to register, such as one holding the plugin's own entities.
     */
    dataSources: Newable<DataSourceInterface>[] = [];
    /**
     * The two factor methods to register.
     *
     * If nothing is provided, the Zibri default one time password method will be used.
     */
    twoFactorMethods: TwoFactorMethods = [];
    /**
     * The backup transports to register.
     */
    backupTransports: Newable<BackupTransportInterface>[] = [];
    /**
     * The services to build at startup for their lifecycle hooks, such as `OnAppInit`.
     */
    additionalLifecycleServices: Newable<unknown>[] = [];
    /**
     * Validates that the plugin can work correctly. This should check that all entities exist,
     * all required providers exist etc.
     *
     * It's called at the end of app initialization, so that data sources etc. Should all be available.
     */
    abstract validate(app: ZibriApplication): void | Promise<void>;
}