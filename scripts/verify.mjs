import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync, cpSync } from 'node:fs';

mkdirSync('evidence', { recursive: true });
const results = [];
for (const args of [['test'], ['run', 'build'], ['run', 'test:e2e']]) {
  const result = spawnSync('npm', args, { encoding: 'utf8', timeout: 120000 });
  const command = `npm ${args.join(' ')}`;
  const output = (result.stdout || '') + (result.stderr || '');
  console.log(command, 'exit', result.status, '\n' + output);
  const file = `evidence/${args.at(-1).replaceAll(':', '-')}.log`;
  writeFileSync(file, output);
  results.push({ command, exitCode: result.status, evidence: file });
  if (result.status !== 0) {
    writeFileSync('evidence/verification.json', JSON.stringify({ recordedAt: new Date().toISOString(), results }, null, 2));
    process.exit(result.status || 1);
  }
}
cpSync('test-results/editor-three-configured-no-49ec9-on-leaves-no-dangling-edges/restored-editor.png', 'evidence/restored-editor.png');
cpSync('test-results/editor-three-configured-no-49ec9-on-leaves-no-dangling-edges/saved-graph.json', 'evidence/saved-graph.json');
cpSync('playwright-report', 'evidence/browser-report', { recursive: true });
writeFileSync('evidence/verification.json', JSON.stringify({ recordedAt: new Date().toISOString(), results }, null, 2));
