import { PreactEmailComponent } from 'zibri';

import { EmailColumn } from './email-column';
import { EmailPre } from './email-pre';
import { EmailText } from './email-text';

type Props = {
    label: string,
    value: string | string[],
    twoRows?: boolean
};

export const BaseEmailDataListItem: PreactEmailComponent<Props> = ({
    label,
    value,
    twoRows = false
}: Props) => {

    return (
        <>
            <EmailColumn width={twoRows ? '100%' : '20%'}>
                <EmailText fontWeight='bold'>{label}:</EmailText>
            </EmailColumn>
            <EmailColumn width={twoRows ? '100%' : '80%'}>
                <EmailPre>{value}</EmailPre>
            </EmailColumn>
        </>
    );
};