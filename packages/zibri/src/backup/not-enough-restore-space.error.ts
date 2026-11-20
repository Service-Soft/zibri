import { InternalError } from '../error-handling/internal-error.model';
import { Bytes } from '../utilities/bytes';
import { NotEnoughRestoreSpaceReason } from './not-enough-restore-space-reason.type';
import { RestoreSpace, RestoreSpaceOfResource } from './restore-space.model';

/**
 * How much more than the sizes a restore takes is asked to be free: what stays on the disk beside the
 * staged files, such as the rows of the users a restore keeps, and what the sizes miss.
 */
const MARGIN: number = 1.05;

/**
 * The refusal of a restore this instance's disk is too small for, or the end of one that ran out of space
 * on it before it changed anything: what it needs, what is free, and every way to go on with what each
 * costs.
 */
export class NotEnoughRestoreSpaceError extends InternalError {
    /**
     * What the restore takes, and what the disk has free.
     */
    readonly space: RestoreSpace;

    /**
     * When the restore was found to need more room.
     */
    readonly reason: NotEnoughRestoreSpaceReason;

    constructor(space: RestoreSpace, reason: NotEnoughRestoreSpaceReason) {
        const needed: number = NotEnoughRestoreSpaceError.resolveNeededBytes(space.resources);
        const fetched: number = NotEnoughRestoreSpaceError.resolveNeededBytes(space.resources.map(r => ({ ...r, snapshotBytes: 0 })));
        const about: string = space.resources.some(r => r.atMost) ? 'at most' : 'about';
        const ranOut: boolean = reason === 'ranOut';
        const neededPerResource: string = space.resources
            .map(r => `${about} ${Bytes.format(NotEnoughRestoreSpaceError.resolveNeededBytes([r]))} for "${r.name}"`)
            .join(', ');
        super([
            ranOut
                ? `Restoring backup "${space.backupName}" ran out of space in ${space.folder}, `
                + 'the folder of ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER, '
                + `before it changed anything. It needs ${about} ${Bytes.format(needed)} there, `
                + `and the disk had ${Bytes.format(space.freeBytes)} free.`
                : `Restoring backup "${space.backupName}" needs ${about} ${Bytes.format(needed)} free in ${space.folder}, `
                    + `the folder of ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER, which has ${Bytes.format(space.freeBytes)} free.`
                    + (reason === 'refused' ? ' Nothing was changed.' : ''),
            `It takes: ${space.resources.map(r => NotEnoughRestoreSpaceError.describe(r)).join('; ')}.`,
            'Any one of these lets it go on:',
            `- Make room: free ${Bytes.format(Math.max(0, needed - space.freeBytes))} there, or point ZIBRI_DI_TOKENS.BACKUP_TEMP_FOLDER `
            + `at a disk with ${Bytes.format(needed)} free, and restart.`,
            ...space.resources.length > 1
                ? [
                    `- Restore one resource at a time, such as restore(backup, { resources: ['${space.resources[0]?.name ?? ''}'] }), `
                    + `which needs ${neededPerResource}. `
                    + 'Downside: they are not restored all or nothing together, '
                    + 'and one restored stays restored when the next one fails.'
                ]
                : [],
            ...fetched < needed
                ? [
                    '- Restore without copies to put back, restore(backup, { putBack: false }), '
                    + `which needs ${about} ${Bytes.format(fetched)}. `
                    + 'Downside: a restore that fails part way is not put back, and leaves what it applied as it is.'
                ]
                : [],
            ...reason === 'ranOut'
                ? []
                : [
                    '- Go on regardless, restore(backup, { skipSpaceCheck: true }), when these sizes are wrong. '
                    + 'Downside: a restore that runs out of space fails, and puts back what it applied.'
                ]
        ]);
        this.name = 'NotEnoughRestoreSpaceError';
        this.space = space;
        this.reason = reason;
    }

    /**
     * The bytes resources take on the disk, with the margin.
     * @param resources - The resources.
     * @returns The bytes.
     */
    static resolveNeededBytes(resources: RestoreSpaceOfResource[]): number {
        return Math.ceil(resources.reduce((sum, r) => sum + r.fetchedBytes + r.snapshotBytes, 0) * MARGIN);
    }

    /**
     * What one resource takes, as the message says it.
     * @param resource - The resource.
     * @returns The description.
     */
    private static describe(resource: RestoreSpaceOfResource): string {
        const fetched: string = `"${resource.name}" ${Bytes.format(resource.fetchedBytes)} fetched`;
        return resource.snapshotBytes > 0 ? `${fetched} and ${Bytes.format(resource.snapshotBytes)} to put back from` : fetched;
    }
}