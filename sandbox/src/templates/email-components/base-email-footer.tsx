import { GlobalRegistry, MailingListTemplateData, PreactEmailComponent } from 'zibri';

import { BaseMailingListFooter } from './base-mailing-list-footer';
import { EmailColumn } from './email-column';
import { EmailSection } from './email-section';
import { EmailText } from './email-text';

type Props = {
    mailingListData?: MailingListTemplateData
};

export const BaseEmailFooter: PreactEmailComponent<Props> = ({
    mailingListData
}) => {
    const appName: string = GlobalRegistry.getAppData('name') ?? '';

    return <>
        <EmailSection paddingBottom='0px' paddingTop='20px'>
            <EmailColumn>
                <EmailText paddingBottom='10px'>Kind regards,</EmailText>
                <EmailText>Your Team at {appName}</EmailText>
            </EmailColumn>
        </EmailSection>
        {mailingListData && <BaseMailingListFooter {...mailingListData}></BaseMailingListFooter>}
    </>;
};