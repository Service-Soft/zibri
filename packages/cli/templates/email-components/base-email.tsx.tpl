import { LocaleCode, MjAttributes, MjBody, MjHead, Mjml, MjStyle, MjTitle, TsxChildren, TsxComponent } from 'zibri';

type Props = {
    title: string,
    children: TsxChildren,
    lang?: LocaleCode,
    dir?: 'auto' | 'rtl' | 'ltr',
    backgroundColor?: string,
    width?: string,
    cssClass?: string,
    color?: string,
    fontFamily?: string,
    lineHeight?: number,
    textAlign?: 'left' | 'center' | 'right' | 'justify'
};

const HOVER_STYLES: string = '.btn-primary a:hover {'
    + ' background-color: #0e456f !important;'
    + ' transition: background-color 300ms ease !important;'
    + ' }';

export const BaseEmail: TsxComponent<Props> = ({
    title,
    children,
    lang = 'und',
    dir = 'auto',
    backgroundColor = '#2a2a35',
    width,
    cssClass,
    color = 'whitesmoke',
    fontFamily,
    lineHeight,
    textAlign
}) => {
    // Document-wide typography defaults, applied through MJML's mj-attributes. Only the set values are
    // included so unset ones keep MJML's defaults.
    const typography: Record<string, string> = {
        color,
        ...fontFamily ? { fontFamily } : {},
        ...textAlign ? { textAlign } : {},
        ...lineHeight === undefined ? {} : { lineHeight: String(lineHeight) }
    };

    return (
        <Mjml lang={lang} dir={dir}>
            <MjHead>
                <MjTitle>{title}</MjTitle>
                <MjAttributes all={typography}/>
                <MjStyle>{HOVER_STYLES}</MjStyle>
            </MjHead>
            <MjBody backgroundColor={backgroundColor} width={width} cssClass={cssClass}>
                {children}
            </MjBody>
        </Mjml>
    );
};