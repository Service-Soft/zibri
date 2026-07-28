import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailLayout, EmailLayoutContext } from './email-layout.context';
import { documentDefaults, withDefaults } from './with-defaults';

/**
 * Props for {@link MjBody}.
 */
export type MjBodyProps = {
    /**
     * The content width the sections lay out within. Defaults to MJML's `600px`.
     */
    width?: string,
    /**
     * Background color of the whole email.
     */
    backgroundColor?: string,
    /**
     * A CSS class added to the article wrapper.
     */
    cssClass?: string
};

/**
 * The email's body. Mirrors MJML's `mj-body`: the article wrapper, and the point where the content
 * width is fixed. Establishes that width on the layout so every nested section and column resolves
 * against it.
 */
export const MjBody: TsxComponent<MjBodyProps> = defineEmailComponent<MjBodyProps>('MjBody', (props, $ssr) => {
    const p: MjBodyProps = withDefaults($ssr, 'MjBody', props);
    const parent: EmailLayout = $ssr.useContext(EmailLayoutContext);
    // Document-wide typography from `MjAttributes.all` overrides the inherited defaults, so nested
    // components that read the layout pick it up. `all` values are strings from JSON, hence the one
    // coercion at this boundary.
    const all: Record<string, string> = documentDefaults($ssr).all;
    $ssr.provideContext(EmailLayoutContext, {
        width: p.width ?? '600px',
        dir: (all['dir'] as EmailLayout['dir']) || parent.dir,
        textAlign: (all['textAlign'] as EmailLayout['textAlign']) || parent.textAlign,
        color: all['color'] || parent.color,
        fontFamily: all['fontFamily'] || parent.fontFamily,
        lineHeight: all['lineHeight'] !== undefined ? Number(all['lineHeight']) : parent.lineHeight
    });
    const background: string = p.backgroundColor ? `background-color:${p.backgroundColor};` : '';
    const cssClass: string = p.cssClass ? ` class="${p.cssClass}"` : '';

    return $ssr.raw(
        `<div${cssClass} aria-roledescription="email" role="article" lang="und" dir="auto" `
        + `style="${background}word-spacing:normal;">`
        + $ssr.child(props.children)
        + '</div>'
    );
});