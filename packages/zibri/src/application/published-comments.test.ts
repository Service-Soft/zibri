import { describe, expect, it } from '@jest/globals';

import { EntryPointUtilities, PublishedComment, TESTING_ENTRY_POINT } from '../__testing__/entry-point.utilities';

// typedoc publishes the JSDoc of everything an entry point exports, for readers who have never seen
// this repository. Why a thing is built the way it is, and any reference into the repository's
// evaluation, belongs in a `//` comment beside the code (CODE_STYLE.md, "Comments and JSDoc"). These
// words are the plainest marks of either; a block that uses one to describe what a caller sees is
// listed below with the words it says it in

/**
 * The words that mark a reason, or a reference into the evaluation.
 */
const REASON_MARKERS: RegExp = /\b(deliberately|on purpose|rather than)\b|\bevaluation\//i;

/**
 * Blocks that use a marker to describe behavior, by file and the sentence that holds it.
 */
const DESCRIBING_BEHAVIOR: { file: string, sentence: string }[] = [{ file: 'multithreading/models/thread-job-status.enum.ts', sentence: 'The process running it stopped on purpose before it was done.' }];

/**
 * The blocks of an entry point that carry a marker and are not listed as describing behavior.
 * @param entryPoint - The entry point's file, relative to `src`.
 * @returns Where each one is, and the line holding the marker.
 */
function findReasons(entryPoint: string): string[] {
    return EntryPointUtilities.resolvePublishedComments(entryPoint)
        .filter((comment: PublishedComment) => REASON_MARKERS.test(comment.text))
        .filter((comment: PublishedComment) => !DESCRIBING_BEHAVIOR.some(allowed => comment.file === allowed.file
            && comment.text.replaceAll(/\s*\n\s*\*\s*/g, ' ').includes(allowed.sentence)))
        .map((comment: PublishedComment) => {
            const lines: string[] = comment.text.split('\n');
            const index: number = lines.findIndex(line => REASON_MARKERS.test(line));
            return `${comment.file}:${comment.line + Math.max(index, 0)} ${lines[index]?.trim() ?? ''}`;
        });
}

describe('the published JSDoc', () => {
    it('of zibri says what a thing does, not why it was built that way', () => {
        expect(findReasons('index.ts')).toEqual([]);
    });

    it('of zibri-testing says what a thing does, not why it was built that way', () => {
        expect(findReasons(TESTING_ENTRY_POINT)).toEqual([]);
    });
});