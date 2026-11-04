/**
 * 작업 방식 (/plan, /mode): 계획부터 세우고 승인받아 진행 / 바꿀 때마다 확인 / 자동
 *
 *  /plan            계획 모드 켜기·끄기. 켜면 파일을 바꾸거나 명령을 실행하지 않고 계획부터 세운다
 *  /plan <요청>     계획 모드로 바꾸고 바로 요청 (다른 작업 중이면 그 작업이 끝난 뒤)
 *  /mode            모드 고르기 (계획 / 확인 / 자동). /mode ask 처럼 바로 바꿀 수도 있음
 *  /review [볼 점]  고급 모델로 리뷰 (2026-10-28): 바뀐 내용(git status·diff·새 파일)을 모아 리뷰 모델(내 설정 "review_model",
 *                   Copilot 이면 기본 GPT-6, "same" 이면 지금 모델)로 같은 대화에서 한 번 검토하고 원래 모델로 돌아와 고칠지 묻는다.
 *                   리뷰하는 동안은 읽기만 (도구 4번까지). 계획 모드와 같은 방식: 고급 모델은 사용량이 적어 리뷰에만
 *
 *  - 계획: read 와 읽기 전용 명령(ls, cat, grep, git status·diff·log 등)만 실행한다. write·edit 와 그 밖의 명령은 막고
 *          LLM 에게 계획으로 적으라고 알린다. 요청마다 앞에 "[계획 모드] ..." 안내를 붙인다.
 *          계획서(계획서 폴더 docs/plans 아래의 .md, 이름에 계획·plan 이 든 .md)만은 write·edit 로 쓸 수 있다
 *          (2026-10: 계획서를 남겨 달라고 해도 '쓰기가 막혀 못 쓴다' 고 답함). 답에 단계가 없으면 그 계획서의 단계로 진행할지 묻는다.
 *          진행을 고르면 기본 모델(settings.json 의 defaultModel, 설정 "plan_execute_model" 로 바꿈, "same" 이면 그대로)로 바꿔 진행한다
 *          (고급 모델은 사용량이 적어 계획에만 쓰고 진행은 기본 모델로)
 *          번호 붙인 단계가 2개 이상인 답이 오면 "이 계획대로 진행할까요?" 를 묻고, 고른 모드(자동 또는 확인)로 바꿔
 *          진행을 요청한다. 고르지 않으면(Esc) 계획 모드 그대로 (고칠 점을 적어 보내면 됨)
 *  - 확인: 파일을 쓰거나 고치기 전, 읽기 전용이 아닌 명령을 실행하기 전에 바뀌는 내용을 보여 주고 묻는다
 *  - 자동: 묻지 않고 실행 (위험한 명령만 guard.ts 가 묻는다)
 *  - 처음 모드는 내 설정 파일 ~/.pi/agent/bridge.json 의 "default_mode": "plan" | "ask" | "auto" (기본 auto)
 *  - 진행한 계획은 단계 목록으로 입력창 위에 보여 주고, LLM 이 "[N단계 완료]" 라고 적으면 체크한다.
 *    진행하던 계획을 계획 모드에서 다듬어 다시 승인하면 그 목록에 이어 붙인다 (끝난 단계는 끝남 그대로). 모두 끝난 뒤에는 다음 요청을 보낼 때 닫힌다
 *  /todo [open|clear] 할 일 목록 (2026-11-02): LLM 이 todo 도구로 만든 목록(단계·하위 단계, 하는 중·끝남)이나 승인한 계획의 단계를
 *                   입력창 위와 브라우저로 보는 HTML 파일(~/.pi/agent/todo/<프로젝트>.html)에 보인다. 시작·끝 시각과 진행률은 이 확장이 적는다.
 *                   localhost 서버 없이 파일만: 브라우저가 3초마다 옆의 .data.js 를 다시 읽는다 (file:// 에서도 <script> 는 읽힘)
 *  - guard.ts 와 함께: 계획·확인 모드에서는 guard 가 직접 묻지 않고 이유만 넘겨(event.guardReason) 여기서 한 번에 막거나 묻는다
 *  - 지금 모드는 상태 줄에 보인다 (자동이면 표시 없음)
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isPlanDoc, projectRel } from "./lib/paths.ts";
import { readTarget, runHere, SESSION, shown, target, transformInput, userAsk, workDir } from "./lib/relay.ts";
import { base, parseShell, strip } from "./lib/shell.ts";

export type Mode = "plan" | "ask" | "auto";
const NAMES: Record<string, Mode> = { plan: "plan", 계획: "plan", ask: "ask", 확인: "ask", auto: "auto", 자동: "auto" };
const LABEL: Record<Mode, string> = { plan: "계획", ask: "확인", auto: "자동" };
(globalThis as any).__piMode ||= "auto"; // guard.ts 가 읽음 (guard 가 먼저 불러와지므로 처음부터 둠)

// ── 읽기 전용 명령 판단 ──────────────────────────────────────────────

/** 읽기만 하는 명령 (출력 리다이렉트 > 가 없을 때). for·fi·done 같은 셸 문법 낱말 포함 */
const READ = new Set(
	("ls dir tree pwd cd pushd popd sort cat zcat bzcat xzcat head tail grep egrep fgrep rg ag ack wc du df stat file which whereis where " +
		"type realpath readlink basename dirname diff cmp comm cut tr nl column jq yq echo printf true false test [ [[ : seq expr sleep " +
		"date cal id whoami groups uname ps pgrep free uptime nproc lscpu lsblk md5sum sha1sum sha256sum sha512sum cksum od hexdump " +
		"strings findstr printenv locale tasklist systeminfo ver set shopt read exit for in case esac fi done sed awk gawk find fd uniq xxd hostname " +
		"tar unzip zipinfo").split(" "),
);
/** 이름은 읽기용이지만 쓰거나 다른 명령을 실행하는 옵션이 있는 것: 그 옵션이 있으면 읽기 전용이 아님.
 *  짧은 옵션은 붙여 쓸 수 있으므로(sort -uo 파일, fd -Hx rm) 값을 받지 않는 옵션 글자 뒤에 와도 찾는다. 긴 이름은 앞부분만 써도 됨(--o) */
const WRITE_FLAG: Record<string, RegExp> = {
	sort: /^-[bcCdfghiMmnRrsuVz]*o|^--(o|co)/, // -o 파일, --output, --compress-program(다른 프로그램 실행)
	date: /^-[uR]*s|^--s/,
	yq: /^-[CMNPenr0vVhyYcjaS]*[is]|^--(inplace|in-place|split-exp)/, // -i 파일 고치기, -s(--split-exp) 파일로 나눠 쓰기
	tree: /^-[a-zA-Z]*o/, // tree 는 값을 다음 낱말에서 받으므로 -ao 파일 도 -o
	rg: /^--pre/,
	fd: /^-[HIusigFalLp01qhV]*[xX]|^--exec/,
};
/** 버전만 볼 때 (--version 등) 읽기 전용인 명령 */
const VERSION_ONLY = new Set(
	"python python3 py node java javac go gcc g++ cc make cmake rustc cargo deno bun perl ruby php dotnet mvn gradle tsc uv poetry kubectl helm docker conda pip pip3 npm git".split(" "),
);
/** 낱말 version 은 진짜 하위 명령일 때만 (make version·python version 은 그 이름의 대상·파일을 실행. kubectl·helm·docker·git 은 SPECIAL 에서) */
const isVersion = (name: string, args: string[]) =>
	args.length === 1 && (/^(--?version|-V|-VV)$/.test(args[0]) || (args[0] === "version" && (name === "go" || name === "cargo")));
const GIT_READ = new Set(
	("status log diff show blame annotate grep ls-files ls-tree ls-remote rev-parse rev-list describe shortlog cat-file name-rev merge-base " +
		"cherry count-objects whatchanged show-ref for-each-ref diff-tree diff-index diff-files help version check-ignore check-attr var").split(" "),
);

/** 옵션을 건너뛰고 첫 하위 명령 (git -C dir status -> status). withValue: 값을 따로 받는 옵션 */
function sub(args: string[], withValue: Set<string>): { name: string; rest: string[] } {
	for (let k = 0; k < args.length; k++) {
		const a = args[k];
		if (!a.startsWith("-") || a === "-") return { name: a, rest: args.slice(k + 1) };
		if (!a.includes("=") && withValue.has(a)) k++;
	}
	return { name: "", rest: [] };
}

function gitRead(args: string[]): boolean {
	const { name, rest } = sub(args, new Set(["-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env"]));
	// 하위 명령 앞의 -c 설정·--config-env 는 diff.external·core.pager 처럼 다른 프로그램을 실행하게 할 수 있음 (보기만 바꾸는 설정만 허용)
	const globals = name ? args.slice(0, args.length - rest.length - 1) : args;
	if (globals.some((a, k) => a.startsWith("--config-env") || (a === "-c" && !/^(core\.quotepath|color\.[\w.-]+)(=|$)/i.test(globals[k + 1] || "")))) return false;
	if (!name) return args.some((a) => a === "--version" || a === "--help");
	if (rest.some((a) => /^--output(=|$)|^--ext-diff$|^-O|^--open-files-in-pager/.test(a))) return false; // 파일로 쓰기, 다른 프로그램 실행
	if (GIT_READ.has(name)) return true;
	const flags = rest.filter((a) => a.startsWith("-"));
	const pos = rest.filter((a) => !a.startsWith("-"));
	switch (name) {
		case "branch":
			return !flags.some((a) => /^-[a-zA-Z]*[dDmMcCfu]|^--(delete|move|copy|force|set-upstream|unset-upstream|edit-description|track|no-track|create-reflog)/.test(a))
				&& (pos.length === 0 || flags.some((a) => /^(-l|--list|--contains|--no-contains|--merged|--no-merged|--points-at)$/.test(a)));
		case "tag":
			return !flags.some((a) => /^-[a-zA-Z]*[dasfmFu]|^--(delete|annotate|sign|force|message|file|local-user)/.test(a))
				&& (pos.length === 0 || flags.some((a) => /^(-l|--list)$/.test(a)));
		case "stash":
			return pos[0] === "list" || pos[0] === "show";
		case "remote":
			return pos.length === 0 || pos[0] === "show" || pos[0] === "get-url";
		case "config":
			if (flags.some((a) => /^(--unset|--unset-all|--add|--replace-all|--rename-section|--remove-section|--edit|-e)$/.test(a))) return false;
			return pos[0] === "get" || pos[0] === "list" || flags.some((a) => /^(--get|--get-all|--get-regexp|--get-urlmatch|-l|--list)$/.test(a)) || pos.length === 1;
		case "reflog":
			return pos.length === 0 || pos[0] === "show";
		case "worktree":
			return pos[0] === "list";
		case "submodule":
			return pos.length === 0 || pos[0] === "status";
		case "notes":
			return pos.length === 0 || pos[0] === "list" || pos[0] === "show";
		case "symbolic-ref":
			return pos.length <= 1 && !flags.some((a) => /^(-d|--delete)$/.test(a));
	}
	return false;
}

/** 이름 다음 낱말(하위 명령)이 목록에 있으면 읽기 전용 */
const subIn = (list: string, withValue: string[] = []) => {
	const ok = new Set(list.split("|"));
	const wv = new Set(withValue);
	return (args: string[]) => {
		const { name, rest } = sub(args, wv);
		return !!name && (ok.has(name) || ok.has(`${name} ${rest[0] || ""}`) || ok.has(`${name} ${sub(rest, wv).name}`));
	};
};
const helmRead = subIn("list|ls|status|get|history|show|search|version|env|template|lint", ["-n", "--namespace", "--kube-context", "--kubeconfig"]);
const SPECIAL: Record<string, (args: string[]) => boolean> = {
	git: gitRead,
	pip: subIn("list|show|freeze|check|index|inspect"),
	pip3: subIn("list|show|freeze|check|index|inspect"),
	conda: subIn("list|info|search|env list|config --show", ["-n", "--name", "-p", "--prefix"]),
	npm: subIn("ls|list|la|ll|view|info|show|outdated|root|prefix|explain|why|help|config get|config list"),
	kubectl: subIn(
		"get|describe|logs|top|version|explain|api-resources|api-versions|cluster-info|events|diff|auth can-i|auth whoami|" +
			"config view|config get-contexts|config current-context|config get-clusters|config get-users",
		["-n", "--namespace", "--context", "--kubeconfig", "--cluster", "--user", "-s", "--server", "-l", "--selector", "-o", "--output", "-c", "--container"],
	),
	// helm template --output-dir 는 파일로 쓰고, --post-renderer 는 다른 프로그램 실행, --dependency-update 는 차트 폴더에 받아 씀
	helm: (a) => helmRead(a) && !a.some((x) => /^--(output-dir|post-renderer|dependency-update)(=|$)/.test(x)),
	docker: subIn(
		"ps|images|logs|inspect|version|info|top|port|history|diff|image ls|image list|image inspect|container ls|container list|" +
			"container inspect|container logs|network ls|volume ls|system df|compose ps|compose logs|compose config",
		["-H", "--host", "--context", "--config", "-f", "--file", "-p", "--project-name"],
	),
	jupyter: (a) => /^(--version|--paths|--runtime-dir|--data-dir|--config-dir)$/.test(a[0] || "") || a[1] === "list",
	"nvidia-smi": (a) =>
		!a.some((x) => /^-(pm|e|p|c|r|ac|rac|acp|pl|am|caa|lgc|rgc|lmc|rmc|mig|cgi|dgi|cci|dci)$|^--(persistence-mode|ecc-config|reset-ecc|compute-mode|gpu-reset|applications-clocks|reset-applications-clocks|power-limit|lock-|reset-)/.test(x)),
};
const PY = new Set(["python", "python3", "py"]);
/** tar 의 긴 옵션 중 다른 프로그램을 실행하거나 파일로 쓰는 것 */
const TAR_RUN = ["use-compress-program", "checkpoint-action", "info-script", "new-volume-script", "to-command", "rsh-command", "rmt-command", "index-file", "volno-file"];

/** sed 스크립트가 보기만 하는지 (GNU sed 4.9 와 같은 방식으로 읽음). 명령마다 [주소[,주소]][!] 다음에
 *  p P l = d D q Q n N g G h H x z F, s/../../(플래그는 g p i I m M 숫자만), y/../../, { }, 이름표(: b t T), # 주석만.
 *  w·W(파일로 쓰기), e·s///e(명령 실행), s///w, 그 밖의 명령(r a i c 등)이나 sed 와 다르게 읽을 수 있는 글은 아님
 *  (sed 는 문법 오류가 나도 그 앞의 w 파일은 이미 만들므로, 끝까지 sed 와 같게 읽은 것만 허용) */
export function sedScriptReadOnly(src: string): boolean {
	let i = 0;
	let depth = 0;
	const at = (re: RegExp) => i < src.length && re.test(src[i]);
	const blank = () => {
		while (at(/[ \t]/)) i++;
	};
	const num = () => {
		const s = i;
		while (at(/[0-9]/)) i++;
		return i > s;
	};
	/** 구분자 d 까지 (\ 는 다음 글자와 함께 건너뜀. 줄바꿈이 그대로 나오면 sed 도 오류) */
	const upTo = (d: string) => {
		for (; i < src.length && src[i] !== "\n"; i++) {
			if (src[i] === "\\") i++;
			else if (src[i] === d) {
				i++;
				return true;
			}
		}
		return false;
	};
	/** 주소: 줄 번호(1~2 포함), $, /정규식/ 또는 \c정규식c (뒤에 I·M). 둘째 주소는 +N·~N 도. 주소가 없으면 null, 틀리면 false */
	const addr = (second: boolean): boolean | null => {
		const c = src[i];
		if (c === "$") {
			i++;
			return true;
		}
		if (at(/[0-9]/)) {
			num();
			blank();
			if (src[i] !== "~") return true;
			i++;
			blank();
			return num();
		}
		if (second && (c === "+" || c === "~")) {
			i++;
			blank();
			return num();
		}
		if (c === "/" || c === "\\") {
			i++;
			const d = c === "/" ? "/" : src[i++];
			if (!d || d === "\n" || d === "\\" || !upTo(d)) return false;
			for (blank(); src[i] === "I" || src[i] === "M"; blank()) i++;
			return true;
		}
		return null;
	};
	while (i < src.length) {
		if (at(/[ \t\n\r\f\v;]/)) {
			i++;
			continue;
		}
		if (src[i] === "#") {
			while (i < src.length && src[i] !== "\n") i++;
			continue;
		}
		const a = addr(false);
		if (a === false) return false;
		if (a) {
			blank();
			if (src[i] === ",") {
				i++;
				blank();
				if (!addr(true)) return false;
			}
			blank();
		}
		if (src[i] === "!") {
			i++;
			blank();
		}
		const c = i < src.length ? src[i++] : "";
		if (!c) return false;
		if (c === "{") {
			depth++;
			continue;
		}
		if (c === "}") {
			if (a || !depth) return false;
			depth--;
		} else if (c === "s" || c === "y") {
			const d = i < src.length ? src[i++] : "\n";
			if (d === "\n" || d === "\\" || !upTo(d) || !upTo(d)) return false;
			if (c === "s") while (at(/[gpiImM0-9 \t]/)) i++; // e(명령 실행)·w(파일로 쓰기) 플래그는 안 됨
		} else if (":btT".includes(c)) {
			// 이름표: sed 는 빈칸·; (4.9 는 } 에서도) 에서 끊음. 그 사이에 다르게 읽을 수 있는 글자가 있으면 아님
			blank();
			const s = i;
			while (i < src.length && !/[\s;]/.test(src[i])) i++;
			if (!/^[\w.-]*$/.test(src.slice(s, i)) || (c === ":" && (a || i === s))) return false;
		} else if ("qQl".includes(c)) {
			blank();
			num(); // q5 (끝내는 코드), l 40 (줄 길이)
		} else if (!"=dDFgGhHnNpPxz".includes(c)) return false;
		blank();
		if (i < src.length && !";\n}#".includes(src[i])) return false; // 명령 끝
	}
	return depth === 0;
}

const SED_LONG = new Set(["--quiet", "--silent", "--regexp-extended", "--separate", "--unbuffered", "--null-data", "--zero-terminated", "--posix", "--debug", "--sandbox", "--follow-symlinks", "--binary", "--help", "--version"]);
/** sed: 아는 옵션만 (-i·--in-place 파일 고치기, -f 스크립트 파일, 줄인 이름 --i 등은 아님. 스크립트 뒤에 온 옵션도 봄)
 *  스크립트는 -e·--expression 들, 없으면 첫 낱말 (-e 마다 따로 읽지만 이어 붙여 봐도 같은 결과) */
function sedReadOnly(args: string[]): boolean {
	const scripts: string[] = [];
	const rest: string[] = [];
	let e = false;
	for (let k = 0; k < args.length; k++) {
		const a = args[k];
		if (a === "--") {
			rest.push(...args.slice(k + 1));
			break;
		}
		if (a.startsWith("--")) {
			const eq = a.indexOf("=");
			const name = eq < 0 ? a : a.slice(0, eq);
			if (name === "--expression" || name === "--line-length") {
				const v = eq < 0 ? (args[++k] ?? "") : a.slice(eq + 1);
				if (name === "--expression") {
					scripts.push(v);
					e = true;
				}
			} else if (eq >= 0 || !SED_LONG.has(name)) return false;
			continue;
		}
		if (a.length > 1 && a.startsWith("-")) {
			for (let j = 1; j < a.length; j++) {
				if (a[j] === "e" || a[j] === "l") {
					const v = j + 1 < a.length ? a.slice(j + 1) : (args[++k] ?? "");
					if (a[j] === "e") {
						scripts.push(v);
						e = true;
					}
					break;
				}
				if (!"nrEsuzb".includes(a[j])) return false; // -i 파일 고치기, -f 스크립트 파일, 모르는 옵션
			}
			continue;
		}
		rest.push(a);
	}
	if (!e && rest.length) scripts.push(rest[0]);
	return sedScriptReadOnly(scripts.join("\n"));
}

/** 셸 명령이 읽기만 하는지. 읽기만 하면 null, 아니면 문제가 된 부분 (계획 모드·확인 모드에서 씀) */
export function readOnlyProblem(command: string): string | null {
	const p = parseShell(String(command || ""));
	for (const inner of p.nested) {
		const r = readOnlyProblem(inner);
		if (r) return r;
	}
	for (const pipe of p.pipelines) {
		for (const s of pipe) {
			const out = s.redirects.filter((r) => !/^\/dev\/(null|stdout|stderr|tty)$/.test(r));
			if (out.length) return `파일로 출력 (> ${out[0]})`;
			const r = wordsProblem(s.words);
			if (r) return r;
		}
	}
	return null;
}

function wordsProblem(words: string[]): string | null {
	if (words[0] === "command" && /^-[vV]$/.test(words[1] || "")) return null; // command -v 이름
	const { rest, sudo } = strip(words);
	if (sudo) return "sudo";
	if (!rest.length) return null; // 변수 대입만
	const name = base(rest[0]);
	const args = rest.slice(1);
	const pos = args.filter((a) => !a.startsWith("-") && !a.startsWith("/dev/")); // 2>/dev/null 의 대상도 낱말로 들어옴
	const what = rest.join(" ").slice(0, 80);
	if (isVersion(name, args) && (VERSION_ONLY.has(name) || PY.has(name))) return null;
	if (PY.has(name) && args[0] === "-m" && /^pip3?$/.test(args[1] || "")) return SPECIAL.pip(args.slice(2)) ? null : what;
	const special = SPECIAL[name];
	if (special) return special(args) ? null : what;
	if (!READ.has(name)) return what;
	if (WRITE_FLAG[name] && args.some((a) => WRITE_FLAG[name].test(a))) return what;
	switch (name) {
		case "sed":
			if (!sedReadOnly(args)) return what;
			break;
		case "awk":
		case "gawk": {
			// 옵션은 -F 구분자·-v 변수만 (-f 프로그램 파일, -i·-l 불러오기, -o·-p·-d 파일로 쓰기 등은 아님)
			for (let k = 0; k < args.length && args[k].startsWith("-") && args[k] !== "-" && args[k] !== "--"; k++) {
				if (!/^(-[Fv]|--version$)/.test(args[k])) return what;
				if (args[k].length === 2) k++; // 값을 다음 낱말로 받음
			}
			// 프로그램: system(), print > 파일, "명령" | getline, print | "명령", @include·@load (gawk 의 inplace 등)
			if (args.some((a) => /system\s*\(|(?<!\|)\|(?!\|)\s*["\w$]|\|&|(print|printf)\b[^;}]*>|@(include|load)\b/.test(a))) return what;
			break;
		}
		case "find": {
			for (let k = 0; k < args.length; k++) {
				const a = args[k];
				if (/^-(delete|fprint0?|fprintf|fls)$/.test(a)) return what;
				if (/^-(exec|execdir|ok|okdir)$/.test(a)) {
					const cmd: string[] = [];
					for (k++; k < args.length && args[k] !== ";" && args[k] !== "+"; k++) cmd.push(args[k]);
					const r = cmd.length ? wordsProblem(cmd.filter((w) => w !== "{}")) : what;
					if (r) return r;
				}
			}
			break;
		}
		case "uniq":
		case "xxd":
			if (pos.length > 1) return what; // 두 번째 이름은 출력 파일
			break;
		case "hostname":
			if (pos.length) return what;
			break;
		case "tar": {
			const mode = args.find((a) => /^-?[a-zA-Z]+$/.test(a)) || "";
			if (!(/t/.test(mode) || args.includes("--list")) || /[xcruA]/.test(mode.replace(/^-/, "")) || args.some((a) => /^--(extract|get|create|append|update|delete)/.test(a))) return what;
			// 다른 프로그램 실행·파일 쓰기: -I(압축 프로그램)·-F(스크립트) 와 TAR_RUN (긴 이름은 앞부분만 써도 됨: --use=x)
			if (args.some((a, k) => (/^-[a-zA-Z]/.test(a) || (k === 0 && /^[a-zA-Z]+$/.test(a))) && /[IF]/.test(a))) return what;
			if (args.some((a) => a.startsWith("--") && a.length > 2 && TAR_RUN.some((o) => o.startsWith(a.slice(2).split("=")[0])))) return what;
			break;
		}
		case "unzip":
			if (!args.some((a) => /^-[lvZt]/.test(a))) return what;
			break;
	}
	return null;
}

// ── 확인 모드의 미리 보기 ──────────────────────────────────────────────

const lines = (s: string) => (s === "" ? [] : s.replace(/\n$/, "").split("\n"));
const cut = (s: string, n = 160) => (s.length > n ? s.slice(0, n) + "…" : s);

/** 앞뒤 같은 줄을 빼고 바뀐 부분만 (- 지운 줄, + 넣은 줄) */
export function lineDiff(before: string, after: string, max = 15): string {
	const a = lines(before);
	const b = lines(after);
	let p = 0;
	while (p < a.length && p < b.length && a[p] === b[p]) p++;
	let s = 0;
	while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
	const del = a.slice(p, a.length - s);
	const add = b.slice(p, b.length - s);
	if (!del.length && !add.length) return "(내용 같음)";
	const show = (xs: string[], mark: string) => [
		...xs.slice(0, max).map((x) => `${mark} ${cut(x)}`),
		...(xs.length > max ? [`${mark} (… ${xs.length - max}줄 더)`] : []),
	];
	return [`(${p + 1}번째 줄부터)`, ...show(del, "-"), ...show(add, "+")].join("\n");
}

async function preview(tool: string, input: any): Promise<{ title: string; body: string }> {
	if (tool === "bash") return { title: "명령 실행", body: cut(String(input.command || ""), 1500) };
	const t = target(String(input.path || ""));
	const name = shown(t);
	let old: string | null = null;
	try {
		const b = await readTarget(t);
		old = b === null ? null : b.toString("utf8");
	} catch {}
	if (tool === "write") {
		const neu = String(input.content ?? "");
		if (old === null) {
			const ls = lines(neu);
			return { title: `새 파일: ${name}`, body: [...ls.slice(0, 15).map((x) => `+ ${cut(x)}`), ...(ls.length > 15 ? [`+ (… ${ls.length - 15}줄 더)`] : []), `(모두 ${ls.length}줄)`].join("\n") };
		}
		return { title: `파일 덮어쓰기: ${name}`, body: lineDiff(old, neu) };
	}
	const edits: any[] = Array.isArray(input.edits) ? input.edits : input.oldText !== undefined ? [{ oldText: input.oldText, newText: input.newText }] : [];
	const parts = edits.slice(0, 4).map((e) => lineDiff(String(e.oldText ?? ""), String(e.newText ?? ""), 8).replace(/^\(\d+번째 줄부터\)\n/, ""));
	return { title: `파일 고치기: ${name}`, body: parts.join("\n  ⋯\n") + (edits.length > 4 ? `\n(외 ${edits.length - 4}곳)` : "") };
}

// ── 계획과 진행 목록 ──────────────────────────────────────────────

// 2026-10 시험: 계획서는 쓸 수 있다고 끝에만 적었더니 '승인해 주시면 먼저 계획서를 작성하겠습니다' 로 계획서 쓰기를 단계에 넣음 -> 앞에 분명히
export const planNote = (dir: string) =>
	"[계획 모드] 지금은 계획만 세웁니다. 코드·설정 파일을 바꾸는 도구와 명령은 막혀 있습니다 (read 와 읽기 전용 명령만). " +
	`단, 계획서는 지금 쓸 수 있습니다: 계획서를 남겨 달라는 요청이면 승인을 기다리지 말고 지금 write 로 ${dir}/<이름>.md ` +
	"(또는 이름에 '계획'·plan 이 든 .md)에 쓰세요. 계획서 쓰기를 계획의 단계로 넣지는 마세요. " +
	"필요하면 read 와 읽기 전용 명령(ls, grep, git diff 등)으로 살펴본 뒤 번호를 붙인 단계로 계획을 적어 주세요 " +
	"(단계마다 할 일과 바꿀 파일). 정해야 할 점이 있으면 계획 끝에 질문으로 적어 주세요. 사용자가 승인하면 그때 진행합니다.";
const proceedText = (n: number, mode: Mode, doc = "", done: number[] = []) =>
	`위 계획${doc ? `(계획서 ${doc})` : ""}대로 진행해 주세요. 계획 모드는 끝났고 이제 파일을 바꾸고 명령을 실행할 수 있습니다` +
	`${mode === "ask" ? " (바꾸기 전에 사용자가 하나씩 확인합니다)" : ""}. ` +
	`${done.length ? `이미 끝난 단계(${done.join(", ")}단계)는 다시 하지 말고 남은 단계를 이어서 해 주세요. ` : ""}` +
	`단계 하나를 마칠 때마다 답에 "[N단계 완료]" 라고 적어 주세요 (N 은 단계 번호, 모두 ${n}단계). ` +
	`할 일 목록은 pi 가 이 계획의 단계로 이미 만들었습니다 (todo 로 진행을 고칠 때는 같은 ${n}개 단계를 같은 차례로).`;
/** 계획 모드 안내 뒤에 붙이는 지금 목록 (끝나지 않은 목록이 있을 때). 2026-11-04 사용자: 8단계 계획을 진행하다 계획 모드에서 다듬었더니
 *  목록이 3단계로 줄어듦 (답에 바뀐 점이나 앞 단계만 번호로 적으면 그것이 새 계획이 됨) -> 고친 계획 전체를 번호로 다시 적게 */
export function planNow(s: TodoState | null): string {
	if (!s?.items.length || todoSummary(s).all) return "";
	const tops = s.items.filter((it) => it.level === 0).slice(0, 20);
	const done = tops.filter((it) => it.status === "done").length;
	const what = s.source === "plan" ? "계획" : "할 일 목록";
	return (
		`\n\n[지금 진행 중인 ${what}: ${tops.length}단계 중 ${done}단계 끝남]\n` +
		tops.map((it, i) => `${i + 1}. ${cut(it.text, 70)}${it.status === "done" ? DONE_TAIL : ""}`).join("\n") +
		`\n이 ${what}을 고치거나 보태는 요청이면 고친 계획 전체를 1단계부터 번호를 붙여 다시 적어 주세요. ` +
		"바뀌지 않은 단계도 빼거나 '그대로' 로 줄이지 말고 같은 글로 적고, 끝난 단계는 끝에 (끝남) 을 붙입니다. 바뀐 점은 번호 없이 따로 적어 주세요. " +
		`다른 작업의 계획이면 이 ${what}은 신경 쓰지 않아도 됩니다.`
	);
}
const CHOICES: [string, Mode | null][] = [
	["진행 (자동: 묻지 않고 실행)", "auto"],
	["진행 (확인: 바꿀 때마다 확인)", "ask"],
	["계획 더 다듬기 (계획 모드 유지)", null],
];

type Item = { indent: number; n: number; text: string };
// 다듬은 계획에서 끝난 단계: '(끝남)'·'(완료)'·✅ 같은 표시 -> 단계 글 끝의 DONE_TAIL 하나로 (70자로 자르기 전에 봄)
const DONE_TAIL = " (끝남)";
const DONE_END_RE = /(?:\s*[(（[]\s*(?:이미\s*)?(?:끝남|끝났음|끝|완료|완료됨|done)\s*[)）\]]|\s*[✅✔✓☑])\s*$/i;
const DONE_START_RE = /^[✅✔✓☑]\s*/;
/** 한 깊이의 번호 목록에서 1부터 이어지는 단계 */
function stepRun(items: Item[]): string[] {
	const steps: string[] = [];
	for (const f of items) {
		if (f.n !== steps.length + 1) {
			if (steps.length >= 2) break; // 뒤에 다시 1. 로 시작하는 목록(질문 등)은 계획이 아님
			if (f.n === 1) steps.length = 0;
			else continue;
		}
		let t = f.text.replace(/\*\*/g, "").replace(/[:：]\s*$/, "").trim();
		const done = DONE_END_RE.test(t) || DONE_START_RE.test(t);
		if (done) t = t.replace(DONE_END_RE, "").replace(DONE_START_RE, "").replace(/[:：]\s*$/, "").trim();
		steps.push(cut(t, 70) + (done ? DONE_TAIL : ""));
	}
	return steps;
}
/** 답에서 계획 단계 (1. 2. 3. 또는 1단계: 2단계: ... 처음부터 이어지는 번호만, 가장 바깥 목록).
 *  '1. 확인한 것: 2. 계획:' 처럼 번호 붙인 절 안에 계획이 있으면 그 절 안의 목록 (2026-10 시험: 2단계로 잘못 셈) */
const numbered = (text: string): Item[] =>
	[...String(text || "").matchAll(/^([ \t]*)(?:#{1,4}[ \t]*)?(?:\*\*)?(\d{1,2})(?:[.)]|[ \t]*단계[ \t]*[:.)]?)(?:\*\*)?[ \t]+(.+)$/gm)].map((m) => ({
		indent: m[1].replace(/\t/g, "    ").length,
		n: Number(m[2]),
		text: m[3],
	}));
/** 다듬은 계획: 답의 번호 목록 가운데 진행하던 목록(prev)과 글이 같은 단계가 가장 많은 것. planSteps 가 고른 것보다 많을 때만 (아니면 null).
 *  2026-11-04: '바뀐 점: 1. 2. 3.' 다음에 전체 계획을 다시 적으면 planSteps 는 앞의 3개를 계획으로 봄 */
/** 단계 가운데 진행하던 목록의 맨 위 단계와 글이 같은 것의 수 ((끝남) 표시는 빼고 봄) */
export function replanScore(steps: string[], prev: TodoState | null): number {
	const key = (t: string) => (t.endsWith(DONE_TAIL) ? t.slice(0, -DONE_TAIL.length) : t).replace(/\s+/g, " ").trim().toLowerCase();
	const olds = new Set((prev?.items || []).filter((it) => it.level === 0).map((it) => key(it.text)));
	return steps.filter((s) => olds.has(key(s))).length;
}
export function replanSteps(text: string, prev: TodoState | null, picked: string[]): string[] | null {
	if (!prev?.items.length) return null;
	const score = (steps: string[]) => replanScore(steps, prev);
	const found = numbered(text);
	let best: string[] | null = null;
	let top = score(picked);
	for (const indent of new Set(found.map((f) => f.indent))) {
		const same = found.filter((f) => f.indent === indent);
		same.forEach((f, i) => {
			if (f.n !== 1) return;
			const run = stepRun(same.slice(i));
			const s = score(run);
			if (run.length >= 2 && (s > top || (best && s === top && run.length > best.length))) [best, top] = [run, s];
		});
	}
	return best;
}
export function planSteps(text: string): string[] {
	const found = numbered(text);
	if (!found.length) return [];
	const top = Math.min(...found.map((f) => f.indent));
	const outer = stepRun(found.filter((f) => f.indent === top));
	for (let i = 0; i < found.length; i++) {
		if (found[i].indent !== top || !/계획|단계|plan|할 일|진행 순서/i.test(found[i].text)) continue;
		const inner: Item[] = [];
		for (let j = i + 1; j < found.length && found[j].indent > top; j++) inner.push(found[j]);
		if (!inner.length) continue;
		const innerTop = Math.min(...inner.map((x) => x.indent));
		const steps = stepRun(inner.filter((x) => x.indent === innerTop));
		if (steps.length >= 2 && steps.length > outer.length) return steps;
	}
	return outer;
}

const userConfig = (): any => {
	const p = process.env.PI_COPILOT_USER_CONFIG || join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "bridge.json");
	try {
		return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) || {};
	} catch {
		return {};
	}
};
/** 계획을 승인하면 진행할 모델 {provider, id}: 내 설정 파일의 "plan_execute_model" (모델 id 나 provider/id. "same" 이면 바꾸지 않음),
 *  없으면 pi 의 기본 모델 (settings.json 의 defaultProvider·defaultModel). 2026-10: 고급 모델(GPT-6.1 Sol·Opus 5.5 등)은 사용량이 적어
 *  계획에만 쓰고, 진행은 기본 모델(GPT-5.6 Sol 깊이 생각하기)로. explicit: provider/id 로 적음 (그때만 다른 제공자로도 바꿈) */
export function executeModel(cfg: any = userConfig(), settings: any = piSettings()): { provider: string; id: string; explicit: boolean } | null {
	const v = String(cfg.plan_execute_model ?? "").trim();
	if (v === "same") return null;
	const explicit = v.includes("/");
	const [provider, id] = explicit ? [v.slice(0, v.indexOf("/")), v.slice(v.indexOf("/") + 1)] : [String(settings.defaultProvider || ""), v || String(settings.defaultModel || "")];
	return provider && id ? { provider, id, explicit } : null;
}
function piSettings(): any {
	try {
		const p = join(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"), "settings.json");
		return JSON.parse(readFileSync(p, "utf8").replace(/^﻿/, "")) || {};
	} catch {
		return {};
	}
}
/** 계획서 폴더 (작업 폴더 기준. 내 설정 파일의 "plan_dir", 기본 docs/plans. 절대 경로·.. 은 받지 않음) */
const planDir = (): string => {
	const t = String(userConfig().plan_dir || "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
	return t && !t.startsWith("/") && !/^[a-zA-Z]:/.test(t) && !t.split("/").includes("..") ? t : "docs/plans";
};
const textOf = (m: any) => (typeof m?.content === "string" ? m.content : (m?.content || []).filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n"));
const READ_TOOLS = new Set(["read", "grep", "find", "ls", "wiki_search", "wiki_read", "docs_lookup", "ask_user"]);

// ── /review: 고급 모델로 리뷰 (2026-10-28) ─────────────────────────────
// 계획 모드의 '계획은 고급 모델, 진행은 기본 모델' 과 같은 방식: 같은 대화에서 모델만 리뷰 모델로 바꿔 한 번 리뷰하고 원래 모델로 돌아온다.
// 키트가 바뀐 내용(git status·diff·새 파일)을 모아 요청에 붙여, 리뷰 모델은 보통 도구 없이 답 하나로 끝낸다 (고급 모델은 사용량이 적음).
// 리뷰하는 동안은 읽기만 (REVIEW_TOOLS_MAX 번까지). 끝나면 '리뷰대로 고칠까요?' 를 묻고, 고치면 원래 모델로 요청한다.
export const DEFAULT_REVIEW_MODEL = "gpt-6"; // Copilot 을 쓸 때 기본 리뷰 모델 (내 설정 "review_model" 로 바꿈, "same" 이면 지금 모델)
export const REVIEW_TOOLS_MAX = 4;
export const REVIEW_DIFF_MAX = 30000;
export const REVIEW_TAG = "[리뷰]"; // 중계 서버는 이 표시가 있는 요청에 '이어서 하라' 부탁을 하지 않는다 (relay.py NO_TOOLS_RE, 계획 모드와 같게)
/** 리뷰 모델 {provider, id}: 내 설정 파일의 "review_model" (모델 id 나 provider/id. "same" 이면 null = 지금 모델).
 *  없으면 Copilot 모델을 쓰는 중일 때 DEFAULT_REVIEW_MODEL, 아니면(사내AI, API 키트의 vLLM 등) 지금 모델. 다른 제공자로는 provider/id 로 적었을 때만 */
export function reviewModel(cur: { provider?: string; id?: string } | undefined, cfg: any = userConfig()): { provider: string; id: string; explicit: boolean } | null {
	const v = String(cfg.review_model ?? "").trim();
	if (v === "same" || !cur?.provider) return null;
	if (!v) return cur.provider === "copilot" ? { provider: "copilot", id: DEFAULT_REVIEW_MODEL, explicit: false } : null;
	if (v.includes("/")) return { provider: v.slice(0, v.indexOf("/")), id: v.slice(v.indexOf("/") + 1), explicit: true };
	return { provider: cur.provider, id: v, explicit: false };
}
/** 바뀐 내용을 모으는 명령 (PC 의 bash 와 노트북에서 같게). '@@REVIEW <이름>' 줄로 나눔. 커밋이 없는 저장소는 스테이징한 것도 */
export const REVIEW_SCAN = [
	'git rev-parse --is-inside-work-tree >/dev/null 2>&1 || { echo "@@REVIEW nogit"; exit 0; }',
	'echo "@@REVIEW status"; git status --short 2>/dev/null | head -60',
	"if git rev-parse --verify -q HEAD >/dev/null 2>&1; then",
	'  echo "@@REVIEW stat"; git diff HEAD --stat 2>/dev/null | tail -40',
	`  echo "@@REVIEW diff"; git diff HEAD 2>/dev/null | head -c ${REVIEW_DIFF_MAX}`,
	"else",
	'  echo "@@REVIEW stat"; { git diff --cached --stat; git diff --stat; } 2>/dev/null | tail -40',
	`  echo "@@REVIEW diff"; { git diff --cached; git diff; } 2>/dev/null | head -c ${REVIEW_DIFF_MAX}`,
	"fi",
	'echo "@@REVIEW new"; git ls-files --others --exclude-standard 2>/dev/null | head -8 | while IFS= read -r f; do',
	'  [ -f "$f" ] && [ "$(wc -c < "$f")" -lt 20000 ] && { echo "=== $f"; head -c 6000 "$f"; echo; }',
	"done",
	"true",
].join("\n");
/** 모은 내용 -> 부분별 글 (nogit: git 저장소가 아님) */
export function parseReviewScan(out: string): { nogit: boolean; status: string; stat: string; diff: string; fresh: string } {
	const parts: Record<string, string> = {};
	let name = "";
	for (const line of out.replace(/\r/g, "").split("\n")) {
		const m = line.match(/^@@REVIEW (\w+)$/);
		if (m) {
			name = m[1];
			parts[name] = "";
		} else if (name) parts[name] += `${line}\n`;
	}
	const t = (k: string) => (parts[k] || "").replace(/\s+$/, "");
	return { nogit: "nogit" in parts, status: t("status"), stat: t("stat"), diff: t("diff"), fresh: t("new") };
}
/** 리뷰 요청 글 (who: 리뷰 모델 이름, focus: /review 뒤에 적은 볼 점) */
export function reviewPrompt(scan: ReturnType<typeof parseReviewScan>, who: string, focus = ""): string {
	const lines = [
		`${REVIEW_TAG} 지금까지의 작업을 ${who} 로 검토합니다. 이번 답에서는 파일을 바꾸지 말고, 찾은 것만 적어 주세요.`,
		"- 볼 점: 이 대화에서 사용자가 요청한 것을 빠뜨리거나 다르게 한 곳, 버그 가능성, 예외·빈 값 처리, 보안(비밀번호·키·내부 주소가 코드에 들어감), 시험하지 않은 곳.",
		"- 적는 법: 심각한 것부터 하나마다 위치(파일:줄), 문제, 고칠 방법. 문제가 없으면 '문제 없음' 이라고 적으세요.",
		// 스킬 문서: 2026-10-28 실사용 시험에서 리뷰 모델이 debugging 스킬부터 읽음 (고급 모델은 도구마다 질문 하나)
		`- 아래 바뀐 내용으로 보통 충분합니다. 꼭 필요할 때만 read·grep 으로 프로젝트 파일을 더 보세요 (${REVIEW_TOOLS_MAX}번까지, 스킬 문서는 읽지 않아도 됨). 이 대화에서 바꾼 것 위주로 봅니다.`,
	];
	if (focus.trim()) lines.push(`- 사용자가 특히 볼 점: ${focus.trim()}`);
	if (scan.nogit) {
		lines.push("", "(작업 폴더가 git 저장소가 아니라 바뀐 내용을 모으지 못했습니다. 이 대화에서 바꾼 파일을 read 로 보고 검토하세요.)");
		return lines.join("\n");
	}
	if (!scan.status && !scan.diff && !scan.fresh) lines.push("", "(git 에 바뀐 것이 없습니다: 커밋한 뒤라면 이 대화에서 한 일을 보고 검토하세요.)");
	if (scan.status) lines.push("", "## git status", "```text", scan.status, "```");
	if (scan.stat) lines.push("", "## 바뀐 양 (git diff --stat)", "```text", scan.stat, "```");
	if (scan.diff) {
		const cut = scan.diff.length >= REVIEW_DIFF_MAX - 100 ? `\n(바뀐 내용이 길어 앞 ${REVIEW_DIFF_MAX}바이트만. 나머지는 필요하면 read 로)` : "";
		lines.push("", "## 바뀐 내용 (git diff)", "```diff", scan.diff, "```" + cut);
	}
	if (scan.fresh) lines.push("", "## 새 파일 (git 이 아직 모르는 파일, 앞부분)", "```text", scan.fresh, "```");
	return lines.join("\n");
}
/** 리뷰 답이 '문제 없음' 인지 (그때는 고칠지 묻지 않음): '문제 없음' 류의 말이 있고, 위치(파일:줄)를 하나도 적지 않았을 때 */
export const reviewClean = (text: string) =>
	/(문제|고칠 ?(것|점))(이|가|은|는)? ?없(습니다|음|어요|다)/.test(text) && !/[\w/.-]+\.[A-Za-z]{1,5}:\d+/.test(text);
export const REVIEW_FIX =
	"[리뷰 뒤 고치기] 방금 리뷰에서 찾은 것 가운데 이번 작업에 관계된 것을 고치고, 고친 뒤 실행·시험해 확인해 주세요. " +
	"리뷰가 틀렸다고 보이는 것은 고치지 말고 까닭을 적어 주세요. 사용자 승인이 필요한 일(운영 반영, 지우기 등)은 하지 말고 물어 주세요.";

// ── 할 일 목록: todo 도구, /todo (2026-11-02) ─────────────────────────────
// 사용자 요청: 지금 작업의 할 일을 pi 가 도는 PC 의 브라우저에서 단계별로 보고, 전체 진행과 시작·끝 시각도 보기.
//  localhost 서버 대신 HTML 파일 (~/.pi/agent/todo/<프로젝트>.html): 브라우저가 3초마다 옆의 <프로젝트>.data.js 만 다시 읽는다.
//  모델은 목록과 상태만 보내고, 시각·진행률은 이 확장이 적는다 (모델이 적은 시각은 믿기 어려움). 승인한 계획의 단계도 같은 목록으로
export type TodoStatus = "todo" | "doing" | "done";
export type TodoItem = { level: number; text: string; status: TodoStatus; started: number | null; ended: number | null; approx?: boolean };
export type TodoState = {
	v: 1;
	project: string;
	cwd: string;
	remote: boolean;
	source: "todo" | "plan";
	request: string;
	created: number;
	updated: number;
	updates: number;
	items: TodoItem[];
	// 목록이 다 끝나지 않은 채 요청이 끝난 때 (모델이 남은 단계를 고치지 않고 답을 끝냄). 목록을 고치거나 다음 요청이 시작되면 지움
	stopped?: number | null;
};
type TodoLine = { level: number; text: string; status: TodoStatus };
type TodoMeta = { project: string; cwd: string; remote: boolean; request: string; source?: "todo" | "plan" };
export const TODO_MAX = 60;
const TODO_MARKS: Record<string, TodoStatus> = { "": "todo", " ": "todo", "~": "doing", ">": "doing", "-": "doing", "/": "doing", "*": "doing", x: "done", X: "done", v: "done", V: "done", "✓": "done", "✔": "done" };
export const TODO_GUIDE =
	"세 단계가 넘는 작업은 시작할 때 todo 로 할 일 목록(단계와, 필요하면 두 칸 들여 쓴 하위 단계)을 만들고, 단계를 시작하거나 끝낼 때 목록 전체를 다시 보낸다. " +
	"todo 는 그때 할 다른 도구와 같은 답에 함께 보낸다 (todo 만 따로 보내지 않음). 간단한 질문이나 한두 단계 작업에는 쓰지 않는다";
const TODO_HELP = "목록을 읽지 못했습니다. text 에 '- [ ] 할 일' 처럼 한 줄에 하나씩 적어 주세요 ([~] 하는 중, [x] 끝남, 하위 단계는 두 칸 들여 씀)";
export const TODO_PLAN_MODE =
	"계획 모드라 할 일 목록은 그대로 두었습니다. 계획은 답에 번호를 붙인 단계로 적어 주세요 (사용자가 계획을 승인하면 그 단계로 목록이 바뀝니다)";
// 목록을 만든 뒤 작업이 이어지는데 고치지 않으면 도구 결과에 짧은 안내 (2026-11-02 실사용 시험: 처음에 만들고 끝에 한 번에 [x] 만 보내
//  단계마다의 시각이 모두 어림이 됨). 목록을 고친 뒤 다른 도구가 이만큼 쓰이면, 그래도 고치지 않으면 TODO_NUDGE_AGAIN 번째에 한 번 더
export const TODO_NUDGE_AT = 3;
export const TODO_NUDGE_AGAIN = 8;
export const todoNudge = (cur: string, plan = 0) =>
	`[할 일 목록] 목록을 고친 뒤로 작업이 이어졌습니다. 끝낸 단계나 새로 시작한 단계가 있으면 다음 블록과 같은 답에 ` +
	`${plan ? `todo 로 계획의 ${plan}개 단계를 같은 차례로 보내 고쳐 주세요 (또는 답에 "[N단계 완료]")` : "todo 로 목록 전체를 고쳐 보내세요"}${cur ? ` (목록에서 지금 하는 중: ${cur})` : ""}.`;
/** 승인한 계획을 진행하는 중에 모델이 todo 로 보낸 목록: 맨 위 단계 수가 계획과 같으면 단계 글은 계획대로 두고 진행(과 하위 단계)만 받음.
 *  다르면 null (목록을 바꾸지 않음). 2026-11-04 실제 Copilot: 승인 바로 뒤 모델이 제 글로 쓴 8단계를 todo 로 보내, 글이 겹치지 않아 계획 목록이 새 목록으로 바뀜
 *  (단계 수가 적었으면 계획의 단계가 사라짐) */
export function fitPlan(plan: TodoState, lines: TodoLine[]): TodoLine[] | null {
	const tops = plan.items.filter((it) => it.level === 0);
	if (lines.filter((l) => l.level === 0).length !== tops.length) return null;
	let k = 0;
	return lines.map((l) => (l.level === 0 ? { ...l, text: tops[k++].text } : l));
}
export const todoPlanKeep = (n: number) =>
	`승인한 계획의 단계 목록(${n}단계)이 이미 있어 목록은 그대로 두었습니다. 진행은 답에 "[N단계 완료]" 라고 적거나, todo 로 같은 ${n}개 단계를 같은 차례로 보내 고치세요 (하위 단계는 두 칸 들여 씀)`;

/** todo 도구의 text -> 항목. 한 줄에 하나: '- [ ] 할 일', '- [~] 하는 중', '- [x] 끝남'. 들여쓰기(두 칸)나 '1.2' 같은 번호가 하위 단계 */
export function parseTodo(text: unknown): TodoLine[] {
	const out: TodoLine[] = [];
	const widths: number[] = [];
	for (const line of String(text ?? "").replace(/\r/g, "").split("\n")) {
		const m = line.match(/^([ \t]*)(?:[-*+•]|(\d{1,3}(?:\.\d{1,3})*)[.)]?)[ \t]+(?:\[([^\]]?)\][ \t]*)?(.*\S)/);
		if (!m || /^\[.?\]$/.test(m[4])) continue;
		const width = m[1].replace(/\t/g, "  ").length;
		while (widths.length && width < widths[widths.length - 1]) widths.pop();
		if (!widths.length || width > widths[widths.length - 1]) widths.push(width);
		const level = m[2]?.includes(".") ? m[2].split(".").length - 1 : widths.length - 1; // '1.2' 는 번호대로
		out.push({ level, text: cut(m[4].replace(/\*\*/g, "").trim(), 120), status: m[3] === undefined ? "todo" : (TODO_MARKS[m[3]] ?? "todo") });
		if (out.length >= TODO_MAX) break;
	}
	// 첫 항목은 0 단계부터, 한 번에 한 단계씩만 깊어지게 (3 단계까지)
	for (let i = 0; i < out.length; i++) out[i].level = i === 0 ? 0 : Math.min(out[i].level, out[i - 1].level + 1, 3);
	return out;
}

/** 항목 번호: 1, 1.1, 1.2, 2 ... */
export function todoNumbers(items: { level: number }[]): string[] {
	const c: number[] = [];
	return items.map((it) => {
		c.length = it.level + 1;
		c[it.level] = (c[it.level] || 0) + 1;
		return Array.from(c, (x) => x || 1).join(".");
	});
}
const hasKids = (items: { level: number }[], i: number) => i + 1 < items.length && items[i + 1].level > items[i].level;
function endTodo(it: TodoItem, now: number, since: number) {
	it.status = "done";
	if (it.ended === null) it.ended = now;
	if (it.started === null) [it.started, it.approx] = [since, true]; // 시작을 알리지 않고 끝남: 앞 목록을 받은 때부터 (어림)
}
/** 하위 단계가 있는 항목: 상태·시작·끝을 하위 단계로 (모두 끝나면 끝남, 하나라도 시작했으면 하는 중) */
function rollUp(items: TodoItem[]) {
	for (let i = items.length - 1; i >= 0; i--) {
		const it = items[i];
		const kids: TodoItem[] = [];
		for (let j = i + 1; j < items.length && items[j].level > it.level; j++) if (items[j].level === it.level + 1) kids.push(items[j]);
		if (!kids.length) continue;
		const all = kids.every((k) => k.status === "done");
		it.status = all ? "done" : kids.some((k) => k.status !== "todo") || it.status === "doing" ? "doing" : "todo";
		// 시작 = 자기와 하위 단계 가운데 가장 이른 시각. 어림(~)은 그 시각이 어림일 때만 (같으면 어림이 아닌 쪽)
		const starts = [it, ...kids].filter((x) => x.started !== null).sort((a, b) => (a.started as number) - (b.started as number) || Number(!!a.approx) - Number(!!b.approx));
		it.started = starts.length ? starts[0].started : null;
		const approx = !!starts[0]?.approx;
		it.ended = all ? Math.max(...kids.map((k) => k.ended ?? 0)) : null;
		if (approx) it.approx = true;
		else delete it.approx;
	}
}
/** 새로 받은 목록에 앞 목록의 시각을 이어 붙인다 (같은 단계·같은 글, 아니면 같은 번호의 자리). 하는 중이 되면 시작, 끝나면 끝 시각 */
export function mergeTodo(prev: TodoState | null, lines: TodoLine[], now: number, meta: TodoMeta): TodoState {
	const old = prev?.items || [];
	const key = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
	const [oldNo, newNo] = [todoNumbers(old), todoNumbers(lines)];
	const used = new Set<number>();
	const find = (ok: (o: TodoItem, k: number) => boolean) => {
		const j = old.findIndex((o, k) => !used.has(k) && ok(o, k));
		if (j >= 0) used.add(j);
		return j;
	};
	const match = lines.map((p) => find((o) => o.level === p.level && key(o.text) === key(p.text)));
	const fresh = !prev || used.size === 0; // 글이 같은 단계가 하나도 없으면 새 작업 (앞 목록의 시각을 쓰지 않음)
	// 글만 조금 고친 단계: 같은 번호의 자리
	if (!fresh) lines.forEach((p, i) => match[i] < 0 && (match[i] = find((o, k) => o.level === p.level && oldNo[k] === newNo[i])));
	const items: TodoItem[] = lines.map((p, i) => {
		const o = !fresh && match[i] >= 0 ? old[match[i]] : null;
		const it: TodoItem = { level: p.level, text: p.text, status: p.status, started: o?.started ?? null, ended: o?.ended ?? null };
		if (o?.approx) it.approx = true;
		if (p.status === "todo") [it.started, it.ended, it.approx] = [null, null, undefined];
		if (p.status === "doing") [it.ended, it.started] = [null, it.started ?? now];
		return it;
	});
	const since = fresh ? now : (prev as TodoState).updated;
	for (let i = 0; i < items.length; i++) {
		if (lines[i].status !== "done") continue;
		endTodo(items[i], now, since);
		// 하위 단계가 있는 단계를 끝났다고 하면 아직 체크하지 않은 하위 단계도 끝난 것으로
		for (let j = i + 1; j < items.length && items[j].level > items[i].level; j++) if (items[j].status !== "done") endTodo(items[j], now, since);
	}
	for (const it of items) if (it.approx === undefined) delete it.approx;
	rollUp(items);
	return {
		v: 1,
		project: meta.project,
		cwd: meta.cwd,
		remote: meta.remote,
		source: meta.source || "todo",
		request: (fresh ? meta.request : prev?.request || meta.request) || "",
		created: fresh ? now : (prev as TodoState).created,
		updated: now,
		updates: fresh ? 1 : (prev as TodoState).updates + 1,
		items,
	};
}
/** 승인한 계획의 단계 -> 목록 (첫 단계는 하는 중) */
export const planTodo = (steps: string[], now: number, meta: TodoMeta): TodoState =>
	mergeTodo(null, steps.map((text, i) => ({ level: 0, text, status: i === 0 ? "doing" : "todo" })), now, { ...meta, source: "plan" });
/** 계획을 다듬어 다시 승인: 끝나지 않은 목록(prev)이 있으면 이어 붙임. 앞 목록에서 끝난 단계와 글이 같거나 (끝남) 을 붙인 단계는 끝남,
 *  남은 첫 단계가 하는 중. 같은 단계의 시작·끝 시각과 처음 요청은 이어 감 (겹치는 단계가 없으면 mergeTodo 가 새 목록으로) */
export function replanTodo(prev: TodoState | null, steps: string[], now: number, meta: TodoMeta): TodoState {
	const old = prev?.items.length && !todoSummary(prev).all ? prev : null;
	const key = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
	const doneOld = new Set((old?.items || []).filter((it) => it.level === 0 && it.status === "done").map((it) => key(it.text)));
	const lines: TodoLine[] = steps.map((s) => {
		const marked = s.endsWith(DONE_TAIL);
		const text = marked ? s.slice(0, -DONE_TAIL.length) : s;
		return { level: 0, text, status: marked || doneOld.has(key(text)) ? "done" : "todo" };
	});
	const first = lines.find((l) => l.status !== "done");
	if (first) first.status = "doing";
	return mergeTodo(old, lines, now, { ...meta, source: "plan" });
}
/** "[N단계 완료]": 맨 위 단계 N (과 그 하위 단계)을 끝내고 다음 단계를 하는 중으로. 바뀌었으면 true */
export function stepDone(s: TodoState, n: number, now: number): boolean {
	const tops = s.items.flatMap((it, i) => (it.level === 0 ? [i] : []));
	const i = tops[n - 1];
	if (i === undefined || s.items[i].status === "done") return false;
	const end = i + 1 + s.items.slice(i + 1).findIndex((it) => it.level === 0);
	for (let j = i; j < (end > i ? end : s.items.length); j++) if (s.items[j].status !== "done") endTodo(s.items[j], now, s.updated);
	const next = s.items[tops[n]];
	if (next && next.status === "todo" && !hasKids(s.items, tops[n])) [next.status, next.started] = ["doing", now];
	rollUp(s.items);
	[s.updated, s.updates, s.stopped] = [now, s.updates + 1, null];
	return true;
}
export function todoSummary(s: TodoState | null) {
	const items = s?.items || [];
	const no = todoNumbers(items);
	const leaves = items.flatMap((it, i) => (hasKids(items, i) ? [] : [[it, no[i]] as const]));
	const done = leaves.filter(([it]) => it.status === "done").length;
	const cur = leaves.find(([it]) => it.status === "doing");
	const starts = items.map((it) => it.started).filter((x): x is number => x !== null);
	const all = leaves.length > 0 && done === leaves.length;
	return {
		total: leaves.length,
		done,
		pct: leaves.length ? Math.round((done * 100) / leaves.length) : 0,
		current: cur ? `${cur[1]} ${cur[0].text}` : "",
		all,
		started: starts.length ? Math.min(...starts) : null,
		ended: all ? Math.max(...items.map((it) => it.ended ?? 0)) : null,
	};
}
/** 입력창 위 목록 (한 글로: pi 화면은 항목 10개까지만 보여 줌). 승인한 계획은 예전 모양 그대로 */
export function todoWidget(s: TodoState): string {
	const sum = todoSummary(s);
	const no = todoNumbers(s.items);
	const mark = (it: TodoItem) => (it.status === "done" ? "x" : it.status === "doing" ? "~" : " ");
	const stop = !sum.all && s.stopped ? " · 요청 끝 (남은 단계 있음)" : "";
	const head =
		s.source === "plan"
			? `── 계획 진행 ${sum.done}/${sum.total}${sum.all ? " · 모두 완료 (다음 요청 때 닫힘)" : stop} · 브라우저: /todo open ──`
			: `── 할 일 ${sum.done}/${sum.total} (${sum.pct}%)${sum.all ? " · 모두 끝남 (다음 요청 때 닫힘)" : stop} · 브라우저: /todo open ──`;
	const lines = s.items.map((it, i) => `${"   ".repeat(it.level)} [${mark(it)}] ${no[i]}${s.source === "plan" ? "." : ""} ${it.text}`);
	return [head, ...lines.slice(0, 12), ...(lines.length > 12 ? [`     … 외 ${lines.length - 12}개`] : [])].join("\n");
}

const agentDirOf = () => process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
export const todoDir = () => join(agentDirOf(), "todo");
/** 프로젝트마다 파일 이름: 작업 폴더의 끝 두 이름 + 경로의 짧은 해시 (이름이 같은 다른 폴더와 섞이지 않게). 노트북 폴더는 nb- */
export function todoKey(cwd: string, remote: boolean): string {
	const p = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	const ci = !remote && process.platform === "win32";
	const id = (remote ? "nb:" : "pc:") + (ci ? p.toLowerCase() : p);
	const name =
		p
			.split("/")
			.filter((x) => x && !/^[A-Za-z]:$/.test(x))
			.slice(-2)
			.join("-")
			.replace(/[^\p{L}\p{N}._-]+/gu, "_")
			.slice(0, 60) || "home";
	return `${remote ? "nb-" : ""}${name}-${createHash("sha256").update(id).digest("hex").slice(0, 8)}`;
}
const safeJson = (x: unknown) => JSON.stringify(x).replace(/</g, "\\u003c");
export const todoDataJs = (s: TodoState | null) => `window.__piTodoData && window.__piTodoData(${safeJson(s)});\n`;
/** 브라우저로 여는 쪽: 처음 그릴 목록을 담고, 3초마다 dataFile 을 <script> 로 다시 읽어 바뀌었으면 다시 그린다 (밖의 파일·서버를 쓰지 않음) */
export function todoHtml(s: TodoState | null, dataFile: string): string {
	return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>pi 할 일</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--fg:#1d2330;--mute:#6b7383;--line:#e3e6eb;--todo:#9aa3b2;--doing:#2f6fde;--done:#1f9d57;--warn:#b7791f}
@media (prefers-color-scheme:dark){:root{--bg:#14171c;--card:#1d2128;--fg:#e6e9ee;--mute:#98a1b1;--line:#2c323c;--todo:#6f7889;--doing:#6ea0ff;--done:#43c27f;--warn:#e0a84a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 "Segoe UI","Malgun Gothic",system-ui,sans-serif}
main{max-width:980px;margin:0 auto;padding:20px 16px 40px}h1{font-size:20px;margin:0 0 2px}.mute{color:var(--mute)}.small{font-size:13px}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0}
.bar{height:10px;border-radius:5px;background:var(--line);overflow:hidden;margin:8px 0}.bar i{display:block;height:100%;background:var(--done);width:0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:6px 16px}.grid b{display:block;font-size:12px;color:var(--mute);font-weight:400}
.lv{margin:4px 0 0}.lv button{border:1px solid var(--line);background:var(--card);color:var(--fg);border-radius:6px;padding:2px 10px;margin-right:4px;cursor:pointer}
.lv button.on{border-color:var(--doing);color:var(--doing)}
.row{display:flex;gap:10px;align-items:baseline;padding:7px 4px;border-top:1px solid var(--line)}.row:first-child{border-top:0}
.ic{width:1.2em;text-align:center;flex:none}.no{color:var(--mute);flex:none;min-width:2.6em}.tx{flex:1;min-width:0;overflow-wrap:anywhere}
.tm{flex:none;text-align:right;font-size:12.5px;color:var(--mute);white-space:nowrap}
.todo .ic{color:var(--todo)}.doing .ic,.doing .tx{color:var(--doing)}.doing .tx{font-weight:600}.done .ic{color:var(--done)}.done .tx{color:var(--mute)}
.kids{font-size:12px;color:var(--mute)}.warn{color:var(--warn)}.empty{padding:20px 4px;color:var(--mute)}
</style></head>
<body><main>
<h1 id="title">할 일</h1><div id="sub" class="mute small"></div>
<div class="card"><div id="head"></div><div class="bar"><i id="fill"></i></div><div class="grid" id="times"></div>
<div class="lv" id="lv"></div></div>
<div class="card" id="list"></div>
<div class="mute small" id="foot"></div>
</main>
<script>window.__PI_TODO_INIT = ${safeJson(s)};</script>
<script>
(function () {
  var FILE = ${JSON.stringify(dataFile)};
  var data = window.__PI_TODO_INIT, seen = Date.now(), fails = 0, depth = 99;
  try { depth = Number(localStorage.getItem("piTodoDepth")) || 99; } catch (e) {}
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function p2(n) { return (n < 10 ? "0" : "") + n; }
  function hms(t) { var d = new Date(t); return p2(d.getHours()) + ":" + p2(d.getMinutes()) + ":" + p2(d.getSeconds()); }
  function when(t) { if (!t) return "—"; var d = new Date(t); return (d.toDateString() === new Date().toDateString() ? "" : (d.getMonth() + 1) + "/" + d.getDate() + " ") + hms(t); }
  function dur(ms) { var s = Math.max(0, Math.round(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); s = s % 60; return h ? h + "시간 " + m + "분" : m ? m + "분 " + s + "초" : s + "초"; }
  function ago(t) { var s = Math.max(0, Math.round((Date.now() - t) / 1000)); return s < 60 ? s + "초 전" : s < 3600 ? Math.floor(s / 60) + "분 전" : Math.floor(s / 3600) + "시간 전"; }
  function nums(items) { var c = []; return items.map(function (it) { c.length = it.level + 1; c[it.level] = (c[it.level] || 0) + 1; return c.map(function (x) { return x || 1; }).join("."); }); }
  function kids(items, i) { return i + 1 < items.length && items[i + 1].level > items[i].level; }
  function sum(items) {
    var leaves = items.filter(function (it, i) { return !kids(items, i); }), done = leaves.filter(function (x) { return x.status === "done"; }).length;
    var starts = items.map(function (x) { return x.started; }).filter(function (x) { return x; });
    var all = leaves.length > 0 && done === leaves.length;
    return { total: leaves.length, done: done, pct: leaves.length ? Math.round(done * 100 / leaves.length) : 0, all: all,
      started: starts.length ? Math.min.apply(null, starts) : null, ended: all ? Math.max.apply(null, items.map(function (x) { return x.ended || 0; })) : null };
  }
  function render() {
    var d = data, items = (d && d.items) || [];
    if (!items.length) {
      $("title").textContent = "할 일"; document.title = "pi 할 일";
      $("sub").textContent = ""; $("head").textContent = "할 일 목록이 없습니다"; $("fill").style.width = "0"; $("times").innerHTML = ""; $("lv").innerHTML = "";
      $("list").innerHTML = '<div class="empty">pi 가 여러 단계 작업을 시작하면(todo 도구, 또는 /plan 으로 승인한 계획) 여기에 보입니다. 이 창은 열어 두면 3초마다 새로 읽습니다.</div>';
      return tick();
    }
    var s = sum(items), no = nums(items), max = Math.max.apply(null, items.map(function (x) { return x.level; }));
    var stopped = d.stopped && !s.all; // 목록이 다 끝나지 않은 채 요청이 끝남 (남은 단계를 pi 의 답에서 확인)
    $("title").textContent = "할 일 · " + d.project;
    document.title = (s.all ? "끝남 " : stopped ? "멈춤 " + s.pct + "% " : s.pct + "% ") + "· pi 할 일 · " + d.project;
    $("sub").textContent = (d.source === "plan" ? "승인한 계획" : "pi 가 만든 목록") + (d.request ? " · 요청: " + d.request : "") + " · " + d.cwd;
    $("head").innerHTML = "<b>" + (s.all ? "모두 끝남" : (stopped ? '<span class="warn">요청 끝남 · 남은 단계 있음</span> · ' : "") + "진행 " + s.pct + "%") +
      "</b> <span class=mute>· 끝남 " + s.done + " / " + s.total + "</span>";
    $("fill").style.width = s.pct + "%";
    $("times").innerHTML = "<div><b>시작</b>" + when(s.started || d.created) + "</div><div><b>끝</b>" + (s.ended ? when(s.ended) : stopped ? "요청 끝 " + when(d.stopped) : "진행 중") +
      "</div><div><b>걸린 시간</b><span id=el></span></div><div><b>마지막 갱신</b><span id=up></span></div>";
    var lv = "";
    if (max > 0) { [[1, "1단계만"], [2, "2단계까지"], [99, "모두"]].forEach(function (b) { if (b[0] <= max || b[0] === 99) lv += '<button data-d="' + b[0] + '" class="' + (depth === b[0] ? "on" : "") + '">' + b[1] + "</button>"; }); }
    $("lv").innerHTML = lv;
    var html = "";
    items.forEach(function (it, i) {
      if (it.level >= depth) return;
      var k = "";
      if (kids(items, i)) { var t = 0, dn = 0; for (var j = i + 1; j < items.length && items[j].level > it.level; j++) if (!kids(items, j)) { t++; if (items[j].status === "done") dn++; } k = ' <span class=kids>(' + dn + "/" + t + ")</span>"; }
      // 어림(~): 시작을 알리지 않고 끝난 단계는 앞 목록을 받은 때부터. 처음 목록에서 이미 끝난 단계는 걸린 시간을 모르므로 끝 시각만
      var tm = !it.started ? "" : it.approx && it.ended && it.ended - it.started < 1000 ? "끝 " + hms(it.ended)
        : (it.approx ? "~" : "") + hms(it.started) + " → " + (it.ended ? hms(it.ended) + " · " + dur(it.ended - it.started) : '<span class=live data-s="' + it.started + '"></span>');
      html += '<div class="row ' + it.status + '" style="padding-left:' + (4 + it.level * 24) + 'px"><span class=ic>' + (it.status === "done" ? "●" : it.status === "doing" ? "◐" : "○") +
        "</span><span class=no>" + no[i] + "</span><span class=tx>" + esc(it.text) + k + "</span><span class=tm>" + tm + "</span></div>";
    });
    $("list").innerHTML = html;
    tick();
  }
  function tick() {
    var d = data, items = (d && d.items) || [], s = sum(items), stop = d && !s.all && d.stopped;
    if ($("el")) $("el").textContent = s.started ? dur((s.ended || stop || Date.now()) - s.started) : "—";
    if ($("up") && d) { var stale = !s.all && !stop && Date.now() - d.updated > 10 * 60000; $("up").innerHTML = '<span class="' + (stale ? "warn" : "") + '">' + when(d.updated) + " (" + ago(d.updated) + ")</span>"; }
    var l = document.querySelectorAll(".live");
    for (var i = 0; i < l.length; i++) { var st = Number(l[i].getAttribute("data-s")); l[i].textContent = stop ? "하던 중 (요청 끝까지 " + dur(stop - st) + ")" : "하는 중 · " + dur(Date.now() - st); }
    $("foot").textContent = (fails > 2 ? "목록 파일(" + FILE + ")을 읽지 못하고 있습니다. " : "3초마다 새로 읽음 · ") + "파일: " + FILE + (d ? " · 갱신 " + d.updates + "번" : "");
  }
  document.addEventListener("click", function (e) { var b = e.target.closest && e.target.closest("button[data-d]"); if (!b) return; depth = Number(b.getAttribute("data-d")); try { localStorage.setItem("piTodoDepth", depth); } catch (x) {} render(); });
  window.__piTodoData = function (nd) { seen = Date.now(); fails = 0; if (JSON.stringify(nd) !== JSON.stringify(data)) { data = nd; render(); } };
  function poll() { var sc = document.createElement("script"); sc.src = FILE + "?r=" + Date.now(); sc.onload = function () { sc.remove(); }; sc.onerror = function () { fails++; sc.remove(); }; document.head.appendChild(sc); }
  render(); setInterval(poll, 3000); setInterval(tick, 1000);
})();
</script></body></html>
`;
}
function writeAtomic(file: string, text: string) {
	const tmp = `${file}.${process.pid}.tmp`;
	writeFileSync(tmp, text);
	try {
		renameSync(tmp, file);
	} catch {
		writeFileSync(file, text); // 다른 프로그램이 잡고 있으면 그냥 덮어씀
	}
}
/** 목록 파일 세 개 (상태 .json, 브라우저가 다시 읽는 .data.js, 여는 .html). 여는 파일의 경로를 돌려준다 */
export function saveTodo(s: TodoState | null, key: string): string {
	const dir = todoDir();
	mkdirSync(dir, { recursive: true });
	writeAtomic(join(dir, `${key}.json`), `${JSON.stringify(s, null, 1)}\n`);
	writeAtomic(join(dir, `${key}.data.js`), todoDataJs(s));
	writeAtomic(join(dir, `${key}.html`), todoHtml(s, `${key}.data.js`));
	return join(dir, `${key}.html`);
}
export function loadTodo(key: string): TodoState | null {
	try {
		const s = JSON.parse(readFileSync(join(todoDir(), `${key}.json`), "utf8"));
		return s && s.v === 1 && Array.isArray(s.items) ? s : null;
	} catch {
		return null;
	}
}
/** 기본 브라우저로 여는 명령 (Windows explorer, macOS open, 화면이 있는 Linux xdg-open). PI_TODO_OPEN=0 이면 열지 않음 (시험) */
export function openCmd(file: string, platform: string = process.platform, env: NodeJS.ProcessEnv = process.env): [string, string[]] | null {
	if (env.PI_TODO_OPEN === "0") return null;
	if (platform === "win32") return ["explorer.exe", [file]];
	if (platform === "darwin") return ["open", [file]];
	return env.DISPLAY || env.WAYLAND_DISPLAY ? ["xdg-open", [file]] : null;
}

export default function (pi: ExtensionAPI) {
	let mode: Mode = (globalThis as any).__piMode; // 확장을 다시 불러와도(/kit share 등) 모드 유지
	let before: Mode = "auto"; // /plan 으로 끌 때 돌아갈 모드
	let lastText = ""; // 이번 요청의 마지막 답 (계획인지 볼 때)
	let planDoc = ""; // 계획 모드에서 쓴 계획서 (도구가 받은 경로. 답에 단계가 없으면 이 파일의 단계로)
	let asking = false;
	let todo: TodoState | null = null; // 할 일 목록 (todo 도구 또는 승인한 계획). 끝난 목록은 다음 요청 때 화면에서 닫고, 파일에는 남김
	let lastReq = ""; // 사용자가 마지막으로 보낸 요청의 첫 줄 (목록 머리에)
	let saveWarned = false;
	let autoOpened = false;
	let sinceTodo = 0; // 목록을 고친 뒤 쓰인 다른 도구 수 (todoNudge)
	// /review: running 리뷰 요청 중, done 끝남 (다음 요청이 시작될 때 지움: 계획 모드의 '진행할까요?' 가 리뷰 답을 계획으로 보지 않게).
	//  prev: 리뷰 모델로 바꾸기 전의 모델 (바꾸지 않았으면 null), wantId: 리뷰에 쓴 모델 id, answer: 리뷰 답
	let review: { phase: "running" | "done"; prev: any; who: string; wantId: string; tools: number; statusUrl: string; answer: string } | null = null;

	const setMode = (ctx: any, m: Mode) => {
		if (m === "plan" && mode !== "plan") planDoc = ""; // 새 계획: 지난 계획서는 잊음
		mode = m;
		(globalThis as any).__piMode = m;
		if (!ctx?.hasUI) return;
		const fg = (c: string, s: string) => (ctx.ui.theme?.fg ? ctx.ui.theme.fg(c, s) : s);
		ctx.ui.setStatus("mode", m === "plan" ? fg("warning", "계획 모드 · 읽기와 계획서만 (/plan 끄기)") : m === "ask" ? fg("accent", "확인 모드 (/mode 바꾸기)") : undefined);
	};
	// 한 글로 넘김: pi 화면은 목록의 항목을 10개까지만 보여 주고 나머지는 "... (widget truncated)" 로 자름 (줄바꿈은 그대로 보임)
	const showSteps = (ctx: any) => {
		if (!ctx?.hasUI) return;
		ctx.ui.setWidget("pi-kit-plan", todo?.items.length ? [todoWidget(todo)] : undefined);
	};
	const todoWhere = () => {
		const w = workDir();
		const cwd = String(w.cwd || process.cwd());
		const name = cwd.replace(/\\/g, "/").replace(/\/+$/, "").split("/").filter(Boolean).slice(-2).join("/") || cwd;
		return { cwd, remote: !!w.remote, key: todoKey(cwd, !!w.remote), project: `${w.remote ? "노트북 " : ""}${name}` };
	};
	const todoFile = () => join(todoDir(), `${todoWhere().key}.html`);
	const saveNow = (ctx: any) => {
		try {
			return saveTodo(todo, todoWhere().key);
		} catch (e) {
			if (!saveWarned) ctx?.ui?.notify?.(`할 일 목록 파일을 쓰지 못했습니다: ${(e as Error).message}`, "warning");
			saveWarned = true;
			return "";
		}
	};
	const openTodo = (file: string): boolean => {
		const c = openCmd(file);
		if (!c) return false;
		try {
			const ch = spawn(c[0], c[1], { detached: true, stdio: "ignore" });
			ch.on("error", () => {});
			ch.unref();
			return true;
		} catch {
			return false;
		}
	};
	const setTodo = (ctx: any, next: TodoState | null) => {
		const fresh = !!next && next.updates === 1;
		todo = next;
		const file = saveNow(ctx);
		showSteps(ctx);
		// 내 설정 "todo_open": true 면 새 목록이 생길 때 (세션에 한 번) 브라우저로 연다
		if (fresh && file && ctx?.hasUI && !autoOpened && userConfig().todo_open === true) autoOpened = openTodo(file);
	};
	// /plan·/mode 는 목록을 닫지 않음: 진행하던 계획을 계획 모드에서 다듬으면 그 목록에 이어 붙임 (replanTodo). 끝난 목록은 다음 요청 때 닫힘.
	//  2026-11-04 전에는 승인한 계획의 목록을 닫아서, 다듬은 계획을 승인하면 끝난 단계까지 처음부터 다시 셈
	const openTodoOf = () => {
		const w = todoWhere();
		return todo?.items.length && !todoSummary(todo).all && todo.cwd === w.cwd && todo.remote === w.remote ? todo : null;
	};

	pi.on("session_start", async (_event: unknown, ctx: any) => {
		if (!(globalThis as any).__piModeStarted) {
			(globalThis as any).__piModeStarted = true;
			const want = NAMES[String(userConfig().default_mode || "").trim().toLowerCase()];
			if (want && ctx.hasUI) return setMode(ctx, want); // pi -p 처럼 물을 수 없는 실행은 늘 자동
		}
		setMode(ctx, mode);
		// 이 프로젝트의 끝나지 않은 목록은 이어서 (pi 를 다시 켜거나 /reload). 끝난 목록은 파일에만 남아 있음
		const saved = loadTodo(todoWhere().key);
		if (saved && !todoSummary(saved).all && saved.cwd === todoWhere().cwd) {
			todo = saved;
			showSteps(ctx);
		}
	});

	// 계획 모드: 요청 앞에 안내 (/ 로 시작하는 명령·템플릿은 그대로 두어야 펼쳐짐)
	pi.on("input", async (event: any, ctx: any) => {
		const text = String(event.text || "");
		if (text.startsWith("/")) return;
		if (event.source !== "extension" && text.trim()) lastReq = cut(text.trim().split("\n")[0], 100);
		if (event.source !== "extension" && todo && todoSummary(todo).all) {
			todo = null; // 끝난 목록은 화면에서 닫음 (브라우저 파일에는 남음: 다음 목록이 생길 때까지)
			showSteps(ctx);
		}
		if (mode !== "plan" || !text.trim() || review?.phase === "running") return; // 리뷰 요청에는 계획 안내를 붙이지 않음 (리뷰는 따로 읽기만)
		return transformInput(text, `${planNote(planDir())}${planNow(openTodoOf())}\n\n${text}`);
	});

	pi.on("tool_call", async (event: any, ctx: any) => {
		// 리뷰하는 동안: 읽기만, REVIEW_TOOLS_MAX 번까지 (고급 모델은 도구마다 질문 하나를 더 씀)
		if (review?.phase === "running") {
			const t = String(event.toolName || "");
			const ok = t === "bash" ? !readOnlyProblem(String(event.input?.command || "")) && !event.guardReason : READ_TOOLS.has(t) && t !== "ask_user";
			if (!ok) return { block: true, reason: "리뷰 중이라 파일을 바꾸거나 명령을 실행하지 않습니다. 고칠 것은 답에 적어 주세요 (리뷰가 끝나면 사용자가 고칠지 정합니다)." };
			if (++review.tools > REVIEW_TOOLS_MAX) return { block: true, reason: `리뷰에서 도구는 ${REVIEW_TOOLS_MAX}번까지입니다. 지금까지 본 것으로 답해 주세요.` };
			return;
		}
		if (mode === "auto") return;
		const tool = String(event.toolName || "");
		const input = event.input || {};
		const guardWhy: string | undefined = event.guardReason;
		const problem = tool === "bash" ? readOnlyProblem(String(input.command || "")) : null;
		if (mode === "plan") {
			if ((READ_TOOLS.has(tool) || tool === "todo") && !guardWhy) return; // 할 일 목록은 작업 폴더를 바꾸지 않음
			if (tool === "bash" && !problem && !guardWhy) return;
			const dir = planDir();
			if ((tool === "write" || tool === "edit") && !guardWhy && isPlanDoc(projectRel(input.path, workDir()), dir)) {
				planDoc = String(input.path);
				return;
			}
			const why =
				tool === "bash"
					? `읽기 전용 명령만 실행합니다 (막은 부분: ${problem || guardWhy})`
					: tool === "write" || tool === "edit"
						? `파일을 바꾸지 않았습니다 (계획서는 ${dir}/ 아래의 .md 나 이름에 '계획'·plan 이 든 .md 로만 쓸 수 있음)`
						: `${tool} 도구는 쓰지 않습니다`;
			return { block: true, reason: `계획 모드라서 ${why}. 바꾸거나 실행해야 하는 일은 계획의 단계로 적어 주세요. 사용자가 계획을 승인하면 그때 진행합니다.` };
		}
		// 확인 모드
		if (tool !== "write" && tool !== "edit" && tool !== "bash") return;
		if (tool === "bash" && !problem && !guardWhy) return; // 읽기만 하는 명령은 묻지 않음
		const { title, body } = await preview(tool, input);
		if (!ctx.hasUI) {
			return { block: true, reason: `확인 모드인데 물어볼 수 없는 실행 방식이라 실행하지 않았습니다 (${title}). 사용자에게 직접 하도록 부탁하세요.` };
		}
		const ok = await ctx.ui.confirm(title, `${body.slice(0, 2500)}\n\n${guardWhy ? `주의: ${guardWhy}\n` : ""}진행할까요? (확인 모드 · /mode 로 바꾸기)`);
		if (ok) return;
		return {
			block: true,
			terminate: true,
			reason: "사용자가 이 작업을 거절했습니다. 같은 작업을 다시 요청하지 말고, 다른 방법을 쓰거나 사용자에게 어떻게 할지 물어보세요.",
		};
	});

	// 모델이 만든 목록을 작업 중에 고치지 않으면 결과에 안내 (질문을 더 쓰지 않음: 이미 가는 결과에 붙고, todo 는 다음 블록과 함께 돎)
	pi.on("tool_result", async (event: any) => {
		// 승인한 계획의 목록에도 (2026-11-04 실제 Copilot: "[N단계 완료]" 는 마지막 답에 한꺼번에 적어 진행 중에는 0/8 그대로)
		if (event.toolName === "todo" || review?.phase === "running" || !todo?.items.length || todoSummary(todo).all || mode === "plan") return;
		sinceTodo++;
		if (sinceTodo !== TODO_NUDGE_AT && sinceTodo !== TODO_NUDGE_AGAIN) return;
		const plan = todo.source === "plan" ? todo.items.filter((it) => it.level === 0).length : 0;
		return { content: [...(Array.isArray(event.content) ? event.content : []), { type: "text", text: todoNudge(todoSummary(todo).current, plan) }] };
	});

	// 요청이 끝났는데 목록이 다 끝나지 않았으면 그 시각을 적음 (브라우저가 '진행 중' 으로 시간을 계속 세지 않게). 다음 요청이 시작되면 지움
	pi.on("agent_end", async (_event: unknown, ctx: any) => {
		if (!todo?.items.length || todoSummary(todo).all || review) return;
		todo.stopped = Date.now();
		saveNow(ctx);
		showSteps(ctx);
	});

	pi.on("agent_start", async (_event: unknown, ctx: any) => {
		if (todo?.stopped) {
			todo.stopped = null;
			saveNow(ctx);
			showSteps(ctx);
		}
		sinceTodo = 0;
		lastText = "";
		if (review?.phase === "done") review = null;
		if (!review) (globalThis as any).__piReview = undefined;
	});

	// 리뷰 요청이 끝나면 바로 원래 모델로 (그사이 사용자가 넣어 둔 다음 요청이 리뷰 모델로 돌지 않게). Esc·오류로 끝나도.
	//  오류 뒤 pi 의 자동 다시 시도는 키트 설정에서 꺼 둠 (settings.json retry.enabled false. 확장은 다시 시도할지 알 수 없음).
	//  __piReview 는 다음 요청이 시작될 때 지움: 확장마다 불러오는 순서가 달라도(리눅스는 폴더 순서) 이 요청의 끝 처리에서 리뷰였음을 봄
	pi.on("agent_end", async (event: any, ctx: any) => {
		if (review?.phase !== "running") return;
		const r = review;
		r.phase = "done";
		(globalThis as any).__piReview = "done";
		const msgs: any[] = event?.messages || [];
		const last = [...msgs].reverse().find((m) => m?.role === "assistant");
		r.answer = last && last.stopReason !== "aborted" && last.stopReason !== "error" ? textOf(last) : "";
		// 오류 글: 중계 서버의 오류는 '429: {"message":"…"}' 모양이라 message 만
		const err = String(last?.errorMessage || "오류");
		const why = last?.stopReason === "error" ? `: ${(err.match(/"message"\s*:\s*"((?:[^"\\]|\\.)+)"/)?.[1] || err.split("\n")[0]).slice(0, 160)}` : last?.stopReason === "aborted" ? " (멈춤)" : "";
		if (r.prev) {
			try {
				const ok = await (pi as any).setModel(r.prev);
				if (ok === false) ctx.ui?.notify?.(`원래 모델(${r.prev.id})로 돌아가지 못했습니다. /model 로 골라 주세요`, "warning");
			} catch (e) {
				ctx.ui?.notify?.(`원래 모델(${r.prev.id})로 돌아가지 못했습니다: ${(e as Error).message}`, "warning");
			}
		}
		// Copilot·사내AI: 중계 서버가 리뷰 모델을 실제로 골랐는지 (메뉴에 없거나 꺼져 있으면 지금 모델로 답함)
		if (r.statusUrl) {
			try {
				const st: any = await (await fetch(r.statusUrl, { signal: AbortSignal.timeout(3000) })).json();
				if (st?.model_id === r.wantId && st.model_ok === false) {
					r.who = `${r.who} 대신 그때의 모델`; // '고칠까요?'·'문제 없음' 에 리뷰한 모델을 바로 적음
					ctx.ui?.notify?.(
						`리뷰 모델 '${st.model || r.wantId}' 을(를) Copilot 메뉴에서 고르지 못해 그때의 모델로 리뷰했습니다 (메뉴에 없거나 사용량 한도로 보임, 추측). 리뷰 결과를 그 점을 감안해 보세요`,
						"warning",
					);
				}
			} catch {}
		}
		// 사용량 제한이어도 리뷰는 자동으로 다시 하지 않음 (copilot-session.ts 가 __piReview 를 보고 건너뜀)
		if (!r.answer) ctx.ui?.notify?.(`리뷰가 끝까지 되지 않았습니다${why}${r.prev ? ` (원래 모델 ${r.prev.id} 로 돌아옴)` : ""}. 다시 하려면 /review`, "warning");
	});

	pi.on("message_end", async (event: any, ctx: any) => {
		const m = event.message;
		if (m?.role !== "assistant") return;
		const text = textOf(m);
		lastText = m.stopReason === "aborted" || m.stopReason === "error" ? "" : text;
		if (!todo?.items.length || !text) return;
		let changed = false;
		const now = Date.now();
		for (const x of text.matchAll(/(\d{1,2})\s*단계\s*(?:완료|끝)/g)) if (stepDone(todo, Number(x[1]), now)) changed = true;
		if (changed) {
			setTodo(ctx, todo);
			sinceTodo = 0;
		}
	});

	/** 승인한 계획을 진행할 모델로 바꾼다 (고급 모델로 계획했으면 기본 모델로). 같은 대화에서 모델만 바뀌므로 계획은 그대로 이어 봄.
	 *  같은 제공자 안에서만 바꾼다 (사내AI 로 계획했는데 기본 모델이 Copilot 이면 그대로: 대화가 다른 중계 서버로 넘어감). provider/id 로 적었으면 그대로 */
	async function toExecuteModel(ctx: any) {
		const want = executeModel();
		const cur = ctx.model;
		if (!want || !cur || (cur.provider === want.provider && cur.id === want.id) || typeof (pi as any).setModel !== "function") return;
		if (!want.explicit && cur.provider !== want.provider) return;
		const m = ctx.modelRegistry?.find?.(want.provider, want.id);
		if (!m) return ctx.ui.notify(`계획을 진행할 모델 ${want.provider}/${want.id} 을(를) 모델 목록에서 찾지 못해 지금 모델(${cur.id})로 진행합니다`, "warning");
		try {
			// setModel 은 인증이 없으면 오류 대신 false 를 돌려줌 (릴리스 전 검토: 그때도 '진행은 … 로' 라고 알렸음)
			const ok = await (pi as any).setModel(m);
			if (ok === false) return ctx.ui.notify(`진행할 모델(${want.id})로 바꾸지 못해 지금 모델(${cur.id})로 진행합니다 (그 모델의 로그인·인증을 확인하세요)`, "warning");
			ctx.ui.notify(`계획은 ${cur.id} 로 세웠고, 진행은 ${want.id} 로 합니다 (바꾸지 않으려면 내 설정 파일에 "plan_execute_model": "same")`, "info");
		} catch (e) {
			ctx.ui.notify(`진행할 모델(${want.id})로 바꾸지 못해 지금 모델(${cur.id})로 진행합니다: ${(e as Error).message}`, "warning");
		}
	}

	// 계획이 오면 진행할지 묻는다 (기다리지 않고 따로: 다른 확장의 '끝남' 알림이 늦어지지 않게.
	//  계획서 읽기도 따로: jupyter 모드에서는 노트북을 거쳐 오래 걸릴 수 있고, 그동안 pi 는 새 입력을 미룸)
	pi.on("agent_settled", async (_event: unknown, ctx: any) => {
		if (mode !== "plan" || asking || !ctx.hasUI || review) return; // 리뷰 답(번호 목록)은 계획이 아님
		const picked = planSteps(lastText);
		const fromAnswer = replanSteps(lastText, openTodoOf(), picked) || picked;
		const doc0 = planDoc;
		if (fromAnswer.length < 2 && !doc0) return;
		asking = true;
		setTimeout(async () => {
			try {
				let found = fromAnswer;
				let doc = fromAnswer.length >= 2 ? doc0 : "";
				const old = openTodoOf();
				// 계획을 계획서로만 남기고 답에는 '계획서를 썼다' 만 적은 경우, 또는 진행하던 계획을 계획서에서 다듬고 답에는 바뀐 점만 번호로 적은 경우
				//  (계획서 쪽이 진행하던 목록과 겹치는 단계가 더 많으면 계획서로). 30초 넘게 걸리면 보지 않음
				if (doc0 && (found.length < 2 || old)) {
					try {
						let timer: any;
						const b = await Promise.race([readTarget(target(doc0)), new Promise<null>((ok) => (timer = setTimeout(() => ok(null), 30000)))]).finally(() => clearTimeout(timer));
						const docText = b ? b.toString("utf8") : "";
						const fromDoc0 = planSteps(docText);
						const fromDoc = replanSteps(docText, old, fromDoc0) || fromDoc0;
						if (fromDoc.length >= 2 && (found.length < 2 || replanScore(fromDoc, old) > replanScore(found, old))) [found, doc] = [fromDoc, doc0];
					} catch {}
				}
				if (found.length < 2) return;
				// 진행하던 목록이 있으면 (계획을 다듬음) 이어 붙인 모양을 미리 보고, 단계 수가 바뀌는 것을 묻는 창에 적음
				const w = todoWhere();
				const meta = { project: w.project, cwd: w.cwd, remote: w.remote, request: lastReq };
				const oldN = old ? old.items.filter((it) => it.level === 0).length : 0;
				const nDone = replanTodo(old, found, Date.now(), meta).items.filter((it) => it.status === "done").length;
				const pick = await ctx.ui.select(
					`이 계획대로 진행할까요? (${found.length}단계${nDone ? `, 그중 ${nDone}단계는 끝남` : ""}${old ? ` · 지금 목록 ${oldN}단계를 이 계획으로 바꿈` : ""})`,
					CHOICES.map((c) => c[0]),
				);
				const next = CHOICES.find((c) => c[0] === pick)?.[1];
				if (!next || mode !== "plan") {
					if (mode === "plan") ctx.ui.notify("계획 모드를 유지합니다. 고칠 점을 적어 보내세요 (/plan 으로 끄기)", "info");
					return;
				}
				setMode(ctx, next);
				setTodo(ctx, replanTodo(openTodoOf(), found, Date.now(), meta));
				const done = (todo?.items || []).flatMap((it, i) => (it.status === "done" ? [i + 1] : []));
				planDoc = "";
				await toExecuteModel(ctx);
				pi.sendUserMessage(userAsk(proceedText(found.length, next, doc, done), `(계획대로 진행, ${found.length}단계)`));
			} catch (e) {
				// 여기서 던지면 처리되지 않은 오류로 pi 가 꺼질 수 있음
				try {
					ctx.ui.notify(`계획 진행을 묻지 못했습니다: ${(e as Error).message}`, "warning");
				} catch {}
			} finally {
				asking = false;
			}
		}, 0);
	});
	// 리뷰가 끝나 쉬면: 찾은 것이 있으면 고칠지 묻는다 (다른 확장의 '끝남' 처리가 늦어지지 않게 따로. 계획 모드의 위 처리는 review 가 있으면 건너뜀)
	pi.on("agent_settled", async (_event: unknown, ctx: any) => {
		const r = review;
		if (r?.phase !== "done" || !r.answer || !ctx.hasUI) return;
		const answer = r.answer;
		r.answer = ""; // 한 번만
		if (reviewClean(answer)) return ctx.ui.notify(`리뷰(${r.who}): 문제 없음${r.prev ? ` · 원래 모델 ${r.prev.id} 로 돌아왔습니다` : ""}`, "info");
		setTimeout(async () => {
			try {
				const now = ctx.model?.id || "지금 모델";
				const pick = await ctx.ui.select(`리뷰(${r.who})에서 찾은 것을 고칠까요?`, [`고치기 (${now} 로)`, "그대로 두기 (나중에 직접)"]);
				if (typeof pick === "string" && pick.startsWith("고치기")) pi.sendUserMessage(userAsk(REVIEW_FIX, "(리뷰대로 고치기)"));
			} catch {}
		}, 0);
	});

	pi.registerCommand("plan", {
		description: "계획 모드 켜기·끄기 (켜면 파일을 바꾸지 않고 계획부터, 승인하면 진행). /plan <요청> 은 계획 모드로 바로 요청",
		handler: async (args, ctx) => {
			const req = String(args || "").trim();
			if (mode === "plan" && !req) {
				setMode(ctx, before === "plan" ? "auto" : before);
				return ctx.ui.notify(`계획 모드를 껐습니다 (지금: ${LABEL[mode]} 모드)`, "info");
			}
			if (mode !== "plan") {
				before = mode;
				setMode(ctx, "plan");
				if (!req) ctx.ui.notify("계획 모드: 파일을 바꾸지 않고 계획부터 세웁니다. 요청을 적어 보내세요 (/plan 으로 끄기)", "info");
			}
			if (!req) return;
			// / 로 시작하는 명령·템플릿은 대신 보내면 펼쳐지지 않고 계획 안내도 붙지 않음: 사용자가 직접 입력하게
			if (req.startsWith("/")) return ctx.ui.notify(`계획 모드입니다. / 로 시작하는 명령은 대신 보낼 수 없으니 지금 직접 입력해 주세요: ${req}`, "info");
			// 다른 작업 중이면 그 작업이 끝난 뒤 보내지도록 줄 세움 (그냥 보내면 "이미 처리 중" 오류로 요청이 사라짐. 쉬고 있으면 바로 보냄)
			if (!ctx.isIdle()) ctx.ui.notify("지금 작업이 끝나면 이 요청을 계획 모드로 이어서 보냅니다", "info");
			setTimeout(() => pi.sendUserMessage(userAsk(req), { deliverAs: "followUp" }), 0);
		},
	});

	pi.registerTool({
		name: "todo",
		label: "할 일 목록",
		description:
			"지금 작업의 할 일 목록을 만들거나 고친다 (사용자가 입력창 위와 브라우저에서 진행을 본다). text 에 목록 전체를 한 줄에 하나씩: " +
			"'- [ ] 할 일', '- [~] 하는 중', '- [x] 끝남', 하위 단계는 두 칸 들여 쓴다. 고칠 때도 목록 전체를 다시 보낸다 (시작·끝 시각은 pi 가 적음)",
		promptSnippet: "여러 단계 작업의 할 일 목록(단계·하위 단계와 진행 상태)을 만들고 고치기",
		promptGuidelines: [TODO_GUIDE],
		parameters: Type.Object({ text: Type.String({ description: "할 일 목록 전체 ('- [ ] …' 한 줄에 하나, 하위 단계는 두 칸 들여 씀)" }) }),
		async execute(_id: string, params: any, _signal: AbortSignal | undefined, _onUpdate: unknown, ctx: any) {
			const reply = (text: string) => ({ content: [{ type: "text" as const, text }], details: undefined });
			// 계획 모드에서는 목록을 바꾸지 않음 (2026-11-04: 진행하던 8단계 계획을 다듬는 동안 모델이 '끝난 두 단계 + 계획 보완' 3줄을 보내면
			//  목록이 그것으로 바뀜). 승인한 계획이 목록이 됨
			if (mode === "plan") return reply(TODO_PLAN_MODE);
			let lines = parseTodo(params?.text);
			if (!lines.length) return reply(TODO_HELP);
			const w = todoWhere();
			const prev = todo && todo.cwd === w.cwd && todo.remote === w.remote ? todo : null;
			// 진행 중인 승인한 계획: 같은 단계 수일 때만 진행을 받고 글은 계획대로 (다르면 그대로 두고 고치는 법을 알림)
			const plan = prev?.source === "plan" && !todoSummary(prev).all ? prev : null;
			if (plan) {
				const fit = fitPlan(plan, lines);
				if (!fit) return reply(todoPlanKeep(plan.items.filter((it) => it.level === 0).length));
				lines = fit;
			}
			setTodo(ctx, mergeTodo(prev, lines, Date.now(), { project: w.project, cwd: w.cwd, remote: w.remote, request: lastReq, ...(plan ? { source: "plan" as const } : {}) }));
			sinceTodo = 0;
			const s = todoSummary(todo);
			return reply(`할 일 목록을 고쳤습니다 (끝남 ${s.done}/${s.total}${s.current ? `, 하는 중: ${s.current}` : ""})`);
		},
	});

	pi.registerCommand("todo", {
		description: "할 일 목록 (pi 가 todo 도구나 승인한 계획으로 만든 것): 요약 · /todo open 브라우저로 보기 · /todo clear 지우기",
		handler: async (args, ctx) => {
			const sub = String(args || "").trim().toLowerCase();
			if (sub === "clear" || sub === "지우기") {
				todo = null;
				saveNow(ctx);
				showSteps(ctx);
				return ctx.ui.notify("할 일 목록을 지웠습니다", "info");
			}
			if (sub === "open" || sub === "열기") {
				const file = existsSync(todoFile()) ? todoFile() : saveNow(ctx) || todoFile();
				return openTodo(file)
					? ctx.ui.notify(`브라우저로 엽니다 (창을 열어 두면 3초마다 새로 읽음): ${file}`, "info")
					: ctx.ui.notify(`여기서는 브라우저를 열 수 없습니다. 이 파일을 브라우저로 여세요: ${file}`, "warning");
			}
			if (sub) return ctx.ui.notify("사용법: /todo (요약) · /todo open (브라우저로 보기) · /todo clear (지우기)", "warning");
			showSteps(ctx);
			const s = todoSummary(todo);
			ctx.ui.notify(
				todo?.items.length
					? `할 일: 끝남 ${s.done}/${s.total} (${s.pct}%)${s.current ? ` · 하는 중: ${s.current}` : ""}\n브라우저로 보기: /todo open (${todoFile()})`
					: `할 일 목록이 없습니다. pi 가 여러 단계 작업을 시작하거나 승인한 계획을 진행하면 생깁니다 (브라우저 파일: ${todoFile()})`,
				"info",
			);
		},
	});

	pi.registerCommand("mode", {
		description: "작업 모드: 계획(읽기만, 계획 후 승인) · 확인(바꿀 때마다 확인) · 자동(묻지 않음). /mode ask 처럼 바로 바꾸기",
		handler: async (args, ctx) => {
			const arg = String(args || "").trim().toLowerCase();
			let want: Mode | undefined = NAMES[arg];
			if (arg && !want) return ctx.ui.notify(`모드 이름: plan(계획) · ask(확인) · auto(자동)`, "warning");
			if (!want) {
				const opts: [string, Mode][] = [
					["계획: 읽기만 하고 계획부터 (승인하면 진행)", "plan"],
					["확인: 파일을 바꾸거나 명령을 실행할 때마다 확인", "ask"],
					["자동: 묻지 않고 실행 (위험한 명령만 확인)", "auto"],
				];
				const pick = await ctx.ui.select(`작업 모드 (지금: ${LABEL[mode]})`, opts.map((o) => o[0]));
				want = opts.find((o) => o[0] === pick)?.[1];
				if (!want) return;
			}
			if (want === "plan" && mode !== "plan") before = mode;
			setMode(ctx, want);
			ctx.ui.notify(`${LABEL[want]} 모드${want === "plan" ? ": 파일을 바꾸지 않고 계획부터 세웁니다" : want === "ask" ? ": 바꾸기 전에 내용을 보여 주고 묻습니다" : ": 묻지 않고 실행합니다 (위험한 명령만 확인)"}`, "info");
		},
	});

	pi.registerCommand("review", {
		description:
			"리뷰: 바뀐 내용(git diff)을 모아 리뷰 모델(내 설정 review_model)로 한 번 검토하고, 원래 모델로 돌아와 고칠지 묻기. /review <볼 점>",
		handler: async (args, ctx) => {
			if (!ctx.isIdle()) return ctx.ui.notify("pi 가 일하는 중입니다. 지금 요청이 끝난 뒤 다시 /review 해 주세요", "warning");
			if (review?.phase === "running") return ctx.ui.notify("리뷰가 이미 진행 중입니다", "info");
			const focus = String(args || "").trim();
			// 바뀐 내용을 먼저 모은다 (모델을 바꾸기 전에: 여기서 실패해도 모델은 그대로)
			ctx.ui.notify("리뷰할 바뀐 내용을 모으는 중입니다...", "info");
			let out = "@@REVIEW nogit\n";
			try {
				out = (await runHere(REVIEW_SCAN, workDir(), 60000)).out;
			} catch {}
			const scan = parseReviewScan(out);
			const cur = ctx.model;
			let use = cur;
			let prev: any = null;
			const want = reviewModel(cur);
			if (want && !(cur?.provider === want.provider && cur?.id === want.id)) {
				const m = ctx.modelRegistry?.find?.(want.provider, want.id);
				if (!m) ctx.ui.notify(`리뷰 모델 ${want.provider}/${want.id} 을(를) 모델 목록에서 찾지 못해 지금 모델(${cur?.id})로 리뷰합니다 (내 설정 파일의 review_model 확인)`, "warning");
				else {
					try {
						const ok = await (pi as any).setModel(m);
						if (ok === false) ctx.ui.notify(`리뷰 모델(${want.id})로 바꾸지 못해 지금 모델(${cur?.id})로 리뷰합니다 (그 모델의 로그인·인증 확인)`, "warning");
						else [use, prev] = [m, cur];
					} catch (e) {
						ctx.ui.notify(`리뷰 모델(${want.id})로 바꾸지 못해 지금 모델(${cur?.id})로 리뷰합니다: ${(e as Error).message}`, "warning");
					}
				}
			}
			const who = String(use?.name || use?.id || "지금 모델");
			// 중계 서버(이 PC 의 127.0.0.1)면 리뷰 뒤 /status 로 그 모델을 실제로 골랐는지 본다 (API 키트의 vLLM 등은 보지 않음)
			let statusUrl = "";
			try {
				const u = new URL(String(use?.baseUrl || ""));
				if (/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) statusUrl = `${u.origin}/status?session=${encodeURIComponent(SESSION)}`;
			} catch {}
			review = { phase: "running", prev, who, wantId: String(use?.id || ""), tools: 0, statusUrl, answer: "" };
			// 다른 확장도 리뷰 중임을 봄: guard·hooks 는 묻지 않고(막는 것은 여기서), 완료 점검·사용량 제한 뒤 자동 다시 시도는 하지 않음
			(globalThis as any).__piReview = "running";
			ctx.ui.notify(`${who} 로 리뷰합니다${prev ? ` (끝나면 ${prev.id} 로 돌아옵니다)` : ""}. 리뷰하는 동안은 파일을 바꾸지 않습니다`, "info");
			pi.sendUserMessage(userAsk(reviewPrompt(scan, who, focus), `(리뷰: ${who}${focus ? ` · ${focus}` : ""})`));
		},
	});
}
