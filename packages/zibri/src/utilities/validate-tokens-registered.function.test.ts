import { afterEach, describe, expect, it } from '@jest/globals';

import { validateTokensRegistered } from './validate-tokens-registered.function';
import { TestTimeouts } from '../__testing__/constants';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { InjectionToken } from '../di/models/injection-token.model';
import { AppState } from '../global/app-state.enum';
import { GlobalRegistry } from '../global/global-registry';
import { ZibriPlugin } from '../plugin/plugin.model';

const UNREGISTERED_TOKEN: InjectionToken<string> = new InjectionToken<string>('UNREGISTERED_SCRATCH_TOKEN');

class ScratchValidatePlugin extends ZibriPlugin {

    validate(): void {
        validateTokensRegistered('ScratchValidatePlugin', { UNREGISTERED_TOKEN });
    }
}

describe('validateTokensRegistered', () => {
    let server: StartedTestServer | undefined;

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
        GlobalRegistry['appData'].state = AppState.OFFLINE;
    }, TestTimeouts.postgres.shutdown);

    it('rejects app startup with a MissingTokensError when a token cannot be injected', async () => {
        await expect(startTestServer({
            plugins: [new ScratchValidatePlugin()]
        })).rejects.toThrow(/Could not inject the following tokens.*UNREGISTERED_SCRATCH_TOKEN/s);
    }, TestTimeouts.postgres.start);
});