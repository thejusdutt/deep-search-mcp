# Deep Search MCP Server

An MCP (Model Context Protocol) server that performs comprehensive web searches by combining Google search with advanced content extraction using Mozilla's Readability algorithm.

## Features

- **Advanced Content Extraction** - Uses Mozilla's Readability algorithm (same as Firefox Reader View) for clean article extraction
- **Multiple Search Types** - Web search, news search, and image search
- **Domain Filtering** - Include or exclude specific domains from results
- **Retry Logic** - Automatic retries with exponential backoff for reliability
- **Controlled Concurrency** - Fetches pages in batches to avoid overwhelming servers
- **Full Content** - Returns complete page content, not just snippets

## Prerequisites

### Get a Serper API Key

This MCP server uses [Serper.dev](https://serper.dev) for Google search results.

1. Go to [https://serper.dev](https://serper.dev)
2. Sign up for a free account (2,500 free searches)
3. Copy your API key from the dashboard

## Installation

### Using npx (Recommended)

No installation needed - just configure your MCP client:

```json
{
  "mcpServers": {
    "deep-search": {
      "command": "npx",
      "args": ["-y", "@thejusdutt/deep-search-mcp"],
      "env": {
        "SERPER_API_KEY": "your-serper-api-key-here"
      }
    }
  }
}
```

### Global Installation

```bash
npm install -g @thejusdutt/deep-search-mcp
```

Then configure:

```json
{
  "mcpServers": {
    "deep-search": {
      "command": "deep-search-mcp",
      "env": {
        "SERPER_API_KEY": "your-serper-api-key-here"
      }
    }
  }
}
```

## Tools

### `deep_search`

Comprehensive web search with full content extraction.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | The search query |
| `num_results` | number | 10 | Number of results (1-10) |
| `max_content_per_page` | number | 50000 | Max characters per page (5000-100000) |
| `search_type` | string | "web" | Search type: "web", "news", or "images" |
| `include_domains` | string | - | Comma-separated domains to include |
| `exclude_domains` | string | - | Comma-separated domains to exclude |

**Examples:**

```
// Basic web search
deep_search({ query: "React best practices 2025" })

// News search
deep_search({ query: "AI announcements", search_type: "news" })

// Image search - returns image URLs and source pages
deep_search({ query: "cute cats", search_type: "images" })

// Search specific sites only
deep_search({ 
  query: "TypeScript tips",
  include_domains: "github.com,dev.to"
})

// Exclude certain sites
deep_search({
  query: "web development trends",
  exclude_domains: "pinterest.com,facebook.com"
})
```

### `deep_search_news`

Optimized for news article search.

**Parameters:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `query` | string | required | The news topic to search |
| `num_results` | number | 10 | Number of articles (1-10) |
| `max_content_per_page` | number | 30000 | Max characters per article |

**Example:**

```
deep_search_news({ query: "OpenAI latest updates" })
```

## Configuration for Different MCP Clients

### Kiro / Claude Desktop

Add to `~/.kiro/settings/mcp.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "deep-search": {
      "command": "npx",
      "args": ["-y", "deep-search-mcp"],
      "env": {
        "SERPER_API_KEY": "your-api-key"
      }
    }
  }
}
```

### VS Code with Continue

Add to your Continue config:

```json
{
  "mcpServers": [
    {
      "name": "deep-search",
      "command": "npx",
      "args": ["-y", "deep-search-mcp"],
      "env": {
        "SERPER_API_KEY": "your-api-key"
      }
    }
  ]
}
```

## Search Types

### Web Search (default)
Standard Google search with full page content extraction using Mozilla Readability.

### News Search
Searches Google News for recent articles. Use `search_type: "news"` or the dedicated `deep_search_news` tool.

### Image Search
Searches Google Images and returns:
- **title** - Image title/description
- **link** - Source page URL where the image is hosted
- **snippet** - Direct image URL

Note: Image search returns metadata and URLs only - it does not download or display actual images.

## How It Works

1. **Search** - Queries Google via Serper API to get top results
2. **Fetch** - Downloads each result page with retry logic (web/news only)
3. **Extract** - Uses Mozilla Readability to extract clean article content
4. **Format** - Returns consolidated markdown with full content from each page

## Requirements

- Node.js 18+
- Serper API key ([get one free](https://serper.dev))

## License

MIT

## Author

[thejusdutt](https://github.com/thejusdutt)

## Contributing

Issues and PRs welcome at [GitHub](https://github.com/thejusdutt/deep-search-mcp)
