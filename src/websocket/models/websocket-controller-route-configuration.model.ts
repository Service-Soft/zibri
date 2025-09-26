/**
 * The configuration for a websocket controller route.
 */
export type WebsocketControllerRouteConfiguration = {
    /**
     * The websocket event to listen on.
     */
    event: string,
    /**
     * The name of the method on the controller that is responsible for handling messages to the websocket event.
     */
    controllerMethod: string
};