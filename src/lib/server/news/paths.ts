import { tmpdir } from 'node:os'
import path from 'node:path'

export interface NewsRuntimePaths {
  dataDir: string
  collectorPath: string
  pythonBin: string
  collectionTempRoot: string
}

export type NewsRuntimePathOverrides = Partial<NewsRuntimePaths>

export function resolveNewsRuntimePaths(
  overrides: NewsRuntimePathOverrides = {},
): NewsRuntimePaths {
  return {
    dataDir: path.resolve(
      overrides.dataDir ?? process.env.NEWS_DATA_DIR ?? path.resolve('data'),
    ),
    collectorPath: path.resolve(
      overrides.collectorPath ??
        process.env.NEWS_COLLECTOR_PATH ??
        path.resolve('collect.py'),
    ),
    pythonBin: overrides.pythonBin ?? process.env.PYTHON_BIN ?? 'python3',
    collectionTempRoot: path.resolve(
      overrides.collectionTempRoot ??
        path.join(tmpdir(), 'news-collections'),
    ),
  }
}
