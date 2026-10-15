/**
 * What shape the framework writes a backup in.
 *
 * Deliberately not the framework's own version. A backup outlives the releases either side of it, so
 * tying whether one can be read to a major release would make every archive unreadable the next time
 * the framework breaks something unrelated to backups. This changes when the shape of a backup
 * changes and at no other time, which is usually never.
 *
 * What it covers is what the framework writes: the record beside the data - including which fields a
 * restore reads out of it - the layout a transport stores under, and how encrypted data is sealed. It
 * says nothing about what a resource's own `createBackupData` produces, because that format belongs to
 * the resource: a postgres dump is read by postgres, and which versions of it can is postgres's
 * contract rather than this one.
 */
export const BACKUP_FORMAT_VERSION: number = 1;

/**
 * The shapes this build knows how to restore from.
 *
 * A list rather than a lowest supported version, so that dropping one is something somebody writes
 * down rather than something a comparison starts doing. An archive written in a shape that is not
 * here is refused by name instead of read as though it were this one - which is the case worth
 * catching, since the shape a restore guesses wrong at is the shape it damages a database with.
 */
export const READABLE_BACKUP_FORMAT_VERSIONS: number[] = [BACKUP_FORMAT_VERSION];