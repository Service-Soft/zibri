import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders, rolesAndPermissionsProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Auth } from '../auth/decorators/auth.decorator';
import { definePermissions } from '../auth/roles/define-permissions.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { MigrationEntity } from '../data-source/migration/migration-entity.model';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { BaseEntity } from '../entity/base-entity.model';
import { BaseTenantEntity } from '../entity/base-tenant-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Newable } from '../types/newable.type';
import { RowShare } from './row-share.model';

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions(['boards.read', 'boards.undeclared'] as const);

@Entity({ allowOrphan: true, shareable: { fullAccess: Permissions.BOARDS_READ, roles: ['viewer'] } })
class StartupBoard extends BaseTenantEntity() {
    @Property.string()
    name!: string;
}

/**
 * A lane that is not shareable, so the cards shared through it are shared through nothing.
 */
@Entity({ allowOrphan: true })
class StartupLane extends BaseTenantEntity() {}

@Entity({ allowOrphan: true, sharedThrough: 'lane' })
class StartupCard extends BaseTenantEntity() {
    @Property.string({ format: 'uuid' })
    laneId!: string;

    @Property.manyToOne({ target: () => StartupLane, joinColumn: 'laneId', inverseSide: 'id' })
    lane!: StartupLane;
}

@Entity({ allowOrphan: true, shareable: { fullAccess: Permissions.BOARDS_UNDECLARED, roles: ['viewer'] } })
class UndeclaredBoard extends BaseTenantEntity() {}

/**
 * Keeps the shares apart from the users and the boards.
 */
@DataSource({ allowOrphan: true })
class SharesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, RowShare];
    override readonly repositories: RepositoryClass[] = [];
}

/**
 * Keeps the boards apart from the shares.
 */
@DataSource({ allowOrphan: true })
class BoardsDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, StartupBoard];
    override readonly repositories: RepositoryClass[] = [];
}

@Controller('/boards', { allowOrphan: true })
class StartupBoardController {
    @Auth.requireShareRole(StartupBoard, 'owner', 'id')
    @Get('/:id')
    read(): void {}
}

/**
 * Starts an application with the given entities, declaring only `boards.read`.
 * @param entities - The entities beside those of the test server.
 * @param controllers - The controllers.
 * @returns The start.
 */
async function start(entities: Newable<BaseEntity>[], controllers: Newable<unknown>[] = []): Promise<StartedTestServer> {
    return await startTestServer({
        dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, ...entities], repositories: defaultTestServerRepositories, allowOrphan: true })],
        controllers,
        providers: [
            ...defaultTestServerProviders,
            ...rolesAndPermissionsProviders({ permissions: [Permissions.BOARDS_READ], platformPermissions: [] }, [])
        ]
    });
}

describe('ShareService - starting', () => {
    it('refuses an entity shared through relations that reach no shareable entity', async () => {
        await expect(start([RowShare, StartupLane, StartupCard])).rejects.toThrow(/StartupCard is shared through StartupCard -> StartupLane/);
    }, TestTimeouts.inMemory.start);

    it('refuses a shareable entity whose full access is no declared permission', async () => {
        await expect(start([RowShare, UndeclaredBoard])).rejects.toThrow(/'boards.undeclared'/);
    }, TestTimeouts.inMemory.start);

    it('refuses a shareable entity without the shares', async () => {
        await expect(start([StartupBoard])).rejects.toThrow(/RowShare/);
    }, TestTimeouts.inMemory.start);

    it('refuses a route requiring a role the entity does not declare', async () => {
        await expect(start([RowShare, StartupBoard], [StartupBoardController])).rejects.toThrow(/names the role 'owner', which is none of viewer/);
    }, TestTimeouts.inMemory.start);

    it('refuses the shares in another data source than the users and a shareable entity', async () => {
        const starting: Promise<StartedTestServer> = startTestServer({
            dataSources: [
                createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories, allowOrphan: true }),
                SharesDataSource,
                BoardsDataSource
            ],
            providers: [
                ...defaultTestServerProviders,
                ...rolesAndPermissionsProviders({ permissions: [Permissions.BOARDS_READ], platformPermissions: [] }, [])
            ]
        });

        await expect(starting).rejects.toThrow(/needs RowShare in the data source of the users and of every shareable entity/);
        await expect(starting).rejects.toThrow(/RowShare is in SharesDataSource, and JwtUser in TestInMemoryDataSource, StartupBoard in BoardsDataSource\./);
    }, TestTimeouts.inMemory.start);
});
