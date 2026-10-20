import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { validate, ValidationCode } from './validate.ts';
import { parseTemplateOk } from '../__testing__/parse.helper.ts';
import { collectTsxFiles } from '../__testing__/sandbox.helper.ts';
import { Diagnostic } from '../diagnostics/diagnostic.model.ts';

function diagnose(source: string): Diagnostic[] {
    return validate(parseTemplateOk(source));
}

describe('validate', () => {
    it('accepts a well-formed component', () => {
        expect(diagnose('export const Page = ({ title }: Props) => <h1>{title}</h1>;')).toEqual([]);
    });

    it('accepts a component with no props', () => {
        expect(diagnose('export const Page = () => <h1>hi</h1>;')).toEqual([]);
    });

    it('rejects a component with multiple parameters', () => {
        const [diagnostic] = diagnose('export const Page = (a, b) => <div>{a}{b}</div>;');
        expect(diagnostic.code).toBe(ValidationCode.MULTIPLE_PARAMS);
    });

    it('rejects an async component', () => {
        const [diagnostic] = diagnose('export const Page = async () => <div/>;');
        expect(diagnostic.code).toBe(ValidationCode.ASYNC_COMPONENT);
    });

    it('does not flag a two-argument map callback that returns JSX', () => {
        expect(diagnose('export const List = ({ items }) => <ul>{items.map((item, index) => <li>{index}{item}</li>)}</ul>;')).toEqual([]);
    });
});

describe('validate against real sandbox templates', () => {
    const files: string[] = collectTsxFiles(join(import.meta.dirname, '..', '..', '..', 'sandbox', 'src', 'templates'));

    it.each(files.map(f => [f.split('/templates/')[1], f] as const))(
        'reports no errors for %s',
        (_name, file) => {
            const diagnostics: Diagnostic[] = validate(parseTemplateOk(readFileSync(file, 'utf8')));
            expect(diagnostics).toEqual([]);
        }
    );
});