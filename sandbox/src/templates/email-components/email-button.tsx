import { PreactEmailComponent } from 'zibri';

type Props = {
    href: string,
    children: string,
    rel?: string,
    target?: '_blank' | '_self' | '_parent' | '_top',
    align?: 'left' | 'center' | 'right',
    backgroundColor?: string,
    border?: string,
    borderBottom?: string,
    borderLeft?: string,
    borderRight?: string,
    borderTop?: string,
    borderRadius?: string,
    color?: string,
    containerBackgroundColor?: string,
    fontFamily?: string,
    fontSize?: string,
    fontStyle?: 'normal' | 'italic' | 'oblique',
    fontWeight?: string,
    height?: string,
    letterSpacing?: string,
    lineHeight?: string,
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,
    innerPadding?: string,
    textDecoration?: string,
    textTransform?: 'none' | 'capitalize' | 'uppercase' | 'lowercase',
    verticalAlign?: 'top' | 'middle' | 'bottom',
    width?: string,
    cssClass?: string,
    boxShadow?: string
};

export const EmailButton: PreactEmailComponent<Props> = ({
    href,
    children,
    rel,
    target = '_blank',
    align = 'left',
    backgroundColor = '#2a2a35',
    border = 'none',
    borderBottom,
    borderLeft,
    borderRight,
    borderTop,
    borderRadius = '5px',
    color = '#f5f5f5',
    containerBackgroundColor,
    fontFamily = 'Ubuntu, Helvetica, Arial, sans-serif',
    fontSize = '16px',
    fontStyle = 'normal',
    fontWeight = 'normal',
    height,
    letterSpacing,
    lineHeight = '120%',
    padding = '0px',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    innerPadding = '12px 25px',
    textDecoration = 'none',
    textTransform = 'none',
    verticalAlign = 'middle',
    width,
    cssClass = '',
    boxShadow
}) => {
    const resolvedPadding: string = [
        paddingTop ?? padding.split(' ')[0],
        paddingRight ?? padding.split(' ')[1] ?? padding.split(' ')[0],
        paddingBottom ?? padding.split(' ')[2] ?? padding.split(' ')[0],
        paddingLeft ?? padding.split(' ')[3] ?? padding.split(' ')[1] ?? padding.split(' ')[0]
    ].join(' ');

    const resolvedBorder: string = [
        border !== 'none' ? `border:${border}` : '',
        borderTop ? `border-top:${borderTop}` : '',
        borderRight ? `border-right:${borderRight}` : '',
        borderBottom ? `border-bottom:${borderBottom}` : '',
        borderLeft ? `border-left:${borderLeft}` : ''
    ].filter(Boolean).join('; ');

    const tdStyle: string = [
        containerBackgroundColor ? `background:${containerBackgroundColor}` : '',
        `padding:${resolvedPadding}`,
        'word-break:break-word'
    ].filter(Boolean).join('; ');

    const tableStyle: string = [
        `background-color:${backgroundColor}`,
        resolvedBorder,
        `border-radius:${borderRadius}`,
        height ? `height:${height}` : '',
        width ? `width:${width}` : ''
    ].filter(Boolean).join('; ');

    const anchorStyle: string = [
        'display:inline-block',
        `background-color:${backgroundColor}`,
        resolvedBorder,
        `color:${color}`,
        `font-family:${fontFamily}`,
        `font-size:${fontSize}`,
        `font-style:${fontStyle}`,
        `font-weight:${fontWeight}`,
        `letter-spacing:${letterSpacing ?? 'normal'}`,
        `line-height:${lineHeight}`,
        'margin:0',
        `text-decoration:${textDecoration}`,
        `text-transform:${textTransform}`,
        `padding:${innerPadding}`,
        'mso-padding-alt:0px',
        `border-radius:${borderRadius}`,
        boxShadow ? `box-shadow:${boxShadow}` : ''
    ].filter(Boolean).join('; ');

    return <>
        {containerBackgroundColor
            ? `<!--[if mso | IE]><td class="${cssClass}" style="background:${containerBackgroundColor};"><![endif]-->`
            : ''}
        <div class={cssClass} style={`text-align:${align}; ${tdStyle}`}>
            <table
                {...{ border: '0' }}
                cellPadding="0"
                cellSpacing="0"
                role="presentation"
                style="border-collapse:separate; display:inline-table;"
            >
                <tbody>
                    <tr>
                        <td
                            {...{ align: 'center', valign: verticalAlign }}
                            style={tableStyle}
                            role="presentation"
                        >
                            {'<!--[if mso | IE]><v:roundrect...'}
                            {'<!--[if !mso]><!-->'}
                            <a href={href} rel={rel} target={target} style={anchorStyle}>
                                {children}
                            </a>
                            {'<!--<![endif]-->'}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
        {containerBackgroundColor
            ? '<!--[if mso | IE]></td><![endif]-->'
            : ''}
    </>;
};