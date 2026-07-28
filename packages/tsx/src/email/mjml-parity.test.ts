import { describe, expect, it } from '@jest/globals';
import mjml2html from 'mjml';

import { MjBody } from './mj-body';
import { MjButton } from './mj-button';
import { MjColumn } from './mj-column';
import { MjDivider } from './mj-divider';
import { MjGroup } from './mj-group';
import { MjHead } from './mj-head';
import { MjImage } from './mj-image';
import { MjPreview } from './mj-preview';
import { MjSection } from './mj-section';
import { MjSpacer } from './mj-spacer';
import { MjStyle } from './mj-style';
import { MjText } from './mj-text';
import { MjTitle } from './mj-title';
import { MjWrapper } from './mj-wrapper';
import { Mjml } from './mjml';
import { renderEmail, Mount } from '../__testing__/email-render.helper';

/**
 * The structural fingerprint of an email's body: the ordered list of element tags, including those
 * inside Outlook conditional comments (the ghost tables that decide whether Outlook lays the email
 * out correctly) but ignoring attributes, text and how the comments happen to be grouped.
 *
 * This is the parity that matters - byte equality with MJML is neither achievable nor the goal, but
 * the tag skeleton is exactly what determines whether the same email renders.
 * @param html - The full document HTML.
 * @returns The ordered tag tokens of the body, e.g. `['div', 'table', 'tr', ..., '/div']`.
 */
function bodyTagSkeleton(html: string): string[] {
    const body: string = html.slice(html.indexOf('<body'), html.indexOf('</body>') + '</body>'.length);
    const withoutConditionals: string = body
        .replaceAll(/<!--\[if[^\]]*]>/g, '')
        .replaceAll('<!--<![endif]-->', '')
        .replaceAll('<![endif]-->', '')
        .replaceAll(/<!--[\S\s]*?-->/g, '');

    return [...withoutConditionals.matchAll(/<(\/?)([A-Za-z][\dA-Za-z]*)\b[^>]*?>/g)]
        .map(match => `${match[1]}${match[2].toLowerCase()}`);
}

/**
 * The responsive column rules an email's head declares, normalized and sorted so they can be compared
 * regardless of whitespace or ordering. These are what make columns keep their width on desktop and
 * stack on mobile.
 * @param html - The full document HTML.
 * @returns The `.mj-column-per-N { ... }` rules found in the head.
 */
function columnRules(html: string): string[] {
    const head: string = html.slice(0, html.indexOf('</head>'));

    return [...head.matchAll(/(\.moz-text-html )?\.mj-column-per-\d+\s*{[^}]*}/g)]
        .map(match => match[0].replaceAll(/\s+/g, ' ').trim())
        .sort();
}

/**
 * Renders MJML source to HTML, asserting it validated cleanly.
 * @param source - The MJML source.
 * @returns The rendered HTML.
 */
async function fromMjml(source: string): Promise<string> {
    const result: { html: string, errors: unknown[] } = await mjml2html(source, { validationLevel: 'strict' });
    expect(result.errors).toEqual([]);
    return result.html;
}

describe('MJML structural parity', () => {
    it('matches the body skeleton of a section/column/text email', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'Hello'))))));
        const theirs: string = await fromMjml(
            '<mjml><mj-body><mj-section><mj-column><mj-text>Hello</mj-text></mj-column></mj-section></mj-body></mjml>'
        );

        expect(bodyTagSkeleton(ours)).toEqual(bodyTagSkeleton(theirs));
    });

    it('matches the body skeleton of a two-column section', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => [
            mount(MjColumn, { width: '50%' }, () => mount(MjText, {}, () => 'a')),
            mount(MjColumn, { width: '50%' }, () => mount(MjText, {}, () => 'b'))
        ]))));
        const theirs: string = await fromMjml(
            '<mjml><mj-body><mj-section>'
            + '<mj-column width="50%"><mj-text>a</mj-text></mj-column>'
            + '<mj-column width="50%"><mj-text>b</mj-text></mj-column>'
            + '</mj-section></mj-body></mjml>'
        );

        expect(bodyTagSkeleton(ours)).toEqual(bodyTagSkeleton(theirs));
    });

    /**
     * Wraps a single column's content in the standard mjml/body/section/column skeleton, both for our
     * components and for the MJML source, and asserts the two body skeletons match.
     * @param ourContent - Builds our content inside the column.
     * @param mjmlContent - The equivalent MJML content markup.
     */
    async function expectContentParity(ourContent: (mount: Mount) => unknown, mjmlContent: string): Promise<void> {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => ourContent(mount))))));
        const theirs: string = await fromMjml(
            `<mjml><mj-body><mj-section><mj-column>${mjmlContent}</mj-column></mj-section></mj-body></mjml>`
        );

        expect(bodyTagSkeleton(ours)).toEqual(bodyTagSkeleton(theirs));
    }

    it('matches a button', async () => {
        await expectContentParity(
            (mount: Mount) => mount(MjButton, { href: 'https://x.com' }, () => 'Go'),
            '<mj-button href="https://x.com">Go</mj-button>'
        );
    });

    it('matches an image', async () => {
        await expectContentParity(
            (mount: Mount) => mount(MjImage, { src: 'https://x.com/a.png', alt: 'A' }),
            '<mj-image src="https://x.com/a.png" alt="A" />'
        );
    });

    it('matches a divider, including its Outlook ghost table', async () => {
        await expectContentParity((mount: Mount) => mount(MjDivider, {}), '<mj-divider />');
    });

    it('matches a spacer', async () => {
        await expectContentParity((mount: Mount) => mount(MjSpacer, {}), '<mj-spacer />');
    });

    it('matches a group of side-by-side columns', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjGroup, {}, () => [
            mount(MjColumn, { width: '50%' }, () => mount(MjText, {}, () => 'a')),
            mount(MjColumn, { width: '50%' }, () => mount(MjText, {}, () => 'b'))
        ])))));
        const theirs: string = await fromMjml(
            '<mjml><mj-body><mj-section><mj-group>'
            + '<mj-column width="50%"><mj-text>a</mj-text></mj-column>'
            + '<mj-column width="50%"><mj-text>b</mj-text></mj-column>'
            + '</mj-group></mj-section></mj-body></mjml>'
        );

        expect(bodyTagSkeleton(ours)).toEqual(bodyTagSkeleton(theirs));
    });

    it('matches a wrapper containing a section', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjWrapper, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'x')))))));
        const theirs: string = await fromMjml(
            '<mjml><mj-body><mj-wrapper><mj-section><mj-column><mj-text>x</mj-text>'
            + '</mj-column></mj-section></mj-wrapper></mj-body></mjml>'
        );

        expect(bodyTagSkeleton(ours)).toEqual(bodyTagSkeleton(theirs));
    });

    it('emits the responsive rule for a full-width column', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'x'))))));
        const theirs: string = await fromMjml(
            '<mjml><mj-body><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>'
        );

        expect(columnRules(ours)).toEqual(columnRules(theirs));
    });

    it('matches the title MJML puts in the head', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjHead, {}, () => mount(MjTitle, {}, () => 'Welcome'))));
        const theirs: string = await fromMjml('<mjml><mj-head><mj-title>Welcome</mj-title></mj-head><mj-body></mj-body></mjml>');
        const titleOf: (html: string) => string = (html: string) => (/<title>([^<]*)<\/title>/.exec(html) ?? ['', ''])[1];

        expect(titleOf(ours)).toBe('Welcome');
        expect(titleOf(ours)).toBe(titleOf(theirs));
    });

    it('matches the hidden preview block MJML puts at the start of the body', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjHead, {}, () => mount(MjPreview, {}, () => 'Peek inside'))));
        const theirs: string = await fromMjml('<mjml><mj-head><mj-preview>Peek inside</mj-preview></mj-head><mj-body></mj-body></mjml>');
        const previewStyle: (html: string) => string = (html: string) => {
            const match: RegExpExecArray | null = /<div style="([^"]*)">Peek inside<\/div>/.exec(html);
            return (match ?? ['', ''])[1].split(';').filter(Boolean)
                .sort()
                .join(';');
        };

        expect(ours).toContain('>Peek inside</div>');
        expect(previewStyle(ours)).toBe(previewStyle(theirs));
    });

    it('places custom mj-style CSS in the head, like MJML', async () => {
        const css: string = '.brand { color: red; }';
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjHead, {}, () => mount(MjStyle, {}, () => css))));
        const theirs: string = await fromMjml(`<mjml><mj-head><mj-style>${css}</mj-style></mj-head><mj-body></mj-body></mjml>`);
        const headHas: (html: string) => boolean = (html: string) => html.slice(0, html.indexOf('</head>')).includes(css);

        expect(headHas(ours)).toBe(true);
        expect(headHas(theirs)).toBe(true);
    });

    it('emits a rule per distinct column width the body used', async () => {
        // Two widths appear (50% and 100%); MJML deduplicates and emits one rule for each.
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => [
            mount(MjSection, {}, () => [
                mount(MjColumn, { width: '50%' }, () => mount(MjText, {}, () => 'a')),
                mount(MjColumn, { width: '50%' }, () => mount(MjText, {}, () => 'b'))
            ]),
            mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'c')))
        ])));
        const theirs: string = await fromMjml(
            '<mjml><mj-body>'
            + '<mj-section><mj-column width="50%"><mj-text>a</mj-text></mj-column>'
            + '<mj-column width="50%"><mj-text>b</mj-text></mj-column></mj-section>'
            + '<mj-section><mj-column><mj-text>c</mj-text></mj-column></mj-section>'
            + '</mj-body></mjml>'
        );

        expect(columnRules(ours)).toEqual(columnRules(theirs));
    });
});