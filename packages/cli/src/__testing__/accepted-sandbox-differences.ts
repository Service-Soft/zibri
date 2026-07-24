/**
 * Explicitly reviewed, intentional differences between what "zi new" generates and the
 * corresponding file in packages/sandbox, keyed by the file's path relative to the app root.
 * Every entry must be the actual diff produced by diffFileContents() for that path - copy it
 * from a failing test run, don't hand-write it.
 * A path with no entry here is expected to match exactly. Never add an entry to silence a real
 * bug or unreviewed drift; only for divergence that is genuinely intentional.
 */
export const acceptedSandboxDifferences: Record<string, string> = {};