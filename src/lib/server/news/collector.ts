import { execFile } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

import {
  COLLECTION_MAX_BUFFER_BYTES,
  COLLECTION_TIMEOUT_MS,
} from './constants'
import { resolveNewsRuntimePaths } from './paths'
import type {
  CollectionProgress,
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

export function parseCollectorProgress(
  line: string,
): CollectionProgress | null {
  const match = line.match(
    /^progress category=\S+ date=(\d{4}-\d{2}-\d{2}) channel=(\S+) channels_completed=(\d+) channels_total=(\d+) messages=(\d+)$/,
  )
  if (!match) return null

  return {
    currentDate: match[1],
    currentChannel: match[2],
    channelsCompleted: Number(match[3]),
    channelsTotal: Number(match[4]),
    messages: Number(match[5]),
  }
}

function executeCollector(
  pythonBin: string,
  collectorPath: string,
  input: CollectionRunnerInput,
): Promise<ProcessOutput> {
  return new Promise((resolve, reject) => {
    const child = execFile(
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

    let progressBuffer = ''
    child.stdout?.on('data', (chunk: Buffer | string) => {
      progressBuffer += String(chunk)
      const lines = progressBuffer.split('\n')
      progressBuffer = lines.pop() || ''
      for (const line of lines) {
        const progress = parseCollectorProgress(line.trim())
        if (progress) input.onProgress?.(progress)
      }
    })
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
