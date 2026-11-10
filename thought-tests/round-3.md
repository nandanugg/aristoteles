# Thought test, round 3: findings and what was done

Copied from the session's working notes. Ids (for example R4-5) are the ones that DESIGN.md section 0 uses.


From the live run (Sonnet lead a1, Haiku writer a2 in round3/live):
R3-L1 (D) low STOP line says "one report, one review, or one raise" to a writer, which has no review.
      -> stop line per act: do roles "STOP after one report or one raise"; review roles "after one review or one raise".
R3-L2 (D, fixture) the lead noticed verify only greps ABC while no-ticket-ids covers all ticket ids; verify passes on TODO.
      -> fixture wording only; a verify is the project's choice. No CLI change.
R3-L3 (C) the medium lead did not know what to do while r1 waits only for the person (next printed
      "ask Nanda ... or relay"). -> medium/high stop line: "STOP when the task is accepted, when you raise,
      or when only the person can act (work waiting --for=<owner> lists it); tell your parent what waits."
R3-L4 (C) after a low checker's accept the CLI prints "r1 still has 1 blocker(s): work blockers r1"; the
      Haiku linter read it as "not cleared" and was unsure. -> for a low reviewer print only
      "your checks are recorded on r1" + STOP; the blocker count is for medium/high and the person.
R3-L5 (D) after "work finish <you>", work next still prints "t1 is accepted: finish yourself".
      -> next for a finished assignment: "a1 is finished; there is nothing more for it".
Observation (not a fault): the lead never read the Introduction; acceptance came from the linter's
      evidence and Nanda's check, as the model says (rules + checkers decide). Mention to Nanda.
Live verdict: Sonnet lead + Haiku writer + Haiku linter + person completed t1 from one prompt each,
      with no guessed token, id, or flag (lead's words: "I never had to guess a token, a task id or a flag").

From the flows agent (stores in round3/flows/; F-* verification: all hold except C6, C7, C8 part, C10 part):
F-C6 relayed point shows the agent's paraphrase as the person's -> store the quote on relayed reviews; OPEN shows it.
F-C7/C8 join ROLE says <file>#<region> -> fillText: on a split task replace <file>#<region> with the workspace file.
F-C10 log: source revision, checkpoint next, accept evidence rule ids.
N1 (A) relayed answer to a question addressed to an assignment can never be ratified; pending stays forever.
   -> relay dry-runs the inner act as the person and refuses with the reason (next: work ask <you> --to=owner);
   waiting hides a pending act whose target is already settled; add ask to medium/high guides.
N2 (A) after a direction change, next prints a redo; the unchanged re-report is refused; the real step (a
   checker reviews again under the new version) is not printed; a rule with no when reopens unrelated parts.
   -> old-version with a current digest = "check rN again under d@n" with the checker commands, not a redo;
   direction approve lists the results that become old (so the approver can add a when first).
N3 (A) long answers push low briefs over the limit; no recovery. -> ANSWERS cut to 200 chars with
   "work question show qN" for the full text; a low checker sees no ANSWERS; a low maker only its own
   questions; work answer warns when the asker's brief goes over its limit.
N4 (B) resume compares source names, not revisions (rechecks a result already on the new base; full vs
   short sha differ; no checkpoint = no signal). -> resolve revisions with git; next/blockers note
   "rN was built on app@X; app is at Y" with the recheck command, no checkpoint needed.
N5 (B) after a recheck the same old-base commit is accepted again. -> with an open recheck on a commit output
   with a base and a recorded source revision, refuse a report whose merge base is not that revision.
N6 (B) high next misses person checks and change points inside parts run by a medium. -> show them with
   relay/revise commands; skip settle-only.
N7 (B) no rule can apply only to the join (person's whole-page review). -> reserved context key join:
   split sets join: true on the task and join: false on parts; a standard may say when: { join: true }.
N8 (B) a page review that must change an accepted part: no printed path. -> join refusal tells a low joiner to
   raise naming the part; medium/high recheck rule names "reopen an accepted part"; recheck output mentions
   gates only when one exists.
N9 (B, Nanda) the decider never decides (acceptance = evidence per rule). -> open choice 4 in DESIGN; fix the
   medium wording ("you see that each rule has evidence; you accept where no checker is named").
N10 (C) next repeats a raise already raised -> skip person/change steps when an open raise by you on that result exists.
N11 (C) maker brief lacks the gate command -> WORK IN lists programs that review the role.
N12 (C) gate reject keeps one line; timeout = exit null; fixed 120 s -> full output in .work/runs/<r>-<program>.log,
   point = last 3 lines + log path; "timed out after N s"; program key timeout (seconds).
N13 (C) relay guide hides --point/--breaks -> show them for reject.
N14 (C) a recheck on the last attempt makes a round-end question -> no round question for a redo Reject, nor
   when another open Do assignment exists.
N15 (C) waiting keeps stale rows (raise on an old result / accepted task; person-check row after the
   person's own reject of that rule) -> skip them.
N16 (C) a low checker sees answers/points it cannot act on -> low checker OPEN = its checks + changed line; no ANSWERS.
N17 (C) high READY says "make t2" on an unsplit task; revise next line names a reviewer who cannot exist
   -> split first for a high with a change act; revise next names the owner's approve too.
N18 (D) "a Opus" -> "an Opus"; "need" -> "needs"; round question named "the end-of-round question"; status
   shows the date when not today; direction show marks only changed rules with +.

From the identity agent (repro: round3/identity/pre.sh + mkgate.sh; round-2 table: all hold except listed gaps):
I-N1 (A) a person-role token acts as the person from a shell (answer counts; brief crashes, no guides/person.yaml)
     -> remove person roles (tier: person refused at init); the person acts only with no token at a terminal.
I-N2 (B) checkpoint into another tree; resume shows no author -> inTree for checkpoint/resume; resume names who saved it.
I-N3 (B) a when-change moves a person-checked rule off an open task with no person -> engine approve compares
     person-checked rules applicable to each open task following the direction, old vs new version.
I-N4 (B) revise adds a second rule with an existing id -> refuse rule ids used by any other rule in current versions.
I-N5 (B) the suggester's child approves (no tier check on approve; outside-tree rule only for reviews)
     -> agent approve needs high; an approver below the suggester counts as the suggester (needs an outside accept).
I-N6 (B) ratify of a relayed approve shows only "approve tsd-writing@2" -> show renderDirection and removed person rules.
I-N7 (B) gate on a nested repo or on the enclosing repo -> repo part must equal the workspace path and be its
     git top level; check worktree add; run in the worktree.
I-N8 (B) untouched work passes as a first report (TODO region; main's head) -> store the output digest at the first
     brief of the task and refuse a report equal to it; refuse a commit already in base (merge base = commit).
I-N9 (B) settle counts as an accept (task Accepted on changed work); settles any review id -> settle only a Raise;
     settle reviews never count as accepts in the engine.
I-N10 (B) a one-part split answers the person's Reject; part gets no maxRounds -> refuse --review on a person's
     Reject; log "answering"; parts take the rounds left on their task.
I-N11 (B) closing a part lets the join write that region outside every rule; a part with no region reports any
     region -> a task's rules include the rules of its closed parts; a part may not report a region that a
     sibling part's context claims.
I-N12 (B) "- - -" passes as what -> at least three words with letters; what is not the same as where.
I-N13 (C) a low checker reviews a newer result than its brief showed -> the claim records the result in the brief;
     refuse others with "raise and STOP".
I-N14 (C) a low agent after its unit is told "work brief" (takes attempt 2 itself); config change tells a low
     agent "the person runs config restore" -> low needClaim next: STOP unless the parent just gave the token;
     low checkHashes next: raise and STOP; "is working" line adds the release command.
I-N15 (C) a gate that cannot run: report half-done, next loops on assign spec-gate, worktree left -> catch spawn
     errors, record a reject "the gate could not run", cleanup in finally; next suggests recheck.
I-N16 (C) relay faults: settle exception missing; stale answer pending forever; relay ask ignores its id; comments
     invisible; any channel -> dry-run inner act at relay; settle exception in relay/ratify; ask goes to <id>
     (an assignment in the tree); comments shown in briefs; channel chat|github only.
I-N17 (C) a reject point with no rule on the latest result makes next say redo -> it is a change item at once:
     waiting under the owner, next raises/revises, no redo.
I-N18 (C) after a parent finishes, children go on and only the finished parent can answer -> finish refuses while
     children are open; answer/release/role fit --as need an open assignment; a raise/question goes to the
     nearest open ancestor, else the owner.
I-N19 (C) after an official revise the direction file stays old; editing it blocks everything; restore writes v1
     -> on approve, write the official version to its file and store its hash and text.
I-N20 (D) wording: person-only approve refusal next; "tell/ask your parent" with no parent; ended waiver still
     printed; "a Opus"; "need"; no-store refusal wording (L1); high "nothing is ready" while a child works;
     next asks the person before the linter checked; + on unchanged rules.
Held: recheck does not reset attempts or skip rules; agent waiver limits; no self-settle; join digest for
accepted parts; low cannot relay; assign tier/tree checks.
