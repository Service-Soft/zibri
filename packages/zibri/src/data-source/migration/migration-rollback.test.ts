import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { MigrationEntity } from './migration-entity.model.ts';
import { Migration } from './migration.model.ts';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { InjectRepository, repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { SemVerVersion } from '../../versioning/sem-ver.utilities.ts';
import { PostgresDataSource } from '../data-sources/postgres/postgres-typeorm-data-source.model.ts';
import { Repository } from '../repository/repository.ts';
import { Transaction } from '../transaction/transaction.model.ts';

@Entity({ tenant: 'shared' })
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

    constructor(
        @InjectRepository(MigrationRollbackItem)
        private readonly itemRepository: Repository<MigrationRollbackItem>
    ) {
        super(dataSourceClass);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.itemRepository.create({ value: 'seeded' }, { transaction });
    }

    override async down(transaction: Transaction): Promise<void> {
        await this.itemRepository.deleteAll({ value: 'seeded' }, { transaction });
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
    }, 30000);

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