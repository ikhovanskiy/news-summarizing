<script lang="ts">
  import { onMount } from 'svelte'
  import { marked, Renderer, type Tokens } from 'marked'

  const tabs = [
    { id: 'crypto', label: '🪙 Crypto' },
    { id: 'invest', label: '📈 Invest' },
    { id: 'world', label: '🌍 World' },
  ] as const

  type Category = (typeof tabs)[number]['id']

  interface CollectionProgress {
    currentChannel: string
    currentDate: string
    channelsCompleted: number
    channelsTotal: number
    messages: number
  }

  interface CollectionJob {
    id: string
    category: Category
    dateFrom: string
    dateTo: string
    status: 'running' | 'completed' | 'failed' | 'cancelled'
    progress: CollectionProgress | null
  }

  const htmlEntities: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }

  function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => htmlEntities[character] ?? character)
  }

  const renderer = new Renderer()
  renderer.html = ({ text }: Tokens.HTML | Tokens.Tag): string => escapeHtml(text)

  let activeTab = $state<Category>('crypto')
  let content = $state('')
  let loading = $state(true)
  let error = $state<string | null>(null)
  let requestController: AbortController | undefined
  let collectionJob = $state<CollectionJob | null>(null)
  let collectionController: AbortController | undefined
  let collectionTimer: ReturnType<typeof setTimeout> | undefined
  let collectionPolling = false

  const renderedContent = $derived(
    marked.parse(content, {
      async: false,
      renderer,
    }),
  )

  const collectionPercent = $derived.by(() => {
    const progress = collectionJob?.progress
    if (!progress || progress.channelsTotal < 1) return null
    return Math.min(
      100,
      Math.round(
        (progress.channelsCompleted / progress.channelsTotal) * 100,
      ),
    )
  })

  const collectionLabel = $derived(
    tabs.find((tab) => tab.id === collectionJob?.category)?.label ??
      'News',
  )

  async function loadNews(category: Category): Promise<void> {
    requestController?.abort()

    const controller = new AbortController()
    requestController = controller
    loading = true
    error = null

    try {
      const response = await fetch(`/api/digests/${category}`, {
        cache: 'no-store',
        signal: controller.signal,
      })

      let nextContent = ''
      if (response.status !== 404) {
        if (!response.ok) {
          throw new Error(`Server returned ${response.status}`)
        }
        nextContent = await response.text()
      }

      if (requestController === controller && !controller.signal.aborted) {
        content = nextContent
      }
    } catch (caught: unknown) {
      if (controller.signal.aborted || requestController !== controller) {
        return
      }

      content = ''
      error = caught instanceof Error ? caught.message : 'Unknown error'
    } finally {
      if (requestController === controller) {
        requestController = undefined
        loading = false
      }
    }
  }

  function selectTab(category: Category): void {
    activeTab = category
    void loadNews(category)
  }

  async function pollCollection(): Promise<void> {
    collectionController?.abort()
    const controller = new AbortController()
    collectionController = controller

    try {
      const response = await fetch('/api/collection-jobs/current', {
        cache: 'no-store',
        signal: controller.signal,
      })
      if (response.status === 404) {
        collectionJob = null
      } else if (response.ok) {
        collectionJob = (await response.json()) as CollectionJob
      }
    } catch {
      // Digest loading remains available if this optional status request fails.
    } finally {
      if (collectionController === controller) {
        collectionController = undefined
      }
      if (collectionPolling) {
        collectionTimer = setTimeout(() => {
          void pollCollection()
        }, 1500)
      }
    }
  }

  onMount(() => {
    collectionPolling = true
    void loadNews(activeTab)
    void pollCollection()

    return () => {
      collectionPolling = false
      requestController?.abort()
      collectionController?.abort()
      if (collectionTimer) clearTimeout(collectionTimer)
    }
  })
</script>

<div class="container">
  <nav aria-label="Digest categories">
    {#each tabs as tab (tab.id)}
      <button
        type="button"
        class:active={activeTab === tab.id}
        aria-pressed={activeTab === tab.id}
        onclick={() => selectTab(tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </nav>

  {#if collectionJob?.status === 'running'}
    <section class="collection-status" aria-live="polite">
      <div class="collection-status__header">
        <div>
          <span class="collection-status__eyebrow">Live collection</span>
          <strong>Collecting {collectionLabel}</strong>
        </div>
        <span class="collection-status__percent">
          {collectionPercent === null ? 'Starting…' : `${collectionPercent}%`}
        </span>
      </div>

      <div
        class:indeterminate={collectionPercent === null}
        class="progress-track"
        role="progressbar"
        aria-label={`Collecting ${collectionLabel}`}
        aria-valuemin="0"
        aria-valuemax="100"
        aria-valuenow={collectionPercent ?? undefined}
      >
        <span
          class="progress-fill"
          style={`width: ${collectionPercent ?? 28}%`}
        ></span>
      </div>

      <div class="collection-status__details">
        {#if collectionJob.progress}
          <span>
            {collectionJob.progress.channelsCompleted} of
            {collectionJob.progress.channelsTotal} sources
          </span>
          <span>{collectionJob.progress.messages} messages found</span>
          <span>@{collectionJob.progress.currentChannel}</span>
        {:else}
          <span>Preparing source collection…</span>
        {/if}
      </div>
    </section>
  {/if}

  {#if loading}
    <div class="empty">Loading…</div>
  {:else if error}
    <div class="empty error">Could not load the digest: {error}</div>
  {:else if content}
    <article class="markdown-content">
      {@html renderedContent}
    </article>
  {:else}
    <div class="empty">No digest has been published yet.</div>
  {/if}
</div>

<style>
  :global(body) {
    margin: 0;
    padding: 0;
    background: #f5f5f5;
  }

  .container {
    max-width: 900px;
    margin: 0 auto;
    padding: 20px;
    background: white;
    min-height: 100vh;
  }

  nav {
    display: flex;
    gap: 8px;
    margin-bottom: 24px;
    border-bottom: 2px solid #e0e0e0;
    padding-bottom: 12px;
  }

  nav button {
    padding: 8px 20px;
    border: 1px solid #ddd;
    border-radius: 6px;
    background: white;
    cursor: pointer;
    font-size: 15px;
    color: #555;
    transition: all 0.15s;
  }

  nav button:hover {
    background: #f0f0f0;
  }

  nav button.active {
    background: #007bff;
    color: white;
    border-color: #007bff;
  }

  .collection-status {
    margin: 0 0 24px;
    padding: 16px 18px;
    border: 1px solid #cfe2ff;
    border-radius: 10px;
    background: #f4f8ff;
    box-shadow: 0 8px 24px rgb(0 86 179 / 8%);
  }

  .collection-status__header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 12px;
    color: #17365d;
  }

  .collection-status__header strong {
    display: block;
    font-size: 16px;
  }

  .collection-status__eyebrow {
    display: block;
    margin-bottom: 2px;
    color: #5d7696;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .collection-status__percent {
    color: #0056b3;
    font-size: 14px;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }

  .progress-track {
    position: relative;
    height: 9px;
    overflow: hidden;
    border-radius: 999px;
    background: #dce8f8;
  }

  .progress-fill {
    display: block;
    height: 100%;
    border-radius: inherit;
    background: linear-gradient(90deg, #007bff, #42a5ff);
    transition: width 300ms ease;
  }

  .progress-track.indeterminate .progress-fill {
    animation: progress-slide 1.2s ease-in-out infinite;
  }

  .collection-status__details {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
    margin-top: 10px;
    color: #5d6f84;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }

  @keyframes progress-slide {
    from {
      transform: translateX(-120%);
    }
    to {
      transform: translateX(360%);
    }
  }

  .empty {
    padding: 40px;
    text-align: center;
    font-size: 18px;
    color: #666;
  }

  .empty.error {
    color: #d32f2f;
  }

  :global(.markdown-content) {
    font-family:
      -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell,
      sans-serif;
    line-height: 1.6;
    color: #333;
  }

  :global(.markdown-content h1) {
    font-size: 2em;
    margin-top: 0;
    margin-bottom: 0.3em;
    color: #1a1a1a;
    border-bottom: 2px solid #007bff;
    padding-bottom: 10px;
  }

  :global(.markdown-content h2) {
    font-size: 1.5em;
    margin-top: 0.8em;
    margin-bottom: 0.3em;
    color: #0056b3;
  }

  :global(.markdown-content h3) {
    font-size: 1.2em;
    color: #0056b3;
  }

  :global(.markdown-content p) {
    margin: 0.8em 0;
  }

  :global(.markdown-content ul, .markdown-content ol) {
    margin: 0.8em 0;
    padding-left: 2em;
  }

  :global(.markdown-content li) {
    margin: 0.4em 0;
  }

  :global(.markdown-content code) {
    background: #f4f4f4;
    padding: 2px 6px;
    border-radius: 3px;
    font-family: 'Monaco', 'Courier New', monospace;
    font-size: 0.9em;
  }

  :global(.markdown-content pre) {
    background: #f4f4f4;
    padding: 15px;
    border-radius: 5px;
    overflow-x: auto;
    margin: 1em 0;
  }

  :global(.markdown-content blockquote) {
    border-left: 4px solid #ddd;
    margin: 0.8em 0;
    padding-left: 15px;
    color: #666;
  }

  :global(.markdown-content a) {
    color: #007bff;
    text-decoration: none;
  }

  :global(.markdown-content a:hover) {
    text-decoration: underline;
  }

  :global(.markdown-content strong) {
    color: #1a1a1a;
    font-weight: 600;
  }

  :global(.markdown-content em) {
    color: #555;
  }

  :global(.markdown-content table) {
    border-collapse: collapse;
    margin: 1em 0;
    width: 100%;
  }

  :global(.markdown-content th, .markdown-content td) {
    border: 1px solid #ddd;
    padding: 10px;
    text-align: left;
  }

  :global(.markdown-content th) {
    background: #f4f4f4;
    font-weight: 600;
  }

  @media (max-width: 560px) {
    .container {
      padding: 14px;
    }

    nav {
      overflow-x: auto;
    }

    nav button {
      flex: 1 0 auto;
      padding-inline: 14px;
    }

    .collection-status__details span:last-child {
      width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .progress-track.indeterminate .progress-fill {
      animation: none;
    }

    .progress-fill {
      transition: none;
    }
  }
</style>
