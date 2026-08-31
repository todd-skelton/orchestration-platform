import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, test, vi } from "vitest";
import {
  portablePrimitivesVerificationTests,
  runPortablePrimitivesVerification,
} from "../../scripts/conformance/portable-primitives-verification.mjs";

const root = resolve(import.meta.dirname, "../..");
describe("ISS-022 zero-argument local verification wrappers", () => {
  test.each(["probe", "receipts"] as const)(
    "runs the fixed %s test set with an advisory boundary",
    async (mode) => {
      const write = vi.fn();
      const execute = vi.fn(async () => 0);
      expect(await runPortablePrimitivesVerification([mode], execute, write)).toBe(0);
      expect(execute).toHaveBeenCalledExactlyOnceWith(portablePrimitivesVerificationTests[mode]);
      expect(write.mock.calls[0]?.[0]).toContain(
        "test success grants no capability or publication authority",
      );
      for (const path of portablePrimitivesVerificationTests[mode])
        await access(resolve(root, path));
      for (const outcome of [1, 5, null])
        expect(
          await runPortablePrimitivesVerification([mode], async () => outcome as number, write),
        ).toBe(1);
      expect(
        await runPortablePrimitivesVerification(
          [mode],
          async () => {
            throw new Error("runner failure");
          },
          write,
        ),
      ).toBe(1);
    },
  );

  test("refuses authority modes and forwarded arguments before dispatch", async () => {
    const execute = vi.fn(async () => 0);
    for (const args of [
      [],
      ["terminal"],
      ["portable-primitives-review"],
      ["probe", "--"],
      ["receipts", "path"],
      ["probe", "--update"],
    ])
      expect(await runPortablePrimitivesVerification(args, execute, vi.fn())).toBe(1);
    expect(execute).not.toHaveBeenCalled();
    const result = spawnSync(
      process.execPath,
      [
        resolve(root, "scripts/conformance/portable-primitives-verification.mts"),
        "receipts",
        "--help",
      ],
      {
        encoding: "utf8",
        windowsHide: true,
      },
    );
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("accepts no user arguments");
    expect(result.stderr).toBe("");
  });
});
