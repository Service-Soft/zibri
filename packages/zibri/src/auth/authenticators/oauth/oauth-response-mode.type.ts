/**
 * How a provider sends its answer to a sign-in back to the application: `query` redirects the browser
 * with it in the url, `form_post` answers with a page that posts it to the callback.
 */
export type OAuthResponseMode = 'query' | 'form_post';