import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders, rolesAndPermissionsProviders } from '../../__testing__/test-server/providers';
import { startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZibriServiceAccountPlatformPermissions } from '../../auth/service-account/zibri-service-account-permissions.model';
import { ApiKey } from '../../auth/strategies/api-key/api-key.model';
import { Controller } from '../../routing/decorators/controller.decorator';
import { ServiceAccountMcpToolController } from './service-account-mcp-tool.controller';

// what the route answers is covered beside the routes of the service accounts, in service-account.controller.test.ts

@Controller('/service-account-tools', { versions: 'all' })
class AppServiceAccountMcpToolController extends ServiceAccountMcpToolController {}

describe('the route of the MCP tools of a service account', () => {
    it('keeps an application without the MCP plugin from starting', async () => {
        await expect(startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, ApiKey], repositories: defaultTestServerRepositories })],
            controllers: [AppServiceAccountMcpToolController],
            providers: [
                ...defaultTestServerProviders,
                ...rolesAndPermissionsProviders({ permissions: [], platformPermissions: Object.values(ZibriServiceAccountPlatformPermissions) }, [])
            ]
        })).rejects.toThrow(/ServiceAccountMcpToolController/);
    }, TestTimeouts.inMemory.start);
});
