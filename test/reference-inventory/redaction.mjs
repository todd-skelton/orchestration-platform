import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { resolvePnpmLauncher } from "../../scripts/pnpm-launcher.mjs";
import {
  buildPublicationFingerprints,
  loadInventory,
  publicationStreamFingerprints,
  publicationValueFingerprints,
  validateInventory,
} from "./inventory.mjs";
import { parseLiveArguments } from "./source-evidence.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const execFileAsync = promisify(execFile);
const publicDigest = /^[a-f0-9]{40}$|^[a-f0-9]{64}$/;
const sourceMarkers = [
  "reference-source-census/",
  "reference-artifact-inventory/",
  "reference-behavior-families/",
  "reference-entrypoint-census/",
  "reference-mutation-census/",
  "reference-authority-inventory/",
  "reference-recovery-transitions/",
  "reference-assumption-inventory/",
  "reference-forbidden-vocabulary/",
];
const sourceContentMarkers = [
  /"artifactId"\s*:\s*"artifact-\d{3}"/,
  /"familyRoot"\s*:/,
  /"behaviorFamilyIds"\s*:/,
  /"mutationGroupId"\s*:/,
  /"authorityRoot"\s*:/,
  /"requiredObservation"\s*:/,
  /"transitionRoot"\s*:/,
  /"recoveryTransitionId"\s*:/,
  /"assumptionRoot"\s*:/,
  /"vocabularyRoot"\s*:/,
  /"sourcePathCensus"\s*:/,
];
const copyWindow = 160;
const maximumDecodedScalarCharacters = 4096;
const maximumEncodedScalarCharacters = 32768;
const maximumStreamScalarTokens = 65536;
const maximumStreamRelationshipSpan = 8;
const maximumTemplateCandidates = 256;
const maximumTemplateInterpolations = 16;
const maximumTemplateAlternativesPerInterpolation = 16;
const maximumLiteralSeparatorCharacters = 4096;
const backslash = String.fromCharCode(92);
const uncClass = `[a-z0-9][a-z0-9._-]*`;
const uncSeparator = `[${backslash.repeat(2)}/]`;
const uncPathPattern = new RegExp(
  `(?:^|[${backslash}s"'(=])${backslash.repeat(4)}${uncClass}${uncSeparator}${uncClass}`,
  "im",
);

function fail(message) {
  throw new Error(`REFERENCE_REDACTION_MISMATCH: ${message}`);
}

function forbiddenDigest(value) {
  return createHash("sha256")
    .update("forbidden-vocabulary/v1\0")
    .update(value.normalize("NFKC").toLowerCase())
    .update("\0")
    .digest("hex");
}

function tokenCandidates(value) {
  const normalized = value.normalize("NFKC").toLowerCase();
  const result = new Set();
  for (const match of normalized.matchAll(/[a-z0-9]+(?:[._:@/-][a-z0-9]+)*/g)) {
    result.add(match[0]);
  }
  const words = normalized.match(/[a-z0-9]+/g) ?? [];
  for (let start = 0; start < words.length; start += 1) {
    for (let length = 1; length <= 4 && start + length <= words.length; length += 1) {
      const span = words.slice(start, start + length);
      for (const separator of [" ", "-", ""]) result.add(span.join(separator));
    }
  }
  return result;
}

function pathDigest(domain, value) {
  return createHash("sha256").update(`${domain}\0`).update(value).update("\0").digest("hex");
}

function sourcePathFindings(value, oracle) {
  if (!oracle) return [];
  const findings = new Set();
  const normalizedText = value.normalize("NFKC").toLowerCase();
  const textComponents = new Set(normalizedText.match(/[a-z0-9_.-]*[a-z0-9][a-z0-9_.-]*/g) ?? []);
  for (const component of [...textComponents]) {
    const punctuationTrimmed = component.replace(/^[._-]+|[._-]+$/g, "");
    if (punctuationTrimmed) textComponents.add(punctuationTrimmed);
  }
  for (const component of textComponents) {
    if (oracle.sensitiveComponents.has(pathDigest("reference-source-path-component/v1", component)))
      findings.add("source-path-component");
  }
  for (const token of normalizedText.match(/[a-z0-9]+/g) ?? []) {
    if (oracle.sensitiveTokens.has(pathDigest("reference-source-path-token/v1", token)))
      findings.add("source-path-token");
  }
  const candidates = [
    ...(normalizedText.match(/[a-z0-9_.-]+(?:[\\/][a-z0-9_.-]+)+/g) ?? []),
    ...(normalizedText.match(/\b[a-z0-9][a-z0-9._-]*\.[a-z0-9]{1,8}\b/g) ?? []),
  ];
  for (const candidate of candidates) {
    const components = candidate.replaceAll("\\", "/").split("/").filter(Boolean);
    const tokens = components.flatMap((component) => component.match(/[a-z0-9]+/g) ?? []);
    for (let start = 0; start < components.length; start += 1) {
      for (let length = 1; start + length <= components.length; length += 1) {
        const span = components.slice(start, start + length).join("/");
        if (
          oracle.rawPaths.has(pathDigest("reference-artifact-path/v1", span)) ||
          oracle.normalizedPaths.has(pathDigest("reference-source-path-normalized/v1", span))
        ) {
          findings.add("source-relative-path");
        }
      }
    }
    for (const component of components) {
      if (
        oracle.sensitiveComponents.has(pathDigest("reference-source-path-component/v1", component))
      )
        findings.add("source-path-component");
    }
    for (const token of tokens) {
      if (oracle.sensitiveTokens.has(pathDigest("reference-source-path-token/v1", token)))
        findings.add("source-path-token");
    }
    for (let start = 0; start < tokens.length; start += 1) {
      for (let length = 2; length <= 4 && start + length <= tokens.length; length += 1) {
        const ngram = tokens.slice(start, start + length).join("/");
        if (oracle.ngrams.has(pathDigest("reference-source-path-ngram/v1", ngram))) {
          findings.add("source-path-ngram");
        }
      }
    }
  }
  return [...findings];
}

function textFindings(value, forbiddenDigests, pathOracle) {
  const findings = [];
  for (const candidate of tokenCandidates(value)) {
    if (forbiddenDigests.has(forbiddenDigest(candidate))) findings.push("forbidden-vocabulary");
  }
  if (
    /(?:^|[^a-z])[a-z]:[\\/][^\s"'`]+/im.test(value) ||
    /(?:^|[^a-z])\/(?:users|home)\/[^\s/]+\//im.test(value) ||
    /(?:^|[\s"'(=])\/(?:etc|mnt|opt|private|root|srv|tmp|usr|var)(?:\/[a-z0-9._-]+)+/im.test(
      value,
    ) ||
    uncPathPattern.test(value) ||
    /(?:^|[\s"'(=])(?:~|\$(?:home|userprofile)|\$\{(?:home|userprofile)\}|\$env:(?:home|userprofile)|%(?:home|userprofile)%)(?:[\\/][^\s"'`]+)+/im.test(
      value,
    )
  ) {
    findings.push("absolute-local-path");
  }
  if (
    /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(value) ||
    /\b(?:gh[pousr]_[A-Za-z0-9_]{24,}|AKIA[A-Z0-9]{16})\b/.test(value) ||
    /\b(?:password|secret|credential|access(?:[\s._-]*token)|api(?:[\s._-]*key)|client(?:[\s._-]*secret)|bearer)(?:\s*[:=._-]\s*|\s+)["']?[a-z0-9][a-z0-9._~+/=-]{11,}["']?(?=$|[^a-z0-9._~+/=-])/i.test(
      value,
    )
  ) {
    findings.push("credential-or-secret");
  }
  const highEntropy = value.match(/[A-Za-z0-9+/=_-]{48,}/g) ?? [];
  if (
    highEntropy.some(
      (candidate) =>
        !publicDigest.test(candidate.toLowerCase()) &&
        /[A-Z]/.test(candidate) &&
        /[a-z]/.test(candidate) &&
        /\d/.test(candidate),
    )
  ) {
    findings.push("high-entropy-canary");
  }
  findings.push(...sourcePathFindings(value, pathOracle));
  return [...new Set(findings)];
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

function canonicalTokensFromText(value) {
  return value.match(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:e[+-]?\d+)?|true|false|null/gi) ?? [];
}

function decodeEscapedContent(content) {
  let result = "";
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character !== "\\") {
      result += character;
      if (result.length > maximumDecodedScalarCharacters) return { status: "overflow", value: "" };
      continue;
    }
    index += 1;
    if (index >= content.length) return { status: "invalid", value: "" };
    const escaped = content[index];
    const simple = { b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", 0: "\0" };
    if (escaped === "\n") {
      continue;
    } else if (escaped === "\r") {
      if (content[index + 1] === "\n") index += 1;
      continue;
    } else if (Object.hasOwn(simple, escaped)) {
      result += simple[escaped];
    } else if (escaped === "u" && content[index + 1] === "{") {
      const close = content.indexOf("}", index + 2);
      if (close < 0) return { status: "invalid", value: "" };
      const digits = content.slice(index + 2, close);
      if (!/^[a-f0-9]{1,6}$/i.test(digits)) return { status: "invalid", value: "" };
      const codePoint = Number.parseInt(digits, 16);
      if (codePoint > 0x10ffff) return { status: "invalid", value: "" };
      result += String.fromCodePoint(codePoint);
      index = close;
    } else if (escaped === "u" || escaped === "x") {
      const length = escaped === "u" ? 4 : 2;
      const digits = content.slice(index + 1, index + 1 + length);
      if (!new RegExp(`^[a-f0-9]{${length}}$`, "i").test(digits))
        return { status: "invalid", value: "" };
      result += String.fromCodePoint(Number.parseInt(digits, 16));
      index += length;
    } else {
      result += escaped;
    }
    if (result.length > maximumDecodedScalarCharacters) return { status: "overflow", value: "" };
  }
  return { status: "valid", value: result };
}

function decodeOrdinaryQuotedScalar(token) {
  if (token.length > maximumEncodedScalarCharacters) return { status: "overflow", values: [] };
  const quote = token[0];
  if ((quote !== '"' && quote !== "'") || token.at(-1) !== quote)
    return { status: "invalid", values: [] };
  const complete =
    quote === '"'
      ? /^"(?:\\(?:\r\n|[\s\S])|[^"\\])*"$/.test(token)
      : /^'(?:\\(?:\r\n|[\s\S])|[^'\\])*'$/.test(token);
  if (!complete) return { status: "invalid", values: [] };
  const decoded = decodeEscapedContent(token.slice(1, -1));
  return {
    status: decoded.status,
    values: decoded.status === "valid" ? [decoded.value] : [],
  };
}

function interpolationEnd(token, start) {
  let depth = 1;
  let quote;
  for (let index = start; index < token.length - 1; index += 1) {
    const character = token[index];
    if (quote) {
      if (character === "\\") {
        if (token[index + 1] === "\r" && token[index + 2] === "\n") index += 2;
        else index += 1;
      } else if (character === quote) {
        quote = undefined;
      }
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function quotedScalarsFromExpression(expression) {
  const pieces = [];
  const pattern = /"(?:\\(?:\r\n|[\s\S])|[^"\\])*"|'(?:\\(?:\r\n|[\s\S])|[^'\\])*'/g;
  for (const match of expression.matchAll(pattern)) {
    const decoded = decodeOrdinaryQuotedScalar(match[0]);
    if (decoded.status === "overflow") return decoded;
    if (decoded.status === "valid") pieces.push(...decoded.values);
  }
  let alternatives = new Set([""]);
  for (const piece of pieces) {
    const expanded = new Set(alternatives);
    for (const candidate of alternatives) {
      const combined = candidate + piece;
      if (combined.length > maximumDecodedScalarCharacters)
        return { status: "overflow", values: [] };
      expanded.add(combined);
      if (expanded.size > maximumTemplateAlternativesPerInterpolation)
        return { status: "overflow", values: [] };
    }
    alternatives = expanded;
  }
  return { status: "valid", values: [...alternatives] };
}

function compactLiteralSeparator(separator) {
  if (separator.length > maximumLiteralSeparatorCharacters) return { status: "overflow" };
  let compact = "";
  let index = 0;
  while (index < separator.length) {
    if (/\s/.test(separator[index])) {
      index += 1;
    } else if (separator.startsWith("/*", index)) {
      const close = separator.indexOf("*/", index + 2);
      if (close < 0) return { status: "invalid" };
      index = close + 2;
    } else if (separator.startsWith("//", index)) {
      const lineEnd = separator.slice(index + 2).search(/[\r\n]/);
      if (lineEnd < 0) return { status: "invalid" };
      index += lineEnd + 2;
    } else {
      compact += separator[index];
      index += 1;
    }
  }
  return { status: "valid", compact };
}

function decodeIdentifierEscapes(value) {
  let decoded = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== "\\") {
      if (!/[a-z0-9_$]/i.test(value[index])) return { status: "invalid" };
      decoded += value[index];
      continue;
    }
    if (value[index + 1] !== "u") return { status: "invalid" };
    let digits;
    if (value[index + 2] === "{") {
      const close = value.indexOf("}", index + 3);
      if (close < 0) return { status: "invalid" };
      digits = value.slice(index + 3, close);
      if (!/^[a-f0-9]{1,6}$/i.test(digits)) return { status: "invalid" };
      index = close;
    } else {
      digits = value.slice(index + 2, index + 6);
      if (!/^[a-f0-9]{4}$/i.test(digits)) return { status: "invalid" };
      index += 5;
    }
    const codePoint = Number.parseInt(digits, 16);
    if (codePoint > 0x10ffff) return { status: "invalid" };
    const character = String.fromCodePoint(codePoint);
    if (!/[a-z0-9_$]/i.test(character)) return { status: "invalid" };
    decoded += character;
  }
  return { status: "valid", value: decoded };
}

function literalConcatenationSeparator(separator, concatOpen) {
  const compacted = compactLiteralSeparator(separator);
  if (compacted.status !== "valid") return compacted;
  const compact = compacted.compact;
  const method = /^(\)*)\.([^()]*)\(/.exec(compact);
  if (method) {
    const decodedMethod = decodeIdentifierEscapes(method[2]);
    if (decodedMethod.status !== "valid") return decodedMethod;
    if (decodedMethod.value !== "concat") {
      if (concatOpen) return { status: "invalid" };
      return { status: "valid", concatenates: false, concatOpen: false };
    }
    const argumentPrefix = compact.slice(method[0].length);
    if (!/^\(*$/.test(argumentPrefix)) return { status: "invalid" };
    if (concatOpen && method[1].length === 0) return { status: "invalid" };
    return { status: "valid", concatenates: true, concatOpen: true };
  }
  const concatArgument = /^(\)*),(\(*)$/.exec(compact);
  if (concatArgument) {
    if (!concatOpen) return { status: "valid", concatenates: false, concatOpen: false };
    return { status: "valid", concatenates: true, concatOpen: true };
  }
  const plus = /^(\)*)\+(\(*)$/.exec(compact);
  if (plus) {
    if (concatOpen && plus[1].length === 0) return { status: "invalid" };
    return { status: "valid", concatenates: true, concatOpen: false };
  }
  if (compact.includes(".concat(") || (concatOpen && !compact.startsWith(")")))
    return { status: "invalid" };
  return {
    status: "valid",
    concatenates: false,
    concatOpen: false,
    closesConcat: concatOpen && compact.startsWith(")"),
  };
}

function decodeTemplateScalar(token) {
  if (token.length > maximumEncodedScalarCharacters) return { status: "overflow", values: [] };
  if (token[0] !== "`" || token.at(-1) !== "`") return { status: "invalid", values: [] };
  let candidates = [""];
  let interpolationCount = 0;
  let segmentStart = 1;
  let index = 1;
  while (index < token.length - 1) {
    if (token[index] === "\\") {
      index += token[index + 1] === "\r" && token[index + 2] === "\n" ? 3 : 2;
      continue;
    }
    if (token[index] !== "$" || token[index + 1] !== "{") {
      index += 1;
      continue;
    }
    const literal = decodeEscapedContent(token.slice(segmentStart, index));
    if (literal.status !== "valid") return { status: literal.status, values: [] };
    candidates = candidates.map((candidate) => candidate + literal.value);
    const close = interpolationEnd(token, index + 2);
    if (close < 0) return { status: "invalid", values: [] };
    interpolationCount += 1;
    if (interpolationCount > maximumTemplateInterpolations)
      return { status: "overflow", values: [] };
    const expression = token.slice(index + 2, close).trim();
    const decodedExpression = decodeOrdinaryQuotedScalar(expression);
    if (decodedExpression.status === "overflow") return decodedExpression;
    let alternatives;
    if (decodedExpression.status === "valid") {
      alternatives = decodedExpression.values;
    } else {
      const quoted = quotedScalarsFromExpression(expression);
      if (quoted.status === "overflow") return quoted;
      alternatives = quoted.values;
    }
    if (alternatives.length > maximumTemplateAlternativesPerInterpolation)
      return { status: "overflow", values: [] };
    const expanded = new Set();
    for (const candidate of candidates) {
      for (const alternative of alternatives) {
        const combined = candidate + alternative;
        if (combined.length > maximumDecodedScalarCharacters)
          return { status: "overflow", values: [] };
        expanded.add(combined);
        if (expanded.size > maximumTemplateCandidates) return { status: "overflow", values: [] };
      }
    }
    candidates = [...expanded];
    index = close + 1;
    segmentStart = index;
  }
  const tail = decodeEscapedContent(token.slice(segmentStart, -1));
  if (tail.status !== "valid") return { status: tail.status, values: [] };
  candidates = candidates.map((candidate) => candidate + tail.value);
  if (candidates.some((candidate) => candidate.length > maximumDecodedScalarCharacters))
    return { status: "overflow", values: [] };
  return { status: "valid", values: candidates };
}

function decodeQuotedScalar(token) {
  return token[0] === "`" ? decodeTemplateScalar(token) : decodeOrdinaryQuotedScalar(token);
}

function scalarValuesFromText(text) {
  const values = [];
  const quotedTokens = [];
  const pattern =
    /"(?:\\(?:\r\n|[\s\S])|[^"\\])*"|'(?:\\(?:\r\n|[\s\S])|[^'\\])*'|`(?:\\(?:\r\n|[\s\S])|[^`\\])*`|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:e[+-]?\d+)?|\b(?:true|false|null)\b/gi;
  for (const match of text.matchAll(pattern)) {
    const token = match[0];
    const start = match.index;
    const end = start + token.length;
    if (
      /^[-\d]/.test(token) &&
      ((start > 0 && /[a-z0-9_$]/i.test(text[start - 1])) ||
        (end < text.length && /[a-z0-9_$]/i.test(text[end])))
    )
      continue;
    if (/^["'`]/.test(token)) {
      const decoded = decodeQuotedScalar(token);
      if (decoded.status === "overflow") return { values: [], overflow: true };
      if (token[0] === "`" && decoded.status === "invalid") return { values: [], overflow: true };
      if (decoded.status === "valid") {
        values.push(...decoded.values);
        quotedTokens.push({ start, end, values: decoded.values });
      }
    } else if (/^true$/i.test(token)) {
      values.push(true);
    } else if (/^false$/i.test(token)) {
      values.push(false);
    } else if (/^null$/i.test(token)) {
      values.push(null);
    } else {
      const number = Number(token);
      if (Number.isFinite(number)) values.push(number);
    }
    if (values.length > maximumStreamScalarTokens) {
      return { values: [], overflow: true };
    }
  }
  let chain = [];
  const appendChain = () => {
    if (chain.length < 2) return true;
    if (chain.length > maximumTemplateInterpolations) return false;
    let candidates = [""];
    for (const token of chain) {
      const expanded = new Set();
      for (const candidate of candidates) {
        for (const alternative of token.values) {
          const combined = candidate + alternative;
          if (combined.length > maximumDecodedScalarCharacters) return false;
          expanded.add(combined);
          if (expanded.size > maximumTemplateCandidates) return false;
        }
      }
      candidates = [...expanded];
    }
    values.push(...candidates);
    return values.length <= maximumStreamScalarTokens;
  };
  let concatOpen = false;
  for (const token of quotedTokens) {
    const previous = chain.at(-1);
    const separator = previous
      ? literalConcatenationSeparator(text.slice(previous.end, token.start), concatOpen)
      : undefined;
    if (separator?.status !== undefined && separator.status !== "valid")
      return { values: [], overflow: true };
    if (previous && separator.concatenates) {
      chain.push(token);
      concatOpen = separator.concatOpen;
    } else {
      if (concatOpen && !separator.closesConcat) return { values: [], overflow: true };
      if (!appendChain()) return { values: [], overflow: true };
      chain = [token];
      concatOpen = false;
    }
  }
  if (concatOpen && quotedTokens.length > 0) {
    const tail = literalConcatenationSeparator(text.slice(quotedTokens.at(-1).end), concatOpen);
    if (tail.status !== "valid" || !tail.closesConcat) return { values: [], overflow: true };
  }
  if (!appendChain()) return { values: [], overflow: true };
  return { values, overflow: false };
}

function streamFingerprintFinding(text, oracle) {
  const { values, overflow } = scalarValuesFromText(text);
  if (overflow) return true;
  for (const value of values) {
    const fingerprints = publicationStreamFingerprints([value]);
    if (
      fingerprints.strongScalarDigests.some((digestValue) =>
        oracle.strongScalarDigests.has(digestValue),
      )
    )
      return true;
  }
  for (let left = 0; left < values.length; left += 1) {
    const limit = Math.min(values.length, left + maximumStreamRelationshipSpan + 1);
    for (let right = left + 1; right < limit; right += 1) {
      const fingerprints = publicationStreamFingerprints([values[left], values[right]]);
      if (
        fingerprints.streamRelationshipDigests.some((digestValue) =>
          oracle.streamRelationshipDigests.has(digestValue),
        )
      )
        return true;
    }
  }
  if (oracle.streamArities.has(values.length)) {
    const fingerprints = publicationStreamFingerprints(values);
    if (oracle.streamRowDigests.has(fingerprints.streamRowDigest)) return true;
  }
  return false;
}

function digestParts(domain, parts) {
  const hash = createHash("sha256").update(`${domain}\0`);
  for (const part of parts) hash.update(part).update("\0");
  return hash.digest("hex");
}

function collectJsonObjects(value, result = []) {
  if (!value || typeof value !== "object") return result;
  if (!Array.isArray(value)) result.push(value);
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    collectJsonObjects(child, result);
  }
  return result;
}

function publicationFingerprintFinding(text, oracle) {
  if (!oracle) return false;
  try {
    const parsed = JSON.parse(text);
    for (const row of collectJsonObjects(parsed)) {
      const canonical = JSON.stringify(stableValue(row));
      if (oracle.rowDigests.has(pathDigest("reference-publication-row/v1", canonical))) return true;
      const fingerprints = publicationValueFingerprints(row);
      if (
        oracle.valueRowDigests.has(fingerprints.valueRowDigest) ||
        fingerprints.relationshipDigests.some((digestValue) =>
          oracle.relationshipDigests.has(digestValue),
        ) ||
        fingerprints.strongScalarDigests.some((digestValue) =>
          oracle.strongScalarDigests.has(digestValue),
        )
      )
        return true;
    }
  } catch {
    // Canonical chunks below intentionally cover valid fragments and non-JSON bundles.
  }
  if (streamFingerprintFinding(text, oracle)) return true;
  const tokens = canonicalTokensFromText(text);
  for (let offset = 0; offset + 6 <= tokens.length; offset += 1) {
    if (
      oracle.chunkDigests.has(
        digestParts("reference-publication-chunk/v1", tokens.slice(offset, offset + 6)),
      )
    )
      return true;
  }
  return false;
}

function containsInventoryMaterial(value, publicationOracle) {
  const text = Buffer.isBuffer(value) ? value.toString("utf8") : value;
  return (
    sourceMarkers.some((marker) => text.includes(marker)) ||
    sourceContentMarkers.some((pattern) => pattern.test(text)) ||
    publicationFingerprintFinding(text, publicationOracle)
  );
}

function buildPublicationOracle(snapshot) {
  const {
    rowDigests,
    chunkDigests,
    valueRowDigests,
    relationshipDigests,
    strongScalarDigests,
    streamRowDigests,
    streamRelationshipDigests,
    streamArities,
  } = buildPublicationFingerprints(snapshot);
  return {
    rowDigests,
    chunkDigests,
    valueRowDigests,
    relationshipDigests,
    strongScalarDigests,
    streamRowDigests,
    streamRelationshipDigests,
    streamArities,
  };
}

async function collectFiles(path) {
  const entries = await readdir(path, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const files = [];
  for (const entry of entries) {
    const child = resolve(path, entry.name);
    if (entry.isSymbolicLink()) fail("ISS-001 surface contains a symbolic link");
    if (entry.isDirectory()) files.push(...(await collectFiles(child)));
    if (entry.isFile()) files.push(child);
  }
  return files;
}

async function runPnpm(args, cwd) {
  const launcher = await resolvePnpmLauncher();
  return execFileAsync(launcher.executable, [...launcher.prefixArgs, ...args], {
    cwd,
    windowsHide: true,
    maxBuffer: 32 * 1024 * 1024,
  });
}

function parsePackResult(stdout) {
  const start = stdout.indexOf("{");
  if (start < 0) fail("package pack did not emit JSON");
  return JSON.parse(stdout.slice(start));
}

async function readTarball(path) {
  const archive = gunzipSync(await readFile(path));
  const files = [];
  for (let offset = 0; offset + 512 <= archive.length;) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const text = (start, length) =>
      header
        .subarray(start, start + length)
        .toString("utf8")
        .replace(/\0.*$/s, "");
    const name = [text(345, 155), text(0, 100)].filter(Boolean).join("/");
    const size = Number.parseInt(text(124, 12).trim() || "0", 8);
    const type = text(156, 1);
    if (!Number.isSafeInteger(size) || size < 0) fail("package archive size is malformed");
    offset += 512;
    if (type === "" || type === "0")
      files.push([name.replace(/^package\//, ""), archive.subarray(offset, offset + size)]);
    offset += Math.ceil(size / 512) * 512;
  }
  return files;
}

function validatePackedFile(path, bytes, forbiddenDigests, pathOracle, publicationOracle) {
  if (/^(?:reference|test)\//.test(path)) fail("package archive contains reference/test evidence");
  const findings = textFindings(`${path}\n${bytes.toString("utf8")}`, forbiddenDigests, pathOracle);
  if (findings.length > 0) fail(`package archive ${path} contains ${findings.join(",")}`);
  if (containsInventoryMaterial(bytes, publicationOracle)) {
    fail("package archive contains reference inventory material");
  }
}

async function packageManifests(root) {
  const result = [];
  for (const base of ["packages", "adapters"]) {
    for (const entry of await readdir(resolve(root, base), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const manifest = JSON.parse(
        await readFile(resolve(root, base, entry.name, "package.json"), "utf8"),
      );
      result.push(manifest.name);
    }
  }
  return result.sort();
}

async function scanPackedSurfaces(root, forbiddenDigests, pathOracle, publicationOracle) {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "orchestration-reference-pack-"));
  let fileCount = 0;
  try {
    for (const name of await packageManifests(root)) {
      const destination = resolve(temporaryRoot, createHash("sha256").update(name).digest("hex"));
      const packed = parsePackResult(
        (
          await runPnpm(
            ["--filter", name, "pack", "--pack-destination", destination, "--json"],
            root,
          )
        ).stdout,
      );
      for (const [path, bytes] of await readTarball(packed.filename)) {
        fileCount += 1;
        validatePackedFile(path, bytes, forbiddenDigests, pathOracle, publicationOracle);
      }
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  return fileCount;
}

async function scanBuiltSurfaces(
  root,
  forbiddenDigests,
  pathOracle,
  artifactDigests,
  publicationOracle,
) {
  await runPnpm(["run", "build"], root);
  const configuration = JSON.parse(
    await readFile(resolve(root, "config/private-compositions.json"), "utf8"),
  );
  const paths = [
    ...configuration.targets.map(({ output }) => output),
    "modules/.generated/registry.ts",
  ];
  for (const path of paths) {
    const bytes = await readFile(resolve(root, path));
    const text = bytes.toString("utf8");
    validateBuiltText(text, forbiddenDigests, pathOracle, artifactDigests, publicationOracle);
  }
  return paths.length;
}

function validateBuiltText(
  text,
  forbiddenDigests,
  pathOracle,
  artifactDigests = [],
  publicationOracle,
) {
  const findings = textFindings(text, forbiddenDigests, pathOracle);
  if (findings.length > 0) fail(`built surface contains ${findings.join(",")}`);
  if (
    containsInventoryMaterial(text, publicationOracle) ||
    artifactDigests.some((value) => text.includes(value))
  ) {
    fail("built surface contains reference inventory material");
  }
}

function normalizedCopyText(text) {
  return Buffer.from(
    text.normalize("NFKC").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim(),
    "utf8",
  );
}

function overlappingChunks(text) {
  const normalized = normalizedCopyText(text);
  const result = new Set();
  for (let offset = 0; offset + copyWindow <= normalized.length; offset += 1) {
    result.add(
      createHash("sha256")
        .update(normalized.subarray(offset, offset + copyWindow))
        .digest("hex"),
    );
  }
  return result;
}

function copiedSourceBytes(sourceTexts, targetTexts) {
  const targetChunks = new Set(targetTexts.flatMap((text) => [...overlappingChunks(text)]));
  return sourceTexts.some((text) =>
    [...overlappingChunks(text)].some((digest) => targetChunks.has(digest)),
  );
}

async function git(repository, args, encoding = "utf8") {
  return (
    await execFileAsync("git", ["-C", repository, ...args], {
      encoding,
      windowsHide: true,
      maxBuffer: 64 * 1024 * 1024,
    })
  ).stdout;
}

function verifyLivePathProbes(sourcePaths, oracle) {
  const fullPaths = new Map();
  const components = new Map();
  const tokens = new Map();
  const ngrams = new Map();
  for (const sourcePath of sourcePaths) {
    const normalized = sourcePath.normalize("NFKC").toLowerCase().replaceAll("\\", "/");
    const pathComponents = normalized.split("/").filter(Boolean);
    const pathTokens = pathComponents.flatMap((component) => component.match(/[a-z0-9]+/g) ?? []);
    fullPaths.set(pathDigest("reference-artifact-path/v1", normalized), normalized);
    for (const component of pathComponents)
      components.set(pathDigest("reference-source-path-component/v1", component), component);
    for (const token of pathTokens)
      tokens.set(pathDigest("reference-source-path-token/v1", token), token);
    for (let start = 0; start < pathTokens.length; start += 1) {
      for (let length = 2; length <= 4 && start + length <= pathTokens.length; length += 1) {
        const ngram = pathTokens.slice(start, start + length).join("/");
        ngrams.set(pathDigest("reference-source-path-ngram/v1", ngram), ngram);
      }
    }
  }
  for (const value of fullPaths.values()) {
    if (!sourcePathFindings(value.toUpperCase(), oracle).includes("source-relative-path"))
      fail("live full source-path probe evaded the hashed oracle");
  }
  for (const digestValue of oracle.sensitiveComponents) {
    const value = components.get(digestValue);
    if (!value) fail("live sensitive component probe is absent from source evidence");
    for (const probe of [value, value.toUpperCase(), `ordinary ${value} text`]) {
      if (!textFindings(probe, new Set(), oracle).includes("source-path-component"))
        fail("live sensitive component probe evaded the hashed oracle");
    }
  }
  for (const digestValue of oracle.sensitiveTokens) {
    const value = tokens.get(digestValue);
    if (!value) fail("live sensitive token probe is absent from source evidence");
    for (const probe of [value, value.toUpperCase(), `ordinary ${value} text`]) {
      if (!textFindings(probe, new Set(), oracle).includes("source-path-token"))
        fail("live sensitive token probe evaded the hashed oracle");
    }
  }
  for (const value of ngrams.values()) {
    if (
      !sourcePathFindings(`boundary/${value.toUpperCase()}/boundary`, oracle).includes(
        "source-path-ngram",
      )
    )
      fail("live source-path ngram probe evaded the hashed oracle");
  }
  return {
    liveFullPathProbeCount: fullPaths.size,
    liveSensitiveComponentProbeCount: oracle.sensitiveComponents.size,
    liveComponentCollisionCount: oracle.componentCollisions.size,
    liveSensitiveTokenProbeCount: oracle.sensitiveTokens.size,
    liveTokenCollisionCount: oracle.tokenCollisions.size,
    liveNgramProbeCount: ngrams.size,
  };
}

async function compareSourceChunks(live, targetTexts, pathOracle) {
  const exact = (await git(live.repository, ["rev-parse", `${live.commit}^{commit}`])).trim();
  if (exact !== live.commit) fail("redaction source commit did not resolve exactly");
  const raw = await git(
    live.repository,
    ["ls-tree", "-r", "-z", live.commit, "--", live.subtree],
    "buffer",
  );
  const targetChunks = new Set(targetTexts.flatMap((text) => [...overlappingChunks(text)]));
  let sourceChunkCount = 0;
  const sourcePaths = [];
  const prefix = `${live.subtree.replace(/\/$/, "")}/`;
  for (const record of raw.subarray(0, -1).toString("utf8").split("\0")) {
    const tab = record.indexOf("\t");
    const header = record.slice(0, tab).split(" ");
    if (header[1] !== "blob") continue;
    const sourcePath = record.slice(tab + 1);
    if (!sourcePath.startsWith(prefix)) fail("live redaction tree escaped its selected subtree");
    sourcePaths.push(sourcePath.slice(prefix.length));
    const bytes = await git(live.repository, ["cat-file", "blob", header[2]], "buffer");
    for (const digest of overlappingChunks(bytes.toString("utf8"))) {
      sourceChunkCount += 1;
      if (targetChunks.has(digest)) fail("ISS-001 surface contains copied source bytes");
    }
  }
  return {
    liveSourceChunkCount: sourceChunkCount,
    ...verifyLivePathProbes(sourcePaths, pathOracle),
  };
}

function buildPathOracle(snapshot) {
  const entries = snapshot["redaction-oracle"].sourcePathCensus.entries;
  const sensitivity = snapshot["redaction-oracle"].sourcePathCensus.sensitivity;
  const arbitraryTextComponentCollisions = new Set(
    sensitivity.arbitraryTextComponentCollisionDigests,
  );
  const arbitraryTextTokenCollisions = new Set(sensitivity.arbitraryTextTokenCollisionDigests);
  return {
    rawPaths: new Set(entries.map(({ pathDigest: value }) => value)),
    normalizedPaths: new Set(entries.map(({ normalizedPathDigest }) => normalizedPathDigest)),
    sensitiveComponents: new Set(
      sensitivity.sensitiveComponentDigests.filter(
        (value) => !arbitraryTextComponentCollisions.has(value),
      ),
    ),
    componentCollisions: new Set([
      ...sensitivity.componentCollisionDigests,
      ...arbitraryTextComponentCollisions,
    ]),
    sensitiveTokens: new Set(
      sensitivity.sensitiveTokenDigests.filter((value) => !arbitraryTextTokenCollisions.has(value)),
    ),
    tokenCollisions: new Set([
      ...sensitivity.tokenCollisionDigests,
      ...arbitraryTextTokenCollisions,
    ]),
    ngrams: new Set(entries.flatMap(({ ngramDigests }) => ngramDigests)),
  };
}

export async function runRedaction(root = defaultRoot, live) {
  const snapshot = await loadInventory(root);
  validateInventory(snapshot);
  const forbiddenDigests = new Set(
    snapshot["redaction-oracle"].entries.map(({ digest }) => digest),
  );
  const pathOracle = buildPathOracle(snapshot);
  const publicationOracle = buildPublicationOracle(snapshot);
  const surfaceRoots = [
    resolve(root, "reference/manifest"),
    resolve(root, "test/reference-inventory"),
    resolve(root, "test/capability-slots/ISS-001"),
  ];
  const surfaceFiles = [];
  for (const path of surfaceRoots) surfaceFiles.push(...(await collectFiles(path)));
  const targetTexts = [];
  for (const path of surfaceFiles) {
    const text = await readFile(path, "utf8");
    targetTexts.push(text);
    const findings = textFindings(`${relative(root, path)}\n${text}`, forbiddenDigests, pathOracle);
    if (findings.length > 0) {
      fail(`ISS-001 surface ${relative(root, path)} contains ${findings.join(",")}`);
    }
  }
  const artifactDigests = snapshot.artifacts.artifacts.flatMap(({ pathDigest, contentDigest }) => [
    pathDigest,
    contentDigest,
  ]);
  const packageFileCount = await scanPackedSurfaces(
    root,
    forbiddenDigests,
    pathOracle,
    publicationOracle,
  );
  const builtSurfaceCount = await scanBuiltSurfaces(
    root,
    forbiddenDigests,
    pathOracle,
    artifactDigests,
    publicationOracle,
  );
  const liveEvidence = live ? await compareSourceChunks(live, targetTexts, pathOracle) : {};
  return {
    scannedSurfaceFiles: surfaceFiles.length,
    packageFileCount,
    builtSurfaceCount,
    ...liveEvidence,
  };
}

export async function runRedactionCli(argv, root = defaultRoot) {
  const live = parseLiveArguments(argv);
  const summary = await runRedaction(root, live);
  process.stdout.write(
    `${JSON.stringify({ schemaVersion: "reference-redaction-check/v1", outcome: "success", ...summary })}\n`,
  );
}

export const redactionTestApi = Object.freeze({
  buildPathOracle,
  buildPublicationOracle,
  containsInventoryMaterial,
  copiedSourceBytes,
  forbiddenDigest,
  pathDigest,
  textFindings,
  tokenCandidates,
  validatePackedFile,
  validateBuiltText,
});
