import { beforeEach, describe, expect, it } from '@jest/globals';

import { AppState } from './app-state.enum';
import { GlobalRegistry } from './global-registry';
import { ZibriApplicationOptions } from '../application-options.model';

function resetToOffline(): void {
    GlobalRegistry['appData'].state = AppState.OFFLINE;
    GlobalRegistry['appData'].name = undefined;
    GlobalRegistry['appData'].version = undefined;
    GlobalRegistry['appData'].baseUrl = undefined;
}

describe('GlobalRegistry', () => {
    beforeEach(() => {
        resetToOffline();
    });

    describe('initial state', () => {
        it('starts offline', () => {
            expect(GlobalRegistry.isAppOffline()).toBe(true);
            expect(GlobalRegistry.isAppCreated()).toBe(false);
            expect(GlobalRegistry.isAppInitialized()).toBe(false);
            expect(GlobalRegistry.isAppStarted()).toBe(false);
            expect(GlobalRegistry.isAppShuttingDown()).toBe(false);
        });
    });

    describe('the full valid transition sequence', () => {
        it('moves offline -> created -> initialized -> started -> shutting down', () => {
            expect(() => GlobalRegistry.markAppAsCreated()).not.toThrow();
            expect(GlobalRegistry.isAppCreated()).toBe(true);

            expect(() => GlobalRegistry.markAppAsInitialized()).not.toThrow();
            expect(GlobalRegistry.isAppInitialized()).toBe(true);

            expect(() => GlobalRegistry.markAppAsStarted()).not.toThrow();
            expect(GlobalRegistry.isAppStarted()).toBe(true);

            expect(() => GlobalRegistry.markAppAsShuttingDown()).not.toThrow();
            expect(GlobalRegistry.isAppShuttingDown()).toBe(true);
        });
    });

    describe('markAppAsCreated', () => {
        it('throws when already created', () => {
            GlobalRegistry.markAppAsCreated();
            expect(() => GlobalRegistry.markAppAsCreated()).toThrow(/already been marked as "created"/);
        });

        it('throws when already initialized', () => {
            GlobalRegistry.markAppAsCreated();
            GlobalRegistry.markAppAsInitialized();
            expect(() => GlobalRegistry.markAppAsCreated()).toThrow(/already been marked as "initialized"/);
        });

        it('throws when already started', () => {
            GlobalRegistry.markAppAsCreated();
            GlobalRegistry.markAppAsInitialized();
            GlobalRegistry.markAppAsStarted();
            expect(() => GlobalRegistry.markAppAsCreated()).toThrow(/already been marked as "started"/);
        });

        it('throws when already shutting down', () => {
            GlobalRegistry.markAppAsCreated();
            GlobalRegistry.markAppAsInitialized();
            GlobalRegistry.markAppAsStarted();
            GlobalRegistry.markAppAsShuttingDown();
            expect(() => GlobalRegistry.markAppAsCreated()).toThrow(/already been marked as "shutting down"/);
        });
    });

    describe('markAppAsInitialized', () => {
        it('throws when the app has not been marked as created yet', () => {
            expect(() => GlobalRegistry.markAppAsInitialized()).toThrow(/has not been marked as "created" yet/);
        });

        it('throws when already initialized (regression: previously reported the wrong state)', () => {
            GlobalRegistry.markAppAsCreated();
            GlobalRegistry.markAppAsInitialized();
            expect(() => GlobalRegistry.markAppAsInitialized()).toThrow(/already been marked as "initialized"/);
        });

        it('throws when already started', () => {
            GlobalRegistry.markAppAsCreated();
            GlobalRegistry.markAppAsInitialized();
            GlobalRegistry.markAppAsStarted();
            expect(() => GlobalRegistry.markAppAsInitialized()).toThrow(/already been marked as "started"/);
        });
    });

    describe('markAppAsStarted', () => {
        it('throws when the app has not been marked as initialized yet (from offline)', () => {
            expect(() => GlobalRegistry.markAppAsStarted()).toThrow(/has not been marked as "initialized" yet/);
        });

        it('throws when the app has not been marked as initialized yet (from created)', () => {
            GlobalRegistry.markAppAsCreated();
            expect(() => GlobalRegistry.markAppAsStarted()).toThrow(/has not been marked as "initialized" yet/);
        });

        it('throws when already started', () => {
            GlobalRegistry.markAppAsCreated();
            GlobalRegistry.markAppAsInitialized();
            GlobalRegistry.markAppAsStarted();
            expect(() => GlobalRegistry.markAppAsStarted()).toThrow(/already been marked as "started"/);
        });
    });

    describe('markAppAsShuttingDown', () => {
        it('throws when the app has not been marked as created yet', () => {
            expect(() => GlobalRegistry.markAppAsShuttingDown()).toThrow(/has not been marked as "created" yet/);
        });

        it('succeeds from created', () => {
            GlobalRegistry.markAppAsCreated();
            expect(() => GlobalRegistry.markAppAsShuttingDown()).not.toThrow();
        });

        it('succeeds from initialized', () => {
            GlobalRegistry.markAppAsCreated();
            GlobalRegistry.markAppAsInitialized();
            expect(() => GlobalRegistry.markAppAsShuttingDown()).not.toThrow();
        });

        it('succeeds from started', () => {
            GlobalRegistry.markAppAsCreated();
            GlobalRegistry.markAppAsInitialized();
            GlobalRegistry.markAppAsStarted();
            expect(() => GlobalRegistry.markAppAsShuttingDown()).not.toThrow();
        });

        it('throws when already shutting down', () => {
            GlobalRegistry.markAppAsCreated();
            GlobalRegistry.markAppAsInitialized();
            GlobalRegistry.markAppAsStarted();
            GlobalRegistry.markAppAsShuttingDown();
            expect(() => GlobalRegistry.markAppAsShuttingDown()).toThrow(/already been marked as "shutting down"/);
        });
    });

    describe('app data', () => {
        it('setAppData stores name, version and baseUrl', () => {
            const options: ZibriApplicationOptions = {
                name: 'my-app',
                version: '1.2.3',
                baseUrl: 'http://localhost:3000'
            } as ZibriApplicationOptions;

            GlobalRegistry.setAppData(options);

            expect(GlobalRegistry.getAppData('name')).toBe('my-app');
            expect(GlobalRegistry.getAppData('version')).toBe('1.2.3');
            expect(GlobalRegistry.getAppData('baseUrl')).toBe('http://localhost:3000');
        });
    });
});