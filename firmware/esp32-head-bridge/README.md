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

The `esp32s3` environment targets ESP32-S3 boards that expose USB CDC on `/dev/ttyACM*`.
It is intended for protocol bring-up on a bare devkit, so configured head I/O is disabled
and the firmware responds to serial ping/heartbeat frames without touching the production
head pin map:

```sh
pio run -d firmware/esp32-head-bridge -e esp32s3
pio run -d firmware/esp32-head-bridge -e esp32s3 -t upload --upload-port /dev/ttyACM0
node apps/hardware-cli/dist/index.js bench-smoke --port /dev/ttyACM0 --duration-ms 5000
```

The default pin map is in `include/bridge_config.h` and matches the TypeScript default in `packages/hardware`.

`include/bridge_config.h` is generated from the TypeScript hardware model with:

```sh
npm run generate:head-bridge-config
```

Repository validation checks the generated header against the checked-in file.
