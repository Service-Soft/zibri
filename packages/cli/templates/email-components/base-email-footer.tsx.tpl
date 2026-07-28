import { $ts, GlobalRegistry, MailingListTemplateData, MjColumn, MjSection, MjText, TsxComponent } from 'zibri';

import { BaseMailingListFooter } from './base-mailing-list-footer';

type Props = {
    mailingListData?: MailingListTemplateData
};

export const BaseEmailFooter: TsxComponent<Props> = ({
    mailingListData
}) => {
    const appName: string = GlobalRegistry.getAppData('name') ?? '';

    return <>
        <MjSection paddingTop='20px' paddingBottom='0px'>
            <MjColumn>
                <MjText paddingBottom='10px'>{$ts`Kind regards,`}</MjText>
                <MjText>{$ts`Your Team at ${appName}`}</MjText>
            </MjColumn>
        </MjSection>
        {mailingListData && <BaseMailingListFooter {...mailingListData}></BaseMailingListFooter>}
    </>;
};