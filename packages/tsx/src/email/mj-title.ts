import { defineEmailComponent, TsxComponent } from './define-email-component.ts';
import { HeadChannel } from './head-channels.ts';
import { textContent } from './text-content.ts';

/**
 * The document title. Mirrors MJML's `mj-title`: it sets the `<title>` in the head and renders
 * nothing in the body.
 */
export const MjTitle: TsxComponent<{}> = defineEmailComponent<{}>('MjTitle', (props, $ssr) => {
    $ssr.collect(HeadChannel.title, textContent(props.children, $ssr));

    return $ssr.raw('');
});