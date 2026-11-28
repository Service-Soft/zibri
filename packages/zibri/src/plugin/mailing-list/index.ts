// What `zibri/plugin/mailing-list` exports: the mailing list plugin.
// eslint-disable-next-line eslintImport/no-unassigned-import
import 'reflect-metadata';

export * from './mailing-list.plugin';
export * from './mailing-list.tokens';

export * from './services/mailing-list-service.interface';
export * from './services/mailing-list.service';
export * from './mailing-list.controller';

export * from './models/mailing-list-base-email-template.model';
export * from './models/mailing-list-preferences-page-template.model';
export * from './models/mailing-list-subscribe-confirmation-email-template.model';
export * from './models/mailing-list-subscribe-success-page-template.model';
export * from './models/mailing-list-subscriber.model';
export { MailingListSubscriptionConfirmationToken } from './models/mailing-list-subscription-confirmation-token.model';
export * from './models/mailing-list-unsubscribe-confirmation-page-template.model';
export * from './models/mailing-list.model';
export * from './models/update-mailing-list-preferences.model';