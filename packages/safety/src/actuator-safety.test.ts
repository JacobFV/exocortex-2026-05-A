import assert from "node:assert/strict";
import { defaultHeadBridgeConfig, validateActuatorCommand } from "@exocortex/hardware";
import { ActuatorSafetyDenialError, ActuatorSafetyGate } from "./actuator-safety.js";

const config = defaultHeadBridgeConfig();
const gate = ActuatorSafetyGate.fromHeadBridgeConfig(config);

assert.throws(
  () => gate.validate("laser_enable", validateActuatorCommand(config, "laser_enable", { enabled: true, duty: 1 }), new Date("2026-05-19T00:00:00.000Z")),
  /not armed/
);

const grant = gate.arm("laser_enable", "bench alignment", new Date("2026-05-19T00:00:00.000Z"));
assert.equal(grant.channel, "laser_enable");
assert.doesNotThrow(() =>
  gate.validate("laser_enable", validateActuatorCommand(config, "laser_enable", { enabled: true, duty: 1 }), new Date("2026-05-19T00:00:01.000Z"))
);
assert.throws(
  () => gate.validate("ultrasound_trigger", validateActuatorCommand(config, "ultrasound_trigger", { enabled: true, duty: 1, pulse_us: 20000 }), new Date("2026-05-19T00:00:00.000Z")),
  /maxPulseUs/
);
assert.ok(gate.listPolicies().some((policy) => policy.channel === "ultrasound_trigger" && policy.requiresArm));

const graphBackedGate = ActuatorSafetyGate.fromHeadBridgeConfig(config, {
  listActiveGrants: (channel, now) =>
    channel === "laser_enable" && now < new Date("2026-05-19T00:01:00.000Z")
      ? [
          {
            channel,
            reason: "accepted continuity grant",
            armedAt: "2026-05-19T00:00:10.000Z",
            expiresAt: "2026-05-19T00:01:00.000Z"
          }
        ]
      : []
});
assert.doesNotThrow(() =>
  graphBackedGate.validate("laser_enable", validateActuatorCommand(config, "laser_enable", { enabled: true, duty: 1 }), new Date("2026-05-19T00:00:20.000Z"))
);
assert.throws(
  () => graphBackedGate.validate("laser_enable", validateActuatorCommand(config, "laser_enable", { enabled: true, duty: 1 }), new Date("2026-05-19T00:02:00.000Z")),
  /not armed/
);

const approvalOptionalGate = ActuatorSafetyGate.fromHeadBridgeConfig(config);
approvalOptionalGate.arm("laser_enable", "legacy caller", new Date("2026-05-19T01:00:00.000Z"));
assert.doesNotThrow(() =>
  approvalOptionalGate.validate("laser_enable", validateActuatorCommand(config, "laser_enable", { enabled: true, duty: 1 }), new Date("2026-05-19T01:00:01.000Z"))
);

const approvalGate = ActuatorSafetyGate.fromHeadBridgeConfig(config, undefined, { requireApprovals: true, approvalDurationMs: 5_000 });
const laserOn = validateActuatorCommand(config, "laser_enable", { enabled: true, duty: 1 });
approvalGate.arm("laser_enable", "bench alignment", new Date("2026-05-19T02:00:00.000Z"));
assert.throws(() => approvalGate.validate("laser_enable", laserOn, new Date("2026-05-19T02:00:01.000Z")), /valid pre-execution approval is required/);
const approvalDenial = approvalGate.listDenials("laser_enable")[0];
assert.equal(approvalDenial?.code, "approval_required");
assert.equal(approvalDenial?.approvalRequired, true);

const pendingApproval = approvalGate.createApproval("laser_enable", "single operator check", {
  approvalId: "approval_laser_1",
  requestedBy: "operator",
  command: laserOn,
  now: new Date("2026-05-19T02:00:02.000Z")
});
assert.equal(pendingApproval.state, "pending");
assert.throws(() => approvalGate.validate("laser_enable", laserOn, new Date("2026-05-19T02:00:03.000Z")), /valid pre-execution approval is required/);

const approved = approvalGate.approveApproval("approval_laser_1", "safety_officer", "verified beam stop", new Date("2026-05-19T02:00:04.000Z"));
assert.equal(approved.state, "approved");
assert.equal(approvalGate.listActiveApprovals("laser_enable", new Date("2026-05-19T02:00:04.500Z")).length, 1);
assert.doesNotThrow(() => approvalGate.validate("laser_enable", laserOn, new Date("2026-05-19T02:00:05.000Z")));

const revoked = approvalGate.revokeApproval("approval_laser_1", "safety_officer", "operator left bench", new Date("2026-05-19T02:00:06.000Z"));
assert.equal(revoked.state, "revoked");
assert.equal(revoked.revocationReason, "operator left bench");
assert.throws(() => approvalGate.approveApproval("approval_laser_1", "safety_officer", "restore", new Date("2026-05-19T02:00:06.500Z")), /operator left bench/);
assert.throws(() => approvalGate.validate("laser_enable", laserOn, new Date("2026-05-19T02:00:07.000Z")), /valid pre-execution approval is required/);
assert.equal(approvalGate.listApprovals(new Date("2026-05-19T02:00:07.000Z")).find((approval) => approval.approvalId === "approval_laser_1")?.revocationReason, "operator left bench");

const expiringApproval = approvalGate.createApproval("laser_enable", "short approval", {
  approvalId: "approval_laser_2",
  expiresAt: "2026-05-19T02:00:08.000Z",
  now: new Date("2026-05-19T02:00:07.000Z")
});
approvalGate.approveApproval("approval_laser_2", "safety_officer", "brief test", new Date("2026-05-19T02:00:07.250Z"));
assert.equal(approvalGate.expireApproval("approval_laser_2", "test window closed", new Date("2026-05-19T02:00:07.500Z")).expirationReason, "test window closed");
assert.equal(approvalGate.listActiveApprovals("laser_enable", new Date("2026-05-19T02:00:07.750Z")).length, 0);

const approvalWithoutArmGate = ActuatorSafetyGate.fromHeadBridgeConfig(config, undefined, { requireApprovals: true });
approvalWithoutArmGate.createApproval("laser_enable", "approval does not replace arm", {
  approvalId: "approval_without_arm",
  now: new Date("2026-05-19T02:30:00.000Z")
});
approvalWithoutArmGate.approveApproval("approval_without_arm", "safety_officer", "approved but not armed", new Date("2026-05-19T02:30:01.000Z"));
assert.throws(() => approvalWithoutArmGate.validate("laser_enable", laserOn, new Date("2026-05-19T02:30:02.000Z")), /not armed/);

const commandScopedGate = ActuatorSafetyGate.fromHeadBridgeConfig(config, undefined, { requireApprovals: true });
const lowDutyLaser = validateActuatorCommand(config, "laser_enable", { enabled: true, duty: 0.25 });
commandScopedGate.arm("laser_enable", "command scope", new Date("2026-05-19T03:00:00.000Z"));
commandScopedGate.createApproval("laser_enable", "low duty only", {
  approvalId: "approval_low_duty",
  command: lowDutyLaser,
  now: new Date("2026-05-19T03:00:01.000Z")
});
commandScopedGate.approveApproval("approval_low_duty", "safety_officer", "low duty accepted", new Date("2026-05-19T03:00:02.000Z"));
assert.doesNotThrow(() => commandScopedGate.validate("laser_enable", lowDutyLaser, new Date("2026-05-19T03:00:03.000Z")));
assert.throws(() => commandScopedGate.validate("laser_enable", laserOn, new Date("2026-05-19T03:00:04.000Z")), /valid pre-execution approval is required/);

const externalApprovalGate = ActuatorSafetyGate.fromHeadBridgeConfig(config, undefined, {
  requireApprovals: true,
  approvalReader: {
    listActiveApprovals: (channel, now) =>
      channel === "laser_enable" && now < new Date("2026-05-19T04:01:00.000Z")
        ? [
            {
              approvalId: "external_approval",
              channel,
              reason: "accepted graph approval",
              requestedAt: "2026-05-19T04:00:00.000Z",
              approvedAt: "2026-05-19T04:00:01.000Z",
              approvedBy: "continuity",
              approvalReason: "operator approved in graph",
              state: "approved",
              expiresAt: "2026-05-19T04:01:00.000Z"
            }
          ]
        : []
  }
});
externalApprovalGate.arm("laser_enable", "graph-backed approval", new Date("2026-05-19T04:00:00.000Z"));
assert.doesNotThrow(() => externalApprovalGate.validate("laser_enable", laserOn, new Date("2026-05-19T04:00:02.000Z")));
assert.throws(() => externalApprovalGate.validate("laser_enable", laserOn, new Date("2026-05-19T04:01:01.000Z")), ActuatorSafetyDenialError);
