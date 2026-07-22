// 행동 eval 러너 (opt-in, 실제 LLM 실행) — `claude -p`로 시나리오를 headless 실행하고
// 출력이 기대 패턴을 만족하는지 검사한다. claude CLI가 있어야 동작(없으면 안내 후 종료).
//
// 실행: node evals/run.mjs           (전체)
//       node evals/run.mjs tdd-driver (라벨 필터)
//
// 비결정적이라 CI 게이트가 아니라 "정기 품질 점검"용. 정적 계약은 test/agent-contract.test.mjs.
import { execFileSync } from 'node:child_process';

const SCENARIOS = [
  {
    label: 'tdd-driver',
    prompt: 'devkit tdd-driver 에이전트로 sum(a,b) 함수를 TDD로 구현해줘. 테스트부터.',
    expect: [/test|테스트/i, /red|실패/i, /green|통과/i],
  },
  {
    label: 'code-reviewer',
    prompt: '아래 diff를 devkit code-reviewer로 리뷰해줘:\n```\n+ const x: any = 1;\n+ try { f() } catch (e) {}\n```',
    expect: [/any/i, /catch|swallow/i, /:\d+|line/i],
  },
];

function hasClaude() {
  try { execFileSync('claude', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

if (!hasClaude()) {
  console.log('claude CLI가 없어 행동 eval을 건너뜁니다. 정적 계약은 `node --test`로 확인하세요.');
  process.exit(0);
}

const filter = process.argv[2];
const targets = filter ? SCENARIOS.filter((s) => s.label === filter) : SCENARIOS;
let pass = 0;

for (const s of targets) {
  process.stdout.write(`▶ ${s.label} ... `);
  let out = '';
  try {
    out = execFileSync('claude', ['-p', s.prompt], { encoding: 'utf8', timeout: 180000 });
  } catch (e) {
    console.log(`실행 실패: ${e.message}`);
    continue;
  }
  const missing = s.expect.filter((re) => !re.test(out));
  if (missing.length === 0) { console.log('PASS'); pass++; }
  else console.log(`FAIL (누락: ${missing.map(String).join(', ')})`);
}

console.log(`\n${pass}/${targets.length} 통과`);
process.exit(pass === targets.length ? 0 : 1);
