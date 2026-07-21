import { PreactEmailComponent } from 'zibri';

import { EmailContextValue, useEmailContext } from './email-context';

type Props = {
    children: string | string[],
    tag?: 'div' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
    color?: string,
    fontFamily?: string,
    fontSize?: string,
    fontStyle?: 'normal' | 'italic' | 'oblique',
    fontWeight?: string,
    letterSpacing?: string,
    lineHeight?: number,
    align?: 'left' | 'right' | 'center' | 'justify',
    textDecoration?: string,
    textTransform?: 'none' | 'capitalize' | 'uppercase' | 'lowercase',
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,
    containerBackgroundColor?: string,
    height?: string,
    cssClass?: string
};

export const EmailText: PreactEmailComponent<Props> = ({
    children,
    color,
    fontFamily,
    fontSize = '16px',
    fontStyle = 'normal',
    fontWeight = 'normal',
    letterSpacing,
    lineHeight,
    align = 'left',
    textDecoration = 'none',
    textTransform = 'none',
    padding = '0px',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    containerBackgroundColor,
    height,
    tag = 'div',
    cssClass = ''
}) => {
    const ctx: EmailContextValue = useEmailContext();
    const TagName: typeof tag = tag;

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

    const textStyle: string = [
        `color:${resolvedColor}`,
        `font-family:${resolvedFontFamily}`,
        `font-size:${fontSize}`,
        `font-style:${fontStyle}`,
        `font-weight:${fontWeight}`,
        `letter-spacing:${letterSpacing ?? 'normal'}`,
        `line-height:${resolvedLineHeight}`,
        'margin:0',
        `text-align:${align}`,
        `text-decoration:${textDecoration}`,
        `text-transform:${textTransform}`
    ].join('; ');

    return <>
        {containerBackgroundColor
            ? `<!--[if mso | IE]><td class="${cssClass}" style="background:${containerBackgroundColor};"><![endif]-->`
            : ''}
        <div
            class={cssClass}
            style={tdStyle}
        >
            <TagName style={textStyle}>
                {children}
            </TagName>
        </div>
        {containerBackgroundColor
            ? '<!--[if mso | IE]></td><![endif]-->'
            : ''}
    </>;
};