---
name: aristoteles
description: Start aristoteles in this dir and be its host. Install this skill in the dir, onboard a new dir (draft its directions and roles with the person, then start the store), start its page, then run the project with the person. Use when the person asks to start aristoteles, to work on a project with aristoteles, or to continue a project of it.
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
   person approves all roles (`work onboard approve-roles` is the same act at a terminal). One
   role of the config is `pipeline: true`. Come back to step 4 when the store exists.
4. **Record the fit of each agent role** (the `role-fitness` skill), as the last line of
   `work onboard approve-roles` says. A role fits when its words pass the static checks and each
   of seven questions (`guides/fitness.yaml`) gets a yes with a real example; the answers are its
   fit record, and a role with no fit record gets no work.
5. **Start the page:** `work start --detach`. It opens the page in the browser and prints its
   address. It keeps running when this AI CLI ends. When it exits with 3, read the log file
   that it names, tell the person the cause, and do not start it again until the person
   answers.
6. **Talk with the person** about the project. Read the directions (`work direction show <id>`,
   `work search <words>`) and the dir. Help them say the top task in one sentence: its name,
   its goal (its output, where it goes, and when it is done), and its sections. Do not start any
   work yet.
7. **The person opens the top task:** on the page, or with `work top open --name="<...>"
   --goal="<...>" --sections=a,b` at a terminal. It is the person's act: you never run it.
   Tell them what to open, then wait for it.
8. **Start your host:** in this pane, run `work run continue`. It records this pane as the
   host, and prints your token (`host: w.host.<ep>.<secret>`) with your first words. When you
   are already the host of an open project, it moves the host to this pane, and gives a new
   token. Use the newest token only.
9. From then on, follow the `work` skill, part "You are the host of a project". Run
   `work wait <your token>` (in the background when your AI CLI allows it, so that the person can
   still talk to you): it prints one step with its exact command. Do it, then run `work wait`
   again. The page types nothing into this terminal.
10. **Subagents.** Only a terminal starts subagents: you, and each persistent role. A maker runs
    as a subagent of its persistent role, so the role starts it, not you. Tell each subagent
    that you start: it starts no subagent; when its work needs more agents, it hands the need
    back with `work ask`.
11. **Ask the person on the page.** After the first talk, never ask the person with your AI
    CLI's own question tool (such as AskUserQuestion): ask with
    `work ask <token> human --text="<the fact that you need>"`. The person answers on the page,
    and `work wait` returns with the answer. Ask only for a fact that no direction gives.
12. **Carry the person's words.** When the person says an act in this chat (accept, send back,
    reject, decide, answer, end), forward it with their exact words:
    `work forward <your token> <the act as the person would run it> --on <n> --quote="<words>"`.
    It waits for the person to confirm on the page.
13. **When the person does not answer,** do not poll and do not ask again. Say what waits for
    them, and run `work wait`. When the AI CLI ends, the person triggers a host again, and
    runs `work run continue` there.
14. **Show what you do** on the pages that have no terminal: `work status set
    --kind=working|thinking|applied|feedback|waiting --text="<a few words>" --by=<your name>`.
