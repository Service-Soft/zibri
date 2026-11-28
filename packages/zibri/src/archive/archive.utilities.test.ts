import { describe, expect, it } from '@jest/globals';

import { BaseChainedEntity } from '../data-source/chain/base-chained-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { ArchiveMetadata } from './archive-options.model';
import { ArchiveUtilities } from './archive.utilities';
import { BaseArchivedEntity } from './base-archived-entity.model';
import { Archive } from './decorators/archive.decorator';

describe('ArchiveUtilities.resolveRetainUntil', () => {
    it('keeps a receipt of March 2026 with 8 years until the end of 2034', () => {
        expect(ArchiveUtilities.resolveRetainUntil(new Date('2026-03-15T10:00:00Z'), { retention: { years: 8 }, from: 'endOfYear' }, 'UTC'))
            .toEqual(new Date('2035-01-01T00:00:00.000Z'));
    });

    it('counts the end of the year in the time zone, where a date late on New Year\'s Eve in UTC is already in the next year', () => {
        const date: Date = new Date('2026-12-31T23:30:00Z');

        expect(ArchiveUtilities.resolveRetainUntil(date, { retention: { years: 10 }, from: 'endOfYear' }, 'UTC'))
            .toEqual(new Date('2037-01-01T00:00:00.000Z'));
        // 00:30 on the first of January 2027 in Berlin, and the year ends at midnight there, an hour before it does in UTC
        expect(ArchiveUtilities.resolveRetainUntil(date, { retention: { years: 10 }, from: 'endOfYear' }, 'Europe/Berlin'))
            .toEqual(new Date('2037-12-31T23:00:00.000Z'));
        expect(ArchiveUtilities.resolveRetainUntil(new Date('2026-06-01T12:00:00Z'), { retention: { years: 1 }, from: 'endOfYear' }, 'America/New_York'))
            .toEqual(new Date('2028-01-01T05:00:00.000Z'));
    });

    it('counts months and days on from the end of the year', () => {
        expect(ArchiveUtilities.resolveRetainUntil(new Date('2026-03-15T10:00:00Z'), { retention: { years: 6, months: 6, days: 10 }, from: 'endOfYear' }, 'UTC'))
            .toEqual(new Date('2033-07-11T00:00:00.000Z'));
    });

    it('counts from the date itself with from: \'date\', on the wall clock of the time zone', () => {
        expect(ArchiveUtilities.resolveRetainUntil(new Date('2026-03-15T10:20:30.400Z'), { retention: { days: 30 }, from: 'date' }, 'UTC'))
            .toEqual(new Date('2026-04-14T10:20:30.400Z'));
        // 12:00 in Berlin in winter, kept until 12:00 in Berlin in summer, which is an hour earlier in UTC
        expect(ArchiveUtilities.resolveRetainUntil(new Date('2026-01-15T11:00:00Z'), { retention: { months: 6 }, from: 'date' }, 'Europe/Berlin'))
            .toEqual(new Date('2026-07-15T10:00:00.000Z'));
    });
});

describe('declaring an archived entity', () => {
    it('refuses a retention that is not a whole number of years, months and days above 0', () => {
        expect(() => Archive({ retention: {} })).toThrow('at least one of them above 0');
        expect(() => Archive({ retention: { years: 1.5 } })).toThrow('whole number');
        expect(() => Archive({ retention: { years: 10, days: -1 } })).toThrow('whole number');
    });

    it('refuses an archived entity that is not chained when the application starts', () => {
        @Entity({ tenant: 'shared', allowOrphan: true })
        class UnchainedReceipt extends BaseArchivedEntity {}
        const metadata: ArchiveMetadata = { retention: { years: 10 }, from: 'endOfYear', dateProperty: undefined, copies: [] };

        expect(() => ArchiveUtilities.validateArchivable(UnchainedReceipt, metadata)).toThrow('Declare it with @Entity({ chained: true })');
    });

    it('refuses an archived entity that does not extend BaseArchivedEntity, and a date property that is no date', () => {
        @Entity({ tenant: 'shared', allowOrphan: true, chained: true })
        class ChainedOnly extends BaseChainedEntity {
            @Property.string()
            issuedAt!: string;
        }
        @Entity({ tenant: 'shared', allowOrphan: true, chained: true })
        class MisdatedReceipt extends BaseArchivedEntity {
            @Property.string()
            issuedAt!: string;
        }

        expect(() => ArchiveUtilities.validateArchivable(ChainedOnly, { retention: { years: 1 }, from: 'endOfYear', dateProperty: undefined, copies: [] }))
            .toThrow('Extend BaseArchivedEntity');
        expect(() => ArchiveUtilities.validateArchivable(MisdatedReceipt, { retention: { years: 1 }, from: 'endOfYear', dateProperty: 'issuedAt', copies: [] }))
            .toThrow('MisdatedReceipt.issuedAt needs to be a date property');
    });
});