import { DataSourceServiceInterface } from './data-source-service.interface';
import { BaseEntity } from '../entity/base-entity.model';
import { DataSourceInterface } from './data-sources/data-source.interface';
import { OtpCredentials } from '../auth/2fa/methods/otp/otp-credentials.model';
import { PasswordResetToken } from '../auth/models/password-reset-token.model';
import { JwtCredentials } from '../auth/strategies/jwt/jwt-credentials.model';
import { JwtRefreshToken } from '../auth/strategies/jwt/jwt-refresh-token.model';
import { BackupEntity } from '../backup/backup-entity.model';
import { BackupResourceEntity } from '../backup/backup-resource-entity.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { MailingListSubscriber } from '../email/mailing-list/models/mailing-list-subscriber.model';
import { MailingList } from '../email/mailing-list/models/mailing-list.model';
import { GlobalRegistry } from '../global/global-registry';
import { Log } from '../logging/log.model';
import { LoggerInterface } from '../logging/logger.interface';
import { Invoice } from '../plugin/invoicing/models/invoice.model';
import { NumberInvoices } from '../plugin/invoicing/models/number-invoices.model';
import { Payment } from '../plugin/payment/models/payment.model';
import { Newable } from '../types/newable.type';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

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