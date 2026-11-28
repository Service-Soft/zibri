import { ChainUtilities } from '../data-source/chain/chain.utilities';
import { type BaseEntity } from '../entity/base-entity.model';
import { type PropertyMetadata } from '../entity/decorators/property.decorator';
import { InternalError } from '../error-handling/internal-error.model';
import { getZonedDate, ZonedDate } from '../localization/format-date.function';
import { Timezone } from '../localization/models/timezone.model';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ArchiveMetadata } from './archive-options.model';
import { ArchiveRetention } from './archive-retention.model';
import { type BaseArchivedEntity } from './base-archived-entity.model';

/**
 * A time on the wall clock of a time zone, each field of which may run over, such as month 14.
 */
type WallTime = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    year: number,
    /**
     * Starting at 0 for January.
     */
    month: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    day: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    hours: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    minutes: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    seconds: number,
    // eslint-disable-next-line jsdoc/require-jsdoc
    milliseconds: number
};

/**
 * Reads the archives entities declare, and says when the retention of their rows ends.
 */
export abstract class ArchiveUtilities {
    /**
     * Finds what `@Archive` declares of an entity.
     * @param entityClass - The entity.
     * @returns Its archive, or undefined for an entity that is not archived.
     */
    static findMetadata(entityClass: Newable<BaseEntity>): ArchiveMetadata | undefined {
        return MetadataUtilities.getArchiveMetadata(entityClass);
    }

    /**
     * Whether a row holds what the archive records of its files, as a row of an archived entity does.
     * @param row - The row.
     * @returns True for a row of an archived entity.
     */
    static isArchivedRow(row: object): row is BaseArchivedEntity {
        return Array.isArray(Reflect.get(row, 'archivedFiles')) && Reflect.get(row, 'retainUntil') instanceof Date;
    }

    /**
     * Resolves when the retention of a row ends.
     * @param date - The date the retention is counted from: the row's date property, or when it was created.
     * @param metadata - The archive of the entity.
     * @param timezone - The time zone whose calendar the retention is counted on.
     * @returns The first moment the row may be deleted.
     */
    static resolveRetainUntil(date: Date, metadata: Pick<ArchiveMetadata, 'retention' | 'from'>, timezone: Timezone): Date {
        const zoned: ZonedDate = getZonedDate(date, timezone);
        const { years = 0, months = 0, days = 0 } = metadata.retention;
        // the end of a year is the first moment of the next one, from which a row kept until it may be deleted
        const start: WallTime = metadata.from === 'endOfYear'
            ? { year: zoned.year + 1, month: 0, day: 1, hours: 0, minutes: 0, seconds: 0, milliseconds: 0 }
            : { ...zoned, milliseconds: date.getUTCMilliseconds() };
        return this.resolveInstant({ ...start, year: start.year + years, month: start.month + months, day: start.day + days }, timezone);
    }

    /**
     * Validates a retention: whole numbers, at least one of them above 0.
     * @param retention - The retention.
     * @throws An InternalError when it is not.
     */
    static validateRetention(retention: ArchiveRetention): void {
        const parts: number[] = [retention.years ?? 0, retention.months ?? 0, retention.days ?? 0];
        if (parts.some(part => !Number.isInteger(part) || part < 0) || parts.every(part => part === 0)) {
            throw new InternalError(
                'The retention of an archive needs to be a whole number of years, months and days, at least one of them above 0.'
            );
        }
    }

    /**
     * Validates that an archived entity can be archived: chained, extending `BaseArchivedEntity`, and counting its
     * retention from a date property it declares.
     * @param entityClass - The archived entity.
     * @param metadata - Its archive.
     * @throws An InternalError naming what it lacks.
     */
    static validateArchivable(entityClass: Newable<BaseEntity>, metadata: ArchiveMetadata): void {
        // checked when the application starts rather than by the decorator, which may run before @Entity does
        if (!ChainUtilities.isChained(entityClass)) {
            throw new InternalError([
                `${entityClass.name}: An archived entity is chained, which tells a row that was changed or removed apart.`,
                'Declare it with @Entity({ chained: true }).'
            ]);
        }
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        if (properties['retainUntil']?.type !== 'date' || properties['archivedFiles']?.type !== 'array') {
            throw new InternalError([
                `${entityClass.name}: An archived entity holds the retention and the files of each row in "retainUntil" and `
                + '"archivedFiles".',
                'Extend BaseArchivedEntity, which declares them.'
            ]);
        }
        if (metadata.dateProperty != undefined && properties[metadata.dateProperty]?.type !== 'date') {
            throw new InternalError(
                `${entityClass.name}.${metadata.dateProperty} needs to be a date property, since the retention is counted from it.`
            );
        }
    }

    /**
     * Resolves the instant a time on the wall clock of a time zone is.
     * @param wall - The time, whose fields may run over.
     * @param timezone - The time zone.
     * @returns The instant.
     */
    private static resolveInstant(wall: WallTime, timezone: Timezone): Date {
        const asUtc: number = Date.UTC(wall.year, wall.month, wall.day, wall.hours, wall.minutes, wall.seconds, wall.milliseconds);
        // the offset read once at a guess and again at the instant it gives, which is right on both sides of a
        // change of the offset, such as daylight saving time
        const guess: number = asUtc - this.resolveOffset(asUtc, timezone);
        return new Date(asUtc - this.resolveOffset(guess, timezone));
    }

    /**
     * Resolves how far the wall clock of a time zone is ahead of UTC at an instant.
     * @param instant - The instant, in milliseconds.
     * @param timezone - The time zone.
     * @returns The offset, in milliseconds.
     */
    private static resolveOffset(instant: number, timezone: Timezone): number {
        const zoned: ZonedDate = getZonedDate(new Date(instant), timezone);
        const wholeSeconds: number = Math.floor(instant / 1000) * 1000;
        return Date.UTC(zoned.year, zoned.month, zoned.day, zoned.hours, zoned.minutes, zoned.seconds) - wholeSeconds;
    }
}