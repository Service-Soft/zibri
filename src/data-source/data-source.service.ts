import { DataSourceServiceInterface } from './data-source-service.interface';
import { DataSourceInterface } from './data-sources/data-source.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { GlobalRegistry } from '../global/global-registry';
import { type LoggerInterface } from '../logging/logger.interface';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * Default data source service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class DataSourceService implements DataSourceServiceInterface {
    private readonly dataSources: DataSourceInterface[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) { }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async beforeAppInit(): Promise<void> {
        if (GlobalRegistry.dataSourceClasses.length) {
            // eslint-disable-next-line stylistic/max-len
            await this.logger.info(`initializes ${GlobalRegistry.dataSourceClasses.length} ${GlobalRegistry.dataSourceClasses.length > 1 ? 'data sources' : 'data source'}`);
        }

        for (const dataSourceClass of GlobalRegistry.dataSourceClasses) {
            const dataSource: DataSourceInterface = inject(dataSourceClass);
            this.dataSources.push(dataSource);
            await this.logger.info(`  - ${dataSourceClass.name} (${dataSource.entities.length} entities)`);
            await dataSource.init();
        }

        validateEntitiesRegistered(
            this.constructor.name,
            ...GlobalRegistry.entityClasses.filter(e => !(MetadataUtilities.getEntityMetadata(e)?.allowOrphan ?? false))
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async afterAppShutdown(): Promise<void> {
        await Promise.all(this.dataSources.map(ds => ds.shutDown()));
    }
}