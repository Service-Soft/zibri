import { GlobalRegistry } from '../global';
import { DataSourceServiceInterface } from './data-source-service.interface';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { BaseDataSource } from './base-data-source.model';
import { JwtCredentials, RefreshToken } from '../auth';
import { CronJobEntity } from '../cron';
import { BaseEntity } from '../entity';
import { LoggerInterface } from '../logging';
import { Newable } from '../types';

export class DataSourceService implements DataSourceServiceInterface {
    private readonly logger: LoggerInterface;

    private readonly allowedOrphans: Newable<BaseEntity>[] = [RefreshToken, JwtCredentials];

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    async init(): Promise<void> {
        if (GlobalRegistry.dataSourceClasses.length) {
            this.logger.info(
                'initializes',
                GlobalRegistry.dataSourceClasses.length,
                GlobalRegistry.dataSourceClasses.length > 1 ? 'data sources' : 'data source'
            );
        }

        const entitiesInDataSources: Newable<BaseEntity>[] = [];
        for (const dataSourceClass of GlobalRegistry.dataSourceClasses) {
            const dataSource: BaseDataSource = inject(dataSourceClass);
            if (!dataSource.entities.includes(CronJobEntity)) {
                dataSource.entities.push(CronJobEntity);
            }
            this.logger.info(`  - ${dataSourceClass.name} (${dataSource.entities.length} entities)`);
            entitiesInDataSources.push(...dataSource.entities);
            await dataSource.init();
        }

        this.checkForOrphanedEntities(entitiesInDataSources);
    }

    private checkForOrphanedEntities(entitiesInDataSources: Newable<BaseEntity>[]): void {
        const orphanedEntities: Newable<BaseEntity>[] = GlobalRegistry.entityClasses.filter(e => {
            return !entitiesInDataSources.includes(e) && !this.allowedOrphans.includes(e);
        });
        if (orphanedEntities.length) {
            const message: string[] = ['Error initializing databases.', 'Could not find data source for the following entities:'];
            for (const entity of orphanedEntities) {
                message.push(`  - ${entity.name}`);
            }
            message.push('Did you forget to add them to your data source entities array?');
            throw new Error(message.join('\n'));
        }
    }
}