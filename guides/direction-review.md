# Reviewing a draft of a direction

An agent that writes a draft asks these questions of its own draft, and fixes it, before it
sends it. The pipeline role reviews the draft of a fix in its review loop: it hands the draft to
the person (`work loop <token> <fix> person --on <n>`), or revises it once more (`revise`). A
draft that you wrote is never reviewed by you alone.

Read the draft (`work direction show <draft>`, or the file of the fix) and what it answers.
Ask each question below of each entry. Hand the draft to the person only when each answer is
good. Else revise it, with one note for each problem in this form:
`<entry id>[#<header>]: <the problem>; <what would fix it>`.

## The questions

1. **Correct.** Does this text lead a model to the correct work for the aim and the concerns
   that the cause gives, and does it hold each concern?
2. **Vague.** Is a word or a sentence vague (handle, properly, good, clean, as needed)?
3. **More than one reading.** Can a sentence mean two things to two models?
4. **Twice.** Does an entry say one thing twice, or do two entries say one thing?
5. **Context density.** Does the first paragraph of each entry say the whole entry? Does the
   text under each header stand alone? Is there filler that a model reads and does not use?
6. **Negative parallelism.** Does a sentence say "not X but Y", where "Y" alone is enough?
7. **Concise.** Can a sentence go, with nothing lost?
8. **Checkable.** Can a reviewer check each rule on one result? Has each rule a `test` that
   prints on each breaking example and not on a following one, or a `ref` that exists?
9. **Fit.** Does each standard follow from the words of its direction? Does each rule check its
   standard? Does a rule contradict another rule of the direction (its test prints on the
   other rule's following example)?
10. **Summary.** Does the summary say in one or two plain sentences what the direction asks and
    why it matters, for a person who reads it the first time?
11. **Examples.** Does each marked step have an output that follows and one that breaks? Is each
    an output (a document, code, a verdict), not an instruction, with the input of a step that
    checks or decides? Is each real where the project has one?
12. **Flow.** Does the flow show how the direction works, from its first act down to the output?
    Does each step name who acts, on whom or on what file, and where the project defines it? Does
    `uses` mark each step that the direction governs, with the ids that apply there?
