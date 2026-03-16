import { ZibriApplicationOptions } from '../application-options.model';
import { AppState } from './app-state.enum';
import { UserRepositories } from '../auth/models/user-repositories.model';
import { BackupResourceInterface } from '../backup/backup-resource.interface';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { DiProvider } from '../di/models/di-provider.model';
import { BaseEntity } from '../entity/base-entity.model';
import { BodyParserInterface } from '../parsing/body-parser.interface';
import { Newable } from '../types/newable.type';
import { Version } from '../types/version.type';

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
    version?: Version
};

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
     * All controllers registered with \@Controller.
     */
    static readonly controllerClasses: Newable<unknown>[] = [];
    /**
     * All websocket controllers registered with \@WebsocketController.
     */
    static readonly websocketControllerClasses: Newable<unknown>[] = [];
    /**
     * All datasources registered with \@DataSource.
     */
    static readonly dataSourceClasses: Newable<DataSourceInterface>[] = [];
    /**
     * All entities registered with \@Entity.
     */
    static readonly entityClasses: Newable<BaseEntity>[] = [];
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
                case AppState.STARTED: {
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
                case AppState.STARTED: {
                    throw new Error('The app has already been marked as running');
                }
            }
        },
        [AppState.STARTED]: () => {
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
                case AppState.STARTED: {
                    throw new Error('The app has already been marked as running.');
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
     * Marks the app as running.
     */
    static markAppAsRunning(): void {
        this.changeAppState(AppState.STARTED);
    }

    /**
     * Checks if the app is running.
     * @returns True when the app has the state of running, false otherwise.
     */
    static isAppRunning(): boolean {
        return this.appData.state === AppState.STARTED;
    }

    /**
     * Checks if the app is initialized.
     * @returns True when the app has the state of initialized, false otherwise.
     */
    static isAppInitialized(): boolean {
        return this.appData.state === AppState.INITIALIZED;
    }

    /**
     * Checks if the app is created.
     * @returns True when the app has the state of created, false otherwise.
     */
    static isAppCreated(): boolean {
        return this.appData.state === AppState.CREATED;
    }

    private static changeAppState(state: AppState): void {
        this.validateAppStateChange[state]();
        this.appData.state = state;
    }
}