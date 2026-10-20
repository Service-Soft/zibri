import { defineEmailComponent, TsxComponent } from './define-email-component.ts';
import { HeadChannel } from './head-channels.ts';

/**
 * Default component attributes declared for the whole document. Mirrors MJML's `mj-attributes`, but
 * as typed data rather than pseudo-element children, which do not fit a typed component model.
 */
export type MjAttributesProps = {
    /**
     * Defaults applied to every component, lowest priority. MJML's `mj-all`.
     */
    all?: Record<string, string>,
    /**
     * Defaults applied to a specific component, keyed by its name (e.g. `MjButton`). These win over
     * `all`, and an explicit prop on the component wins over both.
     */
    defaults?: Record<string, Record<string, string>>
};

/**
 * Declares document-wide default attributes. Mirrors MJML's `mj-attributes`: it renders nothing and
 * only records the defaults, which each component merges under its explicit props. Place it in the
 * head (before the body) so the defaults are recorded before the components that read them render.
 */
export const MjAttributes: TsxComponent<MjAttributesProps> = defineEmailComponent<MjAttributesProps>(
    'MjAttributes',
    (props, $ssr) => {
        $ssr.collect(HeadChannel.attributes, JSON.stringify({ all: props.all ?? {}, defaults: props.defaults ?? {} }));

        return $ssr.raw('');
    }
);