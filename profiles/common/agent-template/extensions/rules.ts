/**
 * 팀 규칙 (키트 훅 rules): 다른 코딩 도구의 지침·규칙 파일과 프로젝트의 .pi/rules 를 pi 에게 (2026-10-27, oh-my-pi 를 참고해 새로 씀).
 * - PC 작업 폴더부터 위로 git 저장소 맨 위까지 찾는다 (홈 폴더는 보지 않음: ~/.claude/CLAUDE.md 같은 다른 도구의 개인 설정).
 *   내 규칙은 ~/.pi/agent/rules/*.md (globs 는 작업 폴더 기준). jupyter 모드의 노트북 폴더는 jupyter.ts 가 스킬과 함께 찾아 넣는다
 * - 늘 넣는 지침(.github/copilot-instructions.md 등)은 지침 파일 목록에. 세션마다 처음 찾은 것을 그대로 쓴다 (지침이 바뀌면 Copilot 이 새 대화를 열기 때문)
 * - 파일·명령에 걸리는 규칙(applyTo·globs·condition)은 그 도구 결과에 붙인다: 규칙마다 한 번, condition 이 있는 규칙은 파일마다 한 번
 * - /rules: 읽은 파일과 규칙. 끄기: /hooks off rules (내 설정 파일의 "team_rules": false)
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, posix, relative, resolve } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { cleanPath } from "./lib/paths.ts";
import { target, type WorkDir, workDir } from "./lib/relay.ts";
import { writtenPaths } from "./lib/shell.ts";
import {
	applyRules,
	buildRules,
	myRuleSources,
	noticeOnce,
	RULE_DIRS,
	RULE_FILES,
	type RuleSource,
	type RulesState,
	type TeamRule,
	ruleMatches,
	ruleNote,
	rulesOn,
	shortPath,
	writtenText,
} from "./lib/rules.ts";

const G = globalThis as any;
const slash = (p: string) => p.replace(/\\/g, "/");

const FILE_MAX = 200_000;
/** PC 의 작업 폴더부터 위로 규칙 파일 (git 저장소 맨 위에서 멈춤, 홈 폴더와 드라이브 맨 위는 보지 않음) */
export function localRuleSources(cwd: string, home = homedir()): RuleSource[] {
	const out: RuleSource[] = [];
	const seen = new Set<string>();
	const add = (p: string) => {
		const key = slash(p).toLowerCase();
		if (seen.has(key)) return;
		try {
			const st = statSync(p);
			if (!st.isFile() || st.size > FILE_MAX) return;
			seen.add(key);
			out.push({ path: slash(p), text: readFileSync(p, "utf8") });
		} catch {}
	};
	const walk = (dir: string, re: RegExp, depth: number) => {
		let names: string[] = [];
		try {
			names = readdirSync(dir).sort();
		} catch {
			return;
		}
		for (const n of names) {
			const p = join(dir, n);
			let st: ReturnType<typeof statSync>;
			try {
				st = statSync(p);
			} catch {
				continue;
			}
			if (st.isDirectory()) {
				if (depth > 0) walk(p, re, depth - 1);
			} else if (re.test(n)) add(p);
		}
	};
	const h = slash(resolve(home)).toLowerCase();
	let d = resolve(cwd);
	for (let i = 0; i < 40; i++) {
		const up = dirname(d);
		if (slash(d).toLowerCase() === h || up === d) break;
		for (const f of RULE_FILES) add(join(d, f));
		if ((existsSync(join(d, "AGENTS.md")) || existsSync(join(d, "AGENTS.override.md"))) && existsSync(join(d, "CLAUDE.md"))) add(join(d, "CLAUDE.md"));
		for (const [sub, re, depth] of RULE_DIRS) walk(join(d, sub), re, depth - 1); // 노트북 찾기 명령의 find -maxdepth 와 같은 깊이
		if (existsSync(join(d, ".git"))) break;
		d = up;
	}
	return out;
}

/** 도구에 준 경로 -> 절대 경로 (/ 로, lib/relay.ts 의 target 과 같게). 지금 실행 위치(PC·노트북)의 파일이 아니면 null */
export function toolAbs(p: unknown, wd: WorkDir): string | null {
	if (typeof p !== "string" || !cleanPath(p).trim()) return null;
	const t = target(p, wd);
	return t.remote === wd.remote ? t.abs : null;
}
/** 규칙 기준 폴더에 대한 상대 경로 (그 밖이면 null) */
export function relToBase(base: string, abs: string, remote: boolean): string | null {
	const r = remote ? posix.relative(base, abs) : slash(relative(base, abs));
	return r && !r.startsWith("..") && !isAbsolute(r) && !posix.isAbsolute(r) ? r : null;
}

/** 도구 결과에 붙일 팀 규칙 글 (noted: 이미 붙인 것).
 *  다루는 파일: read·write·edit 의 path, bash 는 리다이렉트·tee 로 쓰는 파일 (그 파일에는 write 로 봄: 'cat > a.py <<EOF' 로 만드는 모델이 많음) */
export function notesFor(st: RulesState | undefined, toolName: string, input: any, wd: WorkDir, noted: Set<string>): string[] {
	if (!st?.match.length) return [];
	const text = writtenText(toolName, input);
	const files: { abs: string | null; as: string }[] =
		toolName === "read" || toolName === "write" || toolName === "edit"
			? [{ abs: toolAbs(input?.path, wd), as: toolName }]
			: toolName === "bash" && typeof input?.command === "string"
				? writtenPaths(input.command).slice(0, 10).map((p) => ({ abs: toolAbs(p, wd), as: "write" }))
				: [];
	const out: string[] = [];
	const add = (r: TeamRule, rel: string | null) => {
		const once = r.condition.length ? `${r.path}|${rel ?? "(명령)"}` : r.path;
		if (noted.has(once)) return;
		noted.add(once);
		out.push(ruleNote(r, rel));
	};
	for (const r of st.match) {
		const base = r.base || slash(wd.cwd); // 내 규칙(base "")은 작업 폴더 기준
		const rels = files.map((f) => ({ rel: f.abs ? relToBase(base, f.abs, wd.remote) : null, as: f.as }));
		if (r.globs.length) {
			const hit = rels.find((f) => f.rel && ruleMatches(r, f.as, f.rel, text));
			if (hit) add(r, hit.rel);
		} else if (ruleMatches(r, toolName, toolName === "bash" ? null : (rels[0]?.rel ?? null), text)) add(r, toolName === "bash" ? null : (rels[0]?.rel ?? null));
	}
	return out;
}

export default function (pi: ExtensionAPI) {
	G.__piTeamRulesNoted ||= new Set<string>();
	pi.on("session_start", async (event: any) => {
		if (event?.reason === "reload") return;
		G.__piRulesLocal = undefined;
		G.__piTeamRulesNoted = new Set<string>();
	});

	pi.on("before_agent_start", async (event: any, ctx: any) => {
		const o = event?.systemPromptOptions;
		if (!o) return;
		const wd = workDir();
		if (!rulesOn()) {
			G.__piTeamRules = undefined;
			return;
		}
		if (wd.remote) return; // jupyter 모드: jupyter.ts 가 노트북 폴더의 규칙 파일을 넣음
		const key = slash(resolve(wd.cwd)).toLowerCase();
		let frozen = G.__piRulesLocal as { key: string; sources: RuleSource[] } | undefined;
		if (!frozen || frozen.key !== key) {
			frozen = { key, sources: [...localRuleSources(wd.cwd), ...myRuleSources()] };
			G.__piRulesLocal = frozen;
		}
		const st = applyRules(o, buildRules(frozen.sources), key);
		noticeOnce(ctx, st);
	});

	pi.on("tool_result", async (event: any) => {
		if (event?.isError || !rulesOn()) return;
		const notes = notesFor(G.__piTeamRules, event.toolName, event.input, workDir(), G.__piTeamRulesNoted);
		if (!notes.length) return;
		return { content: [...(Array.isArray(event.content) ? event.content : []), { type: "text", text: notes.join("\n\n") }] };
	});

	pi.registerCommand("rules", {
		description: "팀 규칙: 읽은 다른 코딩 도구의 지침 파일(.github/copilot-instructions.md 등)과 파일·명령에 걸리는 규칙 보기. 끄기: /hooks off rules",
		handler: async (_args, ctx) => {
			if (!rulesOn()) return ctx.ui.notify("팀 규칙이 꺼져 있습니다. 켜기: /hooks on rules", "info");
			const st = G.__piTeamRules as RulesState | undefined;
			if (!st?.all.length)
				return ctx.ui.notify(
					"이 작업 폴더에서 찾은 팀 규칙이 없습니다 (.github/copilot-instructions.md, .github/instructions/*.instructions.md, .cursor/rules/*.mdc, .claude/CLAUDE.md, .pi/rules/*.md. 요청을 한 번 보낸 뒤에 찾음)",
					"info",
				);
			const line = (r: (typeof st.all)[number]) => {
				const scope = r.kind === "always" ? "늘" : r.kind === "list" ? "목록" : `${r.globs.join(", ") || "모든 파일"}${r.condition.length ? " · 조건 있음" : ""} · ${r.tools.join("/")}`;
				return `  ${shortPath(r)}  (${scope})${st.skipped.some((s) => s.path === r.path) ? ` — 넣지 않음: ${st.skipped.find((s) => s.path === r.path)?.why}` : ""}`;
			};
			ctx.ui.notify(
				[
					`팀 규칙 ${st.all.length}개 (늘: 지침에 넣음, 목록: 필요할 때 읽으라고 알림, 그 밖: 해당 파일·명령을 다룰 때 도구 결과에 붙임)`,
					...st.all.map(line),
					"끄기: /hooks off rules · 세션마다 처음 찾은 것을 씀 (새로 둔 파일은 /new 뒤에)",
				].join("\n"),
				"info",
			);
		},
	});
}
