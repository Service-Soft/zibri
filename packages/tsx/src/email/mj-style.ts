import { defineEmailComponent, TsxComponent } from './define-email-component';
import { HeadChannel } from './head-channels';
import { textContent } from './text-content';

/**
 * A block of custom CSS. Mirrors MJML's `mj-style`: its content is recorded and emitted verbatim in
 * a `<style>` in the head.
 */
export const MjStyle: TsxComponent<{}> = defineEmailComponent<{}>('MjStyle', (props, $ssr) => {
    $ssr.collect(HeadChannel.style, textContent(props.children, $ssr));

    return $ssr.raw('');
});