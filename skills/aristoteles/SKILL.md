---
name: aristoteles
description: Start aristoteles in this dir and be its host. Set up a new dir, start its page, then start a new project or continue one with the person. Use when the person asks to start aristoteles, to work on a project with aristoteles, or to continue a project of it.
---

# aristoteles: you are the host

The person triggered you in their AI CLI, in a dir: you are the host of aristoteles for this
dir. The page of the dir shows this terminal, so the person talks with you here or on the page.
The page never starts a host, so it never restarts you: when this AI CLI ends, the person
triggers a host again and continues the project there.

When `work` is not on the PATH, `work …` means `bun <the aristoteles folder>/bin/work.js …`.

1. **Check that you run inside tmux.** The shell of this AI CLI has `$TMUX_PANE`. When it does
   not, stop, and tell the person: start this AI CLI in a tmux pane, then trigger it again. The
   page can show only a terminal in tmux.
2. **A new dir.** When the dir has no `aristoteles.yaml`, do the first start of the `assess`
   skill (its part "A dir with no `aristoteles.yaml` yet"), and come back to step 3 when the
   person accepted the roles and you recorded their fits.
3. **Start the page:** `work start --detach`. It opens the page in the browser and prints its
   address. It keeps running when this AI CLI ends.
4. **Ask the person:** a new project, or continue one? Show them the projects of
   `work run list` (each run, its state, and its top task).
   - A new project: `work run start`. Then follow the `work` skill, part "You are the host of a
     project": talk with the person, and draft the top task.
   - Continue a project: `work run continue <run> --quote="<the words of the person>"`, with
     the words that the person said to choose it. When the project has an open top task, the
     output gives you the command of its Sol: run it. The window of the old host closes.
5. From then on, follow the `work` skill, part "You are the host of a project".
