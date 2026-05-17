export {};

declare global {
  interface Window {
    exocortex: {
      createSession(goal: string): Promise<unknown>;
      listSessions(): Promise<unknown[]>;
      listEvents(sessionId: string): Promise<unknown[]>;
      listBindings(sessionId: string): Promise<unknown[]>;
      listArtifacts(sessionId: string): Promise<unknown[]>;
      listModalities(): Promise<unknown[]>;
      injectAppText(text: string): Promise<void>;
      createBrowserSession(): Promise<unknown>;
      listBrowserSessions(): Promise<unknown[]>;
      browserDispatch(browserSessionId: string, action: unknown): Promise<unknown>;
      browserCapture(browserSessionId: string): Promise<unknown>;
    };
  }
}
