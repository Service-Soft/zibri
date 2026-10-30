import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { IsRequiredValidationProblem,
    MaxFileSizeValidationProblem,
    MimeTypeMismatchValidationProblem,
    RelationsNotAllowedValidationProblem,
    TypeMismatchValidationProblem } from './validation-problem.model';
import { TestTimeouts } from '../__testing__/constants';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { MimeType } from '../http/mime-type.enum';

describe('validation problems', () => {
    let server: StartedTestServer;

    beforeAll(async () => {
        server = await startTestServer({});
    }, TestTimeouts.postgres.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.postgres.shutdown);

    it('IsRequiredValidationProblem carries the key and an "is required" message', () => {
        const problem: IsRequiredValidationProblem = new IsRequiredValidationProblem('name');
        expect(problem.key).toBe('name');
        expect(problem.message).toContain('required');
    });

    it('TypeMismatchValidationProblem mentions the expected type', () => {
        const problem: TypeMismatchValidationProblem = new TypeMismatchValidationProblem('age', 'number');
        expect(problem.key).toBe('age');
        expect(problem.message).toContain('number');
    });

    it('MaxFileSizeValidationProblem mentions the max size', () => {
        const problem: MaxFileSizeValidationProblem = new MaxFileSizeValidationProblem('file', '5mb');
        expect(problem.key).toBe('file');
        expect(problem.message).toContain('5mb');
    });

    it('MimeTypeMismatchValidationProblem uses singular phrasing for a single allowed type', () => {
        const problem: MimeTypeMismatchValidationProblem = new MimeTypeMismatchValidationProblem('file', [MimeType.PDF]);
        expect(problem.message).toContain(MimeType.PDF);
        expect(problem.message).not.toContain('one of');
    });

    it('MimeTypeMismatchValidationProblem lists all types when multiple are allowed', () => {
        const problem: MimeTypeMismatchValidationProblem = new MimeTypeMismatchValidationProblem(
            'file',
            [MimeType.PDF, MimeType.PNG]
        );
        expect(problem.message).toContain('one of');
        expect(problem.message).toContain(MimeType.PDF);
        expect(problem.message).toContain(MimeType.PNG);
    });

    // part of evaluation round 2, 03 §H7: it carried a TypeScript example naming the entity's classes,
    // which reached every caller
    it('RelationsNotAllowedValidationProblem says that a relation cannot be written, and nothing more', () => {
        const problem: RelationsNotAllowedValidationProblem = new RelationsNotAllowedValidationProblem('target');
        expect(problem.key).toBe('target');
        expect(problem.message).toBe('relations are not allowed as part of create or update data.');
    });
});