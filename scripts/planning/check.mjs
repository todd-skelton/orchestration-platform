import { lstat, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { capabilitySlotName, capabilitySlotRoot } from "../capability-slots.mjs";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function fail(message) {
  throw new Error(`PLANNING_CONTRACT_MISMATCH: ${message}`);
}

function parseArray(value) {
  const body = value.trim().slice(1, -1).trim();
  if (!body) return [];
  return body
    .split(",")
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
    .filter(Boolean);
}

export function parseFrontmatter(source, file) {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) fail(`${file} has no closed frontmatter`);
  const result = {};
  const lines = match[1].split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const separator = line.indexOf(":");
    if (separator < 1) fail(`${file} has malformed frontmatter line`);
    const key = line.slice(0, separator).trim();
    let raw = line.slice(separator + 1).trim();
    if (!raw && lines[index + 1]?.trim().startsWith("[")) {
      const parts = [];
      do {
        index += 1;
        if (index >= lines.length) fail(`${file} has unterminated frontmatter array ${key}`);
        parts.push(lines[index].trim());
      } while (!lines[index].trim().endsWith("]"));
      raw = parts.join(" ");
    }
    if (!raw) fail(`${file} has empty frontmatter field ${key}`);
    if (Object.hasOwn(result, key)) fail(`${file} repeats frontmatter field ${key}`);
    result[key] = raw.startsWith("[") ? parseArray(raw) : raw.replace(/^['"]|['"]$/g, "");
  }
  return result;
}

function sameArray(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

const sha256Pattern = /^[0-9a-f]{64}$/;

function exactKeys(value, expected, subject) {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !sameArray(Object.keys(value).sort(), [...expected].sort())
  ) {
    fail(`${subject} is not a closed record`);
  }
}

function splitTopLevel(value, separator) {
  const result = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) fail("schema field descriptor has an unmatched parenthesis");
    if (character === separator && depth === 0) {
      result.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0) fail("schema field descriptor has an unmatched parenthesis");
  result.push(value.slice(start));
  return result;
}

function parseDescriptor(descriptor, subject, context) {
  if (typeof descriptor !== "string" || descriptor.length === 0 || descriptor.trim() !== descriptor) {
    fail(`${subject} has an empty or noncanonical descriptor`);
  }
  if (context.primitiveNames.has(descriptor)) return { kind: "primitive", name: descriptor };
  if (context.namedNames.has(descriptor)) return { kind: "named", name: descriptor };
  const open = descriptor.indexOf("(");
  if (open < 1 || !descriptor.endsWith(")")) fail(`${subject} has an undefined descriptor`);
  const operator = descriptor.slice(0, open);
  const body = descriptor.slice(open + 1, -1);
  const args = splitTopLevel(body, ",");
  if (operator === "literal") {
    if (args.length !== 1 || !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,127}$/.test(args[0])) {
      fail(`${subject} has an invalid literal descriptor`);
    }
    return { kind: operator, value: args[0] };
  }
  if (operator === "enum") {
    if (
      args.length === 0 ||
      args.some((value) => !/^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,63}$/.test(value)) ||
      new Set(args).size !== args.length ||
      (context.canonicalEnums !== false && !sameArray(args, [...args].sort()))
    ) {
      fail(`${subject} has an open, duplicate, or noncanonical enum`);
    }
    return { kind: operator, values: args };
  }
  if (operator === "nullable") {
    if (args.length !== 1) fail(`${subject} nullable must have one descriptor`);
    return { kind: operator, inner: parseDescriptor(args[0], subject, context) };
  }
  if (operator === "record") {
    if (args.length !== 1 || !context.schemaNames.has(args[0])) {
      fail(`${subject} references an unknown public schema`);
    }
    return { kind: operator, name: args[0] };
  }
  if (operator === "closed") {
    if (
      args.length !== 1 ||
      (!context.nestedNames.has(args[0]) && args[0] !== "position-union")
    ) {
      fail(`${subject} references an unknown closed nested descriptor`);
    }
    return { kind: operator, name: args[0] };
  }
  if (operator === "array") {
    if (args.length !== 4 && args.length !== 5) {
      fail(`${subject} array must pin element, bounds, uniqueness, and order`);
    }
    const element = parseDescriptor(args[0], `${subject}[]`, context);
    const options = Object.fromEntries(
      args.slice(1).map((argument) => {
        const match = /^(length|min|max|unique|order)=([A-Za-z0-9]+)$/.exec(argument);
        if (!match) fail(`${subject} has a malformed array option`);
        return [match[1], match[2]];
      }),
    );
    if (Object.keys(options).length !== args.length - 1) fail(`${subject} repeats an array option`);
    const fixed = Object.hasOwn(options, "length");
    if (
      (fixed && !sameArray(Object.keys(options).sort(), ["length", "order", "unique"])) ||
      (!fixed && !sameArray(Object.keys(options).sort(), ["max", "min", "order", "unique"]))
    ) {
      fail(`${subject} has an open array bound`);
    }
    const decimals = fixed ? [options.length] : [options.min, options.max];
    if (decimals.some((value) => !/^(?:0|[1-9][0-9]*)$/.test(value))) {
      fail(`${subject} has a noncanonical array bound`);
    }
    const compareDecimal = (left, right) =>
      left.length === right.length ? left.localeCompare(right) : left.length - right.length;
    if (!fixed && compareDecimal(options.min, options.max) > 0) fail(`${subject} array min exceeds max`);
    if (options.unique !== "true" && options.unique !== "false") {
      fail(`${subject} array uniqueness is not closed`);
    }
    if (!["LEXICOGRAPHIC", "PRESERVE", "REGISTRY"].includes(options.order)) {
      fail(`${subject} array order is not closed`);
    }
    return { kind: operator, element, options };
  }
  fail(`${subject} uses unknown descriptor operator ${operator}`);
}

function parseDefinition(definitionName, definition, context, requireSchemaVersion) {
  if (typeof definition !== "string" || definition.length === 0) {
    fail(`${definitionName} has no exact definition`);
  }
  const fields = splitTopLevel(definition, "|").map((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 1) fail(`${definitionName} has a malformed field definition`);
    const name = entry.slice(0, separator);
    const descriptor = entry.slice(separator + 1);
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) fail(`${definitionName} has an invalid field name`);
    return [name, parseDescriptor(descriptor, `${definitionName}.${name}`, context), descriptor];
  });
  const names = fields.map(([name]) => name);
  if (new Set(names).size !== names.length || !sameArray(names, [...names].sort())) {
    fail(`${definitionName} field order is not canonical or is duplicated`);
  }
  if (requireSchemaVersion) {
    const schemaField = fields.find(([name]) => name === "schemaVersion");
    if (!schemaField || schemaField[2] !== `literal(${definitionName})`) {
      fail(`${definitionName} does not pin its exact schemaVersion literal`);
    }
  }
  return new Map(fields.map(([name, parsed, raw]) => [name, { parsed, raw }]));
}

function uniqueStringArray(value, subject) {
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || item.length === 0) ||
    new Set(value).size !== value.length
  ) {
    fail(`${subject} is not a unique nonempty string array`);
  }
  return value;
}

function canonicalJson(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("golden has a noncanonical number");
    return String(value);
  }
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value !== "object") fail("golden has a non-JSON value");
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(",")}}`;
}

function validInheritedScalar(kind, value) {
  if (kind === "sha256") return typeof value === "string" && sha256Pattern.test(value);
  if (kind === "uuid-v7")
    return (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    );
  if (kind === "integer") return Number.isSafeInteger(value) && value >= 0;
  if (kind === "timestamp")
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
  if (kind === "schema-id")
    return typeof value === "string" && /^[a-z][a-z0-9-]*\/v[1-9][0-9]*$/.test(value);
  if (kind === "semver")
    return typeof value === "string" && /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)$/.test(value);
  if (kind === "bounded-string")
    return typeof value === "string" && value.length > 0 && value.length <= 512;
  if (kind === "opaque")
    return typeof value === "string" && /^[a-z0-9](?:[a-z0-9._:@+-]{0,126}[a-z0-9])?$/.test(value);
  if (kind === "relative-path")
    return (
      typeof value === "string" &&
      value.length > 0 &&
      !value.startsWith("/") &&
      !value.includes("\\") &&
      value.split("/").every((part) => part !== "" && part !== "." && part !== "..")
    );
  if (kind === "json") {
    try {
      canonicalJson(value);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function validateSchemaDisposition(ledger) {
  exactKeys(
    ledger,
    [
      "alreadyExactAuthority",
      "alreadyExactAuthorityBinding",
      "alreadyExactGeneral",
      "attemptLogStorage",
      "conditionalPresence",
      "deletedContractSymbols",
      "deletedSchemaVersions",
      "dependencyGraphs",
      "descriptorLanguage",
      "exactBase",
      "inheritedExact",
      "inheritedFieldLanguage",
      "namedDescriptors",
      "nestedDefinitions",
      "newlyPinned",
      "newlyPinnedContract",
      "operationalBindings",
      "pointerRegistry",
      "pointerRegistryContract",
      "positionDefinitions",
      "primitiveDescriptors",
      "publicExports",
      "runPhaseStages",
      "schemaVersion",
      "subjectHead",
      "unknownEvidenceReasons",
    ],
    "ISS-002 schema disposition ledger",
  );
  if (ledger.schemaVersion !== "iss-002-schema-disposition/v1") {
    fail("unknown ISS-002 schema disposition version");
  }
  if (ledger.subjectHead !== "332d8345bdc964ccbe654b22e88b30b99fe770dc") {
    fail("ISS-002 schema disposition subject head moved");
  }
  exactKeys(
    ledger.exactBase,
    [
      "commit",
      "fixtureBlob",
      "fixturePath",
      "newPublicSchemaCount",
      "publicSchemaCensusDigest",
      "publicSchemaCount",
      "retainedPublicSchemaCount",
      "sources",
    ],
    "exact base",
  );
  if (
    ledger.exactBase.commit !== ledger.subjectHead ||
    ledger.exactBase.fixturePath !== "test/contracts/fixtures.ts" ||
    !sha256Pattern.test(ledger.exactBase.publicSchemaCensusDigest) ||
    ledger.exactBase.publicSchemaCount !== 155 ||
    ledger.exactBase.retainedPublicSchemaCount !== 85 ||
    ledger.exactBase.newPublicSchemaCount !== 17
  ) {
    fail("ISS-002 exact-base identity moved");
  }
  exactKeys(ledger.exactBase.sources, ["approved", "definitions", "v2"], "exact-base sources");
  const expectedSourcePins = {
    approved: ["packages/contracts/src/approved.ts", "c07a107f3bae9a9f248e1684fe532c0898642ef5"],
    definitions: ["packages/contracts/src/definitions.ts", "511b521aeb4efd745bf51cc002435188378829f8"],
    v2: ["packages/contracts/src/v2.ts", "e743567d846a047de10eb7c4cb2c5d71638b08e4"],
  };
  for (const [key, binding] of Object.entries(ledger.exactBase.sources)) {
    exactKeys(ledger.exactBase.sources[key], ["blob", "path"], `exact-base ${key}`);
    if (!sameArray([binding.path, binding.blob], expectedSourcePins[key])) {
      fail(`ISS-002 exact-base ${key} inline Git-object pin moved`);
    }
  }
  if (
    ledger.exactBase.fixtureBlob !== "f8953cc6cfb9bc22f438a9ff64c6bcfd93ff274f"
  ) {
    fail("ISS-002 exact-base fixture inline Git-object pin moved");
  }

  const general = ledger.alreadyExactGeneral;
  if (!Array.isArray(general) || general.length !== 25) fail("already-exact general census moved");
  for (const row of general) {
    if (
      !Array.isArray(row) ||
      row.length !== 3 ||
      typeof row[0] !== "string" ||
      !sha256Pattern.test(row[1]) ||
      !sha256Pattern.test(row[2])
    ) {
      fail("already-exact general binding is malformed");
    }
  }
  const authority = ledger.alreadyExactAuthority;
  if (!Array.isArray(authority) || authority.length !== 8) {
    fail("already-exact authority census moved");
  }
  exactKeys(
    ledger.alreadyExactAuthorityBinding,
    ["path", "requiredDimensions", "section"],
    "already-exact authority binding",
  );
  if (
    ledger.alreadyExactAuthorityBinding.path !== "docs/architecture/supervisor-contract.md" ||
    ledger.alreadyExactAuthorityBinding.section !==
      "Normative simplified-authority schema ledger" ||
    !sameArray(ledger.alreadyExactAuthorityBinding.requiredDimensions, [
      "canonical-order",
      "digest-domain",
      "enums",
      "excluded-fields",
      "fields",
      "golden-identity",
      "nullability",
      "persistence",
      "scalar-types",
    ])
  ) {
    fail("already-exact authority table binding moved");
  }

  const inherited = ledger.inheritedExact;
  if (!Array.isArray(inherited) || inherited.length !== 24) {
    fail("inherited exact census moved");
  }
  exactKeys(
    ledger.inheritedFieldLanguage,
    ["array", "canonicalOrder", "kinds", "nullable", "values"],
    "inherited field language",
  );
  const inheritedKinds = new Set(Object.keys(ledger.inheritedFieldLanguage.kinds));
  const inheritedByName = new Map();
  const semanticRules = {
    "physical-destination-identity/v1": "PHYSICAL_DESTINATION_IDENTITY_V1",
    "physical-destination-locator-observation-receipt/v1": "OBSERVED_AT_LE_VALID_UNTIL",
    "recovery-authorization-core/v1": "RECOVERY_AUTHORIZATION_MODE_UNION_V1",
    "state-mutation-destination-owner-successor-review-core/v1":
      "NESTED_SUCCESSOR_REVIEW_CORE_V1",
  };
  for (const row of inherited) {
    exactKeys(
      row,
      [
        "fields",
        "goldenCanonicalJson",
        "nestedRecords",
        "schemaVersion",
        "semanticRuleId",
        "sourceKey",
      ],
      "inherited exact row",
    );
    const schemaVersion = row.schemaVersion;
    if (
      typeof schemaVersion !== "string" ||
      inheritedByName.has(schemaVersion) ||
      !Object.hasOwn(ledger.exactBase.sources, row.sourceKey) ||
      typeof row.fields !== "string" ||
      typeof row.goldenCanonicalJson !== "string"
    ) {
      fail("inherited exact definition/source/golden binding is malformed");
    }
    if (row.semanticRuleId !== (semanticRules[schemaVersion] ?? null)) {
      fail(`${schemaVersion} inherited semantic-rule identity moved`);
    }
    inheritedByName.set(schemaVersion, row);
  }
  if (inheritedByName.size !== inherited.length) {
    fail("inherited exact schema is duplicated");
  }
  exactKeys(
    ledger.newlyPinnedContract,
    [
      "canonicalOrder",
      "closedRecord",
      "defaultNullability",
      "goldenIdentityPrefix",
      "unicode",
      "unknownFields",
    ],
    "newly-pinned contract",
  );
  if (
    ledger.newlyPinnedContract.canonicalOrder !== "ascending-utf16-field-name" ||
    ledger.newlyPinnedContract.closedRecord !== true ||
    ledger.newlyPinnedContract.defaultNullability !== "NON_NULL" ||
    ledger.newlyPinnedContract.goldenIdentityPrefix !== "ISS-002/current-v1/" ||
    ledger.newlyPinnedContract.unicode !== "VALID_SCALAR_SEQUENCE_ONLY" ||
    ledger.newlyPinnedContract.unknownFields !== "REFUSE"
  ) {
    fail("newly-pinned closure contract moved");
  }
  if (Object.keys(ledger.newlyPinned).length !== 45) fail("newly-pinned schema census moved");
  exactKeys(
    ledger.operationalBindings,
    ["digestProfiles", "exclusions", "persistence", "schemaDigestProfile"],
    "newly-pinned operational bindings",
  );
  const newlyPinnedNames = Object.keys(ledger.newlyPinned).sort();
  if (
    !sameArray(Object.keys(ledger.operationalBindings.persistence).sort(), newlyPinnedNames) ||
    !sameArray(Object.keys(ledger.operationalBindings.schemaDigestProfile).sort(), newlyPinnedNames)
  ) {
    fail("newly-pinned schema lacks an exact persistence or digest binding");
  }
  for (const [schemaVersion, profile] of Object.entries(
    ledger.operationalBindings.schemaDigestProfile,
  )) {
    if (!Object.hasOwn(ledger.operationalBindings.digestProfiles, profile)) {
      fail(`${schemaVersion} uses an unknown digest profile`);
    }
    const persistence = ledger.operationalBindings.persistence[schemaVersion];
    if (typeof persistence !== "string" || persistence.length === 0) {
      fail(`${schemaVersion} lacks a persisted path or explicit non-persisted disposition`);
    }
  }
  const currentSchemas = [
    ...general.map((row) => row[0]),
    ...authority,
    ...inherited.map((row) => row.schemaVersion),
    ...Object.keys(ledger.newlyPinned),
  ].sort();
  if (
    currentSchemas.length !== 102 ||
    new Set(currentSchemas).size !== 102 ||
    currentSchemas.some((schemaVersion) => !schemaVersion.endsWith("/v1"))
  ) {
    fail("current public schema disposition union moved or overlaps");
  }
  const descriptorContext = {
    namedNames: new Set(Object.keys(ledger.namedDescriptors)),
    nestedNames: new Set(Object.keys(ledger.nestedDefinitions)),
    primitiveNames: new Set(Object.keys(ledger.primitiveDescriptors)),
    schemaNames: new Set(currentSchemas),
  };
  exactKeys(
    ledger.descriptorLanguage,
    ["array", "closed", "enum", "fieldList", "literal", "nullable", "record", "recursion", "syntax"],
    "descriptor language",
  );
  if (!ledger.descriptorLanguage.array.includes("no omitted bound")) {
    fail("descriptor language permits an open array");
  }
  for (const [name, descriptor] of Object.entries(ledger.namedDescriptors)) {
    parseDescriptor(descriptor, `named descriptor ${name}`, descriptorContext);
  }
  const parsedNew = new Map();
  for (const [schemaVersion, definition] of Object.entries(ledger.newlyPinned)) {
    parsedNew.set(
      schemaVersion,
      parseDefinition(schemaVersion, definition, descriptorContext, true),
    );
  }
  for (const [name, definition] of Object.entries(ledger.nestedDefinitions)) {
    parseDefinition(name, definition, descriptorContext, false);
  }
  const inheritedContext = {
    ...descriptorContext,
    canonicalEnums: false,
    primitiveNames: new Set([...descriptorContext.primitiveNames, ...inheritedKinds]),
  };
  const parsedInherited = new Map();
  for (const [schemaVersion, row] of inheritedByName) {
    const fields = parseDefinition(schemaVersion, row.fields, inheritedContext, true);
    parsedInherited.set(schemaVersion, fields);
    let golden;
    try {
      golden = JSON.parse(row.goldenCanonicalJson);
    } catch {
      fail(`${schemaVersion} inherited golden is not JSON`);
    }
    if (
      canonicalJson(golden) !== row.goldenCanonicalJson ||
      golden === null ||
      typeof golden !== "object" ||
      Array.isArray(golden) ||
      !sameArray(Object.keys(golden).sort(), [...fields.keys()].sort()) ||
      golden.schemaVersion !== schemaVersion
    ) {
      fail(`${schemaVersion} inherited golden is not canonical and closed`);
    }
    const validateValue = (descriptor, value, subject) => {
      if (descriptor.kind === "nullable") {
        if (value === null) return;
        validateValue(descriptor.inner, value, subject);
        return;
      }
      if (value === null) fail(`${subject} inherited golden null is forbidden`);
      if (descriptor.kind === "literal") {
        if (value !== descriptor.value) fail(`${subject} inherited golden literal moved`);
        return;
      }
      if (descriptor.kind === "enum") {
        if (!descriptor.values.includes(value)) fail(`${subject} inherited golden enum is invalid`);
        return;
      }
      if (descriptor.kind === "primitive") {
        if (!validInheritedScalar(descriptor.name, value)) {
          fail(`${subject} inherited golden violates ${descriptor.name}`);
        }
        return;
      }
      if (descriptor.kind === "array") {
        if (!Array.isArray(value)) fail(`${subject} inherited golden array is invalid`);
        const min = Number(descriptor.options.min ?? descriptor.options.length);
        const max = Number(descriptor.options.max ?? descriptor.options.length);
        if (value.length < min || value.length > max) fail(`${subject} inherited golden array bound moved`);
        for (const entry of value) validateValue(descriptor.element, entry, `${subject}[]`);
        if (
          descriptor.options.unique === "true" &&
          new Set(value.map(canonicalJson)).size !== value.length
        ) {
          fail(`${subject} inherited golden array is not unique`);
        }
        return;
      }
      fail(`${subject} inherited golden uses a non-scalar descriptor`);
    };
    for (const [field, { parsed }] of fields) {
      validateValue(parsed, golden[field], `${schemaVersion}.${field}`);
    }
    for (const [field, nestedSchema] of Object.entries(row.nestedRecords)) {
      if (
        fields.get(field)?.raw !== "json" ||
        !inheritedByName.has(nestedSchema) ||
        golden[field]?.schemaVersion !== nestedSchema
      ) {
        fail(`${schemaVersion}.${field} has an invalid nested inherited identity`);
      }
    }
  }
  if (
    !Array.isArray(ledger.deletedSchemaVersions) ||
    ledger.deletedSchemaVersions.length !== 70 ||
    !sameArray(ledger.deletedSchemaVersions, [...ledger.deletedSchemaVersions].sort()) ||
    ledger.deletedSchemaVersions.some((schemaVersion) => currentSchemas.includes(schemaVersion))
  ) {
    fail("deleted schema census moved, overlaps, or is not canonical");
  }
  if (
    ledger.exactBase.retainedPublicSchemaCount + ledger.deletedSchemaVersions.length !==
      ledger.exactBase.publicSchemaCount ||
    ledger.exactBase.retainedPublicSchemaCount + ledger.exactBase.newPublicSchemaCount !==
      currentSchemas.length
  ) {
    fail("exact-base retained/deleted/new schema partition does not conserve the census");
  }
  if (
    !Array.isArray(ledger.deletedContractSymbols) ||
    ledger.deletedContractSymbols.length !== 13 ||
    new Set(ledger.deletedContractSymbols).size !== 13
  ) {
    fail("deleted contract symbol census is not exact");
  }

  if (
    !Array.isArray(ledger.pointerRegistry) ||
    ledger.pointerRegistry.length !== 11 ||
    ledger.pointerRegistry.some((row) => !Array.isArray(row) || row.length !== 11)
  ) {
    fail("pointer registry exact 11-row census moved");
  }
  const registryKinds = ledger.pointerRegistry.map((row) => row[0]);
  if (new Set(registryKinds).size !== 11) fail("pointer registry kind is duplicated");
  const currentSet = new Set(currentSchemas);
  for (const row of ledger.pointerRegistry) {
    if (!currentSet.has(row[2])) fail(`pointer registry ${row[0]} uses an uncensused value schema`);
    if (typeof row[9] !== "string") fail(`pointer registry ${row[0]} lacks an ordinary position`);
  }
  const tombstonePositions = ledger.pointerRegistry.filter((row) => row[10] !== null);
  if (tombstonePositions.length !== 10) fail("pointer registry tombstone position census moved");
  exactKeys(
    ledger.pointerRegistryContract,
    [
      "ordinaryPositionCount",
      "packetRemainingSlotCount",
      "packetSlotCount",
      "packetTargetSlotCount",
      "retention",
      "tombstoneFamilyCount",
      "tombstonePositionCount",
    ],
    "pointer registry contract",
  );
  if (
    ledger.pointerRegistryContract.ordinaryPositionCount !== 11 ||
    ledger.pointerRegistryContract.tombstonePositionCount !== 10 ||
    ledger.pointerRegistryContract.tombstoneFamilyCount !== 10 ||
    ledger.pointerRegistryContract.packetSlotCount !== 11 ||
    ledger.pointerRegistryContract.packetTargetSlotCount !== 1 ||
    ledger.pointerRegistryContract.packetRemainingSlotCount !== 10 ||
    ledger.pointerRegistryContract.retention !== "FULL_REQUIRED"
  ) {
    fail("pointer registry 11/11/10/FULL or packet 11/10 contract moved");
  }
  const positionNames = ledger.pointerRegistry.flatMap((row) =>
    row[10] === null ? [row[9]] : [row[9], row[10]],
  );
  if (
    positionNames.length !== 21 ||
    new Set(positionNames).size !== 21 ||
    !sameArray(Object.keys(ledger.positionDefinitions).sort(), [...positionNames].sort())
  ) {
    fail("position union does not define the exact 11 ordinary plus 10 tombstone arms");
  }
  for (const row of ledger.pointerRegistry) {
    for (const [domain, variant] of [[row[9], "ORDINARY"], ...(row[10] ? [[row[10], "TOMBSTONE"]] : [])]) {
      const fields = parseDefinition(
        domain,
        ledger.positionDefinitions[domain],
        descriptorContext,
        false,
      );
      if (
        fields.get("pointerKind")?.raw !== `literal(${row[0]})` ||
        fields.get("variant")?.raw !== `literal(${variant})`
      ) {
        fail(`${domain} is not bound to its registry kind and variant`);
      }
      if (variant === "TOMBSTONE") {
        const expected = ["archiveDigest", "pointerKind", "priorReceiptDigest", "priorTipDigest", "priorValueDigest", "terminalProofDigest", "variant"];
        if (!sameArray([...fields.keys()], expected)) fail(`${domain} has a noncanonical tombstone shape`);
      }
    }
  }

  const requiredMatrices = [
    "activation-recovery-launch/v1",
    "attempt-log/v1",
    "pointer-cas-proposal-receipt/v1",
    "pointer-evidence-packet/v1",
    "pointer-mutation-run-checkpoint-core/v1",
    "recovery-attempt-reservation/v1",
    "recovery-authorization-attachment/v1",
    "recovery-authorization-state/v1",
  ];
  if (!sameArray(Object.keys(ledger.conditionalPresence).sort(), requiredMatrices.sort())) {
    fail("lifecycle conditional-presence matrix census moved");
  }
  for (const [schemaVersion, matrix] of Object.entries(ledger.conditionalPresence)) {
    exactKeys(matrix, ["conditionalFields", "discriminator", "states"], `${schemaVersion} matrix`);
    const fields = parsedNew.get(schemaVersion);
    if (!fields) fail(`${schemaVersion} matrix has no newly pinned schema`);
    const discriminator = fields.get(matrix.discriminator)?.parsed;
    if (!discriminator || discriminator.kind !== "enum") {
      fail(`${schemaVersion} matrix discriminator is not a closed enum`);
    }
    if (!sameArray(Object.keys(matrix.states).sort(), [...discriminator.values].sort())) {
      fail(`${schemaVersion} matrix does not exhaust its discriminator`);
    }
    uniqueStringArray(matrix.conditionalFields, `${schemaVersion} conditional fields`);
    for (const field of matrix.conditionalFields) {
      const parsed = fields.get(field)?.parsed;
      if (!parsed || parsed.kind !== "nullable") fail(`${schemaVersion}.${field} is not nullable`);
    }
    for (const [state, branch] of Object.entries(matrix.states)) {
      const allowedKeys = ["allOrNone", "null", "present", "presentOrNull"];
      if (Object.keys(branch).some((key) => !allowedKeys.includes(key))) {
        fail(`${schemaVersion} ${state} matrix has an unknown disposition`);
      }
      for (const key of allowedKeys) if (branch[key]) uniqueStringArray(branch[key], `${schemaVersion} ${state} ${key}`);
      const covered = allowedKeys.flatMap((key) => branch[key] ?? []);
      if (
        new Set(covered).size !== covered.length ||
        !sameArray([...covered].sort(), [...matrix.conditionalFields].sort())
      ) {
        fail(`${schemaVersion} ${state} does not dispose every conditional field exactly once`);
      }
    }
  }

  const stageDescriptor = parseDescriptor(
    ledger.namedDescriptors["checkpoint-stage"],
    "checkpoint-stage",
    descriptorContext,
  );
  const phaseField = parsedNew.get("pointer-mutation-run-current-value/v1").get("phase").parsed;
  if (
    stageDescriptor.kind !== "enum" ||
    phaseField.kind !== "enum" ||
    !sameArray(Object.keys(ledger.runPhaseStages).sort(), [...phaseField.values].sort())
  ) {
    fail("run phase/stage matrix is not closed");
  }
  const terminalStages = ledger.runPhaseStages.SELECTED;
  for (const phase of ["LOST_CONFLICT", "UNKNOWN_TERMINAL"]) {
    if (!sameArray(ledger.runPhaseStages[phase], terminalStages)) {
      fail("terminal run phases do not share the exact terminal stage set");
    }
  }
  const stageUnion = new Set([
    ...ledger.runPhaseStages.CRASH_PREFIX,
    ...ledger.runPhaseStages.CAS_AMBIGUOUS,
    ...terminalStages,
  ]);
  if (!sameArray([...stageUnion].sort(), [...stageDescriptor.values].sort())) {
    fail("run phase/stage matrix omits or invents a stage");
  }

  exactKeys(ledger.dependencyGraphs, ["bootstrapE0"], "dependency graph census");
  const graph = ledger.dependencyGraphs.bootstrapE0;
  exactKeys(
    graph,
    ["edges", "nodes", "preUseIntentAllowedFacts", "preUseIntentForbiddenFacts"],
    "bootstrap E0 graph",
  );
  uniqueStringArray(graph.nodes, "bootstrap E0 nodes");
  const adjacency = new Map(graph.nodes.map((node) => [node, []]));
  const indegree = new Map(graph.nodes.map((node) => [node, 0]));
  for (const edge of graph.edges) {
    if (!Array.isArray(edge) || edge.length !== 2 || !adjacency.has(edge[0]) || !adjacency.has(edge[1])) {
      fail("bootstrap E0 graph has a malformed edge");
    }
    adjacency.get(edge[0]).push(edge[1]);
    indegree.set(edge[1], indegree.get(edge[1]) + 1);
  }
  const queue = [...indegree].filter(([, degree]) => degree === 0).map(([node]) => node);
  let visited = 0;
  while (queue.length) {
    const node = queue.shift();
    visited += 1;
    for (const next of adjacency.get(node)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  if (visited !== graph.nodes.length) fail("bootstrap E0 dependency graph is cyclic");
  for (const requiredEdge of [["Dgb", "Dh"], ["Dh", "authorityValue"], ["authorityValue", "Dv"]]) {
    if (!graph.edges.some((edge) => sameArray(edge, requiredEdge))) {
      fail("bootstrap E0 graph lost the Dgb to Dh to value to Dv chain");
    }
  }
  if (
    graph.preUseIntentAllowedFacts.some((fact) => graph.preUseIntentForbiddenFacts.includes(fact)) ||
    ["authorityValueDigest", "genesisBootstrapInputDigest"].some((field) =>
      parsedNew.get("bootstrap-proposed-genesis-input/v1").has(field),
    ) ||
    ["expectedAuthorityValueDigest", "genesisBootstrapInputDigest"].some((field) =>
      parsedNew.get("state-mutation-bootstrap-anchor-use-intent/v1").has(field),
    )
  ) {
    fail("pre-use intent contains downstream E0 authority");
  }

  exactKeys(
    ledger.attemptLogStorage,
    ["construction", "recordPath", "selectedTipPath", "soleRecordPerOrdinal"],
    "attempt-log storage",
  );
  if (
    ledger.attemptLogStorage.recordPath !==
      "installation/activation-recovery-launches/<transaction>/<source>/attempt-log/<ordinal>.json" ||
    ledger.attemptLogStorage.soleRecordPerOrdinal !== true ||
    ledger.operationalBindings.persistence["attempt-log/v1"] !== ledger.attemptLogStorage.recordPath
  ) {
    fail("attempt-log record persistence is not deterministic and ordinal-derived");
  }
  for (const [schemaVersion, path] of Object.entries(ledger.operationalBindings.persistence)) {
    if (schemaVersion.startsWith("state-mutation-bootstrap-anchor-") || schemaVersion === "state-mutation-bootstrap-anchor/v1") {
      if (!path.startsWith("state-mutation-authority-anchors/<installation-id>/") || path.includes("<anchor-Dp>")) {
        fail(`${schemaVersion} does not use the reviewed installation-keyed anchor path`);
      }
    }
  }

  const dispatchFields = parsedNew.get("dispatch-brief/v1");
  for (const [name, { parsed }] of dispatchFields) {
    if (name !== "schemaVersion" && /(prose|prompt|text|name|code)/i.test(name)) {
      fail("dispatch brief contains a prose-capable field");
    }
    if (parsed.kind === "array" && !Object.hasOwn(parsed.options, "length") && !Object.hasOwn(parsed.options, "max")) {
      fail("dispatch brief contains an unbounded array");
    }
  }

  exactKeys(ledger.publicExports, ["added", "base", "deleted", "extractor", "retained"], "public export census");
  exactKeys(
    ledger.publicExports.base,
    ["commit", "exportCount", "indexBlob", "indexPath", "runtimeBlob", "runtimePath"],
    "public export base",
  );
  const retainedExports = uniqueStringArray(ledger.publicExports.retained, "retained public exports");
  const deletedExports = uniqueStringArray(ledger.publicExports.deleted, "deleted public exports");
  const addedExports = uniqueStringArray(ledger.publicExports.added, "added public exports");
  if (
    ledger.publicExports.base.commit !== ledger.exactBase.commit ||
    retainedExports.some((name) => deletedExports.includes(name) || addedExports.includes(name)) ||
    deletedExports.some((name) => addedExports.includes(name))
  ) {
    fail("public export dispositions overlap or use a different base");
  }
  if (
    ledger.publicExports.base.exportCount !== 173 ||
    ledger.publicExports.base.indexPath !== "packages/contracts/src/index.ts" ||
    ledger.publicExports.base.indexBlob !== "736727f67fedb3a8e666f82cf33cb589a4aee1d3" ||
    ledger.publicExports.base.runtimePath !== "packages/contracts/src/runtime.ts" ||
    ledger.publicExports.base.runtimeBlob !== "7f65113db1267d02b7ab0eb795ad05a73e48b1ad"
  ) {
    fail("public export inline Git-object pins moved");
  }
  if (retainedExports.length + deletedExports.length !== ledger.publicExports.base.exportCount) {
    fail("base public export does not have exactly one retained/deleted disposition");
  }

  exactKeys(
    ledger.unknownEvidenceReasons,
    ["IMPOSSIBLE", "MALFORMED", "UNREADABLE"],
    "unknown evidence reason union",
  );
  const expectedUnknown = {
    IMPOSSIBLE: ["EPOCH_MISMATCH", "IDENTITY_MISMATCH", "STATE_CONTRADICTION"],
    MALFORMED: ["DIGEST_MISMATCH", "NON_CANONICAL", "SCHEMA_INVALID"],
    UNREADABLE: ["IO_ERROR", "MISSING", "PERMISSION_DENIED"],
  };
  if (JSON.stringify(ledger.unknownEvidenceReasons) !== JSON.stringify(expectedUnknown)) {
    fail("fixed UNKNOWN category/reason matrix moved");
  }
}

function uniqueRows(rows, kind) {
  const keys = new Set();
  const files = new Set();
  for (const row of rows) {
    if (keys.has(row.key)) fail(`duplicate ${kind} key ${row.key}`);
    if (row.file && files.has(row.file)) fail(`duplicate ${kind} file ${row.file}`);
    keys.add(row.key);
    if (row.file) files.add(row.file);
  }
}

function validateMigrationCoverage(snapshot, issueKeys, epicKeys) {
  const migration = snapshot.migration;
  const historicalBase = {
    observedAt: migration.observedAt,
    sourceRepository: migration.sourceRepository,
    sourceProject: migration.sourceProject,
    destinationRepository: migration.destinationRepository,
    destinationProject: migration.destinationProject,
    migrationPolicy: migration.migrationPolicy,
    sourceIssueNumbers: migration.sourceIssueNumbers,
    sourceBoardItemCount: migration.sourceBoardItemCount,
    sourceIssuesNotOnSourceBoard: migration.sourceIssuesNotOnSourceBoard,
    explicitExclusions: migration.explicitExclusions,
    ownershipGroups: migration.ownershipGroups,
  };
  const historicalBaseBytes = Buffer.from(JSON.stringify(historicalBase), "utf8");
  const historicalBaseDigest = createHash("sha256").update(historicalBaseBytes).digest("hex");
  if (
    historicalBaseBytes.byteLength !== 7126 ||
    historicalBaseDigest !== "a8d168d55fdb2ee12da28988009d8e93c25675117e0f2b903c3c1f8edc832b7a"
  ) {
    fail("migration historical 183-record base moved");
  }
  if (migration.schemaVersion !== "orchestration-migration/v1") {
    fail("unknown orchestration migration schema");
  }
  const source = migration.sourceIssueNumbers;
  if (
    !Array.isArray(source) ||
    source.length === 0 ||
    source.some((number) => !Number.isSafeInteger(number) || number <= 0) ||
    new Set(source).size !== source.length
  ) {
    fail("migration source issue census is malformed or duplicated");
  }
  const absent = migration.sourceIssuesNotOnSourceBoard;
  if (
    !Array.isArray(absent) ||
    absent.some((number) => !Number.isSafeInteger(number) || number <= 0) ||
    absent.some((number) => !source.includes(number)) ||
    new Set(absent).size !== absent.length ||
    migration.sourceBoardItemCount + absent.length !== source.length
  ) {
    fail("migration source board census does not conserve issues");
  }
  const groups = migration.ownershipGroups;
  if (!Array.isArray(groups) || groups.length === 0) fail("migration has no ownership groups");
  uniqueRows(groups, "migration ownership group");
  const allowedDestinations = new Set([...issueKeys, ...epicKeys]);
  const allowedDispositions = new Set(["CAPTURED", "PARKED", "COMPLETED_PROVENANCE"]);
  const covered = new Set();
  for (const group of groups) {
    if (!allowedDispositions.has(group.disposition)) {
      fail(`migration group ${group.key} has unknown disposition ${group.disposition}`);
    }
    if (!Array.isArray(group.destinationKeys) || group.destinationKeys.length === 0) {
      fail(`migration group ${group.key} has no destination owner`);
    }
    if (
      new Set(group.destinationKeys).size !== group.destinationKeys.length ||
      group.destinationKeys.some((key) => !allowedDestinations.has(key))
    ) {
      fail(`migration group ${group.key} has duplicate or unknown destination owner`);
    }
    if (
      (group.disposition === "CAPTURED" || group.disposition === "PARKED") &&
      group.destinationKeys.some((key) => !issueKeys.has(key))
    ) {
      fail(`migration group ${group.key} must use issue destination owners`);
    }
    if (typeof group.coverageStatement !== "string" || group.coverageStatement.trim() === "") {
      fail(`migration group ${group.key} has no coverage statement`);
    }
    if (
      group.disposition === "PARKED" &&
      (typeof group.unparkCondition !== "string" || group.unparkCondition.trim() === "")
    ) {
      fail(`parked migration group ${group.key} has no unpark condition`);
    }
    if (!Array.isArray(group.sourceIssueNumbers) || group.sourceIssueNumbers.length === 0) {
      fail(`migration group ${group.key} has no source issues`);
    }
    for (const number of group.sourceIssueNumbers) {
      if (!source.includes(number))
        fail(`migration group ${group.key} contains unknown issue ${number}`);
      if (covered.has(number))
        fail(`migration source issue ${number} has multiple ownership groups`);
      covered.add(number);
    }
  }
  if (
    !sameArray(
      [...covered].sort((a, b) => a - b),
      [...source].sort((a, b) => a - b),
    )
  ) {
    fail("migration ownership groups do not cover the exact source census");
  }
  const exclusions = migration.explicitExclusions?.issueNumbers;
  if (
    !Array.isArray(exclusions) ||
    exclusions.some((number) => !Number.isSafeInteger(number) || number <= 0) ||
    exclusions.some((number) => source.includes(number)) ||
    new Set(exclusions).size !== exclusions.length
  ) {
    fail("migration exclusions overlap or are malformed");
  }
  const canonicalDestinationKeys = new Set();
  for (const destinations of Object.values(migration.canonicalDestinations ?? {})) {
    if (
      !Array.isArray(destinations) ||
      destinations.length === 0 ||
      new Set(destinations).size !== destinations.length ||
      destinations.some((key) => !issueKeys.has(key))
    ) {
      fail("migration canonical destination table contains an unknown issue");
    }
    for (const destination of destinations) canonicalDestinationKeys.add(destination);
  }

  const addendum = migration.postCensusAddendum;
  const records = addendum?.records;
  if (
    addendum?.observedAt !== migration.observedAt ||
    typeof addendum?.liveAuditRecordedAt !== "string" ||
    Number.isNaN(Date.parse(addendum.liveAuditRecordedAt)) ||
    addendum?.baseSnapshotRecordCount !== 183 ||
    addendum.baseSnapshotRecordCount !== source.length ||
    addendum?.addendumRecordCount !== 2 ||
    addendum?.migratedAddendumRecordCount !== 1 ||
    addendum?.excludedConsumerPolicyRecordCount !== 1 ||
    addendum?.sourceAbsenceTargetRecordCount !== 184 ||
    !Array.isArray(records) ||
    addendum.addendumRecordCount !== records.length ||
    addendum?.totalProvenanceRecordCount !== source.length + records.length
  ) {
    fail("migration post-census addendum count mismatch");
  }
  const expectedAddendum = new Map([
    [
      6999,
      {
        destinationKey: "ISS-039",
        sourceState: "OPEN",
        sourceStateReason: "REOPENED",
        sourceBoardPresence: "PRESENT",
        sourceBoardRole: "CONSUMER_POLICY_RETAINED",
        disposition: "EXCLUDED_CONSUMER_POLICY",
      },
    ],
    [
      7000,
      {
        destinationKey: "ISS-040",
        sourceState: "OPEN",
        sourceStateReason: null,
        sourceBoardPresence: "PRESENT",
        sourceBoardRole: "PENDING_CLEANUP",
        disposition: "MIGRATED_PLATFORM",
      },
    ],
  ]);
  const seenAddendumIssues = new Set();
  let migratedAddendumRecords = 0;
  let excludedConsumerPolicyRecords = 0;
  for (const record of records) {
    const number = record.sourceIssueNumber;
    if (
      !Number.isSafeInteger(number) ||
      number <= 0 ||
      seenAddendumIssues.has(number) ||
      source.includes(number) ||
      exclusions.includes(number)
    ) {
      fail("migration post-census addendum identities overlap or are malformed");
    }
    seenAddendumIssues.add(number);
    const expected = expectedAddendum.get(number);
    if (!expected) fail(`migration post-census addendum contains unknown issue ${number}`);
    if (
      record.destinationKey !== expected.destinationKey ||
      !issueKeys.has(record.destinationKey) ||
      !canonicalDestinationKeys.has(record.destinationKey)
    ) {
      fail(`migration post-census addendum issue ${number} has noncanonical destination`);
    }
    if (
      record.sourceState !== expected.sourceState ||
      record.sourceStateReason !== expected.sourceStateReason ||
      record.disposition !== expected.disposition
    ) {
      fail(`migration post-census addendum issue ${number} has invalid source state`);
    }
    if (
      record.sourceBoardPresence !== expected.sourceBoardPresence ||
      record.sourceBoardRole !== expected.sourceBoardRole ||
      typeof record.provenanceStatement !== "string" ||
      record.provenanceStatement.trim() === ""
    ) {
      fail(`migration post-census addendum issue ${number} has invalid provenance`);
    }
    const commonKeys = [
      "destinationKey",
      "disposition",
      "provenanceStatement",
      "sourceBoardPresence",
      "sourceBoardRole",
      "sourceIssueNumber",
      "sourceState",
      "sourceStateReason",
    ];
    if (record.disposition === "EXCLUDED_CONSUMER_POLICY") {
      excludedConsumerPolicyRecords += 1;
      exactKeys(
        record,
        [
          ...commonKeys,
          "authorityDecisionCommentId",
          "authorityDecisionIssueNumber",
          "authorityDecisionRecordedAt",
          "authorityDecisionSelection",
        ],
        `migration post-census excluded consumer policy #${number}`,
      );
      if (
        number !== 6999 ||
        record.authorityDecisionIssueNumber !== 7007 ||
        record.authorityDecisionCommentId !== 5321438227 ||
        record.authorityDecisionRecordedAt !== "2026-08-17T23:29:22Z" ||
        record.authorityDecisionSelection !== "B"
      ) {
        fail(`migration post-census excluded consumer policy #${number} lacks exact authority`);
      }
    } else if (record.disposition === "MIGRATED_PLATFORM") {
      migratedAddendumRecords += 1;
      exactKeys(
        record,
        [
          ...commonKeys,
          "requiredSourceBoardPresence",
          "requiredSourceBoardRole",
          "requiredSourceState",
          "requiredSourceStateReason",
        ],
        `migration post-census migrated platform #${number}`,
      );
      if (
        record.requiredSourceState !== "CLOSED" ||
        record.requiredSourceStateReason !== "NOT_PLANNED" ||
        record.requiredSourceBoardPresence !== "ABSENT" ||
        record.requiredSourceBoardRole !== "SUPERSEDED_REMOVED"
      ) {
        fail(`migration post-census migrated platform #${number} has invalid terminal target`);
      }
    } else {
      fail(`migration post-census addendum issue ${number} has unknown disposition`);
    }
  }
  if (
    seenAddendumIssues.size !== expectedAddendum.size ||
    migratedAddendumRecords !== addendum.migratedAddendumRecordCount ||
    excludedConsumerPolicyRecords !== addendum.excludedConsumerPolicyRecordCount ||
    source.length + migratedAddendumRecords !== addendum.sourceAbsenceTargetRecordCount
  ) {
    fail("migration post-census addendum is incomplete");
  }
}

function validateReducedEdges(issues) {
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  function reaches(start, target, skipDirect) {
    const stack = byKey.get(start).blockedBy.filter((dep) => !(skipDirect && dep === target));
    const seen = new Set(stack);
    while (stack.length) {
      const current = stack.pop();
      if (current === target) return true;
      for (const dep of byKey.get(current)?.blockedBy ?? []) {
        if (!seen.has(dep)) {
          seen.add(dep);
          stack.push(dep);
        }
      }
    }
    return false;
  }
  for (const issue of issues) {
    for (const dep of issue.blockedBy) {
      if (reaches(issue.key, dep, true)) {
        fail(`${issue.key} direct edge to ${dep} is transitively implied`);
      }
    }
  }
}

function validateAcyclic(issues) {
  const issueKeys = new Set(issues.map(({ key }) => key));
  const visiting = new Set();
  const visited = new Set();
  const byKey = new Map(issues.map((issue) => [issue.key, issue]));
  function visit(key) {
    if (visiting.has(key)) fail(`dependency cycle includes ${key}`);
    if (visited.has(key)) return;
    visiting.add(key);
    for (const dependency of byKey.get(key).blockedBy) {
      if (!issueKeys.has(dependency)) fail(`${key} has unknown dependency ${dependency}`);
      visit(dependency);
    }
    visiting.delete(key);
    visited.add(key);
  }
  for (const key of issueKeys) visit(key);
}

function parseDag(source, epicKey) {
  const block = source.match(
    /- Direct-edge DAG \(generated from `planning\/roadmap\.json`\):([\s\S]*?)(?=\r?\n- )/,
  );
  if (!block) fail(`${epicKey} has no generated direct-edge DAG block`);
  const text = block[1]
    .replace(/`/g, "")
    .replace(/\r?\n\s*/g, " ")
    .trim();
  const clauses = text
    .split(";")
    .map((clause) => clause.trim().replace(/\.$/, ""))
    .filter(Boolean);
  const result = new Map();
  for (const clause of clauses) {
    const parts = clause.split("→").map((part) => part.trim());
    if (parts.length !== 2 || !/^ISS-\d{3}$/.test(parts[1])) {
      fail(`${epicKey} has malformed DAG clause ${clause}`);
    }
    if (result.has(parts[1])) fail(`${epicKey} repeats DAG target ${parts[1]}`);
    const dependencies = parts[0].split(",").map((item) => item.trim());
    if (dependencies.some((key) => !/^ISS-\d{3}$/.test(key))) {
      fail(`${epicKey} has malformed DAG dependency list for ${parts[1]}`);
    }
    result.set(parts[1], dependencies);
  }
  return result;
}

export function verificationCommands(source) {
  const section = source.match(/## Verification plan\r?\n([\s\S]*?)(?=\r?\n## |$)/)?.[1] ?? "";
  const commands = [];
  for (const match of section.matchAll(/`([^`]*pnpm[^`]*)`/g)) commands.push(match[1].trim());
  return commands;
}

function validateCommandCensus(snapshot) {
  const rootScripts = snapshot.rootPackage.scripts ?? {};
  const expectedRootScripts = new Set([
    "build",
    "format",
    "format:check",
    "typecheck",
    "test",
    "verify:bootstrap",
    "planning:check",
    "planning:board-check",
    "bootstrap",
    "host-custody:bootstrap",
  ]);
  for (const [key, source] of Object.entries(snapshot.issueDrafts)) {
    for (const command of verificationCommands(source)) {
      const root = command.match(/^pnpm run ([a-z0-9:-]+)/);
      if (root) {
        const scriptName = root[1];
        expectedRootScripts.add(scriptName);
        const observed = rootScripts[scriptName];
        if (!observed) fail(`${key} verification command ${scriptName} does not resolve`);
        if (key !== "ISS-000") {
          const expected = `node scripts/capability-not-implemented.mjs ${key} ${scriptName}`;
          if (observed !== expected) fail(`${scriptName} is not the exact ${key} placeholder`);
        }
        continue;
      }
      const filtered = command.match(/^pnpm --filter (\S+) (\S+)/);
      if (filtered) {
        const manifest = snapshot.packageManifests[filtered[1]];
        if (!manifest?.scripts?.[filtered[2]]) {
          fail(`${key} filtered command ${filtered[1]} ${filtered[2]} does not resolve`);
        }
        const expected = `node ../../scripts/capability-not-implemented.mjs ${key} ${filtered[1]}:${filtered[2]}`;
        if (manifest.scripts[filtered[2]] !== expected) {
          fail(`${filtered[1]} ${filtered[2]} is not the exact ${key} placeholder`);
        }
      }
    }
  }

  if (rootScripts.bootstrap !== "node bootstrap/bin/orchestration-bootstrap.mjs") {
    fail("bootstrap wrapper is not literal argument forwarding");
  }
  if (
    rootScripts["host-custody:bootstrap"] !==
    "node packages/host-custody/bin/orchestration-host-custody-bootstrap.mjs"
  ) {
    fail("host-custody bootstrap wrapper is not literal argument forwarding");
  }
  if (!sameArray(Object.keys(rootScripts).sort(), [...expectedRootScripts].sort())) {
    fail("root script census contains a missing or extra wrapper");
  }
}

function declaredCapabilities(issueDrafts) {
  const declared = new Map();
  for (const [issue, source] of Object.entries(issueDrafts)) {
    for (const command of verificationCommands(source)) {
      const root = command.match(/^pnpm run ([a-z0-9:-]+)/);
      const filtered = command.match(/^pnpm --filter (\S+) (\S+)/);
      const capability = root?.[1] ?? (filtered ? `${filtered[1]}:${filtered[2]}` : undefined);
      if (!capability || issue === "ISS-000") continue;
      if (declared.has(capability)) fail(`duplicate declared capability ${capability}`);
      declared.set(capability, issue);
    }
  }
  return declared;
}

function validateCapabilitySlots(snapshot) {
  const declared = declaredCapabilities(snapshot.issueDrafts);
  const seen = new Set();
  for (const slot of snapshot.capabilitySlots) {
    if (!/^ISS-\d{3}$/.test(slot.issue) || !slot.isDirectory || slot.directorySymlink) {
      fail(`malformed capability slot owner ${slot.issue}`);
    }
    if (!slot.isFile || slot.isSymbolicLink || !slot.name.endsWith(".mjs")) {
      fail(`malformed capability slot ${slot.issue}/${slot.name}`);
    }
    const encoded = slot.name.slice(0, -4);
    let capability;
    try {
      capability = decodeURIComponent(encoded);
    } catch {
      fail(`malformed capability slot encoding ${slot.name}`);
    }
    if (!capability || capabilitySlotName(capability) !== slot.name) {
      fail(`capability slot encoding collision ${slot.name}`);
    }
    if (declared.get(capability) !== slot.issue) {
      fail(`capability slot has wrong owner or is extra ${slot.issue}/${slot.name}`);
    }
    if (seen.has(capability)) fail(`duplicate capability slot ${capability}`);
    seen.add(capability);
  }
}

export function validatePlanningSnapshot(snapshot) {
  validateSchemaDisposition(snapshot.schemaDisposition);
  const { roadmap } = snapshot;
  if (roadmap.schemaVersion !== "orchestration-roadmap/v1") fail("unknown roadmap schema");
  if (roadmap.repository !== "todd-skelton/orchestration-platform")
    fail("roadmap repository mismatch");
  uniqueRows(roadmap.milestones, "milestone");
  uniqueRows(roadmap.epics, "epic");
  uniqueRows(roadmap.issues, "issue");

  const milestoneTitles = new Map(roadmap.milestones.map((row) => [row.key, row.title]));
  const epicKeys = new Set(roadmap.epics.map((row) => row.key));
  const issueKeys = new Set(roadmap.issues.map((row) => row.key));
  validateMigrationCoverage(snapshot, issueKeys, epicKeys);
  if (!sameArray(Object.keys(snapshot.issueDrafts).sort(), [...issueKeys].sort())) {
    fail("registered issue drafts and filesystem issue drafts differ");
  }
  if (!sameArray(Object.keys(snapshot.epicDrafts).sort(), [...epicKeys].sort())) {
    fail("registered epic drafts and filesystem epic drafts differ");
  }

  for (const issue of roadmap.issues) {
    if (!milestoneTitles.has(issue.milestone))
      fail(`${issue.key} has unknown milestone ${issue.milestone}`);
    if (!epicKeys.has(issue.parent)) fail(`${issue.key} has unknown parent ${issue.parent}`);
    const frontmatter = parseFrontmatter(snapshot.issueDrafts[issue.key], issue.file);
    if (frontmatter.key !== issue.key) fail(`${issue.key} frontmatter key mismatch`);
    if (frontmatter.parent !== issue.parent) fail(`${issue.key} frontmatter parent mismatch`);
    if (frontmatter.milestone !== milestoneTitles.get(issue.milestone)) {
      fail(`${issue.key} frontmatter milestone mismatch`);
    }
    if (!sameArray(frontmatter.blocked_by ?? [], issue.blockedBy)) {
      fail(`${issue.key} direct blocked-by edges mismatch`);
    }
  }
  validateAcyclic(roadmap.issues);
  validateReducedEdges(roadmap.issues);

  for (const epic of roadmap.epics) {
    const source = snapshot.epicDrafts[epic.key];
    const frontmatter = parseFrontmatter(source, epic.file);
    if (frontmatter.key !== epic.key) fail(`${epic.key} frontmatter key mismatch`);
    const expectedChildren = roadmap.issues
      .filter((issue) => issue.parent === epic.key)
      .map((issue) => issue.key);
    if (!sameArray([...(frontmatter.children ?? [])].sort(), [...expectedChildren].sort())) {
      fail(`${epic.key} child membership mismatch`);
    }
    const dag = parseDag(source, epic.key);
    for (const child of expectedChildren) {
      const dependencies = roadmap.issues.find((issue) => issue.key === child).blockedBy;
      const observed = dag.get(child);
      if (dependencies.length === 0) {
        if (observed) fail(`${epic.key} has an extra zero-dependency DAG row for ${child}`);
      } else if (!observed || !sameArray(observed, dependencies)) {
        fail(`${epic.key} generated DAG row mismatch for ${child}`);
      }
    }
    for (const target of dag.keys()) {
      if (!expectedChildren.includes(target)) fail(`${epic.key} has extra DAG target ${target}`);
    }
  }

  validateCommandCensus(snapshot);
  validateCapabilitySlots(snapshot);
}

async function loadCapabilitySlots(root) {
  const slotsRoot = await capabilitySlotRoot(root);
  if (!slotsRoot) return [];
  try {
    const owners = await readdir(slotsRoot, { withFileTypes: true });
    const slots = [];
    for (const owner of owners) {
      const ownerPath = resolve(slotsRoot, owner.name);
      const ownerMetadata = await lstat(ownerPath);
      if (!ownerMetadata.isDirectory() || ownerMetadata.isSymbolicLink()) {
        slots.push({
          issue: owner.name,
          name: "",
          isDirectory: false,
          directorySymlink: ownerMetadata.isSymbolicLink(),
          isFile: false,
          isSymbolicLink: false,
        });
        continue;
      }
      for (const entry of await readdir(ownerPath, { withFileTypes: true })) {
        const metadata = await lstat(resolve(ownerPath, entry.name));
        slots.push({
          issue: owner.name,
          name: entry.name,
          isDirectory: true,
          directorySymlink: false,
          isFile: metadata.isFile(),
          isSymbolicLink: metadata.isSymbolicLink(),
        });
      }
    }
    return slots;
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadPlanningSnapshot(root = defaultRoot) {
  const roadmap = JSON.parse(await readFile(resolve(root, "planning/roadmap.json"), "utf8"));
  const schemaDisposition = JSON.parse(
    await readFile(resolve(root, "planning/iss-002-schema-disposition.json"), "utf8"),
  );
  const migration = JSON.parse(
    await readFile(resolve(root, "planning/chase-sets-orchestration-migration.json"), "utf8"),
  );
  const draftNames = (await readdir(resolve(root, "planning/drafts"))).filter((name) =>
    name.endsWith(".md"),
  );
  const issueDrafts = {};
  const epicDrafts = {};
  for (const name of draftNames) {
    const source = await readFile(resolve(root, "planning/drafts", name), "utf8");
    const key = name.slice(0, -3);
    if (key.startsWith("ISS-")) issueDrafts[key] = source;
    if (key.startsWith("EPIC-")) epicDrafts[key] = source;
  }
  const packageManifests = {};
  for (const issue of roadmap.issues) {
    for (const command of verificationCommands(issueDrafts[issue.key])) {
      const match = command.match(/^pnpm --filter (\S+) /);
      if (!match || packageManifests[match[1]]) continue;
      const packagePath = match[1].replace("@orchestration-platform/", "");
      const adapterDirectory =
        match[1] === "@orchestration-platform/adapter-self"
          ? "self"
          : match[1] === "@orchestration-platform/adapter-first-consumer"
            ? "first-consumer"
            : undefined;
      const base = adapterDirectory
        ? resolve(root, "adapters", adapterDirectory)
        : resolve(root, "packages", packagePath);
      packageManifests[match[1]] = JSON.parse(
        await readFile(resolve(base, "package.json"), "utf8"),
      );
    }
  }
  return {
    roadmap,
    schemaDisposition,
    migration,
    issueDrafts,
    epicDrafts,
    rootPackage: JSON.parse(await readFile(resolve(root, "package.json"), "utf8")),
    packageManifests,
    capabilitySlots: await loadCapabilitySlots(root),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) fail("planning checker accepts no arguments");
  validatePlanningSnapshot(await loadPlanningSnapshot());
  process.stdout.write("planning contracts verified\n");
}
