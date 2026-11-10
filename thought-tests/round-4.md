# Thought test, round 4: findings and what was done

Copied from the session's working notes. Ids (for example R4-5) are the ones that DESIGN.md section 0 uses.


From the invariant attacker (scripts sN.sh + logs in round4/invariants/; table: inv 1 holds; 2-7 broken):
R4-1 (A) split --review closes any review (other tree, points with a rule); blockers says "a direction change
     answered it" -> --review only for a Reject of the split task or its results, never a point with breaks;
     log "answering"; render "a split answered it".
R4-2 (B) agent approve removes a person rule that a join got from a closed part -> approve compares person
     rules of rulesOf(t) (closed parts included), old vs new.
R4-3 (B) closing a part drops the person's open Reject point; the join passes -> refuse task close of a part
     with an open Reject by a person (or carry it to the join).
R4-4 (B) approve --answers closes points outside the tree and points with a rule -> rejectAnswered refuses a
     point with breaks; an agent's --answers ids must be in its tree.
R4-5 (B) old-base check trusts agent-typed revisions (source by a low agent; --made-from=app@B1 on a B0 commit;
     --made-from of another tree) -> resolve revisions with git; no source from low agents; post-recheck check
     against the live workspace base; ignore a maker's --made-from for the base source; tree-check result ids.
R4-6 (B) two directions get the same rule id via two revises -> check ids against other directions at approve.
R4-7 (B) a split part drops its workspace base; main's head passes -> a part keeps its task's workspace entries.
R4-8 (B) two workspace files: no untouched digest; TODO passes -> record untouched per workspace file.
R4-9 (B) revise accepts checkedBy naming no role -> becomes a decider rule -> refuse like init.
R4-10 (B) a part reports a region its uncle owns -> refuse a region owned by any other open task in the tree.
R4-11 (B, low) a report equal to an earlier rejected result passes -> compare with every earlier rejected result.
R4-12 (C) join dead ends: code join form app vs app@<commit>; closed/rejected part blocks the join edit.
R4-13 (C) a new file in directions/ blocks everything; restore does not clear it.
R4-14 (C) a low checker briefed before any report reviews a result its brief never showed.
R4-15 (D) stale waiting rows (official version's pending approve; person-check after person reject); next lines
     for agent tokens on person commands and --as; role fit before apply records the stored hash; resume
     prints --reason=" changed"; revise next line vs a second high approving with no review.

From the flows walker (stores in round4/flows/; REPORT.txt there; round-3 F/N/L: hold except N8, N10 part,
N15 next, N17 after parts, N2 program checker + relay ratify list):
FW-1 (A) every relay refused after a version becomes official: the config handler keeps the event's own object
     and direction.approve writes into it; the relay dry run replays mutated events -> structuredClone.
FW-2 (A) after all parts are accepted, next says "split t1 first"; a second split blocks the work -> split
     first only with no parts; print the join step; refuse a split of a task that has parts.
FW-3 (B) relayed approve without --answers leaves change points open -> [--answers] in the relay line;
     ratify warns about open no-rule points not listed.
FW-4 (B) the join is refused as untouched (digest taken after the parts wrote) -> skip untouched for a task with parts.
FW-5 (B) rule point + no-rule point: next prints only the redo -> print the change step too.
FW-6 (B) after a direction change next assigns a program as a checker; the refusal loops -> skip programs.
FW-7 (B) main moves, nothing notices until someone runs source; blockers say stopped while accepted -> open.
FW-8 (B) the person's answer to the top agent does not reach the low maker -> open (workaround: comment).
FW-9 (B) direction revise has no edit-file template -> print one with no --file.
FW-10..15 (C/D) recheck redo line should name the old output to rebase; next keeps closed steps; cold resume
     cannot see the checkpoint; low maker OPEN shows items it cannot act on; ratify of approve lists no old
     results; wording.
