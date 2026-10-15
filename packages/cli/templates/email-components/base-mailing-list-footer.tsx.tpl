import { $ts, MailingListTemplateData, MjColumn, MjSection, MjText, TsxComponent } from 'zibri';

import { EmailLink } from './email-link';

export const BaseMailingListFooter: TsxComponent<MailingListTemplateData> = ({
    list,
    unsubscribeLink,
    managePreferencesLink
}) => {
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