import { AccordionMarkupUtilities } from './accordion-markup.utilities';
import { AccordionContext, AccordionSettings } from './accordion.context';
import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailPaddingProps } from './dimensions';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjAccordionTitle}.
 */
export type MjAccordionTitleProps = EmailPaddingProps & {
    /**
     * Background color of the title.
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
     * A CSS class added to the title's cell.
     */
    cssClass?: string
};

/**
 * The title of an accordion element, which opens and closes it. Mirrors MJML's `mj-accordion-title`. The default
 * padding is `16px`.
 */
export const MjAccordionTitle: TsxComponent<MjAccordionTitleProps> = defineEmailComponent<MjAccordionTitleProps>(
    'MjAccordionTitle',
    (props, $ssr) => {
        const settings: AccordionSettings | undefined = $ssr.useContext(AccordionContext);
        if (settings !== undefined) {
            settings.parts.title = true;
        }
        const p: MjAccordionTitleProps = withDefaults($ssr, 'MjAccordionTitle', props);

        return $ssr.raw(AccordionMarkupUtilities.resolveTitle(p, settings, $ssr.child(props.children)));
    }
);