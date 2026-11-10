import { describe, expect, it } from '@jest/globals';
import { Diagnostic, DiagnosticSeverity } from 'zibri-tsx';
import { offsetToLineColumn } from 'zibri-tsx/internal';

import { compile, CompileResult } from '../codegen/compile';

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
    + 'MjImage, MjDivider, MjSpacer, MjRaw, MjTitle, MjPreview, MjStyle, MjAttributes, MjHero, MjTable, MjSocial, MjSocialElement, '
    + 'MjNavbar, MjNavbarLink, MjCarousel, MjCarouselImage, MjAccordion, MjAccordionElement, MjAccordionTitle, MjAccordionText, '
    + 'MjBreakpoint, MjFont, MjHtmlAttributes, MjSelector, MjHtmlAttribute } from \'zibri-tsx/email\';\n';

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

describe('email nesting: user components of the same file', () => {
    it('does not judge a top-level partial with no visible parent', () => {
        expect(codesOf(email('export const Header = () => <MjSection><MjColumn></MjColumn></MjSection>;'))).toEqual([]);
    });

    it('accepts a user component that renders what its parent takes', () => {
        expect(codesOf(email(
            'const Inner = ({ children }) => <MjSection>{children}</MjSection>;\n'
            + 'export const E = () => <MjBody><Inner><MjColumn></MjColumn></Inner></MjBody>;'
        ))).toEqual([]);
    });

    it('rejects a user component that renders what its parent does not take, at its use', () => {
        const source: string = email(
            'const Row = () => <MjColumn><MjText>x</MjText></MjColumn>;\n'
            + 'export const E = () => <MjBody><Row/></MjBody>;'
        );
        const diagnostics: Diagnostic[] = compile(source).diagnostics;

        expect(diagnostics.map(diagnostic => diagnostic.code)).toEqual(['ZTSX004']);
        expect(diagnostics[0].message).toBe(
            '\'Row\' renders \'MjColumn\', which is not a valid child of \'MjBody\'. Valid children of \'MjBody\' are: MjHero, MjRaw, MjSection, MjWrapper. '
            + 'This fails the build from 4.0.'
        );
        expect(source.slice(diagnostics[0].span.start, diagnostics[0].span.end)).toBe('<Row/>');
    });

    it('compiles a template with a mistake reached through a user component, with a warning', () => {
        const result: CompileResult = compile(email(
            'const Row = () => <MjColumn></MjColumn>;\n'
            + 'export const E = () => <MjBody><Row/></MjBody>;'
        ));

        expect(result.diagnostics.map(diagnostic => diagnostic.severity)).toEqual([DiagnosticSeverity.WARNING]);
        expect(result.code).toBeDefined();
    });

    it('fails a template with a mistake written out, beside one reached through a user component', () => {
        const result: CompileResult = compile(email(
            'const Row = () => <MjColumn></MjColumn>;\n'
            + 'export const E = () => <MjBody><Row/><MjColumn></MjColumn></MjBody>;'
        ));

        expect(result.diagnostics.map(diagnostic => diagnostic.severity)).toEqual([DiagnosticSeverity.WARNING, DiagnosticSeverity.ERROR]);
        expect(result.code).toBeUndefined();
    });

    it('rejects children a user component places where they do not belong, at the child', () => {
        const source: string = email(
            'const Slot = ({ children }) => <MjColumn>{children}</MjColumn>;\n'
            + 'export const E = () => <MjBody><MjSection><Slot><MjColumn></MjColumn></Slot></MjSection></MjBody>;'
        );
        const diagnostics: Diagnostic[] = compile(source).diagnostics;

        expect(diagnostics.map(diagnostic => diagnostic.message)).toEqual([
            '\'MjColumn\' is not a valid child of \'MjColumn\', where \'Slot\' places it. Valid children of \'MjColumn\' are: '
            + 'MjAccordion, MjButton, MjCarousel, MjDivider, MjImage, MjNavbar, MjRaw, MjSocial, MjSpacer, MjTable, MjText. '
            + 'This fails the build from 4.0.'
        ]);
        expect(source.slice(diagnostics[0].span.start, diagnostics[0].span.end)).toBe('<MjColumn></MjColumn>');
    });

    it('rejects text a user component places where only email components go', () => {
        expect(codesOf(email(
            'const Slot = ({ children }) => <MjSection>{children}</MjSection>;\n'
            + 'export const E = () => <Slot>loose text</Slot>;'
        ))).toEqual(['ZTSX004']);
    });

    it('follows a prop other than children, read from the props object', () => {
        expect(codesOf(email(
            'const Card = (props) => <MjSection>{props.header}</MjSection>;\n'
            + 'export const E = () => <Card header={<MjText>x</MjText>}/>;'
        ))).toEqual(['ZTSX004']);
    });

    it('follows children through a conditional and a fragment', () => {
        expect(codesOf(email(
            'const Maybe = ({ show, children }) => <>{show && <MjSection>{show ? children : null}</MjSection>}</>;\n'
            + 'export const E = () => <Maybe show><MjText>x</MjText></Maybe>;'
        ))).toEqual(['ZTSX004']);
    });

    it('follows children a user component hands on to another', () => {
        expect(codesOf(email(
            'const Column = ({ children }) => <MjColumn>{children}</MjColumn>;\n'
            + 'const Padded = ({ children }) => <Column>{children}</Column>;\n'
            + 'export const E = () => <MjSection><Padded><MjSection></MjSection></Padded></MjSection>;'
        ))).toEqual(['ZTSX004']);
    });

    it('follows what a user component returns through a block body and a local', () => {
        expect(codesOf(email(
            'const Row = ({ wide }) => {\n'
            + '    const column = <MjColumn width={wide ? \'100%\' : \'50%\'}></MjColumn>;\n'
            + '    if (wide) {\n        return column;\n    }\n'
            + '    return <MjText>x</MjText>;\n'
            + '};\n'
            + 'export const E = () => <MjSection><Row/></MjSection>;'
        ))).toEqual(['ZTSX004']);
    });

    it('reports a mistake inside a user component once, in the component', () => {
        expect(codesOf(email(
            'const Broken = () => <MjSection><MjSection></MjSection></MjSection>;\n'
            + 'export const E = () => <MjBody><Broken/><Broken/></MjBody>;'
        ))).toEqual(['ZTSX004']);
    });

    it('follows a component that renders itself only as far as one use', () => {
        expect(codesOf(email(
            'const Tree = ({ depth }) => <MjSection>{depth > 0 ? <Tree depth={depth - 1}/> : <MjColumn></MjColumn>}</MjSection>;\n'
            + 'export const E = () => <MjBody><Tree depth={2}/></MjBody>;'
        ))).toEqual(['ZTSX004']);
    });
});

describe('email nesting: MJML\'s rules for raw markup and the other components', () => {
    it('accepts raw markup everywhere MJML does', () => {
        expect(codesOf(email(
            'export const E = () => <Mjml><MjRaw position="file-start">r</MjRaw><MjHead><MjRaw>r</MjRaw></MjHead><MjBody><MjRaw>r</MjRaw>'
            + '<MjWrapper><MjRaw>r</MjRaw><MjSection><MjRaw>r</MjRaw><MjGroup><MjRaw>r</MjRaw><MjColumn><MjRaw>r</MjRaw></MjColumn></MjGroup>'
            + '</MjSection></MjWrapper></MjBody></Mjml>;'
        ))).toEqual([]);
    });

    it('accepts every component where MJML places it', () => {
        expect(codesOf(email(
            'export const E = () => <Mjml><MjHead><MjBreakpoint width="320px"/><MjFont name="A" href="a"/>'
            + '<MjHtmlAttributes><MjSelector path=".a"><MjHtmlAttribute name="data-a">1</MjHtmlAttribute></MjSelector></MjHtmlAttributes></MjHead>'
            + '<MjBody><MjHero><MjText>t</MjText><MjNavbar><MjNavbarLink href="/">l</MjNavbarLink></MjNavbar></MjHero>'
            + '<MjSection><MjColumn><MjTable><tr><td>c</td></tr></MjTable><MjSocial><MjSocialElement name="x">s</MjSocialElement></MjSocial>'
            + '<MjCarousel><MjCarouselImage src="a.png"/></MjCarousel>'
            + '<MjAccordion><MjAccordionElement><MjAccordionTitle>t</MjAccordionTitle><MjAccordionText>t</MjAccordionText></MjAccordionElement></MjAccordion>'
            + '</MjColumn></MjSection></MjBody></Mjml>;'
        ))).toEqual([]);
    });

    it('rejects a part of a component outside it', () => {
        expect(codesOf(email(
            'export const E = () => <MjColumn><MjSocialElement name="x"/><MjNavbarLink href="/">l</MjNavbarLink>'
            + '<MjCarouselImage src="a.png"/><MjAccordionElement></MjAccordionElement></MjColumn>;'
        ))).toEqual(['ZTSX004', 'ZTSX004', 'ZTSX004', 'ZTSX004']);
    });

    it('rejects raw markup in a carousel and an html attribute outside a selector', () => {
        expect(codesOf(email(
            'export const E = () => <Mjml><MjHead><MjHtmlAttributes><MjHtmlAttribute name="a">1</MjHtmlAttribute></MjHtmlAttributes></MjHead>'
            + '<MjBody><MjSection><MjColumn><MjCarousel><MjRaw>r</MjRaw></MjCarousel></MjColumn></MjSection></MjBody></Mjml>;'
        ))).toEqual(['ZTSX004', 'ZTSX004']);
    });

    it('rejects a hero in a section and a column in a hero', () => {
        expect(codesOf(email(
            'export const E = () => <MjSection><MjHero><MjColumn></MjColumn></MjHero></MjSection>;'
        ))).toEqual(['ZTSX004', 'ZTSX004']);
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
            '\'MjColumn\' is not a valid child of \'MjBody\'. Valid children of \'MjBody\' are: MjHero, MjRaw, MjSection, MjWrapper.'
        );
    });

    it('names a host element with angle brackets', () => {
        const message: string = messageOf(email('export const E = () => <MjColumn><div></div></MjColumn>;'));
        expect(message).toContain('\'<div>\' is not a valid child of \'MjColumn\'');
        expect(message).toContain('Valid children of \'MjColumn\' are: MjAccordion, MjButton, MjCarousel');
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

    it('rejects a ref, which no client code of an email could read', () => {
        expect(codesOf(email('export const E = () => { const section = useRef(); return <MjBody><MjSection ref={section}></MjSection></MjBody>; };')))
            .toContain('ZTSX005');
    });

    it('rejects a state, which no client code of an email could change', () => {
        expect(codesOf(email('export const E = () => { const title = useState(\'Hi\'); return <MjBody><MjSection></MjSection></MjBody>; };')))
            .toContain('ZTSX005');
    });

    it('rejects an input, which no client code of an email could follow', () => {
        expect(codesOf(email('export const E = ({ title }) => { const shown = useInput(title); return <MjBody><MjSection></MjSection></MjBody>; };')))
            .toContain('ZTSX005');
    });

    it('rejects an effect, which an email never runs', () => {
        expect(codesOf(email('export const E = ({ s }) => { useEffect(() => console.log(s.value), [s]); return <MjBody></MjBody>; };')))
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