/* eslint-disable unicorn/no-null */
import { EncryptionRotationFailure, EncryptionRotationFailureCreateData } from './encryption-rotation-failure.model.ts';
import { EncryptionRotationProgress, EncryptionRotationProgressCreateData } from './encryption-rotation-progress.model.ts';
import { type EncryptionServiceInterface } from './encryption-service.interface.ts';
import { EncryptionUtilities } from './encryption.utilities.ts';
import { EncryptedEntity, resolveEncryptedEntities } from './resolve-encrypted-entities.function.ts';
import { ZibriApplication } from '../../application/application.ts';
import { CronExpression } from '../../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { findEncryptedValues, StoredEncryptedValue } from '../../global/model-registry/find-encrypted-values.function.ts';
import { needsReEncryption } from '../../global/model-registry/needs-re-encryption.function.ts';
import { OnAppInit } from '../../global/on-app-init.interface.ts';
import { KeysetPage } from '../../open-api/pagination-result.model.ts';
import { Newable } from '../../types/newable.type.ts';
import { Ms } from '../../utilities/ms.ts';
import { PromiseUtilities } from '../../utilities/promise.utilities.ts';

/**
 * How many rows one run may write.
 *
 * This is what keeps a large table from being one long write storm: a run stops when it has done this
 * much, and the next one continues where it stopped.
 */
const maxRowsPerRun: number = 500;

/**
 * How many rows are read at a time while looking for work.
 */
const pageSize: number = 200;

/**
 * The longest a row that could not be rewritten waits before it is tried again.
 */
const maxRetryDelayInMs: number = Ms.DAY;

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
 * has its own idea of what "encrypted correctly" means.
 *
 * The rows are read in passes, a bounded number per run, and a pass continues where the last run
 * stopped. A pass starts when a key or a strategy is retired that the last finished pass did not look
 * for, and once on every instance after it started. A row that cannot be rewritten is recorded as an
 * `EncryptionRotationFailure`, tried again later, and reported by `resolveRetiredKeyUsage`.
 *
 * Marking a key or a strategy DEPRECATED is what starts this. Deleting it is safe once this has
 * nothing left to do.
 */
export class EncryptionRotationCronJob extends CronJob implements OnAppInit {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'EncryptionRotationCronJob',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false,
        // every instance would otherwise sweep the same rows and write the same values over each
        // other. Unlike the rate limiter's state, what this rewrites is shared
        distributed: true
    };

    private readonly encryptedEntities: EncryptedEntity[] = [];

    // a value can go stale without any key being retired: written by a version before binding, or
    // declared bound by a model since. Both arrive with a start, so every instance makes one pass
    // after it started, and nothing reads the stored values otherwise until a key is retired
    private hasStartedPass: boolean = false;

    // read when used rather than injected, like the repositories of the encryption service, which
    // names both entities when they are missing
    private get progressRepository(): Repository<EncryptionRotationProgress, EncryptionRotationProgressCreateData> {
        return inject(repositoryTokenFor(EncryptionRotationProgress));
    }

    private get failureRepository(): Repository<EncryptionRotationFailure, EncryptionRotationFailureCreateData> {
        return inject(repositoryTokenFor(EncryptionRotationFailure));
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE)
        private readonly encryptionService: EncryptionServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // resolved once: which entities can hold an encrypted value is a property of the model, and
        // an hourly job has no reason to work it out again every time
        this.encryptedEntities.push(...resolveEncryptedEntities(app.options.dataSources));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        const failures: EncryptionRotationFailure[] = await this.failureRepository.findAll({ take: 'all' });
        let remaining: number = maxRowsPerRun - await this.retryFailures(failures);

        const progress: EncryptionRotationProgress = await this.resolveProgress();
        if (progress.entityName == undefined && !await this.startPass(progress)) {
            return;
        }
        remaining -= await this.continuePass(progress, failures, remaining);

        if (remaining <= 0) {
            // worth saying: the run stopped because it ran out of budget rather than out of work, so
            // a key that now looks unused is not necessarily finished being used
            this.logger.info(
                `Re-encrypted ${maxRowsPerRun} rows and stopped there. The next run continues with what is left.`
            );
        }
    }

    /**
     * Tries again to rewrite the recorded rows that are due.
     * @param failures - Every recorded row.
     * @returns How many rows it tried.
     */
    private async retryFailures(failures: EncryptionRotationFailure[]): Promise<number> {
        const due: EncryptionRotationFailure[] = failures
            .filter(f => new Date(f.retryAt).getTime() <= Date.now())
            .slice(0, maxRowsPerRun);
        await PromiseUtilities.allChunked(due, async failure => await this.retryFailure(failure));
        return due.length;
    }

    private async retryFailure(failure: EncryptionRotationFailure): Promise<void> {
        const encrypted: EncryptedEntity | undefined = this.encryptedEntities.find(e => e.entityClass.name === failure.entityName);
        try {
            // an entity no longer declared holds nothing this can rewrite, or report
            const row: BaseEntity | undefined = await encrypted?.repository.findById(failure.rowId, { required: false });
            if (row) {
                await encrypted?.repository.updateById(row.id, row);
                this.logger.info(`Re-encrypted ${failure.entityName} "${failure.rowId}" after ${failure.attempts + 1} attempts.`);
            }
            await this.failureRepository.deleteById(failure.id);
        }
        catch (error) {
            const attempts: number = failure.attempts + 1;
            // said once, when the row was recorded. It is reported for as long as it is stuck
            await this.failureRepository.updateById(failure.id, {
                attempts,
                error: this.describe(error),
                retryAt: this.resolveRetryAt(attempts)
            });
        }
    }

    private async resolveProgress(): Promise<EncryptionRotationProgress> {
        const progress: EncryptionRotationProgress | undefined = await this.progressRepository.findOne({ required: false });
        return progress ?? await this.progressRepository.create({
            entityName: null,
            cursor: null,
            passRetiredKeyIds: [],
            sweptRetiredKeyIds: []
        });
    }

    /**
     * Starts a pass, when there is something a pass would find.
     * @param progress - The progress row, with no pass in progress.
     * @returns Whether a pass was started.
     */
    private async startPass(progress: EncryptionRotationProgress): Promise<boolean> {
        const retiredKeyIds: string[] = await this.encryptionService.findRetiredKeyIds();
        const looked: boolean = retiredKeyIds.every(id => progress.sweptRetiredKeyIds.includes(id));
        const first: EncryptedEntity | undefined = this.encryptedEntities[0];
        if ((this.hasStartedPass && looked) || !first) {
            return false;
        }
        this.hasStartedPass = true;
        await this.updateProgress(progress, { entityName: first.entityClass.name, cursor: null, passRetiredKeyIds: retiredKeyIds });
        return true;
    }

    /**
     * Continues the pass in progress, until it is finished or the budget is spent.
     * @param progress - The progress row, with a pass in progress.
     * @param failures - The recorded rows, which the pass leaves to their retries.
     * @param budget - How many rows this is still allowed to write.
     * @returns How many rows it tried to write.
     */
    private async continuePass(
        progress: EncryptionRotationProgress,
        failures: EncryptionRotationFailure[],
        budget: number
    ): Promise<number> {
        let tried: number = 0;
        const at: number = this.encryptedEntities.findIndex(e => e.entityClass.name === progress.entityName);

        // an entity no longer declared is where nothing can continue, so the pass begins again
        for (const [index, { entityClass, repository }] of this.encryptedEntities.entries()) {
            if (index < at) {
                continue;
            }
            const recorded: Set<string> = new Set(failures.filter(f => f.entityName === entityClass.name).map(f => f.rowId));
            let cursor: string | undefined = index === at ? progress.cursor ?? undefined : undefined;

            do {
                // as stored, because a decrypted row cannot say which key wrote it or whether it is
                // bound. A cursor rather than an offset: an offset counts rows in whatever order the
                // store reads them, which is no order at all without one, and a row rewritten during
                // the walk can move - so an offset passed over some rows and read others twice
                const page: KeysetPage<BaseEntity> = await repository.findAllAfter(cursor, pageSize, { autoDecrypt: false });
                const stale: BaseEntity[] = (await PromiseUtilities.allChunked(
                    page.items,
                    async row => !recorded.has(row.id) && await needsReEncryption(row, entityClass, this.encryptionService)
                        ? row
                        : undefined
                )).filter(row => row != undefined);

                const rewriting: BaseEntity[] = stale.slice(0, budget - tried);
                await PromiseUtilities.allChunked(rewriting, async row => await this.rewrite(entityClass, repository, row));
                tried += rewriting.length;

                if (rewriting.length < stale.length) {
                    // the page is read again by the next run, from where it started: a cursor only
                    // continues after a whole page, and what this run rewrote is no longer stale then
                    await this.updateProgress(progress, { entityName: entityClass.name, cursor: cursor ?? null });
                    return tried;
                }
                cursor = page.nextCursor;
            }
            while (cursor != undefined);
        }

        await this.updateProgress(progress, {
            entityName: null,
            cursor: null,
            sweptRetiredKeyIds: progress.passRetiredKeyIds,
            passRetiredKeyIds: []
        });
        return tried;
    }

    /**
     * Reads one row as values and hands it straight back, which is what re-encrypts it.
     * @param entityClass - The entity the row belongs to.
     * @param repository - The repository holding it.
     * @param stored - The row as it is stored, which says which keys it needs when it cannot be rewritten.
     */
    private async rewrite(entityClass: Newable<BaseEntity>, repository: Repository<BaseEntity>, stored: BaseEntity): Promise<void> {
        try {
            const row: BaseEntity | undefined = await repository.findById(stored.id, { required: false });
            if (!row) {
                // deleted since the page was read, which is the outcome this wanted anyway
                return;
            }
            await repository.updateById(row.id, row);
        }
        catch (error) {
            // one row that cannot be read is not a reason to stop rotating every other one - and a
            // key cannot be retired until somebody looks at why this one is stuck
            await this.recordFailure(entityClass, stored, error);
        }
    }

    private async recordFailure(entityClass: Newable<BaseEntity>, stored: BaseEntity, error: unknown): Promise<void> {
        const values: StoredEncryptedValue[] = await findEncryptedValues(stored, entityClass);
        const keyIds: string[] = [...new Set(values.map(v => EncryptionUtilities.encryptionStringToContent(v.value).keyId))];
        const retryAt: Date = this.resolveRetryAt(1);
        await this.failureRepository.create({
            entityName: entityClass.name,
            rowId: stored.id,
            keyIds,
            error: this.describe(error),
            attempts: 1,
            failedAt: new Date(),
            retryAt
        });
        this.logger.error(new Error(
            `Could not re-encrypt ${entityClass.name} "${stored.id}". Tried again from ${retryAt.toISOString()}, and reported by resolveRetiredKeyUsage until then.`,
            { cause: error }
        ));
    }

    private async updateProgress(
        progress: EncryptionRotationProgress,
        changes: Partial<EncryptionRotationProgressCreateData>
    ): Promise<void> {
        Object.assign(progress, changes);
        await this.progressRepository.updateById(progress.id, changes);
    }

    // an hour after the first failure, doubling with each one after, up to a day
    private resolveRetryAt(attempts: number): Date {
        return new Date(Date.now() + Math.min(Ms.HOUR * (2 ** (attempts - 1)), maxRetryDelayInMs));
    }

    private describe(error: unknown): string {
        return error instanceof Error ? error.message : String(error);
    }
}