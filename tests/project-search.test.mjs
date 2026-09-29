import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import ts from 'typescript';

// Exercise the real TypeScript helpers on every supported Node version;
// the project's existing compiler erases types without a new test runtime.
async function importTypeScript(relativePath) {
  const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`);
}

const project = Object.freeze({
  name: 'scan-sequencer',
  title: 'Instrument Control',
  tagline: 'Coordinate devices',
  summary: 'A scanner preflight service',
  category: 'Instrumentation and Test',
  language: 'Go',
  stack: Object.freeze(['Go', 'C++', 'React']),
});

test('search includes repository names, descriptive text and technology metadata', async () => {
  const { matchesProjectQuery } = await importTypeScript('../src/lib/projectSearch.ts');
  for (const query of ['scan-sequencer', '  SCAN-SEQUENCER  ', 'instrument control', 'coordinate devices', 'preflight service', 'instrumentation and test', 'go', 'c++', 'react']) {
    assert.equal(matchesProjectQuery(project, query), true, query);
  }
});

test('search keeps blank and literal substring semantics without modifying its input', async () => {
  const { matchesProjectQuery } = await importTypeScript('../src/lib/projectSearch.ts');
  for (const [query, expected] of [
    ['', true], ['   ', true], ['\t\n', true], ['sequencer', true],
    ['does-not-exist', false], ['[', false], ['C#', false],
    ['c++ react', true], ['react c++', false],
  ]) {
    assert.equal(matchesProjectQuery(project, query), expected, query);
  }
  assert.equal(project.name, 'scan-sequencer');
  assert.deepEqual(project.stack, ['Go', 'C++', 'React']);
});

test('demo URL uses an explicit destination while preserving the existing fallback', async () => {
  const { getProjectDemoUrl } = await importTypeScript('../src/lib/projectLinks.ts');
  assert.equal(getProjectDemoUrl({ name: 'scanguard' }), 'https://showcases-lime.vercel.app/scanguard');
  assert.equal(getProjectDemoUrl({ name: 'kernelcheck', demoUrl: 'https://verified-demo.example/kernelcheck/' }), 'https://verified-demo.example/kernelcheck/');
});
