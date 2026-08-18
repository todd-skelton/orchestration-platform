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

function digestJson(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

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

function validateFieldDescriptor(descriptor, subject) {
  if (!/^[A-Za-z0-9_./(),=-]+$/.test(descriptor)) {
    fail(`${subject} has a prose or malformed field type`);
  }
  const enumMatch = /(?:^|\()enum\(([^()]*)\)/.exec(descriptor);
  if (enumMatch) {
    const values = enumMatch[1].split(",");
    if (
      values.length === 0 ||
      values.some((value) => value.length === 0) ||
      new Set(values).size !== values.length ||
      !sameArray(values, [...values].sort())
    ) {
      fail(`${subject} has an open, duplicate, or noncanonical enum`);
    }
  }
}

function validateDefinition(schemaVersion, definition) {
  if (typeof definition !== "string" || definition.length === 0) {
    fail(`${schemaVersion} has no exact definition`);
  }
  const fields = splitTopLevel(definition, "|").map((entry) => {
    const separator = entry.indexOf(":");
    if (separator < 1) fail(`${schemaVersion} has a malformed field definition`);
    const name = entry.slice(0, separator);
    const descriptor = entry.slice(separator + 1);
    if (!/^[a-z][A-Za-z0-9]*$/.test(name)) fail(`${schemaVersion} has an invalid field name`);
    validateFieldDescriptor(descriptor, `${schemaVersion}.${name}`);
    return [name, descriptor];
  });
  const names = fields.map(([name]) => name);
  if (new Set(names).size !== names.length || !sameArray(names, [...names].sort())) {
    fail(`${schemaVersion} field order is not canonical or is duplicated`);
  }
  const schemaField = fields.find(([name]) => name === "schemaVersion");
  if (!schemaField || schemaField[1] !== `literal(${schemaVersion})`) {
    fail(`${schemaVersion} does not pin its exact schemaVersion literal`);
  }
}

export function validateSchemaDisposition(ledger) {
  exactKeys(
    ledger,
    [
      "alreadyExactAuthority",
      "alreadyExactAuthorityBinding",
      "alreadyExactGeneral",
      "deletedPublicSymbols",
      "deletedSchemaVersions",
      "exactBase",
      "inheritedExact",
      "nestedDefinitions",
      "newlyPinned",
      "newlyPinnedContract",
      "operationalBindings",
      "pointerRegistry",
      "pointerRegistryContract",
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
    ledger.exactBase.commit !== "2527ef6457e4a65b7c54ffd521f8c4c0bbe34905" ||
    ledger.exactBase.fixturePath !== "test/contracts/fixtures.ts" ||
    ledger.exactBase.fixtureBlob !== "3435d78637057ba7d9238efc734bc411cd72bf41" ||
    ledger.exactBase.publicSchemaCount !== 155 ||
    ledger.exactBase.publicSchemaCensusDigest !==
      "2a569ffc440bd6c3226b44cb78d909c6c77487a2abe908faecc5f672a75c3b61" ||
    ledger.exactBase.retainedPublicSchemaCount !== 85 ||
    ledger.exactBase.newPublicSchemaCount !== 17
  ) {
    fail("ISS-002 exact-base identity moved");
  }
  exactKeys(ledger.exactBase.sources, ["approved", "definitions", "v2"], "exact-base sources");
  const expectedSources = {
    approved: ["packages/contracts/src/approved.ts", "c07a107f3bae9a9f248e1684fe532c0898642ef5"],
    definitions: [
      "packages/contracts/src/definitions.ts",
      "511b521aeb4efd745bf51cc002435188378829f8",
    ],
    v2: ["packages/contracts/src/v2.ts", "e743567d846a047de10eb7c4cb2c5d71638b08e4"],
  };
  for (const [key, [path, blob]] of Object.entries(expectedSources)) {
    exactKeys(ledger.exactBase.sources[key], ["blob", "path"], `exact-base ${key}`);
    if (
      ledger.exactBase.sources[key].path !== path ||
      ledger.exactBase.sources[key].blob !== blob
    ) {
      fail(`ISS-002 exact-base ${key} identity moved`);
    }
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
  if (digestJson(general) !== "a3bca29e7db6de2356914cb2aec6a06caeb14e59ffa40f41dffd562284ed5a85") {
    fail("already-exact general definition/golden identity moved");
  }
  const authority = ledger.alreadyExactAuthority;
  if (!Array.isArray(authority) || authority.length !== 8) {
    fail("already-exact authority census moved");
  }
  if (
    digestJson(authority) !== "d8bb91f85125a4fac591fa0251aa00a6171ef352f0f1501f541b45773dcab558"
  ) {
    fail("already-exact authority census identity moved");
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
  for (const row of inherited) {
    if (
      !Array.isArray(row) ||
      row.length !== 4 ||
      typeof row[0] !== "string" ||
      !Object.hasOwn(ledger.exactBase.sources, row[1]) ||
      !sha256Pattern.test(row[2]) ||
      !sha256Pattern.test(row[3])
    ) {
      fail("inherited exact definition/golden binding is malformed");
    }
  }
  if (
    digestJson(inherited) !== "dce90237ebcd9608abb419ae7069cbb743f7f7e747cdf9d88f7072093aaa9e46"
  ) {
    fail("inherited exact definition/golden identity moved");
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
  for (const [schemaVersion, definition] of Object.entries(ledger.newlyPinned)) {
    validateDefinition(schemaVersion, definition);
  }
  if (
    digestJson(ledger.newlyPinned) !==
    "50f361f02b999807f76df1698f745aecb11e3236b6e1ddfd75591171f56b419e"
  ) {
    fail("newly-pinned field/type/nullability/enum census moved");
  }
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
  if (
    digestJson(ledger.operationalBindings) !==
    "1804c39d500c46b6696416708f61ae3845ca204cd381bdca03db91003c31107a"
  ) {
    fail("newly-pinned path/digest/exclusion binding moved");
  }
  exactKeys(
    ledger.nestedDefinitions,
    ["authority-history-binding", "selected-evidence"],
    "nested definition census",
  );
  for (const [name, definition] of Object.entries(ledger.nestedDefinitions)) {
    const synthetic = definition.replace(
      /(^|\|)([a-z][A-Za-z0-9]*):/g,
      (_match, prefix, field) => `${prefix}${field}:`,
    );
    const fields = splitTopLevel(synthetic, "|").map((entry) => entry.slice(0, entry.indexOf(":")));
    if (new Set(fields).size !== fields.length || !sameArray(fields, [...fields].sort())) {
      fail(`nested ${name} field order is not canonical or is duplicated`);
    }
    for (const entry of splitTopLevel(definition, "|")) {
      validateFieldDescriptor(entry.slice(entry.indexOf(":") + 1), `nested ${name}`);
    }
  }
  if (
    digestJson(ledger.nestedDefinitions) !==
    "54ef3beb06d206faac9423fc128751a0809b9552b076e10eb035786e52f7082b"
  ) {
    fail("nested recursively closed definition census moved");
  }

  const currentSchemas = [
    ...general.map((row) => row[0]),
    ...authority,
    ...inherited.map((row) => row[0]),
    ...Object.keys(ledger.newlyPinned),
  ].sort();
  if (
    currentSchemas.length !== 102 ||
    new Set(currentSchemas).size !== 102 ||
    currentSchemas.some((schemaVersion) => !schemaVersion.endsWith("/v1")) ||
    digestJson(currentSchemas) !==
      "b2cae9988657d45d875d85dd2aeb28b982a61c02f19640cb049a648ff7a12167"
  ) {
    fail("current public schema disposition union moved or overlaps");
  }
  if (
    !Array.isArray(ledger.deletedSchemaVersions) ||
    ledger.deletedSchemaVersions.length !== 70 ||
    !sameArray(ledger.deletedSchemaVersions, [...ledger.deletedSchemaVersions].sort()) ||
    digestJson(ledger.deletedSchemaVersions) !==
      "4e4bbcdcb7311ebc236c8835137f1929d4a9f17128dd60ca74979bd51c94d8b1" ||
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
    !Array.isArray(ledger.deletedPublicSymbols) ||
    ledger.deletedPublicSymbols.length !== 13 ||
    digestJson(ledger.deletedPublicSymbols) !==
      "bfbb94a402fb9139c6a68229b1ce42880796afde58bdb5bc62f788af96adaf0c"
  ) {
    fail("deleted public symbol census moved");
  }

  if (
    !Array.isArray(ledger.pointerRegistry) ||
    ledger.pointerRegistry.length !== 11 ||
    ledger.pointerRegistry.some((row) => !Array.isArray(row) || row.length !== 11) ||
    digestJson(ledger.pointerRegistry) !==
      "1e303c9912b7d04008080f3ba20e1d132138ee1c3a7100238efa527ecd312947"
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
