// work wait (BUILD.md 10.1): an agent or a host runs it when it has nothing to do. It blocks until
// the actor has ready work, or its next steps change, or the time passes; then it prints the next
// lines and exits 0. Nothing is typed into a terminal: this command is how they hear of work.
//   work wait <token> [--seconds=<n>]       an agent (a host after its top task opened too)
//   work wait --by=<run> [--seconds=<n>]    a host before its top task opens, in its own pane
//   work wait --by=<agent> [--seconds=<n>]  a persistent agent, in its own terminal (ruling 9)
// While it blocks, a marker next to the store says that the actor waits, so that the watcher does
// not take it for a silent terminal (adapters/live/waiting.ts).
import { Effect, Fiber } from "effect";
import type { Derived } from "../../../core/derived/index.ts";
import {
	heldBy,
	type Steps,
	stepsOf,
	type WaitEnd,
	type Waiter,
	waitFor,
} from "../../../core/effects/wait.ts";
import {
	type PersistentAgent,
	prefixOf,
	refuse,
	type Run,
	type SessionId,
} from "../../../core/schema/index.ts";
import { Dir, Env, Now, Store, Tokens } from "../../../core/services/index.ts";
import { workCacheLayer } from "../../../core/state/index.ts";
import {
	BEAT_MS,
	markReturned,
	markWaiting,
	seenOf,
	type WaitPlace,
} from "../../live/waiting.ts";
import { buildOf } from "../../live/build.ts";
import { nextLines } from "../../words/index.ts";
import { textOf } from "../args.ts";
import { agentCallerOf, isUnit, tokenOfCall } from "../caller.ts";
import type { Command, Commands } from "../command.ts";
import { lookupKind } from "../lookups.ts";
import { act, peekWork } from "../runtime.ts";

// Under the 10-minute limit of a command in Claude Code, so that the wait ends by itself.
export const WAIT_SECONDS = 540;
const POLL_MS = 500;
const DERIVE_MS = 15000;
const SETTLE_MS = 1000;
const BUILD_MS = 5000;

// Only the host's own pane waits as its run: there the wait gives the token of its assignment.
const checkPane = (run: Run) =>
	Effect.gen(function* () {
		const { vars } = yield* Env;
		const here =
			run.terminal._tag === "Pane"
				? (vars.TMUX ?? "").split(",")[0] === run.terminal.socket &&
					vars.TMUX_PANE === run.terminal.pane
				: vars.ARISTOTELES_SESSION === run.session;
		if (here) return;
		const where =
			run.terminal._tag === "Pane" ? `pane ${run.terminal.pane}` : run.session;
		return yield* refuse(
			`work wait --by=${run.id} runs only in the terminal of its host (${where})`,
			`run it in that terminal, or pass the token of your assignment: work wait <token>`,
		);
	});

// Only the terminal of a persistent agent waits as that agent: there the wait gives it each new
// assignment with its token.
const checkAgent = (x: PersistentAgent) =>
	Effect.gen(function* () {
		const { vars } = yield* Env;
		if (x.terminal._tag === "NotStarted") {
			return yield* refuse(
				`${x.id} has no terminal yet; the UI starts it when ${x.id} has an assignment`,
				"do not start it yourself",
			);
		}
		if (vars.ARISTOTELES_SESSION === x.terminal.session) return;
		return yield* refuse(
			`work wait --by=${x.id} runs only in the terminal of ${x.id} (${x.terminal.session})`,
			"run it in that terminal, or pass the token of your assignment: work wait <token>",
		);
	});

const secondsOf = (value: string | true | undefined) =>
	Effect.gen(function* () {
		if (value === undefined) return WAIT_SECONDS;
		const n = Number(value);
		if (typeof value === "string" && Number.isFinite(n) && n > 0) return n;
		return yield* refuse(
			"--seconds is a number of seconds above 0, such as --seconds=540",
		);
	});

// The lines of the steps. A persistent agent acts by each open assignment: the steps of each one
// come under its id, with the place of its token (the wait prints only the tokens it makes).
// Assignments with ready work come first, under a header (live, 2026-11-16: p1 read five
// blocks of waits, stopped, and never saw a103's steps below them).
const linesOf = (d: Derived, waiter: Waiter, steps: Steps, token: string) => {
	if (waiter._tag !== "Persistent") return nextLines(d, steps.next, token);
	const w = d.moment.work;
	const blocks = heldBy(d, waiter.agent).map((a) => {
		const task = w.assignments.get(a)?.task;
		const name = task === undefined ? "" : (w.tasks.get(task)?.name ?? "");
		const next = stepsOf(d, { _tag: "Agent", assignment: a });
		const lines = nextLines(d, next.next, `${a}.<token>`);
		const block = [
			`${a} (${task ?? ""} ${name}):`,
			...(lines.length ? lines : ["nothing is ready now."]),
		].map((line, i) => (i === 0 ? line : `  ${line}`));
		return { ready: next.ready, block };
	});
	const ready = blocks.filter((b) => b.ready).flatMap((b) => b.block);
	const rest = blocks.filter((b) => !b.ready).flatMap((b) => b.block);
	if (ready.length === 0) return rest;
	const head = "Ready now: do these steps first.";
	return rest.length
		? [head, ...ready, "Waiting (nothing to do here):", ...rest]
		: [head, ...ready];
};

// The host's top task opened: its assignment takes the run's terminal with a new token. The host writes
// it as a model run, as `run continue` does (the store lets a ModelRun take a host's terminal).
const opened = (end: Extract<WaitEnd, { _tag: "Opened" }>) =>
	Effect.gen(function* () {
		const secret = yield* (yield* Tokens).random;
		const at = yield* (yield* Now).read;
		yield* act(
			{ _tag: "ModelRun", name: "host", at },
			{
				_tag: "StartSession",
				target: { assignment: end.host },
				content: { session: end.session, secret },
			},
		);
		const w = end.d.moment.work;
		const task = w.assignments.get(end.host)?.task;
		const name = task === undefined ? "" : (w.tasks.get(task)?.name ?? "");
		const token = `${end.host}.${secret}`;
		return [
			`${end.run}: its top task ${task ?? ""} ${name} is open, and you are its host (${end.host}); ` +
				`an older token stops working. Your command: work brief ${token}`,
			...keepWaiting(token),
		];
	});

// New assignments of a persistent agent: each takes the agent's terminal with a new token. The
// agent writes it as a model run, as the host does for its own assignment (the store lets a ModelRun take
// an assignment's terminal).
const given = (end: Extract<WaitEnd, { _tag: "Given" }>) =>
	Effect.gen(function* () {
		const at = yield* (yield* Now).read;
		const w = end.d.moment.work;
		const lines: Array<string> = [];
		for (const a of end.assignments) {
			const secret = yield* (yield* Tokens).random;
			yield* act(
				{ _tag: "ModelRun", name: end.agent, at },
				{
					_tag: "StartSession",
					target: { assignment: a },
					content: { session: end.session, secret },
				},
			);
			const x = w.assignments.get(a);
			const name = x === undefined ? "" : (w.tasks.get(x.task)?.name ?? "");
			lines.push(
				`${a} is yours: ${x?.task ?? ""} ${name}, as ${x?.role ?? ""}. ` +
					`Your command: work brief ${a}.${secret}`,
			);
		}
		return [
			...lines,
			"Keep one token for each assignment that you hold.",
			...keepWaiting(`--by=${end.agent}`),
		];
	});

// The words of an end: an agent's assignment, a persistent agent, or a host's run.
const endedWords = (d: Derived, waiter: Waiter): string => {
	switch (waiter._tag) {
		case "Agent": {
			const runs = d.moment.work.assignments.get(waiter.assignment)?.runs;
			return runs?._tag === "Agent"
				? `${waiter.assignment} is finished; run work wait --by=${runs.agent} for the next ` +
						`work of ${runs.agent}.`
				: `${waiter.assignment} is finished; there is nothing more for it.`;
		}
		case "Persistent":
			return `${waiter.agent} has ended: its project is done or closed; nothing more comes to it.`;
		case "Host":
			return `${waiter.run} has ended; there is nothing more for its host.`;
	}
};

const wait: Command = (call) =>
	Effect.gen(function* () {
		const { args } = call;
		const seconds = yield* secondsOf(args.one("seconds"));
		const by = textOf(args.one("by"));
		const { work } = yield* peekWork;
		const token = tokenOfCall(call);
		let waiter: Waiter;
		let session: SessionId | null;
		let again: string;
		if (token !== null || by === undefined) {
			const caller = yield* agentCallerOf(work, token);
			// A low assignment with no terminal of its own runs as a subagent: one unit, no wait. A
			// persistent low agent waits like any agent (ruling 10).
			const runs = work.assignments.get(caller.assignment)?.runs;
			if (runs?._tag !== "Agent" && isUnit(work, caller.assignment)) {
				return [
					`${caller.assignment} runs as a subagent and has one unit: ` +
						`work brief ${caller.token} shows it.`,
				];
			}
			waiter = { _tag: "Agent", assignment: caller.assignment };
			session = work.sessions.get(caller.assignment)?.session ?? null;
			again = caller.token;
		} else if (prefixOf(by) === "p") {
			const { agent } = yield* lookupKind("Agent", ["p"], work, by);
			yield* checkAgent(agent);
			waiter = { _tag: "Persistent", agent: agent.id };
			session =
				agent.terminal._tag === "Started" ? agent.terminal.session : null;
			again = `--by=${agent.id}`;
		} else {
			const { run } = yield* lookupKind("Run", ["h"], work, by);
			yield* checkPane(run);
			waiter = { _tag: "Host", run: run.id };
			session = run.session;
			again = `--by=${run.id}`;
		}
		const actor =
			waiter._tag === "Agent"
				? waiter.assignment
				: waiter._tag === "Persistent"
					? waiter.agent
					: waiter.run;
		const { cwd } = yield* Dir;
		const { vars } = yield* Env;
		const place: WaitPlace = { env: vars, cwd, actor };
		const seen = yield* seenOf(place);

		// The last seq of the dir: one open store, read each poll.
		const store = yield* (yield* Store).open(cwd, { create: false });
		const lastSeq = Effect.map(
			store.query(
				"SELECT MAX(seq) AS seq FROM event WHERE project = ?",
				store.dir,
			),
			(rows) => Number(rows[0]?.seq ?? 0),
		);
		// The marker is renewed while the wait blocks; it is never renewed after the return.
		let beat: Fiber.Fiber<never> | undefined;
		const blocking = Effect.gen(function* () {
			yield* markWaiting(place, session, seen);
			const renew = Effect.andThen(
				Effect.sleep(BEAT_MS),
				markWaiting(place, session, seen),
			);
			beat = yield* Effect.forkDetach(Effect.forever(renew));
		});
		const end = yield* waitFor(waiter, {
			seen,
			ms: seconds * 1000,
			pollMs: POLL_MS,
			deriveMs: DERIVE_MS,
			settleMs: SETTLE_MS,
			lastSeq,
			blocking,
			build: Effect.sync(() => buildOf(vars)),
			buildMs: BUILD_MS,
		}).pipe(
			Effect.provide(workCacheLayer(cwd)),
			// A wait that blocked waits no more, also when it fails.
			Effect.ensuring(
				Effect.suspend(() =>
					beat === undefined
						? Effect.void
						: Effect.andThen(
								Fiber.interrupt(beat),
								markReturned(place, session, seen ?? ""),
							),
				),
			),
		);

		// The marker says that the actor waits no more, and keeps the key of the steps it printed.
		const done = (key: string | null, lines: ReadonlyArray<string>) =>
			Effect.as(markReturned(place, session, key ?? seen ?? ""), lines);
		switch (end._tag) {
			case "NoStore":
				return yield* Effect.die(
					`no work store in ${cwd}, and the store opened`,
				);
			case "Ended":
				return yield* done(null, [endedWords(end.d, waiter)]);
			case "Updated":
				return yield* done(null, [
					`aristoteles was updated; run work wait ${again} again.`,
				]);
			case "Opened":
				return yield* done(null, yield* opened(end));
			case "Given":
				return yield* done(null, yield* given(end));
			case "Ready":
			case "Changed": {
				const lines = linesOf(end.d, waiter, end.steps, again);
				const head = end._tag === "Changed" ? ["your next steps changed."] : [];
				const none = lines.length === 0 ? ["nothing is ready now."] : [];
				return yield* done(end.steps.key, [
					...head,
					...lines,
					...none,
					...keepWaiting(again),
				]);
			}
			case "Quiet":
				return yield* done(end.steps.key, [
					`nothing changed; run work wait ${again} again.`,
					...linesOf(end.d, waiter, end.steps, again),
				]);
		}
	});

// Every return reminds the agent to wait again: a terminal that ends its turn with no running
// wait gets nothing more (Nanda, 2026-11-15: agents stopped after a report).
function keepWaiting(again: string): ReadonlyArray<string> {
	return [
		`Do the steps above, then run work wait ${again} again at once. Never end your turn ` +
			"without a running work wait: it is the only way new work reaches you.",
	];
}

export const commands: Commands = { wait };
