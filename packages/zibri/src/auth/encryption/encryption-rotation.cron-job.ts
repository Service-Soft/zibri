import { type EncryptionServiceInterface } from './encryption-service.interface';
import { EncryptedEntity, resolveEncryptedEntities } from './resolve-encrypted-entities.function';
import { ZibriApplication } from '../../application/application';
import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { Repository } from '../../data-source/repository/repository';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { BaseEntity } from '../../entity/base-entity.model';
import { needsReEncryption } from '../../global/model-registry/needs-re-encryption.function';
import { OnAppInit } from '../../global/on-app-init.interface';
import { Newable } from '../../types/newable.type';
import { PromiseUtilities } from '../../utilities/promise.utilities';

/**
 * How many rows one run may write.
 *
 * There is no progress to resume from, so this is what keeps a large table from being one long write
 * storm: a run stops when it has done this much, and the next one finds whatever is still left.
 */
const maxRowsPerRun: number = 500;

/**
 * How many rows are read at a time while looking for work.
 */
const pageSize: number = 200;

/**
 * Rewrites encrypted values that are no longer stored the way they should be.
 *
 * Two things make a value stale, and neither is visible from the application: it was written with a
 * strategy or a key that has since been deprecated, or it was written before values were bound to
 * their row and can still be moved to another one. Neither can be found by querying - the answer is
 * inside the stored envelope - so this reads rows with `autoDecrypt: false` and looks.
 *
 * A row that needs rewriting is then read again normally and handed straight back to its repository,
 * because that is what re-encrypts it: the save hook uses the current key and binds it. Nothing here
 * has its own idea of what "encrypted correctly" means. The second read costs one query per stale
 * row, which is a row about to be written anyway, and none at all when there is nothing to do.
 *
 * Marking a key or a strategy DEPRECATED is what starts this. Deleting it is safe once this has
 * nothing left to do.
 */
export class EncryptionRotationCronJob extends CronJob implements OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'EncryptionRotationCronJob',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false,
        // every instance would otherwise sweep the same rows and write the same values over each
        // other. Unlike the rate limiter's state, what this rewrites is shared
        distributed: true
    };

    private readonly encryptedEntities: EncryptedEntity[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE)
        private readonly encryptionService: EncryptionServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // resolved once: which entities can hold an encrypted value is a property of the model, and
        // an hourly job has no reason to work it out again every time
        this.encryptedEntities.push(...resolveEncryptedEntities(app.options.dataSources));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        let remaining: number = maxRowsPerRun;

        for (const { entityClass, repository } of this.encryptedEntities) {
            if (remaining <= 0) {
                break;
            }
            remaining -= await this.rewriteStaleRows(entityClass, repository, remaining);
        }

        if (remaining <= 0) {
            // worth saying: the run stopped because it ran out of budget rather than out of work, so
            // a key that now looks unused is not necessarily finished being used
            this.logger.info(
                `Re-encrypted ${maxRowsPerRun} rows and stopped there. The next run continues with what is left.`
            );
        }
    }

    /**
     * Rewrites the rows of one entity whose encrypted values are out of date.
     * @param entityClass - The entity to sweep.
     * @param repository - The repository that reads and writes it.
     * @param budget - How many rows this is still allowed to write.
     * @returns How many rows it wrote.
     */
    private async rewriteStaleRows(
        entityClass: Newable<BaseEntity>,
        repository: Repository<BaseEntity>,
        budget: number
    ): Promise<number> {
        let written: number = 0;

        for (let skip: number = 0; ; skip += pageSize) {
            // as stored, because a decrypted row cannot say which key wrote it or whether it is bound
            const page: BaseEntity[] = await repository.findAll({ skip, take: pageSize, autoDecrypt: false });
            if (!page.length) {
                return written;
            }

            const checked: (string | undefined)[] = await PromiseUtilities.allChunked(
                page,
                async row => await needsReEncryption(row, entityClass, this.encryptionService) ? row.id : undefined
            );
            const staleIds: string[] = checked
                .filter(id => id != undefined)
                .slice(0, budget - written);

            await PromiseUtilities.allChunked(staleIds, async id => await this.rewrite(entityClass, repository, id));
            written += staleIds.length;

            if (written >= budget || page.length < pageSize) {
                return written;
            }
        }
    }

    /**
     * Reads one row as values and hands it straight back, which is what re-encrypts it.
     * @param entityClass - The entity the row belongs to, for the log when this fails.
     * @param repository - The repository holding it.
     * @param id - The id of the row to rewrite.
     */
    private async rewrite(entityClass: Newable<BaseEntity>, repository: Repository<BaseEntity>, id: string): Promise<void> {
        try {
            const row: BaseEntity | undefined = await repository.findById(id, { required: false });
            if (!row) {
                // deleted since the page was read, which is the outcome this wanted anyway
                return;
            }
            await repository.updateById(id, row);
        }
        catch (error) {
            // one row that cannot be read is not a reason to stop rotating every other one - and a
            // key cannot be retired until somebody looks at why this one is stuck
            this.logger.error(new Error(`Could not re-encrypt ${entityClass.name} "${id}".`, { cause: error }));
        }
    }
}