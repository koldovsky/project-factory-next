import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildAgentEnvironment, buildAgentInvocation, runAgent, runBoundedProcess } from '../src/adapters.mjs';

const candidateDir = process.cwd();
const options = { adapter: 'codex', candidateDir, prompt: 'Implement the approved task.' };

test('Codex uses a bounded workspace and stdin, preserving configured model selection', () => {
  const invocation = buildAgentInvocation(options);
  assert.deepEqual(invocation.args.slice(0, 5), ['exec', '--sandbox', 'workspace-write', '--config', 'approval_policy="never"']);
  assert.equal(invocation.args.at(-1), '-');
  assert.ok(invocation.args.includes('sandbox_workspace_write.network_access=false'));
  assert.ok(!invocation.args.includes('--model'));
  assert.ok(!invocation.args.includes(options.prompt));
  assert.equal(invocation.stdin, options.prompt);
  assert.ok(!invocation.args.some(arg => /danger|bypass|full-auto/.test(arg)));
});

test('Claude restricts tools and provides a supported dollar budget', () => {
  const invocation = buildAgentInvocation({ ...options, adapter: 'claude', model: 'configured-model', maxBudgetUsd: 2.5 });
  assert.ok(invocation.args.includes('--restricted'));
  assert.ok(invocation.args.includes('--strict-mcp-config'));
  assert.equal(invocation.args[invocation.args.indexOf('--tools') + 1], 'Read,Edit,Write,Glob,Grep');
  assert.equal(invocation.args[invocation.args.indexOf('--permission-prompts') + 1], 'none');
  assert.equal(invocation.args[invocation.args.indexOf('--max-budget-usd') + 1], '2.5');
  assert.equal(invocation.args[invocation.args.indexOf('--model') + 1], 'configured-model');
  assert.ok(!invocation.args.some(arg => /bypass|dangerously/.test(arg)));
});

test('invalid budgets, directories and shell wrappers fail before spawning', () => {
  for (const value of [0, -1, NaN, Infinity, '5']) {
    assert.throws(() => buildAgentInvocation({ ...options, adapter: 'claude', maxBudgetUsd: value }), /maxBudgetUsd/);
  }
  assert.throws(() => buildAgentInvocation({ ...options, maxBudgetUsd: 5 }), /external budget controller/);
  assert.throws(() => buildAgentInvocation({ ...options, candidateDir: './candidate' }), /absolute/);
  assert.throws(() => buildAgentInvocation({ ...options, executable: 'codex.cmd' }), /native executable/);
  assert.throws(() => buildAgentInvocation({ ...options, timeoutMs: '500' }), /timeoutMs/);
  assert.throws(() => buildAgentInvocation({ ...options, prompt: '' }), /prompt/);
});

test('default runtime environment excludes signing, GitHub and loader credentials', () => {
  const source = { Path: 'trusted-path', HOME: 'home', OPENAI_API_KEY: 'openai', ANTHROPIC_API_KEY: 'anthropic',
    FACTORY_SIGNING_KEY: 'secret', GITHUB_TOKEN: 'secret', NODE_OPTIONS: '--require malicious.cjs', CODEX_HOME: 'codex-home' };
  assert.deepEqual(buildAgentEnvironment('codex', source), {
    Path: 'trusted-path', HOME: 'home', OPENAI_API_KEY: 'openai', CODEX_HOME: 'codex-home',
  });
  assert.equal(buildAgentEnvironment('claude', source).ANTHROPIC_API_KEY, 'anthropic');
  assert.equal(buildAgentEnvironment('claude', source).OPENAI_API_KEY, undefined);
});

test('native process receives metacharacters and prompt bytes literally', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'factory-adapter-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, 'argv-fixture.mjs');
  await writeFile(script, `let input = ''; process.stdin.setEncoding('utf8');
    process.stdin.on('data', x => input += x);
    process.stdin.on('end', () => process.stdout.write(JSON.stringify({args: process.argv.slice(2), input, cwd: process.cwd()})));`);
  const prompt = 'Literal & echo SHOULD_NOT_RUN | $(whoami) "quoted"\nsecond line';
  const invocation = buildAgentInvocation({ ...options, candidateDir: directory, model: 'model & "quoted"', prompt });
  const result = await runBoundedProcess({ ...invocation, command: process.execPath,
    args: [script, ...invocation.args], cwd: directory, timeoutMs: 5000 });
  assert.equal(result.status, 'completed');
  assert.equal(result.exitCode, 0);
  assert.deepEqual(JSON.parse(result.stdout), { args: invocation.args, input: prompt, cwd: directory });
});

test('timeout stops an unfinished child and returns failure metadata', async () => {
  const result = await runBoundedProcess({ command: process.execPath,
    args: ['-e', 'setInterval(() => {}, 1000)'], timeoutMs: 150 });
  assert.equal(result.status, 'timeout');
  assert.notEqual(result.exitCode, 0);
  assert.ok(result.durationMs < 4500);
});

test('nonzero exit and stderr remain visible', async () => {
  const result = await runBoundedProcess({ command: process.execPath,
    args: ['-e', 'process.stderr.write("fixture failure"); process.exit(7)'], timeoutMs: 5000 });
  assert.equal(result.status, 'failed');
  assert.equal(result.exitCode, 7);
  assert.equal(result.stderr, 'fixture failure');
});

test('aggregate stdout and stderr are bounded; excess output cannot count as success', async () => {
  const result = await runBoundedProcess({ command: process.execPath,
    args: ['-e', 'process.stdout.write("x".repeat(4096)); process.stderr.write("y".repeat(4096))'],
    timeoutMs: 5000, maxOutputBytes: 1024 });
  assert.equal(result.status, 'output-limit');
  assert.equal(result.truncated, true);
  assert.ok(result.outputBytes > 1024);
  assert.ok(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) <= 1024);
});

test('missing native runtime is an actionable result, without invoking a model', async () => {
  const result = await runAgent({ ...options,
    executable: join(candidateDir, 'definitely-not-installed-factory-agent.exe'), timeoutMs: 5000 });
  assert.equal(result.adapter, 'codex');
  assert.equal(result.status, 'runtime-unavailable');
  assert.match(result.error, /Install the native CLI/);
});

test('truncated Unicode and invalid output bytes cannot expand beyond the capture budget', async () => {
  for (const script of ['process.stdout.write("🙂".repeat(100))', 'process.stdout.write(Buffer.alloc(400, 255))']) {
    const result = await runBoundedProcess({ command: process.execPath,
      args: ['-e', script], maxOutputBytes: 5, timeoutMs: 5000 });
    assert.equal(result.status, 'output-limit');
    assert.ok(Buffer.byteLength(result.stdout) <= 5);
  }
});
