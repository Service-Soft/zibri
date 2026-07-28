import { GlobalRegistry, MjColumn, MjImage, MjSection, MjText, TsxComponent } from 'zibri';

type Props = {
    children: string
};

export const BaseEmailHeader: TsxComponent<Props> = ({ children }) => {
    const appName: string = GlobalRegistry.getAppData('name') ?? '';
    return (
        <MjSection>
            <MjColumn>
                <MjText align="center" fontSize="20px">{appName}</MjText>
                <MjImage src='/assets/logo.jpg' height='200px' width='200px' alt='logo'/>
                <MjText align="center" fontSize="36px" fontWeight="bold">{children}</MjText>
            </MjColumn>
        </MjSection>
    );
};