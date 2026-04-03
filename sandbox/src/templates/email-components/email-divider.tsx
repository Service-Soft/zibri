import { PreactEmailComponent } from 'zibri';

type Props = {
    borderColor?: string,
    borderStyle?: 'solid' | 'dashed' | 'dotted',
    borderWidth?: string,
    align?: 'left' | 'center' | 'right',
    width?: string,
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,
    containerBackgroundColor?: string,
    cssClass?: string
};

export const EmailDivider: PreactEmailComponent<Props> = ({
    borderColor = '#000000',
    borderStyle = 'solid',
    borderWidth = '3px',
    align = 'center',
    width = '100%',
    padding = '0px',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    containerBackgroundColor,
    cssClass = ''
}) => {
    const resolvedPadding: string = [
        paddingTop ?? padding.split(' ')[0],
        paddingRight ?? padding.split(' ')[1] ?? padding.split(' ')[0],
        paddingBottom ?? padding.split(' ')[2] ?? padding.split(' ')[0],
        paddingLeft ?? padding.split(' ')[3] ?? padding.split(' ')[1] ?? padding.split(' ')[0]
    ].join(' ');

    const tdStyle: string = [
        containerBackgroundColor ? `background:${containerBackgroundColor}` : '',
        `padding:${resolvedPadding}`,
        'word-break:break-word'
    ].filter(Boolean).join('; ');

    const pStyle: string = [
        `border-top:${borderWidth} ${borderStyle} ${borderColor}`,
        'font-size:1px',
        'margin:0px auto',
        `width:${width}`
    ].join('; ');

    const msoAlign: string = align === 'center'
        ? 'margin:0px auto'
        : align === 'right'
            ? 'margin-left:auto'
            : 'margin-right:auto';

    return <>
        {containerBackgroundColor
            ? `<!--[if mso | IE]><td class="${cssClass}" style="background:${containerBackgroundColor};"><![endif]-->`
            : ''}
        <table
            {...{ align, border: '0' }}
            cellPadding="0"
            cellSpacing="0"
            role="presentation"
            style="width:100%;"
        >
            <tbody>
                <tr>
                    <td style={tdStyle}>
                        <p style={pStyle}>
                        </p>
                        {/* eslint-disable-next-line stylistic/max-len */}
                        {`<!--[if mso | IE]><table align="${align}" border="0" cellpadding="0" cellspacing="0" class="${cssClass}" role="presentation" style="border-top:${borderWidth} ${borderStyle} ${borderColor};font-size:1px;${msoAlign};width:${width};"><tr><td style="height:0;line-height:0;">&nbsp;</td></tr></table><![endif]-->`}
                    </td>
                </tr>
            </tbody>
        </table>
        {containerBackgroundColor
            ? '<!--[if mso | IE]></td><![endif]-->'
            : ''}
    </>;
};