// Observation wrapper outlives the pilot, preserving the existing CLI attempt.
import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { workerEnvironment } from "./dispatch-adapter.ts";

const snapshot = (path, value) => {
  writeFileSync(path + ".tmp", JSON.stringify(value), { flag: "wx", flush: true });
  renameSync(path + ".tmp", path);
};

const request = JSON.parse(readFileSync(process.argv[2], "utf8"));
const stdin = openSync(request.stdin, "r");
const stdout = openSync(request.stdout, "wx");
const stderr = openSync(request.stderr, "wx");
const child = spawn(request.executable, request.args, {
  windowsHide: true,
  stdio: [stdin, stdout, stderr],
  // Filter in memory at the worker boundary; never persist the inherited environment.
  env: workerEnvironment(process.env),
});
child.once("spawn", () => {
  snapshot(request.identity, { pid: child.pid });
});
child.once("error", (error) => {
  snapshot(request.done, { code: null, error: error.message });
});
child.once("exit", (code, signal) => {
  snapshot(request.done, { code, signal });
});
closeSync(stdin);
closeSync(stdout);
closeSync(stderr);
