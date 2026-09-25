import { AppState } from './app-state.enum';
import { registerFrameworkCopy } from './framework-copies';
import { ZibriApplicationOptions } from '../application/application-options.model';
import { DiProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { InternalError } from '../error-handling/internal-error.model';
import { Newable } from '../types/newable.type';
import { SemVerVersion } from '../versioning/sem-ver.utilities';

// counted from here because everything that uses the framework at all loads this module, and a
// second evaluation of it is precisely what a second copy of the framework is
registerFrameworkCopy();

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
     * All entities registered with \@Entity.
     */
    static readonly entityClasses: Newable<BaseEntity>[] = [];

    private static readonly validateAppStateChange: Record<AppState, () => void> = {
        [AppState.OFFLINE]: () => {
            switch (this.appData.state) {
                case AppState.SHUTTING_DOWN: {
                    return;
                }
                case AppState.OFFLINE: {
                    throw new AppAlreadyMarkedAsError(AppState.OFFLINE);
                }
                case AppState.CREATED:
                case AppState.INITIALIZED:
                case AppState.STARTED: {
                    // going straight to offline would skip every shutdown hook, so the state machine
                    // is what refuses it rather than each caller having to remember
                    throw new AppNotYetMarkedAsError(AppState.SHUTTING_DOWN);
                }
            }
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
     * Marks the app as offline, which is the end of its lifecycle.
     *
     * Without this the state machine has no way back to where it started, so a process that has run
     * one application can never run another - and the error a second one gets is about a state rather
     * than about anything it did.
     *
     * What is deliberately *not* cleared is everything the decorators registered. `@Entity`,
     * `@Injectable` and `@DataSource` run when their module is first loaded and never again, so
     * dropping those arrays would leave the next application with nothing to build from.
     */
    static markAppAsOffline(): void {
        this.changeAppState(AppState.OFFLINE);
        this.appData.name = undefined;
        this.appData.version = undefined;
        this.appData.baseUrl = undefined;
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