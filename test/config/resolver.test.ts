import { pathToFileURL } from "node:url";

import { describe, expect, test } from "vitest";

import { computeConfigurationPathToken } from "../../packages/contracts/src/index.js";
import {
  projectConfigurationPaths,
  projectConfigurationProvenance,
  resolveConfigurationFromAdmittedPaths,
  type ConfigurationResolutionSuccess,
  type ConfigurationResolverOperatingSystem,
} from "../../packages/config/src/resolver.js";

const projectId = "018f0f4d-7b2d-7a11-8a2b-123456789abc";

interface TestInvocation {
  environment: {
    HOME: string | null;
    LOCALAPPDATA: string | null;
    ORCHESTRATION_CONFIG: string | null;
    ORCHESTRATION_PROJECT_ROOT: string | null;
    ORCHESTRATION_STATE_ROOT: string | null;
    XDG_STATE_HOME: string | null;
  };
  flags: {
    configPath: string | null;
    projectRoot: string | null;
    stateRoot: string | null;
  };
  operatingSystem: ConfigurationResolverOperatingSystem;
}

function fileUrl(path: string, operatingSystem: ConfigurationResolverOperatingSystem): string {
  return pathToFileURL(path, { windows: operatingSystem === "WINDOWS" }).href;
}

function source(
  stateRoot: string | null,
  operatingSystem: ConfigurationResolverOperatingSystem = "LINUX",
) {
  return {
    adapterId: "fixture.adapter",
    capabilityNames: ["cap.read", "cap.write"],
    leaseFreshnessMs: 30_000,
    maximumSessionMs: 3_600_000,
    projectId,
    schemaVersion: "platform-configuration-source/v1",
    stateRoot: stateRoot === null ? null : fileUrl(stateRoot, operatingSystem),
    wallClockSkewMs: 1_000,
  };
}

function invocation(operatingSystem: ConfigurationResolverOperatingSystem): TestInvocation {
  return {
    environment: {
      HOME: operatingSystem === "WINDOWS" ? "C:\\Users\\fixture" : "/Users/fixture",
      LOCALAPPDATA: operatingSystem === "WINDOWS" ? "C:\\Users\\fixture\\AppData\\Local" : null,
      ORCHESTRATION_CONFIG: null,
      ORCHESTRATION_PROJECT_ROOT: null,
      ORCHESTRATION_STATE_ROOT: null,
      XDG_STATE_HOME: operatingSystem === "LINUX" ? "/var/lib/fixture-state" : null,
    },
    flags: { configPath: null, projectRoot: null, stateRoot: null },
    operatingSystem,
  };
}

function admittedPaths(operatingSystem: ConfigurationResolverOperatingSystem, stateRoot: string) {
  const projectRoot = operatingSystem === "WINDOWS" ? "C:\\work\\fixture" : "/work/fixture";
  return {
    configPath:
      operatingSystem === "WINDOWS"
        ? `${projectRoot}\\.orchestration\\project.json`
        : `${projectRoot}/.orchestration/project.json`,
    projectRoot,
    stateRoot,
    stateRootDisposition: "ABSENT" as const,
  };
}

function expectSuccess(result: ReturnType<typeof resolveConfigurationFromAdmittedPaths>) {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

function expectPathRefused(result: ReturnType<typeof resolveConfigurationFromAdmittedPaths>) {
  expect(result).toEqual({
    ok: false,
    error: {
      code: "PATH_REFUSED",
      exitCode: 3,
      message: "path refused",
      outcome: "authority-refused",
    },
  });
}

function accessor<T extends object>(input: T, name: keyof T): T {
  const copy = { ...input };
  const value = input[name];
  Object.defineProperty(copy, name, { enumerable: true, get: () => value });
  return copy;
}

describe("pure admitted configuration resolution", () => {
  test.each([
    {
      operatingSystem: "WINDOWS" as const,
      expected: `C:\\Users\\fixture\\AppData\\Local\\orchestration-platform\\${projectId}`,
    },
    {
      operatingSystem: "MACOS" as const,
      expected: `/Users/fixture/Library/Application Support/orchestration-platform/${projectId}`,
    },
    {
      operatingSystem: "LINUX" as const,
      expected: `/var/lib/fixture-state/orchestration-platform/${projectId}`,
    },
  ])("uses the exact $operatingSystem default", ({ operatingSystem, expected }) => {
    const result = expectSuccess(
      resolveConfigurationFromAdmittedPaths(
        invocation(operatingSystem),
        source(null, operatingSystem),
        admittedPaths(operatingSystem, expected),
      ),
    );
    expect(result.stateRoot).toBe(expected);
    expect(result.fieldSources.stateRoot).toBe("DEFAULT");
    expect(result.configuration.stateRoot).toBe(fileUrl(expected, operatingSystem));
  });

  test("uses HOME/.local/state only when Linux XDG_STATE_HOME is unset", () => {
    const input = invocation("LINUX");
    input.environment.XDG_STATE_HOME = null;
    input.environment.HOME = "/home/fixture";
    const expected = `/home/fixture/.local/state/orchestration-platform/${projectId}`;
    const value = expectSuccess(
      resolveConfigurationFromAdmittedPaths(input, source(null), admittedPaths("LINUX", expected)),
    );
    expect(value.stateRoot).toBe(expected);
    expect(value.fieldSources.stateRoot).toBe("DEFAULT");
  });

  test.each([
    {
      arm: "CLI",
      flag: "/state/cli",
      environment: "/state/environment",
      project: "/state/project",
    },
    {
      arm: "ENVIRONMENT",
      flag: null,
      environment: "/state/environment",
      project: "/state/project",
    },
    { arm: "PROJECT", flag: null, environment: null, project: "/state/project" },
  ] as const)(
    "applies the $arm state-root precedence arm",
    ({ arm, flag, environment, project }) => {
      const input = invocation("LINUX");
      input.flags.stateRoot = flag;
      input.environment.ORCHESTRATION_STATE_ROOT = environment;
      const selected = flag ?? environment ?? project;
      const value = expectSuccess(
        resolveConfigurationFromAdmittedPaths(
          input,
          source(project),
          admittedPaths("LINUX", selected),
        ),
      );
      expect(value.stateRoot).toBe(selected);
      expect(value.fieldSources).toEqual({
        adapterId: "PROJECT",
        capabilityNames: "PROJECT",
        leaseFreshnessMs: "PROJECT",
        maximumSessionMs: "PROJECT",
        projectId: "PROJECT",
        stateRoot: arm,
        wallClockSkewMs: "PROJECT",
      });
    },
  );

  test("refuses precedence substitution against the admitted selected root", () => {
    const input = invocation("LINUX");
    input.flags.stateRoot = "/state/cli";
    input.environment.ORCHESTRATION_STATE_ROOT = "/state/environment";
    expect(
      resolveConfigurationFromAdmittedPaths(
        input,
        source("/state/project"),
        admittedPaths("LINUX", "/state/environment"),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "PATH_REFUSED",
        exitCode: 3,
        message: "path refused",
        outcome: "authority-refused",
      },
    });
  });

  test.each(["WINDOWS", "LINUX"] as const)(
    "binds CLI, environment, default, and lower project/config precedence on %s",
    (operatingSystem) => {
      const windows = operatingSystem === "WINDOWS";
      const stateRoot = windows ? "C:\\state\\project" : "/state/project";
      const cliProject = windows ? "C:\\selected\\cli-project" : "/selected/cli-project";
      const cliConfig = windows ? "C:\\selected\\cli.json" : "/selected/cli.json";
      const environmentProject = windows
        ? "C:\\selected\\environment-project"
        : "/selected/environment-project";
      const environmentConfig = windows
        ? "C:\\selected\\environment.json"
        : "/selected/environment.json";
      const substitutedProject = windows ? "C:\\substituted\\project" : "/substituted/project";
      const substitutedConfig = windows
        ? "C:\\substituted\\project.json"
        : "/substituted/project.json";

      const cli = invocation(operatingSystem);
      cli.flags.projectRoot = cliProject;
      cli.flags.configPath = cliConfig;
      cli.environment.ORCHESTRATION_PROJECT_ROOT = environmentProject;
      cli.environment.ORCHESTRATION_CONFIG = environmentConfig;
      const cliPaths = {
        ...admittedPaths(operatingSystem, stateRoot),
        projectRoot: cliProject,
        configPath: cliConfig,
      };
      const cliValue = expectSuccess(
        resolveConfigurationFromAdmittedPaths(cli, source(stateRoot, operatingSystem), cliPaths),
      );
      expect(cliValue.projectRoot).toBe(cliProject);
      expect(cliValue.configPath).toBe(cliConfig);
      expectPathRefused(
        resolveConfigurationFromAdmittedPaths(cli, source(stateRoot, operatingSystem), {
          ...cliPaths,
          projectRoot: substitutedProject,
        }),
      );
      expectPathRefused(
        resolveConfigurationFromAdmittedPaths(cli, source(stateRoot, operatingSystem), {
          ...cliPaths,
          projectRoot: environmentProject,
          configPath: environmentConfig,
        }),
      );

      const environment = invocation(operatingSystem);
      environment.environment.ORCHESTRATION_PROJECT_ROOT = environmentProject;
      environment.environment.ORCHESTRATION_CONFIG = environmentConfig;
      const environmentPaths = {
        ...admittedPaths(operatingSystem, stateRoot),
        projectRoot: environmentProject,
        configPath: environmentConfig,
      };
      expectSuccess(
        resolveConfigurationFromAdmittedPaths(
          environment,
          source(stateRoot, operatingSystem),
          environmentPaths,
        ),
      );
      expectPathRefused(
        resolveConfigurationFromAdmittedPaths(environment, source(stateRoot, operatingSystem), {
          ...environmentPaths,
          configPath: substitutedConfig,
        }),
      );

      const defaults = admittedPaths(operatingSystem, stateRoot);
      expectSuccess(
        resolveConfigurationFromAdmittedPaths(
          invocation(operatingSystem),
          source(stateRoot, operatingSystem),
          defaults,
        ),
      );
      expectPathRefused(
        resolveConfigurationFromAdmittedPaths(
          invocation(operatingSystem),
          source(stateRoot, operatingSystem),
          { ...defaults, configPath: substitutedConfig },
        ),
      );
    },
  );

  test("returns one exact deeply frozen success value", () => {
    const stateRoot = "/state/project";
    const paths = admittedPaths("LINUX", stateRoot);
    const value = expectSuccess(
      resolveConfigurationFromAdmittedPaths(invocation("LINUX"), source(stateRoot), paths),
    );
    expect(Object.keys(value).sort()).toEqual([
      "configPath",
      "configuration",
      "fieldSources",
      "projectRoot",
      "stateRoot",
      "stateRootDisposition",
    ]);
    expect(value).toEqual({
      configuration: {
        adapterId: "fixture.adapter",
        capabilityNames: ["cap.read", "cap.write"],
        leaseFreshnessMs: 30_000,
        maximumSessionMs: 3_600_000,
        projectId,
        schemaVersion: "platform-configuration/v1",
        stateRoot: "file:///state/project",
        wallClockSkewMs: 1_000,
      },
      configPath: paths.configPath,
      fieldSources: {
        adapterId: "PROJECT",
        capabilityNames: "PROJECT",
        leaseFreshnessMs: "PROJECT",
        maximumSessionMs: "PROJECT",
        projectId: "PROJECT",
        stateRoot: "PROJECT",
        wallClockSkewMs: "PROJECT",
      },
      projectRoot: paths.projectRoot,
      stateRoot,
      stateRootDisposition: "ABSENT",
    });
    expect(Object.isFrozen(value)).toBe(true);
    expect(Object.isFrozen(value.configuration)).toBe(true);
    expect(Object.isFrozen(value.configuration.capabilityNames)).toBe(true);
    expect(Object.isFrozen(value.fieldSources)).toBe(true);
  });

  test.each([
    ["extra invocation", () => ({ ...invocation("LINUX"), extra: true })],
    ["invocation proxy", () => new Proxy(invocation("LINUX"), {})],
    [
      "flags accessor",
      () => ({
        ...invocation("LINUX"),
        flags: accessor(invocation("LINUX").flags, "stateRoot"),
      }),
    ],
    [
      "flags extra",
      () => ({
        ...invocation("LINUX"),
        flags: { ...invocation("LINUX").flags, extra: null },
      }),
    ],
    [
      "empty flag",
      () => ({
        ...invocation("LINUX"),
        flags: { ...invocation("LINUX").flags, configPath: "" },
      }),
    ],
    ["unknown OS", () => ({ ...invocation("LINUX"), operatingSystem: "AIX" })],
  ] as const)("maps malformed %s to the exact argv row", (_name, makeInput) => {
    expect(
      resolveConfigurationFromAdmittedPaths(
        makeInput(),
        source("/state/project"),
        admittedPaths("LINUX", "/state/project"),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "ARGV_REFUSED",
        exitCode: 2,
        message: "command line refused",
        outcome: "invalid-input",
      },
    });
  });

  test.each([
    ["environment proxy", () => new Proxy(invocation("LINUX").environment, {})],
    ["environment accessor", () => accessor(invocation("LINUX").environment, "HOME")],
    ["environment extra", () => ({ ...invocation("LINUX").environment, PATH: "/bin" })],
    ["empty environment member", () => ({ ...invocation("LINUX").environment, HOME: "" })],
  ] as const)("maps malformed %s to the exact configuration row", (_name, environment) => {
    expect(
      resolveConfigurationFromAdmittedPaths(
        { ...invocation("LINUX"), environment: environment() },
        source("/state/project"),
        admittedPaths("LINUX", "/state/project"),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "CONFIG_REFUSED",
        exitCode: 2,
        message: "configuration refused",
        outcome: "invalid-input",
      },
    });
  });

  test("refuses malformed authenticated source without leaking parser details", () => {
    const result = resolveConfigurationFromAdmittedPaths(
      invocation("LINUX"),
      { ...source("/state/project"), extra: "canary" },
      admittedPaths("LINUX", "/state/project"),
    );
    expect(result).toEqual({
      ok: false,
      error: {
        code: "CONFIG_REFUSED",
        exitCode: 2,
        message: "configuration refused",
        outcome: "invalid-input",
      },
    });
    expect(JSON.stringify(result)).not.toContain("canary");
  });

  test.each([
    [
      "relative flag",
      () => ({
        ...invocation("LINUX"),
        flags: { ...invocation("LINUX").flags, configPath: "relative.json" },
      }),
    ],
    [
      "selected environment path",
      () => ({
        ...invocation("LINUX"),
        environment: {
          ...invocation("LINUX").environment,
          ORCHESTRATION_PROJECT_ROOT: "relative",
        },
      }),
    ],
    [
      "relative default base",
      () => ({
        ...invocation("LINUX"),
        environment: { ...invocation("LINUX").environment, XDG_STATE_HOME: "relative" },
      }),
    ],
  ] as const)("maps %s to the exact path row", (_name, makeInput) => {
    expect(
      resolveConfigurationFromAdmittedPaths(
        makeInput(),
        source(null),
        admittedPaths("LINUX", "/unused"),
      ),
    ).toEqual({
      ok: false,
      error: {
        code: "PATH_REFUSED",
        exitCode: 3,
        message: "path refused",
        outcome: "authority-refused",
      },
    });
  });

  test("refuses missing default base and non-round-tripping paths", () => {
    const missing = invocation("LINUX");
    missing.environment.HOME = null;
    missing.environment.XDG_STATE_HOME = null;
    expect(
      resolveConfigurationFromAdmittedPaths(
        missing,
        source(null),
        admittedPaths("LINUX", "/unused"),
      ),
    ).toMatchObject({ ok: false, error: { code: "PATH_REFUSED" } });

    const selected = invocation("LINUX");
    selected.flags.stateRoot = "/state/../escape";
    expect(
      resolveConfigurationFromAdmittedPaths(
        selected,
        source(null),
        admittedPaths("LINUX", "/state/../escape"),
      ),
    ).toMatchObject({ ok: false, error: { code: "PATH_REFUSED" } });

    expect(
      resolveConfigurationFromAdmittedPaths(invocation("LINUX"), source("/state/project"), {
        ...admittedPaths("LINUX", "/state/project"),
        projectRoot: "relative",
      }),
    ).toMatchObject({ ok: false, error: { code: "PATH_REFUSED" } });
  });
});

describe("redacted durable configuration projections", () => {
  function resolved(operatingSystem: ConfigurationResolverOperatingSystem) {
    const stateRoot = operatingSystem === "WINDOWS" ? "C:\\state\\project" : "/state/project";
    return expectSuccess(
      resolveConfigurationFromAdmittedPaths(
        invocation(operatingSystem),
        source(stateRoot, operatingSystem),
        admittedPaths(operatingSystem, stateRoot),
      ),
    );
  }

  test.each(["WINDOWS", "MACOS", "LINUX"] as const)(
    "projects exact fixed-framed path tokens on %s",
    (operatingSystem) => {
      const value = resolved(operatingSystem);
      const provenance = projectConfigurationProvenance(value);
      const paths = projectConfigurationPaths(value);
      expect(provenance.ok).toBe(true);
      expect(paths.ok).toBe(true);
      if (!provenance.ok || !paths.ok) throw new Error("projection refused");
      const windows = operatingSystem === "WINDOWS";
      expect(provenance.value).toEqual({
        adapterId: "fixture.adapter",
        capabilityNames: ["cap.read", "cap.write"],
        fieldSources: value.fieldSources,
        leaseFreshnessMs: 30_000,
        maximumSessionMs: 3_600_000,
        projectId,
        projectRoot: computeConfigurationPathToken(
          pathToFileURL(value.projectRoot, { windows }).href,
        ),
        schemaVersion: "configuration-provenance/v1",
        stateRoot: computeConfigurationPathToken(pathToFileURL(value.stateRoot, { windows }).href),
        wallClockSkewMs: 1_000,
      });
      expect(paths.value).toEqual({
        configPath: computeConfigurationPathToken(
          pathToFileURL(value.configPath, { windows }).href,
        ),
        projectRoot: computeConfigurationPathToken(
          pathToFileURL(value.projectRoot, { windows }).href,
        ),
        schemaVersion: "configuration-paths/v1",
        stateRoot: computeConfigurationPathToken(pathToFileURL(value.stateRoot, { windows }).href),
      });
      const durableBytes = JSON.stringify([provenance.value, paths.value]);
      for (const rawPath of [value.configPath, value.projectRoot, value.stateRoot])
        expect(durableBytes).not.toContain(rawPath);
      expect(Object.isFrozen(provenance.value)).toBe(true);
      expect(Object.isFrozen(paths.value)).toBe(true);
    },
  );

  test("refuses extra, mixed-family, and state-URL substitution mutants", () => {
    const value = resolved("LINUX");
    expect(
      projectConfigurationPaths({
        ...value,
        extra: true,
      } as ConfigurationResolutionSuccess).ok,
    ).toBe(false);
    expect(
      projectConfigurationPaths({
        ...value,
        stateRoot: "C:\\state",
      } as ConfigurationResolutionSuccess).ok,
    ).toBe(false);
    expect(
      projectConfigurationProvenance({
        ...value,
        configuration: { ...value.configuration, stateRoot: "file:///state/substituted" },
      } as ConfigurationResolutionSuccess).ok,
    ).toBe(false);
  });
});
