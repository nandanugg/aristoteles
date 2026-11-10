# Thought test, round 2: findings and what was done

Copied from the session's working notes. Ids (for example R4-5) are the ones that DESIGN.md section 0 uses.


From the live Haiku writer (a2 in round2/live):
L1. Wrong folder -> "no store here". Fix: bin/work.js walks up from cwd to the nearest work.yaml;
    assign prints the whole subagent prompt with the project folder:
    "Use the work skill. In <abs dir>, run: work brief <token>"; brief header prints "project: <dir>";
    the no-store refusal says "run work in the project folder that your parent named".
L2. Fixture verify "grep -c ABC" exits 1 on correct text. Fix fixture to a verify that exits 0 when
    right; DESIGN + low guide: "verify exits 0 when the work is ready; if it fails and you cannot fix
    it, raise with its output".
L3. An answer to the maker's question is not in its next brief (q1 answered by a1, a2 brief shows
    nothing). Fix: brief ANSWERS block: questions asked by this assignment or stopping its task that
    have an answer, latest 3: "q1 you asked: <short> / a1 answered: <text>".
L4. Work left by an earlier attempt that raised (text written, not reported) is invisible to the next
    subagent. Covered by L3 (the answer says what to do) - check after L3.

From the identity agent (repro env: round2/identity/env.sh; all ran):
A1 tokens crack in 9 s (5 chars, unsalted sha256) and show in ps argv -> 128-bit secret (26 base32);
   accept the token from WORK_TOKEN env too (argv stays for the prototype; state the ps limit).
A2 gate runs sh -c with the output name -> forged accept + code run. Run programs with argv (no shell),
   placeholders as single args; refuse outputs outside [A-Za-z0-9._/#@-].
A3 high approves its own suggestion via its own child's accept; low/briefless agents review versions.
   direction review: high/medium only, with a claim; refuse the suggester and any assignment in the
   suggester's subtree (descendants); removing/replacing a standard that holds a Human rule needs the person.
A4 a lead settles its own raise; relays an answer to its own question to the person. A raise/question
   whose answerBy is a person: only that person settles/answers (terminal or ratified relay); a decider
   never settles its own raise. Relayed answer -> waits for ratify? (answer to a person-addressed question
   by relay = the person's words; make relayed answer wait for ratify when the question came from the relayer).
A5 any no-parent assignment relays (a low linter assigned by the person), no brief, any task.
   relay: medium/high, no parent, claim, target inside own task tree.
A6/A7/A8 migration-only (parent uses child tokens; script(1) fakes a tty + GIT_CONFIG_*; direct sqlite
   INSERT acts as the person and one bad row bricks replay). Prototype mitigations: record tty name +
   parent pid in person events; refuse GIT_CONFIG_* user.name override; hash chain checked on each write;
   unknown event type -> skip with a warning line on reads instead of failing everything? (no: report it
   as "store damaged at eN; the person restores"). State limits in DESIGN.
B1 evidence "x | x" counts. where must name the result output (file or file#region); what must quote
   text present in the reported section (case-insensitive substring of >= 8 chars) OR start with "no "?
   Simpler: what must be >= 12 chars and where must contain the output file. Person point closes only by a
   later result whose digest differs from the rejected result.
B2 report of unchanged/other-file/other-region/other-project work. output file must be a workspace path
   (inside the project), region must equal context.region when set; refuse a digest equal to the digest at
   brief time (store brief-time digest of the role's output) or equal to the previous result's digest.
B3 duplicate heading slug; edits after accept; relay/ratify skip the digest check. Refuse duplicate slugs;
   check digest at relay and ratify; blockers/task show/next recompute digest -> "changed since rN".
B4 ratify blind: show inner act (target, evidence/points, version) in waiting, log, and the ratify prompt.
B5 tier maxAttempts unused; resultLines vs resultSize. Default maxAttempts from tier, refuse larger;
   rename to resultLines in engine limits key; init refuses unknown limit keys.
B6 medium waives Human rule till 2099, "accepted". Human-rule waiver only by the person; max until
   (limits.maxWaiverHours default 72); show waivers in blockers + waiting; blockers wording "passes with a
   waiver until X; task stays open".
B7 split parts escape standards via context, workspace /etc. Validate split parts like task open; refuse
   dropping a standard that applies to the parent; workspace inside the project.
C1 nothing says the person must review: waiting lists results needing Human-rule evidence; RULES in
   medium/high briefs.
C2 low checker rejects the TASK -> Returned, invisible. Low checker reviews only the result in its brief;
   task Rejects shown in OPEN, waiting, blockers, with the answering command.
C3 changed direction file -> circular next lines. Add work config restore <file> (write stored text back;
   person) and point next lines to it; role show reads the store.
C4 medium claims end at review/raise (handlers clear for all tiers) and second brief refused with a
   wrong next. Keep medium/high claims until finish; medium/high may re-run brief (prints again, new
   snapshot); top agent next -> person "work release a1".
C5 finished/other-tree agents raise/ask. raise/ask/note need an unfinished assignment; raise --result only
   in own tree; low ask only to parent.
C6 grants: until past/unparseable accepted; empty --on; unknown act -> review; person cannot give approve
   on roles (mayGive needs the person's own role). Validate act/on/until (future, parses); a person in
   people may give approve/review on roles; refusal for a missing Change names the grant command.
C7 --checks with a rule not checkedBy the role: refuse at assign.
C8 reads judge until at the last event's time: set engine clock to io.now() after replay for reads/briefs.
C9 refusals without next in agent shell: fallback next line.
D1 wording: "no a result" articles; /etc path joined to cwd; names not ids in tree error; "opus may not
   close" -> "a2 (architect)"; log relay target/channel; blockers header shows the queried r but prints the
   latest result's items; next after raise to Nanda; person revise next line.
Held: parallel briefs 1 claim; parallel reports 1 result; tier/tree refusals; child relay refused;
self-approve alone refused; brief after finish refused.

From the flows agent (stores in round2/flows/walk: tsd, code, lim; token lists there):
F-A1 person cannot release/finish a bare id (isToken matches "a6"); claim refusal for a top agent
     names a missing parent -> isToken needs the dot; top agent next: "the person runs work release a6".
F-A2 gate runs on the working tree, not the reported commit -> git worktree add --detach <tmp> <sha>.
F-A3 = L3 answers invisible; log has no answer text.
F-A4 = C1 person-checked rule invisible in waiting/next.
F-A5 join can change an accepted part (digest not rechecked); join brief has no parts list/output form.
     -> joining report recomputes each part's accepted digest, refuses on change; join brief lists parts,
     output = whole workspace file, rule "change only the joins".
F-A6 resume misses commit results with no --made-from -> auto made-from = merge-base(sha, workspace.base).
F-B1 next prints a check of a rejected result; never "give a new subagent the command of a4".
F-B2 = B5 limits. F-B3 = B2 region mismatch.
F-B4 direction show <id>@<n> for a suggested version, with changes from base.
F-B5 no recheck command -> work recheck <you> <r> --reason: a redo Reject answered by any later result.
F-B6 change points invisible with no high role; settle does not close a change point; approve row lacks
     --answers -> waiting lists change blockers under the direction owner with revise + approve --answers.
F-B7 replace makes new rule objects for unchanged rules -> evidence lost, points unclosable; reuse rule
     objects when id/says/checkedBy unchanged.
F-C1 high brief shows split/approve without a Change act; refusal names nothing -> show only with a Change
     act on the target; refusal: "a1 (architect) has no change act on t1" + raise for a grant.
F-C2 guides miss direction review, source, release, relay for medium top agents, finish when accepted.
F-C3 = C4 claims. F-C4 = top-agent release. F-C5 high next ignores the medium that runs a part.
F-C6 relay output without ids; waiting row without target/evidence; maker sees agent point text, not quote.
F-C7 join brief (see F-A5). F-C8 placeholders <repo>, <task id> unfilled.
F-C9 settle of a "work changed" raise refused by the digest check; settle shown as accept in log.
F-C10 log lacks target/settles/on/to/output/text. D1: "In review" for a rejected latest result; usage
     misses commands; role fit records programs. D2: model names in refusals; round-end question
     has no choices.
