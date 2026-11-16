/**
 * What is wrong with one value of a refused request, as its error body lists it.
 */
export type ValidationProblem = {
    /**
     * The path of the value, like 'email' or 'address.city'.
     */
    key: string,
    /**
     * What kind of problem it is, like 'required'.
     */
    code: string,
    /**
     * What is wrong, in the language of the request, like 'is required'.
     */
    message: string
};