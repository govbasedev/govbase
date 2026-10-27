# Parse runs of 25 October: tasks out of memory, and the files that killed them

As of 25 October 2026. Two Cloud Run executions of the parse step failed: `govbase-pipeline-dev-mpc68` and `govbase-pipeline-dev-w78s6`. This doc says how far they got, how the files that killed each task were found, and what those files are. The job and the shares are described in `pipeline-parse-in-the-cloud.md`.

**Words used in this section**

- **Execution**: one run of the Cloud Run job, with a name such as `govbase-pipeline-dev-w78s6`.
- **Task**: one copy of the pipeline inside an execution. Each task parses one share.
- **Share**: the documents of one task. A document is in share `s` of `n` when its id, read as a number, leaves `s` when divided by `n`.
- **Try**: one start of a task. Cloud Run starts a task again after it fails, up to 2 more times, so a task has at most 3 tries.
- **Kill**: the end of a try because it used more memory than its limit. The log shows `Container called exit(137).`
- **Record**: the object the parse step saves for a done document, in `parse/v3/documents/data/` or `parse/v3/documents/errors/`.

## Short answers

1. Both executions failed the same way. Every task ran out of memory on all 3 of its tries: 60 kills in `mpc68` and 30 kills in `w78s6`.
2. The two executions still parsed 51,567 of the 135,160 documents: 18,896 in `mpc68` and 32,671 in `w78s6`. 83,593 are left.
3. No done document is lost. A document has a record only when it is done, and the next run skips every document with a record. A kill loses only the 2 documents in progress.
4. The log does not name the document in progress. The files were found from the times of the records in the bucket and the times of the kills in the log.
5. 110 different files were in progress at a kill. All 110 are PDFs. None is an image file.
6. Most of the files that kill are PDFs full of pictures: thousands of pictures, very large pictures, scans, or JPEG 2000. A few do not fit this pattern.
7. 24 files never finished, even with 4 GiB. They block their shares, because each try starts with them again.

## A. The two executions

**Words used in this section**

- **GiB**: a gibibyte, 1,073,741,824 bytes. Cloud Run sets the memory of a task in GiB.
- **At once**: `parse.documentsAtOnce`, the number of documents one task parses at the same time. The secret config sets it to 2.

| | `mpc68` | `w78s6` |
| --- | --- | --- |
| Tasks | 20 | 10 |
| Memory per task | 2 GiB | 4 GiB |
| At once | 2 | 2 |
| First document | 23:22 UTC, 24 October | 10:25 UTC, 25 October |
| Last kill | 01:32 UTC, 25 October | 14:28 UTC, 25 October |
| Run time | 2 hours 10 minutes | 4 hours 3 minutes |
| Kills | 60, every task 3 times | 30, every task 3 times |
| Documents done | 18,896 | 32,671 |

The clocks in the UK and Europe went back one hour at 01:00 UTC on 25 October. So the console shows `mpc68` from 1:22 AM to 2:32 AM, which looks like 70 minutes, but it ran for 130 minutes.

In `mpc68` the memory of a task went up and down between about 0.5 and 2.0 GiB, one sample a minute. It did not grow slowly. It jumped with each document.

The "Documents left" panel on the parse board read too low after the kills. When a task dies, its count drops out of the sum.

## B. How the files were found

**Words used in this section**

- **Due**: a document of the share that has no record yet.
- **In progress**: one of the 2 documents a try is parsing at a given moment.

The log has no line that names the document a try is parsing. It names the share and the count of due documents when a try starts, such as `Parsing 12814 of 116264 read items, share 4 of 10, 2 at once`, and it shows each kill. So the files were found from the bucket:

1. A try lists its due documents in id order and parses them in that order, 2 at a time.
2. A document gets its record only when it is done. The record is saved last, after the images and the markdown.
3. So when a try is killed, every document before the 2 in progress is done, and nothing after them has started. The first 2 due documents at the moment of the kill are the 2 in progress.
4. The bucket keeps the time each record was saved. The log keeps the time of each kill. For each kill, the script takes the share's documents, removes those with a record saved before the kill, and keeps the first 2.

**Check of the method.** For every one of the 90 tries, the count of due documents worked out from the bucket matches the count in the try's `Parsing` line, to within 2. The small differences come from the bucket's times, which are in whole seconds.

**Limits of the method.**

- When 2 documents are in progress together at every kill, the method cannot say which of them is the killer.
- A kill can come from 2 heavy documents together, not from one alone.
- A file with 1 kill was in progress only at a task's last kill. It may be an innocent partner of the real killer.

The data and the scripts are in `apps/pipeline/data/oom/`, which git ignores:

| File | What it holds |
| --- | --- |
| `read.json` | every read document: id, size, content type |
| `parse-data.json`, `parse-errors.json` | every parse record: id and time saved |
| `logs.json` | the `Parsing` lines and the kills of both executions |
| `killed-files.txt` | every kill, the 2 files in progress, and each file's type, size and whether it was ever done |
| `killed-files-named.tsv` | the 110 files with council, meeting, date, title and address |
| `pdf-facts.txt` | pages, page size and pictures of the 24 files that never finished |
| `killer-records/`, `control-records/` | parse records of 86 killing files that finished later, and of 94 other big PDFs |
| `pdfs/` | the 24 PDFs that never finished |
| `events/` | all 13,105 meeting records |
| `scripts/` | `findKilledFiles.mjs`, `sizes.mjs`, `records.mjs`, `inspect_pdfs.py`, `titles.mjs` |

Run the scripts from `apps/pipeline`, such as `bun data/oom/scripts/findKilledFiles.mjs data/oom`, and `python3 -I data/oom/scripts/inspect_pdfs.py data/oom/pdfs data/oom/killed-files.txt`.

## C. The files

**Words used in this section**

- **Picture**: an image inside a PDF, such as a photo, a map or a scanned page.
- **Mpx**: million pixels. A pixel is one dot of a picture.
- **Scan page**: a page that is a picture of paper, with no text in it.
- **JPEG 2000**: a picture format, `JPXDecode` inside a PDF. It needs much more memory to open than a normal JPEG.

**They are PDFs, and big ones.** All 110 files are PDFs. The whole backlog has 122,443 PDFs, 12,638 web pages, 70 Word files, 8 PNG images and 1 text file. None of the 8 PNG files was in progress at a kill.

| | The 110 files | All PDFs |
| --- | --- | --- |
| Middle size | 10.9 MB | 0.2 MB |
| In the biggest 10 percent | 99 of 110 | |
| In the biggest 1 percent | 52 of 110 | |

Size is not the full answer. Two PDFs of 80 MB and 109 MB parsed without a problem.

**Files that finished later.** 86 of the 110 files were finished by a later try, most of them in `w78s6` with 4 GiB. So they need more than 2 GiB but less than 4 GiB. Their parse records were compared with those of 94 other PDFs over 10 MB that never caused a kill:

| | 86 killing files that finished later | 94 other big PDFs |
| --- | --- | --- |
| Middle size | 10.7 MB | 15.8 MB |
| Middle page count | 36 | 57 |
| Mostly scan pages | 27 | 15 |
| 50 or more pictures | 33 | 36 |
| Most pictures in one file | 6,146 | 890 |
| Most Mpx of pictures in one file | 590 | 333 |

So scans are twice as common in the killing files, but most of them are not scans. The clear difference is at the top: the killing files hold far more pictures and far more Mpx than any of the others.

**The 24 files that never finished.** Pictures are counted inside the PDF with `pypdf`, one count for each different picture.

| Kills | Council | Document | Pages | Pictures | All pictures | Id starts |
| --- | --- | --- | --- | --- | --- | --- |
| 6 | Swale | Appendix A 801-934 | 134 | 17,650 | 993 Mpx | `21b5931c246d` |
| 6 | City of London | 65 Crutched Friars, S73 presentation | 23 | 33 | 54 Mpx | `0682c12488cd` |
| 6 | Horsham | Appendix 7 Policies Map Pack 5 | 4 | 22, JPEG 2000 | 38 Mpx | `06856823ebd2` |
| 3 | Harrow | Harrow town centre Baseline Report | 76 | 301, mostly JPEG 2000 | 88 Mpx | `1031cb1dcfac` |
| 3 | Middlesbrough | Supplementary Evidence, Premises Licence Holder | 138 | 289, scans | 835 Mpx | `1073e2ea2077` |
| 3 | East Hertfordshire | Appendix I5 Surface Water Climate Change Part 1 | 16 | 120 | 93 Mpx | `63f49f4504fb` |
| 3 | Cotswold | Draft Heritage Impact Assessment Appendices Part 3 | 88 | 31 | 61 Mpx | `3e8f20ce4f4e` |
| 3 | Dacorum | LAGSC Annex A, Camelot RUF Club | 93 | 2,381 | 587 Mpx | `3842a8e6bd33` |
| 3 | Cumberland | Land north of Crindledyke Lane, Carlisle: PLANS | 33 | 7,727 | 23 Mpx | `67bb30782526` |
| 3 | Cheshire West and Chester | Draft NWAS Quality Account 2025-26 | 93 | 6,525 | 4 Mpx | `90e94530a41c` |
| 2 | Swale | Appendix A 601-700 | 100 | 6,305 | 518 Mpx | `6061016532ee` |
| 2 | Cheshire East | Key Plans 25 4697 FUL, A1 pages | 25 | 1,519, mostly JPEG 2000 | 200 Mpx, one of 70 Mpx | `98a297ac5a14` |
| 1 | East Hertfordshire | Appendix I10 Groundwater Emergence Part 1 | 22 | 134 | 76 Mpx | `4af3b2538de7` |
| 1 | Carmarthenshire | Appendix A | 21 | 21 | 81 Mpx | `64c6906c6923` |
| 1 | North Kesteven | Housing Regulatory Dashboard Q4 2025/26 | 33 | 1 | 1 Mpx | `2eb9b597f1e1` |
| 1 | Blackburn with Darwen | 10-25-0883 committee report | 123 | 92 | 130 Mpx | `4a68fbce0496` |
| 1 | North Warwickshire | Full Council Appendices | 1,257 | 147 | 60 Mpx | `4101c248587d` |
| 1 | Powys | Powys LDP Annual Monitoring Report 2026 | 230 | 5 | 1 Mpx | `68890ba56b3f` |
| 1 | Hackney | Business Critical Performance Dashboard | 25 | 44 | 1 Mpx | `6a8de4dd93bf` |
| 1 | Stroud | Appendix A, Plans 1 to 5 | 5 | 108 | 328 Mpx | `6ab98787e45f` |
| 1 | East Lothian | Occasional Application, Kilduff Farm | 7 | 7 | 14 Mpx | `7d6ea4867230` |
| 1 | Halton | Appendix 1 Halton CSAM Report | 64 | 7,715 | 15 Mpx | `967e12b3ec81` |
| 1 | Charnwood | Housing Asset Management Strategy 2026-2028 | 38 | 14 | 9 Mpx | `96c30efb5687` |
| 1 | Wychavon | Rep 3 Address redacted | 2 | 6 | 16 Mpx | `9d79e4eaeeb1` |

How to read the table:

- The first 12 rows have 2 or more kills, so they are almost certainly killers. 8 of them have thousands of pictures, very large pictures, scans, or JPEG 2000.
- `3e8f20ce4f4e` from Cotswold does not fit. It has 31 pictures in 88 pages, but it was in progress at 3 kills, each time with a different partner.
- `0682c12488cd` and `06856823ebd2` were in progress together at all 6 of their kills, so the method cannot split them. The Horsham file holds JPEG 2000 pictures.
- Swale's Appendix A comes in parts. Two of them, "801-934" and "601-700", are here. The other parts are probably just as heavy.
- Most of the 24 are maps, plans, and appendices full of photos, many of them for planning applications.

## D. Why pictures use so much memory

**Words used in this section**

- **PNG**: a picture format with no loss. The parser SDK saves every picture in it.

The parser SDK returns a document's pictures as one list of PNG files in memory, the `images` of the document read. The pipeline saves them only after the whole document is read. So all the pictures of one document are in memory at the same time. A PNG of a photo is often several times bigger than the JPEG it came from. A task parses 2 documents at once, so 2 heavy documents add up.

This is the probable reason. It is not proven: no file was parsed alone with its memory measured.

## E. Why a killer blocks its share

Each try lists the due documents of its share in id order. A file that kills is still due after the kill, so it is near the front of the list on the next try, and it kills that try too. After 3 tries the task stops, and the rest of its share is not parsed.

Share 4 shows it. In `w78s6`, task 4 had 12,814 documents due on all 3 tries, and each try was killed about 1 minute after it started. It finished none.

The task count went from 20 to 10 between the executions. A file that kills moves to a different share when the count changes, and it kills that share instead. Share 4 of 20 is part of share 4 of 10, so the same 2 files killed task 4 in both executions.

## Sources

- Executions: `https://console.cloud.google.com/run/jobs/execution/us-central1/govbase-pipeline-dev-mpc68?project=govwatch-pipeline` and the same address with `govbase-pipeline-dev-w78s6`.
- Grafana, parse board, for the memory and the counts of `mpc68`: `max_over_time(govbase_pipeline_memory_rss_bytes[134m])` and `sum by (outcome) (increase(govbase_pipeline_parsed_documents_total[134m]))` at 01:36 UTC.
- The owner's commands that made the data in `apps/pipeline/data/oom/`:

```sh
B=gs://govbase-pipeline-documents-dev
gcloud storage objects list "$B/read/v2/documents/data/*" --format="json(name,size,content_type,contentType)" > data/oom/read.json
gcloud storage objects list "$B/parse/v3/documents/data/*" --format="json(name,update_time,updated)" > data/oom/parse-data.json
gcloud storage objects list "$B/parse/v3/documents/errors/*" --format="json(name,update_time,updated)" > data/oom/parse-errors.json
gcloud logging read 'resource.type="cloud_run_job" AND (labels."run.googleapis.com/execution_name"="govbase-pipeline-dev-mpc68" OR labels."run.googleapis.com/execution_name"="govbase-pipeline-dev-w78s6") AND ("Parsing" OR "exit(137)")' --freshness=2d --format=json > data/oom/logs.json
gcloud storage cp -I data/oom/killer-records/ < data/oom/parsed-later-urls.txt
gcloud storage cp -I data/oom/control-records/ < data/oom/control-urls.txt
sed "s#^#$B/read/v2/documents/data/#" data/oom/never-done.txt | gcloud storage cp -I data/oom/pdfs/
gcloud storage cp "$B/list/v2/events/data/*" data/oom/events/
```
