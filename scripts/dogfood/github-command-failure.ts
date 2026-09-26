import { SetupOutputSanitizer } from "./setup-adapter.mjs";

// ISS-211: classify only execFile's failed-command evidence, never parsed data
// or an arbitrary Error message. Keep command echoes (which may contain a
// comment body or credentials) out of diagnostics altogether.
export class GithubCommandFailure extends Error {
  readonly transport: boolean;
  readonly preSend: boolean;

  constructor(error: unknown) {
    const value = error as { code?: unknown; stdout?: unknown; stderr?: unknown } | null;
    const stderr =
      error instanceof Error &&
      typeof value?.code === "number" &&
      value.code > 0 &&
      value.stdout === "" &&
      typeof value.stderr === "string"
        ? value.stderr.trim()
        : "";
    // A single Go HTTP request diagnostic proves a command failed before
    // acquiring data. Only DNS/connect/TLS-handshake failures prove no send.
    const request =
      /^(?:Get|Post|Patch|Put|Delete|Head) "https:\/\/api\.github\.com\/[^"\r\n]*": ([^\r\n]+)$/.exec(
        stderr,
      )?.[1];
    const preSend =
      !!request &&
      /^(?:dial tcp(?:4|6)?(?: [^\r\n]+)?: .*(?:no such host|temporary failure in name resolution|i\/o timeout|connection refused|network is unreachable)|net\/http: TLS handshake timeout)$/.test(
        request,
      );
    const transport =
      preSend ||
      (!!request &&
        /^(?:EOF|unexpected EOF|read tcp[^\r\n]*: (?:i\/o timeout|connection reset by peer)|net\/http: request canceled[^\r\n]*|context deadline exceeded[^\r\n]*)$/.test(
          request,
        )) ||
      /^(?:gh: [^\r\n]*\(HTTP 5\d\d\)|HTTP 5\d\d: [^\r\n]+ \(https:\/\/api\.github\.com\/[^\s]*\))$/.test(
        stderr,
      );
    // Category-only evidence is bounded and cannot retain a token from stderr.
    const bytes: number[] = [];
    const sanitizer = new SetupOutputSanitizer((byte) => bytes.push(byte));
    sanitizer.write(
      Buffer.from(
        preSend
          ? "GitHub connection failed before send"
          : transport
            ? "GitHub transport response unavailable"
            : "GitHub command outcome unknown",
      ),
    );
    sanitizer.end();
    super(Buffer.from(bytes).toString("utf8"));
    this.transport = transport;
    this.preSend = preSend;
  }
}
