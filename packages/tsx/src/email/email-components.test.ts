import { describe, expect, it } from '@jest/globals';

import { MjAccordion } from './mj-accordion';
import { MjAccordionElement } from './mj-accordion-element';
import { MjAccordionTitle } from './mj-accordion-title';
import { MjAttributes, MjAttributesProps } from './mj-attributes';
import { MjBody } from './mj-body';
import { MjBreakpoint } from './mj-breakpoint';
import { MjButton } from './mj-button';
import { MjCarousel } from './mj-carousel';
import { MjCarouselImage } from './mj-carousel-image';
import { MjColumn } from './mj-column';
import { MjDivider } from './mj-divider';
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

/**
 * Renders content inside a body/section/column so components that read the layout resolve normally.
 * @param content - Builds the content inside the column.
 * @returns The rendered HTML.
 */
function inColumn(content: (mount: Mount) => unknown): string {
    return renderEmail((mount: Mount) => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => content(mount)))));
}

/**
 * Renders the canonical minimal email: one section, one full-width column, one line of text.
 * @returns The rendered HTML.
 */
function minimalEmail(): string {
    return renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'Hello'))))));
}

describe('email components', () => {
    it('wraps the document with doctype, html and the article body', () => {
        const html: string = minimalEmail();
        expect(html.startsWith('<!doctype html><html')).toBe(true);
        expect(html).toContain('<body style="word-spacing:normal;">');
        expect(html).toContain('<div aria-roledescription="email" role="article" lang="und" dir="auto"');
    });

    it('sizes the section ghost table to the body width', () => {
        expect(minimalEmail()).toContain('style="width:600px;" width="600"');
    });

    it('gives the section its default padding', () => {
        expect(minimalEmail()).toContain('padding:20px 0;');
    });

    it('resolves a full-width column to the body width in the outlook cell', () => {
        const html: string = minimalEmail();
        expect(html).toContain('class="mj-column-per-100 mj-outlook-group-fix"');
        expect(html).toContain('width:600px;'); // the Outlook ghost td
        expect(html).toContain('width:100%;'); // the responsive div
    });

    it('carries inherited typography onto the text', () => {
        expect(minimalEmail()).toContain(
            '<div style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:13px;line-height:1;'
            + 'text-align:left;color:#000000;">Hello</div>'
        );
    });

    it('resolves a half-width column against the section width', () => {
        const html: string = renderEmail((mount: Mount) => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, { width: '50%' }, () => mount(MjText, {}, () => 'x')))));
        // 50% of the 600px body is a 300px Outlook cell, and the per-50 responsive class.
        expect(html).toContain('class="mj-column-per-50 mj-outlook-group-fix"');
        expect(html).toContain('width:300px;');
    });

    it('lets a section override the width the columns resolve against', () => {
        const html: string = renderEmail((mount: Mount) => mount(MjBody, { width: '480px' }, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'x')))));
        expect(html).toContain('style="width:480px;" width="480"');
        expect(html).toContain('max-width:480px;');
    });
});

describe('email content components', () => {
    it('renders a button with its default styling and link', () => {
        const html: string = inColumn((mount: Mount) => mount(MjButton, { href: 'https://x.com' }, () => 'Go'));
        expect(html).toContain('bgcolor="#414141"');
        expect(html).toContain('<a href="https://x.com"');
        expect(html).toContain('color:#ffffff;');
        expect(html).toContain('target="_blank">Go</a>');
    });

    it('adds a css class to the button cell', () => {
        const html: string = inColumn((mount: Mount) => mount(MjButton, { href: '#', cssClass: 'btn-primary' }, () => 'Go'));
        expect(html).toContain('<td align="center" class="btn-primary"');
    });

    it('applies font weight and per-side padding to text', () => {
        const html: string = inColumn((mount: Mount) => mount(MjText, { fontWeight: 'bold', paddingBottom: '10px' }, () => 'x'));
        expect(html).toContain('padding:10px 25px 10px 25px;');
        expect(html).toContain('font-weight:bold;');
    });

    it('keeps default text output unchanged when no new props are set', () => {
        const html: string = inColumn((mount: Mount) => mount(MjText, {}, () => 'x'));
        expect(html).toContain('style="font-size:0px;padding:10px 25px;word-break:break-word;"');
        expect(html).toContain('<div style="font-family:Ubuntu, Helvetica, Arial, sans-serif;font-size:13px;line-height:1;text-align:left;color:#000000;">x</div>');
    });

    it('sizes an image to the column width minus its padding', () => {
        // Full column is 600px; the default 10px 25px padding leaves 550px.
        const html: string = inColumn((mount: Mount) => mount(MjImage, { src: 'a.png', alt: 'A' }));
        expect(html).toContain('<td style="width:550px;">');
        expect(html).toContain('width="550" height="auto"');
        expect(html).toContain('alt="A" src="a.png"');
    });

    it('sizes an image against a narrower column', () => {
        const html: string = renderEmail((mount: Mount) => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, { width: '50%' }, () => mount(MjImage, { src: 'a.png' })))));
        // Half of 600 is a 300px column, less 50px padding leaves 250px.
        expect(html).toContain('<td style="width:250px;">');
    });

    it('renders a divider with its default border and Outlook ghost width', () => {
        const html: string = inColumn((mount: Mount) => mount(MjDivider, {}));
        expect(html).toContain('border-top:solid 4px #000000;font-size:1px;margin:0px auto;width:100%;');
        expect(html).toContain('width:550px;" role="presentation" width="550px"');
    });

    it('renders a spacer with its default height', () => {
        expect(inColumn((mount: Mount) => mount(MjSpacer, {})))
            .toContain('<div style="height:20px;line-height:20px;">&#8202;</div>');
    });

    it('emits raw content verbatim, without escaping', () => {
        const html: string = inColumn((mount: Mount) => mount(MjRaw, {}, () => '<custom>&</custom>'));
        expect(html).toContain('<custom>&</custom>');
    });
});

describe('values written into attributes', () => {
    it('escapes the props of an image', () => {
        const html: string = inColumn((mount: Mount) => mount(MjImage, { src: 'a.png?x="1"', alt: 'Bob" onerror="alert(1)' }));
        expect(html).toContain('alt="Bob&quot; onerror=&quot;alert(1)" src="a.png?x=&quot;1&quot;"');
    });

    it('escapes the class of a button and of text', () => {
        const html: string = inColumn((mount: Mount) => [
            mount(MjButton, { href: '#', cssClass: 'a" onclick="x' }, () => 'Go'),
            mount(MjText, { cssClass: 'b"><script>' }, () => 'x')
        ]);
        expect(html).toContain('class="a&quot; onclick=&quot;x"');
        expect(html).toContain('class="b&quot;&gt;&lt;script&gt;"');
    });

    it('escapes a style value', () => {
        const html: string = inColumn((mount: Mount) => mount(MjText, { color: 'red;" onmouseover="x' }, () => 'x'));
        expect(html).toContain('color:red;&quot; onmouseover=&quot;x;');
    });

    it('escapes a declared default and the typography of the body', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => [
            mount(MjHead, {}, () => mount(MjAttributes, { all: { fontFamily: 'A"><b>' }, defaults: { MjText: { color: 'x"y' } } })),
            mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'x'))))
        ]));
        expect(html).toContain('font-family:A&quot;&gt;&lt;b&gt;;');
        expect(html).toContain('color:x&quot;y;');
    });

    it('escapes the language and direction of the document', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, { lang: 'en" x="y' }, () => ''));
        expect(html).toContain('<html lang="en&quot; x=&quot;y"');
    });

    it('leaves out a link that runs script', () => {
        const button: string = inColumn((mount: Mount) => mount(MjButton, { href: ' JavaScript:alert(1)' }, () => 'Go'));
        const image: string = inColumn((mount: Mount) => mount(MjImage, { src: 'javascript:alert(1)' }));
        expect(button).not.toContain('alert(1)');
        expect(image).not.toContain('alert(1)');
    });
});

describe('email container components', () => {
    it('lays a group out as a non-stacking inline block', () => {
        const html: string = renderEmail((mount: Mount) => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjGroup, {}, () => mount(MjColumn, { width: '50%' }, () => mount(MjText, {}, () => 'a'))))));
        expect(html).toContain(
            'class="mj-column-per-100 mj-outlook-group-fix" style="font-size:0;line-height:0;'
            + 'text-align:left;display:inline-block;width:100%;direction:ltr;"'
        );
    });

    it('resolves a group column against the group width', () => {
        const html: string = renderEmail((mount: Mount) => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjGroup, { width: '100%' }, () => mount(MjColumn, { width: '50%' }, () => mount(MjText, {}, () => 'a'))))));
        // A 100% group of the 600px section, then a 50% column, is a 300px Outlook cell.
        expect(html).toContain('class="mj-column-per-50 mj-outlook-group-fix"');
        expect(html).toContain('width:300px;');
    });

    it('overrides section padding on one side and adds a border radius', () => {
        const html: string = renderEmail((mount: Mount) => mount(MjBody, {}, () => mount(MjSection, { paddingBottom: '0px', borderRadius: '5px', backgroundColor: '#111' }, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'x')))));
        expect(html).toContain('padding:20px 0 0px 0;');
        expect(html).toContain('background:#111;border-radius:5px;margin:0px auto;');
    });

    it('wraps sections in a full-width band with an extra outlook ghost table', () => {
        const html: string = renderEmail((mount: Mount) => mount(MjBody, {}, () => mount(MjWrapper, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'x'))))));
        expect(html).toContain('margin:0px auto;max-width:600px;');
        // The wrapper's own ghost td around its child sections.
        expect(html).toContain('style="width:600px;" width="600" ><tr><td style="" >');
    });
});

describe('email head two-pass', () => {
    it('builds the head from column widths used deep in the body', () => {
        // The head comes first in the output, but its media rule reflects a column several levels
        // down - proving the body is rendered before the head is assembled.
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, { width: '50%' }, () => mount(MjText, {}, () => 'x'))))));
        const head: string = html.slice(0, html.indexOf('</head>'));
        expect(head).toContain('.mj-column-per-50 { width:50% !important; max-width: 50%; }');
    });

    it('emits no responsive rules for an email with no columns', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => 'hi')));
        expect(html).not.toContain('mj-column-per');
    });

    it('escapes the document title', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, { title: 'A & B' }, () => ''));
        expect(html).toContain('<title>A &amp; B</title>');
    });

    it('escapes a title of text and values once', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjHead, {}, () => [
            mount(MjTitle, {}, () => ['Order for ', 'Smith & Sons']),
            mount(MjPreview, {}, () => ['Hi ', 'A & B'])
        ])));
        expect(html).toContain('<title>Order for Smith &amp; Sons</title>');
        expect(html).toContain('>Hi A &amp; B</div>');
    });

    it('keeps the css of a style made of several parts', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjHead, {}, () => mount(MjStyle, {}, () => ['.a > b{}', '.c{}']))));
        expect(html).toContain('.a > b{}.c{}');
    });
});

describe('email components passing attributes to their parts', () => {
    it('gives a social element the attributes of its social, unless it sets its own', () => {
        const html: string = inColumn((mount: Mount) => mount(MjSocial, { color: '#123456', iconSize: '30px' }, () => [
            mount(MjSocialElement, { name: 'github', href: 'https://x.com' }, () => 'Inherited'),
            mount(MjSocialElement, { name: 'github', href: 'https://x.com', color: '#654321' }, () => 'Own')
        ]));
        expect(html).toMatch(/color:#123456;[^"]*">Inherited<\/a>/);
        expect(html).toMatch(/color:#654321;[^"]*">Own<\/a>/);
        expect(html).toContain('width="30"');
    });

    it('lets a declared default of a social element beat what its social passes, like MJML', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => [
            mount(MjHead, {}, () => mount(MjAttributes, { defaults: { MjSocialElement: { color: '#abcdef' } } })),
            mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(
                MjSocial,
                { color: '#123456' },
                () => mount(MjSocialElement, { name: 'web' }, () => 'Site')
            ))))
        ]));
        expect(html).toMatch(/color:#abcdef;[^"]*">Site<\/span>/);
    });

    it('shares a url on the network an element names, and links to it directly with -noshare', () => {
        const html: string = inColumn((mount: Mount) => mount(MjSocial, {}, () => [
            mount(MjSocialElement, { name: 'facebook', href: 'https://x.com/a' }),
            mount(MjSocialElement, { name: 'facebook-noshare', href: 'https://x.com/b' })
        ]));
        expect(html).toContain('href="https://www.facebook.com/sharer/sharer.php?u=https://x.com/a"');
        expect(html).toContain('href="https://x.com/b"');
        expect(html).toContain('background:#3b5998;');
    });

    it('puts the base url of a navbar before the href of its links', () => {
        const html: string = inColumn((mount: Mount) => mount(MjNavbar, { baseUrl: 'https://x.com' }, () => mount(MjNavbarLink, { href: '/docs' }, () => 'Docs')));
        expect(html).toContain('href="https://x.com/docs"');
    });

    it('gives an accordion element the attributes of its accordion, unless it sets its own, and empty missing parts', () => {
        const html: string = inColumn((mount: Mount) => mount(MjAccordion, { border: '1px solid red' }, () => [
            mount(MjAccordionElement, {}, () => mount(MjAccordionTitle, {}, () => 'First')),
            mount(MjAccordionElement, { border: '3px dotted blue' })
        ]));
        expect(html).toContain('border-bottom:1px solid red;');
        expect(html).toContain('border-bottom:3px dotted blue;');
        // the first element has no text, the second neither title nor text: three empty parts
        expect(html.match(/class="mj-accordion-content"/g)).toHaveLength(2);
        expect(html.match(/class="mj-accordion-title"/g)).toHaveLength(2);
        expect(html).toContain('>First</td>');
    });

    it('writes a radio for each image of a carousel, the first checked, and no thumbnails when they are hidden', () => {
        const html: string = inColumn((mount: Mount) => mount(MjCarousel, { thumbnails: 'hidden' }, () => [
            mount(MjCarouselImage, { src: 'https://x.com/a.png' }),
            mount(MjCarouselImage, { src: 'https://x.com/b.png' })
        ]));
        expect(html.match(/type="radio"/g)).toHaveLength(2);
        expect(html.match(/checked="checked"/g)).toHaveLength(1);
        expect(html).not.toContain('mj-carousel-thumbnail');
    });

    it('lays the content of a hero out within the body width less its padding', () => {
        const html: string = renderEmail((mount: Mount) => mount(MjBody, {}, () => mount(MjHero, { padding: '0 50px' }, () => mount(MjImage, { src: 'a.png' }))));
        // 600px less 100px of padding, less the 50px of the image's own padding
        expect(html).toContain('<td style="width:450px;">');
    });
});

describe('values the new components write into attributes', () => {
    it('leaves out a link that runs script', () => {
        const html: string = inColumn((mount: Mount) => [
            mount(MjSocial, {}, () => mount(MjSocialElement, { href: 'javascript:alert(1)', src: 'javascript:alert(2)' }, () => 'x')),
            mount(MjNavbar, {}, () => mount(MjNavbarLink, { href: 'javascript:alert(3)' }, () => 'x')),
            mount(MjCarousel, {}, () => mount(MjCarouselImage, { src: 'javascript:alert(4)', href: 'javascript:alert(5)' }))
        ]);
        expect(html).not.toContain('alert(');
    });

    it('escapes the props of the components', () => {
        const html: string = inColumn((mount: Mount) => mount(MjTable, { color: 'red;" onclick="x' }, () => ''));
        expect(html).toContain('color:red;&quot; onclick=&quot;x;');
    });

    it('escapes the value of an html attribute, and leaves out a name an attribute cannot have', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => [
            mount(MjHead, {}, () => mount(MjHtmlAttributes, {}, () => mount(MjSelector, { path: '.mj-column-per-100' }, () => [
                mount(MjHtmlAttribute, { name: 'data-a' }, () => 'say "hi"'),
                mount(MjHtmlAttribute, { name: 'x onload="y"' }, () => 'z')
            ]))),
            mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'x'))))
        ]));
        expect(html).toContain('data-a="say &quot;hi&quot;"');
        expect(html).not.toContain('onload');
    });
});

describe('email head and document', () => {
    it('builds the shared styles of a navbar for the breakpoint of the email', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => [
            mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjNavbar, {}, () => mount(MjNavbarLink, {}, () => 'x'))))),
            // after the body, which the styles of the head still follow
            mount(MjHead, {}, () => mount(MjBreakpoint, { width: '320px' }))
        ]));
        expect(html).toContain('@media only screen and (max-width:319px)');
        expect(html.match(/noinput\.mj-menu-checkbox/g)).toHaveLength(1);
    });

    it('leaves out raw markup directly in the document unless it goes before the doctype', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjRaw, {}, () => '<b>nowhere</b>')));
        expect(html).not.toContain('nowhere');
    });

    it('imports a font MJML knows only once the body uses it', () => {
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(
            MjColumn,
            {},
            () => mount(MjText, { fontFamily: 'Georgia, serif' }, () => 'x')
        )))));
        expect(html).not.toContain('fonts.googleapis.com');
    });
});

describe('email attribute defaults', () => {
    /**
     * Renders a text email whose head declares the given attribute defaults.
     * @param attributes - The MjAttributes props.
     * @param text - Props for the single MjText.
     * @returns The rendered HTML.
     */
    function withAttributes(attributes: MjAttributesProps, text: Record<string, unknown> = {}): string {
        return renderEmail((mount: Mount) => mount(Mjml, {}, () => [
            mount(MjHead, {}, () => mount(MjAttributes, attributes)),
            mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, text, () => 'x'))))
        ]));
    }

    it('applies a per-component default', () => {
        expect(withAttributes({ defaults: { MjText: { color: '#333333' } } })).toContain('color:#333333;');
    });

    it('lets a per-component default beat a global one', () => {
        const html: string = withAttributes({ all: { color: '#111111' }, defaults: { MjText: { color: '#222222' } } });
        expect(html).toContain('color:#222222;');
    });

    it('lets an explicit prop beat every declared default', () => {
        const html: string = withAttributes({ defaults: { MjText: { color: '#333333' } } }, { color: '#ff0000' });
        expect(html).toContain('color:#ff0000;');
    });

    it('flows global typography through the layout to components that inherit it', () => {
        // MjButton takes its font family from the inherited layout, not a prop, so a global default
        // has to reach it via MjBody merging it into the context.
        const html: string = renderEmail((mount: Mount) => mount(Mjml, {}, () => [
            mount(MjHead, {}, () => mount(MjAttributes, { all: { fontFamily: 'Georgia, serif' } })),
            mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjButton, { href: '#' }, () => 'Go'))))
        ]));
        expect(html).toContain('font-family:Georgia, serif;');
    });

    it('changes nothing when no defaults are declared', () => {
        const plain: string = renderEmail((mount: Mount) => mount(MjBody, {}, () => mount(MjSection, {}, () => mount(MjColumn, {}, () => mount(MjText, {}, () => 'x')))));
        expect(plain).toContain('color:#000000;');
    });
});