import { MailingListBaseEmailTemplate } from './models/mailing-list-base-email-template.model';
import { MailingListPreferencesPageTemplate } from './models/mailing-list-preferences-page-template.model';
import { MailingListSubscribeConfirmationEmailTemplate } from './models/mailing-list-subscribe-confirmation-email-template.model';
import { MailingListSubscribeSuccessPageTemplate } from './models/mailing-list-subscribe-success-page-template.model';
import { MailingListUnsubscribeConfirmationPageTemplate } from './models/mailing-list-unsubscribe-confirmation-page-template.model';
import { MailingListServiceInterface } from './services/mailing-list-service.interface';
import { TokenRecord } from '../../di/models/di-token.model';
import { InjectionToken } from '../../di/models/injection-token.model';

/**
 * The dependency injection tokens used by the ZibriMailingListPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS = {
    MAILING_LIST_SERVICE: mailingListToken<MailingListServiceInterface>('zi.mailing_list.mailing_list_service'),
    CONFIRMATION_TOKEN_EXPIRES_IN_MS: mailingListToken<number>('zi.mailing_list.subscription_confirmation_token_expires_in_ms'),
    SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE: mailingListToken<MailingListSubscribeConfirmationEmailTemplate | undefined>(
        'zi.mailing_list.subscribe_confirmation_email_template'
    ),
    PREFERENCES_PAGE_TEMPLATE: mailingListToken<MailingListPreferencesPageTemplate | undefined>(
        'zi.mailing_list.preferences_page_template'
    ),
    UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE: mailingListToken<MailingListUnsubscribeConfirmationPageTemplate | undefined>(
        'zi.mailing_list.unsubscribe_confirmation_page_template'
    ),
    SUBSCRIBE_SUCCESS_PAGE_TEMPLATE: mailingListToken<MailingListSubscribeSuccessPageTemplate | undefined>(
        'zi.mailing_list.subscribe_success_page_template'
    ),
    BASE_EMAIL_TEMPLATE: mailingListToken<MailingListBaseEmailTemplate | undefined>(
        'zi.mailing_list.base_email_template'
    )
} as const satisfies TokenRecord;

// eslint-disable-next-line jsdoc/require-jsdoc
function mailingListToken<T = never>(k: `zi.mailing_list.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}