---
name: aristoteles
description: Open and host an Aristoteles Project, coordinate draft reviews and staffing, and hand accepted work to the assigned staff.
---

# Host an Aristoteles Project

Run `work` from the project directory. If it is absent from PATH, run `bun <aristoteles>/bin/work.js`.
Keep the CLI, page, and local sessions on the same fresh journal. Set `ARISTOTELES_DB` before opening the project when you need an isolated run.

1. Use the assessment to draft the host, pipeline, work roles, and initial host staff. The owner opens the journal with `work onboard open --file=project.yaml` from their terminal. The owner’s name must equal the project’s Git user name.
2. Run `work start --detach` and share the printed local page address with the owner. Have the owner launch the initial staff with `work session launch <staff-key>`. The staff acknowledges in the launched pane before using its credential.
3. Draft and submit the directions, staffing, and responsibility changes through the journal. Use `work onboard status` to find the read basis and `work onboard show <proposal-key>` to inspect a draft. A staffing consultation is a Question about the staffing proposal at its current basis. Use `work question owner` and address the proposal as the question’s `owner` in YAML. Wait for the owner’s answer before submitting the draft.
4. A submitted proposal goes to a fresh child of the host’s staff. The child runs `work wait` with its credential, reads the exact draft, and submits review facts. The owner accepts or sends back the reviewed version on the page. A changed version goes through review again.
5. The owner reviews the instruction-file inventory and approves activation from the page. In the bootstrapped host pane, run the acknowledgement and collection commands printed in the launch instructions. Keep the credential private. The owner opens work with **Start work** once the host session is Live.
6. Use `work wait "$ARISTOTELES_TOKEN"` or `work wait <host-credential>` to read your role’s next step. For the first task, send a leaf over a contiguous stage slice naming one role. The assigned staff work from the pinned brief. The task runs command rules and a fresh child supplies the applicable prompt outcomes and findings.

The owner can run `work activation resume`, `relaunch`, or `rollback` from their terminal when activation needs recovery. Work stops at Raised until the owner and host decide how to proceed outside the task line. Read the checked reason and evidence in the brief or page.

See the assessment skill for journal authoring and the work skill for task and review reports.
