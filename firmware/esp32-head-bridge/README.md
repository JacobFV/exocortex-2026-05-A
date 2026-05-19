# ESP32 Head Bridge Firmware

This firmware runs on an ESP32-class bridge mounted in the exocortex device tree.

It speaks the host serial frame protocol:

```json
{"channel":"eeg_ch_0_raw","type":"sensor.analog_sample","timestamp_ms":1234,"value":{"raw":2048,"value":2048,"unit":"microvolts","sample_count":4}}
```

Inbound actuator command:

```json
{"channel":"headlamp_pwm","type":"actuator.command","value":{"enabled":true,"duty":0.4}}
```

Build and flash with PlatformIO:

```sh
pio run -d firmware/esp32-head-bridge
pio run -d firmware/esp32-head-bridge -t upload
```

The default pin map is in `include/bridge_config.h` and matches the TypeScript default in `packages/hardware`.

`include/bridge_config.h` is generated from the TypeScript hardware model with:

```sh
npm run generate:head-bridge-config
```

Repository validation checks the generated header against the checked-in file.
