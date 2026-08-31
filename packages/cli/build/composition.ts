import process from "node:process";

import {
  createConfigurationLoader,
  createPortableConfigurationHostAdapter,
  createWindowsConfigurationHostAdapter,
} from "../../config/src/loader.js";
import { createCommandDispatcher } from "../src/dispatcher.js";
import { commandRegistry } from "../src/registry.mjs";

const operatingSystem =
  process.platform === "win32"
    ? "WINDOWS"
    : process.platform === "darwin"
      ? "MACOS"
      : process.platform === "linux"
        ? "LINUX"
        : null;
const loadConfiguration = createConfigurationLoader(
  operatingSystem === "WINDOWS"
    ? createWindowsConfigurationHostAdapter()
    : createPortableConfigurationHostAdapter(operatingSystem ?? "LINUX"),
);
const dispatch = createCommandDispatcher(commandRegistry, loadConfiguration);
const argv = Object.freeze(process.argv.slice(2));
const environment = Object.freeze({
  HOME: process.env.HOME ?? null,
  LOCALAPPDATA: process.env.LOCALAPPDATA ?? null,
  ORCHESTRATION_CONFIG: process.env.ORCHESTRATION_CONFIG ?? null,
  ORCHESTRATION_PROJECT_ROOT: process.env.ORCHESTRATION_PROJECT_ROOT ?? null,
  ORCHESTRATION_STATE_ROOT: process.env.ORCHESTRATION_STATE_ROOT ?? null,
  XDG_STATE_HOME: process.env.XDG_STATE_HOME ?? null,
});
let cwd: string | null = null;
try {
  cwd = process.cwd();
} catch {
  // A vanished working directory is refused without exposing a host path.
}
const emission = await dispatch(argv, Object.freeze({ cwd, environment, operatingSystem }));
process.exitCode = emission.exitCode;
process.stdout.write(emission.stdout, "utf8");
