import { GlobalRegistry } from '../global';
import { DataSourceServiceInterface } from './data-source-service.interface';
import { JwtCredentials, PasswordResetToken, JwtRefreshToken, OtpCredentials } from '../auth';
import { BackupEntity, BackupResourceEntity } from '../backup';
import { inject, ZIBRI_DI_TOKENS } from '../di';
import { MailingList, MailingListSubscriber } from '../email';
import { BaseEntity } from '../entity/base-entity.model';
import { Log, LoggerInterface } from '../logging';
import { Invoice, NumberInvoices, Payment } from '../plugin';
import { Newable } from '../types';
import { validateEntitiesRegistered } from '../utilities';
import { DataSourceInterface } from './data-sources/data-source.interface';

/**
 * Default data source service implementation of Zibri.
 */
export class DataSourceService implements DataSourceServiceInterface {
    private readonly logger: LoggerInterface;

    private readonly allowedOrphans: Newable<BaseEntity>[] = [
        JwtRefreshToken,
        JwtCredentials,
        PasswordResetToken,
        OtpCredentials,
        MailingList,
        MailingListSubscriber,
        Log,
        BackupResourceEntity,
        BackupEntity,
        NumberInvoices,
        Invoice,
        Payment
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
            const dataSource: DataSourceInterface = inject(dataSourceClass);
            await this.logger.info(`  - ${dataSourceClass.name} (${dataSource.entities.length} entities)`);
            await dataSource.init();
        }

        validateEntitiesRegistered(
            this.constructor.name,
            ...GlobalRegistry.entityClasses.filter(e => !this.allowedOrphans.includes(e))
        );
    }
}