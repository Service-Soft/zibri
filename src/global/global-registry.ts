import { ZibriApplicationOptions } from '../application-options.model';
import { BaseDataSource, BaseEntity } from '../data-source';
import { DiProvider } from '../di';
import { BodyParserInterface } from '../parsing';
import { Newable } from '../types';

export enum AppState {
    OFFLINE = 'offline',
    CREATED = 'created',
    INITIALIZED = 'initialized',
    RUNNING = 'running'
}

export type AppData = {
    state: AppState,
    name?: string
};

export abstract class GlobalRegistry {
    private static readonly appData: AppData = {
        state: AppState.OFFLINE
    };
    static readonly injectables: DiProvider<unknown>[] = [];
    static readonly controllerClasses: Newable<Object>[] = [];
    static readonly dataSourceClasses: Newable<BaseDataSource>[] = [];
    static readonly entityClasses: Newable<BaseEntity>[] = [];
    static readonly bodyParsers: Newable<BodyParserInterface>[] = [];

    private static readonly validateAppStateChange: Record<AppState, () => void> = {
        [AppState.OFFLINE]: () => {
            throw new Error(`Cannot manually mark an an app as "${AppState.OFFLINE}".`);
        },
        [AppState.CREATED]: () => {
            switch (this.appData.state) {
                case AppState.OFFLINE: {
                    return;
                }
                case AppState.CREATED: {
                    throw new Error('The app has already been marked as created.');
                }
                case AppState.INITIALIZED: {
                    throw new Error('The app has already been marked as initialized.');
                }
                case AppState.RUNNING: {
                    throw new Error('The app has already been marked as running.');
                }
            }
        },
        [AppState.INITIALIZED]: () => {
            switch (this.appData.state) {
                case AppState.OFFLINE: {
                    throw new Error('The app has not been marked as created yet.');
                }
                case AppState.CREATED: {
                    return;
                }
                case AppState.INITIALIZED: {
                    throw new Error('The app has already been marked as initialized.');
                }
                case AppState.RUNNING: {
                    throw new Error('The app has already been marked as running');
                }
            }
        },
        [AppState.RUNNING]: () => {
            switch (this.appData.state) {
                case AppState.OFFLINE: {
                    throw new Error('The app has not been marked as initialized yet.');
                }
                case AppState.CREATED: {
                    throw new Error('The app has not been marked as initialized yet.');
                }
                case AppState.INITIALIZED: {
                    return;
                }
                case AppState.RUNNING: {
                    throw new Error('The app has already been marked as running.');
                }
            }
        }
    };

    static getAppData<K extends keyof AppData>(key: K): AppData[K] {
        return this.appData[key];
    }

    static setAppData(options: ZibriApplicationOptions): void {
        this.appData.name = options.name;
    }

    static markAppAsCreated(): void {
        this.changeAppState(AppState.CREATED);
    }

    static markAppAsInitialized(): void {
        this.changeAppState(AppState.INITIALIZED);
    }

    static markAppAsRunning(): void {
        this.changeAppState(AppState.RUNNING);
    }

    static isAppRunning(): boolean {
        return this.appData.state === AppState.RUNNING;
    }

    static isAppInitialized(): boolean {
        return this.appData.state === AppState.INITIALIZED;
    }

    static isAppCreated(): boolean {
        return this.appData.state === AppState.CREATED;
    }

    private static changeAppState(state: AppState): void {
        this.validateAppStateChange[state]();
        this.appData.state = state;
    }
}