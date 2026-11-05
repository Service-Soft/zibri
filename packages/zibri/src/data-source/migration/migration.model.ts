import { MigrationEntity } from './migration-entity.model';
import { AlsUtilities } from '../../context/als.utilities';
import { OperationLimitUtilities } from '../../context/operation-limit.utilities';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { Newable } from '../../types/newable.type';
import { SemVerVersion } from '../../utilities/sem-ver.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * Base class for a data source migration.
 */
export abstract class Migration {
    abstract readonly version: SemVerVersion;
    /**
     * The data source that the migration is for.
     */
    protected readonly dataSource: DataSourceInterface;
    /**
     * The repository that syncs migrations back and forth to the data source.
     */
    protected readonly migrationRepository: Repository<MigrationEntity>;
    /**
     * How long this migration may take, in milliseconds, in place of the data source's
     * `migrationTimeoutInMs`. 0 for no limit.
     */
    readonly timeoutInMs: number | undefined = undefined;

    constructor(dataSourceClass: Newable<DataSourceInterface>) {
        this.dataSource = inject(dataSourceClass);
        this.migrationRepository = inject(repositoryTokenFor(MigrationEntity, dataSourceClass));
    }

    /**
     * Runs the migration.
     */
    async runUp(): Promise<void> {
        await this.runWithinTimeout(async () => {
            const transaction: Transaction = await this.startMigrationTransaction();
            try {
                // so that what refuses to run during a migration - an encryption strategy that needs
                // the application up, for one - knows that this is one
                await AlsUtilities.runInMigration(this.constructor.name, () => this.up(transaction));
                await this.migrationRepository.create(
                    {
                        version: this.version,
                        name: this.constructor.name,
                        ranAt: await this.resolveRanAt(transaction)
                    },
                    { transaction }
                );
                await transaction.commit();
            }
            catch (error) {
                await transaction.rollback();
                throw error;
            }
        });
    }

    /**
     * Revers the migration.
     */
    async runDown(): Promise<void> {
        await this.runWithinTimeout(async () => {
            const transaction: Transaction = await this.startMigrationTransaction();
            try {
                await AlsUtilities.runInMigration(this.constructor.name, () => this.down(transaction));
                // by name, the same thing runUp records it under. Deleting by version took every
                // other change of the same release with it, so reverting one of them told the
                // database that none of them had ever been applied
                await this.migrationRepository.deleteAll({ name: this.constructor.name }, { transaction });
                await transaction.commit();
            }
            catch (error) {
                await transaction.rollback();
                throw error;
            }
        });
    }

    /**
     * Resolves when the migration is recorded to have run: now, or just after the latest migration
     * recorded, whichever is later.
     * @param transaction - The transaction the migration runs in.
     * @returns The moment to record.
     */
    private async resolveRanAt(transaction: Transaction): Promise<Date> {
        // the order the migrations ran in is what tells an older build which of them a newer build
        // applied, and two of them run by one start were recorded at the same moment whenever they
        // took less than a millisecond, or ran on an instance whose clock is behind
        const [latest] = await this.migrationRepository.findAll({ order: { ranAt: 'DESC' }, limit: 1, transaction });
        return new Date(Math.max(Date.now(), (latest?.ranAt.getTime() ?? 0) + 1));
    }

    /**
     * Runs one direction of the migration under its timeout.
     *
     * The transaction is started inside, so that it is begun under the limit and every statement of
     * it has the limit's time rather than the data source's statement timeout.
     * @param fn - The direction to run.
     */
    private async runWithinTimeout(fn: () => Promise<void>): Promise<void> {
        await OperationLimitUtilities.runWithin(
            this.timeoutInMs ?? this.dataSource.migrationTimeoutInMs ?? 0,
            `The migration "${this.constructor.name}"`,
            fn
        );
    }

    /**
     * Starts the transaction one direction of the migration runs in, which may sit idle for as long as
     * the migration may take.
     * @returns The transaction.
     */
    private async startMigrationTransaction(): Promise<Transaction> {
        // the idle limit is for a transaction somebody forgets to end, and both directions end theirs
        // on every path. What bounds a migration is its own limit, which a data migration waiting on
        // something slow between two writes was cut short of after ten idle seconds
        return await this.dataSource.startTransaction({ idleTimeoutInMs: 0 });
    }

    protected abstract up(transaction: Transaction): Promise<void>;
    protected abstract down(transaction: Transaction): Promise<void>;
}