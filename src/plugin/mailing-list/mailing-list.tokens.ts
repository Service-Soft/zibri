import { MailingListServiceInterface } from './services/mailing-list-service.interface';
import { TokenRecord } from '../../di/models/di-token.model';
import { InjectionToken } from '../../di/models/injection-token.model';

/**
 * The dependency injection tokens used by the ZibriMailingListPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS = {
    MAILING_LIST_SERVICE: mailingListToken<MailingListServiceInterface>('zi.mailing_list.mailing_list_service'),
    CONFIRMATION_TOKEN_EXPIRES_IN_MS: mailingListToken<number>('zi.mailing_list.subscription_confirmation_token_expires_in_ms')
} as const satisfies TokenRecord;

// eslint-disable-next-line jsdoc/require-jsdoc
function mailingListToken<T = never>(k: `zi.mailing_list.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}