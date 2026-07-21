import { DataSourceServiceInterface } from './data-source-service.interface';
import { ZibriApplication } from '../application';
import { DataSourceInterface } from './data-sources/data-source.interface';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
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
    async beforeAppInit(app: ZibriApplication): Promise<void> {
        const { dataSources } = app.options;
        if (dataSources.length) {
            await this.logger.info(`initializes ${dataSources.length} ${dataSources.length > 1 ? 'data sources' : 'data source'}`);
        }

        for (const dataSourceClass of dataSources) {
            const dataSource: DataSourceInterface = inject(dataSourceClass);
            if (!MetadataUtilities.getFilePath(dataSourceClass)) {
                throw new InternalError(`The data source ${dataSourceClass.name} is not decorated with @DataSource.`);
            }
            this.dataSources.push(dataSource);
            await this.logger.info(`  - ${dataSourceClass.name} (${dataSource.entities.length} entities)`);
            await dataSource.init();
        }

        validateEntitiesRegistered(
            this.constructor.name,
            app,
            ...GlobalRegistry.entityClasses.filter(e => !(MetadataUtilities.getEntityMetadata(e)?.allowOrphan ?? false))
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async afterAppShutdown(): Promise<void> {
        await Promise.all(this.dataSources.map(ds => ds.shutDown()));
    }
}