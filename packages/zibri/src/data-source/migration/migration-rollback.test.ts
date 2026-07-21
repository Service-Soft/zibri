import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { MigrationEntity } from './migration-entity.model';
import { Migration } from './migration.model';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { InjectRepository, repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { PostgresDataSource } from '../data-sources/postgres-typeorm-data-source.model';
import { Repository } from '../repository';
import { Transaction } from '../transaction/transaction.model';

@Entity()
class MigrationRollbackItem {
    @Property.string({ primary: true })
    id!: string;

    @Property.string()
    value!: string;
}

const dataSourceClass: Newable<PostgresDataSource> = createTestDataSource({
    entities: [...defaultTestServerEntities, MigrationRollbackItem]
});

@Injectable()
class SucceedingMigration extends Migration {
    version: SemVerVersion = '0.1.0';

    private createdId: string | undefined;

    constructor(
        @InjectRepository(MigrationRollbackItem)
        private readonly itemRepository: Repository<MigrationRollbackItem>
    ) {
        super(dataSourceClass);
    }

    override async up(transaction: Transaction): Promise<void> {
        const item: MigrationRollbackItem = await this.itemRepository.create({ value: 'seeded' }, { transaction });
        this.createdId = item.id;
    }

    override async down(transaction: Transaction): Promise<void> {
        await this.itemRepository.deleteAll({ value: 'seeded' }, { transaction });
        this.createdId = undefined;
    }
}

@Injectable()
class FailingUpMigration extends Migration {
    version: SemVerVersion = '0.2.0';

    constructor(
        @InjectRepository(MigrationRollbackItem)
        private readonly itemRepository: Repository<MigrationRollbackItem>
    ) {
        super(dataSourceClass);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.itemRepository.create({ value: 'should-be-rolled-back' }, { transaction });
        throw new Error('up failed after partial work');
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('not needed for this test');
    }
}

@Injectable()
class FailingDownMigration extends Migration {
    version: SemVerVersion = '0.3.0';

    constructor(
        @InjectRepository(MigrationRollbackItem)
        private readonly itemRepository: Repository<MigrationRollbackItem>
    ) {
        super(dataSourceClass);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.itemRepository.create({ value: 'should-survive' }, { transaction });
    }

    override async down(transaction: Transaction): Promise<void> {
        await this.itemRepository.deleteAll({ value: 'should-survive' }, { transaction });
        throw new Error('down failed after partial work');
    }
}

describe('Migration rollback behavior', () => {
    let server: StartedTestServer;
    let itemRepository: Repository<MigrationRollbackItem>;
    let migrationRepository: Repository<MigrationEntity>;

    beforeAll(async () => {
        server = await startTestServer({ dataSources: [dataSourceClass] });
        itemRepository = inject(repositoryTokenFor(MigrationRollbackItem));
        migrationRepository = inject(repositoryTokenFor(MigrationEntity));
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('runUp commits the migration data and records a migration entity', async () => {
        const migration: SucceedingMigration = inject(SucceedingMigration);

        await migration.runUp();

        const items: MigrationRollbackItem[] = await itemRepository.findAll({ where: { value: 'seeded' } });
        expect(items).toHaveLength(1);

        const record: MigrationEntity = await migrationRepository.findOne({ where: { version: '0.1.0' } });
        expect(record).not.toBeNull();
    });

    it('runDown reverses the migration data and removes the migration entity', async () => {
        const migration: SucceedingMigration = inject(SucceedingMigration);

        await migration.runDown();

        const items: MigrationRollbackItem[] = await itemRepository.findAll({ where: { value: 'seeded' } });
        expect(items).toHaveLength(0);

        const records: MigrationEntity[] = await migrationRepository.findAll({ where: { version: '0.1.0' } });
        expect(records).toHaveLength(0);
    });

    it('runUp rolls back all writes and rethrows if the migration body throws', async () => {
        const migration: FailingUpMigration = inject(FailingUpMigration);

        await expect(migration.runUp()).rejects.toThrow('up failed after partial work');

        // the create() inside up() must have been rolled back
        const items: MigrationRollbackItem[] = await itemRepository.findAll({ where: { value: 'should-be-rolled-back' } });
        expect(items).toHaveLength(0);

        // no migration entity should have been recorded either
        const records: MigrationEntity[] = await migrationRepository.findAll({ where: { version: '0.2.0' } });
        expect(records).toHaveLength(0);
    });

    it('runDown rolls back all writes and rethrows if the migration body throws', async () => {
        const migration: FailingDownMigration = inject(FailingDownMigration);

        await migration.runUp();
        const beforeDown: MigrationRollbackItem[] = await itemRepository.findAll({ where: { value: 'should-survive' } });
        expect(beforeDown).toHaveLength(1);

        await expect(migration.runDown()).rejects.toThrow('down failed after partial work');

        // the deleteAll() inside down() must have been rolled back too
        const afterDown: MigrationRollbackItem[] = await itemRepository.findAll({ where: { value: 'should-survive' } });
        expect(afterDown).toHaveLength(1);

        // the migration entity recorded by runUp() must still be present, since runDown's delete was rolled back
        const records: MigrationEntity[] = await migrationRepository.findAll({ where: { version: '0.3.0' } });
        expect(records).toHaveLength(1);
    });
});