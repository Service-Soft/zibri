import { BadRequestError } from './bad-request.error';
import { ValidationProblem } from '../../validation';

type ValidationErrorType = 'body' | 'path' | 'query' | 'header';

const startMessage: Record<ValidationErrorType, string> = {
    body: 'Validation failed for request body',
    path: 'Validation failed for path parameter',
    query: 'Validation failed for query parameter',
    header: 'Validation failed for header parameter'
};

export class ValidationError extends BadRequestError {
    constructor(type: ValidationErrorType, problems: ValidationProblem[], options?: ErrorOptions) {
        const paragraphs: string[] = [startMessage[type]];
        for (const problem of problems) {
            paragraphs.push(`- ${problem.key}: ${problem.message}`);
        }
        super(startMessage[type], options);
        this.name = 'ValidationError';
        this.title = 'Validation Error';
        this.paragraphs = paragraphs;
    }
}