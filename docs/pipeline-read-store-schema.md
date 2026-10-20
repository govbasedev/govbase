# Pipeline read store schema

As of 2026-10-20.

This guide says what each field in `apps/pipeline/src/infrastructure/createReadStore/createReadStore.schema.ts` holds and why the pipeline needs it. The read store belongs to the `read` step and lives under `read/v1/` in the bucket. Each table has one row per field.

## Shared parts

The read store takes its item fields from the list store's `ListedItemSchema`, so a document is tied to one listed item. The document's `documentId` is the listed item's `id`: the SHA-256 hash of its URL, made once by `ItemIdSchema` when the list step builds the item. The read step never hashes the address again.

| Name | What it is | Why it is needed |
| --- | --- | --- |
| `READ_VERSION = 1` | The version of the read store shape. | It names the folder `read/v1/`. A breaking change goes to `read/v2/`. |
| `UnreadClassSchema` | A fixed reason class for an unread document: `restricted`, `link`, `no-text`, `not-supported`, `garbled`, `broken-file`, `too-large`, or a request failure class such as `gone` or `blocked`. | Reports and alerts count by class. The read step uses it to decide whether to try again. |
| `DocumentStatusSchema` | `read`, `unread` or `pending-scan`. | It tells the next run, and the OCR step, what to do with the document. |
| `PageNumbersSchema` | A list of page numbers. | It names the pages that need OCR. |
| `ListedItemSchema` (imported) | The list store's item: `id`, `title`, `url`. | `address`, `documentId` and `title` take their types from it, so they always match the listed item. |

## DocumentOutcomeSchema

One outcome per listed item, saved at `read/v1/state/documents/<documentId>.json`. It is the read step's memory between runs.

| Field | What it is | Why it is needed |
| --- | --- | --- |
| `schemaVersion` | The shape version. | Store rule: a reader can tell old objects from new ones. |
| `address` | The document's URL, the listed item's `url`. | The read step fetches it. Its type comes from `ListedItemSchema`. |
| `councilId` | The source id. | Reports and the OCR step group by council. |
| `documentId` | The listed item's `id`: the SHA-256 hash of its URL. | It ties the outcome to one listed item, and it names the file. |
| `title` | The item title from the listing. | People can read it in reports and in the bucket. |
| `status` | `read`, `unread` or `pending-scan`. | See `DocumentStatusSchema`. |
| `unreadReason` | Plain text, such as "no text in the document". `null` when read. | It is for people. It says exactly what went wrong. |
| `unreadClass` | The fixed class. `null` when read. | It is for code and counts. With `councils.lastingUnreadClasses`, it decides if the document is never tried again. |
| `contentType` | The type the server sent, such as `application/pdf`. `null` if no reply came. | It shows what the file claimed to be. This helps debug `not-supported`. |
| `contentHash` | The hash of the fetched bytes. | Same hash and same SDK version on the next fetch means the step keeps the old text and does not parse again. |
| `previousContentHash` | The hash from before the file last changed. | It shows that a council replaced a file. The step does not decide anything with it. |
| `attemptCount` | How many times the step fetched this document. | A `gone` document stops being retried after `councils.goneAfterAttempts` tries. |
| `sdkVersion` | The parser SDK version that read it. | A newer SDK reads the file once more, even if the bytes did not change. |
| `parser` | The parser that read it, such as PDF or HTML. | It shows which reader made the text. This helps debug. |
| `textKey` | The bucket key of the saved text. | The next step finds the text without a search. For a scan, the OCR step writes there later. |
| `scanPages` | The pages that need OCR. Empty when there are none. | The OCR step reads only these pages. |
| `firstSeenAtUnixMs` | When the step first saw this document. | It never changes, so you can see how long a document has been known. |
| `readAtUnixMs` | When this outcome was written. | It shows when the step last fetched the document. |

## PendingScanSchema

One record per document that waits for OCR, saved at `read/v1/state/pending/<firstSeenUnixMs>-<documentId>.json`. It is the work list of the `ocr` step. The time comes first in the file name, so the oldest scans come first.

| Field | What it is | Why it is needed |
| --- | --- | --- |
| `schemaVersion` | The shape version. | Store rule, as above. |
| `address` | The document's URL. | The OCR step can work without reading the outcome first. |
| `host` | The host of the address. | It finds the raw bytes, which are saved under `raw/<host>/`. |
| `councilId` | The source id. | Logs and reports group by council. |
| `documentId` | The listed item's `id`, as in the outcome. | It ties the scan to the same item and names the file. |
| `contentType` | The file type. | The OCR step must know if it has a PDF or an image. |
| `contentHash` | The hash of the bytes when they were read. | The OCR step checks the raw bytes against it. If they differ, the result is `bytes-changed`. |
| `scanPages` | The pages to OCR. | As in the outcome. |
| `typedPagesKey` | The key of the pages that already had typed text. | The OCR step merges those pages with the scanned ones. |
| `textKey` | Where the OCR step saves the merged text. | The outcome already points to this key. |
| `firstSeenAtUnixMs` | As in the outcome. | It puts the oldest scans first. |

## TaggedBlockSchema

One piece of a document's text.

| Field | What it is | Why it is needed |
| --- | --- | --- |
| `id` | `B0001`, `B0002` and so on. | A later step can point to an exact block. |
| `tokens` | An estimate of the block's size in tokens, from `tokens.charactersPerToken`. | A later step can plan what to send to a model and what it costs. |
| `text` | The block's text, with HTML entities decoded. | This is the content itself. |
| `tag` | `heading`, `boilerplate`, `contact`, `recommendation`, `summary` or `body`, set by the rules in `config/tagging.yaml`. | A later step can skip boilerplate and contact details and find the important parts. |
| `language` | A language code such as `en` or `cy`, from `languageMarkers`. `null` if not known. | Some councils publish in two languages. A later step can keep one. |

## SectionSchema

A run of blocks with one tag.

| Field | What it is | Why it is needed |
| --- | --- | --- |
| `tag` | `recommendation` or `summary`. | These are the parts a reader wants first. |
| `fromBlock`, `toBlock` | The first and last block ids. | They show where the section starts and stops without copying the text. |
| `tokens` | The section's size. | A later step can send only that section and know its cost. |

## TextObjectSchema

The saved text of one document, as gzipped JSON at `read/v1/state/texts/<contentHash>.json.gz`. The OCR step saves its text under `ocr/v1/`. The key is the content hash, so the same file is saved once, even at two addresses.

| Field | What it is | Why it is needed |
| --- | --- | --- |
| `schemaVersion` | The shape version. | Store rule, as above. |
| `contentHash` | The hash of the source bytes. | It is the object's identity and key. |
| `address` | Where the file came from. `null` if not known. | The text can be traced back to its source. |
| `contentType` | The file type. `null` if not known. | As above. |
| `parser`, `sdkVersion` | What made this text. | You can see which text an older SDK made. |
| `tagging.ruleSetId` | The tag rule set used. | It shows which rules tagged the blocks. |
| `tagging.ruleSetHash` | The hash of that rule set. | It shows if the rules changed but kept the same id. |
| `blocks` | All the tagged blocks. | The main content. |
| `sections` | The recommendation and summary sections. | See `SectionSchema`. |
| `excludedBlocks.boilerplate`, `excludedBlocks.contact` | How many blocks have these tags. | A quick count of the noise, without reading every block. |
| `tokenCount` | The total token estimate of the blocks. | The size of the whole document at a glance. |

## TypedPageSchema and TypedPagesSchema

The typed pages of a scanned document, saved at the outcome's `typedPagesKey`.

| Field | What it is | Why it is needed |
| --- | --- | --- |
| `pageNumber` | The page number. | It puts typed and scanned pages back in order. |
| `paragraphs` | The text of the page. | The text that needed no OCR. |
| `isGarbled` | `true` if the page text has too many broken characters. | A garbled page is read by OCR instead. |
| `schemaVersion` | The shape version. | Store rule, as above. |
| `contentHash`, `sdkVersion` | As in the text object. | They link the pages to the bytes and to the reader. |
| `pages` | The typed pages. | The OCR step merges them. |
| `scanPages` | The pages that still need OCR. | The OCR step's work for this document. |

## RawFactsSchema

The facts of one reply, saved at `read/v1/state/raw/<host>/<sha256(address)>.json`. The bytes are saved apart, at `read/v1/state/bodies/<contentHash>.body`. A raw reply can be a feed or a page as well as a document, so it is keyed by the hash of its address, not by an item id.

| Field | What it is | Why it is needed |
| --- | --- | --- |
| `address` | The address that was fetched. | It ties the facts to the request. |
| `status` | The HTTP status. | You can see failed and blocked replies later. |
| `headers` | The reply headers. | They help debug content types, blocks and redirects. |
| `contentHash` | The key of the saved bytes. | It finds the bytes. The OCR step and the parser SDK corpus tools use them. |
| `savedAtUnixMs` | When it was saved. | It shows how old the reply is. |

## Errors

| Error | Fields | When it happens |
| --- | --- | --- |
| `ReadStoreFailed` | `objectKey`, `reason` | The bucket could not read or write an object. It names the key, so you know which object failed. |
| `RawMissing` | `address`, `reason` | The raw bytes for an address are missing, so the OCR step cannot read the scan. |
