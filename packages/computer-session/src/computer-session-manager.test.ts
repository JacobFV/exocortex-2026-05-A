import assert from "node:assert/strict";
import { createId, type ComputerAction, type ComputerProjectionFrame, type ComputerSession } from "@exocortex/protocol";
import { ComputerSessionManager, type ComputerController } from "./computer-session-manager.js";

const actions: ComputerAction[] = [];
const events: string[] = [];
const controller: ComputerController = {
  async start() {},
  async stop() {},
  async dispatch(_session: ComputerSession, action: ComputerAction) {
    actions.push(action);
  },
  async captureFrame(session: ComputerSession): Promise<ComputerProjectionFrame> {
    return {
      computerSessionId: session.id,
      modalityInstanceId: session.modalityInstanceId,
      width: 1024,
      height: 768,
      mimeType: "image/png",
      data: "frame",
      capturedAt: "2026-05-19T00:00:00.000Z"
    };
  }
};

const manager = new ComputerSessionManager(controller);
manager.subscribe((event) => events.push(event.type));
const session = await manager.create(createId("mod"));
assert.equal(session.state, "created");
const running = await manager.start(session.id);
assert.equal(running.state, "running");
const frame = await manager.dispatch(session.id, { type: "click", x: 10, y: 20 });
assert.deepEqual(actions, [{ type: "click", x: 10, y: 20 }]);
assert.equal(frame?.width, 1024);
assert.deepEqual(events, ["created", "state_changed", "state_changed", "action", "projection_frame"]);
