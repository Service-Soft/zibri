import { PreactEmailComponent } from 'zibri';

import { EmailContextValue, useEmailContext } from './email-context';

type Props = {
    href: string,
    children: string | string[],
    color?: string,
    fontFamily?: string,
    fontSize?: string,
    fontWeight?: string,
    fontStyle?: 'normal' | 'italic' | 'oblique',
    textDecoration?: 'none' | 'underline' | 'overline' | 'line-through',
    letterSpacing?: string,
    lineHeight?: number,
    align?: 'left' | 'right' | 'center' | 'justify',
    textTransform?: 'none' | 'capitalize' | 'uppercase' | 'lowercase',
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,
    containerBackgroundColor?: string,
    height?: string,
    target?: '_blank' | '_self' | '_parent' | '_top',
    rel?: string,
    title?: string,
    cssClass?: string
};

export const EmailLink: PreactEmailComponent<Props> = ({
    href,
    children,
    color,
    fontFamily,
    fontSize = '16px',
    fontWeight = 'normal',
    fontStyle = 'normal',
    textDecoration = 'underline',
    letterSpacing,
    lineHeight,
    align = 'left',
    textTransform = 'none',
    padding = '0px 0px',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    containerBackgroundColor,
    height,
    target = '_blank',
    rel,
    title,
    cssClass = ''
}) => {
    const ctx: EmailContextValue = useEmailContext();

    const resolvedColor: string = color ?? ctx.color;
    const resolvedFontFamily: string = fontFamily ?? ctx.fontFamily;
    const resolvedLineHeight: number = lineHeight ?? ctx.lineHeight;

    const resolvedPadding: string = [
        paddingTop ?? padding.split(' ')[0],
        paddingRight ?? padding.split(' ')[1] ?? padding.split(' ')[0],
        paddingBottom ?? padding.split(' ')[2] ?? padding.split(' ')[0],
        paddingLeft ?? padding.split(' ')[3] ?? padding.split(' ')[1] ?? padding.split(' ')[0]
    ].join(' ');

    const tdStyle: string = [
        containerBackgroundColor ? `background:${containerBackgroundColor}` : '',
        height ? `height:${height}` : '',
        `padding:${resolvedPadding}`,
        'word-break:break-word'
    ].filter(Boolean).join('; ');

    const anchorStyle: string = [
        `color:${resolvedColor}`,
        `font-family:${resolvedFontFamily}`,
        `font-size:${fontSize}`,
        `font-style:${fontStyle}`,
        `font-weight:${fontWeight}`,
        `letter-spacing:${letterSpacing ?? 'normal'}`,
        `line-height:${resolvedLineHeight}`,
        'display: block',
        'margin:0',
        `text-align:${align}`,
        `text-decoration:${textDecoration}`,
        `text-transform:${textTransform}`,
        'mso-style-priority:99'
    ].join('; ');

    return <>
        {containerBackgroundColor
            ? `<!--[if mso | IE]><td class="${cssClass}" style="background:${containerBackgroundColor};"><![endif]-->`
            : ''}
        <div class={cssClass} style={tdStyle}>
            <a
                href={href}
                target={target}
                rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
                title={title}
                style={anchorStyle}
            >
                {children}
            </a>
        </div>
        {containerBackgroundColor
            ? '<!--[if mso | IE]></td><![endif]-->'
            : ''}
    </>;
};