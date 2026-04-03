import { ComponentChildren } from 'preact';
import { PreactEmailComponent } from 'zibri';

import { EmailContext, EmailContextValue, useEmailContext } from './email-context';

type Props = {
    children: ComponentChildren,
    backgroundColor?: string,
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,
    borderRadius?: string,
    border?: string,
    boxShadow?: string,
    width?: string,
    color?: string,
    fontFamily?: string,
    lineHeight?: number,
    cssClass?: string
};

export const EmailWrapper: PreactEmailComponent<Props> = ({
    children,
    backgroundColor,
    padding = '20px',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft,
    borderRadius,
    border,
    boxShadow,
    width,
    color,
    fontFamily,
    lineHeight,
    cssClass = ''
}) => {
    const ctx: EmailContextValue = useEmailContext();

    const resolvedWidth: string = width ?? ctx.width;
    const widthNum: number | undefined = Number.isNaN(Number.parseInt(resolvedWidth))
        ? undefined
        : Number.parseInt(resolvedWidth);

    const resolvedPadding: string = [
        paddingTop ?? padding.split(' ')[0],
        paddingRight ?? padding.split(' ')[1] ?? padding.split(' ')[0],
        paddingBottom ?? padding.split(' ')[2] ?? padding.split(' ')[0],
        paddingLeft ?? padding.split(' ')[3] ?? padding.split(' ')[1] ?? padding.split(' ')[0]
    ].join(' ');

    const outerTableStyle: string = [
        'margin:0 auto',
        `width:${resolvedWidth}`
    ].join('; ');

    const innerTdStyle: string = [
        backgroundColor ? `background-color:${backgroundColor}` : '',
        border ? `border:${border}` : '',
        borderRadius ? `border-radius:${borderRadius}` : '',
        boxShadow ? `box-shadow:${boxShadow}` : '',
        `padding:${resolvedPadding}`
    ].filter(Boolean).join('; ');

    return <>
        {/* eslint-disable-next-line stylistic/max-len */}
        {`<!--[if mso | IE]><table align="center" border="0" cellpadding="0" cellspacing="0" class="${cssClass}" role="presentation" style="width:${resolvedWidth};" width="${widthNum ?? resolvedWidth}"><tr><td style="${innerTdStyle}"><![endif]-->`}
        <table
            {...{ align: 'center', border: '0' }}
            cellPadding="0"
            cellSpacing="0"
            role="presentation"
            class={cssClass}
            style={outerTableStyle}
        >
            <tbody>
                <tr>
                    <td style={innerTdStyle}>
                        <EmailContext.Provider value={{
                            ...ctx,
                            width: resolvedWidth,
                            color: color ?? ctx.color,
                            fontFamily: fontFamily ?? ctx.fontFamily,
                            lineHeight: lineHeight ?? ctx.lineHeight
                        }}>
                            {children}
                        </EmailContext.Provider>
                    </td>
                </tr>
            </tbody>
        </table>
        {'<!--[if mso | IE]></td></tr></table><![endif]-->'}
    </>;
};