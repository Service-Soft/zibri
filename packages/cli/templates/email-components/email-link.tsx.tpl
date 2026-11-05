import { MjText, TsxComponent } from 'zibri';

/**
 * A styled link. MJML has no link component - a link is an `<a>` inside text - so this wraps one in
 * an MjText, which provides the row/cell, while the anchor carries the link styling.
 */
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

export const EmailLink: TsxComponent<Props> = ({
    href,
    children,
    color = '#1a82e2',
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
    cssClass
}) => {
    const anchorStyle: string = [
        `color:${color}`,
        fontFamily ? `font-family:${fontFamily}` : '',
        `font-size:${fontSize}`,
        `font-style:${fontStyle}`,
        `font-weight:${fontWeight}`,
        letterSpacing ? `letter-spacing:${letterSpacing}` : '',
        lineHeight === undefined ? '' : `line-height:${lineHeight}`,
        'display:block',
        'margin:0',
        `text-align:${align}`,
        `text-decoration:${textDecoration}`,
        `text-transform:${textTransform}`,
        'mso-style-priority:99'
    ].filter(Boolean).join(';');

    return (
        <MjText
            align={align}
            padding={padding}
            paddingTop={paddingTop}
            paddingRight={paddingRight}
            paddingBottom={paddingBottom}
            paddingLeft={paddingLeft}
            containerBackgroundColor={containerBackgroundColor}
            height={height}
            cssClass={cssClass}
        >
            <a
                href={href}
                target={target}
                rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
                title={title}
                style={anchorStyle}
            >
                {children}
            </a>
        </MjText>
    );
};