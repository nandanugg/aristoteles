#!/bin/sh
# view.sh NAME DROPS: print a TLA+ VIEW for run.sh (safety only; TLC ignores a VIEW in
# liveness checking). DROPS, comma-separated:
#   ev     lastEvent (sound: no action and no invariant reads it; only the witnesses and
#          AgentChangesStop do)
#   dead   a process that is down and not its actor's latest, kept only as actor, up,
#          unseen (sound without ENV.crash: every process action needs it up, a resume
#          copies only the latest process, only selfResumes wakes a down process)
#   timers silence and quiet dropped (sound for invariants that do not read the card: only
#          tick, procPolls and procPrints read them, and these change only the timers)
#   page   the page dropped (sound with ENV.maxPerson 0 and ENV.page off: only the
#          person's acts and the dashboard properties read page.view)
# Probes, to measure what multiplies the states (NOT sound: they merge states that differ):
#   pview  each process's view kept as its version map only
#   ptodo  each process's todo and last dropped
#   g      the store's history flags dropped
#   net    the acts in flight dropped
# told and obligations are functions of the store (commitS), so they add no states.
n=$1; d=",$2,"; p=${n}_workenv_
has() { case "$d" in *",$1,"*) return 0 ;; esac; return 1; }
pr="${p}procs[q]"
rec="$pr"
has pview && rec="[$rec EXCEPT !.view = $pr.view.ver]"
has ptodo && rec="[$rec EXCEPT !.todo = {}, !.last = {}]"
if has dead; then
  rec="IF ~$pr.up /\\ \\E r \\in DOMAIN ${p}procs : r > q /\\ ${p}procs[r].actor = $pr.actor
    THEN [actor |-> $pr.actor, up |-> FALSE, unseen |-> $pr.unseen] ELSE $rec"
fi
echo "VProcs == [q \\in DOMAIN ${p}procs |-> $rec]"
S="${p}s"; has g && S="[${p}s EXCEPT !.g = 0]"
v="$S"
has net || v="$v, ${p}net"
v="$v, VProcs, ${p}tm"
has page || v="$v, ${p}page"
v="$v, ${p}faults, ${p}merged"
has timers || v="$v, ${p}silence, ${p}quiet"
v="$v, ${p}lies"
has ev || v="$v, ${p}lastEvent"
echo "View == <<$v>>"
