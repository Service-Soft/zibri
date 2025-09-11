/**
 * The type of a function that can be run on a separate thread.
 */
export type ThreadJobFunction<InputType, ResultType> = ((data: InputType) => ResultType) | ((data: InputType) => Promise<ResultType>);