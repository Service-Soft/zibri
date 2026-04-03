import { GlobalRegistry, PreactEmailComponent } from 'zibri';

import { EmailColumn } from './email-column';
import { EmailImage } from './email-image';
import { EmailSection } from './email-section';
import { EmailText } from './email-text';

type Props = {
    children: string
};

export const BaseEmailHeader: PreactEmailComponent<Props> = ({ children }) => {
    const appName: string = GlobalRegistry.getAppData('name') ?? '';
    return (
        <EmailSection>
            <EmailColumn>
                <EmailText align="center" fontSize="20px">{appName}</EmailText>
                <EmailImage src='/assets/logo.jpg' height='200px' width='200px' alt='logo'/>
                <EmailText
                    tag='h1'
                    align="center"
                    fontSize="36px"
                    fontWeight="bold"
                >
                    {children}
                </EmailText>
            </EmailColumn>
        </EmailSection>
    );
};