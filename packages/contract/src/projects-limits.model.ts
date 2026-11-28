/**
 * What the projects plugin of Zibri takes at most, and the shape of a label color, so that a frontend checks a value
 * before it sends it. A description and a comment are markdown, stored as the text it is written as.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_PROJECTS_LIMITS = {
    /**
     * The longest name of a project, a column or a label.
     */
    NAME_MAX_LENGTH: 200,
    /**
     * The longest title of a task.
     */
    TITLE_MAX_LENGTH: 500,
    /**
     * The longest description of a project or a task, in characters of its markdown.
     */
    DESCRIPTION_MAX_LENGTH: 20000,
    /**
     * The longest comment on a task, in characters of its markdown.
     */
    COMMENT_MAX_LENGTH: 10000,
    /**
     * The most people a task is assigned to.
     */
    ASSIGNEES_MAX_COUNT: 50,
    /**
     * The most labels a task carries.
     */
    LABELS_MAX_COUNT: 50,
    /**
     * The longest name of the color of a label.
     */
    COLOR_MAX_LENGTH: 50,
    /**
     * The color of a label: the name of a color token of the frontend, such as `primary` or `red-500`, never a color
     * value.
     */
    COLOR_REGEX: /^[a-z][\da-z]*(-[\da-z]+)*$/
} as const;
