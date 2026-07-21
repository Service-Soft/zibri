import { JSX } from 'preact';
import { PreactEmailComponent } from 'zibri';

type Props = {
    src: string,
    alt: string,
    href?: string,
    rel?: string,
    target?: '_blank' | '_self' | '_parent' | '_top',
    title?: string,
    width?: string,
    height?: string,
    align?: 'left' | 'center' | 'right',
    border?: string,
    borderRadius?: string,
    containerBackgroundColor?: string,
    fluidOnMobile?: boolean,
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,
    name?: string,
    cssClass?: string
};

export const EmailImage: PreactEmailComponent<Props> = ({
    src,
    alt,
    href,
    rel,
    target = '_blank',
    title,
    width = '100%',
    height = 'auto',
    align = 'center',
    border = 'none',
    borderRadius,
    containerBackgroundColor,
    fluidOnMobile = false,
    padding = '0px',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    name,
    cssClass = ''
}) => {
    const resolvedPadding: string = [
        paddingTop ?? padding.split(' ')[0],
        paddingRight ?? padding.split(' ')[1] ?? padding.split(' ')[0],
        paddingBottom ?? padding.split(' ')[2] ?? padding.split(' ')[0],
        paddingLeft ?? padding.split(' ')[3] ?? padding.split(' ')[1] ?? padding.split(' ')[0]
    ].join(' ');

    const widthNum: number | undefined = Number.isNaN(Number.parseInt(width))
        ? undefined
        : Number.parseInt(width);

    const tdStyle: string = [
        containerBackgroundColor ? `background:${containerBackgroundColor}` : '',
        `padding:${resolvedPadding}`,
        `text-align:${align}`,
        'word-break:break-word'
    ].filter(Boolean).join('; ');

    const imgStyle: string = [
        `border:${border}`,
        borderRadius ? `border-radius:${borderRadius}` : '',
        'display:block',
        align === 'center' ? 'margin:0 auto' : align === 'right' ? 'margin-left:auto; margin-right:0' : 'margin-right:auto',
        fluidOnMobile ? 'max-width:100%' : '',
        `height:${height}`,
        `width:${width}`
    ].filter(Boolean).join('; ');

    const img: JSX.Element = <img
        {...{ align, name }}
        alt={alt}
        height={height === 'auto' ? 'auto' : widthNum}
        src={src}
        style={imgStyle}
        title={title}
        width={widthNum}
    />;

    const linkedImg: JSX.Element = href
        ? <a href={href} rel={rel} target={target}>
            {img}
        </a>
        : img;

    const msoWidth: string = widthNum !== undefined ? `${widthNum}px` : width;

    return <>
        {containerBackgroundColor
            ? `<!--[if mso | IE]><td class="${cssClass}" style="background:${containerBackgroundColor};"><![endif]-->`
            : ''}
        {/* eslint-disable-next-line stylistic/max-len */}
        {`<!--[if mso | IE]><table align="${align}" border="0" cellpadding="0" cellspacing="0" class="${cssClass}" role="presentation" style="width:${msoWidth};" width="${widthNum ?? width}"><tr><td style="${tdStyle}"><![endif]-->`}
        <table
            {...{ align, border: '0' }}
            cellPadding="0"
            cellSpacing="0"
            role="presentation"
            style={'border:0; width:100%;'}
        >
            <tbody>
                <tr>
                    <td style={tdStyle}>
                        {linkedImg}
                    </td>
                </tr>
            </tbody>
        </table>
        {'<!--[if mso | IE]></td></tr></table><![endif]-->'}
        {containerBackgroundColor
            ? '<!--[if mso | IE]></td><![endif]-->'
            : ''}
    </>;
};