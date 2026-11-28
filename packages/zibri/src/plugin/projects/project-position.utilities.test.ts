import { describe, expect, it } from '@jest/globals';

import { type PositionedRow } from './models/position-placement.model';
import { ProjectPositionUtilities } from './project-position.utilities';

describe('ProjectPositionUtilities', () => {
    it('places a row first, last and between two others', () => {
        expect(ProjectPositionUtilities.resolveBetween(undefined, undefined)).toBe(1024);
        expect(ProjectPositionUtilities.resolveBetween(2048, undefined)).toBe(3072);
        expect(ProjectPositionUtilities.resolveBetween(undefined, 1024)).toBe(512);
        expect(ProjectPositionUtilities.resolveBetween(1024, 2048)).toBe(1536);
    });

    it('answers no place once the gap between two rows ran out of precision', () => {
        let after: number = 2048;
        let placed: number | undefined = 0;
        let halvings: number = 0;
        for (; placed != undefined; halvings++) {
            placed = ProjectPositionUtilities.resolveBetween(1024, after);
            after = placed ?? after;
        }

        expect(halvings).toBeGreaterThan(40);
        expect(halvings).toBeLessThan(60);
        expect(ProjectPositionUtilities.resolveBetween(1024, 1024)).toBeUndefined();
        expect(ProjectPositionUtilities.resolveBetween(2048, 1024)).toBeUndefined();
    });

    it('spreads rows out again, a step apart', () => {
        expect(ProjectPositionUtilities.resolveSpread(3)).toEqual([1024, 2048, 3072]);
        expect(ProjectPositionUtilities.resolveSpread(0)).toEqual([]);
    });

    it('places a row after another, first and last, writing no other row while there is room', () => {
        const rows: PositionedRow[] = [{ id: 'a', position: 1024 }, { id: 'b', position: 2048 }];

        expect(ProjectPositionUtilities.resolvePlacement(rows, 'a')).toEqual({ position: 1536, respread: [] });
        expect(ProjectPositionUtilities.resolvePlacement(rows, null)).toEqual({ position: 512, respread: [] });
        expect(ProjectPositionUtilities.resolvePlacement(rows, undefined)).toEqual({ position: 3072, respread: [] });
        expect(ProjectPositionUtilities.resolvePlacement([], null)).toEqual({ position: 1024, respread: [] });
        expect(ProjectPositionUtilities.resolvePlacement(rows, 'c')).toBeUndefined();
    });

    it('spreads the rows out again once the gap a row goes into ran out of precision, keeping their order', () => {
        const rows: PositionedRow[] = [{ id: 'a', position: 1024 }, { id: 'b', position: 1024 }, { id: 'c', position: 5000 }];

        expect(ProjectPositionUtilities.resolvePlacement(rows, 'a')).toEqual({
            position: 2048,
            respread: [{ id: 'b', position: 3072 }, { id: 'c', position: 4096 }]
        });
    });
});