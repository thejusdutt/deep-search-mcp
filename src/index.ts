#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as cheerio from "cheerio";
import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";

const SERPER_API_KEY = process.env.SERPER_API_KEY;

interface SearchResult {
  title: string;
  link: string;
  snippet: string;
  position: number;
  date?: string;
}

interface SerperResponse {
  organic?: SearchResult[];
  news?: SearchResult[];
  images?: Array<{ title: string; imageUrl: string; link: string }>;
}

interface FetchedContent {
  url: string;
  title: string;
  content: string;
  success: boolean;
  error?: string;
  wordCount?: number;
}

// Search types supported
type SearchType = "web" | "news" | "images";

async function googleSearch(
  query: string,
  numResults: number = 10,
  searchType: SearchType = "web"
): Promise<SearchResult[]> {
  if (!SERPER_API_KEY) {
    throw new Error("SERPER_API_KEY environment variable is required");
  }

  const endpoint =
    searchType === "news"
      ? "https://google.serper.dev/news"
      : searchType === "images"
        ? "https://google.serper.dev/images"
        : "https://google.serper.dev/search";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "X-API-KEY": SERPER_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      q: query,
      num: numResults,
    }),
  });

  if (!response.ok) {
    throw new Error(`Serper API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as SerperResponse;

  if (searchType === "images" && data.images) {
    return data.images.map((img, idx) => ({
      title: img.title,
      link: img.link,
      snippet: img.imageUrl,
      position: idx + 1,
    }));
  }

  return (searchType === "news" ? data.news : data.organic) || [];
}


// Improved content extraction using Readability
function extractContentWithReadability(html: string, url: string): string {
  try {
    const dom = new JSDOM(html, { url });
    const reader = new Readability(dom.window.document);
    const article = reader.parse();

    if (article && article.textContent) {
      // Clean up the text content
      return article.textContent
        .replace(/\s+/g, " ")
        .replace(/\n\s*\n\s*\n/g, "\n\n")
        .trim();
    }
  } catch {
    // Fall back to cheerio extraction
  }

  return extractContentWithCheerio(html);
}

// Fallback content extraction using Cheerio
function extractContentWithCheerio(html: string): string {
  const $ = cheerio.load(html);

  // Remove non-content elements
  $(
    "script, style, nav, footer, header, aside, noscript, svg, iframe, form, .ads, .advertisement, .sidebar, .comments, .social-share"
  ).remove();

  // Try to find main content area
  let content = "";
  const contentSelectors = [
    "article",
    "main",
    '[role="main"]',
    ".post-content",
    ".article-content",
    ".entry-content",
    ".content",
    "#content",
    ".post",
    ".blog-post",
  ];

  for (const selector of contentSelectors) {
    const element = $(selector);
    if (element.length > 0) {
      content = element.text();
      break;
    }
  }

  // Fallback to body if no content area found
  if (!content) {
    content = $("body").text();
  }

  // Clean up whitespace
  return content.replace(/\s+/g, " ").replace(/\n\s*\n\s*\n/g, "\n\n").trim();
}

// Retry logic with exponential backoff
async function fetchWithRetry(
  url: string,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<Response> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.5",
        },
        signal: AbortSignal.timeout(15000),
      });

      if (response.ok) {
        return response;
      }

      // Don't retry on client errors (4xx) except 429 (rate limit)
      if (response.status >= 400 && response.status < 500 && response.status !== 429) {
        throw new Error(`HTTP ${response.status}`);
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error("Unknown error");

      // Don't retry on timeout
      if (lastError.message.includes("timeout")) {
        throw lastError;
      }
    }

    // Exponential backoff
    if (attempt < maxRetries - 1) {
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error("Max retries exceeded");
}


async function fetchUrl(url: string, maxLength: number = 100000): Promise<FetchedContent> {
  try {
    const response = await fetchWithRetry(url);
    const html = await response.text();

    // Extract title using cheerio
    const $ = cheerio.load(html);
    const title =
      $("title").text().trim() ||
      $('meta[property="og:title"]').attr("content") ||
      $('meta[name="title"]').attr("content") ||
      "";

    // Use Readability for better content extraction
    let text = extractContentWithReadability(html, url);

    // Calculate word count before truncation
    const wordCount = text.split(/\s+/).length;

    // Truncate to max length
    if (text.length > maxLength) {
      text = text.substring(0, maxLength) + "\n\n[Content truncated...]";
    }

    return { url, title, content: text, success: true, wordCount };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return { url, title: "", content: "", success: false, error: errorMsg };
  }
}

async function fetchAllUrls(
  urls: string[],
  concurrency: number = 5
): Promise<FetchedContent[]> {
  const results: FetchedContent[] = new Array(urls.length);

  // Process in batches for controlled concurrency
  for (let i = 0; i < urls.length; i += concurrency) {
    const batch = urls.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map((url) => fetchUrl(url)));

    batchResults.forEach((result, idx) => {
      const globalIdx = i + idx;
      if (result.status === "fulfilled") {
        results[globalIdx] = result.value;
      } else {
        results[globalIdx] = {
          url: urls[globalIdx],
          title: "",
          content: "",
          success: false,
          error: "Promise rejected",
        };
      }
    });
  }

  return results;
}

function formatResponse(
  query: string,
  searchResults: SearchResult[],
  fetchedContents: FetchedContent[],
  maxContentPerPage: number,
  searchType: SearchType
): string {
  const successCount = fetchedContents.filter((c) => c.success).length;
  const totalWords = fetchedContents.reduce((sum, c) => sum + (c.wordCount || 0), 0);

  let response = `# Deep Search Results for: "${query}"\n\n`;
  response += `**Search Type:** ${searchType}\n`;
  response += `**Results:** ${searchResults.length} found, ${successCount} pages fetched successfully\n`;
  response += `**Total Content:** ~${totalWords.toLocaleString()} words\n\n`;
  response += "---\n\n";

  for (let i = 0; i < searchResults.length; i++) {
    const search = searchResults[i];
    const fetched = fetchedContents[i];

    response += `## ${i + 1}. ${search.title}\n`;
    response += `**URL:** ${search.link}\n`;
    if (search.date) {
      response += `**Date:** ${search.date}\n`;
    }
    response += "\n";

    if (fetched?.success && fetched.content) {
      const content =
        fetched.content.length > maxContentPerPage
          ? fetched.content.substring(0, maxContentPerPage) + "\n\n[Content truncated...]"
          : fetched.content;
      response += `### Full Page Content:\n\n${content}\n\n`;
    } else if (fetched?.error) {
      response += `*Could not fetch content: ${fetched.error}*\n\n`;
      response += `**Search Snippet:** ${search.snippet}\n\n`;
    }

    response += "---\n\n";
  }

  return response;
}


// Create MCP Server
const server = new McpServer({
  name: "deep-search-mcp",
  version: "2.0.0",
});

// Register the deep_search tool
server.tool(
  "deep_search",
  "Performs a comprehensive web search by querying Google, fetching the FULL content from top results using advanced content extraction (Readability algorithm), and returning consolidated content. Supports web, news, and image search types. Includes retry logic for reliability.",
  {
    query: z.string().describe("The search query to look up"),
    num_results: z
      .number()
      .min(1)
      .max(10)
      .default(10)
      .describe("Number of results to fetch (1-10, default: 10)"),
    max_content_per_page: z
      .number()
      .min(5000)
      .max(100000)
      .default(50000)
      .describe("Maximum characters of content to return per page (5000-100000, default: 50000)"),
    search_type: z
      .enum(["web", "news", "images"])
      .default("web")
      .describe("Type of search: 'web' for general search, 'news' for news articles, 'images' for image search"),
    include_domains: z
      .string()
      .optional()
      .describe("Comma-separated list of domains to include (e.g., 'reddit.com,github.com')"),
    exclude_domains: z
      .string()
      .optional()
      .describe("Comma-separated list of domains to exclude (e.g., 'pinterest.com,facebook.com')"),
  },
  async ({
    query,
    num_results = 10,
    max_content_per_page = 50000,
    search_type = "web",
    include_domains,
    exclude_domains,
  }) => {
    try {
      // Build query with domain filters
      let searchQuery = query;
      if (include_domains) {
        const domains = include_domains.split(",").map((d) => d.trim());
        searchQuery += " " + domains.map((d) => `site:${d}`).join(" OR ");
      }
      if (exclude_domains) {
        const domains = exclude_domains.split(",").map((d) => d.trim());
        searchQuery += " " + domains.map((d) => `-site:${d}`).join(" ");
      }

      // Step 1: Google search
      const searchResults = await googleSearch(searchQuery, num_results, search_type);

      if (searchResults.length === 0) {
        return {
          content: [
            { type: "text" as const, text: `No search results found for: "${query}"` },
          ],
        };
      }

      // Step 2: Fetch all URLs with controlled concurrency
      const urls = searchResults.map((r) => r.link);
      const fetchedContents = await fetchAllUrls(urls, 5);

      // Step 3: Format and return response
      const response = formatResponse(
        query,
        searchResults,
        fetchedContents,
        max_content_per_page,
        search_type
      );

      return {
        content: [{ type: "text" as const, text: response }],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          { type: "text" as const, text: `Error performing deep search: ${errorMsg}` },
        ],
        isError: true,
      };
    }
  }
);

// Register deep_search_news tool for convenience
server.tool(
  "deep_search_news",
  "Searches for recent news articles on a topic, fetches full article content, and returns consolidated results. Optimized for news and current events.",
  {
    query: z.string().describe("The news topic to search for"),
    num_results: z
      .number()
      .min(1)
      .max(10)
      .default(10)
      .describe("Number of news articles to fetch (1-10, default: 10)"),
    max_content_per_page: z
      .number()
      .min(5000)
      .max(100000)
      .default(30000)
      .describe("Maximum characters per article (default: 30000)"),
  },
  async ({ query, num_results = 10, max_content_per_page = 30000 }) => {
    try {
      const searchResults = await googleSearch(query, num_results, "news");

      if (searchResults.length === 0) {
        return {
          content: [
            { type: "text" as const, text: `No news results found for: "${query}"` },
          ],
        };
      }

      const urls = searchResults.map((r) => r.link);
      const fetchedContents = await fetchAllUrls(urls, 5);
      const response = formatResponse(
        query,
        searchResults,
        fetchedContents,
        max_content_per_page,
        "news"
      );

      return {
        content: [{ type: "text" as const, text: response }],
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : "Unknown error";
      return {
        content: [
          { type: "text" as const, text: `Error performing news search: ${errorMsg}` },
        ],
        isError: true,
      };
    }
  }
);

// Start the server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Deep Search MCP server v2.0.0 running on stdio");
}

main().catch(console.error);
