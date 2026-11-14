# Site hosting: the Cloudflare limits, serving the site from R2, a million pages, and search

Written 13 November 2026. Findings only. This document states facts, how
they were found, and what is not known. It makes no recommendation.

## 1. The question

### Words used in this section

- **Static site**: a site made of files that are built once and then sent
  as they are. No program makes a page when a reader asks for it.
- **Host**: the service that keeps the files and sends them to readers.
- **Worker**: a small program that runs on Cloudflare for each request.
- **R2**: Cloudflare's file store. A file in it is an **object**, and a
  group of objects is a **bucket**.
- **Way 2**: the name used in the chat for this design: the built files
  go into an R2 bucket, and one small Worker sends the right file for
  each address.

### The question

The Govbase site is a static site. The owner asked two things:

1. What are Cloudflare's present limits for a static site?
2. What are the good and bad points of way 2, looked at in depth?

The reason for the question is growth. The owner asked what happens when
the site holds 10 times more meetings. Later the owner asked a third
thing:

3. What happens at a million pages? The owner plans to add UK government
   meetings, the Lords, committees and government organisations, and
   says that these can easily pass one million pages.

Sections 6 and 7 cover the third question. Section 8 covers search,
which the third question leads to.

## 2. The size of the site today

### Words used in this section

- **Build**: one run of `bun run build`. It writes the whole site into
  the `dist/` folder.
- **Pagefind**: the search tool that Starlight uses. It writes its search
  index as many small files at the end of a build.
- **gzip**: a common way to make a text file smaller before it is sent.

### Measured

These numbers are from a full build of the Starlight version of the site,
from the data file built on 12 November 2026.

| Thing | Value |
| --- | --- |
| Files in `dist/` | 9,126 |
| HTML pages | 6,060 |
| Pagefind files | 3,053 |
| Total size | 836 MB |
| Size of the Pagefind index | 166 MB |
| Largest file | 11.7 MB, one Haringey meeting page |
| The same file after gzip | 1.4 MB |
| Files over 5 MB | 4 |
| Meeting page, middle size | 306 KB |
| Meeting page, 9 of 10 are under | 1.0 MB |
| Build time | About 7 minutes |

The 6,060 pages are made of these kinds:

| Kind of page | Count today | Upper limit |
| --- | --- | --- |
| Meeting | 1,045 | None. One for each meeting with a topic |
| Council and topic | 4,266 | 33,345, which is 351 councils times 95 topics |
| Council | 351 | 351 |
| Topic for a place | About 390 | 475, which is 95 topics times 5 places |
| Place | 5 | 5 |

### An estimate for 10 times the meetings

This is an estimate, not a measured number.

- Meeting pages go from 1,045 to about 10,450.
- Council and topic pages grow, but can not pass 33,345.
- Pagefind writes one file for each page it indexes, plus index files
  that grow with the number of words.

That gives between about 45,000 and 70,000 files, and about 8 GB. The
range is wide because the growth of the council and topic pages and of
the Pagefind index files is not known.

## 3. Cloudflare's limits

### Words used in this section

- **Pages**: Cloudflare's older product for static sites.
- **Workers static assets**: Cloudflare's newer way to host a static
  site. The files are uploaded with a Worker, and Cloudflare sends them.
  A site that is only files needs no Worker code.
- **Free plan** and **paid plan**: the paid Workers plan has a minimum
  charge of 5 US dollars a month for an account.
- **MiB**: 1,048,576 bytes. 25 MiB is about 26 MB.

### The limits, read on 13 November 2026

| Limit | Free plan | Paid plan |
| --- | --- | --- |
| Files, Workers static assets | 20,000 for each version | 100,000 for each version |
| Files, Pages | 20,000 for each site | 100,000 for each site |
| Size of one file, both products | 25 MiB | 25 MiB |
| Total size of all files | Not stated on the limits pages | Not stated on the limits pages |
| Requests for static files | Free, no limit | Free, no limit |

Other facts from the same pages:

- The 100,000 limit on Workers needs Wrangler 4.34.0 or newer. Wrangler
  is Cloudflare's command line tool. The 100,000 limit on Pages needs a
  setting, `PAGES_WRANGLER_MAJOR_VERSION=4`.
- Workers static assets serves `foo/index.html` at the address `foo/`.
  The setting is `html_handling`.
- Workers static assets can send a `404.html` page for an address that
  does not exist. The setting is `not_found_handling`.
- Cloudflare says a file larger than 25 MiB belongs in R2.

### What this means for the two sizes

| Size | Files | Free plan | Paid plan |
| --- | --- | --- | --- |
| Today | 9,126 | Fits | Fits |
| 10 times, estimate | 45,000 to 70,000 | Does not fit | Fits |

The largest file today, 11.7 MB, is under the limit of one file. A
meeting with a little more than two times that text would pass it.

### A correction to the chat

In the chat, before this research, the limit was given as 20,000 files
with a note that it was not checked. The paid limit is 100,000. The count
of files today was given as about 12,000. The measured count is 9,126.

## 4. Way 2 in detail

### Words used in this section

- **Binding**: the link that lets a Worker read a bucket with no key and
  no public address.
- **Cache**: a copy of an answer that Cloudflare keeps near the reader,
  so the next request does not need the bucket.
- **Class A operation**: a write or a list on R2. **Class B operation**:
  a read on R2. R2 charges for each kind by the million.
- **Egress**: data sent out to readers. R2 does not charge for it.
- **Atomic**: a change that readers see all at once or not at all.

### 4.1 The two forms of way 2

There are two forms. They have different good and bad points.

| Form | How a file reaches a reader |
| --- | --- |
| 2a. Worker with a binding | The bucket is private. A Worker gets each request, turns the address into an object key, reads the object, and sends it |
| 2b. Public bucket, no Worker | The bucket is public on a custom domain. Cloudflare rules do the work that the Worker would do |

### 4.2 Good points of both forms

- **No limit on the number of files.** R2 states no limit on objects in a
  bucket. The limit of one object is about 5 TiB.
- **No limit of 25 MiB for one file.**
- **No charge for data sent to readers.**
- **The site code does not change.** The build writes the same files.
  The search works, because Pagefind is only files.
- **It is the same store the pipeline moves to.** The migration spec
  already puts the pipeline stores in R2.

### 4.3 Bad points of both forms, and what follows from each

**A deploy is not atomic.**

- Files are uploaded one by one. During an upload, readers can get new
  pages that link to files not yet there, or old pages with new scripts.
- An upload of 8 GB takes time. At 5 MB a second it is about 27 minutes.
  The speed of the upload link is not known for the build machine.
- A known way round this is to upload each build under its own folder
  name and then change one small setting that says which folder is live.
  That adds a second copy of the site in the bucket and a rule for when
  old folders are deleted.
- Workers static assets does not have this problem: a deploy is one
  version.

**There is no built-in way back to the build before.**

- Workers static assets keeps versions. R2 keeps what is uploaded.
- With one folder for each build, the way back is to point at the older
  folder. With one folder that is written over, there is no way back.

**Each deploy costs write operations.**

- A build changes most pages, because each page holds the date of the
  last update and the menu. So most files are uploaded again.
- At 60,000 files a deploy and one deploy a day, that is 1.8 million
  Class A operations a month. The first 1 million are free. The rest
  cost 4.50 US dollars a million, so about 3.60 US dollars a month.
- Storage of 8 GB is inside the free 10 GB. Two copies, 16 GB, cost about
  0.09 US dollars a month.

**HTML is not cached unless a rule says so.**

- Cloudflare caches only some file types by default. HTML is not one of
  them. A cache rule is needed.
- When HTML is cached, an old page can stay after a deploy. Then the
  cache must be cleared after each deploy, or the pages need a short
  cache time.

**Compression is not confirmed.**

- Cloudflare compresses `text/html` on the way to the reader by default.
  The documents read here do not confirm this for an answer that comes
  from R2. This matters: the largest page is 11.7 MB as it is and 1.4 MB
  after gzip.
- Each object needs the right content type set at upload, or the browser
  and the compression treat it wrongly.

### 4.4 Points for form 2a only: Worker with a binding

Good:

- The bucket stays private.
- The Worker can do all that a host does: `index.html` for a folder
  address, a redirect to add the last `/`, a `404.html` page, and
  headers.

Bad, and what follows:

- **There is code to write and keep.** It is small. Cloudflare has an
  example of a Worker that reads R2 and uses the cache. It still needs
  tests and a deploy step of its own.
- **Each request runs the Worker and is counted.** The free plan allows
  100,000 requests a day. Over that, readers get an error. The paid plan
  includes 10 million requests a month, then 0.30 US dollars a million.
  With Workers static assets, requests for files are free and have no
  limit.
- **Each cache miss is a read on R2.** A read is a Class B operation.
  The first 10 million a month are free, then 0.36 US dollars a million.
- **The Worker's cache is kept for each Cloudflare site, not shared.** A
  page read once in London is not in the cache in Manchester. The cache
  can not use Cloudflare's tiered cache. A site with many pages that are
  each read a few times gets few cache hits this way.
- **The cache does not work on a `workers.dev` address.** A custom domain
  is needed. Govbase has one.
- **The traffic of the site is not known.** So the request and read
  counts above can not be turned into a cost.

### 4.5 Points for form 2b only: public bucket, no Worker

Good:

- No code.
- Cloudflare's normal cache can be used, with its tiered cache.
- No count of Worker requests.

Bad, and what follows:

- **A folder address does not give `index.html`.** Cloudflare's document
  for public buckets does not say it does, and people report that it
  does not. A rewrite rule that adds `index.html` is the reported way
  round. No official Cloudflare document for that rule was found, and
  the case with no last `/` was not covered in what was read.
- **No custom 404 page was found** for a public bucket.
- **The bucket is public.** Every object in it can be read by address.
- **The `r2.dev` address must not be used.** Cloudflare limits its rate
  and says it is for development only.

## 5. Other ways that came up

### Words used in this section

- **On request**: a page that a Worker makes when a reader asks for it,
  in place of a file made at build time.

These are recorded as facts only.

- **Workers static assets on the paid plan** holds 100,000 files. The
  estimate for 10 times is 45,000 to 70,000.
- **A mix.** Cloudflare's own advice for a file over 25 MiB is to put
  that file in R2 and keep the rest where it is.
- **Fewer files.** The 4,266 council and topic pages are already left
  out of the search. Other choices in the site change the count of
  files, such as which pages exist and what the search indexes.
- **Meeting pages on request.** A Worker can make a meeting page from the
  markdown in R2. Then the build is short at any size. Pagefind can not
  index pages that are not built.

## 6. A million pages

### Words used in this section

- **Full build**: a build that makes every page again, as the site does
  today.
- **On request**: a page that a Worker makes when a reader asks for it,
  in place of a file made at build time.
- **Search service**: a search that runs on a server and takes new
  documents one by one, in place of an index built from finished pages.

### What the present design does at a million pages

Every number in this table is an estimate, scaled up from the build in
section 2. None is measured.

| Thing | At a million pages | Basis |
| --- | --- | --- |
| Workers static assets and Pages | Do not fit | The limit is 100,000 files |
| Time to build the pages | About 8 hours | 6,060 pages take about 3 minutes today |
| Time to build the search index | Not known | Pagefind takes about 4 minutes for 1,794 indexed pages today. No tested number for a million pages was found |
| Output size | More than 100 GB | The average page is 114 KB today |
| Upload for each deploy | Hours | Most files change in each build, because each page holds the date of the last update and the menu |
| Write operations on R2 for each deploy | More than 1 million | One for each file. 4.50 US dollars a million after the free million a month |

Two facts follow from the table:

- Way 2 removes the limit on files. It does not remove the build time,
  the output size or the upload.
- The cost of a full build grows with the number of pages, and not with
  the number of pages that changed.

### What an on-request design needs

Section 5 named "meeting pages on request". At a million pages these are
its parts:

- **The pages that stay static.** The place, topic, council and list
  pages. Their count grows with the number of places, topics and bodies,
  not with the number of meetings. There are 751 of them today, without
  the council and topic pages.
- **The pages made on request.** The meeting or paper pages. A Worker
  reads the markdown from R2 and makes the page. The parse step and the
  OCR step already write that markdown, one file for each paper.
- **Astro supports the mix.** One site can hold pages made at build time
  and pages made on request, in the same layout.
- **A new paper needs no build.** It can be read on the site when its
  markdown is in the store.

What an on-request design gives up, compared with the site today:

- **Pagefind.** It indexes built pages only. A search over a million
  pages needs a search service that takes each paper as it is parsed.
  No search service was looked at for this document.
- **A site of files only.** There is a Worker with code, tests and a
  deploy of its own.
- **Free requests.** Each request for a page made on request runs the
  Worker. The paid plan includes 10 million requests a month, then 0.30
  US dollars a million. A page that Cloudflare has cached still counts
  as a request in the pricing page read for this document.
- **A menu that lists every meeting.** The menu on the left of a council
  page lists all of that council's meetings today. That list comes from
  the data file at build time.

### How soon a million comes

These are rough sums from numbers measured in this workspace.

| Thing | Count |
| --- | --- |
| Meeting pages today, from about 2 months of council data | 1,045 |
| Documents listed by the pipeline for 6 months of council meetings | About 200,000 |

- With one page for each council meeting that has a topic, a million is
  many years away.
- With one page for each paper, 200,000 documents in 6 months reach a
  million in about 2.5 years, for councils alone.
- The number of documents that Parliament, the Lords, committees and
  government organisations publish in a year is not known here.

## 7. A wider scope: Parliament and government bodies

### Words used in this section

- **Body**: an organisation that holds meetings and publishes papers,
  such as a council, a house of Parliament, a committee or a government
  organisation.
- **Address pattern**: the shape of a page's address, such as
  `/meetings/<nation>/<council>/<meeting>/`.

### What the site assumes today

The site is built around councils. These parts hold that assumption:

- **The addresses.** A meeting page is at
  `/meetings/<nation>/<council>/<meeting>/`. A topic page is at
  `/<nation>/<topic>/` or `/uk/<topic>/`. Every address names a nation,
  and a body is always a council inside a nation.
- **The menu.** It lists the UK and the four nations as places.
- **The data file.** `national.json` groups everything by nation and by
  council.
- **The page titles.** They say "council meetings".
- **The size of one page.** A meeting page holds every paper of the
  meeting. The largest is 11.7 MB.

### The four choices that a million pages forces

These are the points where the present design and the wider scope do not
fit. They are listed as open choices, not as decisions.

| Choice | What is true today | Why it matters at a million |
| --- | --- | --- |
| 1. Where meeting pages are made | At build time | A full build does not scale, see section 6 |
| 2. What one page holds | A whole meeting | A paper is smaller than a meeting, and the count of pages becomes the count of papers |
| 3. The search | Pagefind, built from finished pages | It needs built pages |
| 4. The address pattern | Nation, then council | A house of Parliament or a government organisation has no council, and may have no nation |

One fact about choice 4: search engines keep the address of a page. A
change of address pattern after pages are known to search engines needs
a redirect from each old address, or the pages lose their place in
search results. The other three choices can be changed later with no
effect on addresses.

## 8. Search

### Words used in this section

- **Index**: the data a search tool builds from the text, so it can find
  a word fast.
- **Self-hosted**: run by the owner on the owner's own servers, such as
  an OVH instance.
- **Node**: one server that runs the search tool. Several nodes together
  are a **cluster**.
- **Heap**: the memory a Java program sets aside for itself.
- **Memory-mapped**: the tool reads its index from disk as if it were
  memory, and the operating system keeps the used parts in RAM.
- **Object storage**: a file store such as R2.

### The question

The owner asked whether OpenSearch can run on the owner's own cloud
servers. It can. This section lists it next to lighter tools.

### The size of the text

Measured from the paper files the site holds today:

| Thing | Value |
| --- | --- |
| Paper files | 13,342 |
| Total size | 369 MB |
| Average size of one paper | 27.7 KB |

At that average, a million papers are about 28 GB of text. This is an
estimate. Papers of Parliament and of government bodies may have another
average size.

### What every self-hosted tool has in common

- **A server that is always on.** The search must answer at any time.
  The pipeline plan is different: its OVH instance lives only during a
  run.
- **A program in front.** A browser must not reach the search tool
  directly. A Worker or a small API takes the search and passes it on.
- **A write step.** Each parsed paper is sent to the index. The parse
  step and the OCR step write the text that the index needs.
- **The index can be built again.** The markdown in the store is the one
  true copy. An index that is lost can be built again from it. How long
  that takes at a million papers is not known.
- **The owner runs it.** Updates, disk space, restarts, backups and the
  firewall are the owner's work.

### The tools

| Tool | What it is | Where the index lives | Memory | Stated limits |
| --- | --- | --- | --- | --- |
| Pagefind, used today | Files made at build time. The search runs in the browser | Static files beside the site | None on a server | The project's stated aim is sites with tens of thousands of pages. The largest test found was about 30,000 pages |
| OpenSearch | A search server in Java, made for clusters | Disk of each node | Heap of half the RAM, and not more than about 31 GB. The rest is for the file cache | No document limit found that matters here |
| Meilisearch | A search server in one program, made for search boxes on sites | Disk, memory-mapped | Uses up to two thirds of RAM to index, by default | Index up to about 80 TiB, with under 2 TiB advised. Its guide says to have 10 times the disk of the raw text |
| Typesense | A search server in one program. The whole index is in memory | RAM, with a copy on disk | 2 to 3 times the size of the fields that are searched | RAM is the limit |
| Quickwit | A search server whose index is in object storage | Object storage that speaks S3 | Small. The servers that answer hold no index of their own | Made first for logs and for data that is only added to |
| Cloudflare D1 with FTS5 | A SQLite database on Cloudflare with full-text search. Not self-hosted | Cloudflare | None on a server | 10 GB for one database on the paid plan, and this can not be raised |

### What the numbers mean for 28 GB of text

Each line is a sum from the table and the size above. None is tested.

- **Typesense.** 2 to 3 times 28 GB is 56 to 84 GB of RAM, if the whole
  text of each paper is a searched field.
- **Meilisearch.** 10 times 28 GB is about 280 GB of disk. Its index is
  read from disk, so RAM does not have to hold all of it.
- **OpenSearch.** No official minimum hardware page was found. The heap
  rule gives 4 GB of heap on a server with 8 GB of RAM. The disk needed
  for 28 GB of text was not found in its documents.
- **Quickwit.** The index would sit in R2, beside the stores. A server
  that answers a search can be replaced with no loss of the index.
- **D1.** 28 GB does not fit in one database of 10 GB. It would need
  several databases and a rule for which paper goes in which.
- **Pagefind.** A million pages is far past the largest test found.

### Points that differ between the tools

| Point | OpenSearch | Meilisearch | Typesense | Quickwit |
| --- | --- | --- | --- | --- |
| One node is enough to start | Yes | Yes | Yes | Yes |
| More nodes for no down time | Yes, built for it | Not confirmed here | Yes, 3 nodes | Yes |
| Search while you type, with spelling mistakes allowed | Possible, with setup | Built in | Built in | Not its main use |
| Filters, such as by body, date and topic | Yes | Yes | Yes | Yes |
| Backup to R2 | Not confirmed here | Not confirmed here | Not confirmed here | The index is already there |
| Licence, as read | Not confirmed here | Not confirmed here | GPL-3.0, from Typesense's own page | Apache 2.0, from its repository. Older copies say AGPL |

### What is not covered here

- No tool was installed or tested with Govbase text.
- Hosted search services, where another company runs the tool, were not
  looked at.
- Search by meaning, also called vector search or semantic search, was
  not looked at. This section covers search by words only.

## 9. What is not known

- Which search tool fits. Section 8 lists facts from documents only.
- How much disk OpenSearch needs for 28 GB of text.
- How long any tool takes to build its index again from a million
  papers.
- How many documents Parliament, the Lords, committees and government
  organisations publish in a year.
- Whether Pagefind can index a million pages, and how long it takes.
- Which kinds of bodies come first, and so what the address pattern must
  cover.
- The traffic of the site. No cost per reader can be given without it.
- Whether Cloudflare compresses HTML that comes from R2.
- Whether there is a limit on the total size of a Workers static assets
  version. The limits page states none.
- Whether Wrangler uploads only changed files on a deploy. The pages
  read do not say.
- The real number of files at 10 times. The range above is an estimate.
- The upload speed of the machine that will build and deploy the site.
- Nothing here was tested on a Cloudflare account. Every fact about
  Cloudflare is from its documents, read on 13 November 2026.

## 10. Method

- The sizes in section 2 are from `find`, `ls` and `gzip` on a full
  build of the site in a test folder.
- The size of the text in section 8 is from the paper files in the
  site's `src/data/papers/` folder. The facts about each search tool are
  from the tool's own documents and pages, found by web search on 13
  November 2026. A point marked "not confirmed here" was not found in
  what was read.
- The numbers in section 6 are the numbers of section 2 multiplied up to
  a million pages. They assume that time and size grow in a straight
  line with the number of pages, which was not tested.
- The limits and prices are from the Cloudflare documents below. Where
  two Cloudflare pages disagreed, the newer page was used and the point
  is listed in section 6 when it matters.

## 11. Sources

Search tools:

- Meilisearch, known limitations:
  https://www.meilisearch.com/docs/resources/help/known_limitations
- Meilisearch, storage:
  https://www.meilisearch.com/docs/learn/advanced/storage
- Meilisearch, configuration:
  https://www.meilisearch.com/docs/resources/self_hosting/configuration/reference
- Typesense, system requirements:
  https://typesense.org/docs/guide/system-requirements.html
- Typesense, comparison page written by Typesense:
  https://typesense.org/typesense-vs-algolia-vs-elasticsearch-vs-meilisearch/
- OpenSearch, heap advice in its error log guide:
  https://opensearch.org/blog/error-logs/error-log-outofmemoryerror-java-heap-space-the-node-crash/
- OpenSearch, cluster configuration:
  https://docs.opensearch.org/latest/install-and-configure/install-opensearch/operator/operator-opensearch-config/
- Quickwit, architecture: https://quickwit.io/docs/overview/architecture
- Quickwit, repository: https://github.com/quickwit-oss/quickwit
- Pagefind: https://pagefind.app/
- Pagefind, search on very large sites:
  https://github.com/Pagefind/pagefind/issues/49
- Cloudflare D1 limits:
  https://developers.cloudflare.com/d1/platform/limits/

Hosting:


- Workers limits, with the static assets table:
  https://developers.cloudflare.com/workers/platform/limits/
- Workers static assets, billing and limitations:
  https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/
- Workers static assets, static site settings:
  https://developers.cloudflare.com/workers/static-assets/routing/static-site-generation/
- Workers pricing:
  https://developers.cloudflare.com/workers/platform/pricing/
- Workers cache:
  https://developers.cloudflare.com/workers/runtime-apis/cache/
- Pages limits:
  https://developers.cloudflare.com/pages/platform/limits/
- Pages file limit change, January 2026:
  https://developers.cloudflare.com/changelog/post/2026-01-23-pages-file-limit-increase/
- Workers static assets limit change, September 2025:
  https://developers.cloudflare.com/changelog/post/2025-09-02-increased-static-asset-limits/
- R2 pricing: https://developers.cloudflare.com/r2/pricing/
- R2 limits: https://developers.cloudflare.com/r2/platform/limits/
- R2 public buckets:
  https://developers.cloudflare.com/r2/buckets/public-buckets/
- R2 with the cache API, the example Worker:
  https://developers.cloudflare.com/r2/examples/cache-api/
- Cache with R2:
  https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/
- Compression:
  https://developers.cloudflare.com/speed/optimization/content/compression/
