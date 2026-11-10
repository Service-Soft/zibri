import { defineEmailComponent, TsxComponent } from './define-email-component';
import { HeadChannel } from './head-channels';
import { withDefaults } from './with-defaults';

/**
 * Props for {@link MjBreakpoint}.
 */
export type MjBreakpointProps = {
    /**
     * The width below which columns stack, e.g. `320px`.
     */
    width: string
};

/**
 * The width below which columns stack, which is `480px` in an email without one. Mirrors MJML's `mj-breakpoint`: it
 * renders nothing, and the responsive rules of the head use its width.
 */
export const MjBreakpoint: TsxComponent<MjBreakpointProps> = defineEmailComponent<MjBreakpointProps>('MjBreakpoint', (props, $ssr) => {
    $ssr.collect(HeadChannel.breakpoint, withDefaults($ssr, 'MjBreakpoint', props).width);

    return $ssr.raw('');
});