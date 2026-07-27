<script lang="ts">
  import { onMount } from 'svelte'
  import { marked, Renderer, type Tokens } from 'marked'

  const tabs = [
    { id: 'crypto', label: '🪙 Crypto' },
    { id: 'invest', label: '📈 Invest' },
    { id: 'world', label: '🌍 World' },
  ] as const

  type Category = (typeof tabs)[number]['id']

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

  const renderedContent = $derived(
    marked.parse(content, {
      async: false,
      renderer,
    }),
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

  onMount(() => {
    void loadNews(activeTab)

    return () => requestController?.abort()
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
</style>
