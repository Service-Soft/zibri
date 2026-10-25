import { createHash } from 'crypto';

import { CPUtilities, ProcessResult } from './cp.utilities';
import { FsUtilities } from './fs.utilities';
import { getPath, Path } from '../utilities';

/**
 * Three versions of a file merged into one.
 */
export type MergeResult = {
    /**
     * The merged content, with conflict markers where both sides changed the same lines.
     */
    content: Buffer,
    /**
     * Whether it has any conflict markers.
     */
    conflicted: boolean
};

/**
 * What a conflict marker names each side of a merge.
 */
export type MergeLabels = {
    /**
     * The version that is there now.
     */
    current: string,
    /**
     * The version both others were made from.
     */
    base: string,
    /**
     * The version merged into the current one.
     */
    incoming: string
};

/**
 * Encapsulates what the cli asks of git.
 */
export abstract class GitUtilities {

    /**
     * The id git stores a file's content under, worked out without git.
     * @param content - The content.
     * @returns Its blob id.
     */
    static resolveBlobHash(content: Buffer): string {
        return createHash('sha1')
            .update(`blob ${content.length}\0`)
            .update(content)
            .digest('hex');
    }

    /**
     * Looks for content in a repository's history by its id.
     * @param repositoryPath - Anywhere inside the repository.
     * @param hash - The blob id.
     * @returns The content, or undefined when the repository has no such blob, or there is no
     * repository, or no git.
     */
    static findBlob(repositoryPath: Path, hash: string): Buffer | undefined {
        const result: ProcessResult = CPUtilities.resolveResult('git', ['cat-file', 'blob', hash], repositoryPath);
        return result.status === 0 ? result.stdout : undefined;
    }

    /**
     * Merges into a file what changed between two other versions of it, the way a git merge does.
     * @param current - The version that is there now.
     * @param base - The version both others were made from.
     * @param incoming - The version whose changes are merged in.
     * @param labels - What the conflict markers name each of them.
     * @returns The merge, or undefined when git could not make one.
     */
    static async resolveMerge(current: Buffer, base: Buffer, incoming: Buffer, labels: MergeLabels): Promise<MergeResult | undefined> {
        const directory: Path = await FsUtilities.mkdtemp('zibri-merge-');
        try {
            const files: Path[] = [getPath(directory, 'current'), getPath(directory, 'base'), getPath(directory, 'incoming')];
            await FsUtilities.writeFileBuffer(files[0], current);
            await FsUtilities.writeFileBuffer(files[1], base);
            await FsUtilities.writeFileBuffer(files[2], incoming);
            const result: ProcessResult = CPUtilities.resolveResult(
                'git',
                ['merge-file', '-p', '-L', labels.current, '-L', labels.base, '-L', labels.incoming, ...files],
                directory
            );
            // the number of conflicts, capped at 127, or a negative number when it failed - which an
            // exit code carries as one above that
            if (result.status == undefined || result.status > 127) {
                return undefined;
            }
            return { content: result.stdout, conflicted: result.status > 0 };
        }
        finally {
            await FsUtilities.rm(directory);
        }
    }
}