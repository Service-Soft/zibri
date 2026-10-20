import { afterEach, describe, expect, it } from 'vitest';

import { validateEntitiesRegistered } from './validate-entities-registered.function.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { ZibriApplication } from '../application/application.ts';
import { BaseEntity } from '../entity/base-entity.model.ts';
import { Entity } from '../entity/decorators/entity.decorator.ts';
import { AppState } from '../global/app-state.enum.ts';
import { GlobalRegistry } from '../global/global-registry.ts';
import { ZibriPlugin } from '../plugin/plugin.model.ts';

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
    }, 15000);

    it('rejects app startup with a MissingEntitiesError when an entity is not registered in any data source', async () => {
        await expect(startTestServer({
            plugins: [new ScratchValidatePlugin()]
        })).rejects.toThrow(/Could not find data source for the following entities.*UnregisteredScratchEntity/s);
    }, 30000);
});