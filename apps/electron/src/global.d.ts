export {};

declare global {
  interface Window {
    exocortex: {
      createSession(goal: string, model?: string): Promise<unknown>;
      listSessions(): Promise<unknown[]>;
      listEvents(sessionId: string): Promise<unknown[]>;
      listBindings(sessionId: string): Promise<unknown[]>;
      listArtifacts(sessionId: string): Promise<unknown[]>;
      listModalities(): Promise<unknown[]>;
      listContinuityObjects(): Promise<unknown[]>;
      listContinuityRelations(): Promise<unknown[]>;
      listContinuityEvents(): Promise<unknown[]>;
      injectAppText(text: string): Promise<void>;
      sendModalityAction(sessionId: string, bindingId: string, actionType: string, value: unknown): Promise<unknown>;
      armActuator(channel: string, reason: string): Promise<unknown>;
      listActuatorSafety(): Promise<unknown>;
      createBrowserSession(): Promise<unknown>;
      listBrowserSessions(): Promise<unknown[]>;
      browserDispatch(browserSessionId: string, action: unknown): Promise<unknown>;
      browserCapture(browserSessionId: string): Promise<unknown>;
    };
  }
}
