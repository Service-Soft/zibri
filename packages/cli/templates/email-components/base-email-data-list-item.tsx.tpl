import { MjColumn, MjSection, MjText, TsxChildren, TsxComponent } from 'zibri';

type Props = {
    label: string,
    value: string | string[],
    twoRows?: boolean,
    backgroundColor?: string,
    color?: string
};

// eslint-disable-next-line jsdoc/require-param
/**
 * One label/value row of a detail list, as its own MJML section so successive items stack as rows.
 * `twoRows` puts the value under the label (both full width) for long values; otherwise the label
 * takes a fifth of the width beside the value. Multi-line values render as separate lines.
 */
export const BaseEmailDataListItem: TsxComponent<Props> = ({
    label,
    value,
    twoRows = false,
    backgroundColor
}) => {
    const lines: TsxChildren = Array.isArray(value)
        ? value.map((line, index) => <>{index > 0 ? <br/> : ''}{line}</>)
        : value;

    return (
        <MjSection backgroundColor={backgroundColor} paddingTop='0px' paddingBottom='0px'>
            <MjColumn width={twoRows ? '100%' : '20%'}>
                <MjText fontWeight='bold' paddingBottom='0px'>{label}:</MjText>
            </MjColumn>
            <MjColumn width={twoRows ? '100%' : '80%'}>
                <MjText fontFamily='monospace, monospace' paddingTop={twoRows ? '0px' : undefined}>
                    {lines}
                </MjText>
            </MjColumn>
        </MjSection>
    );
};