import { DiProvider } from '../../di/models/di-provider.model';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model';
import { Ms } from '../../utilities/ms';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function';
import { ZibriPlugin } from '../plugin.model';
import { ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from './mailing-list.tokens';
import { MailingListSubscriber } from './models/mailing-list-subscriber.model';
import { MailingListSubscriptionConfirmationToken } from './models/mailing-list-subscription-confirmation-token.model';
import { MailingList } from './models/mailing-list.model';
import { MailingListService } from './services/mailing-list.service';

/**
 * Plugin that includes everything for handling mailing lists.
 */
export class ZibriMailingListPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS> = {
        MAILING_LIST_SERVICE: { useClass: MailingListService },
        CONFIRMATION_TOKEN_EXPIRES_IN_MS: { useFactory: () => Ms.DAY }
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(): void {
        validateEntitiesRegistered(this.constructor.name, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken);
        validateTokensRegistered(this.constructor.name, ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS);
    }
}