import { MigrationEntity } from './migration-entity.model';
import { inject, repositoryTokenFor } from '../../di';
import { Newable, Version } from '../../types';
import { DataSourceInterface } from '../data-sources';
import { Repository } from '../repository';
import { Transaction } from '../transaction';

/**
 * Base class for a data source migration.
 */
export abstract class Migration {
    abstract readonly version: Version;
    /**
     * The data source that the migration is for.
     */
    protected readonly dataSource: DataSourceInterface;
    /**
     * The repository that syncs migrations back and forth to the data source.
     */
    protected readonly migrationRepository: Repository<MigrationEntity>;

    constructor(dataSourceClass: Newable<DataSourceInterface>) {
        this.dataSource = inject(dataSourceClass);
        this.migrationRepository = inject(repositoryTokenFor(MigrationEntity));
    }

    /**
     * Runs the migration.
     */
    async runUp(): Promise<void> {
        const transaction: Transaction = await this.dataSource.startTransaction();
        try {
            await this.up(transaction);
            await this.migrationRepository.create(
                {
                    version: this.version,
                    name: this.constructor.name,
                    ranAt: new Date()
                },
                { transaction }
            );
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Revers the migration.
     */
    async runDown(): Promise<void> {
        const transaction: Transaction = await this.dataSource.startTransaction();
        try {
            await this.down(transaction);
            await this.migrationRepository.deleteAll({ version: this.version }, { transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    protected abstract up(transaction: Transaction): Promise<void>;
    protected abstract down(transaction: Transaction): Promise<void>;
}