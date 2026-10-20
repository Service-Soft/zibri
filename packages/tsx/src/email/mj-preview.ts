import { defineEmailComponent, TsxComponent } from './define-email-component.ts';
import { HeadChannel } from './head-channels.ts';
import { textContent } from './text-content.ts';

/**
 * The inbox preview text. Mirrors MJML's `mj-preview`: recorded here, then emitted by `Mjml`
 * as a hidden block at the very start of the body so mail clients show it as the snippet.
 */
export const MjPreview: TsxComponent<{}> = defineEmailComponent<{}>('MjPreview', (props, $ssr) => {
    $ssr.collect(HeadChannel.preview, textContent(props.children, $ssr));

    return $ssr.raw('');
});