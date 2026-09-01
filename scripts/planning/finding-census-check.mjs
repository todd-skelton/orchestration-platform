import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const censusPath = "planning/pressure-tests/finding-class-census.json";
const fixturePath = "scripts/planning/fixtures/finding-census.json";
const roundNamePattern = /^2026-\d{2}-\d{2}-round-\d+\.md$/;

const occurrence = (source, evidence) => Object.freeze([source, evidence]);
const expectedClass = (id, occurrences) =>
  Object.freeze([
    id,
    Object.freeze(occurrences.map(([source, evidence]) => occurrence(source, evidence))),
  ]);
// This checker-owned immutable projection is independent of both mutable data artifacts.
const expectedClasses = Object.freeze([
  expectedClass("authority-claim-on-nonauthoritative-input", [
    [
      "planning/pressure-tests/2026-08-28-round-249.md",
      "The claimed literal rows are not authoritative:",
    ],
    [
      "planning/pressure-tests/2026-08-28-round-290.md",
      "The contention PASS oracle contradicts the authoritative ledger.",
    ],
    [
      "planning/pressure-tests/2026-08-29-round-299.md",
      "The generic nullable parser is otherwise explicitly non-authoritative;",
    ],
  ]),
  expectedClass("evidence-does-not-discriminate-criterion", [
    [
      "planning/pressure-tests/2026-08-15-round-1.md",
      "OP-PT-011 several acceptance methods were non-discriminating",
    ],
    [
      "planning/pressure-tests/2026-08-28-round-250.md",
      "The required byte-equality deletion test is still not closed:",
    ],
    [
      "planning/pressure-tests/2026-08-30-round-327.md",
      "lower-priority values and cannot discriminate this defect",
    ],
    [
      "planning/pressure-tests/2026-09-01-round-423.md",
      "A checker-owned immutable manifest must anchor the complete expected class",
    ],
  ]),
  expectedClass("fail-open-missing-snapshot-evidence", [
    [
      "external:github-issue-182/comment-5481438849",
      "The B1 finding class is filed into the ISS-046 census now",
    ],
  ]),
  expectedClass("missing-negative-controls", [
    [
      "planning/pressure-tests/2026-08-15-round-1.md",
      "OP-PT-011 several acceptance methods were non-discriminating",
    ],
    [
      "planning/pressure-tests/2026-08-28-round-258.md",
      "they contain no nonce-mismatch, malformed/multiple, overflow, timeout, or kill-refusal mutant",
    ],
    [
      "planning/pressure-tests/2026-08-28-round-286.md",
      "A structural negative control must traverse the called",
    ],
    [
      "planning/pressure-tests/2026-09-01-round-423.md",
      "The review-seed discriminator must reject negated verbs, negated or empty",
    ],
  ]),
  expectedClass("scope-fence-drift", [
    [
      "planning/pressure-tests/2026-08-27-round-234.md",
      "delete from ISS-006; park with unpark condition at `ISS-019`",
    ],
    [
      "planning/pressure-tests/2026-08-28-round-270.md",
      "adds terminal capability machinery needed by neither named ISS-041 nor ISS-013 consumer",
    ],
    [
      "planning/pressure-tests/2026-08-29-round-300.md",
      "parked architecture sentence is not a current command.",
    ],
  ]),
]);
const expectedRows = (rows) => Object.freeze(rows.map((row) => Object.freeze(row)));
const expectedGrammarNegatives = expectedRows([
  ["no-attack-provided", "No attack is provided."],
  ["do-not-attack", "Do not attack the census."],
  ["bare-attack-period", "Attack."],
  ["bare-attack", "Attack"],
  ["no-target", "Attack no target."],
  ["nothing-target", "Attack nothing."],
  ["empty-target", "Attack the empty target."],
  ["replace-nothing", "Replace nothing."],
  ["attack-not-provided", "Attack is not provided."],
  ["attack-is-missing", "Attack is missing."],
  ["attack-a-missing-target", "Attack a missing target."],
  ["attack-neither-target", "Attack neither target."],
  ["remove-without-target", "Remove without a target."],
  ["vague-it", "Attack it."],
  ["noun-attack-surface", "Review the attack surface."],
]);
const expectedCensusMutants = expectedRows([
  ["coordinated-class-deletion", "COORDINATED_CLASS_DELETION"],
  ["coordinated-occurrence-deletion", "COORDINATED_OCCURRENCE_DELETION"],
  ["missing-round", "MISSING_ROUND"],
  ["missed-cited-class", "MISSED_CITED_CLASS"],
  ["missing-recurring-disposition", "MISSING_RECURRING_DISPOSITION"],
  ["wrong-recurrence-count", "WRONG_RECURRENCE_COUNT"],
  ["b1-duplication", "B1_DUPLICATION"],
]);
const expectedFixtureMutants = expectedRows([
  ["stale-row-digest", "STALE_ROW_DIGEST"],
  ["unrelated-repaired-form", "UNRELATED_REPAIRED_FORM"],
  ["stale-decision-timestamp", "STALE_DECISION_TIMESTAMP"],
  ["admit-decision-and-rehash", "ADMIT_DECISION_AND_REHASH"],
]);
const concreteGrammarPositives = Object.freeze([
  "Attack census counts that cite no source rounds.",
  "Delete a duplicated finding-class occurrence.",
  "Remove stale authority rows.",
  "Substitute the exact digest and refuse a mismatch.",
  "Mutate the selected row while retaining the unrelated row.",
]);

function fail(message) {
  throw new Error(`FINDING_CENSUS_MISMATCH: ${message}`);
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function record(value, label) {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    fail(`${label} is not a record`);
  return value;
}
function exactKeys(value, keys, label) {
  const observed = Object.keys(record(value, label)).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(observed) !== JSON.stringify(expected))
    fail(`${label} has a missing or extra member`);
}
function nonempty(value, label) {
  if (typeof value !== "string" || value.trim() !== value || value === "")
    fail(`${label} is not a nonempty canonical string`);
  return value;
}
function sha256(value) {
  return createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex");
}
function digestLines(values) {
  return sha256(`${values.join("\n")}\n`);
}
function sourceCorpusDigest(roundSources) {
  const digest = createHash("sha256");
  for (const [source, text] of [...roundSources].sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    const bytes = Buffer.from(text.replace(/\r\n/g, "\n"), "utf8");
    const length = Buffer.alloc(8);
    length.writeBigUInt64BE(BigInt(bytes.length));
    digest
      .update(Buffer.from(source, "utf8"))
      .update(Buffer.from([0]))
      .update(length)
      .update(bytes);
  }
  return digest.digest("hex");
}
function section(source, heading) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line === `## ${heading}`);
  if (start < 0) return undefined;
  const end = lines.findIndex((line, index) => index > start && line.startsWith("## "));
  return lines.slice(start + 1, end < 0 ? lines.length : end).join("\n");
}

const actionClause =
  /(?:^|[.!?;\n])\s*(?:[-*]\s+|\d+[.)]\s+)?(attack(?:ed|ing|s)?|delet(?:e|ed|es|ing)|remov(?:e|ed|es|ing)|replac(?:e|ed|es|ing)|substitut(?:e|ed|es|ing)|refus(?:e|ed|es|ing)|mutat(?:e|ed|es|ing))\b([^.!?;\n]*)/gi;
const emptyObject =
  /^(?:(?:a|an|the)\s+(?:no|not|never|neither|none|nothing|without|absent|empty|missing|null|undefined|zero|0|n\/a)|(?:no|not|never|neither|none|nothing|without|absent|empty|null|undefined|zero|0|n\/a))\b/i;
const vagueObject = /^(?:it|this|that|something|anything|everything|provided)\b/i;
export function validateReviewAttackObject(body, label) {
  if (typeof body !== "string" || body === "") fail(`${label} is empty`);
  for (const match of body.matchAll(new RegExp(actionClause.source, actionClause.flags))) {
    const target = match[2].trim();
    if (
      target.length >= 3 &&
      /[\p{L}\p{N}`]/u.test(target) &&
      !emptyObject.test(target) &&
      !vagueObject.test(target) &&
      !/^(?:is|are|was|were|be|been|being)\s+(?:not|never|neither|absent|empty|missing|none|nothing)\b/i.test(
        target,
      )
    )
      return;
  }
  fail(`${label} has no non-negated action with a concrete object`);
}
function validateDraftReviewSeed(source, path) {
  const body = section(source, "Independent review packet seed");
  if (body === undefined) fail(`${path} has no independent review packet seed`);
  validateReviewAttackObject(body, `${path} review seed`);
}

function validateCodification(value, recurrenceCount, label) {
  record(value, `${label}.codification`);
  if (value.kind === "CHECK") {
    exactKeys(value, ["kind", "checkId", "fixtureId"], `${label}.codification`);
    if (value.checkId !== "review-attack-object/v1" || value.fixtureId !== "round-1-op-pt-011")
      fail(`${label} names an unknown check or fixture`);
  } else if (value.kind === "NON_CODIFIABLE") {
    exactKeys(
      value,
      ["kind", "boundary", "falsePositive", "falseNegative"],
      `${label}.codification`,
    );
    for (const key of ["boundary", "falsePositive", "falseNegative"])
      if (nonempty(value[key], `${label}.${key}`).length < 60)
        fail(`${label}.${key} is not a concrete discrimination boundary`);
  } else if (value.kind === "CANDIDATE") {
    exactKeys(value, ["kind", "nextEvidence"], `${label}.codification`);
    if (recurrenceCount >= 3 || nonempty(value.nextEvidence, `${label}.nextEvidence`).length < 60)
      fail(`${label} has an invalid candidate disposition`);
  } else fail(`${label} has unknown codification kind`);
}

function validateDecision(decision) {
  exactKeys(
    decision,
    ["source", "createdAt", "url", "utf8Sha256", "excerpt", "body"],
    "governingDecision",
  );
  if (
    decision.source !== "external:github-issue-182/comment-5481438849" ||
    decision.createdAt !== "2026-08-31T16:41:09Z" ||
    decision.url !==
      "https://github.com/todd-skelton/orchestration-platform/issues/182#issuecomment-5481438849" ||
    decision.utf8Sha256 !== "85932a7f92d384eb35c38c868ec1d0a65eb9c31e2999fe2fef68cc1dcf7a95b6" ||
    sha256(decision.body) !== decision.utf8Sha256 ||
    decision.excerpt !==
      "Ruling under the governing admission authority — Decision 182 resolved: KEEP\nPARKED at absolute attempt 8." ||
    !decision.body.includes(decision.excerpt) ||
    !decision.body.includes("No source work is admitted now.")
  )
    fail("governing decision is not the exact KEEP PARKED ruling");
  const gate = decision.body.indexOf("a concrete gate:");
  const attempts = decision.body.indexOf("attempts 9 and 10");
  if (gate < 0 || attempts < gate || !decision.body.includes("without unparking this packet"))
    fail("governing decision does not keep attempts 9 and 10 behind the gate");
}

function validateCensus(census, fixture, context) {
  exactKeys(census, ["schemaVersion", "corpus", "classes"], "census");
  if (census.schemaVersion !== "finding-class-census/v1") fail("unknown census schema");
  exactKeys(
    census.corpus,
    ["classIdsDigest", "roundRecordCount", "roundRecordNamesDigest", "roundRecordSourcesDigest"],
    "census.corpus",
  );
  const names = [...context.roundSources.keys()].sort();
  if (
    census.corpus.roundRecordCount !== names.length ||
    census.corpus.roundRecordNamesDigest !== digestLines(names.map((name) => name.slice(24))) ||
    census.corpus.roundRecordSourcesDigest !== sourceCorpusDigest(context.roundSources)
  )
    fail("pressure source census drifted");
  if (!Array.isArray(census.classes) || census.classes.length === 0)
    fail("finding-class census is empty");
  const projection = [];
  for (const [index, finding] of census.classes.entries()) {
    const label = `classes[${index}]`;
    exactKeys(
      finding,
      ["id", "description", "recurrenceCount", "occurrences", "codification"],
      label,
    );
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(finding.id)) fail(`${label}.id is malformed`);
    nonempty(finding.description, `${label}.description`);
    if (
      !Number.isSafeInteger(finding.recurrenceCount) ||
      !Array.isArray(finding.occurrences) ||
      finding.recurrenceCount !== finding.occurrences.length
    )
      fail(`${label} has a false recurrence count`);
    const occurrenceProjection = [];
    const sources = [];
    for (const [occurrenceIndex, row] of finding.occurrences.entries()) {
      exactKeys(row, ["source", "evidence"], `${label}.occurrences[${occurrenceIndex}]`);
      const source = nonempty(row.source, `${label}.occurrence.source`);
      const evidence = nonempty(row.evidence, `${label}.occurrence.evidence`);
      const text = source.startsWith("external:")
        ? source === fixture.governingDecision.source
          ? fixture.governingDecision.body
          : undefined
        : context.roundSources.get(source);
      if (typeof text !== "string" || !text.includes(evidence))
        fail(`${label} cites a missing round or finding class`);
      sources.push(source);
      occurrenceProjection.push([source, evidence]);
    }
    if (
      new Set(sources).size !== sources.length ||
      JSON.stringify(sources) !== JSON.stringify([...sources].sort())
    )
      fail(`${label} occurrences are repeated or unsorted`);
    validateCodification(finding.codification, finding.recurrenceCount, label);
    projection.push([finding.id, occurrenceProjection]);
  }
  const ids = census.classes.map((finding) => finding.id);
  if (
    new Set(ids).size !== ids.length ||
    JSON.stringify(ids) !== JSON.stringify([...ids].sort()) ||
    census.corpus.classIdsDigest !== digestLines(ids) ||
    JSON.stringify(projection) !== JSON.stringify(expectedClasses)
  )
    fail("census differs from the checker-owned immutable class manifest");
  const mutableProjection = census.classes.map((finding) => ({
    id: finding.id,
    occurrenceCount: finding.occurrences.length,
  }));
  if (JSON.stringify(mutableProjection) !== JSON.stringify(fixture.mutableProjection))
    fail("census differs from the mutable fixture projection");
}

function validateHistoricalPair(pair, census, context) {
  exactKeys(
    pair,
    ["id", "classId", "sourceRound", "rowUtf8Sha256", "offender", "repaired"],
    "historicalPair",
  );
  if (pair.id !== "round-1-op-pt-011" || pair.classId !== "missing-negative-controls")
    fail("historical pair identity mismatch");
  const source = context.roundSources.get(pair.sourceRound);
  const row = source
    ?.replace(/\r\n/g, "\n")
    .split("\n")
    .find((line) => line === `| ${pair.offender} | ${pair.repaired} |`);
  if (!row || sha256(row) !== pair.rowUtf8Sha256)
    fail("historical offender and repair are not the exact same retained artifact row");
  const finding = census.classes.find((value) => value.id === pair.classId);
  if (
    finding?.codification.kind !== "CHECK" ||
    finding.codification.fixtureId !== pair.id ||
    !finding.occurrences.some(
      (item) => item.source === pair.sourceRound && item.evidence === pair.offender,
    )
  )
    fail("historical pair is not bound to its codified census occurrence");
  expectRefusal(() => validateReviewAttackObject(pair.offender, "historical offender"), "offender");
  validateReviewAttackObject(pair.repaired, "historical repaired form");
}

function validateEvidenceRows(rows, valueKey, expected, label) {
  if (!Array.isArray(rows)) fail(`${label} is not an array`);
  const projection = [];
  for (const [index, row] of rows.entries()) {
    exactKeys(row, ["id", valueKey], `${label}[${index}]`);
    const id = nonempty(row.id, `${label}[${index}].id`);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id)) fail(`${label}[${index}].id is malformed`);
    projection.push([id, nonempty(row[valueKey], `${label}[${index}].${valueKey}`)]);
  }
  if (JSON.stringify(projection) !== JSON.stringify(expected))
    fail(`${label} differs from its checker-owned immutable evidence census`);
}

function validateFixture(fixture, census, context) {
  exactKeys(
    fixture,
    [
      "schemaVersion",
      "governingDecision",
      "historicalPair",
      "mutableProjection",
      "grammarNegatives",
      "censusMutants",
      "fixtureMutants",
    ],
    "fixture",
  );
  if (fixture.schemaVersion !== "finding-census-fixtures/v1") fail("unknown fixture schema");
  validateDecision(fixture.governingDecision);
  if (!Array.isArray(fixture.mutableProjection)) fail("mutable projection is not an array");
  for (const row of fixture.mutableProjection) {
    exactKeys(row, ["id", "occurrenceCount"], "mutableProjection row");
    if (!Number.isSafeInteger(row.occurrenceCount) || row.occurrenceCount < 1)
      fail("mutableProjection row has invalid count");
  }
  validateCensus(census, fixture, context);
  validateHistoricalPair(fixture.historicalPair, census, context);
  validateEvidenceRows(
    fixture.grammarNegatives,
    "body",
    expectedGrammarNegatives,
    "grammarNegatives",
  );
  validateEvidenceRows(fixture.censusMutants, "operation", expectedCensusMutants, "censusMutants");
  validateEvidenceRows(
    fixture.fixtureMutants,
    "operation",
    expectedFixtureMutants,
    "fixtureMutants",
  );
  for (const [index, row] of fixture.grammarNegatives.entries())
    expectRefusal(
      () => validateReviewAttackObject(row.body, `grammarNegatives.${row.id}`),
      `grammar negative ${row.id}`,
    );
  for (const [index, body] of concreteGrammarPositives.entries())
    validateReviewAttackObject(body, `concreteGrammarPositives[${index}]`);
}

function applyCensusMutant(census, fixture, operation) {
  const nextCensus = clone(census);
  const nextFixture = clone(fixture);
  const byId = (id) => nextCensus.classes.find((value) => value.id === id);
  if (operation === "COORDINATED_CLASS_DELETION") {
    nextCensus.classes = nextCensus.classes.filter((value) => value.id !== "scope-fence-drift");
    nextFixture.mutableProjection = nextFixture.mutableProjection.filter(
      (value) => value.id !== "scope-fence-drift",
    );
    nextCensus.corpus.classIdsDigest = digestLines(nextCensus.classes.map((value) => value.id));
  } else if (operation === "COORDINATED_OCCURRENCE_DELETION") {
    const finding = byId("missing-negative-controls");
    finding.occurrences.pop();
    finding.recurrenceCount = finding.occurrences.length;
    nextFixture.mutableProjection.find((value) => value.id === finding.id).occurrenceCount -= 1;
  } else if (operation === "MISSING_ROUND") {
    byId("missing-negative-controls").occurrences[0].source =
      "planning/pressure-tests/2099-01-01-round-999.md";
  } else if (operation === "MISSED_CITED_CLASS") {
    byId("scope-fence-drift").occurrences[0].evidence = "ABSENT_FINDING_CLASS_CANARY";
  } else if (operation === "MISSING_RECURRING_DISPOSITION") {
    delete byId("evidence-does-not-discriminate-criterion").codification;
  } else if (operation === "WRONG_RECURRENCE_COUNT") {
    byId("authority-claim-on-nonauthoritative-input").recurrenceCount += 1;
  } else if (operation === "B1_DUPLICATION") {
    const finding = byId("fail-open-missing-snapshot-evidence");
    finding.occurrences.push(clone(finding.occurrences[0]));
    finding.recurrenceCount += 1;
    nextFixture.mutableProjection.find((value) => value.id === finding.id).occurrenceCount += 1;
  } else fail(`unknown census mutant ${operation}`);
  return { census: nextCensus, fixture: nextFixture };
}

function applyFixtureMutant(fixture, operation) {
  const mutant = clone(fixture);
  if (operation === "STALE_ROW_DIGEST") mutant.historicalPair.rowUtf8Sha256 = "0".repeat(64);
  else if (operation === "UNRELATED_REPAIRED_FORM")
    mutant.historicalPair.repaired = "Removed an unrelated mechanism.";
  else if (operation === "STALE_DECISION_TIMESTAMP")
    mutant.governingDecision.createdAt = "2026-08-31T16:41:08Z";
  else if (operation === "ADMIT_DECISION_AND_REHASH") {
    mutant.governingDecision.body = mutant.governingDecision.body.replace("KEEP\nPARKED", "ADMIT");
    mutant.governingDecision.excerpt = mutant.governingDecision.excerpt.replace(
      "KEEP\nPARKED",
      "ADMIT",
    );
    mutant.governingDecision.utf8Sha256 = sha256(mutant.governingDecision.body);
  } else fail(`unknown fixture mutant ${operation}`);
  return mutant;
}

function expectRefusal(action, label) {
  try {
    action();
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("FINDING_CENSUS_MISMATCH:")) return;
    throw error;
  }
  fail(`${label} did not refuse`);
}

function validateEvidenceDeletionPins(fixture, census, context) {
  for (const key of ["grammarNegatives", "censusMutants", "fixtureMutants"])
    for (const [index, row] of fixture[key].entries()) {
      const mutant = clone(fixture);
      mutant[key].splice(index, 1);
      expectRefusal(() => validateFixture(mutant, census, context), `${key} deletion ${row.id}`);
    }
}

async function loadSources(root, directoryName, pattern) {
  const directory = resolve(root, directoryName);
  const names = (await readdir(directory)).filter((name) => pattern.test(name)).sort();
  return new Map(
    await Promise.all(
      names.map(async (name) => [
        `${directoryName}/${name}`,
        await readFile(resolve(directory, name), "utf8"),
      ]),
    ),
  );
}

export async function runFindingCensusCheck(root = defaultRoot) {
  const [censusText, fixtureText, roundSources, draftSources] = await Promise.all([
    readFile(resolve(root, censusPath), "utf8"),
    readFile(resolve(root, fixturePath), "utf8"),
    loadSources(root, "planning/pressure-tests", roundNamePattern),
    loadSources(root, "planning/drafts", /^ISS-\d{3}\.md$/),
  ]);
  const census = JSON.parse(censusText);
  const fixture = JSON.parse(fixtureText);
  const context = { roundSources, draftSources };
  validateFixture(fixture, census, context);
  validateEvidenceDeletionPins(fixture, census, context);
  for (const row of fixture.censusMutants) {
    const mutant = applyCensusMutant(census, fixture, row.operation);
    expectRefusal(
      () => validateFixture(mutant.fixture, mutant.census, context),
      `census mutant ${row.id}`,
    );
  }
  for (const row of fixture.fixtureMutants)
    expectRefusal(
      () => validateFixture(applyFixtureMutant(fixture, row.operation), census, context),
      `fixture mutant ${row.id}`,
    );
  for (const [path, source] of draftSources) validateDraftReviewSeed(source, path);
  const result = {
    schemaVersion: "finding-class-census-check-result/v1",
    censusDigest: sha256(JSON.stringify(census)),
    classCount: census.classes.length,
    roundRecordCount: roundSources.size,
    roundRecordSourcesDigest: sourceCorpusDigest(roundSources),
  };
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) fail("finding census checker accepts no arguments");
  await runFindingCensusCheck();
}
