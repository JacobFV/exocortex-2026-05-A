import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { generateEsp32BridgeConfigHeader } from "../packages/hardware/src/firmware-config.js";
import { defaultHeadBridgeConfig, validateHeadBridgeConfig } from "../packages/hardware/src/head-bridge-config.js";

const outputPath = resolve("firmware/esp32-head-bridge/include/bridge_config.h");
const config = defaultHeadBridgeConfig();
validateHeadBridgeConfig(config);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, generateEsp32BridgeConfigHeader(config), "utf8");
console.log(outputPath);
