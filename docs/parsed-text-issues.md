# Parsed text issues

Date: 16 October 2026.

This doc lists the faults found in the parsed text while ranking topics
across all documents. Use it to fix the parser in `govbase-parser-sdk`.

## Scope

- Source: the read store in `gs://govbase-pipeline-documents-dev`, from
  the 15 October full read and the 16 October read.
- 41,320 text objects. 40,684 have blocks. 636 are typed pages with no
  blocks.
- 184,219,930 tokens in total, by the parser's own `tokenCount`.
  733 million characters.
- Counts below are text objects (one per content hash), unless a row
  says otherwise.

## First: two faults that were not the parser

These faults were in my topic search, not in the parsed text. They are
here so nobody fixes the parser for them.

| Fault | Effect | Fix |
| --- | --- | --- |
| Search patterns had no word edge (`\b`) at the start | "port" matched inside "report" and "support". "rent" matched inside "current". "eel" matched inside "feel". "ice and" matched inside "service and". "harbours and coast" became the second biggest topic. | Put `\b` at the start of every pattern. |
| Pattern groups ended in filler words, such as `governance (…\|and\|or)` | "governance and", "framework for" and "charge of the" counted as topic hits. | Remove filler words from groups. Keep groups made only of joiners, such as `(?:and\|&)`. |
| Unicode `\b` in ripgrep | One topic took 84 s, not 0.3 s. | Use `(?-u:\b)`. |

## Parser faults, ranked by how many texts they touch

| # | Fault | Texts | Hits | Fix in the parser |
| --- | --- | --- | --- | --- |
| 1 | Heading tag on things that are not headings | most texts; about half of a 30-block sample | 2,678,119 heading blocks against 2,775,353 body blocks | Tighten the heading rule. See 1 below. |
| 2 | Very short texts | 8,241 under 200 characters, 1,570 under 50 | | Send image-only PDFs to OCR. See 2. |
| 3 | The same block repeated many times in one text | 4,598 texts with more than 5 repeats | | Drop repeated page headers and footers. See 3. |
| 4 | Contents lines with dot leaders | 1,286 | 34,229 | Drop or tag as contents. See 4. |
| 5 | Underscore rules (`____`) kept as text | 1,196 | 5,666 | Drop lines that are only `_`, `-` or `=`. |
| 6 | Line-end hyphen joined with a space | 1,980 | 4,331 | Join without the space. See 6. |
| 7 | Private-use glyphs (Wingdings boxes and ticks) | 905 | 21,872 | Map to ☐ and ☑, or to "yes" and "no". See 7. |
| 8 | "Page X of Y" in the middle of a sentence | 688 | 17,725 | Remove page footers before joining lines. See 8. |
| 9 | Web page script and menu code kept as text | about 500 of 569 matches | 7,993 | Strip `<script>` and menu code from HTML. See 9. |
| 10 | Broken font map: control bytes and shifted letters | 105 | 4,583 | Mark the text as unreadable and send it to OCR. See 10. |
| 11 | Unicode replacement character `�` | 77 | 3,564 | Same as 10. |
| 12 | Letter-spaced words | 59 | 181 | Join single letters when the gaps are even. See 12. |
| 13 | NUL bytes in text | 32 | 1,574 | Strip `\x00`. See 13. |
| 14 | Mojibake (text decoded twice) | 7 | 225 | Decode HTML by its declared charset. See 14. |
| 15 | Language tag almost never set | all | 138 of about 7 million blocks tagged `cy` | See 15. |
| 16 | Two apostrophe forms | 23,475 curly, 12,411 straight | | Make `’` into `'`. See 16. |

## Detail and examples

### 1. Heading tag on things that are not headings

In a sample of 300 texts there were 17,974 heading blocks, about 60 per
text. Many of these are not headings. They are table rows, names, dates,
fragments and contents lines.

Examples, all tagged `heading`:

- `'10 Theale Englefield Road A340 Church Street, Theale'` (a table row)
- `'Transport -0.29% -17.33%'` (a table row)
- `'27 August 2026'` (a date)
- `'James Bensly'` (a name)
- `'(completed February'` (a broken fragment)
- `'Cabinet Member for'` (half of a line)
- `'INTRODUCTION OF AI ASSISTANCE ........................ 5'` (a
  contents line)
- `'Additional Community Clean ups and Planting -£10,000 Youth Engagement
  Budget -£5,000 Heritage Festival activities -£5,000'` (a budget line)

Effect: the heading-based search treats these as headings, so topic
counts go up. Any later step that uses headings to split sections gets
wrong sections.

Possible rules: a heading has no `%`, `£` or more than two numbers. It
does not end inside a bracket. It is not a date or a person's name on its
own. It is not more than about 15 words long.

### 2. Very short texts

8,241 block texts have less than 200 characters, and 1,570 have less than
50. Most of these come from agenda item text on the council pages, which
is expected, for example `To approve as a correct record the minutes of
the meeting held…`.

620 of them are documents: 499 PDFs, 6 Word files and 115 other files.
Many PDFs hold only a title such as `Appendix A`, `APPENDIX 2` or
`PUBLIC / PUBLIC`. The rest of the page is an image, such as a scanned
letter, a plan or a table.

Fix: when a PDF has many pages but very little text per page, mark it as
pending scan and send it to OCR. Do not save it as read.

### 3. The same block repeated many times

4,598 texts have a block of 30 or more characters that repeats more than
5 times. These are page headers and footers.

- 16 × `APPLICATION NUMBER – LA09/2024/0156/F`
- 13 × `Report by Executive Director Education, Housing and Communities`
- 8 × `Matter giving rise to recommendation`
- 7 × `If Yes, please provide a brief summary of the impact?`

Some text is drawn several times on top of itself, such as map labels:
`Marefield LaneMarefield LaneMarefield Lane…` (9 times, with no spaces).

Fix: drop a block that appears at the same place on most pages. Join
text that is drawn more than once at the same place.

### 4. Contents lines with dot leaders

1,286 texts, 34,229 lines. Example:
`1. introduction ...................................... 3`

Fix: tag them as `contents` or drop them. Do not tag them as headings.

### 5. Underscore rules

1,196 texts. Example:
`committee room 6 be noted. ______________________________ green: action
completed`

### 6. Line-end hyphen joined with a space

1,980 texts, 4,331 times. The PDF wraps `Vice-` at the end of a line, and
the parser joins the next line with a space.

- `Cuthbertson (Vice- Chair)` (raw block from City of York minutes)
- `multi- disciplinary team`
- `sub- committees and panels`
- `anti- muslim hate crime`
- `an ai- powered forecasting platform`

Fix: when a line ends in `-` after a letter, join the next line with no
space. Keep the hyphen. These are compound words, not split words.

### 7. Private-use glyphs

905 texts, 21,872 glyphs. Most are Wingdings boxes and ticks on forms.
The text loses which box was ticked.

- `local member(s) advised: yes \uf06f no \uf06f`
- `citywide: ✓ consulted: yes \uf06f no \uf06f`
- `\uf0a3 individual \uf054 organisation/corporate entity`
- `\uf058 rural revitalisation`

Fix: map the common Symbol and Wingdings code points (`\uf06f`,
`\uf0a3`, `\uf0fe`, `\uf078`, `\uf054`, `\uf058`) to ☐, ☑ and •.

### 8. "Page X of Y" in a sentence

688 texts, 17,725 times. The page footer is put inside a sentence that
runs across two pages.

- `the percentage of children in page 5 of 8 care who are in not in
  education`
- `does not have the specialist domestic page 12 of 16 abuse expertise`
- `there was a bcc telephone number"page 53 of 120 | citizen's
  understanding`

Fix: remove footer lines before joining text across a page break.

### 9. Web page code kept as text

569 texts match a code pattern. A few are true prose, such as
`statutory function (of the committee`. Most are menu and widget code
from HTML pages.

- `jQuery(function($) { $("#dnn_MENU1").superfish( {MenuStyle:'Menu/S`
- `(function(){function c(){var b=a.contentDocument||(a.content`
- `select language ​▼ function googletranslateelementinit()` (Great
  Yarmouth pages)

Fix: drop `<script>`, `<style>`, `<noscript>` and `<nav>` before reading
HTML text. Drop the Google Translate widget.

### 10. Broken font map

105 texts have control bytes, and 77 texts have `�`. The PDF font has no
working map from glyphs to letters.

- `head of the northern ire\x12and audit office` (`l` became `\x12`)
- `note\x1d no c+anges to block plan` (`h` became `+`)
- `$SSHQGL[` is `Appendix` with each letter moved three places
- `shoulddle issuebe �rsuedthrough o'le | council's intecf'l.a`
- `£� the highland | £"'£"" council | -��comh`

Fix: count the bad characters per page. Above a set share, such as
2 percent, treat the page as unreadable and send it to OCR.

### 11. Unicode replacement character

See 10. These are the same kind of fault.

### 12. Letter-spaced words

59 texts. The PDF places each letter on its own, and the parser adds a
space between letters.

- `d eliv erin g h i g h q u a l i t y a n d e x c e ll e n c e i s o u r n o r m`
- `w w w. blaenau - gwent . g o v. u k`
- `b u r l i s h | m e a d o w s` (map labels)

Fix: use the glyph gaps. Add a space only when the gap is wider than
the normal gap between letters in that run.

### 13. NUL bytes

32 texts, 1,574 bytes. This made ripgrep treat whole shard files as
binary and stop reading them early.

- `this consists of\x00 cameras shall cover all public areas`
- `www\x00.niassembly.gov.uk`
- `subject: fw: objec\x00on - masonic lodge` (the `ti` ligature became
  `\x00`)

Fix: strip `\x00`. Map the `ti`, `fi` and `fl` ligature glyphs to letters
before stripping.

### 14. Mojibake

7 texts, 225 times. UTF-8 text was decoded as Windows-1252.

- `crime and disorderâ€¢ anti-social behaviour` (should be `•`)
- `canâ€™t find green waste collection day` (should be `’`)
- `paragraphs 68â€“70` (should be `–`)

Fix: decode HTML with the charset from the header or the `<meta>` tag,
and use UTF-8 when neither is set.

### 15. Language tag almost never set

Only 138 blocks out of about 7 million have a language (`cy`). All other
blocks have `null`. Welsh councils publish bilingual papers, and 623
texts mention Welsh, Gaelic or Irish language matters.

Fix: either set the language on every block, or remove the field. A field
that is almost always empty is metadata with no use.

### 16. Two apostrophe forms

23,475 texts use `’` and 12,411 use `'`. A search for `children's`
misses `children’s`. Some topic counts in the ranking show this split,
such as `children’s services`.

Fix: make `’` and `‘` into `'`, and `“` and `”` into `"`, when the
parser saves text. Keep the original in the raw bytes.

## Order of work

1. NUL bytes, mojibake and apostrophes (13, 14, 16). These are small,
   safe changes.
2. HTML script and menu code (9).
3. Hyphen joins, page footers, repeated headers and contents lines
   (6, 8, 3, 4, 5).
4. Heading rules (1). This has the biggest effect on any section-based
   step.
5. The OCR route for broken font maps and image-only PDFs (10, 11, 2).
6. Wingdings mapping and letter spacing (7, 12).
7. Decide what to do with the language field (15).

## How these were found

- `scripts/raw_issues.py` read every text object in `read/v1` and ran
  one regular expression per fault. It also counted tags, languages,
  repeated blocks and text length.
- `scripts/text_issues.py` ran the same checks over the filtered
  lowercase text used for the topic ranking.
- The scripts are in the session temp folder, not in a repository.
- The counts are pattern matches. A few are false matches, such as
  `function (` in prose. The examples are real text from the store.
