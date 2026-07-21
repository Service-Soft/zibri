import { PreactEmailComponent } from 'zibri';

import { EmailText } from './email-text';

type Props = {
    children: string | string[],
    fontSize?: string,
    color?: string,
    /**
     * The pixel width of a single space character at the given font size.
     * Defaults to 8px which matches most monospace fonts at 13-16px.
     */
    spaceWidth?: number,
    spacesPerTab?: number
};

export const EmailPre: PreactEmailComponent<Props> = ({
    children,
    fontSize,
    color,
    spaceWidth = 8,
    spacesPerTab = 4
}) => {
    const lines: string[] = Array.isArray(children) ? children : children.split('\n');
    return <>
        {lines.map((line, i) => {
            const leadingSpaces: number = line.match(/^ */)?.[0].length ?? 0;
            const leadingTabs: number = line.match(/^\t*/)?.[0].length ?? 0;
            const paddingLeft: number = (leadingSpaces * spaceWidth) + (leadingTabs * spaceWidth * spacesPerTab);
            const trimmed: string = line.trimStart();

            if (!trimmed) {
                return <EmailText key={i} fontSize={fontSize}>
                    {'\u00A0'}
                </EmailText>;
            }

            return (
                <EmailText
                    key={i}
                    fontFamily="monospace"
                    fontSize={fontSize}
                    color={color}
                    paddingLeft={`${paddingLeft}px`}
                >
                    {trimmed}
                </EmailText>
            );
        })}
    </>;
};