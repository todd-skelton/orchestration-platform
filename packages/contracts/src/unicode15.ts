const admittedRuntimeUnicodeVersions = new Set(["15.1", "16.0", "17.0"]);

// Generated from the Age=16.0 and Age=17.0 rows in the official Unicode 17
// DerivedAge.txt. Rejecting these ranges plus General_Category=Unassigned pins
// the admitted scalar repertoire to Unicode 15.1 while allowing a newer Node
// runtime to supply the normalization implementation. Unicode normalization is
// strongly stable for already assigned scalars, and the official 15.1/17.0
// UnicodeData + unconditional SpecialCasing lowercase maps are identical for
// the 15.1 repertoire.
const postUnicode15Ranges = Object.freeze([
  [0x088f, 0x088f],
  [0x0897, 0x0897],
  [0x0c5c, 0x0c5c],
  [0x0cdc, 0x0cdc],
  [0x1acf, 0x1add],
  [0x1ae0, 0x1aeb],
  [0x1b4e, 0x1b4f],
  [0x1b7f, 0x1b7f],
  [0x1c89, 0x1c8a],
  [0x20c1, 0x20c1],
  [0x2427, 0x2429],
  [0x2b96, 0x2b96],
  [0x31e4, 0x31e5],
  [0xa7cb, 0xa7cf],
  [0xa7d2, 0xa7d2],
  [0xa7d4, 0xa7d4],
  [0xa7da, 0xa7dc],
  [0xa7f1, 0xa7f1],
  [0xfbc3, 0xfbd2],
  [0xfd90, 0xfd91],
  [0xfdc8, 0xfdce],
  [0x105c0, 0x105f3],
  [0x10940, 0x10959],
  [0x10d40, 0x10d65],
  [0x10d69, 0x10d85],
  [0x10d8e, 0x10d8f],
  [0x10ec2, 0x10ec7],
  [0x10ed0, 0x10ed8],
  [0x10efa, 0x10efc],
  [0x11380, 0x11389],
  [0x1138b, 0x1138b],
  [0x1138e, 0x1138e],
  [0x11390, 0x113b5],
  [0x113b7, 0x113c0],
  [0x113c2, 0x113c2],
  [0x113c5, 0x113c5],
  [0x113c7, 0x113ca],
  [0x113cc, 0x113d5],
  [0x113d7, 0x113d8],
  [0x113e1, 0x113e2],
  [0x116d0, 0x116e3],
  [0x11b60, 0x11b67],
  [0x11bc0, 0x11be1],
  [0x11bf0, 0x11bf9],
  [0x11db0, 0x11ddb],
  [0x11de0, 0x11de9],
  [0x11f5a, 0x11f5a],
  [0x13460, 0x143fa],
  [0x16100, 0x16139],
  [0x16d40, 0x16d79],
  [0x16ea0, 0x16eb8],
  [0x16ebb, 0x16ed3],
  [0x16ff2, 0x16ff6],
  [0x187f8, 0x187ff],
  [0x18cff, 0x18cff],
  [0x18d09, 0x18d1e],
  [0x18d80, 0x18df2],
  [0x1cc00, 0x1ccfc],
  [0x1cd00, 0x1ceb3],
  [0x1ceba, 0x1ced0],
  [0x1cee0, 0x1cef0],
  [0x1e5d0, 0x1e5fa],
  [0x1e5ff, 0x1e5ff],
  [0x1e6c0, 0x1e6de],
  [0x1e6e0, 0x1e6f5],
  [0x1e6fe, 0x1e6ff],
  [0x1f6d8, 0x1f6d8],
  [0x1f777, 0x1f77a],
  [0x1f8b2, 0x1f8bb],
  [0x1f8c0, 0x1f8c1],
  [0x1f8d0, 0x1f8d8],
  [0x1fa54, 0x1fa57],
  [0x1fa89, 0x1fa8a],
  [0x1fa8e, 0x1fa8f],
  [0x1fabe, 0x1fabe],
  [0x1fac6, 0x1fac6],
  [0x1fac8, 0x1fac8],
  [0x1facd, 0x1facd],
  [0x1fadc, 0x1fadc],
  [0x1fadf, 0x1fadf],
  [0x1fae9, 0x1faea],
  [0x1faef, 0x1faef],
  [0x1fbcb, 0x1fbef],
  [0x1fbfa, 0x1fbfa],
  [0x2b73a, 0x2b73f],
  [0x2cea2, 0x2cead],
  [0x323b0, 0x33479],
] as const);

const unassigned = /\p{Cn}/u;
const windowsForbidden = /[\u0000-\u001f"*/:<>?\\|]/u;
const windowsReserved = /^(?:con|prn|aux|nul|clock\$|(?:com|lpt)(?:[1-9]|¹|²|³))(?:\.|$)/u;

export type PhysicalOperatingSystem = "DARWIN" | "LINUX" | "WINDOWS";

export type CanonicalLeafResult =
  | { readonly ok: true; readonly bytes: Uint8Array; readonly text: string }
  | { readonly ok: false; readonly issues: readonly string[] };

function invalid(issue: string): CanonicalLeafResult {
  return { ok: false, issues: Object.freeze([issue]) };
}

function isPostUnicode15(codePoint: number): boolean {
  return postUnicode15Ranges.some(([first, last]) => codePoint >= first && codePoint <= last);
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function decodeCanonicalPhysicalLeaf(
  encoded: unknown,
  operatingSystem: PhysicalOperatingSystem,
): CanonicalLeafResult {
  if (operatingSystem !== "DARWIN" && operatingSystem !== "LINUX" && operatingSystem !== "WINDOWS")
    return invalid("operatingSystem:invalid");
  if (!admittedRuntimeUnicodeVersions.has(process.versions.unicode ?? ""))
    return invalid("canonicalPhysicalLeafBytes:unicode-runtime-unadmitted");
  if (typeof encoded !== "string" || !/^[A-Za-z0-9_-]+$/.test(encoded))
    return invalid("canonicalPhysicalLeafBytes:base64url-invalid");
  const bytes = Buffer.from(encoded, "base64url");
  if (bytes.length < 1 || bytes.length > 3072 || bytes.toString("base64url") !== encoded)
    return invalid("canonicalPhysicalLeafBytes:base64url-noncanonical");
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return invalid("canonicalPhysicalLeafBytes:bom-refused");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    return invalid("canonicalPhysicalLeafBytes:utf8-invalid");
  }
  if (
    text.length === 0 ||
    unassigned.test(text) ||
    [...text].some((scalar) => isPostUnicode15(scalar.codePointAt(0)!))
  )
    return invalid("canonicalPhysicalLeafBytes:unicode15-repertoire");
  if (
    text === "." ||
    text === ".." ||
    text.includes("/") ||
    text.includes("\\") ||
    text.includes("\0") ||
    text.endsWith(".") ||
    text.endsWith(" ") ||
    /^[A-Za-z]:/.test(text) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text)
  )
    return invalid("canonicalPhysicalLeafBytes:component-invalid");
  const asciiLower = text.replace(/[A-Z]/g, (value) =>
    String.fromCharCode(value.charCodeAt(0) + 0x20),
  );
  if (
    operatingSystem === "WINDOWS" &&
    (windowsForbidden.test(text) || windowsReserved.test(asciiLower))
  )
    return invalid("canonicalPhysicalLeafBytes:windows-reserved");
  // Lower each scalar independently. This applies Unicode's unconditional
  // full lowercase mappings without admitting locale- or context-dependent
  // SpecialCasing rules such as Final_Sigma.
  const lowercase = [...text].map((scalar) => scalar.toLowerCase()).join("");
  const canonical =
    operatingSystem === "LINUX"
      ? text.normalize("NFC")
      : lowercase.normalize(operatingSystem === "DARWIN" ? "NFD" : "NFC");
  if (!sameBytes(bytes, new TextEncoder().encode(canonical)))
    return invalid("canonicalPhysicalLeafBytes:noncanonical");
  return { ok: true, bytes: Uint8Array.from(bytes), text };
}
