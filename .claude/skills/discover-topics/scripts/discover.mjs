#!/usr/bin/env bun
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../../..");
const args = Bun.argv.slice(2);
const command =
  args[0] === undefined || args[0].startsWith("--") ? "run" : args[0];

const readFlag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at === -1 ? fallback : args[at + 1];
};

const WORK = resolve(
  ROOT,
  readFlag("work", "apps/pipeline/data/topic-discovery"),
);
const BUCKET = readFlag("bucket", "govbase-pipeline-documents-dev");
const TOPICS_FILE = join(ROOT, "apps/pipeline/config/topics.yaml");
const BATCH_SIZE = Number(readFlag("batch-size", "50"));
const SAMPLE = Number(readFlag("sample", "0"));
const FETCHES_AT_ONCE = 32;
const SHOWN_HEADINGS = 15;
const KEPT_HEADINGS = 40;
const LONGEST_HEADING = 120;
const MOST_NEW = 3;
const CLAIM_MINUTES = 30;
const TOKEN_MINUTES = 30;
const LEAST_COUNCILS = Number(readFlag("least-councils", "5"));
const PAGE_MARK = /^###### Page \d+ of \d+$/;
const HEADING_MARK = /^#{1,6} /;
const NAME_SHAPE = /^[a-z][a-z' -]{2,39}$/;
const BANNED_NAMES = new Set([
  "minutes",
  "agenda",
  "apologies",
  "apologies for absence",
  "declarations of interest",
  "any other business",
  "public questions",
  "matters arising",
  "date of next meeting",
  "exclusion of the public",
  "urgent business",
  "work programme",
  "forward plan",
  "committee",
  "council",
  "meeting",
  "report",
  "appendix",
  "decision",
  "recommendations",
  "membership",
  "attendance",
  "correspondence",
  "petitions",
  "motions",
  "announcements",
  "other",
  "general",
  "miscellaneous",
]);

const folders = {
  cache: join(WORK, "cache"),
  batches: join(WORK, "batches"),
  labels: join(WORK, "labels"),
  done: join(WORK, "done"),
  claims: join(WORK, "claims"),
};
const files = {
  headings: join(WORK, "cache/headings.jsonl"),
  items: join(WORK, "items.jsonl"),
  known: join(WORK, "known-topics.md"),
  vocabulary: join(WORK, "vocabulary.md"),
  report: join(WORK, "report.md"),
  reportData: join(WORK, "report.json"),
};

const stop = (message) => {
  console.error(message);
  process.exit(1);
};

const readLines = async (path) =>
  existsSync(path)
    ? (await Bun.file(path).text()).split("\n").filter((line) => line !== "")
    : [];

const readJsonLines = async (path) =>
  (await readLines(path)).map((line) => JSON.parse(line));

const readTopics = async () =>
  Bun.YAML.parse(await Bun.file(TOPICS_FILE).text()).topics;

const escapeWord = (word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const buildPattern = (phrases) =>
  new RegExp(
    phrases
      .map(
        (phrase) =>
          `\\b${phrase.split(/\s+/).map(escapeWord).join("\\s+")}\\b`,
      )
      .join("|"),
    "i",
  );

let heldToken = { value: "", atMs: 0 };

const readToken = () => {
  if (Date.now() - heldToken.atMs > TOKEN_MINUTES * 60_000) {
    const ran = Bun.spawnSync(["gcloud", "auth", "print-access-token"]);
    if (ran.exitCode !== 0)
      stop(
        `gcloud auth print-access-token failed. Run "gcloud auth login" first.\n${ran.stderr.toString()}`,
      );
    heldToken = { value: ran.stdout.toString().trim(), atMs: Date.now() };
  }
  return heldToken.value;
};

const fetchBucket = async (url) => {
  for (let at = 0; at < 5; at += 1) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${readToken()}` },
    }).catch(() => null);
    if (response !== null && response.ok) return response;
    if (response !== null && response.status === 404) return null;
    await Bun.sleep(1000 * 2 ** at);
  }
  return stop(`could not read ${url} after 5 tries`);
};

const API = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o`;
const objectUrl = (key) => `${API}/${encodeURIComponent(key)}?alt=media`;

const readSnapshot = async (store) => {
  const listed = await (
    await fetchBucket(
      `${API}?prefix=${encodeURIComponent(`${store}/snapshot/`)}&fields=items(name)`,
    )
  ).json();
  const newestKey = (listed.items ?? [])
    .map((item) => item.name)
    .sort()
    .at(-1);
  if (newestKey === undefined) stop(`no snapshot under ${store}/snapshot/`);
  console.log(`Reading ${newestKey}`);
  return (await (await fetchBucket(objectUrl(newestKey))).json()).objects;
};

const readIsCurrent = (record) => {
  const states = record.history.filter((entry) =>
    ["created", "updated", "archived", "unarchived"].includes(entry.event),
  );
  return states.length > 0 && states.at(-1).event !== "archived";
};

const readLinkedPapers = (listObjects) => {
  const events = new Map();
  const links = [];
  for (const [key, held] of Object.entries(listObjects)) {
    if (!key.startsWith("list/v3/events/data/")) continue;
    if (key.includes("/documents/")) links.push(held.object);
    else if (readIsCurrent(held.object)) events.set(held.object.id, held.object);
  }
  const papers = new Map();
  for (const link of links) {
    const event = events.get(link.eventId);
    if (event === undefined || !readIsCurrent(link) || link.id === link.eventId)
      continue;
    const held = papers.get(link.id);
    if (held === undefined)
      papers.set(link.id, {
        id: link.id,
        title: link.title,
        sourceId: event.sourceId,
      });
  }
  return papers;
};

const readTextKeys = (parseObjects, ocrObjects) => {
  const textKeys = new Map();
  for (const [key, held] of Object.entries(parseObjects)) {
    if (!key.startsWith("parse/v4/documents/data/")) continue;
    const parsed = held.object;
    const scanned = ocrObjects[`ocr/v4/data/${parsed.id}.json`]?.object;
    const isScanCurrent =
      scanned !== undefined &&
      scanned.contentHash === parsed.contentHash &&
      scanned.sdkVersion === parsed.sdkVersion;
    textKeys.set(parsed.id, isScanCurrent ? scanned.textKey : parsed.textKey);
  }
  return textKeys;
};

const cleanHeading = (line) =>
  line
    .replace(HEADING_MARK, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, LONGEST_HEADING);

const readHeadings = (markdown) => {
  const seen = new Set();
  for (const line of markdown.split("\n")) {
    if (PAGE_MARK.test(line) || !HEADING_MARK.test(line)) continue;
    const heading = cleanHeading(line);
    if (heading.length > 2) seen.add(heading);
    if (seen.size === KEPT_HEADINGS) break;
  }
  return [...seen];
};

const fetchHeadings = async (wantedKeys) => {
  const held = new Map(
    (await readJsonLines(files.headings)).map((row) => [
      row.textKey,
      row.headings,
    ]),
  );
  const missing = wantedKeys.filter((textKey) => !held.has(textKey));
  console.log(
    `Texts: ${wantedKeys.length} wanted, ${held.size} in the cache, ${missing.length} to fetch`,
  );
  let fetchedCount = 0;
  const takeNext = async () => {
    for (;;) {
      const textKey = missing.pop();
      if (textKey === undefined) return;
      const response = await fetchBucket(objectUrl(textKey));
      const headings =
        response === null ? [] : readHeadings(await response.text());
      held.set(textKey, headings);
      appendFileSync(
        files.headings,
        `${JSON.stringify({ textKey, headings })}\n`,
      );
      fetchedCount += 1;
      if (fetchedCount % 2000 === 0)
        console.log(`  fetched ${fetchedCount}, ${missing.length} left`);
    }
  };
  await Promise.all(Array.from({ length: FETCHES_AT_ONCE }, takeNext));
  return held;
};

const buildGroupKey = (title, headings) =>
  [title, ...headings]
    .join("\n")
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ");

const padId = (batchNumber) => String(batchNumber).padStart(4, "0");

const prepare = async () => {
  for (const folder of Object.values(folders))
    mkdirSync(folder, { recursive: true });
  if (readdirSync(folders.done).length > 0 && !args.includes("--again"))
    stop(
      `Batches are already labelled in ${WORK}. Run "next" to carry on, or "prepare --again" with a new --work folder to start over.`,
    );
  const topics = await readTopics();
  const patterns = topics.map((topic) => ({
    name: topic.name,
    pattern: buildPattern(topic.phrases),
  }));
  const papers = readLinkedPapers(await readSnapshot("list/v3"));
  const textKeys = readTextKeys(
    await readSnapshot("parse/v4"),
    await readSnapshot("ocr/v4"),
  );
  const readable = [...papers.values()]
    .filter((paper) => textKeys.has(paper.id))
    .sort((first, second) => first.id.localeCompare(second.id));
  const chosen = SAMPLE > 0 ? readable.slice(0, SAMPLE) : readable;
  console.log(
    `Papers: ${papers.size} linked, ${readable.length} with a text, ${chosen.length} chosen`,
  );
  const headingsByKey = await fetchHeadings(
    chosen.map((paper) => textKeys.get(paper.id)),
  );
  const groups = new Map();
  for (const paper of chosen) {
    const headings = (headingsByKey.get(textKeys.get(paper.id)) ?? []).slice(
      0,
      SHOWN_HEADINGS,
    );
    const groupKey = buildGroupKey(paper.title, headings);
    const group = groups.get(groupKey) ?? {
      title: paper.title,
      headings,
      papers: 0,
      sources: new Set(),
      docIds: [],
    };
    group.papers += 1;
    group.sources.add(paper.sourceId);
    if (group.docIds.length < 3) group.docIds.push(paper.id);
    groups.set(groupKey, group);
  }
  const items = [...groups.values()]
    .sort(
      (first, second) =>
        second.sources.size - first.sources.size ||
        second.papers - first.papers ||
        first.title.localeCompare(second.title),
    )
    .map((group, at) => {
      const shownText = [group.title, ...group.headings].join("\n");
      return {
        n: at + 1,
        title: group.title,
        headings: group.headings,
        covered: patterns
          .filter((known) => known.pattern.test(shownText))
          .map((known) => known.name),
        papers: group.papers,
        sources: [...group.sources],
        docIds: group.docIds,
      };
    });
  await Bun.write(
    files.items,
    items.map((item) => JSON.stringify(item)).join("\n"),
  );
  for (let at = 0; at < items.length; at += BATCH_SIZE)
    await Bun.write(
      join(folders.batches, `${padId(at / BATCH_SIZE + 1)}.jsonl`),
      items
        .slice(at, at + BATCH_SIZE)
        .map((item) =>
          JSON.stringify({
            n: item.n,
            title: item.title,
            headings: item.headings,
            covered: item.covered,
          }),
        )
        .join("\n"),
    );
  await Bun.write(
    files.known,
    `# Known topics\n\nThese ${topics.length} topics are already counted. Never output one of them as new.\n\n${topics.map((topic) => `- ${topic.name}`).join("\n")}\n`,
  );
  if (!existsSync(files.vocabulary))
    await Bun.write(files.vocabulary, "# New topic names so far\n\nNone yet.\n");
  console.log(
    `Prepared ${items.length} items in ${Math.ceil(items.length / BATCH_SIZE)} batches under ${WORK}`,
  );
};

const readBatchIds = () =>
  existsSync(folders.batches)
    ? readdirSync(folders.batches)
        .filter((name) => name.endsWith(".jsonl"))
        .map((name) => name.replace(".jsonl", ""))
        .sort()
    : [];

const readDoneIds = () =>
  new Set(readdirSync(folders.done).map((name) => name.replace(".ok", "")));

const readIsClaimed = (batchId) => {
  const claimPath = join(folders.claims, batchId);
  return (
    existsSync(claimPath) &&
    Date.now() - statSync(claimPath).mtimeMs < CLAIM_MINUTES * 60_000
  );
};

const next = async () => {
  const batchIds = readBatchIds();
  if (batchIds.length === 0) stop('No batches. Run "prepare" first.');
  const doneIds = readDoneIds();
  const openIds = batchIds.filter((batchId) => !doneIds.has(batchId));
  const batchId = openIds.find((openId) => !readIsClaimed(openId));
  if (openIds.length === 0) {
    console.log('ALL DONE. Run "report".');
    return;
  }
  if (batchId === undefined) {
    console.log(
      `WAIT. ${openIds.length} batches are open and all are claimed by another session.`,
    );
    return;
  }
  await Bun.write(join(folders.claims, batchId), new Date().toISOString());
  console.log(
    [
      `BATCH ${batchId} (${doneIds.size} of ${batchIds.length} done)`,
      `1. Read  ${files.vocabulary}`,
      `2. Read  ${join(folders.batches, `${batchId}.jsonl`)}`,
      `3. Write ${join(folders.labels, `${batchId}.jsonl`)}`,
      `4. Run   bun ${Bun.argv[1]} check ${batchId} --work ${WORK}`,
    ].join("\n"),
  );
};

const buildNameKey = (name) =>
  name
    .split(" ")
    .map((word) => (word.length > 3 ? word.replace(/s$/, "") : word))
    .join(" ");

const readTally = async () => {
  const itemsByNumber = new Map(
    (await readJsonLines(files.items)).map((item) => [item.n, item]),
  );
  const tally = new Map();
  for (const batchId of readDoneIds())
    for (const row of await readJsonLines(
      join(folders.labels, `${batchId}.jsonl`),
    )) {
      const item = itemsByNumber.get(row.n);
      for (const found of row.new) {
        const nameKey = buildNameKey(found.name);
        const entry = tally.get(nameKey) ?? {
          names: new Map(),
          papers: 0,
          sources: new Set(),
          evidence: new Map(),
          titles: [],
        };
        entry.names.set(
          found.name,
          (entry.names.get(found.name) ?? 0) + item.papers,
        );
        entry.papers += item.papers;
        for (const sourceId of item.sources) entry.sources.add(sourceId);
        const phrase = found.evidence.toLowerCase();
        entry.evidence.set(
          phrase,
          (entry.evidence.get(phrase) ?? 0) + item.papers,
        );
        if (entry.titles.length < 3) entry.titles.push(item.title);
        tally.set(nameKey, entry);
      }
    }
  const readTop = (counts, most) =>
    [...counts.entries()]
      .sort((first, second) => second[1] - first[1])
      .slice(0, most)
      .map(([text]) => text);
  return [...tally.values()]
    .map((entry) => ({
      name: readTop(entry.names, 1)[0],
      papers: entry.papers,
      councils: entry.sources.size,
      phrases: readTop(entry.evidence, 6),
      titles: entry.titles,
    }))
    .sort(
      (first, second) =>
        second.councils - first.councils || second.papers - first.papers,
    );
};

const saveVocabulary = async () => {
  const tally = await readTally();
  await Bun.write(
    files.vocabulary,
    `# New topic names so far\n\nUse one of these names, spelled the same, when it fits. Make a new name only when none fits.\n\n${
      tally.length === 0
        ? "None yet."
        : tally
            .slice(0, 300)
            .map((entry) => `- ${entry.name}`)
            .join("\n")
    }\n`,
  );
};

const readRowProblems = (row, item, knownNames) => {
  if (!Array.isArray(row.new)) return ['"new" must be a list'];
  if (row.new.length > MOST_NEW) return [`at most ${MOST_NEW} new topics`];
  const shownText = [item.title, ...item.headings].join("\n").toLowerCase();
  return row.new.flatMap((found) => {
    const name = found?.name;
    const evidence = found?.evidence;
    if (typeof name !== "string" || typeof evidence !== "string")
      return ['each new topic needs a "name" and an "evidence" string'];
    if (!NAME_SHAPE.test(name) || name.split(" ").length > 4)
      return [
        `name "${name}" must be 1 to 4 lowercase words, letters only, 3 to 40 characters`,
      ];
    if (BANNED_NAMES.has(name))
      return [`name "${name}" is meeting procedure, not a subject. Remove it`];
    if (knownNames.has(name))
      return [`name "${name}" is a known topic. Remove it`];
    if (
      evidence.trim().length < 3 ||
      !shownText.includes(evidence.trim().toLowerCase())
    )
      return [
        `evidence "${evidence}" is not copied from the title or a heading of item ${item.n}. Copy the exact words, or remove the topic`,
      ];
    const evidenceText = evidence.toLowerCase().replace(/[^a-z]+/g, " ");
    const hasSharedWord = name
      .split(/[ -]/)
      .filter((word) => word.length > 3)
      .some((word) => evidenceText.includes(word.replace(/(ing|s)$/, "")));
    if (!hasSharedWord)
      return [
        `evidence "${evidence}" shares no word with the name "${name}". Use the words of the paper as the name, or remove the topic`,
      ];
    return [];
  });
};

const check = async () => {
  const batchId = args[1];
  const batchPath = join(folders.batches, `${batchId}.jsonl`);
  const labelPath = join(folders.labels, `${batchId}.jsonl`);
  if (!existsSync(batchPath)) stop(`No batch ${batchId}.`);
  if (!existsSync(labelPath)) stop(`FAIL. ${labelPath} does not exist.`);
  const items = new Map(
    (await readJsonLines(batchPath)).map((item) => [item.n, item]),
  );
  const knownNames = new Set(
    (await readTopics()).flatMap((topic) => [
      topic.name.toLowerCase(),
      topic.id.replaceAll("-", " "),
    ]),
  );
  const problems = [];
  const seen = new Set();
  for (const [at, line] of (await readLines(labelPath)).entries()) {
    let row = null;
    try {
      row = JSON.parse(line);
    } catch {
      problems.push(`line ${at + 1}: not valid JSON`);
      continue;
    }
    const item = items.get(row.n);
    if (item === undefined) {
      problems.push(`line ${at + 1}: n ${row.n} is not in this batch`);
      continue;
    }
    if (seen.has(row.n)) problems.push(`line ${at + 1}: n ${row.n} is repeated`);
    seen.add(row.n);
    for (const problem of readRowProblems(row, item, knownNames))
      problems.push(`n ${row.n}: ${problem}`);
  }
  for (const itemNumber of items.keys())
    if (!seen.has(itemNumber))
      problems.push(`n ${itemNumber}: missing. Every item needs one line`);
  if (problems.length > 0) {
    console.log(
      `FAIL. ${problems.length} problems in ${labelPath}:\n${problems.slice(0, 40).join("\n")}\nFix these lines, write the whole file again, and run check again.`,
    );
    process.exit(1);
  }
  await Bun.write(join(folders.done, `${batchId}.ok`), "");
  await saveVocabulary();
  console.log(
    `OK. Batch ${batchId} passed. ${readDoneIds().size} of ${readBatchIds().length} done. Run "next".`,
  );
};

const status = () => {
  const batchIds = readBatchIds();
  const doneCount = batchIds.length === 0 ? 0 : readDoneIds().size;
  console.log(`${doneCount} of ${batchIds.length} batches done in ${WORK}`);
};

const report = async () => {
  const tally = await readTally();
  const shown = tally.filter((entry) => entry.councils >= LEAST_COUNCILS);
  const doneCount = readDoneIds().size;
  const lines = [
    "# Topic discovery report",
    "",
    `Batches labelled: ${doneCount} of ${readBatchIds().length}. Candidate names: ${tally.length}. Shown below: the ${shown.length} seen in ${LEAST_COUNCILS} or more councils.`,
    "",
    "A candidate is a subject found in a paper's link title or headings that no topic in `apps/pipeline/config/topics.yaml` covers. The phrases are the exact words found, so they can go into a phrase list as they are.",
    "",
    "| Candidate | Councils | Papers | Phrases found | Example titles |",
    "| --- | --- | --- | --- | --- |",
    ...shown.map(
      (entry) =>
        `| ${entry.name} | ${entry.councils} | ${entry.papers} | ${entry.phrases.join("; ")} | ${entry.titles.map((title) => title.replaceAll("|", "/")).join("; ")} |`,
    ),
    "",
  ];
  await Bun.write(files.report, lines.join("\n"));
  await Bun.write(files.reportData, JSON.stringify(tally, null, 2));
  console.log(
    `Report: ${files.report}\nData: ${files.reportData}\nTop 15:\n${shown
      .slice(0, 15)
      .map(
        (entry) =>
          `  ${entry.name}: ${entry.councils} councils, ${entry.papers} papers`,
      )
      .join("\n")}`,
  );
};

const SESSIONS = Number(readFlag("sessions", "1"));
const SESSION_BATCHES = Number(readFlag("batches-per-session", "40"));

const runLabelSession = () =>
  Bun.spawn(
    [
      "claude",
      "-p",
      `Use the discover-topics skill. The batches are prepared, so do not run prepare. Add "--work ${WORK}" to every command. Label batches until "next" prints ALL DONE or WAIT, or you have passed ${SESSION_BATCHES} batches in this session. Then stop. Do not run report.`,
      "--model",
      "haiku",
      "--permission-mode",
      "acceptEdits",
      "--allowedTools",
      "Read,Write,Skill,Bash(bun:*)",
    ],
    { cwd: ROOT, stdout: "inherit", stderr: "inherit" },
  ).exited;

const run = async () => {
  for (const folder of Object.values(folders))
    mkdirSync(folder, { recursive: true });
  if (readBatchIds().length === 0) await prepare();
  const batchCount = readBatchIds().length;
  let stalledRounds = 0;
  while (readDoneIds().size < batchCount && stalledRounds < 2) {
    const doneBefore = readDoneIds().size;
    console.log(
      `Labelling with Haiku: ${doneBefore} of ${batchCount} batches done, ${SESSIONS} sessions at once`,
    );
    await Promise.all(Array.from({ length: SESSIONS }, runLabelSession));
    stalledRounds = readDoneIds().size === doneBefore ? stalledRounds + 1 : 0;
  }
  await report();
  if (stalledRounds === 2)
    stop(
      "Stopped: two rounds of Claude sessions passed no batch. Check that the claude command works and is logged in, then run this again.",
    );
};

const commands = { run, prepare, next, check, status, report };
if (commands[command] === undefined)
  stop(
    "usage: bun discover.mjs [run] [--sample N] [--sessions N] | prepare | next | check <batch> | status | report",
  );
await commands[command]();
