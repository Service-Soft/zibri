/**
 * The width just below a breakpoint, where the mobile rules of a component start. Mirrors MJML's
 * `makeLowerBreakpoint`.
 * @param breakpoint - The breakpoint, e.g. `480px`.
 * @returns The width a pixel below it, or the breakpoint itself when it holds no number.
 */
function lowerBreakpoint(breakpoint: string): string {
    const match: RegExpExecArray | null = /\d+/.exec(breakpoint);
    return match == undefined ? breakpoint : `${Number.parseInt(match[0], 10) - 1}px`;
}

/**
 * The styles a component shares between all its instances, by the component's name, each built for the
 * document's breakpoint. Mirrors the `headStyle` of MJML's components: the head carries each once, for every
 * component of the email that has one.
 */
export const COMPONENT_HEAD_STYLES: Readonly<Record<string, (breakpoint: string) => string>> = {
    MjNavbar: breakpoint => 'noinput.mj-menu-checkbox { display:block!important; max-height:none!important; visibility:visible!important; }'
        + `@media only screen and (max-width:${lowerBreakpoint(breakpoint)}) {`
        + '.mj-menu-checkbox[type="checkbox"] ~ .mj-inline-links { display:none!important; }'
        + '.mj-menu-checkbox[type="checkbox"]:checked ~ .mj-inline-links,'
        + '.mj-menu-checkbox[type="checkbox"] ~ .mj-menu-trigger { display:block!important; max-width:none!important; '
        + 'max-height:none!important; font-size:inherit!important; }'
        + '.mj-menu-checkbox[type="checkbox"] ~ .mj-inline-links > a { display:block!important; }'
        + '.mj-menu-checkbox[type="checkbox"]:checked ~ .mj-menu-trigger .mj-menu-icon-close { display:block!important; }'
        + '.mj-menu-checkbox[type="checkbox"]:checked ~ .mj-menu-trigger .mj-menu-icon-open { display:none!important; }'
        + '}',
    MjAccordion: () => 'noinput.mj-accordion-checkbox { display:block!important; }'
        + '@media yahoo, only screen and (min-width:0) {'
        + '.mj-accordion-element { display:block; }'
        + '.mj-accordion-checkbox[type="checkbox"], .mj-accordion-less { display:none!important; }'
        + '.mj-accordion-checkbox[type="checkbox"] + * .mj-accordion-title { cursor:pointer; touch-action:manipulation; '
        + '-webkit-user-select:none; -moz-user-select:none; user-select:none; }'
        + '.mj-accordion-checkbox[type="checkbox"] + * .mj-accordion-content { overflow:hidden; display:none; }'
        + '.mj-accordion-checkbox[type="checkbox"] + * .mj-accordion-more { display:block!important; }'
        + '.mj-accordion-checkbox:checked + * .mj-accordion-content { display:block; }'
        + '.mj-accordion-checkbox:checked + * .mj-accordion-more { display:none!important; }'
        + '.mj-accordion-checkbox:checked + * .mj-accordion-less { display:block!important; }'
        + '}'
        + '.moz-text-html input.mj-accordion-checkbox + * .mj-accordion-title { cursor: auto; touch-action: auto; '
        + '-webkit-user-select: auto; -moz-user-select: auto; user-select: auto; }'
        + '.moz-text-html input.mj-accordion-checkbox + * .mj-accordion-content { overflow: hidden; display: block; }'
        + '.moz-text-html input.mj-accordion-checkbox + * .mj-accordion-ico { display: none; }'
        + '@goodbye { @gmail }'
};