import { ComponentChildren } from 'preact';
import { PreactEmailComponent } from 'zibri';

type Props = {
    children: ComponentChildren,
    lang: string,
    dir: 'auto' | 'rtl' | 'ltr'
};

export const EmailHtml: PreactEmailComponent<Props> = ({
    lang,
    dir,
    children
}) => {
    return <html
        lang={lang}
        dir={dir}
        {
            ...{
                xmlns: 'http://www.w3.org/1999/xhtml',
                'xmlns:v': 'urn:schemas-microsoft-com:vml',
                'xmlns:o': 'urn:schemas-microsoft-com:office:office'
            }
        }
    >
        {children}
    </html>;
};