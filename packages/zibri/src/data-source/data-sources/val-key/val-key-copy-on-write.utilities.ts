/**
 * Namespace a backup holds keys aside under while it reads, each run under its id: the copies of a
 * snapshot, and the values a walk copies on write. A whole segment of the key rather than a suffix, so it
 * cannot collide with an entity: a table name containing a colon is not addressable in the first place.
 */
export const VAL_KEY_BACKUP_SNAPSHOT_SEGMENT: string = 'zibri.backup';

/**
 * Namespace of the heartbeats of the runs that hold keys aside, the lists of them, and the list of the
 * runs a write copies the old value of a key aside for.
 */
export const VAL_KEY_ASIDE_SEGMENT: string = 'zibri.aside';

/**
 * What a run names its keys under, each after the id of the run and a colon: the copy of a key and the
 * members added to and removed from a set since it began, each followed by the key, the set of the keys it
 * noted as absent, the set of what it made, and the key naming a key it could not hold as of its start.
 */
export const VAL_KEY_COPY_ON_WRITE_NAMES: {
    /**
     * What the copy of a key is named under, followed by the key.
     */
    value: string,
    /**
     * What the members added to a set since the run began are listed under, followed by the set.
     */
    added: string,
    /**
     * What the members removed from a set since the run began are listed under, followed by the set.
     */
    removed: string,
    /**
     * The set of the keys the run noted as absent.
     */
    absent: string,
    /**
     * The set of the keys the run made.
     */
    copies: string,
    /**
     * The key naming a key the run could not hold as of its start.
     */
    broken: string
} = { value: 'value:', added: 'added:', removed: 'removed:', absent: 'absent', copies: 'copies', broken: 'broken' };

/**
 * What a read as of one moment reads through: the copies writes make for a run copying on write, begun at
 * that moment.
 */
export type ValKeyReadView = {
    /**
     * What a write names the copy of a key under, followed by the key.
     */
    valuePrefix: string,
    /**
     * The set of the keys a write noted as absent at that moment.
     */
    absentKey: string,
    /**
     * What the members a write added to a set since that moment are listed under, followed by the set:
     * those it did not hold then.
     */
    addedPrefix: string,
    /**
     * What the members a write removed from a set since that moment are listed under, followed by the set:
     * those it held then.
     */
    removedPrefix: string,
    /**
     * The key naming a key a write could not hold as of that moment, there once one could not.
     */
    brokenKey: string,
    /**
     * The heartbeat of the run, gone once another instance took the run for dead and deleted its copies.
     */
    heartbeatKey: string
};

/**
 * Where a backup copying on write keeps the value each key had when it began, and how a write finds the
 * runs it copies for.
 *
 * Each write through the data source, while a run is listed, first copies the key it writes under the
 * run, or notes it as absent when there is none, once per key and run: what the backup reads of a key is
 * that copy when there is one, so every key is read as it was when the run began.
 */
export abstract class ValKeyCopyOnWriteUtilities {
    /**
     * Gets the key of the set of runs a write copies for.
     * @param keyPrefix - The prefix of the data source.
     * @returns The key.
     */
    static getRunsKey(keyPrefix: string): string {
        return `${keyPrefix}:${VAL_KEY_ASIDE_SEGMENT}:copy-on-write`;
    }

    /**
     * Gets what the heartbeat of a run holding keys aside is named under, followed by the id of the run.
     * @param keyPrefix - The prefix of the data source.
     * @returns The prefix.
     */
    static getHeartbeatPrefix(keyPrefix: string): string {
        return `${keyPrefix}:${VAL_KEY_ASIDE_SEGMENT}:run:`;
    }

    /**
     * Gets what every run's keys are named under, followed by the id of the run.
     * @param keyPrefix - The prefix of the data source.
     * @returns The prefix.
     */
    static getRunsPrefix(keyPrefix: string): string {
        return `${keyPrefix}:${VAL_KEY_BACKUP_SNAPSHOT_SEGMENT}:`;
    }

    /**
     * Gets what the keys of one run are named under, all of which go once it ends.
     * @param keyPrefix - The prefix of the data source.
     * @param runId - The run.
     * @returns The prefix.
     */
    static getRunPrefix(keyPrefix: string, runId: string): string {
        return `${this.getRunsPrefix(keyPrefix)}${runId}:`;
    }

    /**
     * Gets what the copy of a key a run keeps is named under, followed by the key.
     * @param keyPrefix - The prefix of the data source.
     * @param runId - The run.
     * @returns The prefix.
     */
    static getValuePrefix(keyPrefix: string, runId: string): string {
        return `${this.getRunPrefix(keyPrefix, runId)}${VAL_KEY_COPY_ON_WRITE_NAMES.value}`;
    }

    /**
     * Gets the key of the set of keys a run noted as absent: written first after it began.
     * @param keyPrefix - The prefix of the data source.
     * @param runId - The run.
     * @returns The key.
     */
    static getAbsentKey(keyPrefix: string, runId: string): string {
        return `${this.getRunPrefix(keyPrefix, runId)}${VAL_KEY_COPY_ON_WRITE_NAMES.absent}`;
    }

    /**
     * Gets the key of the set of the copies a run made, listed as each is made, so that its keys are deleted
     * by their names once it ends rather than looked for among every key of the server.
     * @param keyPrefix - The prefix of the data source.
     * @param runId - The run.
     * @returns The key.
     */
    static getCopiesKey(keyPrefix: string, runId: string): string {
        return `${this.getRunPrefix(keyPrefix, runId)}${VAL_KEY_COPY_ON_WRITE_NAMES.copies}`;
    }

    /**
     * Resolves what a run reads through: its copies, the keys it noted as absent, the members written to
     * sets since it began, and whether it lost a key.
     * @param keyPrefix - The prefix of the data source.
     * @param runId - The run.
     * @param heartbeatKey - The heartbeat of the run.
     * @returns The view.
     */
    static resolveReadView(keyPrefix: string, runId: string, heartbeatKey: string): ValKeyReadView {
        const runPrefix: string = this.getRunPrefix(keyPrefix, runId);
        return {
            valuePrefix: `${runPrefix}${VAL_KEY_COPY_ON_WRITE_NAMES.value}`,
            absentKey: `${runPrefix}${VAL_KEY_COPY_ON_WRITE_NAMES.absent}`,
            addedPrefix: `${runPrefix}${VAL_KEY_COPY_ON_WRITE_NAMES.added}`,
            removedPrefix: `${runPrefix}${VAL_KEY_COPY_ON_WRITE_NAMES.removed}`,
            brokenKey: `${runPrefix}${VAL_KEY_COPY_ON_WRITE_NAMES.broken}`,
            heartbeatKey
        };
    }

    /**
     * Resolves the members of a set as of the moment a view reads as of, from what it holds now and what
     * was written to it since: without those added since, with those removed since.
     * @param members - What it holds now, or of a copy, which nothing is laid over.
     * @param added - The members added since, which it did not hold then.
     * @param removed - The members removed since, which it held then.
     * @returns The members then.
     */
    static resolveMembersAsOf(members: string[], added: string[], removed: string[]): string[] {
        const addedSince: Set<string> = new Set(added);
        return [...new Set([...members.filter(m => !addedSince.has(m)), ...removed])];
    }
}