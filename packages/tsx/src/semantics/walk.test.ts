import { describe, expect, it } from '@jest/globals';
import * as ts from 'typescript';

import { parseTemplate } from './symbols';
import { UnhandledSyntaxError, walk } from './walk';

/**
 * Walks every statement of a source, recording the kind of every visited node.
 * @param source - The source.
 * @returns The visited kinds.
 */
function visitedKinds(source: string): ts.SyntaxKind[] {
    const kinds: ts.SyntaxKind[] = [];
    for (const statement of parseTemplate(source).statements) {
        walk(statement, node => {
            kinds.push(node.kind);
        });
    }
    return kinds;
}

describe('walk', () => {
    it('refuses syntax it has no case for instead of skipping it', () => {
        // a statement holding a read the analysis would otherwise never see
        const source: string = 'label: with (object) { track(SECRET); }';

        expect(() => visitedKinds(source)).toThrow(UnhandledSyntaxError);
        expect(() => visitedKinds(source)).toThrow('WithStatement');
    });

    it('names the unhandled syntax and where it is', () => {
        const source: string = 'const run = () => { with (settings) { step(); } };';
        let error: unknown;
        try {
            visitedKinds(source);
        }
        catch (error_) {
            error = error_;
        }

        expect(error).toBeInstanceOf(UnhandledSyntaxError);
        expect(error).toHaveProperty('kind', 'WithStatement');
        expect(error).toHaveProperty('span.start', source.indexOf('with ('));
    });

    it('visits leaves without refusing them', () => {
        const kinds: ts.SyntaxKind[] = visitedKinds(
            'const values = [1, 2n, \'s\', `t`, /r/, true, false, null, this, , x]; debugger; ;'
        );

        expect(kinds).toContain(ts.SyntaxKind.RegularExpressionLiteral);
        expect(kinds).toContain(ts.SyntaxKind.DebuggerStatement);
        expect(kinds).toContain(ts.SyntaxKind.EmptyStatement);
    });
});