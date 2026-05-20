import type { ActuatorChannelConfig, HeadBridgeConfig, ValidatedActuatorCommand } from "@exocortex/hardware";

export interface ActuatorSafetyPolicy {
  channel: string;
  requiresArm: boolean;
  maxDuty: number;
  maxPulseUs?: number;
  minIntervalMs?: number;
  armDurationMs?: number;
}

export interface ActuatorArmGrant {
  channel: string;
  reason: string;
  armedAt: string;
  expiresAt: string;
}

export interface ActuatorSafetyGrantReader {
  listActiveGrants(channel: string, now: Date): ActuatorArmGrant[];
}

export class ActuatorSafetyGate {
  private readonly policies = new Map<string, ActuatorSafetyPolicy>();
  private readonly grants = new Map<string, ActuatorArmGrant>();
  private readonly lastCommandAt = new Map<string, number>();

  constructor(policies: ActuatorSafetyPolicy[], private readonly grantReader?: ActuatorSafetyGrantReader) {
    for (const policy of policies) this.policies.set(policy.channel, policy);
  }

  static fromHeadBridgeConfig(config: HeadBridgeConfig, grantReader?: ActuatorSafetyGrantReader): ActuatorSafetyGate {
    return new ActuatorSafetyGate(config.actuators.map(defaultPolicyForActuator), grantReader);
  }

  arm(channel: string, reason: string, now = new Date()): ActuatorArmGrant {
    const policy = this.requirePolicy(channel);
    const durationMs = policy.armDurationMs ?? 30_000;
    const grant: ActuatorArmGrant = {
      channel,
      reason,
      armedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + durationMs).toISOString()
    };
    this.grants.set(channel, grant);
    return grant;
  }

  validate(channel: string, command: ValidatedActuatorCommand, now = new Date()): ValidatedActuatorCommand {
    const policy = this.requirePolicy(channel);
    if (command.duty > policy.maxDuty) throw new Error(`Safety gate rejected ${channel}: duty ${command.duty} exceeds safety maxDuty ${policy.maxDuty}`);
    if (command.pulseUs !== undefined && policy.maxPulseUs !== undefined && command.pulseUs > policy.maxPulseUs) {
      throw new Error(`Safety gate rejected ${channel}: pulseUs ${command.pulseUs} exceeds safety maxPulseUs ${policy.maxPulseUs}`);
    }
    if (policy.requiresArm && command.enabled && command.duty > 0) {
      const grant = this.activeGrant(channel, now);
      if (!grant || Date.parse(grant.expiresAt) < now.getTime()) throw new Error(`Safety gate rejected ${channel}: actuator is not armed`);
    }
    if (policy.minIntervalMs) {
      const previous = this.lastCommandAt.get(channel);
      if (previous !== undefined && now.getTime() - previous < policy.minIntervalMs) {
        throw new Error(`Safety gate rejected ${channel}: minIntervalMs ${policy.minIntervalMs} not elapsed`);
      }
    }
    this.lastCommandAt.set(channel, now.getTime());
    return command;
  }

  listPolicies(): ActuatorSafetyPolicy[] {
    return [...this.policies.values()].map((policy) => ({ ...policy }));
  }

  listGrants(now = new Date()): ActuatorArmGrant[] {
    const grants = new Map<string, ActuatorArmGrant>();
    for (const grant of this.grants.values()) {
      if (Date.parse(grant.expiresAt) >= now.getTime()) grants.set(`${grant.channel}:${grant.armedAt}`, { ...grant });
    }
    for (const policy of this.policies.values()) {
      for (const grant of this.grantReader?.listActiveGrants(policy.channel, now) ?? []) {
        if (Date.parse(grant.expiresAt) >= now.getTime()) grants.set(`${grant.channel}:${grant.armedAt}`, { ...grant });
      }
    }
    return [...grants.values()];
  }

  private requirePolicy(channel: string): ActuatorSafetyPolicy {
    const policy = this.policies.get(channel);
    if (!policy) throw new Error(`No actuator safety policy for ${channel}`);
    return policy;
  }

  private activeGrant(channel: string, now: Date): ActuatorArmGrant | undefined {
    const local = this.grants.get(channel);
    if (local && Date.parse(local.expiresAt) >= now.getTime()) return local;
    return this.grantReader?.listActiveGrants(channel, now).find((grant) => Date.parse(grant.expiresAt) >= now.getTime());
  }
}

function defaultPolicyForActuator(actuator: ActuatorChannelConfig): ActuatorSafetyPolicy {
  const hazardous = actuator.kind === "laser" || actuator.kind === "ultrasound_trigger";
  return {
    channel: actuator.key,
    requiresArm: hazardous,
    maxDuty: actuator.maxDuty ?? (actuator.kind === "headlamp" ? 0.8 : 1),
    maxPulseUs: actuator.kind === "ultrasound_trigger" ? 10_000 : undefined,
    minIntervalMs: actuator.kind === "ultrasound_trigger" ? 100 : undefined,
    armDurationMs: hazardous ? 15_000 : undefined
  };
}
