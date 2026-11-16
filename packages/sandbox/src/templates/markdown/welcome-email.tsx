import { MjBody, MjColumn, Mjml, MjSection, MjText, TsxEmailComponent } from 'zibri';

import Welcome from './welcome.md';

// a page written in markdown as the text of an email
export const WelcomeEmail: TsxEmailComponent = () => {
    return (
        <Mjml>
            <MjBody>
                <MjSection>
                    <MjColumn>
                        <MjText>
                            <Welcome/>
                        </MjText>
                    </MjColumn>
                </MjSection>
            </MjBody>
        </Mjml>
    );
};