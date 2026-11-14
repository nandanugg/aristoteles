# The words of a decision for the person

The person did not watch the work. They read your words in the UI and decide from them alone.
Write so that a person who knows the aim of the project, and none of its records, can decide in
one read.

## The rules

1. **No ids and no words of the tool.** Do not write an id (d2, t3, r2, a3, v5, q1, sp1, h1) or
   the name of a record, a rule or a role (standard, rule id, section-lead, Luna, brief, result,
   escalation). Name each thing by what it is: "the Design part of the TSD", "the writer of the
   Design", "the reviewer of each part". A file name is good when the person knows the file.
2. **Short sentences, common words.** One idea in each sentence, in the active voice.

## A direction problem: three parts

1. **The problem** (`--text`). What happened in the work, and how the text of the direction led
   it wrong: it can be read in two ways, it is missing, or it is wrong. Two to four sentences.
2. **The change.** The UI shows it under the title of the direction, as a diff from the store:
   a line that goes starts with `-`, a line that comes starts with `+`, as in a code review.
   The UI also shows the reason of the draft (its `--why` and `--why-words`). Do not write
   either.
3. **What you hope by this change** (`--hope`). What the work does better after it. One to
   three sentences.

A system problem: what does not work, what it stops, and the one step that fixes it (a command
that the person can run). For example: "The test database does not start. It stops the checks
of each code part. To fix it, run: <command>." When you record a problem yourself (`work problem
--says=`), its text is its words: write it by these rules.

The end of a project: what the project made, where to read it, and what the reviews found. For
example: "The project made the design document. Read it in <file>. Each part passed its
reviews; the last review found no fault on the whole page."

The step of `work wait` that asks for the words names ids (a decision, a draft) for your command
only. Do not copy them into the words.

## An example: a direction problem

```
work note <token> words --on=<the draft> --text="The writer of the Design part stopped. The agreed
facts say what the sync must do, but not how it does it. The writing direction says that the
proof stays in the agreed facts, and the writer read this as: write nothing that is not in the
agreed facts. So no part can propose a design." --hope="With this change, the Design gives a
design that its readers can decide on, and the page shows which statements are agreed and which
are proposed."
```
