import { ComponentChildren } from 'preact';
import { LanguageCode, PreactEmailComponent } from 'zibri';

import { EmailBody } from './email-body';
import { EmailHead } from './email-head';
import { EmailHtml } from './email-html';

type Props = {
    lang?: LanguageCode,
    dir?: 'auto' | 'rtl' | 'ltr',
    backgroundColor?: string,
    width?: string,
    cssClass?: string,
    textAlign?: 'left' | 'center' | 'right' | 'justify',
    color?: string,
    fontFamily?: string,
    lineHeight?: number,
    padding?: string,
    paddingTop?: string,
    paddingRight?: string,
    paddingBottom?: string,
    paddingLeft?: string,

    title: string,
    children: ComponentChildren
};

export const BaseEmail: PreactEmailComponent<Props> = ({
    title,
    children,
    dir = 'auto',
    lang = 'und',
    backgroundColor = '#2a2a35',
    color = 'whitesmoke',
    width,
    cssClass,
    textAlign,
    fontFamily,
    lineHeight,
    padding,
    paddingBottom = '40px',
    paddingLeft,
    paddingRight,
    paddingTop = '40px'
}) => {
    const customStyles: string = `
        .btn-primary a:hover {
            background-color: #0e456f !important;
            transition: background-color 300ms ease !important;
        }
    `;

    return (
        <EmailHtml lang={lang} dir={dir}>
            <EmailHead title={title} customStyles={customStyles} />
            <EmailBody
                backgroundColor={backgroundColor}
                cssClass={cssClass}
                dir={dir}
                textAlign={textAlign}
                lang={lang}
                width={width}
                color={color}
                fontFamily={fontFamily}
                lineHeight={lineHeight}
                padding={padding}
                paddingBottom={paddingBottom}
                paddingLeft={paddingLeft}
                paddingRight={paddingRight}
                paddingTop={paddingTop}
            >
                {children}
            </EmailBody>
        </EmailHtml>
    );
};