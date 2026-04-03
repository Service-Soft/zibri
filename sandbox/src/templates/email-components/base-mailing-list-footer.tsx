import { inject, MailingList, MailingListServiceInterface, MailingListSubscriber, PreactEmailComponent, ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from 'zibri';

import { EmailColumn } from './email-column';
import { EmailLink } from './email-link';
import { EmailSection } from './email-section';
import { EmailText } from './email-text';

type Props = {
    list: MailingList,
    subscriber: MailingListSubscriber
};

export const BaseMailingListFooter: PreactEmailComponent<Props> = ({
    list,
    subscriber
}) => {
    const mailingListService: MailingListServiceInterface = inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.MAILING_LIST_SERVICE);
    const unsubscribeLink: string = mailingListService.getUnsubscribeLink(list.id, subscriber.id);
    const managePreferencesLink: string = mailingListService.getManagePreferencesLink(subscriber.id);

    return <>
        <EmailSection paddingTop='40px' paddingBottom='10px'>
            <EmailColumn>
                <EmailText
                    align="center"
                    fontSize="11px"
                    color="#999999"
                >
                    You are receiving this email because you are subscribed to the mailing list "{list.name}"
                </EmailText>
            </EmailColumn>
        </EmailSection>
        <EmailSection paddingBottom='0px'>
            <EmailColumn width='49%'>
                <EmailLink
                    align="right"
                    fontSize="11px"
                    color="#999999"
                    href={managePreferencesLink}
                >
                    manage preferences
                </EmailLink>
            </EmailColumn>
            <EmailColumn width='2%'>{''}</EmailColumn>
            <EmailColumn width='49%'>
                <EmailLink
                    align="left"
                    fontSize="11px"
                    color="#999999"
                    href={unsubscribeLink}
                >
                    unsubscribe
                </EmailLink>
            </EmailColumn>
        </EmailSection>
    </>;
};