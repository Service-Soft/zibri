import { ComponentChildren } from 'preact';
import { PreactEmailComponent } from 'zibri';

import { EmailColumn } from './email-column';
import { EmailContext, EmailContextValue, useEmailContext } from './email-context';
import { EmailDivider } from './email-divider';
import { EmailText } from './email-text';

type Props = {
    children: ComponentChildren,
    title?: string,
    color?: string,
    fontFamily?: string,
    lineHeight?: number,
    backgroundColor?: string,
    backgroundUrl?: string,
    backgroundSize?: string,
    backgroundRepeat?: 'repeat' | 'repeat-x' | 'repeat-y' | 'no-repeat' | 'initial' | 'inherit',
    backgroundPosition?: string,
    backgroundPositionX?: string,
    backgroundPositionY?: string,
    border?: string,
    borderBottom?: string,
    borderLeft?: string,
    borderRight?: string,
    borderTop?: string,
    borderRadius?: string,
    direction?: 'ltr' | 'rtl',
    fullWidth?: boolean,
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,
    textAlign?: 'left' | 'center' | 'right' | 'justify',
    cssClass?: string
};

export const EmailSection: PreactEmailComponent<Props> = ({
    children,
    title,
    color,
    fontFamily,
    lineHeight,
    backgroundColor,
    backgroundUrl,
    backgroundSize = 'auto',
    backgroundRepeat = 'repeat',
    backgroundPosition = 'top center',
    backgroundPositionX = 'none',
    backgroundPositionY = 'none',
    border = 'none',
    borderBottom,
    borderLeft,
    borderRight,
    borderTop,
    borderRadius,
    direction = 'ltr',
    fullWidth = false,
    padding = '0 0',
    paddingTop,
    paddingRight,
    paddingBottom = '20px',
    paddingLeft,
    textAlign = 'center',
    cssClass = ''
}) => {
    const ctx: EmailContextValue = useEmailContext();

    const widthNum: number | undefined = Number.isNaN(Number.parseInt(ctx.width))
        ? undefined
        : Number.parseInt(ctx.width);

    const resolvedPadding: string = [
        paddingTop ?? padding.split(' ')[0],
        paddingRight ?? padding.split(' ')[1] ?? padding.split(' ')[0],
        paddingBottom ?? padding.split(' ')[2] ?? padding.split(' ')[0],
        paddingLeft ?? padding.split(' ')[3] ?? padding.split(' ')[1] ?? padding.split(' ')[0]
    ].join(' ');

    const resolvedBackgroundPositionX: string = backgroundPositionX !== 'none'
        ? backgroundPositionX
        : backgroundPosition.split(' ')[0] ?? 'top';
    const resolvedBackgroundPositionY: string = backgroundPositionY !== 'none'
        ? backgroundPositionY
        : backgroundPosition.split(' ')[1] ?? 'center';
    const resolvedBackgroundPosition: string = `${resolvedBackgroundPositionX} ${resolvedBackgroundPositionY}`;
    const backgroundStyle: string = [
        backgroundUrl
            ? `background:url(${backgroundUrl}) ${resolvedBackgroundPosition} / ${backgroundSize} ${backgroundRepeat}`
            : '',
        backgroundColor ? `background-color:${backgroundColor}` : ''
    ].filter(Boolean).join('; ');

    const borderStyle: string = [
        border !== 'none' ? `border:${border}` : '',
        borderTop ? `border-top:${borderTop}` : '',
        borderRight ? `border-right:${borderRight}` : '',
        borderBottom ? `border-bottom:${borderBottom}` : '',
        borderLeft ? `border-left:${borderLeft}` : '',
        borderRadius ? `border-radius:${borderRadius}` : ''
    ].filter(Boolean).join('; ');

    const containerStyle: string = [
        backgroundStyle,
        'margin:0px auto',
        `max-width:${ctx.width}`,
        borderRadius ? `border-radius:${borderRadius}` : ''
    ].filter(Boolean).join('; ');

    const tableStyle: string = [
        backgroundStyle,
        borderStyle,
        'width:100%'
    ].filter(Boolean).join('; ');

    const tdStyle: string = [
        `direction:${direction}`,
        'font-size:0px',
        `padding:${resolvedPadding}`,
        `text-align:${textAlign}`
    ].join('; ');

    const msoBgColor: string = backgroundColor && fullWidth ? ` bgcolor="${backgroundColor}"` : '';

    const resolvedColor: string = color ?? ctx.color;
    const resolvedFontFamily: string = fontFamily ?? ctx.fontFamily;
    const resolvedLineHeight: number = lineHeight ?? ctx.lineHeight;

    return (
        <EmailContext.Provider value={{
            width: ctx.width,
            dir: direction,
            textAlign,
            color: resolvedColor,
            fontFamily: resolvedFontFamily,
            lineHeight: resolvedLineHeight
        }}>
            {/* eslint-disable-next-line stylistic/max-len */}
            {`<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="${cssClass}" role="presentation" style="width:${ctx.width};" width="${widthNum ?? ctx.width}"${msoBgColor}><tr><td style="line-height:0px;font-size:0px;mso-line-height-rule:exactly;"><![endif]-->`}
            <div class={cssClass} style={containerStyle}>
                <table
                    {...{ align: 'center', border: '0' }}
                    cellPadding="0"
                    cellSpacing="0"
                    role="presentation"
                    style={tableStyle}
                >
                    <tbody>
                        <tr>
                            <td style={tdStyle}>
                                {title && <>
                                    <EmailColumn width='100%'>
                                        <EmailText tag='h2' fontWeight="bold" fontSize="18px">
                                            {title}
                                        </EmailText>
                                        <EmailDivider paddingBottom='4px' paddingTop='1px'/>
                                    </EmailColumn>
                                </>}
                                {children}
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            {'<!--[if mso | IE]></td></tr></table><![endif]-->'}
        </EmailContext.Provider>
    );
};