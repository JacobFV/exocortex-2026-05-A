#pragma once

#include <Arduino.h>

struct AnalogMuxChannel {
  uint8_t index;
  const char* key;
  const char* unit;
  float scale;
  float offset;
  uint16_t sampleCount;
};

struct AnalogMuxConfig {
  const char* id;
  uint8_t signalPin;
  const uint8_t* selectPins;
  uint8_t selectPinCount;
  int8_t enablePin;
  uint16_t settleMicros;
  const AnalogMuxChannel* channels;
  uint8_t channelCount;
};

struct AdcChannelConfig {
  const char* key;
  uint8_t pin;
  const char* unit;
  float scale;
  float offset;
  uint16_t sampleCount;
};

enum class ActuatorKind : uint8_t {
  Digital,
  Pwm,
  Laser,
  Headlamp,
  Haptic,
  UltrasoundTrigger
};

struct ActuatorConfig {
  const char* key;
  uint8_t pin;
  ActuatorKind kind;
  bool activeHigh;
  int8_t pwmChannel;
  uint32_t pwmFrequency;
  uint8_t pwmResolutionBits;
  float maxDuty;
};

static const uint8_t MUX0_SELECT_PINS[] = {25, 26, 27, 14};

static const AnalogMuxChannel MUX0_CHANNELS[] = {
  {0, "eeg_ch_0_raw", "microvolts", 1.0f, 0.0f, 4},
  {1, "eeg_ch_1_raw", "microvolts", 1.0f, 0.0f, 4},
  {2, "skin_temp_raw", "celsius", 0.01f, 0.0f, 8},
  {3, "ambient_light_raw", "lux", 1.0f, 0.0f, 4}
};

static const AnalogMuxConfig MUXES[] = {
  {"mux_0", 34, MUX0_SELECT_PINS, 4, -1, 20, MUX0_CHANNELS, 4}
};

static const AdcChannelConfig ADC_CHANNELS[] = {
  {"battery_voltage", 35, "volts", 0.001f, 0.0f, 8}
};

static const ActuatorConfig ACTUATORS[] = {
  {"headlamp_pwm", 18, ActuatorKind::Headlamp, true, 0, 1000, 10, 0.8f},
  {"laser_enable", 19, ActuatorKind::Laser, true, -1, 0, 0, 1.0f},
  {"haptic_pwm", 21, ActuatorKind::Haptic, true, 1, 200, 10, 1.0f},
  {"ultrasound_trigger", 22, ActuatorKind::UltrasoundTrigger, true, -1, 0, 0, 1.0f}
};

static constexpr uint32_t BAUD_RATE = 115200;
static constexpr uint32_t HEARTBEAT_MS = 1000;
static constexpr uint32_t SCAN_INTERVAL_MS = 20;
static constexpr uint8_t ANALOG_RESOLUTION_BITS = 12;
