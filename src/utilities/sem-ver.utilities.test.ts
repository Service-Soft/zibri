import { describe, expect, it } from '@jest/globals';

import { SemVerUtilities, SemVerVersion } from './sem-ver.utilities';

describe('SemVerUtilities', () => {
    describe('isSemVerVersion', () => {
        it('accepts a valid version', () => {
            expect(SemVerUtilities.isSemVerVersion('1.2.3')).toBe(true);
        });

        it('accepts 0.0.0', () => {
            expect(SemVerUtilities.isSemVerVersion('0.0.0')).toBe(true);
        });

        it('rejects a version with fewer than 3 parts', () => {
            expect(SemVerUtilities.isSemVerVersion('1.2')).toBe(false);
        });

        it('rejects a version with more than 3 parts', () => {
            expect(SemVerUtilities.isSemVerVersion('1.2.3.4')).toBe(false);
        });

        it('rejects a version with non-numeric parts', () => {
            expect(SemVerUtilities.isSemVerVersion('1.x.3')).toBe(false);
        });

        it('rejects an empty string', () => {
            expect(SemVerUtilities.isSemVerVersion('')).toBe(false);
        });
    });

    describe('compare', () => {
        it('returns "equal" for identical versions', () => {
            expect(SemVerUtilities.compare('1.2.3', '1.2.3')).toBe('equal');
        });

        it('returns "bigger" when the major version is bigger', () => {
            expect(SemVerUtilities.compare('2.0.0', '1.9.9')).toBe('bigger');
        });

        it('returns "smaller" when the major version is smaller', () => {
            expect(SemVerUtilities.compare('1.9.9', '2.0.0')).toBe('smaller');
        });

        it('returns "bigger" when only the minor version is bigger', () => {
            expect(SemVerUtilities.compare('1.3.0', '1.2.9')).toBe('bigger');
        });

        it('returns "smaller" when only the minor version is smaller', () => {
            expect(SemVerUtilities.compare('1.2.9', '1.3.0')).toBe('smaller');
        });

        it('returns "bigger" when only the patch version is bigger', () => {
            expect(SemVerUtilities.compare('1.2.4', '1.2.3')).toBe('bigger');
        });

        it('returns "smaller" when only the patch version is smaller', () => {
            expect(SemVerUtilities.compare('1.2.3', '1.2.4')).toBe('smaller');
        });

        it('throws for an invalid version', () => {
            expect(() => SemVerUtilities.compare('not-a-version' as SemVerVersion, '1.0.0')).toThrow();
        });
    });

    describe('matches — caret ranges', () => {
        it('^1.2.3 matches within the same major version', () => {
            expect(SemVerUtilities.matches('1.5.0', ['^1.2.3'])).toBe(true);
        });

        it('^1.2.3 does not match a different major version', () => {
            expect(SemVerUtilities.matches('2.0.0', ['^1.2.3'])).toBe(false);
        });

        it('^0.2.3 (major 0) only allows minor-level flexibility', () => {
            expect(SemVerUtilities.matches('0.2.9', ['^0.2.3'])).toBe(true);
            expect(SemVerUtilities.matches('0.3.0', ['^0.2.3'])).toBe(false);
        });

        it('^0.0.3 (major and minor 0) is pinned to the exact patch', () => {
            expect(SemVerUtilities.matches('0.0.3', ['^0.0.3'])).toBe(true);
            expect(SemVerUtilities.matches('0.0.4', ['^0.0.3'])).toBe(false);
        });
    });

    describe('matches — tilde ranges', () => {
        it('~1.2.3 allows patch-level flexibility only', () => {
            expect(SemVerUtilities.matches('1.2.9', ['~1.2.3'])).toBe(true);
            expect(SemVerUtilities.matches('1.3.0', ['~1.2.3'])).toBe(false);
        });

        it('~1.2 (two parts) allows patch-level flexibility', () => {
            expect(SemVerUtilities.matches('1.2.9', ['~1.2'])).toBe(true);
            expect(SemVerUtilities.matches('1.3.0', ['~1.2'])).toBe(false);
        });

        it('~1 (one part) allows minor-level flexibility', () => {
            expect(SemVerUtilities.matches('1.9.0', ['~1'])).toBe(true);
            expect(SemVerUtilities.matches('2.0.0', ['~1'])).toBe(false);
        });
    });

    describe('matches — comparison operators', () => {
        it('>=1.2.3 matches equal and greater versions', () => {
            expect(SemVerUtilities.matches('1.2.3', ['>=1.2.3'])).toBe(true);
            expect(SemVerUtilities.matches('1.2.2', ['>=1.2.3'])).toBe(false);
        });

        it('>1.2.3 excludes the exact version', () => {
            expect(SemVerUtilities.matches('1.2.3', ['>1.2.3'])).toBe(false);
            expect(SemVerUtilities.matches('1.2.4', ['>1.2.3'])).toBe(true);
        });

        it('<=1.2.3 matches equal and lesser versions', () => {
            expect(SemVerUtilities.matches('1.2.3', ['<=1.2.3'])).toBe(true);
            expect(SemVerUtilities.matches('1.2.4', ['<=1.2.3'])).toBe(false);
        });

        it('<1.2.3 excludes the exact version', () => {
            expect(SemVerUtilities.matches('1.2.3', ['<1.2.3'])).toBe(false);
            expect(SemVerUtilities.matches('1.2.2', ['<1.2.3'])).toBe(true);
        });

        it('an exact version matcher only matches that version', () => {
            expect(SemVerUtilities.matches('1.2.3', ['1.2.3'])).toBe(true);
            expect(SemVerUtilities.matches('1.2.4', ['1.2.3'])).toBe(false);
        });
    });

    describe('matches — compound (space-separated intersection) matchers', () => {
        it('">=1.0.0 <2.0.0" matches versions within the intersection', () => {
            expect(SemVerUtilities.matches('1.5.0', ['>=1.0.0 <2.0.0'])).toBe(true);
        });

        it('">=1.0.0 <2.0.0" does not match versions outside the intersection', () => {
            expect(SemVerUtilities.matches('2.0.0', ['>=1.0.0 <2.0.0'])).toBe(false);
            expect(SemVerUtilities.matches('0.9.0', ['>=1.0.0 <2.0.0'])).toBe(false);
        });
    });

    describe('matches — multiple matchers (union)', () => {
        it('matches if any of the provided matchers overlaps', () => {
            expect(SemVerUtilities.matches('1.5.0', ['^2.0.0', '^1.0.0'])).toBe(true);
        });

        it('does not match when none of the provided matchers overlap', () => {
            expect(SemVerUtilities.matches('1.5.0', ['^2.0.0', '^3.0.0'])).toBe(false);
        });
    });

    describe('matches — range vs range overlap (both arguments are matchers)', () => {
        it('detects overlapping ranges', () => {
            expect(SemVerUtilities.matches('^1.0.0', ['^1.5.0'])).toBe(true);
        });

        it('detects non-overlapping ranges', () => {
            expect(SemVerUtilities.matches('^1.0.0', ['^2.0.0'])).toBe(false);
        });
    });

    it('throws for an invalid matcher', () => {
        expect(() => SemVerUtilities.matches('1.0.0', ['not-a-version'])).toThrow();
    });
});