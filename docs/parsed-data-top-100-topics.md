# Top 100 topics in the parsed data

Date: 16 October 2026.

This doc ranks the 100 topics that councils discussed most, across all
the parsed text in the Govbase read store. The order is by the number of
texts that discuss each topic.

## Short answer

- The top five are community engagement and the voluntary sector,
  constitution and governance, schools, performance and the corporate
  plan, and biodiversity.
- Governance topics take 21 of the 100 places. Most council papers are
  about how the council runs itself.
- Climate change (6) and biodiversity (5) are in the top ten. Planning
  rules on nature, such as biodiversity net gain, push biodiversity up.
- Local government reorganisation (45) is in 3,052 texts in 305
  councils.
- AI (85) is in 1,225 texts in 245 councils.

## Data

| Source | Count |
| --- | --- |
| Text objects in `read/v1` | 41,320 |
| Texts with blocks, used here | 40,684 |
| Typed-pages texts, not used | 636 |
| OCR texts, not used | 502 |
| Tokens in all text objects | 184,219,930 |
| Document outcomes | 28,100 (27,242 read) |
| Councils with documents | 357 |
| Agenda items from council records | 11,957 |
| Meetings with agenda items | 1,641 |
| Councils with a council record | 371 |

The texts come from the 15 October full read and the 16 October read.
A council record holds only the latest read, so the agenda item counts
cover only that read.

A "text" is one parsed text object. It is a document, such as a report,
minutes or an appendix, or the text of an agenda page. Two documents with
the same content share one text.

## Method

1. Each text was made lowercase. Report template lines were removed,
   such as `financial implications: none`. Headings were kept apart from
   the body.
2. There are 125 topics. Each topic has a regular expression (a search
   pattern) that lists its key phrases. 117 topics are about subjects.
   8 topics are meeting procedure, such as apologies.
3. ripgrep searched all texts once per topic. The search counted heading
   hits and body hits for each text.
4. A text **discusses** a topic when one of these is true:
   - a heading matches the topic, or
   - the body has at least `min` matches. `min` is set per topic, mostly
     3. Procedure topics use 2.
5. The rank is the number of texts that discuss the topic. Mentions break
   ties.

### Columns

| Column | Meaning |
| --- | --- |
| Documents | Texts that discuss the topic. This sets the rank. |
| In a heading | Texts where a heading matches. |
| Mentions | All matches in all texts. |
| Agenda items | Items whose title matches, or whose linked text discusses the topic. |
| Meetings | Meetings with at least one such item, out of 1,641. |
| Councils | Councils with a text or an item that discusses the topic. |

### Pattern clean-up

The first run gave wrong results. "Harbours and the coast" came second,
because "port" matched inside "report" and "support". Three fixes were
made before this ranking:

- A word edge (`\b`) at the start of every pattern.
- Filler words removed from pattern groups, so "governance and" no longer
  counts.
- Vague words removed, such as `send` (the verb), `rent`, `common`,
  `park` (it matched "car park"), `0-5`, `111` and `999`.

After the fixes, the top matched phrases of every topic were checked by
hand. The parser faults found on the way are in
[parsed-text-issues.md](parsed-text-issues.md).

## The top 100

| # | Topic | Group | Documents | In a heading | Mentions | Agenda items | Meetings | Councils |
| ---: | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 1 | Community engagement, consultation and the voluntary sector | Community | 12,873 | 9,214 | 210,295 | 4,584 | 1,302 | 354 |
| 2 | Constitution, delegations and governance | Governance | 9,919 | 7,578 | 128,359 | 3,646 | 1,172 | 347 |
| 3 | Schools and education | People | 9,795 | 7,129 | 297,004 | 3,794 | 1,212 | 347 |
| 4 | Performance and the corporate plan | Governance | 9,750 | 7,891 | 118,988 | 3,784 | 993 | 345 |
| 5 | Biodiversity and nature recovery | Environment | 7,829 | 6,078 | 287,081 | 3,039 | 996 | 348 |
| 6 | Climate change and net zero | Environment | 7,641 | 5,714 | 142,331 | 3,167 | 973 | 346 |
| 7 | Equality, diversity and inclusion | Community | 7,130 | 5,113 | 89,364 | 2,759 | 990 | 343 |
| 8 | Workforce, pay and staffing | Governance | 6,926 | 4,974 | 73,479 | 3,144 | 977 | 339 |
| 9 | Audit, accounts and governance assurance | Governance | 6,827 | 4,879 | 228,453 | 2,541 | 819 | 329 |
| 10 | Children's social care and safeguarding | People | 6,611 | 4,862 | 124,089 | 2,535 | 917 | 337 |
| 11 | Procurement and contracts | Finance | 6,004 | 3,438 | 91,135 | 2,550 | 940 | 345 |
| 12 | Revenue budget and financial monitoring | Finance | 5,937 | 3,983 | 104,475 | 2,485 | 840 | 332 |
| 13 | Risk management | Governance | 5,776 | 4,563 | 51,503 | 2,283 | 867 | 338 |
| 14 | Community safety, crime and anti-social behaviour | Community | 5,748 | 4,313 | 82,792 | 2,227 | 973 | 347 |
| 15 | Adult social care | People | 5,620 | 3,889 | 137,310 | 2,093 | 775 | 317 |
| 16 | Digital, IT and information governance | Governance | 5,549 | 4,162 | 60,731 | 2,546 | 891 | 327 |
| 17 | Grants and external funding | Finance | 5,413 | 3,217 | 66,301 | 2,168 | 858 | 338 |
| 18 | Planning applications and decisions | Planning and place | 5,383 | 4,002 | 106,400 | 2,045 | 700 | 325 |
| 19 | Legal matters and litigation | Governance | 5,249 | 2,886 | 42,862 | 2,220 | 928 | 342 |
| 20 | Overview and scrutiny | Governance | 5,186 | 4,448 | 39,154 | 1,762 | 679 | 316 |
| 21 | Property, land and asset management | Governance | 5,054 | 3,643 | 61,801 | 2,181 | 898 | 342 |
| 22 | Council housing and landlord services | Housing | 4,879 | 3,411 | 92,886 | 1,893 | 742 | 329 |
| 23 | Regeneration and town centres | Planning and place | 4,842 | 3,580 | 55,587 | 2,066 | 814 | 338 |
| 24 | Agriculture, rural affairs and common good | Environment | 4,656 | 3,017 | 64,310 | 2,331 | 783 | 322 |
| 25 | Public health and health improvement | Health | 4,625 | 3,275 | 75,845 | 1,829 | 803 | 331 |
| 26 | Government consultations and correspondence | Governance | 4,554 | 2,721 | 45,465 | 2,136 | 834 | 339 |
| 27 | Flooding, drainage and water | Environment | 4,552 | 3,265 | 141,313 | 1,900 | 784 | 343 |
| 28 | NHS, health services and integration | Health | 4,544 | 3,016 | 86,533 | 1,931 | 769 | 318 |
| 29 | Highways and road maintenance | Transport | 4,530 | 2,856 | 78,201 | 1,757 | 773 | 333 |
| 30 | Housing supply and affordable homes | Housing | 4,442 | 2,979 | 75,069 | 1,713 | 726 | 336 |
| 31 | Planning policy and the local plan | Planning and place | 4,388 | 2,939 | 144,428 | 1,574 | 628 | 336 |
| 32 | Parks, play and open spaces | Environment | 4,300 | 2,879 | 70,337 | 1,812 | 796 | 337 |
| 33 | Waste, recycling and street cleansing | Environment | 4,268 | 2,879 | 73,102 | 1,813 | 827 | 342 |
| 34 | Buses, rail and public transport | Transport | 4,029 | 2,671 | 72,490 | 1,624 | 747 | 327 |
| 35 | Economic development, business and jobs | Planning and place | 3,997 | 2,902 | 40,229 | 1,857 | 784 | 326 |
| 36 | Traffic management and road safety | Transport | 3,851 | 2,479 | 76,154 | 1,508 | 667 | 325 |
| 37 | Leisure centres, sport and swimming | Community | 3,588 | 2,511 | 42,855 | 1,700 | 827 | 336 |
| 38 | Capital programme and borrowing | Finance | 3,489 | 2,386 | 61,370 | 1,485 | 596 | 317 |
| 39 | Medium-term finances, savings and sustainability | Finance | 3,460 | 2,126 | 55,410 | 1,389 | 569 | 323 |
| 40 | Tourism, culture, arts and events | Planning and place | 3,361 | 2,510 | 43,351 | 1,668 | 854 | 314 |
| 41 | Welfare, benefits and the cost of living | Community | 3,297 | 2,213 | 36,741 | 1,545 | 672 | 315 |
| 42 | Parking | Transport | 3,259 | 2,067 | 43,188 | 1,356 | 652 | 332 |
| 43 | Walking, cycling and active travel | Transport | 3,085 | 1,736 | 57,397 | 1,201 | 592 | 314 |
| 44 | Skills, adult learning and employment support | People | 3,082 | 1,646 | 29,169 | 1,343 | 619 | 311 |
| 45 | Local government reorganisation and devolution | Governance | 3,052 | 1,893 | 33,075 | 1,156 | 475 | 305 |
| 46 | Partnership boards and joint committees | Governance | 3,034 | 1,996 | 30,308 | 1,507 | 630 | 292 |
| 47 | Alcohol, entertainment and gambling licensing | Regulation | 2,997 | 2,276 | 77,597 | 1,163 | 562 | 299 |
| 48 | Environmental health, food safety and animal licensing | Regulation | 2,793 | 2,113 | 23,096 | 1,387 | 688 | 321 |
| 49 | Hospitals, ambulances and urgent care | Health | 2,743 | 1,387 | 23,736 | 1,248 | 604 | 312 |
| 50 | Fostering and adoption | People | 2,716 | 1,161 | 24,378 | 1,148 | 602 | 313 |
| 51 | Developer contributions, Section 106 and CIL | Planning and place | 2,654 | 1,745 | 35,637 | 1,113 | 503 | 316 |
| 52 | Treasury management and investments | Finance | 2,575 | 1,832 | 55,198 | 1,110 | 492 | 307 |
| 53 | Building control and building safety | Housing | 2,574 | 1,603 | 25,393 | 1,225 | 614 | 314 |
| 54 | Early years and childcare | People | 2,548 | 1,519 | 29,541 | 1,085 | 513 | 278 |
| 55 | SEND and additional learning needs | People | 2,521 | 1,396 | 31,740 | 906 | 384 | 256 |
| 56 | Mental health and wellbeing | People | 2,431 | 1,595 | 34,172 | 1,036 | 483 | 280 |
| 57 | Emergency planning and resilience | Governance | 2,416 | 1,409 | 21,056 | 1,209 | 672 | 302 |
| 58 | Freedom of information and data protection | Governance | 2,410 | 1,641 | 16,807 | 1,291 | 578 | 280 |
| 59 | Communications and marketing | Governance | 2,371 | 1,425 | 19,494 | 1,195 | 663 | 308 |
| 60 | Air quality, noise and pollution | Environment | 2,369 | 1,599 | 37,564 | 954 | 514 | 315 |
| 61 | Homelessness and temporary accommodation | Housing | 2,313 | 1,566 | 40,728 | 922 | 447 | 298 |
| 62 | Design, tall buildings and public realm | Planning and place | 2,311 | 1,751 | 27,152 | 932 | 468 | 306 |
| 63 | Heritage and conservation | Planning and place | 2,296 | 1,670 | 57,536 | 917 | 452 | 300 |
| 64 | Private rented sector and HMOs | Housing | 2,237 | 1,584 | 43,622 | 1,006 | 502 | 305 |
| 65 | Elections and democratic arrangements | Governance | 2,098 | 1,553 | 17,579 | 1,077 | 516 | 273 |
| 66 | Trees, woodland and hedgerows | Planning and place | 2,052 | 1,429 | 33,314 | 871 | 421 | 301 |
| 67 | Complaints and the ombudsman | Governance | 1,935 | 1,405 | 32,284 | 797 | 425 | 298 |
| 68 | Shared services and transformation | Governance | 1,923 | 1,265 | 15,466 | 954 | 455 | 268 |
| 69 | Planning enforcement and appeals | Planning and place | 1,841 | 1,242 | 16,072 | 953 | 471 | 291 |
| 70 | Council tax | Finance | 1,840 | 1,360 | 25,795 | 884 | 440 | 278 |
| 71 | Domestic abuse and violence against women | Community | 1,726 | 958 | 23,662 | 766 | 417 | 278 |
| 72 | Fees and charges | Finance | 1,664 | 1,119 | 14,219 | 765 | 412 | 285 |
| 73 | Electric vehicles and fleet | Transport | 1,649 | 1,072 | 17,316 | 731 | 425 | 289 |
| 74 | Older people and dementia | People | 1,610 | 791 | 11,983 | 705 | 374 | 263 |
| 75 | Leaseholders and tenure | Housing | 1,563 | 688 | 11,692 | 643 | 372 | 276 |
| 76 | Libraries | Community | 1,505 | 950 | 16,289 | 728 | 421 | 260 |
| 77 | Harbours, piers and the coast | Environment | 1,439 | 956 | 12,871 | 620 | 351 | 207 |
| 78 | Corporate parenting and care leavers | People | 1,433 | 1,002 | 11,333 | 576 | 238 | 198 |
| 79 | Cemeteries, crematoria and bereavement | Environment | 1,428 | 937 | 17,327 | 765 | 413 | 271 |
| 80 | Major infrastructure, minerals and energy projects | Planning and place | 1,405 | 719 | 17,756 | 715 | 386 | 259 |
| 81 | Pension fund | Governance | 1,328 | 1,085 | 46,736 | 445 | 221 | 206 |
| 82 | Asylum, refugees and migration | Community | 1,326 | 688 | 9,604 | 598 | 346 | 262 |
| 83 | GP, primary care and dentistry | Health | 1,245 | 596 | 11,329 | 589 | 300 | 237 |
| 84 | Taxi and private hire licensing | Regulation | 1,233 | 727 | 25,546 | 653 | 332 | 244 |
| 85 | Artificial intelligence and automation | Governance | 1,225 | 505 | 10,392 | 588 | 332 | 245 |
| 86 | Business rates | Finance | 1,169 | 747 | 9,702 | 576 | 317 | 253 |
| 87 | Learning disability and autism | People | 1,118 | 543 | 8,348 | 505 | 280 | 215 |
| 88 | Good relations and community relations | Community | 961 | 609 | 5,226 | 603 | 257 | 172 |
| 89 | Damp, mould and disrepair | Housing | 945 | 408 | 8,484 | 393 | 220 | 205 |
| 90 | Obesity, healthy eating and physical activity | Health | 935 | 502 | 9,043 | 425 | 260 | 205 |
| 91 | Gypsy and Traveller sites | Housing | 914 | 489 | 8,814 | 427 | 258 | 229 |
| 92 | Youth services and young people | People | 902 | 618 | 7,759 | 404 | 237 | 205 |
| 93 | Armed forces covenant and veterans | Community | 902 | 602 | 5,265 | 465 | 246 | 211 |
| 94 | Dogs and animal welfare | Regulation | 859 | 493 | 14,516 | 440 | 291 | 220 |
| 95 | Smoking and vaping | Health | 839 | 431 | 9,329 | 383 | 259 | 201 |
| 96 | Drugs and alcohol misuse | Health | 833 | 501 | 6,290 | 387 | 215 | 193 |
| 97 | Cyber security | Governance | 731 | 471 | 4,628 | 348 | 206 | 182 |
| 98 | Unpaid carers | People | 676 | 406 | 6,894 | 302 | 154 | 160 |
| 99 | Fuel poverty and warm homes | Community | 661 | 309 | 3,877 | 366 | 221 | 187 |
| 100 | Trading standards and consumer protection | Regulation | 654 | 386 | 4,417 | 314 | 204 | 185 |

### Just below the 100

| # | Topic | Documents |
| ---: | --- | ---: |
| 101 | Welsh, Gaelic and Irish language | 623 |
| 102 | Broadband and digital connectivity | 563 |
| 103 | Potholes and road condition | 548 |
| 104 | Street lighting | 523 |
| 105 | Home to school transport | 522 |
| 106 | Food banks and food insecurity | 514 |
| 107 | Health and safety at work | 490 |
| 108 | Child poverty | 473 |
| 109 | Empty homes | 471 |
| 110 | Council-owned companies and trading | 457 |
| 111 | Public toilets | 398 |
| 112 | Civic mayoralty and honours | 391 |
| 113 | Insurance | 385 |
| 114 | Markets and street trading | 352 |
| 115 | Sexual health | 209 |
| 116 | Winter maintenance and gritting | 159 |
| 117 | Twinning and international links | 67 |

## Meeting procedure, not ranked

These are part of almost every meeting. They are not subjects, so they
are not in the 100.

| Topic | Documents | Agenda items | Meetings |
| --- | ---: | ---: | ---: |
| Work programmes and forward plans | 15,312 | 5,789 | 1,525 |
| Exclusion of the press and public | 5,686 | 2,568 | 1,068 |
| Declarations of interest | 5,284 | 3,329 | 1,433 |
| Apologies for absence | 4,308 | 2,862 | 1,353 |
| Minutes of the previous meeting | 3,371 | 2,000 | 1,030 |
| Petitions, public questions and deputations | 3,136 | 1,393 | 673 |
| Urgent business and other business | 2,942 | 1,806 | 823 |
| Notices of motion | 651 | 400 | 164 |

The work programme count is too high. Its pattern still matches minute
phrases such as "meeting held on" and "it was noted".

## Notes by group

| Group | Places in the 100 | Highest |
| --- | ---: | --- |
| Governance | 21 | Constitution (2), performance (4), workforce (8), audit (9) |
| People | 13 | Schools (3), children's social care (10), adult social care (15) |
| Community | 11 | Community engagement (1), equality (7), community safety (14) |
| Planning and place | 11 | Planning applications (18), regeneration (23), local plan (31) |
| Environment | 9 | Biodiversity (5), climate (6), agriculture (24), flooding (27) |
| Finance | 9 | Procurement (11), revenue budget (12), grants (17) |
| Housing | 8 | Council housing (22), housing supply (30), building safety (53) |
| Health | 7 | Public health (25), NHS (28), hospitals (49) |
| Transport | 6 | Highways (29), public transport (34), traffic (36) |
| Regulation | 5 | Licensing (47), environmental health (48), taxis (84) |

- **Governance is the biggest group.** Constitution, performance, audit,
  risk and scrutiny papers come to every committee cycle.
- **Mentions differ from documents.** Schools and biodiversity have the
  most mentions, because their reports are long. Planning policy has
  144,428 mentions in 4,388 texts, because local plan papers are long.
- **Some topics are mostly in the body.** Fostering and adoption,
  hospitals and SEND have fewer heading hits than other topics of the
  same size. They come up inside wider reports.
- **Northern Ireland and Scotland topics are small on purpose.** Good
  relations (88) is almost all Northern Ireland. Common good funds sit
  inside agriculture and rural affairs (24).

## Caveats

- **Keyword counts, not AI judgment.** A text "discusses" a topic when
  its words match. A report that names "climate change" three times in
  standard text counts the same as a climate strategy.
- **Broad topics rank high.** Community engagement and constitution
  cover many phrases. Narrow topics, such as twinning, cannot reach the
  same counts.
- **Topics overlap.** One text can count for many topics. Adoption counts
  for both children's social care and fostering and adoption.
- **Heading counts are too high.** The parser tags many table rows and
  names as headings. See fault 1 in
  [parsed-text-issues.md](parsed-text-issues.md).
- **One window of time.** The texts span the 15 and 16 October reads.
  Agenda item counts use only the latest council records.
- **Not all text is used.** The 636 typed-pages texts and the 502 OCR
  texts are not in the counts.
- **Apostrophes.** Some phrases are split between `'` and `’`. See fault
  16 in the issues doc.

## Sources and scripts

- Bucket: `gs://govbase-pipeline-documents-dev`, store `read/v1`: texts,
  documents and council records.
- The scripts are in the session temp folder, not in a repository:
  `parse_councils.py` (agenda items), `count_hits.py` (one ripgrep pass
  per topic), `aggregate.py` (ranking), `top_strings.py` (top phrases
  per topic), `clean_topics.py` (pattern clean-up).
- Topic patterns: `topics/part1.jsonl` to `part6.jsonl` in the same
  folder.
