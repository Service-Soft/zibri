import { PreactEmailComponent } from 'zibri';

type Props = {
    height?: string,
    containerBackgroundColor?: string,
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,
    cssClass?: string
};

export const EmailSpacer: PreactEmailComponent<Props> = ({
    height = '20px',
    containerBackgroundColor,
    padding = '0px',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
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
        `height:${height}`,
        `padding:${resolvedPadding}`,
        'word-break:break-word'
    ].filter(Boolean).join('; ');

    return <>
        {containerBackgroundColor
            ? `<!--[if mso | IE]><td class="${cssClass}" style="background:${containerBackgroundColor};"><![endif]-->`
            : ''}
        <table
            {...{ border: '0' }}
            cellPadding="0"
            cellSpacing="0"
            role="presentation"
            style="width:100%;"
        >
            <tbody>
                <tr>
                    <td style={tdStyle}>
                        {/* eslint-disable-next-line stylistic/max-len */}
                        {`<!--[if mso | IE]><table border="0" cellpadding="0" cellspacing="0" class="${cssClass}" role="presentation" style="height:${height};"><tr><td style="height:${height};line-height:${height};">&nbsp;</td></tr></table><![endif]-->`}
                        &nbsp;
                    </td>
                </tr>
            </tbody>
        </table>
        {containerBackgroundColor
            ? '<!--[if mso | IE]></td><![endif]-->'
            : ''}
    </>;
};