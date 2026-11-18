---
name: role-fitness
description: Check that a role in aristoteles.yaml fits the capability of its model and its acts before it gets work. Use when you add a role, change the words of a role, or when the results of a role keep failing review.
---

# Role fitness

A role gets work only when it has a fit record for its current words. The person, or the host
that drafted the roles (a model run outside any task), makes that record. A program role
(`kind: program`) runs no model and needs no fit record.

1. Run `work role fit <role>`. It prints the static checks and seven questions
   (`guides/fitness.yaml`). `work role list` shows each role with `(no fit record)` where one
   is missing.
2. Fix every static check that fails:
   - no vague verb in a responsibility ("handle", "ensure", "manage", "look at", ...);
   - a role with a do act names its output form (for example `<file>#<section>`);
   - the rules that name the role fit the limit of its model
     (`models.<model>.limits.Review.rules`; `work guide limits`).
3. Write the answers in a file inside the dir (for example `.work/fit/<role>.yaml`), one line
   for each question:
   `- { id: 1, yes: true, why: "<one real example of the role's work>" }`.
   A no means the role does not fit. Before the store starts, write the role again with
   `work onboard role <role> --file=<role.yaml>`: split it, give it a stronger model, or make its
   words exact. After the store starts, a role whose words do not fit is a `fit` cause of a
   raised task: the pipeline role evaluates it (`work evaluate <token> <task> fit
   --role-draft=<file>`) and the person accepts the new words. Then start again at step 1.
4. Run `work role fit <role> --answers=<file>`. The person runs it with no flag. The host runs
   it with `--by=<its name>` (for example `--by=assess`).

How to answer well:

- Answer from a real unit of the role's work, not from the role's text.
- Question 3 (enough in the brief): read the brief of one real task of the role (`work brief
  <token>` of its maker) and check that nothing else is needed to do it.
- Question 4 (judgment): choose the model by the care that the work needs. A role that reviews,
  splits, or directs needs a stronger model than a maker that does one unit from its brief.
- Question 5 (checking load): a rule that needs two places to check is two rules, or has a
  `test` command that finds them.
- When results of a role keep failing review, the evaluation of the pipeline role may name `fit`
  as the cause: the role may need a stronger model, or a narrower job.
