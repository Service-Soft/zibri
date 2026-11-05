import { ScaffoldAnswers } from './scaffold-answers.model';

/**
 * Where a project keeps its manifest: at its root, committed with everything else.
 */
export const SCAFFOLD_MANIFEST_FILE: string = 'zibri-scaffold.json';

/**
 * What `zi new` or `zi upgrade` last generated into a project.
 *
 * What lets an upgrade tell a file the project changed from one it did not, and read the version it
 * generated back out of the project's history to merge against.
 */
export type ScaffoldManifest = {
    /**
     * The version of the cli that generated it.
     */
    version: string,
    /**
     * What it was generated from.
     */
    answers: ScaffoldAnswers,
    /**
     * Every file it generated, relative to the project, with the id git stores its content under.
     */
    files: Record<string, string>
};