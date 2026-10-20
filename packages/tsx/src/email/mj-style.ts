import { defineEmailComponent, TsxComponent } from './define-email-component.ts';
import { HeadChannel } from './head-channels.ts';
import { textContent } from './text-content.ts';

/**
 * A block of custom CSS. Mirrors MJML's `mj-style`: its content is recorded and emitted verbatim in
 * a `<style>` in the head.
 */
export const MjStyle: TsxComponent<{}> = defineEmailComponent<{}>('MjStyle', (props, $ssr) => {
    $ssr.collect(HeadChannel.style, textContent(props.children, $ssr));

    return $ssr.raw('');
});