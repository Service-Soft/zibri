import { $ts, inject, MailingList, MailingListServiceInterface, MailingListSubscriber, MjColumn, MjSection, MjText, TsxComponent, ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from 'zibri';

import { EmailLink } from './email-link';

type Props = {
    list: MailingList,
    subscriber: MailingListSubscriber
};

export const BaseMailingListFooter: TsxComponent<Props> = ({
    list,
    subscriber
}) => {
    const mailingListService: MailingListServiceInterface = inject(ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.MAILING_LIST_SERVICE);
    const unsubscribeLink: string = mailingListService.getUnsubscribeLink(list.id, subscriber.id);
    const managePreferencesLink: string = mailingListService.getManagePreferencesLink(subscriber.id);

    return <>
        <MjSection paddingTop='40px' paddingBottom='10px'>
            <MjColumn>
                <MjText align="center" fontSize="11px" color="#999999">
                    {$ts`You are receiving this email because you are subscribed to the mailing list "${list.name}"`}
                </MjText>
            </MjColumn>
        </MjSection>
        <MjSection paddingBottom='0px'>
            <MjColumn width='49%'>
                <EmailLink align="right" fontSize="11px" color="#999999" href={managePreferencesLink}>
                    {$ts`manage preferences`}
                </EmailLink>
            </MjColumn>
            <MjColumn width='2%'>{''}</MjColumn>
            <MjColumn width='49%'>
                <EmailLink align="left" fontSize="11px" color="#999999" href={unsubscribeLink}>
                    {$ts`unsubscribe`}
                </EmailLink>
            </MjColumn>
        </MjSection>
    </>;
};