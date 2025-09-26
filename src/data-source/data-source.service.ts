import { GlobalRegistry } from '../global';
import { DataSourceServiceInterface } from './data-source-service.interface';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { BaseDataSource } from './base-data-source.model';
import { JwtCredentials, PasswordResetToken, JwtRefreshToken } from '../auth';
import { CronJobEntity } from '../cron';
import { Email, MailingList, MailingListSubscriber } from '../email';
import { BaseEntity } from '../entity';
import { Log, LoggerInterface } from '../logging';
import { ThreadJobEntity } from '../multithreading';
import { Newable } from '../types';
import { validateEntitiesRegistered } from '../utilities';
import { WebsocketChannel, WebsocketMessage } from '../websocket';

/**
 * Default data source service implementation of Zibri.
 */
export class DataSourceService implements DataSourceServiceInterface {
    private readonly logger: LoggerInterface;

    private readonly defaultEntities: Newable<BaseEntity>[] = [CronJobEntity, Email, ThreadJobEntity, WebsocketChannel, WebsocketMessage];
    private readonly allowedOrphans: Newable<BaseEntity>[] = [
        JwtRefreshToken,
        JwtCredentials,
        PasswordResetToken,
        MailingList,
        MailingListSubscriber,
        Log
    ];

    constructor() {
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async init(): Promise<void> {
        if (GlobalRegistry.dataSourceClasses.length) {
            // eslint-disable-next-line stylistic/max-len
            await this.logger.info(`initializes ${GlobalRegistry.dataSourceClasses.length} ${GlobalRegistry.dataSourceClasses.length > 1 ? 'data sources' : 'data source'}`);
        }

        for (const dataSourceClass of GlobalRegistry.dataSourceClasses) {
            const dataSource: BaseDataSource = inject(dataSourceClass);
            for (const entity of this.defaultEntities) {
                if (!dataSource.entities.includes(entity)) {
                    dataSource.entities.push(entity);
                }
            }
            await this.logger.info(`  - ${dataSourceClass.name} (${dataSource.entities.length} entities)`);
            await dataSource.init();
        }

        validateEntitiesRegistered(
            this.constructor.name,
            ...GlobalRegistry.entityClasses.filter(e => !this.allowedOrphans.includes(e))
        );
    }
}