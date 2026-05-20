export {};

declare global {
  interface Window {
    exocortex: {
      createSession(goal: string, model?: string): Promise<unknown>;
      stopSession(sessionId: string): Promise<unknown>;
      listSessions(): Promise<unknown[]>;
      listEvents(sessionId: string): Promise<unknown[]>;
      listBindings(sessionId: string): Promise<unknown[]>;
      updateModalityRoute(sessionId: string, bindingId: string, policy: string): Promise<unknown>;
      listArtifacts(sessionId: string): Promise<unknown[]>;
      listMediaProviders(): Promise<unknown>;
      captureMedia(sessionId: string, kind: "image" | "audio" | "video", options?: unknown): Promise<unknown>;
      synthesizeSpeech(sessionId: string, text: string, providerId?: string): Promise<unknown>;
      transcribeArtifact(sessionId: string, artifactId: string, providerId?: string): Promise<unknown>;
      listModels(): Promise<unknown>;
      listModalities(): Promise<unknown[]>;
      transportHealth(): Promise<unknown>;
      listContinuityObjects(): Promise<unknown[]>;
      listContinuityRelations(): Promise<unknown[]>;
      listContinuityEvents(): Promise<unknown[]>;
      injectAppText(text: string): Promise<void>;
      sendModalityAction(sessionId: string, bindingId: string, actionType: string, value: unknown): Promise<unknown>;
      armActuator(channel: string, reason: string): Promise<unknown>;
      listActuatorSafety(): Promise<unknown>;
      approveActuatorCommand(channel: string, value: unknown, reason: string): Promise<unknown>;
      revokeActuatorApproval(approvalId: string, reason: string): Promise<unknown>;
      listCalibrationProfiles(): Promise<unknown[]>;
      acceptCalibrationProfile(profile: unknown, supersedesProfileId?: string): Promise<unknown>;
      createBrowserSession(sessionId?: string): Promise<unknown>;
      listBrowserSessions(): Promise<unknown[]>;
      browserDispatch(browserSessionId: string, action: unknown, sessionId?: string): Promise<unknown>;
      browserCapture(browserSessionId: string, sessionId?: string): Promise<unknown>;
      onSessionEvent(listener: (event: unknown) => void): () => void;
      onContinuityEvent(listener: (event: unknown) => void): () => void;
      onBrowserEvent(listener: (event: unknown) => void): () => void;
    };
  }
}
