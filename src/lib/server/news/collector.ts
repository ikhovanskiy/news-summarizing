import { execFile } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  COLLECTION_MAX_BUFFER_BYTES,
  COLLECTION_TIMEOUT_MS,
} from './constants'
import { resolveNewsRuntimePaths } from './paths'
import type {
  CollectionRunner,
  CollectionRunnerInput,
  CollectionRunnerResult,
} from './types'

export interface CollectorProcessOptions {
  collectorPath?: string
  pythonBin?: string
}

interface ProcessOutput {
  stdout: string
  stderr: string
}

function executeCollector(
  pythonBin: string,
  collectorPath: string,
  input: CollectionRunnerInput,
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    execFile(
      pythonBin,
      [
        collectorPath,
        '--date-from',
        input.dateFrom,
        '--date-to',
        input.dateTo,
        '--category',
        input.category,
        '--source',
        'scrape',
      ],
      {
        encoding: 'utf8',
        env: { ...process.env, NEWS_RAW_DIR: input.rawDir },
        maxBuffer: COLLECTION_MAX_BUFFER_BYTES,
        signal: input.signal,
        timeout: COLLECTION_TIMEOUT_MS,
      },
      (error, stdout, stderr) => {
        if (error) {
          Object.assign(error, { stdout, stderr })
          reject(error)
          return
        }
        resolve({ stdout, stderr })
      },
    )
  })
}

export async function runCollectorProcess(
  input: CollectionRunnerInput,
  options: CollectorProcessOptions = {},
): Promise<CollectionRunnerResult> {
  const paths = resolveNewsRuntimePaths({
    collectorPath: options.collectorPath,
    pythonBin: options.pythonBin,
  })

  await mkdir(input.rawDir, { recursive: true })
  const { stdout, stderr } = await executeCollector(
    paths.pythonBin,
    paths.collectorPath,
    input,
  )
  const body = await readFile(path.join(input.rawDir, `${input.category}.md`))

  return { body, stdout, stderr }
}

export const defaultCollectionRunner: CollectionRunner = (input) =>
  runCollectorProcess(input)
