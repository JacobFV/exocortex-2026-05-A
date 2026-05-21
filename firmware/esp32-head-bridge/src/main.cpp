#include <Arduino.h>
#include <ArduinoJson.h>
#include "bridge_config.h"

#ifndef EXOCORTEX_DISABLE_CONFIGURED_IO
#define EXOCORTEX_DISABLE_CONFIGURED_IO 0
#endif

static String inputLine;
static uint32_t lastHeartbeatMs = 0;
static uint32_t lastScanMs = 0;

static void writeFrame(const char* channel, const char* type, JsonVariantConst value) {
  JsonDocument doc;
  doc["channel"] = channel;
  doc["type"] = type;
  doc["timestamp_ms"] = millis();
  doc["value"].set(value);
  serializeJson(doc, Serial);
  Serial.print('\n');
}

static void writeStatus(const char* type, const char* status) {
  JsonDocument value;
  value["bridge_id"] = EXOCORTEX_BRIDGE_ID;
  value["status"] = status;
  value["uptime_ms"] = millis();
  writeFrame("system", type, value.as<JsonVariantConst>());
}

static bool validDigitalPin(uint8_t pin) {
#ifdef digitalPinIsValid
  return digitalPinIsValid(pin);
#else
  return true;
#endif
}

static bool validOutputPin(uint8_t pin) {
#ifdef digitalPinCanOutput
  return digitalPinIsValid(pin) && digitalPinCanOutput(pin);
#else
  return validDigitalPin(pin);
#endif
}

static void writePinError(const char* key, const char* operation, int pin) {
  JsonDocument value;
  value["error"] = "invalid_pin";
  value["key"] = key;
  value["operation"] = operation;
  value["pin"] = pin;
  writeFrame("system", "hardware.pin_error", value.as<JsonVariantConst>());
}

static const ActuatorConfig* findActuator(const char* key) {
  for (const auto& actuator : ACTUATORS) {
    if (strcmp(actuator.key, key) == 0) return &actuator;
  }
  return nullptr;
}

static uint32_t pwmMax(const ActuatorConfig& actuator) {
  return (1UL << actuator.pwmResolutionBits) - 1UL;
}

static void configureActuators() {
  for (const auto& actuator : ACTUATORS) {
    if (!validOutputPin(actuator.pin)) {
      writePinError(actuator.key, "actuator_output", actuator.pin);
      continue;
    }
    pinMode(actuator.pin, OUTPUT);
    digitalWrite(actuator.pin, actuator.activeHigh ? LOW : HIGH);
    if (actuator.pwmChannel >= 0) {
      ledcSetup(actuator.pwmChannel, actuator.pwmFrequency, actuator.pwmResolutionBits);
      ledcAttachPin(actuator.pin, actuator.pwmChannel);
      ledcWrite(actuator.pwmChannel, 0);
    }
  }
}

static void configureMuxes() {
  for (const auto& mux : MUXES) {
    if (!validDigitalPin(mux.signalPin)) {
      writePinError(mux.id, "mux_signal", mux.signalPin);
      continue;
    }
    pinMode(mux.signalPin, INPUT);
    if (mux.enablePin >= 0) {
      if (!validOutputPin(static_cast<uint8_t>(mux.enablePin))) {
        writePinError(mux.id, "mux_enable", mux.enablePin);
        continue;
      }
      pinMode(mux.enablePin, OUTPUT);
      digitalWrite(mux.enablePin, LOW);
    }
    for (uint8_t i = 0; i < mux.selectPinCount; ++i) {
      if (!validOutputPin(mux.selectPins[i])) {
        writePinError(mux.id, "mux_select", mux.selectPins[i]);
        continue;
      }
      pinMode(mux.selectPins[i], OUTPUT);
      digitalWrite(mux.selectPins[i], LOW);
    }
  }
}

static void selectMuxChannel(const AnalogMuxConfig& mux, uint8_t index) {
  if (mux.enablePin >= 0 && validOutputPin(static_cast<uint8_t>(mux.enablePin))) digitalWrite(mux.enablePin, LOW);
  for (uint8_t bit = 0; bit < mux.selectPinCount; ++bit) {
    if (!validOutputPin(mux.selectPins[bit])) continue;
    digitalWrite(mux.selectPins[bit], (index & (1 << bit)) ? HIGH : LOW);
  }
  delayMicroseconds(mux.settleMicros);
}

static uint16_t readAveragedAnalog(uint8_t pin, uint16_t sampleCount) {
  uint32_t sum = 0;
  for (uint16_t i = 0; i < sampleCount; ++i) {
    sum += analogRead(pin);
  }
  return static_cast<uint16_t>(sum / sampleCount);
}

static void publishAnalogSample(const char* key, const char* unit, float scale, float offset, uint16_t sampleCount, uint16_t raw) {
  JsonDocument value;
  value["raw"] = raw;
  value["value"] = raw * scale + offset;
  value["unit"] = unit;
  value["sample_count"] = sampleCount;
  writeFrame(key, "sensor.analog_sample", value.as<JsonVariantConst>());
}

static void scanMuxes() {
#if EXOCORTEX_DISABLE_CONFIGURED_IO
  return;
#else
  for (const auto& mux : MUXES) {
    if (!validDigitalPin(mux.signalPin)) continue;
    for (uint8_t i = 0; i < mux.channelCount; ++i) {
      const auto& channel = mux.channels[i];
      selectMuxChannel(mux, channel.index);
      const uint16_t raw = readAveragedAnalog(mux.signalPin, channel.sampleCount);
      publishAnalogSample(channel.key, channel.unit, channel.scale, channel.offset, channel.sampleCount, raw);
    }
  }
#endif
}

static void scanAdcChannels() {
#if EXOCORTEX_DISABLE_CONFIGURED_IO
  return;
#else
  for (const auto& channel : ADC_CHANNELS) {
    if (!validDigitalPin(channel.pin)) continue;
    const uint16_t raw = readAveragedAnalog(channel.pin, channel.sampleCount);
    publishAnalogSample(channel.key, channel.unit, channel.scale, channel.offset, channel.sampleCount, raw);
  }
#endif
}

static void setActuator(const ActuatorConfig& actuator, JsonVariantConst command) {
#if EXOCORTEX_DISABLE_CONFIGURED_IO
  JsonDocument value;
  value["error"] = "configured_io_disabled";
  value["channel"] = actuator.key;
  writeFrame("system", "error", value.as<JsonVariantConst>());
  return;
#else
  if (!validOutputPin(actuator.pin)) {
    writePinError(actuator.key, "actuator_command", actuator.pin);
    return;
  }
  const bool hasEnabled = command["enabled"].is<bool>();
  const bool enabled = hasEnabled ? command["enabled"].as<bool>() : true;
  const float requestedDuty = command["duty"].is<float>() ? command["duty"].as<float>() : (enabled ? 1.0f : 0.0f);
  const float duty = constrain(requestedDuty, 0.0f, actuator.maxDuty);

  if (actuator.pwmChannel >= 0) {
    ledcWrite(actuator.pwmChannel, static_cast<uint32_t>(duty * pwmMax(actuator)));
  } else {
    const bool output = enabled && duty > 0.0f;
    digitalWrite(actuator.pin, output == actuator.activeHigh ? HIGH : LOW);
  }

  if (actuator.kind == ActuatorKind::UltrasoundTrigger && command["pulse_us"].is<uint32_t>()) {
    const uint32_t pulseUs = command["pulse_us"].as<uint32_t>();
    digitalWrite(actuator.pin, actuator.activeHigh ? HIGH : LOW);
    delayMicroseconds(pulseUs);
    digitalWrite(actuator.pin, actuator.activeHigh ? LOW : HIGH);
  }

  JsonDocument value;
  value["status"] = "ok";
  value["pin"] = actuator.pin;
  value["duty"] = duty;
  writeFrame(actuator.key, "actuator.applied", value.as<JsonVariantConst>());
#endif
}

static void handleFrame(JsonDocument& doc) {
  const char* channel = doc["channel"] | "";
  const char* type = doc["type"] | "";

  if (strcmp(type, "system.ping") == 0) {
    writeStatus("system.pong", "ok");
    return;
  }

  if (strcmp(type, "actuator.command") == 0) {
    const ActuatorConfig* actuator = findActuator(channel);
    if (!actuator) {
      JsonDocument value;
      value["error"] = "unknown_actuator";
      value["channel"] = channel;
      writeFrame("system", "error", value.as<JsonVariantConst>());
      return;
    }
    setActuator(*actuator, doc["value"]);
    return;
  }

  JsonDocument value;
  value["error"] = "unknown_frame_type";
  value["type"] = type;
  writeFrame("system", "error", value.as<JsonVariantConst>());
}

static void pollSerial() {
  while (Serial.available() > 0) {
    const char c = static_cast<char>(Serial.read());
    if (c == '\n') {
      JsonDocument doc;
      DeserializationError error = deserializeJson(doc, inputLine);
      if (error) {
        JsonDocument value;
        value["error"] = "json_parse_failed";
        value["message"] = error.c_str();
        writeFrame("system", "error", value.as<JsonVariantConst>());
      } else {
        handleFrame(doc);
      }
      inputLine = "";
    } else if (c != '\r') {
      inputLine += c;
    }
  }
}

static void publishConfig() {
  JsonDocument value;
  value["bridge_id"] = EXOCORTEX_BRIDGE_ID;
  value["analog_resolution_bits"] = ANALOG_RESOLUTION_BITS;
  value["mux_count"] = sizeof(MUXES) / sizeof(MUXES[0]);
  value["adc_channel_count"] = sizeof(ADC_CHANNELS) / sizeof(ADC_CHANNELS[0]);
  value["actuator_count"] = sizeof(ACTUATORS) / sizeof(ACTUATORS[0]);
#if EXOCORTEX_DISABLE_CONFIGURED_IO
  value["configured_io_disabled"] = true;
#else
  value["configured_io_disabled"] = false;
#endif
  writeFrame("system", "system.config", value.as<JsonVariantConst>());
}

void setup() {
  analogReadResolution(ANALOG_RESOLUTION_BITS);
  Serial.begin(BAUD_RATE);
#if EXOCORTEX_DISABLE_CONFIGURED_IO
  delay(100);
  writeStatus("system.boot", "ok");
  writeStatus("hardware.io_disabled", "ok");
  publishConfig();
#else
  configureMuxes();
  configureActuators();
  delay(100);
  writeStatus("system.boot", "ok");
  publishConfig();
#endif
}

void loop() {
  pollSerial();
  const uint32_t now = millis();
  if (now - lastScanMs >= SCAN_INTERVAL_MS) {
    lastScanMs = now;
    scanMuxes();
    scanAdcChannels();
  }
  if (now - lastHeartbeatMs >= HEARTBEAT_MS) {
    lastHeartbeatMs = now;
    writeStatus("system.heartbeat", "ok");
  }
}
