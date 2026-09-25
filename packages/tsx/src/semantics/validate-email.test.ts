import { describe, expect, it } from '@jest/globals';

import { compile } from '../codegen/compile';
import { Diagnostic, offsetToLineColumn } from '../diagnostics/diagnostic.model';

/**
 * The diagnostic codes compiling the given source produces.
 * @param source - The template source.
 * @returns The codes, in order.
 */
function codesOf(source: string): string[] {
    return compile(source).diagnostics.map(diagnostic => diagnostic.code);
}

/**
 * The first diagnostic message compiling the given source produces.
 * @param source - The template source.
 * @returns The message, or an empty string when there were none.
 */
function messageOf(source: string): string {
    return compile(source).diagnostics[0]?.message ?? '';
}

const IMPORT: string = 'import { Mjml, MjHead, MjBody, MjSection, MjColumn, MjGroup, MjWrapper, MjText, MjButton, '
    + 'MjImage, MjDivider, MjSpacer, MjRaw, MjTitle, MjPreview, MjStyle, MjAttributes } from \'zibri-tsx/email\';\n';

/**
 * Prefixes the email import onto a component body.
 * @param body - The `export const ... ` component source.
 * @returns The full template source.
 */
function email(body: string): string {
    return IMPORT + body;
}

describe('email nesting: valid trees', () => {
    it('accepts a complete document', () => {
        expect(codesOf(email(
            'export const E = () => <Mjml><MjHead><MjTitle>Hi</MjTitle></MjHead>'
            + '<MjBody><MjSection><MjColumn><MjText>Hello</MjText></MjColumn></MjSection></MjBody></Mjml>;'
        ))).toEqual([]);
    });

    it('accepts every content type inside a column', () => {
        expect(codesOf(email(
            'export const E = () => <MjColumn><MjText>t</MjText><MjButton>b</MjButton>'
            + '<MjImage/><MjDivider/><MjSpacer/><MjRaw>r</MjRaw></MjColumn>;'
        ))).toEqual([]);
    });

    it('accepts columns grouped in a group', () => {
        expect(codesOf(email(
            'export const E = () => <MjSection><MjGroup><MjColumn></MjColumn></MjGroup></MjSection>;'
        ))).toEqual([]);
    });

    it('accepts a wrapper of sections', () => {
        expect(codesOf(email(
            'export const E = () => <MjBody><MjWrapper><MjSection><MjColumn></MjColumn></MjSection></MjWrapper></MjBody>;'
        ))).toEqual([]);
    });

    it('accepts HTML inside a text block', () => {
        expect(codesOf(email('export const E = () => <MjText>Hello <strong>world</strong></MjText>;'))).toEqual([]);
    });

    it('accepts whitespace between structural children', () => {
        expect(codesOf(email('export const E = () => <MjBody>\n  <MjSection></MjSection>\n</MjBody>;'))).toEqual([]);
    });
});

describe('email nesting: misplaced email components (ZTSX004)', () => {
    it('rejects a column directly in the body', () => {
        expect(codesOf(email('export const E = () => <MjBody><MjColumn></MjColumn></MjBody>;'))).toEqual(['ZTSX004']);
    });

    it('rejects a section in a column', () => {
        expect(codesOf(email('export const E = () => <MjColumn><MjSection></MjSection></MjColumn>;'))).toEqual(['ZTSX004']);
    });

    it('rejects an email component inside a content component', () => {
        expect(codesOf(email('export const E = () => <MjText><MjButton>x</MjButton></MjText>;'))).toEqual(['ZTSX004']);
    });

    it('rejects a section directly in the document', () => {
        expect(codesOf(email('export const E = () => <Mjml><MjSection></MjSection></Mjml>;'))).toEqual(['ZTSX004']);
    });

    it('checks components rendered inside a map', () => {
        expect(codesOf(email(
            'export const E = ({ rows }) => <MjSection>{rows.map(r => <MjText>{r}</MjText>)}</MjSection>;'
        ))).toEqual(['ZTSX004']);
    });

    it('checks components rendered inside a conditional', () => {
        expect(codesOf(email(
            'export const E = ({ show }) => <MjBody>{show ? <MjColumn></MjColumn> : null}</MjBody>;'
        ))).toEqual(['ZTSX004']);
    });

    it('reports every violation in a subtree', () => {
        expect(codesOf(email(
            'export const E = () => <MjBody><MjColumn></MjColumn><MjText>x</MjText></MjBody>;'
        ))).toEqual(['ZTSX004', 'ZTSX004']);
    });
});

describe('email nesting: raw HTML and text (ZTSX004)', () => {
    it('rejects a host element directly in a structural component', () => {
        expect(codesOf(email('export const E = () => <MjColumn><div></div></MjColumn>;'))).toEqual(['ZTSX004']);
    });

    it('rejects a host element in the body', () => {
        expect(codesOf(email('export const E = () => <MjBody><div></div></MjBody>;'))).toEqual(['ZTSX004']);
    });

    it('rejects bare text in a structural component', () => {
        expect(codesOf(email('export const E = () => <MjColumn>loose text</MjColumn>;'))).toEqual(['ZTSX004']);
    });

    it('rejects any element in a text-only component', () => {
        expect(codesOf(email('export const E = () => <MjTitle><span>x</span></MjTitle>;'))).toEqual(['ZTSX004']);
    });

    it('rejects children in an empty component', () => {
        expect(codesOf(email('export const E = () => <MjImage>caption</MjImage>;'))).toEqual(['ZTSX004']);
    });

    it('still catches an email component buried in HTML inside a content block', () => {
        expect(codesOf(email('export const E = () => <MjText><div><MjSection></MjSection></div></MjText>;')))
            .toEqual(['ZTSX004']);
    });
});

describe('email nesting: opaque wrappers', () => {
    it('does not judge a top-level partial with no visible parent', () => {
        expect(codesOf(email('export const Header = () => <MjSection><MjColumn></MjColumn></MjSection>;'))).toEqual([]);
    });

    it('allows a user component where email components go', () => {
        // A user wrapper is opaque here; its own contents are validated in its own file.
        expect(codesOf(email(
            'const Inner = ({ children }) => <MjSection>{children}</MjSection>;\n'
            + 'export const E = () => <MjBody><Inner></Inner></MjBody>;'
        ))).toEqual([]);
    });

    it('does not judge email components passed through a user component', () => {
        expect(codesOf(email(
            'const Slot = ({ children }) => <MjColumn>{children}</MjColumn>;\n'
            + 'export const E = () => <MjBody><Slot><MjColumn></MjColumn></Slot></MjBody>;'
        ))).toEqual([]);
    });
});

describe('email nesting: import resolution', () => {
    it('treats a same-named local component as opaque', () => {
        expect(codesOf(
            'const MjColumn = ({ children }) => <div>{children}</div>;\n'
            + 'export const X = () => <MjColumn><MjColumn></MjColumn></MjColumn>;'
        )).toEqual([]);
    });

    it('resolves a renamed import to its canonical component', () => {
        expect(codesOf(
            'import { MjBody as Body, MjColumn as Col } from \'zibri-tsx/email\';\n'
            + 'export const E = () => <Body><Col></Col></Body>;'
        )).toEqual(['ZTSX004']);
    });

    it('does nothing for a file that imports no email components', () => {
        expect(codesOf('export const P = () => <div><span>x</span></div>;')).toEqual([]);
    });

    it('recognizes email components re-exported from the main package', () => {
        // Templates may import everything from 'zibri'; a known email name from there is still checked.
        expect(codesOf(
            'import { MjBody, MjColumn } from \'zibri\';\n'
            + 'export const E = () => <MjBody><MjColumn></MjColumn></MjBody>;'
        )).toEqual(['ZTSX004']);
    });

    it('ignores a non-email import from the main package', () => {
        // A page importing hooks from 'zibri' is not an email template and is not nesting-checked.
        expect(codesOf(
            'import { $ts } from \'zibri\';\n'
            + 'export const P = () => <div>{$ts`hi`}</div>;'
        )).toEqual([]);
    });
});

describe('email nesting: diagnostic', () => {
    it('names the offender, the parent and the valid children', () => {
        const message: string = messageOf(email('export const E = () => <MjBody><MjColumn></MjColumn></MjBody>;'));
        expect(message).toBe(
            '\'MjColumn\' is not a valid child of \'MjBody\'. Valid children of \'MjBody\' are: MjSection, MjWrapper.'
        );
    });

    it('names a host element with angle brackets', () => {
        const message: string = messageOf(email('export const E = () => <MjColumn><div></div></MjColumn>;'));
        expect(message).toContain('\'<div>\' is not a valid child of \'MjColumn\'');
        expect(message).toContain('Valid children of \'MjColumn\' are: MjText, MjButton, MjImage');
    });

    it('explains a content component holds text and HTML', () => {
        const message: string = messageOf(email('export const E = () => <MjText><MjButton>x</MjButton></MjText>;'));
        expect(message).toBe(
            '\'MjButton\' is not a valid child of \'MjText\'. \'MjText\' accepts text and HTML, not email components.'
        );
    });

    it('points at the exact line and column of the offending element', () => {
        const source: string = email('export const E = () => (\n    <MjBody>\n        <MjColumn></MjColumn>\n    </MjBody>\n);');
        const diagnostic: Diagnostic = compile(source).diagnostics[0];
        const { line, column }: { line: number, column: number } = offsetToLineColumn(source, diagnostic.span.start);
        // The <MjColumn> sits on the third line of the body, indented eight spaces.
        expect(line).toBe(4);
        expect(column).toBe(9);
    });
});

describe('client code in an email (ZTSX005)', () => {
    it('rejects an onClient block', () => {
        expect(codesOf(email('export const E = () => { onClient(() => { console.log(); }); return <MjBody></MjBody>; };')))
            .toContain('ZTSX005');
    });

    it('rejects an event handler', () => {
        expect(codesOf(email('export const E = () => <MjBody><MjSection></MjSection></MjBody>;'
            .replace('<MjSection></MjSection>', '<MjSection onClick={() => console.log()}></MjSection>'))))
            .toContain('ZTSX005');
    });

    it('rejects a ?client import', () => {
        expect(codesOf(
            'import { Chart } from \'chart.js?client\';\n'
            + email('export const E = () => { onClient(() => { new Chart(); }); return <MjBody></MjBody>; };')
        )).toContain('ZTSX005');
    });

    it('leaves a page template with client code alone', () => {
        expect(codesOf('export const P = () => { onClient(() => { console.log(); }); return <div></div>; };')).toEqual([]);
    });
});