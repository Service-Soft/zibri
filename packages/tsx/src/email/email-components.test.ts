import { describe, expect, it } from '@jest/globals';

import { MjAttributes, MjAttributesProps } from './mj-attributes';
import { MjBody } from './mj-body';
import { MjButton } from './mj-button';
import { MjColumn } from './mj-column';
import { MjDivider } from './mj-divider';
import { MjGroup } from './mj-group';
import { MjHead } from './mj-head';
import { MjImage } from './mj-image';
import { MjRaw } from './mj-raw';
import { MjSection } from './mj-section';
import { MjSpacer } from './mj-spacer';
import { MjText } from './mj-text';
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