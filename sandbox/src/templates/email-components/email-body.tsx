import { ComponentChildren } from 'preact';
import { PreactEmailComponent } from 'zibri';

import { EmailContext } from './email-context';

type Props = {
    lang: string,
    dir: 'auto' | 'rtl' | 'ltr',
    children: ComponentChildren,
    backgroundColor: string | undefined,
    width: string | undefined,
    cssClass: string | undefined,
    textAlign: 'left' | 'center' | 'right' | 'justify' | undefined,
    color: string | undefined,
    fontFamily: string | undefined,
    lineHeight: number | undefined,
    padding: string | undefined,
    paddingTop: string | undefined,
    paddingRight: string | undefined,
    paddingBottom: string | undefined,
    paddingLeft: string | undefined
};

export const EmailBody: PreactEmailComponent<Props> = ({
    lang,
    dir,
    children,
    backgroundColor,
    width = '600px',
    cssClass = '',
    textAlign = 'center',
    color = '#000000',
    fontFamily = 'Ubuntu, Helvetica, Arial, sans-serif',
    lineHeight = 1.25,
    padding = '0px',
    paddingTop,
    paddingRight,
    paddingBottom,
    paddingLeft
}) => {
    const resolvedPadding: string = [
        paddingTop ?? padding.split(' ')[0],
        paddingRight ?? padding.split(' ')[1] ?? padding.split(' ')[0],
        paddingBottom ?? padding.split(' ')[2] ?? padding.split(' ')[0],
        paddingLeft ?? padding.split(' ')[3] ?? padding.split(' ')[1] ?? padding.split(' ')[0]
    ].join(' ');
    const backgroundColorStyle: string = backgroundColor ? `background-color: ${backgroundColor};` : '';
    const bodyStyle: string = [
        'word-spacing:normal',
        backgroundColorStyle,
        `color:${color}`,
        `font-family:${fontFamily}`,
        `line-height:${lineHeight}`
    ].filter(Boolean).join('; ');
    const outerTdStyle: string = [
        backgroundColorStyle,
        `padding:${resolvedPadding}`
    ].filter(Boolean).join('; ');

    return (
        <EmailContext.Provider value={{ width, dir: dir === 'auto' ? 'ltr' : dir, textAlign, color, fontFamily, lineHeight }}>
            <body style={bodyStyle}>
                <div aria-roledescription="email" className={cssClass} style={backgroundColorStyle} role="article" lang={lang} dir={dir}>
                    <table
                        {...{ border: '0' }}
                        cellPadding="0"
                        cellSpacing="0"
                        role="presentation"
                        style="width:100%; height:100%;"
                    >
                        <tbody>
                            <tr>
                                <td
                                    {...{ valign: 'top' }}
                                    style={outerTdStyle}
                                >
                                    {children}
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </body>
        </EmailContext.Provider>
    );
};