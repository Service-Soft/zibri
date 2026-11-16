import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailRegion, EmailRegionContext } from './email-region.context';
import { HeadChannel } from './head-channels';

/**
 * Props for {@link MjRaw}.
 */
export type MjRawProps = {
    /**
     * `file-start` puts the content before the doctype, for an `MjRaw` directly in `Mjml`.
     */
    position?: 'file-start'
};

/**
 * A passthrough for trusted markup. Mirrors MJML's `mj-raw`: its content is emitted verbatim, with
 * no wrapping and no escaping - so a string child is treated as raw HTML rather than text. In the body it is
 * emitted where it stands, in `MjHead` at the end of the head, and directly in `Mjml` before the doctype when its
 * `position` is `file-start`, and nowhere otherwise.
 */
export const MjRaw: TsxComponent<MjRawProps> = defineEmailComponent<MjRawProps>('MjRaw', (props, $ssr) => {
    const content: unknown = props.children;
    const markup: string = typeof content === 'string' ? content : $ssr.child(content);
    const region: EmailRegion = $ssr.useContext(EmailRegionContext);
    switch (region) {
        case 'head': {
            $ssr.collect(HeadChannel.raw, markup);
            return $ssr.raw('');
        }
        case 'document': {
            if (props.position === 'file-start') {
                $ssr.collect(HeadChannel.beforeDoctype, markup);
            }
            return $ssr.raw('');
        }
        case 'body': {
            return $ssr.raw(markup);
        }
    }
});