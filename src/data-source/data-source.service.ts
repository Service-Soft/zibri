
import { GlobalRegistry } from '../global';
import { DataSourceServiceInterface } from './data-source-service.interface';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { BaseDataSource } from './base-data-source.model';
import { LoggerInterface } from '../logging';
import { BaseEntity } from './repository.model';
import { Newable } from '../types';

export class DataSourceService implements DataSourceServiceInterface {
    private readonly logger: LoggerInterface;

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    async init(): Promise<void> {
        this.logger.info('initializes', GlobalRegistry.dataSourceClasses.length, 'data sources');

        const entitiesInDataSources: Newable<BaseEntity>[] = [];
        for (const datasourceClass of GlobalRegistry.dataSourceClasses) {
            const dataSource: BaseDataSource = inject(datasourceClass);
            this.logger.info(`  - ${datasourceClass.name} (${dataSource.entities.length} entities)`);
            entitiesInDataSources.push(...dataSource.entities);
            await dataSource.init();
        }
        const orphanedEntities: Newable<BaseEntity>[] = GlobalRegistry.entityClasses.filter(e => !entitiesInDataSources.includes(e));
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