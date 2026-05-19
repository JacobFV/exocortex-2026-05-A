import type { ActuatorChannelConfig, ActuatorKind, HeadBridgeConfig } from "./head-bridge-config.js";

export function generateEsp32BridgeConfigHeader(config: HeadBridgeConfig): string {
  const lines: string[] = [
    "#pragma once",
    "",
    "#include <Arduino.h>",
    "",
    `#define EXOCORTEX_BRIDGE_ID ${cppString(config.bridgeId)}`,
    "",
    "struct AnalogMuxChannel {",
    "  uint8_t index;",
    "  const char* key;",
    "  const char* unit;",
    "  float scale;",
    "  float offset;",
    "  uint16_t sampleCount;",
    "};",
    "",
    "struct AnalogMuxConfig {",
    "  const char* id;",
    "  uint8_t signalPin;",
    "  const uint8_t* selectPins;",
    "  uint8_t selectPinCount;",
    "  int8_t enablePin;",
    "  uint16_t settleMicros;",
    "  const AnalogMuxChannel* channels;",
    "  uint8_t channelCount;",
    "};",
    "",
    "struct AdcChannelConfig {",
    "  const char* key;",
    "  uint8_t pin;",
    "  const char* unit;",
    "  float scale;",
    "  float offset;",
    "  uint16_t sampleCount;",
    "};",
    "",
    "enum class ActuatorKind : uint8_t {",
    "  Digital,",
    "  Pwm,",
    "  Laser,",
    "  Headlamp,",
    "  Haptic,",
    "  UltrasoundTrigger",
    "};",
    "",
    "struct ActuatorConfig {",
    "  const char* key;",
    "  uint8_t pin;",
    "  ActuatorKind kind;",
    "  bool activeHigh;",
    "  int8_t pwmChannel;",
    "  uint32_t pwmFrequency;",
    "  uint8_t pwmResolutionBits;",
    "  float maxDuty;",
    "};",
    ""
  ];

  config.muxes.forEach((mux, muxIndex) => {
    const prefix = `MUX${muxIndex}`;
    lines.push(`static const uint8_t ${prefix}_SELECT_PINS[] = {${mux.selectPins.join(", ")}};`, "");
    lines.push(`static const AnalogMuxChannel ${prefix}_CHANNELS[] = {`);
    lines.push(
      ...mux.channels.map((channel, index) => {
        const suffix = index === mux.channels.length - 1 ? "" : ",";
        return `  {${channel.index}, ${cppString(channel.key)}, ${cppString(channel.unit)}, ${floatLiteral(channel.scale)}, ${floatLiteral(channel.offset)}, ${channel.sampleCount}}${suffix}`;
      })
    );
    lines.push("};", "");
  });

  lines.push("static const AnalogMuxConfig MUXES[] = {");
  lines.push(
    ...config.muxes.map((mux, index) => {
      const suffix = index === config.muxes.length - 1 ? "" : ",";
      return `  {${cppString(mux.id)}, ${mux.signalPin}, MUX${index}_SELECT_PINS, ${mux.selectPins.length}, ${mux.enablePin ?? -1}, ${mux.settleMicros}, MUX${index}_CHANNELS, ${mux.channels.length}}${suffix}`;
    })
  );
  lines.push("};", "");

  lines.push("static const AdcChannelConfig ADC_CHANNELS[] = {");
  lines.push(
    ...config.adcChannels.map((channel, index) => {
      const suffix = index === config.adcChannels.length - 1 ? "" : ",";
      return `  {${cppString(channel.key)}, ${channel.pin}, ${cppString(channel.unit)}, ${floatLiteral(channel.scale)}, ${floatLiteral(channel.offset)}, ${channel.sampleCount}}${suffix}`;
    })
  );
  lines.push("};", "");

  lines.push("static const ActuatorConfig ACTUATORS[] = {");
  lines.push(
    ...config.actuators.map((actuator, index) => {
      const suffix = index === config.actuators.length - 1 ? "" : ",";
      return `  {${cppString(actuator.key)}, ${actuator.pin}, ${cppActuatorKind(actuator.kind)}, ${actuator.activeHigh ? "true" : "false"}, ${actuator.pwmChannel ?? -1}, ${actuator.pwmFrequency ?? 0}, ${actuator.pwmResolutionBits ?? 0}, ${floatLiteral(actuator.maxDuty ?? 1)}}${suffix}`;
    })
  );
  lines.push("};", "");

  lines.push(`static constexpr uint32_t BAUD_RATE = ${config.baudRate};`);
  lines.push(`static constexpr uint32_t HEARTBEAT_MS = ${config.heartbeatMs};`);
  lines.push(`static constexpr uint32_t SCAN_INTERVAL_MS = ${config.scanIntervalMs};`);
  lines.push(`static constexpr uint8_t ANALOG_RESOLUTION_BITS = ${config.analogReadResolutionBits};`);
  lines.push("");
  return `${lines.join("\n")}`;
}

function cppActuatorKind(kind: ActuatorKind): string {
  const map: Record<ActuatorKind, string> = {
    custom: "ActuatorKind::Digital",
    digital: "ActuatorKind::Digital",
    haptic: "ActuatorKind::Haptic",
    headlamp: "ActuatorKind::Headlamp",
    laser: "ActuatorKind::Laser",
    pwm: "ActuatorKind::Pwm",
    speaker_enable: "ActuatorKind::Digital",
    ultrasound_trigger: "ActuatorKind::UltrasoundTrigger"
  };
  return map[kind];
}

function cppString(value: string): string {
  return JSON.stringify(value);
}

function floatLiteral(value: number): string {
  if (!Number.isFinite(value)) throw new Error(`Cannot emit non-finite float literal: ${value}`);
  const text = Number.isInteger(value) ? `${value}.0` : `${value}`;
  return `${text}f`;
}
