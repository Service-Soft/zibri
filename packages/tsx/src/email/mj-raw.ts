import { defineEmailComponent, TsxComponent } from './define-email-component.ts';

/**
 * A passthrough for trusted markup. Mirrors MJML's `mj-raw`: its content is emitted verbatim, with
 * no wrapping and no escaping - so a string child is treated as raw HTML rather than text.
 */
export const MjRaw: TsxComponent<{}> = defineEmailComponent<{}>('MjRaw', (props, $ssr) => {
    const content: unknown = props.children;

    return $ssr.raw(typeof content === 'string' ? content : $ssr.child(content));
});