import { spawn } from 'node:child_process';
import { isAbsolute, join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { StringDecoder } from 'node:string_decoder';

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_OUTPUT_BYTES = 1024 * 1024;
const MAX_PROMPT_BYTES = 1024 * 1024;

function nonemptyString(value, field) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw new TypeError(`${field} must be a nonempty string without NUL bytes`);
  }
  return value;
}

function positiveInteger(value, field, maximum) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new TypeError(`${field} must be a positive integer <= ${maximum}`);
  }
  return value;
}

function nativeCommand(value) {
  nonemptyString(value, 'executable');
  if (/\.(cmd|bat|ps1)$/i.test(value)) {
    throw new TypeError('Use a native executable, not a shell wrapper (.cmd, .bat or .ps1)');
  }
  return value;
}

function decodeCaptured(chunks) {
  const bytes = Buffer.concat(chunks);
  // Invalid UTF-8 can expand into replacement characters. Keep even decoded output within its budget,
  // and do not emit a replacement character for a valid code point cut by the capture boundary.
  const normalized = Buffer.from(bytes.toString('utf8'));
  return new StringDecoder('utf8').write(normalized.subarray(0, bytes.length));
}

/** Construct argv, never a shell command. A completed runtime is not an accepted candidate. */
export function buildAgentInvocation(options) {
  const { adapter, candidateDir, prompt, model, maxBudgetUsd } = options;
  if (!['codex', 'claude'].includes(adapter)) throw new TypeError('adapter must be codex or claude');
  nonemptyString(candidateDir, 'candidateDir');
  if (!isAbsolute(candidateDir)) throw new TypeError('candidateDir must be absolute');
  nonemptyString(prompt, 'prompt');
  if (Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) throw new TypeError('prompt exceeds 1 MiB');
  if (model !== undefined) nonemptyString(model, 'model');
  const timeoutMs = positiveInteger(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, 'timeoutMs', 86400000);
  if (maxBudgetUsd !== undefined) {
    if (typeof maxBudgetUsd !== 'number' || !Number.isFinite(maxBudgetUsd) || maxBudgetUsd <= 0) {
      throw new TypeError('maxBudgetUsd must be a finite positive number');
    }
    if (adapter === 'codex') {
      throw new TypeError('Codex CLI has no supported per-run dollar cap in this adapter; use an external budget controller');
    }
  }
  const command = nativeCommand(options.executable ?? `${adapter}${process.platform === 'win32' ? '.exe' : ''}`);
  const args = adapter === 'codex'
    ? ['exec', '--sandbox', 'workspace-write', '--config', 'approval_policy="never"',
      '--config', 'sandbox_workspace_write.network_access=false', '--config', 'allow_login_shell=false',
      '--cd', candidateDir, '--json', '--ephemeral', '--color', 'never']
    : ['--print', '--output-format', 'json', '--input-format', 'text', '--restricted',
      '--strict-mcp-config', '--tools', 'Read,Edit,Write,Glob,Grep', '--permission-mode', 'acceptEdits',
      '--permission-prompts', 'none', '--disable-slash-commands', '--no-chrome', '--no-session-persistence'];
  if (model !== undefined) args.push('--model', model);
  if (maxBudgetUsd !== undefined) args.push('--max-budget-usd', String(maxBudgetUsd));
  if (adapter === 'codex') args.push('-');
  return { command, args, stdin: prompt, timeoutMs };
}

/** Limit accidental credential inheritance; this does not restrict filesystem access. */
export function buildAgentEnvironment(adapter, source = process.env) {
  if (!['codex', 'claude'].includes(adapter)) throw new TypeError('adapter must be codex or claude');
  const common = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'TEMP', 'TMP',
    'TMPDIR', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG', 'LC_ALL', 'TERM',
    'HTTP_PROXY', 'HTTPS_PROXY', 'NO_PROXY', 'SSL_CERT_FILE', 'SSL_CERT_DIR']);
  const auth = new Set(adapter === 'codex'
    ? ['CODEX_HOME', 'OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL']
    : ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CONFIG_DIR']);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) =>
    typeof value === 'string' && (common.has(key.toUpperCase()) || auth.has(key))));
}

/** Run a native child with bounded capture and a deadline. No shell is created. */
export async function runBoundedProcess({ command, args = [], stdin = '', cwd, timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_OUTPUT_BYTES, env = process.env }) {
  nativeCommand(command);
  if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string' || arg.includes('\0'))) {
    throw new TypeError('args must be an array of strings without NUL bytes');
  }
  if (typeof stdin !== 'string') throw new TypeError('stdin must be a string');
  positiveInteger(timeoutMs, 'timeoutMs', 86400000);
  positiveInteger(maxOutputBytes, 'maxOutputBytes', 64 * 1024 * 1024);
  const startedAt = performance.now();
  return new Promise(resolve => {
    let child;
    let timer;
    let forceTimer;
    let closeTimer;
    let finished = false;
    let status;
    let capturedBytes = 0;
    let outputBytes = 0;
    let processError;
    const stdout = [];
    const stderr = [];
    const finish = (exitCode = null, signal = null) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(forceTimer);
      clearTimeout(closeTimer);
      resolve({ status: status ?? (exitCode === 0 ? 'completed' : 'failed'), exitCode, signal,
        stdout: decodeCaptured(stdout), stderr: decodeCaptured(stderr),
        durationMs: Math.round(performance.now() - startedAt), outputBytes,
        truncated: outputBytes > maxOutputBytes, ...(processError ? { error: processError } : {}) });
    };
    const stop = reason => {
      if (status || finished) return;
      status = reason;
      if (child?.pid) {
        if (process.platform === 'win32') {
          // Target only the process tree created by this invocation; never interpolate a shell command.
          const killer = spawn(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe'),
            ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
          killer.on('error', () => child.kill());
          killer.on('exit', code => { if (code !== 0) child.kill(); });
        } else {
          try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
          forceTimer = setTimeout(() => {
            try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
          }, 1000);
        }
      }
      // A descendant can hold pipes open. Do not hang forever; an OS supervisor owns final cleanup.
      closeTimer = setTimeout(() => {
        child?.stdout?.destroy();
        child?.stderr?.destroy();
        child?.stdin?.destroy();
        child?.unref();
        processError = 'Process cleanup did not complete within 3 seconds; destroy the worker environment';
        finish();
      }, 3000);
    };
    const capture = destination => chunk => {
      outputBytes += chunk.length;
      const remaining = maxOutputBytes - capturedBytes;
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining);
        destination.push(kept);
        capturedBytes += kept.length;
      }
      if (outputBytes > maxOutputBytes) stop('output-limit');
    };
    try {
      child = spawn(command, args, { cwd, env, shell: false, windowsHide: true,
        detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      status = error.code === 'ENOENT' ? 'runtime-unavailable' : 'failed';
      processError = error.message;
      finish();
      return;
    }
    child.stdout.on('data', capture(stdout));
    child.stderr.on('data', capture(stderr));
    child.once('error', error => {
      status ??= error.code === 'ENOENT' ? 'runtime-unavailable' : 'failed';
      processError = error.code === 'ENOENT'
        ? `Runtime unavailable: ${command}. Install the native CLI or supply executable with its absolute path.`
        : error.message;
      finish();
    });
    child.once('close', finish);
    // Early authentication/usage failures can close stdin before the prompt has been written.
    child.stdin.on('error', error => {
      if (!['EPIPE', 'ERR_STREAM_DESTROYED'].includes(error.code)) {
        status ??= 'failed';
        processError = error.message;
      }
    });
    timer = setTimeout(() => stop('timeout'), timeoutMs);
    child.stdin.end(stdin);
  });
}

export async function runAgent(options) {
  const invocation = buildAgentInvocation(options);
  const result = await runBoundedProcess({ ...invocation, cwd: options.candidateDir,
    maxOutputBytes: options.maxOutputBytes, env: options.env ?? buildAgentEnvironment(options.adapter) });
  return { adapter: options.adapter, ...result };
}
