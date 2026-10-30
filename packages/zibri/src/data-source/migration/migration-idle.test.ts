import { setTimeout as sleep } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { Migration } from './migration.model';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { InjectRepository, repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * Longer than a transaction may sit idle when it does not say otherwise, which is ten seconds.
 */
const PAUSE_IN_MS: number = 10500;

@Entity({ tenant: 'shared' })
class MigrationPauseItem extends BaseEntity {
    @Property.string()
    value!: string;
}

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, MigrationPauseItem],
    repositories: defaultTestServerRepositories
});

/**
 * A data migration that waits on something slow between two of its writes, such as a remote call.
 */
@Injectable()
class PausingMigration extends Migration {
    version: SemVerVersion = '0.1.0';

    constructor(
        @InjectRepository(MigrationPauseItem)
        private readonly itemRepository: Repository<MigrationPauseItem>
    ) {
        super(dataSourceClass);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.itemRepository.create({ value: 'before the pause' }, { transaction });
        await sleep(PAUSE_IN_MS);
        await this.itemRepository.create({ value: 'after the pause' }, { transaction });
    }

    override async down(transaction: Transaction): Promise<void> {
        await this.itemRepository.deleteAll({}, { transaction });
    }
}

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// evaluation round 2, 02 §S13: a migration's transaction was rolled back after ten idle seconds,
// whatever the migration's own limit said, so a migration waiting on something slow failed
describe('a migration waiting between two of its writes', () => {
    it('keeps its transaction for as long as the migration may take', async () => {
        await inject(PausingMigration).runUp();

        const items: MigrationPauseItem[] = await inject<Repository<MigrationPauseItem>>(repositoryTokenFor(MigrationPauseItem)).findAll();
        expect(items.map(i => i.value).sort()).toEqual(['after the pause', 'before the pause']);
    }, PAUSE_IN_MS + TestTimeouts.inMemory.restart);
});