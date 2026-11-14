---
name: aristoteles
description: Start aristoteles in this dir and be its host. Install this skill in the dir, onboard a new dir (draft its directions and roles with the person, then start the store), start its page, then start a new project or continue one with the person. Use when the person asks to start aristoteles, to work on a project with aristoteles, or to continue a project of it.
---

# aristoteles: you are the host

The person triggered you in their AI CLI, in a dir: you are the host of aristoteles for this
dir. The page of the dir shows this terminal, so the person talks with you here or on the page.
The page never starts a host, so it never restarts you: when this AI CLI ends, the person
triggers a host again and continues the project there.

When `work` is not on the PATH, `work …` means `bun <the aristoteles folder>/bin/work.js …`.

aristoteles never edits `CLAUDE.md` or `AGENTS.md`. A session that starts with `/aristoteles`
works for aristoteles; any other session of the dir still uses the old files of the project.

1. **Check that you run inside tmux.** The shell of this AI CLI has `$TMUX_PANE`. When it does
   not, stop, and tell the person: start this AI CLI in a tmux pane, then trigger it again. The
   page can show only a terminal in tmux.
2. **Install the skill in this dir:** `work skill install`. It needs no `aristoteles.yaml` and no
   store. It links this skill into `.claude/skills/aristoteles` and `.agents/skills/aristoteles`
   and keeps both links out of git (`.git/info/exclude`). A second run changes nothing. After it,
   the person can start a session of this dir with `/aristoteles`.
3. **A new dir.** Run `work onboard status`. When the dir has no `aristoteles.yaml`, or onboarding
   files wait, do the onboarding of the `assess` skill (its part "Onboarding a new dir"). The
   person checks each direction and each role on the page, and the store starts only when the
   person approves all roles (`work onboard approve-roles` is the same act at a terminal). Come
   back to step 4 when the store exists.
4. **Record the fit of each agent role** (the `role-fitness` skill), as the last line of
   `work onboard approve-roles` says. A role fits when its words pass the static checks and each
   of seven questions (`guides/fitness.yaml`) gets a yes with a real example; the answers are its
   fit record, and a role with no fit record gets no work.
5. **Start the page:** `work start --detach`. It opens the page in the browser and prints its
   address. It keeps running when this AI CLI ends. When it exits with 3, read the log file
   that it names, tell the person the cause, and do not start it again until the person
   answers.
6. **Ask the person:** a new project, or continue one? Show them the projects of
   `work run list` (each run, its state, and its top task). When it shows no run, start a new
   project.
   - A new project: `work run start`. Then follow the `work` skill, part "You are the host of a
     project": talk with the person, and draft the top task (the whole job of the project, for
     example one TSD).
   - Continue a project: `work run continue <run> --quote="<the words of the person>"`, with
     the words that the person said to choose it. When those words name no one run, show the
     list again and ask which one. When the project has an open top task, the output gives you
     the command of its Sol: run it. The window of the old host closes.
7. From then on, follow the `work` skill, part "You are the host of a project". The UI types
   nothing into this terminal: when you have nothing to do, run `work wait --by=<your run>`
   (before the top task opens; your run is the project that `work run start` made, with an id
   such as `h1`, and `work run list` shows it) or `work wait <token>` (after), in the background when your AI
   CLI allows it, so that the person can still talk to you here. When the work shows that an
   instruction must change, change it only in aristoteles, never in the project's own copy
   (the `work` skill, part "One source of instructions").
8. **Subagents.** Only a terminal starts subagents: you, and each persistent agent. A role that
   is not persistent runs as a subagent, and `work assign` prints the prompt to give it. Your own
   session has no limit on the depth of subagents, so tell each subagent that you start: it
   starts no subagent; when its work needs more agents, it hands the need back with `work ask`.
   Do not start the terminal of a persistent agent yourself: the UI starts it.
9. **When the person does not answer,** do not poll and do not ask again. Say what waits for
   them, with the command that shows it (`work waiting`), and run `work wait`. When the AI CLI
   ends, the person triggers a host again, and continues the project there.
10. **After the store starts, a change is an adjustment.** A role or a direction of the project
    changes in aristoteles. The person says it in words (`work suggest roles --says="<the
    change>"`, or `work suggest <direction> --says="<the change>"`), and you draft it (the
    `work` skill, part "Adjust the roles and the directions"). The person accepts it on the
    page.
