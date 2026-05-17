export {};

declare global {
  interface Window {
    exocortex: {
      createSession(goal: string): Promise<unknown>;
      listSessions(): Promise<unknown[]>;
      listEvents(sessionId: string): Promise<unknown[]>;
      listModalities(): Promise<unknown[]>;
      injectAppText(text: string): Promise<void>;
      createBrowserSession(): Promise<unknown>;
    };
  }
}
