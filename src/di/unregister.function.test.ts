import { afterEach, describe, expect, it } from '@jest/globals';

import { NoProviderError } from './errors/no-provider.error';
import { inject } from './inject.function';
import { register } from './register.function';
import { unregister } from './unregister.function';
import { AppState } from '../global/app-state.enum';
import { GlobalRegistry } from '../global/global-registry';

function resetToOffline(): void {
    GlobalRegistry['appData'].state = AppState.OFFLINE;
}

class UnregisterTestService {}

describe('unregister', () => {
    afterEach(() => {
        resetToOffline();
    });

    it('removes the provider so a later inject throws NoProviderError', () => {
        register({ token: UnregisterTestService, useClass: UnregisterTestService });
        unregister(UnregisterTestService);
        expect(() => inject(UnregisterTestService)).toThrow(NoProviderError);
    });

    it('throws when the app is already initialized', () => {
        register({ token: UnregisterTestService, useClass: UnregisterTestService });
        GlobalRegistry.markAppAsCreated();
        GlobalRegistry.markAppAsInitialized();
        expect(() => unregister(UnregisterTestService)).toThrow(/only unregister providers before the app has been initialized/);
    });

    it('throws when the app is already started', () => {
        register({ token: UnregisterTestService, useClass: UnregisterTestService });
        GlobalRegistry.markAppAsCreated();
        GlobalRegistry.markAppAsInitialized();
        GlobalRegistry.markAppAsStarted();
        expect(() => unregister(UnregisterTestService)).toThrow(/only unregister providers before the app has been initialized/);
    });
});