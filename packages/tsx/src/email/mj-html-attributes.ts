import { defineEmailComponent, TsxComponent } from './define-email-component';
import { HeadChannel } from './head-channels';
import { EmailHtmlAttribute } from './head-records';
import { textContent } from './text-content';
import { withDefaults } from './with-defaults';
import { ATTRIBUTE_NAME } from '../runtime/attribute-rules';
import { createContext, escapeAttribute, RenderContext } from '../runtime/server-runtime';

/**
 * The selector the attributes in an `MjSelector` are set on the elements of.
 */
const SelectorContext: RenderContext<string | undefined> = createContext<string | undefined>(undefined);

/**
 * Attributes set on elements of the rendered email. Mirrors MJML's `mj-html-attributes`: it renders nothing, and
 * each `MjSelector` in it names the elements its `MjHtmlAttribute`s are set on. It needs the package `cheerio`,
 * which matches the selectors as MJML does.
 */
export const MjHtmlAttributes: TsxComponent<{}> = defineEmailComponent<{}>('MjHtmlAttributes', (props, $ssr) => {
    $ssr.child(props.children);

    return $ssr.raw('');
});

/**
 * Props for {@link MjSelector}.
 */
export type MjSelectorProps = {
    /**
     * The CSS selector of the elements, e.g. `.custom div`.
     */
    path: string
};

/**
 * The elements the `MjHtmlAttribute`s in it are set on. Mirrors MJML's `mj-selector`.
 */
export const MjSelector: TsxComponent<MjSelectorProps> = defineEmailComponent<MjSelectorProps>('MjSelector', (props, $ssr) => {
    $ssr.provideContext(SelectorContext, props.path);
    $ssr.child(props.children);

    return $ssr.raw('');
});

/**
 * Props for {@link MjHtmlAttribute}.
 */
export type MjHtmlAttributeProps = {
    /**
     * The attribute's name, e.g. `data-id`.
     */
    name: string
};

/**
 * One attribute, whose value is its text, set on the elements the `MjSelector` around it names. Mirrors MJML's
 * `mj-html-attribute`. A name that is not one an attribute can have is left out.
 */
export const MjHtmlAttribute: TsxComponent<MjHtmlAttributeProps> = defineEmailComponent<MjHtmlAttributeProps>(
    'MjHtmlAttribute',
    (props, $ssr) => {
        const path: string | undefined = $ssr.useContext(SelectorContext);
        const name: string = withDefaults($ssr, 'MjHtmlAttribute', props).name;
        if (path !== undefined && ATTRIBUTE_NAME.test(name)) {
            // the attribute is written as it is set, so its value is escaped here
            const attribute: EmailHtmlAttribute = { path, name, value: escapeAttribute(textContent(props.children, $ssr)) };
            $ssr.collect(HeadChannel.htmlAttribute, JSON.stringify(attribute));
        }

        return $ssr.raw('');
    }
);