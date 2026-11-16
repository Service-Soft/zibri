import { AccordionMarkupUtilities } from './accordion-markup.utilities';
import { AccordionContext, AccordionSettings } from './accordion.context';
import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailPaddingProps } from './dimensions';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjAccordionText}.
 */
export type MjAccordionTextProps = EmailPaddingProps & {
    /**
     * Background color of the text.
     */
    backgroundColor?: string,
    /**
     * Text color.
     */
    color?: string,
    /**
     * Font size. Defaults to `13px`.
     */
    fontSize?: string,
    /**
     * Font stack. Defaults to the element's, then the accordion's.
     */
    fontFamily?: string,
    /**
     * Font weight.
     */
    fontWeight?: string,
    /**
     * Letter spacing.
     */
    letterSpacing?: string,
    /**
     * Line height. Defaults to `1`.
     */
    lineHeight?: string,
    /**
     * A CSS class added to the text's cell.
     */
    cssClass?: string
};

/**
 * The text of an accordion element, which opening the element shows. Mirrors MJML's `mj-accordion-text`. The
 * default padding is `16px`.
 */
export const MjAccordionText: TsxComponent<MjAccordionTextProps> = defineEmailComponent<MjAccordionTextProps>(
    'MjAccordionText',
    (props, $ssr) => {
        const settings: AccordionSettings | undefined = $ssr.useContext(AccordionContext);
        if (settings !== undefined) {
            settings.parts.text = true;
        }
        const p: MjAccordionTextProps = withDefaults($ssr, 'MjAccordionText', props);

        return $ssr.raw(AccordionMarkupUtilities.resolveText(p, settings, $ssr.child(props.children)));
    }
);