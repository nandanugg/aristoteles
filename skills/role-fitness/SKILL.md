---
name: role-fitness
description: Check that a role in aristoteles.yaml fits the capability of its tier before it is assigned. Use when you add a role, change the words of a role, or when the results of a role keep failing review.
---

# Role fitness

A role can be assigned only when it has a fit record for its current words. The person, a
high-tier agent, or the host that drafted the roles (a model run outside any task) makes that
record. A program role (`kind: program`) has no tier and needs no fit record.

1. Run `work role fit <role>`. It prints the static checks and seven questions
   (`guides/fitness.yaml`).
2. Fix every static check that fails:
   - a low role has exactly one act;
   - no vague verb in a responsibility ("handle", "ensure", "manage", "look at", …);
   - a role with a do act names its output form (for example `<file>#<section>`);
   - the rules that name the role fit the tier's limit (`limits.<tier>.Review.rules`).
3. Write the answers in a file inside the dir (for example `.work/fit/<role>.yaml`), one line
   for each question:
   `- { id: 1, yes: true, why: "<one real example of the role's work>" }`.
   A no means the role does not fit. While the roles are a draft, split the role, move it to
   another tier, or make its words exact. After the accept, only its words can change
   (`description`, `intro`, `responsibilities`, `output`, then `work config apply` by the
   person). Then start again at step 1.
4. Run `work role fit <role> --answers=<file>`, with the flag of who you are: the person at a
   terminal adds none; an agent with a token adds `--as=<its token>`; the host with no token
   adds `--by=<its name>` (for example `--by=assess`).

How to answer well:

- Answer from a real unit of the role's work, not from the role's text.
- Question 3 (enough in the brief): run `work assign <task> --role=<role> --dry-run`. It
  prints the size of the brief against the tier limit. The person gives work only to medium
  and high roles, so for a low role an agent above it runs
  `work assign <its token> <task> --role=<role> --dry-run`.
- Question 5 (checking load): a rule that needs two places to check is two rules.
- When results of a role keep failing review, run this skill again before you change the
  directions: the role may be at the wrong tier.
