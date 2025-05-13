import { ZibriApplicationOptions } from '../application-options.model';
import { DiProvider } from '../di';
import { BodyParserInterface } from '../parsing';
import { Newable } from '../types';

export enum AppState {
    OFFLINE = 'offline',
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
    static readonly bodyParsers: Newable<BodyParserInterface>[] = [];

    private static readonly validateAppStateChange: Record<AppState, () => void> = {
        [AppState.OFFLINE]: () => {
            throw new Error(`Cannot manually mark an an app as "${AppState.OFFLINE}".`);
        },
        [AppState.INITIALIZED]: () => {
            switch (this.appData.state) {
                case AppState.OFFLINE: {
                    return;
                }
                case AppState.INITIALIZED: {
                    throw new Error('The app has already been marked as initialized.');
                }
                case AppState.RUNNING: {
                    throw new Error(`Cannot change the app state from "${AppState.RUNNING}" to "${AppState.INITIALIZED}"`);
                }
            }
        },
        [AppState.RUNNING]: () => {
            switch (this.appData.state) {
                case AppState.OFFLINE: {
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

    private static changeAppState(state: AppState): void {
        this.validateAppStateChange[state]();
        this.appData.state = state;
    }
}