export type ValidationProblem = {
    key: string,
    message: string
};

export class IsRequiredValidationProblem implements ValidationProblem {
    readonly message: string = 'is required';
    constructor(readonly key: string) {}
}