import { afterEach, describe, expect, it } from '@jest/globals';

import { validateEntitiesRegistered } from './validate-entities-registered.function';
import { TestTimeouts } from '../__testing__/constants';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZibriApplication } from '../application/application';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { AppState } from '../global/app-state.enum';
import { GlobalRegistry } from '../global/global-registry';
import { ZibriPlugin } from '../plugin/plugin.model';

@Entity({ tenant: 'shared', allowOrphan: true })
class UnregisteredScratchEntity extends BaseEntity {}

class ScratchValidatePlugin extends ZibriPlugin {

    validate(app: ZibriApplication): void {
        validateEntitiesRegistered('ScratchValidatePlugin', app, UnregisteredScratchEntity);
    }
}

describe('validateEntitiesRegistered', () => {
    let server: StartedTestServer | undefined;

    afterEach(async () => {
        await server?.shutdown();
        server = undefined;
        GlobalRegistry['appData'].state = AppState.OFFLINE;
    }, TestTimeouts.postgres.shutdown);

    it('rejects app startup with a MissingEntitiesError when an entity is not registered in any data source', async () => {
        await expect(startTestServer({
            plugins: [new ScratchValidatePlugin()]
        })).rejects.toThrow(/Could not find data source for the following entities.*UnregisteredScratchEntity/s);
    }, TestTimeouts.postgres.start);
});