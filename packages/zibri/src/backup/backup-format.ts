// Deliberately not the framework's own version. A backup outlives the releases either side of it, so
// tying whether one can be read to a major release would make every archive unreadable the next time
// the framework breaks something unrelated to backups.
/**
 * What shape the framework writes a backup in. It changes when the shape of a backup changes and at
 * no other time.
 *
 * What it covers is what the framework writes: the record beside the data - including which fields a
 * restore reads out of it - the layout a transport stores under, and how encrypted data is sealed. It
 * says nothing about what a resource's own `createBackupData` produces: that format belongs to the
 * resource, such as a dump that only the database it came from reads.
 */
export const BACKUP_FORMAT_VERSION: number = 2;

// A list rather than a lowest supported version, so that dropping one is something somebody writes
// down rather than something a comparison starts doing. Refusing by name is the case worth catching,
// since the shape a restore guesses wrong at is the shape it damages a database with.
/**
 * The shapes this build knows how to restore from. An archive written in a shape that is not here is
 * refused by name.
 */
// format 1 stays readable through 4.x, so that a backup a retention keeps that long still restores
export const READABLE_BACKUP_FORMAT_VERSIONS: number[] = [1, BACKUP_FORMAT_VERSION];

// one segment at the top, so that format 1, which keeps every backup under its name there, only has
// to skip it. With a dot, since a backup is named by a date unless somebody names it
/**
 * The folder at the top of a transport that the chunks, keys and records of deduplicated backups are
 * kept under. No backup may have it as its name.
 */
export const BACKUP_REPOSITORY_FOLDER: string = '.zibri-repository';