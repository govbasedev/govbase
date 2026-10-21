# Parse step: raw bytes to markdown

Written 2026-10-21. Status: decisions confirmed by the owner on 2026-10-21; Step 2 (the SDK) and Step 3 (the pipeline) built the same day, every check green, uncommitted; Step 4 (a real run) not started. Apps: `apps/parser-sdk` and `apps/pipeline`, the `parse` step and the `ocr` step. Branch: `parse-as-markdown` in each app. Owner steps before Step 4: in the SDK, delete the old files the build left behind, `bun install`, `make check`, commit, `make major`; in the pipeline, `make bump-sdk`, commit.

The requirement: the parse step reads the raw bytes of each read item from the bucket and turns them into one markdown document. The markdown keeps the same page order and the same format as the source. Every image becomes a stored object, and the markdown holds a link to it at the place where the image sits. The output goes to `parse/v3/`, with the same conventions as `list/v2/` and `read/v2/`.

One assumption. "A link to the scanned bytes" is read as: the parse step saves each image as its own object in the bucket, and the markdown holds an image link to that object. If the link should point back at the raw file in the read store instead, section B changes.

## A. The parser SDK and how the pipeline parses today

**What the SDK is.** It is the app in `apps/parser-sdk`. It takes raw bytes and gives back data. It never touches the network, files, the clock or logs. The same bytes and options always give the same output. Nothing throws. A failure is a value: `Unreadable`, `Garbled` or `NotSupported`.

**What it reads.** PDF (with pdf.js), Word `.docx` (it unzips the file and takes the text runs), HTML (it strips tags), plain text, and images (with the Tesseract OCR engine when one is handed in). It also reads the council systems' listing pages and feeds, which the list step uses.

**What it gives back.** Lines. A flat list of strings, one per paragraph. That is the whole output of a document read. There is no page, no heading level, no list, no table, no bold, no picture.

**How a PDF is read.** pdf.js gives text pieces with a position, a size and a font size. The SDK groups pieces into lines by their baseline. It drops lines that repeat on most pages, such as running headers, footers and `Page 5 of 8`. It joins lines into paragraphs when the gap is small and the line is full. Each page gives `{ pageNumber, paragraphs, isGarbled }`. Then the SDK decides which pages "want an image": garbled pages, blank pages in a document with no good page, and thin pages. With no OCR engine, those page numbers are listed and nothing is drawn.

**After the lines.** `buildBlocks` cleans each line (mends double-decoded text, ligatures, symbol bullets, hyphenated words) and numbers the paragraphs `B0001`, `B0002`. `buildBlockTags` guesses a tag for each block from rules in `config/tagging.yaml`: heading, body, boilerplate, contact, recommendation, summary, plus a language.

**The pipeline's parse step today.** It lists the read items with no record in `parse/v2/`. For each one it reads the bytes and calls the text reader. Then one of four things happens.

| Result from the SDK | What the step saves |
| --- | --- |
| Some pages want an image | `parse/v2/scans/<id>.json.gz`, the page numbers and the typed pages. The OCR step takes it from here. |
| Lines | `parse/v2/data/<id>.json.gz`, the tagged blocks. |
| No lines, or the type is not read | `parse/v2/errors/<id>.json` with `no-text` or `not-supported`. |
| Unreadable | `parse/v2/errors/<id>.json` with `broken-file`. |

**The OCR step today.** It reads each pending scan, opens the PDF again, draws the wanted pages as images, runs Tesseract, merges the result with the typed pages, builds blocks and tags again, and writes `ocr/v2/data/<id>.json.gz`.

**Two facts that matter for the change.** Nothing reads the tagged blocks yet. The judge step is not built. And the SDK rule in the pipeline's `AGENTS.md` says parsing code lives in the SDK, not in the pipeline. So the markdown conversion belongs in the SDK.

## B. The behaviour the new requirement needs

This section is written from the requirement alone, not from the code.

**The contract.** For one read item, make one markdown document that mirrors the source file. Same page order. Same reading order inside each page. Same structure where the source has structure. Every image becomes a stored object and a link in the markdown at the place where the image sits.

**Inputs.** The read record (id, content hash, content type) and the raw bytes.

**Outputs, in the parse store.** The recommended layout. It follows the read store, which has a record folder and a bytes folder.

| Object | Holds |
| --- | --- |
| `parse/v3/data/<id>.json` | The record: id, content hash, content type, SDK version, page count, image count, the page numbers that are scans. |
| `parse/v3/text/<id>.md` | The markdown. |
| `parse/v3/images/<id>/page-3.png` | A whole page saved as an image, for a scanned page. |
| `parse/v3/images/<id>/page-3-picture-2.png` | A picture that sits inside a typed page. |
| `parse/v3/errors/<id>.json` | id, content hash, failure class and reason. |

State is presence, as today: an item with a record in `data/` or `errors/` is done. The step writes the images first, then the markdown, then the record last. So a crash never leaves a "done" record with missing images.

**Page order.** Every page starts with a visible marker: a level-6 heading, `###### Page 3 of 12`, with a `---` rule above it. Page 1 has the heading and no rule, because a file that starts with `---` looks like a front-matter block to some tools. A source line that happens to say `Page 3 of 12` is written as plain text, never as a heading, so the two cannot be confused. The owner chose the visible form over an HTML comment so that a person reading the file sees the pages too.

**Reading order inside a page.** Top to bottom. In a two-column page, the left column before the right. A footer drawn first in the file still comes last.

**One markdown dialect.** The recommendation is GitHub Flavored Markdown (GFM). It is the dialect that GitHub, most editors and most models know. Some common extras are not GFM. The table below maps every markdown syntax to what the raw bytes can tell us, by file type.

| Markdown syntax | Word `.docx` | HTML | PDF | Plain text |
| --- | --- | --- | --- | --- |
| `#` headings 1 to 6 | Yes. Paragraph style Heading 1 to 6 and Title. | Yes. `h1` to `h6`. | Guessed. A PDF has no heading mark. Rank the font sizes larger than the body size into levels. | No. |
| Setext headings (`===`, `---` under a line) | Use ATX `#` only. One spelling for every construct. | | | |
| `**bold**`, `*italic*` | Yes. Run properties. | Yes. `strong`, `b`, `em`, `i`. | Possible. The font name holds `Bold` or `Italic`. Needs pdf.js below the wrapper used now. | No. |
| `~~strike~~` | Yes. | Yes. `s`, `del`. | No. A strike is a drawn line. | No. |
| `>` quote | Weak. A `Quote` style only. | Yes. `blockquote`. | No. | No. |
| `-` bullets, nested | Yes. Numbering levels in `numbering.xml`. | Yes. `ul`, `li`, nested. | Partly. A bullet glyph at the line start. Nesting from the left indent. | Partly. A `-` or `•` at the line start. |
| `1.` numbered lists | Yes, for true auto-numbered lists. | Yes. `ol`. | Keep the number as text. See the edge cases. | Keep as text. |
| `- [ ]` tasks | Yes. Checkbox controls, and the `☐ ☑ ☒` glyphs. | Yes. `input type=checkbox`. | Yes. The SDK already maps the Symbol-font boxes to `☐ ☑ ☒`. | Same glyphs. |
| Inline code, fenced code | Only a `Code` style. Rare. | Yes. `code`, `pre`. | A monospace font. Rare in council papers. | No. |
| Indented code (4 spaces) | Do not use. Indented source text would turn into code by accident. | | | |
| `---` rule | Page break or border. | Yes. `hr`. | A drawn full-width line, from the page's drawing operators. | A `----` line. |
| `[text](url)`, `<url>` | Yes. Hyperlinks via the rels file. | Yes. `a href`. Resolve relative links against the item's address. | Yes. Link annotations give the URL and a box on the page. Bare URLs in text become `<url>`. | Bare URLs. |
| Reference links `[id]: url` | Do not use. Inline links keep the link next to its text. | | | |
| `![alt](key)` images | Yes. `word/media/*` through the drawing's relationship id. | Remote URL only. We do not hold the bytes. Keep the link as it is. | Yes. A scanned page is one page image. A picture inside a typed page is one picture object. | No. |
| Tables with alignment | Yes. `w:tbl` rows and cells, alignment from `w:jc`. | Yes. `table`, `th`, `td`, `align`. | Yes, in the first build. A ruled table from the drawn lines on the page, which give the grid. A table with no rules from text that lines up in columns over two or more rows. A strict rule decides, because a wrong table is worse than none. | No. |
| Footnotes `[^1]` | Yes. `footnotes.xml`. | Rare. | No. | No. |
| Hard line break | Yes. `w:br` inside a paragraph. Use the backslash form, not two spaces. | Yes. `br`. | No. Lines in a paragraph flow. | A single line break. |
| Escapes `\*` | Every source character that is markdown syntax is escaped, in every reader. | | | |
| `<!-- comment -->` | A note where an image or a page was not stored, and why. Not for page markers. | | | |
| Definition lists, `==mark==`, `~sub~`, `^sup^`, `:emoji:`, `<details>` | Not GFM. Do not use. For Word subscript and superscript, GFM allows `<sub>` and `<sup>` tags. | | | |

**Text cleaning.** Keep the fixes that repair bytes: ligatures, double-decoded text, NUL characters, the Symbol-font glyphs, and text drawn twice at the same place for a halo. Never change wording. The owner chose a faithful copy on both open points: curly quotes stay as written, and no English text is dropped. Running headers, footers, page-number lines, contents lines with leaders and watermarks all stay, on every page where the source has them. The SDK's repeated-line and kept-line filters are not used on this path.

**Languages.** The output is English only, because the markdown will go to Jev, and Jev works best with English alone. Text in any language other than English is left out of the markdown. The unit is the smallest piece of text the tree has: a paragraph, a heading, a list item or a table cell. Each unit is judged on its own, so a bilingual page keeps its English units and loses the others. Three tests say a unit is not English, and any one of them is enough. First, a known language: a list of marker words per known language in config, with a least count, as the old tagging rules had for `cy`. A unit with at least that many marker words of one known language, and more of them than English marker words, is in that language. The known lists start with Welsh, Scottish Gaelic and Irish, the languages that appear in UK council papers, and grow from what the runs show. Second, no English: a unit with at least a set number of words and no English marker word at all is not English, whatever the language. The English list is common words that other languages do not share, such as `the`, `and`, `of`, `which` and `that`. Only a word that starts with a lower-case letter counts towards the word number, so a list of names, which are capitalised, is not caught. Third, script: a unit whose letters are mostly outside the Latin script, such as Arabic, Bengali or Chinese, is not English. A unit that holds both languages either side of a `/` or `|`, such as `Adroddiad / Report` or `Enw / Name`, keeps its English side only. A table column goes when most of its text cells are not English, and its figure cells go with it. A page with Welsh on the left and English on the right must be read as two columns first, then the Welsh column goes, which is one reason the two-column reading order matters. A unit too short to tell, with no marker word of any list, is unknown and stays, so a Welsh name inside an English sentence, such as `Cyngor Gwynedd Council`, is kept, and so is a short unit in an unknown language. An unknown unit counts for neither side. The gap is marked in a visible way, in the page heading, as the owner chose: `###### Page 3 of 12, 4 paragraphs in Welsh left out`, or `4 paragraphs not in English left out` when the language has no list, and when the whole page went, `###### Page 3 of 12, Welsh, left out`. So the page count still matches the source and a reader sees what is missing. A page with at least one unit that is not English and no English unit goes whole: its unknown units, such as figures or a title, and its pictures go with it, and no image object is stored for it. A document with at least one unit that is not English and no English unit saves a parse error with the class `other-language`, so nothing is stored for it and the count shows in the report. So a document in another language does not escape the error through its figure pages, its titles or its names. The record of a parsed document holds the units left out, by language, with `other` for a language that has no list. A scanned page cannot be judged at parse; the OCR step applies the same rule to the text it reads.

**Determinism.** The same bytes and the same options give the same markdown, byte for byte. This keeps the SDK's purity rule and makes the corpus tests work. Images are rendered by a graphics library, so the corpus compares image counts and sizes, not image bytes.

**Failures.** `broken-file` for a file that cannot be opened. `not-supported` for a type no reader takes. `bytes-missing` when the raw bytes are gone. `no-text` only when there is no text and no image at all. `other-language` when some text is not English and no unit is English, see Languages. A scanned document with only image links is a success, not a failure. There is no `garbled` class at parse any more: a garbled page becomes a page image.

**Limits in config.** How many page images one document may store, and the scale they are drawn at. A 300-page scanned pack drawn at three times its size is about a gigabyte. Confirmed: the scale the OCR step uses today, three times the page size and at most 5000 pixels a side, so OCR reads the stored image and never redraws the page, and a cap of 60 pages. Pages over the cap get a comment in the markdown that says so. Pictures smaller than a minimum size in config are skipped. Pictures with the same bytes are stored once and linked from every place they appear.

**What the OCR step needs from it.** The page numbers that are scans, in the record, and the PNG under each link. OCR then reads the PNG, and writes its own markdown with the text placed under the image link.

## C. How the new behaviour differs from the current code

| Aspect | Today | New |
| --- | --- | --- |
| Output | Flat tagged blocks, gzipped JSON. | Markdown with structure, plus image objects, plus a small record. |
| Pages | Lost. Only pending scans keep typed pages. | Kept, in order, with a marker per page. |
| Formatting | Lost. | Headings, lists, tables, emphasis, links, footnotes, where the source has them. |
| Pictures inside pages | Ignored. | Saved as objects and linked in place. |
| Scanned pages | Page numbers in a `scans/` object. OCR redraws from the PDF. | A page image object and a link. OCR reads the PNG. |
| Garbled text | A `garbled` failure for the whole document. | That page becomes an image. |
| No text | A `no-text` failure. | A failure only when there is nothing at all. A picture-only document succeeds. |
| Blocks, tags, token counts, sections | Built at parse. Nothing reads them yet. | Gone. `buildBlocks` and `buildBlockTags` leave the SDK, and `buildTextObject`, `readTaggingFile`, `config/tagging.yaml`, the `tagging` part and the `tokens` part leave the pipeline. The judge spec adds a token estimate back when the judge is built. |
| Agenda numbers such as `4(a)` | Plain text in a block. | Plain text. Markdown ordered lists would renumber them. |
| Where the code lives | The SDK gives lines. The pipeline builds blocks. | The SDK gives markdown and images. The pipeline only stores. |
| SDK output type | `Lines`, a flat list of strings. | A page tree rendered to markdown, plus an image list. A major SDK version. |
| Store | `parse/v2/` with `data/`, `scans/`, `errors/`. | `parse/v3/` with `data/`, `text/`, `images/`, `errors/`. |
| Who else changes | | The OCR step reads `scans/` and typed pages, so it must change. The run report tool and the README store table too. |
| Config | `textReading`, `tagging`, `tokens` feed parse. | `textReading` stays. New `parse` keys for the image cap, scale and smallest picture. `tagging` and `tokens` are removed. |
| Cleaning | Repairs bytes, straightens quotes, drops page furniture. | Repairs bytes only. Quotes and page furniture stay as written. |
| Wrong content type | A PDF served as `application/octet-stream` is `not-supported`. | The first bytes are sniffed: `%PDF` is a PDF, a zip with `word/document.xml` is Word, whatever the server said. |
| PDF tables | Lines of text. | GFM tables, from drawn rules or aligned columns. |
| Languages | A Welsh block got a `cy` tag, which was almost never set: 138 of about 7 million blocks. | Every paragraph, heading, list item or table cell in a language other than English is left out of the markdown, and the page heading says how many went. A document with no English is an `other-language` error. |

## D. Edge cases for B

### Pages and order

- A two-column page. The columns must not interleave. Today the SDK reads in file order, which is usually right.
- A page with typed text and a scan together, such as a typed `Appendix A` over a scanned letter. Keep the text and link the page image.
- A page that is a huge plan (A0 or A1). Today it is not drawn. Write a comment that says the page is a drawing and was not stored.
- A PDF with no pages, or a password. `broken-file`.
- A watermark such as `DRAFT` on every page. It stays on every page, as written. A rotated watermark is drawn as single letters at odd places and may land inside a paragraph.
- A page that is partly garbled, one bad font. Over the garbled threshold it becomes an image. Under it, the good text stays and the bad text is dropped.
- Word has no fixed pages. Either one page for the whole file, or a marker at each rendered page break Word last saved. Recommended: one page.

### Structure

- A PDF where every line is one font size. No headings. A title page with giant text. One heading. A bold table header. Not a heading. Heading levels are worked out per document, never from fixed sizes.
- Word splits one bold phrase into several runs. Adjacent runs with the same style must merge, or the output is `**Hel****lo**`.
- Spaces inside emphasis markers, `** text**`, are not valid. Move the space outside.
- A list that continues on the next page. The page marker breaks the list. Accept it.
- Bullets drawn with Symbol or Wingdings glyphs. The SDK already maps them to `•`. Map `•` at the line start to `- `.
- Nested lists in a PDF rely on the left indent, and indents are not consistent. Expect some flat lists.
- A ruled PDF table with merged cells, or with a cell that spans two pages. Merged cells are flattened. A table cut by a page ends at the page and starts again on the next page.
- A PDF table with no rules. Two lines that happen to line up are not a table. The rule asks for two or more rows and two or more columns with the same column starts.
- A two-column page layout looks like a two-column table with no rules. Column detection must tell a page layout from a table: a table's rows are short and share baselines; page columns are long and do not.
- Word merged cells, nested tables, and cells with line breaks. Flatten merges, drop nesting, write `<br>` in a cell.
- An HTML layout table that holds the whole page. A table with one column or one cell flattens to paragraphs.
- A link whose text is broken across two lines. Join before linking. A link annotation that spans two lines. One link.
- Tracked changes in Word. Keep inserted text, drop deleted text. Headers and footers are written once, at the top and the bottom, since a Word file is one page. The table of contents field keeps its text.
- Numbered agenda items. `1.` in markdown is a list that renumbers. `4(a)` is not valid list syntax. Keep source numbers as text. Use `1.` only for a true auto-numbered list in Word or HTML.

### Escaping and characters

- Source text that starts with `#`, `>`, `-`, `+`, `*`, `|` or `1.`, underscores in names and emails, `<` in text, backslashes, `[x]`, and lines of `---`. All escaped, or the text changes meaning.
- Text that looks like HTML, such as `<b>` in a plain text file. GFM renders raw HTML, so `<` must be escaped.
- Four leading spaces on a line would make a code block. Trim leading spaces.
- NUL and control characters, `�`, ligatures, non-breaking spaces, soft hyphens, tabs. Accented letters are fine. Right-to-left text is rare. English is the only language the rules are written for, see decision 20.

### Languages

- Welsh on the left of the page and English on the right. The columns must be read apart first. Then the Welsh column goes and the English column stays, in order. Interleaved columns would mix the two and the marker counts would cancel.
- Welsh and English in turns, one paragraph each. Each paragraph is judged on its own. The Welsh ones go.
- The Welsh half of the document first, then the English half. The Welsh pages go, each with its marker, and the English pages stay.
- A heading with both languages, `Adroddiad / Report`. The English side of the slash stays and the Welsh side goes. A heading in Welsh alone goes.
- A bilingual table with a Welsh column, `Enw / Name` over Welsh and English cells. The Welsh column goes with its header and its figure cells. A table whose rows alternate languages loses the Welsh rows. A header cell with both languages keeps its English side.
- Place and council names in Welsh, `Caerdydd`, `Gwynedd`, `Cyngor Sir Ynys Môn`. Names are not marker words, so an English unit that holds them stays.
- A short unit with no marker word, such as a two-word Welsh menu item or `Dim`. It is unknown and stays, unless its page or its document has Welsh and no English, when it goes with them. Some Welsh slips through on bilingual pages. The marker lists grow from what the runs show.
- A page of a Welsh document that holds only figures, a map or a title. No unit on it has a marker word, so nothing on it is judged. In a Welsh-only document the document rule still catches it: some units are Welsh and none is English, so the whole document is an `other-language` error. In a bilingual document the page stays, because figures have no language, and Jev sees them again in the English half.
- A unit that quotes the other language, such as an English paragraph that quotes a Welsh motion. The majority of markers decides, so the paragraph stays with its quote.
- A Welsh-only item whose English twin is a separate item, as Welsh ModernGov sites publish. The Welsh item is an `other-language` error. Nothing links the two.
- Scottish Gaelic in the Western Isles papers, Irish in some Northern Ireland papers, Cornish in a few Cornwall headings. Welsh, Gaelic and Irish get their own marker lists, so their short units are caught too. Any other language is caught by the no-English test and the script test.
- A notice repeated in several languages, such as `This document is available in other languages` followed by the same line in Polish, Urdu and Bengali. The English line stays. The Polish line has enough words and no English marker, so it goes. The Urdu and Bengali lines are in another script, so they go.
- A Latin motto or a French phrase inside an English paragraph. The paragraph has English markers, so it stays whole.
- An English unit with many words and no marker word, such as an attendance list of councillors' names. The names are capitalised, so they do not count towards the word number, and the unit is unknown and stays.
- A scanned bilingual page. The parse step cannot read it. The OCR step applies the rule to the text it reads.
- The pictures on a page with a Welsh unit and no English unit. They go with the page, and no image object is stored. A picture on a page that kept an English unit stays, since a picture has no language.
- Tiny pictures: logos, bullet images, one-pixel tracking images. Skip below a minimum size in config.
- The same logo on every page. Stored once, by content hash, and linked from every page.
- Charts drawn as vector paths. They are not pictures in the file, so picture extraction does not see them. Only a page render shows them. First build: skip. Later: render the region.
- Word images in EMF or WMF format. No easy PNG. Store as is with its own extension, or skip with a comment.
- HTML images are remote addresses. Keep the link. We hold no bytes.
- An image file item, such as a JPEG served as a document. One image link, no text. A TIFF with many pages. Store as is.
- One broken image stream. Fail that image with a comment. Never fail the document.

### Files and types

- A content type with extras, `application/pdf; charset=binary`. Match on the start.
- A PDF served as `application/octet-stream`, or HTML served as `application/pdf`. The first bytes decide: `%PDF`, a zip with `word/document.xml`, an image header, or text. The content type is a hint only.
- Old binary `.doc`, `.xls`, `.pptx`, `.rtf`, `.zip`, `video/mp4`. `not-supported`, as today.
- An empty file. `broken-file`.
- A meeting page in HTML. It holds the site's navigation, cookie banner and footer. Keep stripping `nav`, `script` and friends. Prefer `main` or `article` when the page has one.

### Store and step

- Two items with the same content hash, the same file at two addresses. Parsed twice, as today. A later update can share by hash.
- Link form. Recommended: the full bucket key, `parse/v3/images/<id>/page-3.png`, not a URL. Any reader can resolve it, and the bucket can move provider.
- Markdown size. A thousand-page pack is a few megabytes. Plain `.md`, not gzipped, so a person can open it in the bucket browser.
- Emptying `parse/v3/` to parse again removes the images too, since they share the prefix.

## E. Plan to replace the current implementation

Order: decisions, then the SDK, then the pipeline with the OCR step, then a real run. One branch per app, both named `parse-as-markdown`.

### Step 1. The decisions, confirmed by the owner on 2026-10-21

| # | Decision | Confirmed |
| --- | --- | --- |
| 1 | Dialect | GFM. |
| 2 | Page marker | A visible `---` rule and a `###### Page 3 of 12` heading. No rule before page 1. |
| 3 | Curly quotes | Kept as written. |
| 4 | Running headers, footers, page numbers | Kept. Nothing is dropped. |
| 5 | Store layout | `data/`, `text/`, `images/`, `errors/` under `parse/v3/`. |
| 6 | Link form | Full bucket keys, such as `parse/v3/images/<id>/page-3.png`. |
| 7 | Gzip | No. Plain `.md`. |
| 8 | Image format | PNG for every image. |
| 9 | Image size and cap | The OCR scale, three times page size and at most 5000 pixels a side. At most 60 page images per document. |
| 10 | Blocks, tags and token counts | Removed from the SDK and the pipeline, with `config/tagging.yaml` and the `tokens` part. |
| 11 | Word pages | One page per Word file. |
| 12 | PDF tables | Yes, in the first build, written as GFM tables. |
| 13 | HTML parsing | A small, well-tested parser dependency in the SDK, such as `htmlparser2`. |
| 14 | Wrong content type | Sniff the first bytes. |
| 15 | Repeated pictures | Stored once by content hash, linked from every page. |
| 16 | Lettered, roman and multi-level labels | A list item with the label kept as text, such as `- (a) text`, nested by level. |
| 17 | Underline and highlight | Nothing. No HTML tags. |
| 18 | Word page break | A `---` rule. Not a page marker. |
| 19 | Dollar sign | Kept as written. Not escaped. |
| 20 | Languages | English only, because the markdown goes to Jev, which works best with English alone. Text in any language other than English is left out. See Languages in section B. |
| 21 | Language unit | The smallest unit: a paragraph, a heading, a list item or a table cell, each judged on its own. A bilingual page keeps its English units only. The owner rejected the page as the unit on 2026-10-21, because a bilingual page would have kept its Welsh. |
| 22 | A document with no English unit | An `other-language` parse error when at least one unit is not English and none is English. A unit too short to tell counts for neither side. Nothing is stored for it. |
| 23 | Text left out | Marked in a visible way, in the page heading: `###### Page 3 of 12, 4 paragraphs in Welsh left out`, or `not in English` for a language with no list, or `###### Page 3 of 12, Welsh, left out` when the whole page went. |

### Step 2. The SDK, a major version

1. Add `src/markdown/`: the page tree types, and one `buildMarkdown` that renders the tree with all escaping in one place, and writes the page markers. Every reader builds a tree. The syntax rules live once.
2. Move the byte repairs out of `buildBlocks` into `src/text/` as one repair pass: ligatures, double-decoded text, NUL characters, Symbol-font glyphs. Delete `buildBlocks`, `buildBlockTags`, `BLOCKS_VERSION`, the blocks types and their tests. Quote straightening and the kept-line filter go with them.
3. PDF: build on the line and paragraph grouping in `buildPdfPages`, without its repeated-line and page-number filters. Add heading levels from font-size ranks, bold and italic from the font names, bullets, links from annotations, drawn rules, pictures from the page's image objects stored once by hash, and page images for the pages that want one, drawn with the code the OCR path already has.
4. PDF tables: a ruled table from the horizontal and vertical lines in the page's operator list, which give the grid, with each text piece placed in its cell. A table with no rules from text that lines up in the same column starts over two or more rows, with a strict rule that tells a table from a two-column page. Its own corpus fixtures: a ruled table, a table with no rules, a two-column page that is not a table.
5. Word: parse `document.xml`, `styles.xml`, `numbering.xml`, the rels, `footnotes.xml`, the header and footer parts and `word/media` with the XML parser the SDK already depends on.
6. HTML: a tree reader over `htmlparser2`, a new dependency.
7. Plain text and image files: short readers.
8. The language rule: the English marker words, the marker words of each known language, the least marker count and the least word count come in as options. Each unit of the tree, a paragraph, a heading, a list item or a table cell, is judged by the three tests: a known language's markers, no English marker in a unit of enough lower-case words, or a non-Latin script. A unit that is not English is left out before the markdown is rendered. A unit with both languages either side of a `/` keeps its English side. A table column goes when most of its text cells do. A unit too short to tell is unknown and counts for neither side. A page with a unit that is not English and no English unit goes whole, unknown units and pictures included. The page heading says what went. The result counts the units left out, by language, with `other` for a language that has no list.
9. `readDocument` sniffs the first bytes before it trusts the content type. It gives the markdown, the image list with bytes, the page count, the scan page numbers and the units left out by language. Unread causes are the four classes and `other-language`.
10. The Effect shell: `TextReader.readDocument` returns the new shape. `ScanReader.readImage` already reads a PNG, which the OCR step will use.
11. Corpus: expected files become markdown. Add fixtures. Today the corpus has six PDFs, one HTML page, one text file and no Word file. Needed: a Word file with lists, tables, headers and footnotes, an HTML page with a table, a PDF with both typed and scanned pages, the three table fixtures above, a PDF with Welsh pages followed by the same pages in English, a bilingual page with Welsh and English side by side that keeps only the English column, a bilingual table with `Enw / Name` headers, a notice repeated in Polish, Urdu and Bengali, and a Welsh-only document.
12. `make check`, commit, `make major`. The tag is `v1.0.0`.

### Step 3. The pipeline

1. `make bump-sdk` to the new tag.
2. `createParseStore`: version 3, the four folders, a `ParsedDocumentSchema`, a writer that saves images, then markdown, then the record, and a reader for ids, records, markdown and images.
3. `buildParseStep`: read the due ids, read the bytes, call the text reader, save. Outcomes `document`, `failed`, `unsaved`. Keep the parsed-documents counter and the parse-seconds histogram. Check `grafana/alerts.yaml` still names sent metrics.
4. Remove `buildTextObject`, `readTaggingFile`, `config/tagging.yaml`, the `tagging` and `tokens` config parts, `ReadFiles.tagRuleSet` and the `taggingReading` option of `runPipeline`, with their tests.
5. Config: the new keys live in `textReading`, not in a new `parse` part, because the pipeline hands `textReading` to the SDK as it is, and the image cap and the scale were already there. Added: `cellGapLineShare`, `headingLeastSizeShare`, `smallestPictureSide`, and `languages` with the English marker words, the marker words of each known language, moved out of `config/tagging.yaml` before that file went, the least marker count and the least word count. Removed: `repeatedLinePageShare` and `repeatedLineLeastPages`. The `tokens` and `tagging` parts are gone.
6. The OCR step, in the same update, because it will not compile without it: due items are records with scan pages and no OCR record. Read each stored PNG with `ScanReader.readImage`. Write `ocr/v3/text/<id>.md`, the parse markdown with the OCR text under each scan-page link, and `ocr/v3/data/<id>.json` with the pages read and left. Drop the typed-page merge and the PDF redraw. The OCR text goes through the same language rule.
7. Update `tools/stores/readRunReport.mjs`, the README store table and its Text, Blocks, Scans and Tagging sections.
8. Rewrite the parse step test, the parse store test and the OCR tests. The mirror and store-ownership tests guard the structure. `make check`.

### Step 4. A real run

Run `bun run dev:step:parse` against the development bucket. It writes to `parse/v3/`, so `parse/v2/` is untouched. Open ten markdown files beside their PDFs, including a Word file, a meeting page and a scanned pack. Then run the OCR step on the scans. Then the run report.

### Later, not in this update

- The judge reads the markdown, and brings back a token estimate in config when it needs one.
- Picture placement by position on the page.
- Sharing parsed output between items with the same content hash.

## F. Input map: every character and mark to its markdown form

Added 2026-10-21 after the decisions. The map is keyed on what a mark means, not on the character alone, because the same mark arrives in more than one form. The four choices it left open were confirmed by the owner the same day. They are rows 16 to 19 of the decisions table in Step 1. The sources: the SDK's `buildCleanText.ts` and `joinLines.ts`, which already map some of these; `parsed-text-issues.md`, which counted the private-use glyphs across a whole run (905 texts, 21,872 glyphs, most of them Wingdings boxes and ticks on forms); and the charts of the Symbol, Wingdings and ZapfDingbats fonts.

### How a mark arrives from a PDF

A bullet in a Word file exported to PDF is a character from a symbol font: Symbol, Wingdings, Webdings or ZapfDingbats. pdf.js gives that character in one of three ways, depending on the PDF's font map.

| Form | Example, the Symbol-font bullet | How to tell |
| --- | --- | --- |
| The right Unicode symbol | `•` U+2022 | The character itself. |
| A private-use code point: `U+F0` plus the font's own byte | U+F0B7 | The code point is in U+E000 to U+F8FF. The low byte is the font's code. |
| The Latin-1 letter with that byte | `·` U+00B7 for Symbol; `l` `n` `o` `q` `v` `§` `Ø` `ü` `þ` for Wingdings | Only the text piece's font name tells. pdf.js gives it through the page's font objects, below the wrapper the SDK uses today. |

So the reader keeps the font name on each text piece, and one table per symbol font maps bytes to meanings. The SDK already maps the private-use forms it has seen. The new map adds the font-name form and the Unicode form. The full byte tables come from the three fonts' charts and are checked against the corpus during the build.

### 1. List markers

A marker counts only at the start of a line, as its own text piece or followed by a space or a tab, with the item text after it. The marker is not written into the markdown: the list syntax replaces it. The nesting level comes from the left edge of the marker. A marker further right than the one above it is one level deeper, indented two spaces per level under a bullet and three under a number.

| Input at the line start | Where it comes from | Markdown |
| --- | --- | --- |
| `•` U+2022, `·` U+00B7, `●` U+25CF, `○` U+25CB, `◦` U+25E6, `■` U+25A0, `□` U+25A1, `▪` U+25AA, `▫` U+25AB, `◆` U+25C6, `◇` U+25C7, `❖` U+2756, `►` U+25BA, `▶` U+25B6, `➢` U+27A2, `➤` U+27A4, `➔` U+2794, `→` U+2192, `»` U+00BB, `*`, `+`, `-`, `–` U+2013, `—` U+2014, `~` | Any file. Word's defaults are `•` at level 1, `o` at level 2, `▪` at level 3. | `- ` |
| `o` as a lone letter at the line start, followed by a space and text | Word level 2 exported to PDF, in Courier New. In English a lone `o` is not a word, so the letter with a space after it is enough. The font name and a separate text piece confirm it. Welsh, where `o` is a word, is not considered, see decision 20. | `- ` |
| Private-use U+F0B7, U+F0A7, U+F076, U+F0D8, U+F0FC, U+F09F, U+F06E, U+F0A8, and any other U+E000 to U+F8FF glyph at the line start | Symbol and Wingdings with a bad font map. | `- ` |
| Symbol byte `·` 0xB7. Wingdings bytes `l` ●, `n` ■, `o` ❏, `q` ❑, `u` ◆, `v` ❖, `§` ▪, `Ø` ➢, `ü` ✓. ZapfDingbats `l` `n` `o` `u` `v`. | The Latin-1 form, by font name. | `- ` |
| `1.` `1)` `(1)` with digits only | Typed numbering. Word decimal numbering. | `1. ` or `1) `, the number as written. Markdown counts on from the first item; the text keeps the true number. |
| `1.1` `1.1.1` `1.2.3.` | Multi-level typed numbering. Word `%1.%2`. | A list item with the label kept as text, `- 1.1 text`, nested by level. Markdown has no multi-level number. |
| `a.` `a)` `(a)` `A.` `(A)` `i.` `(i)` `(iv)` `I.` | Lettered and roman numbering. Word `lowerLetter`, `lowerRoman`. HTML `ol type=a`. | A list item with the label kept as text, `- (a) text`. Markdown ordered lists take digits only. |
| A number or a letter, a tab, then the text | Word and PDF put the label and the text in separate pieces. | One space between the label and the text. |
| `☐` U+2610, `❏` U+274F, `❑` U+2751, `□` U+25A1, Wingdings `o` `q`, private U+F06F, U+F0A3, U+F071 | A form box, not ticked. | `- [ ] ` |
| `☑` U+2611, `☒` U+2612, `⌧` U+2327, Wingdings `þ` `ý`, private U+F0FE, U+F052, U+F078, U+F0FD, U+F053, U+F054 | A form box, ticked or crossed. | `- [x] ` |
| The same boxes inside a line, such as `yes ☐ no ☑` | Forms. | The Unicode box `☐` `☑` `☒` as text. Task syntax works only at the item start. |
| Word `numbering.xml`: `bullet` with any `lvlText` glyph | Word. | `- ` |
| Word `decimal` with `lvlText` `%1.` or `%1)` | Word. | `1. ` or `1) ` |
| Word any other `numFmt` or `lvlText` | Word. | The label computed and kept as text in a `- ` item. |
| HTML `ul li`, `ol li`, `ol type=a`, `input type=checkbox` | HTML. | `- `, `1. `, `- (a) `, `- [ ] ` or `- [x] ` |

### 2. Signs kept as characters

| Input | Markdown |
| --- | --- |
| `✓` U+2713, `✔` U+2714, `✗` U+2717, `✘` U+2718; Wingdings `ü` `û`; private U+F050, U+F04F, U+F0FB, U+F0FC; ZapfDingbats `3` `4` `7` `8`; not at a line start | `✓` or `✗` |
| Arrows `→` `←` `↑` `↓` `⇒`; Wingdings `è` `ç` `é` `ê`; private U+F0E7 to U+F0EA; `Ø` ➢ inside a line | The Unicode arrow |
| `☎`; Wingdings `(`; private U+F028 | `☎` |
| `©` `®` `™` `§` `¶` `†` `‡` `°` `±` `×` `÷` `µ` `½` `¼` `¾` `€` `£` `¥` `¢` | As written |
| `…` U+2026 | As written. Not three dots. |
| Superscript digits `¹` `²` `³`, `ª` `º`, `№` | As written |
| Emoji | As written. No `:codes:`. |
| Accented letters | As written, UTF-8, in an English unit. A unit in another language is left out, see Languages in section B. |
| Letters outside the Latin script, such as Arabic, Bengali or Chinese | A unit that is mostly in another script is left out. A few such letters inside an English unit stay as written. |
| A private-use glyph with no known meaning, inside a line | Dropped. At the line start it is a bullet. |

### 3. Repairs: wrong bytes that mean a letter

| Input | Markdown |
| --- | --- |
| Ligatures `ﬀ` `ﬁ` `ﬂ` `ﬃ` `ﬄ` `ﬅ` `ﬆ`, U+FB00 to U+FB06 | `ff` `fi` `fl` `ffi` `ffl` `ft` `st` |
| Mojibake such as `â€™`, `â€“`, `â€¢`, `Ã©` | `’` `–` `•` `é`: the UTF-8 bytes decoded again |
| NUL U+0000 and other control characters U+0001 to U+001F and U+007F to U+009F, except tab, line feed and carriage return | Dropped |
| `�` U+FFFD | Dropped, after the page's garbled share is counted |
| Soft hyphen U+00AD | Dropped |
| Zero-width space U+200B, joiners U+200C and U+200D, byte-order mark U+FEFF, word joiner U+2060 | Dropped |
| No-break space U+00A0, narrow U+202F, figure space U+2007, the spaces U+2000 to U+200A, U+205F, ideographic space U+3000 | One space |
| Tab U+0009 | One space |
| Two or more spaces in a row | One space. Two spaces at a line end would make a hard break. |
| Line separator U+2028, paragraph separator U+2029 | A line break, a paragraph break |
| A letter-spaced word, `d e l i v e r i n g` | Joined by the glyph gaps, as the SDK does today |
| A word broken at a line end with `-` | Joined without a space, `Vice-` and `Chair` give `Vice-Chair`, as today |
| Text drawn twice at the same place, a halo | Once |
| HTML entities `&amp;` `&#8217;` `&nbsp;`, also when encoded twice | The character |

### 4. Dashes and quotes: kept as written

| Input | Markdown |
| --- | --- |
| `-` U+002D, `‐` U+2010, `‑` U+2011, `‒` U+2012, `–` U+2013, `—` U+2014, `−` U+2212 | As written |
| `'` `’` `‘` `‚` `‛` `´` `′` and the backtick | As written. The backtick is escaped, see 10. |
| `"` `“` `”` `„` `″` | As written |

### 5. Lines that are drawing, not words

| Input | Markdown |
| --- | --- |
| A line of only `_` `-` `=` `*` `~` `.` `…` `—`, three or more | `---` on its own line, with a blank line before it, so it never turns the line above into a setext heading |
| A horizontal rule drawn across the page, from the drawing operators | `---` the same way |
| A contents line with leaders, `Introduction ........ 3` | As written. Dots are safe. |
| A `Page 5 of 8` line, or a page number alone | As written, as a paragraph. Never a heading, so it cannot be confused with the page marker. |
| Box-drawing characters `│` `─` `┼` | As written |

### 6. Raised and lowered text, footnote marks

| Input | Markdown |
| --- | --- |
| A PDF text piece smaller than the line's font and raised above its baseline | `<sup>…</sup>` |
| A PDF text piece smaller and below the baseline | `<sub>…</sub>` |
| Word `w:vertAlign` superscript or subscript | `<sup>` or `<sub>` |
| HTML `sup` or `sub` | `<sup>` or `<sub>` |
| A Word footnote reference and its text | `[^1]` in the text and `[^1]: text` at the end of the document |
| A PDF footnote: a raised number and the note at the page foot | `<sup>1</sup>` and the note as a paragraph where it sits. No pairing. |
| Ordinals `1st` `2nd` with the suffix raised | `1<sup>st</sup>` |

### 7. Font cues

| Input | Markdown |
| --- | --- |
| Bold: Word `w:b`; HTML `strong` `b`; a PDF font name with `Bold`, `Black`, `Heavy` or `Semibold` | `**…**`. Spaces moved outside the marks. Adjacent runs with the same style merged. |
| Italic: Word `w:i`; HTML `em` `i`; a PDF font name with `Italic` or `Oblique` | `*…*` |
| Bold and italic | `***…***` |
| Strikethrough: Word `w:strike` `w:dstrike`; HTML `s` `del` `strike` | `~~…~~` |
| Underline: Word `w:u`; HTML `u` | Nothing. Markdown has no underline, and no HTML tag is used. |
| Highlight: Word `w:highlight` `w:shd`; HTML `mark` | Nothing. No HTML tag is used. |
| Colour, font family, font size inside a paragraph | Nothing |
| A whole line in a larger font than the body, in a PDF | A heading. The level is the size rank, 1 to 6. |
| A whole short line in bold at the body size, in a PDF | A bold paragraph, not a heading |
| ALL CAPS | As written. Never re-cased. |
| A monospace font such as Courier or Consolas; Word `Code` style; HTML `code` `pre` | Inline code, or a fenced block for a whole paragraph |

### 8. Links

| Input | Markdown |
| --- | --- |
| `http://…` or `https://…` in text | `<https://…>` |
| `www.…` in text | As written. GFM links it. |
| An email address | `<name@host>` |
| A PDF link annotation over text | `[text](url)` |
| Word `w:hyperlink`; HTML `a href` | `[text](url)`. A relative HTML address is resolved against the item's address. |
| A link whose text is its own address | `<url>` |
| A URL broken over two lines | Joined first |

### 9. Breaks

| Input | Markdown |
| --- | --- |
| A paragraph end: Word `w:p`; an HTML block end; a PDF paragraph gap | A blank line |
| A line break inside a paragraph: Word `w:br`; HTML `br` | `\` at the line end |
| A PDF line inside a paragraph | Joined with a space. The paragraph flows. |
| A Word page break `w:br type=page` or a section break | `---`, a rule, not a page marker, since a Word file is one page |
| A PDF page end | The page marker: `---` and `###### Page n of m` |
| A column break | Nothing |

### 10. Source characters that are markdown syntax

Escaped with a backslash. The list is fixed, so the output is predictable.

| Where | Characters | Written as |
| --- | --- | --- |
| Anywhere | `\` `*` `_` `` ` `` `[` `]` `<` | `\\` `\*` `\_` `` \` `` `\[` `\]` `\<` |
| At a line start | `#` `>` `+` `-` `=` `~` `\|`, and digits followed by `.` or `)` and a space, when the line is not a list item | A backslash before the first character |
| In a table cell | `\|` and a line break | `\\|` and `<br>` |
| Anywhere | `~~` | `\~\~` |
| Anywhere | `&` followed by a name and `;`, such as `&copy;`, which markdown would turn into `©` | `\&` |
| Anywhere | `$` | As written. GitHub reads `$…$` on one line as maths, but `£` is the money sign in these papers, and `\$` would litter the text. |

### 11. For the OCR step, later

Tesseract misreads a bullet as `e`, `*`, `°`, `o`, `¢`, `«`, `©`, `®`, `@` or `|` at a line start. The OCR step maps those to `- ` when it writes its markdown. Not part of this build.
