import type { ActuatorChannelConfig, HeadBridgeConfig, ValidatedActuatorCommand } from "@exocortex/hardware";

export interface ActuatorSafetyPolicy {
  channel: string;
  requiresArm: boolean;
  requiresApproval?: boolean;
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

export type ActuatorCommandApprovalState = "pending" | "approved" | "revoked" | "expired";

export interface ActuatorCommandApproval {
  approvalId: string;
  channel: string;
  reason: string;
  requestedAt: string;
  requestedBy?: string;
  command?: ValidatedActuatorCommand;
  commandFingerprint?: string;
  state: ActuatorCommandApprovalState;
  approvedAt?: string;
  approvedBy?: string;
  approvalReason?: string;
  revokedAt?: string;
  revokedBy?: string;
  revocationReason?: string;
  expiredAt?: string;
  expirationReason?: string;
  expiresAt?: string;
}

export interface ActuatorCommandApprovalCreateOptions {
  approvalId?: string;
  requestedBy?: string;
  command?: ValidatedActuatorCommand;
  expiresAt?: string;
  now?: Date;
}

export interface ActuatorApprovalReader {
  listActiveApprovals(channel: string, now: Date): ActuatorCommandApproval[];
}

export type ActuatorSafetyDenialCode =
  | "no_policy"
  | "duty_exceeds_max"
  | "pulse_exceeds_max"
  | "not_armed"
  | "approval_required"
  | "min_interval_not_elapsed";

export interface ActuatorSafetyDenial {
  channel: string;
  code: ActuatorSafetyDenialCode;
  reason: string;
  occurredAt: string;
  command?: ValidatedActuatorCommand;
  approvalRequired?: boolean;
}

export interface ActuatorSafetyGateOptions {
  approvalReader?: ActuatorApprovalReader;
  approvalDurationMs?: number;
  maxDenials?: number;
  requireApprovals?: boolean;
}

export class ActuatorSafetyDenialError extends Error {
  constructor(readonly denial: ActuatorSafetyDenial) {
    super(`Safety gate rejected ${denial.channel}: ${denial.reason}`);
    this.name = "ActuatorSafetyDenialError";
  }
}

export class ActuatorSafetyGate {
  private readonly policies = new Map<string, ActuatorSafetyPolicy>();
  private readonly grants = new Map<string, ActuatorArmGrant>();
  private readonly approvals = new Map<string, ActuatorCommandApproval>();
  private readonly denials: ActuatorSafetyDenial[] = [];
  private readonly lastCommandAt = new Map<string, number>();
  private approvalSequence = 0;

  constructor(
    policies: ActuatorSafetyPolicy[],
    private readonly grantReader?: ActuatorSafetyGrantReader,
    private readonly options: ActuatorSafetyGateOptions = {}
  ) {
    for (const policy of policies) this.policies.set(policy.channel, policy);
  }

  static fromHeadBridgeConfig(config: HeadBridgeConfig, grantReader?: ActuatorSafetyGrantReader, options?: ActuatorSafetyGateOptions): ActuatorSafetyGate {
    return new ActuatorSafetyGate(config.actuators.map(defaultPolicyForActuator), grantReader, options);
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

  createApproval(channel: string, reason: string, options: ActuatorCommandApprovalCreateOptions = {}): ActuatorCommandApproval {
    this.requirePolicy(channel);
    const now = options.now ?? new Date();
    const approval: ActuatorCommandApproval = {
      approvalId: options.approvalId ?? this.nextApprovalId(channel, now),
      channel,
      reason,
      requestedAt: now.toISOString(),
      requestedBy: options.requestedBy,
      command: cloneCommand(options.command),
      commandFingerprint: options.command ? fingerprintCommand(options.command) : undefined,
      state: "pending",
      expiresAt: options.expiresAt
    };
    this.approvals.set(approval.approvalId, approval);
    return cloneApproval(approval);
  }

  approveApproval(approvalId: string, approvedBy: string, approvalReason: string, now = new Date()): ActuatorCommandApproval {
    const approval = this.requireApproval(approvalId, now);
    if (approval.state === "revoked") throw new Error(`Cannot approve actuator approval ${approvalId}: approval was revoked: ${approval.revocationReason ?? "no revocation reason recorded"}`);
    if (approval.state === "expired") throw new Error(`Cannot approve actuator approval ${approvalId}: approval expired: ${approval.expirationReason ?? "no expiration reason recorded"}`);
    if (approval.expiresAt && Date.parse(approval.expiresAt) < now.getTime()) {
      return this.expireApproval(approvalId, "approval expired before it was approved", now);
    }
    approval.state = "approved";
    approval.approvedAt = now.toISOString();
    approval.approvedBy = approvedBy;
    approval.approvalReason = approvalReason;
    approval.expiresAt ??= new Date(now.getTime() + (this.options.approvalDurationMs ?? 30_000)).toISOString();
    return cloneApproval(approval);
  }

  revokeApproval(approvalId: string, revokedBy: string, revocationReason: string, now = new Date()): ActuatorCommandApproval {
    const approval = this.requireApproval(approvalId, now);
    approval.state = "revoked";
    approval.revokedAt = now.toISOString();
    approval.revokedBy = revokedBy;
    approval.revocationReason = revocationReason;
    return cloneApproval(approval);
  }

  expireApproval(approvalId: string, expirationReason = "approval expired", now = new Date()): ActuatorCommandApproval {
    const approval = this.requireApproval(approvalId, now);
    approval.state = "expired";
    approval.expiredAt = now.toISOString();
    approval.expirationReason = expirationReason;
    return cloneApproval(approval);
  }

  validate(channel: string, command: ValidatedActuatorCommand, now = new Date()): ValidatedActuatorCommand {
    const policy = this.requirePolicy(channel, command, now);
    this.expireStaleApprovals(now);
    if (command.duty > policy.maxDuty) {
      this.reject(channel, "duty_exceeds_max", `duty ${command.duty} exceeds safety maxDuty ${policy.maxDuty}`, now, command);
    }
    if (command.pulseUs !== undefined && policy.maxPulseUs !== undefined && command.pulseUs > policy.maxPulseUs) {
      this.reject(channel, "pulse_exceeds_max", `pulseUs ${command.pulseUs} exceeds safety maxPulseUs ${policy.maxPulseUs}`, now, command);
    }
    if (policy.requiresArm && command.enabled && command.duty > 0) {
      const grant = this.activeGrant(channel, now);
      if (!grant || Date.parse(grant.expiresAt) < now.getTime()) this.reject(channel, "not_armed", "actuator is not armed", now, command);
    }
    if (this.requiresApproval(policy) && command.enabled && command.duty > 0) {
      const approval = this.activeApproval(channel, command, now);
      if (!approval) this.reject(channel, "approval_required", "valid pre-execution approval is required", now, command, true);
    }
    if (policy.minIntervalMs) {
      const previous = this.lastCommandAt.get(channel);
      if (previous !== undefined && now.getTime() - previous < policy.minIntervalMs) {
        this.reject(channel, "min_interval_not_elapsed", `minIntervalMs ${policy.minIntervalMs} not elapsed`, now, command);
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

  listApprovals(now = new Date()): ActuatorCommandApproval[] {
    this.expireStaleApprovals(now);
    const approvals = new Map<string, ActuatorCommandApproval>();
    for (const approval of this.approvals.values()) approvals.set(approval.approvalId, cloneApproval(approval));
    for (const policy of this.policies.values()) {
      for (const approval of this.options.approvalReader?.listActiveApprovals(policy.channel, now) ?? []) approvals.set(approval.approvalId, cloneApproval(approval));
    }
    return [...approvals.values()];
  }

  listActiveApprovals(channel?: string, now = new Date()): ActuatorCommandApproval[] {
    this.expireStaleApprovals(now);
    const approvals = new Map<string, ActuatorCommandApproval>();
    for (const approval of this.approvals.values()) {
      if (this.isActiveApproval(approval, now) && (!channel || approval.channel === channel)) approvals.set(approval.approvalId, cloneApproval(approval));
    }
    for (const policy of this.policies.values()) {
      if (channel && policy.channel !== channel) continue;
      for (const approval of this.options.approvalReader?.listActiveApprovals(policy.channel, now) ?? []) {
        if (this.isActiveApproval(approval, now)) approvals.set(approval.approvalId, cloneApproval(approval));
      }
    }
    return [...approvals.values()];
  }

  listDenials(channel?: string): ActuatorSafetyDenial[] {
    return this.denials.filter((denial) => !channel || denial.channel === channel).map((denial) => cloneDenial(denial));
  }

  private requirePolicy(channel: string, command?: ValidatedActuatorCommand, now = new Date()): ActuatorSafetyPolicy {
    const policy = this.policies.get(channel);
    if (!policy) this.reject(channel, "no_policy", `no actuator safety policy for ${channel}`, now, command);
    return policy;
  }

  private activeGrant(channel: string, now: Date): ActuatorArmGrant | undefined {
    const local = this.grants.get(channel);
    if (local && Date.parse(local.expiresAt) >= now.getTime()) return local;
    return this.grantReader?.listActiveGrants(channel, now).find((grant) => Date.parse(grant.expiresAt) >= now.getTime());
  }

  private activeApproval(channel: string, command: ValidatedActuatorCommand, now: Date): ActuatorCommandApproval | undefined {
    for (const approval of this.approvals.values()) {
      if (this.matchesApproval(approval, channel, command, now)) return approval;
    }
    return this.options.approvalReader?.listActiveApprovals(channel, now).find((approval) => this.matchesApproval(approval, channel, command, now));
  }

  private matchesApproval(approval: ActuatorCommandApproval, channel: string, command: ValidatedActuatorCommand, now: Date): boolean {
    if (!this.isActiveApproval(approval, now)) return false;
    if (approval.channel !== channel) return false;
    return approval.commandFingerprint === undefined || approval.commandFingerprint === fingerprintCommand(command);
  }

  private isActiveApproval(approval: ActuatorCommandApproval, now: Date): boolean {
    return approval.state === "approved" && (!approval.expiresAt || Date.parse(approval.expiresAt) >= now.getTime());
  }

  private requiresApproval(policy: ActuatorSafetyPolicy): boolean {
    return policy.requiresApproval ?? (this.options.requireApprovals === true && policy.requiresArm);
  }

  private requireApproval(approvalId: string, now: Date): ActuatorCommandApproval {
    this.expireStaleApprovals(now);
    const approval = this.approvals.get(approvalId);
    if (!approval) throw new Error(`No actuator approval ${approvalId}`);
    return approval;
  }

  private expireStaleApprovals(now: Date): void {
    for (const approval of this.approvals.values()) {
      if ((approval.state === "pending" || approval.state === "approved") && approval.expiresAt && Date.parse(approval.expiresAt) < now.getTime()) {
        approval.state = "expired";
        approval.expiredAt = now.toISOString();
        approval.expirationReason = "approval expired";
      }
    }
  }

  private reject(
    channel: string,
    code: ActuatorSafetyDenialCode,
    reason: string,
    now: Date,
    command?: ValidatedActuatorCommand,
    approvalRequired?: boolean
  ): never {
    const denial: ActuatorSafetyDenial = {
      channel,
      code,
      reason,
      occurredAt: now.toISOString(),
      command: cloneCommand(command),
      approvalRequired
    };
    this.denials.push(denial);
    const maxDenials = this.options.maxDenials ?? 1_000;
    if (this.denials.length > maxDenials) this.denials.splice(0, this.denials.length - maxDenials);
    throw new ActuatorSafetyDenialError(denial);
  }

  private nextApprovalId(channel: string, now: Date): string {
    this.approvalSequence += 1;
    return `actuator_approval:${channel}:${now.toISOString()}:${this.approvalSequence}`;
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

function cloneApproval(approval: ActuatorCommandApproval): ActuatorCommandApproval {
  return {
    ...approval,
    command: cloneCommand(approval.command)
  };
}

function cloneDenial(denial: ActuatorSafetyDenial): ActuatorSafetyDenial {
  return {
    ...denial,
    command: cloneCommand(denial.command)
  };
}

function cloneCommand(command: ValidatedActuatorCommand | undefined): ValidatedActuatorCommand | undefined {
  return command ? { ...command } : undefined;
}

function fingerprintCommand(command: ValidatedActuatorCommand): string {
  return JSON.stringify(Object.entries(command).sort(([left], [right]) => left.localeCompare(right)));
}
