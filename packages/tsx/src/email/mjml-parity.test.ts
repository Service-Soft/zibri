import { describe, expect, it } from '@jest/globals';
import mjml2html from 'mjml';

import { MjAccordion } from './mj-accordion';
import { MjAccordionElement } from './mj-accordion-element';
import { MjAccordionText } from './mj-accordion-text';
import { MjAccordionTitle } from './mj-accordion-title';
import { MjBody } from './mj-body';
import { MjBreakpoint } from './mj-breakpoint';
import { MjButton } from './mj-button';
import { MjCarousel } from './mj-carousel';
import { MjCarouselImage } from './mj-carousel-image';
import { MjColumn } from './mj-column';
import { MjDivider } from './mj-divider';
import { MjFont } from './mj-font';
import { MjGroup } from './mj-group';
import { MjHead } from './mj-head';
import { MjHero } from './mj-hero';
import { MjHtmlAttribute, MjHtmlAttributes, MjSelector } from './mj-html-attributes';
import { MjImage } from './mj-image';
import { MjNavbar } from './mj-navbar';
import { MjNavbarLink } from './mj-navbar-link';
import { MjPreview } from './mj-preview';
import { MjRaw } from './mj-raw';
import { MjSection } from './mj-section';
import { MjSocial } from './mj-social';
import { MjSocialElement } from './mj-social-element';
import { MjSpacer } from './mj-spacer';
import { MjStyle } from './mj-style';
import { MjTable } from './mj-table';
import { MjText } from './mj-text';
import { MjTitle } from './mj-title';
import { MjWrapper } from './mj-wrapper';
import { Mjml } from './mjml';
import { renderEmail, Mount } from '../__testing__/email-render.helper';
import { raw } from '../runtime/server-runtime';

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
        // a negated conditional opens with `<!-->`, which a comment would otherwise run on from
        .replaceAll(/<!--\[if[^\]]*]>(<!-->)?/g, '')
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
     * @param tags - Tags the skeleton holds, so markup inside a conditional comment is compared too.
     */
    async function expectContentParity(ourContent: (mount: Mount) => unknown, mjmlContent: string, tags: string[] = []): Promise<void> {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => ourContent(mount))))));
        const theirs: string = await fromMjml(
            `<mjml><mj-body><mj-section><mj-column>${mjmlContent}</mj-column></mj-section></mj-body></mjml>`
        );

        expect(bodyTagSkeleton(ours)).toEqual(bodyTagSkeleton(theirs));
        expect(bodyTagSkeleton(ours)).toEqual(expect.arrayContaining(tags));
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

    it('puts the css class of a text on the element MJML puts it on', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, { cssClass: 'custom' }, () => 'x'))))));
        const theirs: string = await fromMjml(
            '<mjml><mj-body><mj-section><mj-column><mj-text css-class="custom">x</mj-text></mj-column></mj-section></mj-body></mjml>'
        );
        const classed: (html: string) => string[] = (html: string) => [...html.matchAll(/<([a-z]+)\b[^>]*\bclass="custom"/g)].map(match => match[1]);

        expect(classed(ours)).toEqual(['td']);
        expect(classed(ours)).toEqual(classed(theirs));
    });

    it('matches a table', async () => {
        await expectContentParity(
            (mount: Mount) => mount(MjTable, { cellspacing: 2 }, () => raw('<tr><td>a</td><td>b</td></tr>')),
            '<mj-table cellspacing="2"><tr><td>a</td><td>b</td></tr></mj-table>'
        );
    });

    it('matches a social block, side by side and one below the other', async () => {
        await expectContentParity(
            (mount: Mount) => [
                mount(MjSocial, {}, () => [
                    mount(MjSocialElement, { name: 'facebook', href: 'https://x.com' }, () => 'Share'),
                    mount(MjSocialElement, { name: 'github' })
                ]),
                mount(MjSocial, { mode: 'vertical' }, () => mount(MjSocialElement, { name: 'x', href: 'https://x.com', iconPosition: 'right' }, () => 'Post'))
            ],
            '<mj-social><mj-social-element name="facebook" href="https://x.com">Share</mj-social-element>'
            + '<mj-social-element name="github"></mj-social-element></mj-social>'
            + '<mj-social mode="vertical"><mj-social-element name="x" href="https://x.com" icon-position="right">Post</mj-social-element></mj-social>'
        );
    });

    it('matches a navbar, also with a hamburger', async () => {
        await expectContentParity(
            (mount: Mount) => [
                mount(MjNavbar, { baseUrl: 'https://x.com' }, () => [
                    mount(MjNavbarLink, { href: '/a' }, () => 'A'),
                    mount(MjNavbarLink, { href: '/b', cssClass: 'link' }, () => 'B')
                ]),
                mount(MjNavbar, { hamburger: 'hamburger' }, () => mount(MjNavbarLink, { href: '/c' }, () => 'C'))
            ],
            '<mj-navbar base-url="https://x.com"><mj-navbar-link href="/a">A</mj-navbar-link>'
            + '<mj-navbar-link href="/b" css-class="link">B</mj-navbar-link></mj-navbar>'
            + '<mj-navbar hamburger="hamburger"><mj-navbar-link href="/c">C</mj-navbar-link></mj-navbar>',
            ['input', 'label', 'span']
        );
    });

    it('matches a carousel, with its thumbnails and its Outlook fallback', async () => {
        await expectContentParity(
            (mount: Mount) => mount(MjCarousel, {}, () => [
                mount(MjCarouselImage, { src: 'https://x.com/a.png', href: 'https://x.com' }),
                mount(MjCarouselImage, { src: 'https://x.com/b.png', alt: 'B' })
            ]),
            '<mj-carousel><mj-carousel-image src="https://x.com/a.png" href="https://x.com" />'
            + '<mj-carousel-image src="https://x.com/b.png" alt="B" /></mj-carousel>',
            ['input', 'label', 'img']
        );
    });

    it('matches an accordion, also an element without a title and a text', async () => {
        await expectContentParity(
            (mount: Mount) => mount(MjAccordion, {}, () => [
                mount(MjAccordionElement, {}, () => [
                    mount(MjAccordionTitle, {}, () => 'Title'),
                    mount(MjAccordionText, {}, () => 'Text')
                ]),
                mount(MjAccordionElement, { iconPosition: 'left' })
            ]),
            '<mj-accordion><mj-accordion-element><mj-accordion-title>Title</mj-accordion-title>'
            + '<mj-accordion-text>Text</mj-accordion-text></mj-accordion-element>'
            + '<mj-accordion-element icon-position="left"></mj-accordion-element></mj-accordion>',
            ['input', 'label', 'img']
        );
    });

    it('matches a hero of a fixed height', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(
            MjHero,
            { backgroundUrl: 'https://x.com/bg.png', height: '300px', padding: '20px' },
            () => [mount(MjText, {}, () => 'Hello'), mount(MjButton, { href: 'https://x.com' }, () => 'Go')]
        ))));
        const theirs: string = await fromMjml(
            '<mjml><mj-body><mj-hero background-url="https://x.com/bg.png" height="300px" padding="20px">'
            + '<mj-text>Hello</mj-text><mj-button href="https://x.com">Go</mj-button></mj-hero></mj-body></mjml>'
        );

        expect(bodyTagSkeleton(ours)).toEqual(bodyTagSkeleton(theirs));
    });

    it('matches a hero of a fluid height', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(
            MjHero,
            { mode: 'fluid-height', backgroundUrl: 'https://x.com/bg.png', backgroundWidth: '600px', backgroundHeight: '300px' },
            () => mount(MjText, {}, () => 'Hello')
        ))));
        const theirs: string = await fromMjml(
            '<mjml><mj-body><mj-hero mode="fluid-height" background-url="https://x.com/bg.png" background-width="600px" '
            + 'background-height="300px"><mj-text>Hello</mj-text></mj-hero></mj-body></mjml>'
        );

        expect(bodyTagSkeleton(ours)).toEqual(bodyTagSkeleton(theirs));
    });

    it('places raw markup where MJML does: in the body, a section, a group, the head and before the doctype', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => [
            mount(MjRaw, { position: 'file-start' }, () => '<!-- first -->'),
            mount(MjHead, {}, () => mount(MjRaw, {}, () => '<meta name="x-head" content="1">')),
            mount(MjBody, {}, () => [
                mount(MjRaw, {}, () => '<p>in the body</p>'),
                mount(MjSection, {}, () => [
                    mount(MjRaw, {}, () => '<span>in the section</span>'),
                    mount(MjGroup, {}, () => [mount(MjRaw, {}, () => '<i>in the group</i>'), mount(MjColumn, {}, () => mount(MjText, {}, () => 'x'))])
                ])
            ])
        ]));
        const theirs: string = await fromMjml(
            '<mjml><mj-raw position="file-start"><!-- first --></mj-raw>'
            + '<mj-head><mj-raw><meta name="x-head" content="1"></mj-raw></mj-head>'
            + '<mj-body><mj-raw><p>in the body</p></mj-raw><mj-section><mj-raw><span>in the section</span></mj-raw>'
            + '<mj-group><mj-raw><i>in the group</i></mj-raw><mj-column><mj-text>x</mj-text></mj-column></mj-group>'
            + '</mj-section></mj-body></mjml>'
        );
        const headHas: (html: string) => boolean = (html: string) => html.slice(0, html.indexOf('</head>')).includes('<meta name="x-head" content="1">');

        expect(bodyTagSkeleton(ours)).toEqual(bodyTagSkeleton(theirs));
        expect(headHas(ours)).toBe(true);
        expect(headHas(theirs)).toBe(true);
        expect(ours.startsWith('<!-- first -->\n<!doctype html>')).toBe(true);
        expect(theirs.startsWith('<!-- first -->\n<!doctype html>')).toBe(true);
    });

    it('stacks columns below the width of a breakpoint, like MJML', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => [
            mount(MjHead, {}, () => mount(MjBreakpoint, { width: '320px' })),
            mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'x'))))
        ]));
        const theirs: string = await fromMjml(
            '<mjml><mj-head><mj-breakpoint width="320px" /></mj-head>'
            + '<mj-body><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>'
        );

        expect(ours).toContain('@media only screen and (min-width:320px)');
        expect(theirs).toContain('@media only screen and (min-width:320px)');
    });

    it('imports a declared font once the body uses it, like MJML', async () => {
        const href: string = 'https://fonts.googleapis.com/css?family=Raleway';
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => [
            mount(MjHead, {}, () => [mount(MjFont, { name: 'Raleway', href }), mount(MjFont, { name: 'Unused', href: 'https://x.com/unused.css' })]),
            mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, { fontFamily: 'Raleway, Arial' }, () => 'x'))))
        ]));
        const theirs: string = await fromMjml(
            `<mjml><mj-head><mj-font name="Raleway" href="${href}" /><mj-font name="Unused" href="https://x.com/unused.css" /></mj-head>`
            + '<mj-body><mj-section><mj-column><mj-text font-family="Raleway, Arial">x</mj-text></mj-column></mj-section></mj-body></mjml>'
        );
        const imports: (html: string) => string[] = (html: string) => [...html.matchAll(/<link href="([^"]*)"/g)].map(match => match[1]);

        expect(imports(ours)).toEqual([href]);
        expect(imports(ours)).toEqual(imports(theirs));
    });

    it('sets the attributes of an MjHtmlAttributes on the elements its selector matches, like MJML', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => [
            mount(MjHead, {}, () => mount(MjHtmlAttributes, {}, () => mount(MjSelector, { path: '.mj-column-per-100' }, () => mount(
                MjHtmlAttribute,
                { name: 'data-id' },
                () => '42'
            )))),
            mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'x'))))
        ]));
        const theirs: string = await fromMjml(
            '<mjml><mj-head><mj-html-attributes><mj-selector path=".mj-column-per-100">'
            + '<mj-html-attribute name="data-id">42</mj-html-attribute></mj-selector></mj-html-attributes></mj-head>'
            + '<mj-body><mj-section><mj-column><mj-text>x</mj-text></mj-column></mj-section></mj-body></mjml>'
        );
        const marked: RegExp = /<div class="mj-column-per-100[^>]*data-id="42"/;

        expect(ours).toMatch(marked);
        expect(theirs).toMatch(marked);
    });

    it('carries the head styles of a navbar, an accordion and a carousel, like MJML', async () => {
        const ours: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => [
            mount(MjNavbar, {}, () => mount(MjNavbarLink, { href: '/a' }, () => 'A')),
            mount(MjAccordion, {}, () => mount(MjAccordionElement, {})),
            mount(MjCarousel, {}, () => mount(MjCarouselImage, { src: 'https://x.com/a.png' }))
        ])))));
        const theirs: string = await fromMjml(
            '<mjml><mj-body><mj-section><mj-column><mj-navbar><mj-navbar-link href="/a">A</mj-navbar-link></mj-navbar>'
            + '<mj-accordion><mj-accordion-element></mj-accordion-element></mj-accordion>'
            + '<mj-carousel><mj-carousel-image src="https://x.com/a.png" /></mj-carousel>'
            + '</mj-column></mj-section></mj-body></mjml>'
        );
        const head: (html: string) => string = (html: string) => html.slice(0, html.indexOf('</head>'));

        for (const rule of ['.mj-menu-checkbox[type="checkbox"] ~ .mj-inline-links', 'noinput.mj-accordion-checkbox', '.mj-carousel-radio,']) {
            expect(head(ours)).toContain(rule);
            expect(head(theirs)).toContain(rule);
        }
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