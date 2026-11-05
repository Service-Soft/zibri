import { CronExpression } from './cron-expression.utilities';
import { CronJob, InitialCronConfig } from './cron-job.model';
import { type DataSourceServiceInterface } from '../data-source/data-source-service.interface';
import { type DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { dataSourceNow } from '../data-source/models/data-source-now.function';
import { Where } from '../data-source/models/where/where-filter.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { BaseEntity } from '../entity/base-entity.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';

/**
 * Deletes the rows of every entity that declares `expiresBy` once the date they hold there has passed,
 * in every tenant, every hour. Registered for you when an entity of a data source declares it.
 */
// one job for every such entity, where each used to have one of its own written the same way, and
// whichever service remembered to registered it. By the clock of the data source, as every instance
// shares that one: a lease, for one, is held until a time on it, and deleting a grant still held by
// that clock would let a second instance take work that is being done
export class ExpiredRowsCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Cleanup expired rows',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.DATA_SOURCE_SERVICE)
        private readonly dataSourceService: DataSourceServiceInterface
    ) {
        super();
    }

    /**
     * Whether any entity of the given data sources declares `expiresBy`.
     * @param dataSources - The data sources.
     * @returns True when the job has rows to delete.
     */
    static hasExpiringEntities(dataSources: DataSourceInterface[]): boolean {
        return dataSources.some(dataSource => dataSource.entities
            .some(entity => MetadataUtilities.getEntityMetadata(entity)?.expiresBy != undefined));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        for (const dataSource of this.dataSourceService.getDataSources()) {
            for (const entity of dataSource.entities) {
                const expiresBy: string | undefined = MetadataUtilities.getEntityMetadata(entity)?.expiresBy;
                if (expiresBy != undefined) {
                    await this.deleteExpired(dataSource, entity, expiresBy);
                }
            }
        }
    }

    /**
     * Deletes the rows of one entity whose date has passed.
     * @param dataSource - The data source holding the entity.
     * @param entity - The entity.
     * @param expiresBy - The date property its rows expire by.
     */
    private async deleteExpired(dataSource: DataSourceInterface, entity: Newable<BaseEntity>, expiresBy: string): Promise<void> {
        const expired: Where<BaseEntity> = Object.fromEntries([[expiresBy, { before: dataSourceNow() }]]);
        const removed: number = await dataSource.getRepository(entity).deleteAll(expired, { acrossTenants: true });
        if (removed) {
            this.logger.info(`removed ${removed} expired ${entity.name} rows`);
        }
    }
}