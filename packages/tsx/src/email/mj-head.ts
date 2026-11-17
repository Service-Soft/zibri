import { defineEmailComponent, TsxComponent } from './define-email-component';
import { EmailRegionContext } from './email-region.context';

/**
 * The document head container. Mirrors MJML's `mj-head`: it produces no body output itself - its
 * children only record what the document should put in the head, which `Mjml` reads back once
 * the whole tree has rendered.
 */
export const MjHead: TsxComponent<{}> = defineEmailComponent<{}>('MjHead', (props, $ssr) => {
    $ssr.provideContext(EmailRegionContext, 'head');
    // Render the children so they record their contributions; their own output is empty.
    $ssr.child(props.children);

    return $ssr.raw('');
});