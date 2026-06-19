import { ZibriApplicationOptions } from '../application-options.model';
import { AppState } from './app-state.enum';
import { UserRepositories } from '../auth/models/user-repositories.model';
import { BackupResourceInterface } from '../backup/backup-resource.interface';
import { AnyCache } from '../caching/cache/cache.interface';
import { DiProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { InternalError } from '../error-handling/internal-error.model';
import { BodyParserInterface } from '../parsing/body-parser.interface';
import { Newable } from '../types/newable.type';
import { SemVerVersion } from '../utilities/sem-ver.utilities';

/**
 * The data of the app.
 */
export type AppData = {
    /**
     * The state of the app.
     */
    state: AppState,
    /**
     * The base url of the app.
     */
    baseUrl?: string,
    /**
     * The name of the app.
     */
    name?: string,
    /**
     * The current version of the app.
     */
    version?: SemVerVersion
};

// eslint-disable-next-line jsdoc/require-jsdoc
class AppAlreadyMarkedAsError extends InternalError {
    constructor(state: AppState) {
        super(`The app has already been marked as "${state}".`);
        this.name = 'AppAlreadyMarkedAsError';
    }
}

// eslint-disable-next-line jsdoc/require-jsdoc
class AppNotYetMarkedAsError extends InternalError {
    constructor(state: AppState) {
        super(`The app has not been marked as "${state}" yet.`);
        this.name = 'AppNotYetMarkedAsError';
    }
}

/**
 * A registry for handling global state.
 */
export abstract class GlobalRegistry {
    private static readonly appData: AppData = {
        state: AppState.OFFLINE
    };
    /**
     * All injectables registered eg. Via \@Injectable.
     */
    static readonly injectables: DiProvider<unknown>[] = [];
    /**
     * All injectables registered via \@Injectable but with the { register: 'onUse' } flag.
     */
    static readonly lazyInjectables: DiProvider<unknown>[] = [];
    /**
     * All controllers registered with \@Controller.
     */
    static readonly controllerClasses: Newable<unknown>[] = [];
    /**
     * All websocket controllers registered with \@WebsocketController.
     */
    static readonly websocketControllerClasses: Newable<unknown>[] = [];
    /**
     * All entities registered with \@Entity.
     */
    static readonly entityClasses: Newable<BaseEntity>[] = [];
    /**
     * All entities registered with \@Cache.
     */
    static readonly cacheClasses: Newable<AnyCache>[] = [];
    /**
     * All backup resources registered with \@Backup.
     */
    static readonly backupResources: Newable<BackupResourceInterface>[] = [];
    /**
     * All body parsers registered with \@BodyParser.
     */
    static readonly bodyParsers: Newable<BodyParserInterface>[] = [];
    /**
     * All user repositories registered with \@UserRepo.
     */
    static readonly userRepositories: UserRepositories = [];

    private static readonly validateAppStateChange: Record<AppState, () => void> = {
        [AppState.OFFLINE]: () => {
            throw new InternalError(`Cannot manually mark an an app as "${AppState.OFFLINE}".`);
        },
        [AppState.CREATED]: () => {
            switch (this.appData.state) {
                case AppState.OFFLINE: {
                    return;
                }
                case AppState.CREATED: {
                    throw new AppAlreadyMarkedAsError(AppState.CREATED);
                }
                case AppState.INITIALIZED: {
                    throw new AppAlreadyMarkedAsError(AppState.INITIALIZED);
                }
                case AppState.STARTED: {
                    throw new AppAlreadyMarkedAsError(AppState.STARTED);
                }
                case AppState.SHUTTING_DOWN: {
                    throw new AppAlreadyMarkedAsError(AppState.SHUTTING_DOWN);
                }
            }
        },
        [AppState.INITIALIZED]: () => {
            switch (this.appData.state) {
                case AppState.OFFLINE: {
                    throw new AppNotYetMarkedAsError(AppState.CREATED);
                }
                case AppState.CREATED: {
                    return;
                }
                case AppState.INITIALIZED: {
                    throw new AppAlreadyMarkedAsError(AppState.SHUTTING_DOWN);
                }
                case AppState.STARTED: {
                    throw new AppAlreadyMarkedAsError(AppState.STARTED);
                }
                case AppState.SHUTTING_DOWN: {
                    throw new AppAlreadyMarkedAsError(AppState.SHUTTING_DOWN);
                }
            }
        },
        [AppState.STARTED]: () => {
            switch (this.appData.state) {
                case AppState.CREATED:
                case AppState.OFFLINE: {
                    throw new AppNotYetMarkedAsError(AppState.INITIALIZED);
                }
                case AppState.INITIALIZED: {
                    return;
                }
                case AppState.STARTED: {
                    throw new AppAlreadyMarkedAsError(AppState.STARTED);
                }
                case AppState.SHUTTING_DOWN: {
                    throw new AppAlreadyMarkedAsError(AppState.SHUTTING_DOWN);
                }
            }
        },
        [AppState.SHUTTING_DOWN]: () => {
            switch (this.appData.state) {
                case AppState.CREATED:
                case AppState.INITIALIZED:
                case AppState.STARTED: {
                    return;
                }
                case AppState.OFFLINE: {
                    throw new AppNotYetMarkedAsError(AppState.CREATED);
                }
                case AppState.SHUTTING_DOWN: {
                    throw new AppAlreadyMarkedAsError(AppState.SHUTTING_DOWN);
                }
            }
        }
    };

    /**
     * Gets the app data at the provided key.
     * @param key - The key to get the data from.
     * @returns The app data at the provided key.
     */
    static getAppData<K extends keyof AppData>(key: K): AppData[K] {
        return this.appData[key];
    }

    /**
     * Sets the app data.
     * @param options - The application options provided from index.ts.
     */
    static setAppData(options: ZibriApplicationOptions): void {
        this.appData.name = options.name;
        this.appData.version = options.version;
        this.appData.baseUrl = options.baseUrl;
    }

    /**
     * Marks the app as created.
     */
    static markAppAsCreated(): void {
        this.changeAppState(AppState.CREATED);
    }

    /**
     * Marks the app as initialized.
     */
    static markAppAsInitialized(): void {
        this.changeAppState(AppState.INITIALIZED);
    }

    /**
     * Marks the app as started.
     */
    static markAppAsStarted(): void {
        this.changeAppState(AppState.STARTED);
    }

    /**
     * Marks the app as shutting down.
     */
    static markAppAsShuttingDown(): void {
        this.changeAppState(AppState.SHUTTING_DOWN);
    }

    /**
     * Checks if the app has been started.
     * @returns True when the app has the state of AppState.STARTED, false otherwise.
     */
    static isAppStarted(): boolean {
        return this.appData.state === AppState.STARTED;
    }

    /**
     * Checks if the app is initialized.
     * @returns True when the app has the state of AppState.INITIALIZED, false otherwise.
     */
    static isAppInitialized(): boolean {
        return this.appData.state === AppState.INITIALIZED;
    }

    /**
     * Checks if the app is created.
     * @returns True when the app has the state of AppState.CREATED, false otherwise.
     */
    static isAppCreated(): boolean {
        return this.appData.state === AppState.CREATED;
    }

    /**
     * Checks if the app is offline.
     * @returns True when the app has the state of AppState.OFFLINE, false otherwise.
     */
    static isAppOffline(): boolean {
        return this.appData.state === AppState.OFFLINE;
    }

    /**
     * Checks if the app is shutting down.
     * @returns True when the app has the state of AppState.SHUTTING_DOWN, false otherwise.
     */
    static isAppShuttingDown(): boolean {
        return this.appData.state === AppState.SHUTTING_DOWN;
    }

    private static changeAppState(state: AppState): void {
        this.validateAppStateChange[state]();
        this.appData.state = state;
    }
}