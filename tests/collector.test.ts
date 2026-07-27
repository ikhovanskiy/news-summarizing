import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { runCollectorProcess } from '../src/lib/server/news/collector'

describe('collector process runner', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'news-python-runner-test-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  test('passes the collection arguments and reads the fake Python result', async () => {
    const collectorPath = path.join(root, 'fake-collector.py')
    const rawDir = path.join(root, 'raw')
    await writeFile(
      collectorPath,
      [
        'import argparse',
        'import os',
        'from pathlib import Path',
        'parser = argparse.ArgumentParser()',
        'parser.add_argument("--date-from", required=True)',
        'parser.add_argument("--date-to", required=True)',
        'parser.add_argument("--category", required=True)',
        'parser.add_argument("--source", required=True)',
        'args = parser.parse_args()',
        'target = Path(os.environ["NEWS_RAW_DIR"]) / f"{args.category}.md"',
        'body = f"# Fake {args.category}: {args.date_from} — {args.date_to}; source={args.source}\\n"',
        'target.write_text(body, encoding="utf-8")',
        'print(f"category={args.category} channels=1 messages=7 date_from={args.date_from} date_to={args.date_to} source={args.source}")',
        '',
      ].join('\n'),
    )

    const result = await runCollectorProcess(
      {
        category: 'crypto',
        dateFrom: '2026-07-26',
        dateTo: '2026-07-27',
        rawDir,
      },
      {
        collectorPath,
        pythonBin: process.env.PYTHON_BIN ?? 'python3',
      },
    )

    const expected =
      '# Fake crypto: 2026-07-26 — 2026-07-27; source=scrape\n'
    expect(Buffer.from(result.body).toString()).toBe(expected)
    expect(await readFile(path.join(rawDir, 'crypto.md'), 'utf8')).toBe(
      expected,
    )
    expect(String(result.stdout)).toContain(
      'category=crypto channels=1 messages=7',
    )
    expect(String(result.stdout)).toContain('source=scrape')
    expect(result.stderr).toBe('')
  })
})
