# govbase intelligence

govbase turns published council meeting papers into structured, traceable judgments about what councils are about to decide and what they decided.

## People

**Analyst**:
The first user: a public-affairs or consultancy analyst who follows national issues across many councils for clients.
_Avoid_: customer, reader, subscriber

**Labeller**:
A person who records the correct answer for an item, without seeing which method chose it.
_Avoid_: annotator, reviewer

## Meeting material

**Agenda item**:
One numbered item of business in one meeting of one council committee. It is the unit every judgment is about.
_Avoid_: item of business, motion, report

**Agenda text**:
The short text published under an agenda item before the meeting.

**Minutes text**:
The text recorded under an agenda item after the meeting.
_Avoid_: resolution, decision text

**Document**:
A report or appendix linked to one agenda item.
_Avoid_: attachment, paper, pack

**Procedural item**:
An agenda item that only runs the meeting, such as apologies, declarations of interest, or "no petitions were received".
_Avoid_: housekeeping item, standing item

**Private-case item**:
An agenda item about a named person or their property: licensing business, standards complaints, and planning applications.
_Avoid_: sensitive item, personal item

**Withdrawn item**:
An agenda item or document that a council has removed or restricted after it was first seen.

## People in the papers

**Private individual**:
A person named or identifiable in the papers who is not acting as a councillor or council officer, such as a member of the public, an applicant, or an objector. An address can identify one.
_Avoid_: member of the public, third party

## Subjects

**Issue**:
A national policy question that many councils respond to and can take a position on, such as local government reorganisation or devolution. An item can be about none, one, or several issues.
_Avoid_: theme, subject

**Programme**:
A named group of related issues that an analyst can follow together, such as English devolution and local government reorganisation.
_Avoid_: issue group, umbrella issue

**Service area**:
A field of council work with no position attached, such as contracts or temporary accommodation. An item has one main service area.
_Avoid_: department, category

**Topic**:
A broad subject that councils discuss, such as roads or the cost of living, named in `apps/pipeline/config/topics.yaml` with the plain phrases that stand for it. A topic has no position attached. An item can mention any number of topics, and the pipeline counts the mentions.
_Avoid_: tag, category

**Mentions**:
An item mentions an issue when a word for the issue appears anywhere in its evidence. Mentioning says nothing about what the item is for.
_Avoid_: matches, refers to

**About**:
An item is about an issue when the issue is the subject of the action the meeting is asked to take, or a part of the item set out on its own, such as its own section or recommendation.
_Avoid_: relevant to, related to, tagged with

**Decides on**:
An item decides on an issue when the meeting is asked to decide, or did decide, something about that issue itself. A decision on a different matter in the same item does not count, and neither does noting.
_Avoid_: decision about, acts on

**Issue register**:
The list of issues and programmes, each issue with its definition and its exclusions. Changing a definition makes a new version of that issue.
_Avoid_: taxonomy, topic list

## Stages

**Agenda stage**:
The time between an item's agenda being published and its meeting, when only agenda text and documents exist.
_Avoid_: pre-meeting, forward look

**Minutes stage**:
The time after an item's minutes are published.
_Avoid_: post-meeting, backward look

**First seen**:
The time the pipeline first held an item version.

**Forecast**:
An agenda-stage judgment that was stored before the meeting date. A judgment made after the meeting is never a forecast.
_Avoid_: prediction

**Recommendation**:
What officers or a committee ask a decision-making body to agree. It is shown as "recommended, not decided".
_Avoid_: proposal, proposed decision

**Rebuilt item version**:
An agenda-stage item version made after the meeting from the agenda text and the documents published on or before the meeting date. It is never a forecast.
_Avoid_: backfilled version, reconstructed forecast

**Decision span**:
A sentence or list item in the minutes text that records a decision. An item can hold several.
_Avoid_: decision sentence, resolution line, RESOLVED line

**Decision group**:
The decision spans that together make one decision, such as a motion in one sentence and "the motion was carried" in the next.

**Noting**:
A resolution that only receives or notes information. It is kept apart from a substantive decision.
_Avoid_: noted decision

**Council position**:
A council's stance on an issue, taken only by the body that holds the power to decide it. A recommendation, a failed motion, or a member's statement is never a council position.
_Avoid_: council view, stance

## Judgments

**Item version**:
An agenda item together with the exact evidence available about it at one time. A new version exists when the evidence changes, for example when minutes arrive.
_Avoid_: snapshot, revision

**Evidence**:
The exact text sent for judgment about one item version: agenda text, minutes text, and the openings of its documents.
_Avoid_: context, input, prompt

**Judgment**:
The raw answer a model gave to one question about one item version, kept with the question version and model version.
_Avoid_: label, classification, prediction, tag

**Label**:
The correct answer to one question about one item, recorded by a labeller. Labels are ground truth; judgments are not.
_Avoid_: annotation, gold

**Practice sample**:
Labelled items used to set the keyword baseline and the thresholds. Nothing is measured on it.
_Avoid_: training set, dev set

**Test sample**:
Labelled items, kept apart from the practice sample, used to compare judgments with the keyword baseline.
_Avoid_: eval set, gold set

## Delivery

**Brief**:
The regular summary an analyst receives for the issues they follow: upcoming items and recent decisions.
_Avoid_: digest, newsletter, report

**Alert**:
A short message between briefs about a new agenda item on a followed issue whose meeting comes before the next brief.
_Avoid_: notification, ping

**Keyword baseline**:
A fixed keyword rule that answers the same question as a judgment, used to test whether judgments are better.
_Avoid_: keyword search, regex match

## Pipeline

**Step**:
One stage of the pipeline that runs on its own interval and owns one store: list, read, ocr, judge, plan, send.
_Avoid_: worker, worker pool, service

**Run**:
One pass of one step, started on its interval, over what its store holds. There is no run of the whole pipeline.
_Avoid_: tick, pass, cycle, job

**Store**:
The place a step writes its results, and the only way steps hand work to each other. Each step owns one store and writes nowhere else.
_Avoid_: ledger, database, queue

**Outcome**:
The latest record of a document or council in a step's store, replaced on each attempt.
_Avoid_: state, status

**Event**:
One note of one change in a step's store, never replaced, kept for history.
_Avoid_: log entry, audit row

**Pending scan**:
A document whose page images have not yet been read.
_Avoid_: OCR job, backlog item

**Changed council**:
A council whose listing differs from the last one read.
_Avoid_: dirty, stale, touched

**Lost council**:
A council with no listing for longer than the lost period.
_Avoid_: failed, down, unreachable

**First listing**:
The first time a council is listed, when meetings older than the first-listing cap are left out.
_Avoid_: backfill, initial crawl, onboarding

**Share**:
One of the equal parts of the pending scans that one OCR process takes.
_Avoid_: slot, shard, partition

**Heartbeat**:
The time of a step's last run, sent as a metric from the run itself, so a hang makes it stale.
_Avoid_: liveness, ping

**Alarm**:
A Grafana rule that has fired about the pipeline, the browser or the relay. An alert is a message to an analyst, never this.
_Avoid_: alert, notification
