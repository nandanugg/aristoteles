# Writing a direction for aristoteles

A direction, each of its standards, and each rule are separate entries in aristoteles. SQL links
them: a rule belongs to a standard, and a standard to a direction. The words of each entry are
any markdown. A model reads an entry in pieces: a brief gives the first paragraph of a rule and
the address of each header inside it, and a model reads one piece with
`work direction show <direction>@<version>#<entry>#<header>`. Write each entry so that one piece
is enough for the model that reads only that piece.

## The three entries

- **Direction**: what the work is for, and what matters most. One idea.
- **Standard**: how the output looks. A standard follows from the words of its direction. A
  standard that its direction does not say needs a change of the direction first.
- **Rule**: one check that a reviewer can do on one result of a maker (its output form in
  `work.yaml`), and give evidence for. One rule is one check. The role that checks it is in the
  draft (`checkedBy`), or, for a company direction, in `aristoteles.lock`.
- `from` names the principles that ground the direction, of the eleven: Logos, Pathos, Ethos,
  Mythos, Oikos, Nomos, Telos, Kairos, Mnēmē, Topoi, Aporia.

## Write for contextual retrieval

- The first paragraph of an entry says the whole entry. A brief shows only that paragraph and
  the list of headers.
- The text under each header stands alone. Name the subject again; do not write "as above",
  "this one", or "the previous".
- One topic under one header. The name of a header says its topic: Why, Examples, Exceptions,
  How to check.
- Put each example under the header that it belongs to, near the words that it shows.
- In a rule, the check is the first sentence. The reasons and the examples go under headers.
- Use the words that the work uses: the names of files, commands, fields, and flags. A search
  (`work search <words>`) finds entries by these words.

## Write for any model

- Name no AI model and no AI vendor. Write no "you are an AI". The names of the tools of the
  work (for example Consul, Unleash, Kafka) are the words of the work: use them.
- Use concrete words: the exact output, file, field, or command. Avoid vague verbs (handle,
  manage, ensure, properly, clean).
- One reading only. When a sentence can mean two things, write two sentences.
- Say what is. Avoid "not X but Y": write Y.
- Say each thing once, in one entry.

## Where the words go

- A new direction: `work direction new [<token>] --file=<direction.yaml> [--by=<model run>]`.
  The file holds the whole direction; `says: |` holds markdown. `work direction new` with no
  file prints its form.
- A change of a direction: `work direction revise <token> <direction> --file=<edit.yaml>
  --answers=<the Rejects and suggestions that it answers>`. The file adds, replaces, or removes
  standards.
- A company direction: a folder in its repo, with one file for each entry:
  `direction.md`, `<standard id>/standard.md`, and `<standard id>/<rule id>.md`. It changes in
  its repo, with a pull request.
