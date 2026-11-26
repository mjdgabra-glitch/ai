
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { z } from "zod";

interface Env {
  PIXABAY_API_KEY: string;
}

function createServer() {
  const server = new McpServer({
    name: "Pixabay Video Search",
    version: "1.0.0",
  });

  server.registerTool(
    "search_pixabay_videos",
    {
      description:
        "Search Pixabay for free stock videos using keywords.",
      inputSchema: z.object({
        query: z.string().min(1).max(100),
      }),
    },
    async ({ query }) => {
      const apiKey = env.PIXABAY_API_KEY;

      if (!apiKey) {
        return {
          content: [{
            type: "text",
            text: "PIXABAY_API_KEY is missing from Cloudflare Worker environment.",
          }],
          isError: true,
        };
      }

      const url = new URL("https://pixabay.com/api/videos/");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("q", query);
      url.searchParams.set("per_page", "5");
      url.searchParams.set("safesearch", "true");
      url.searchParams.set("order", "popular");

      const response = await fetch(url.toString());

      if (!response.ok) {
        return {
          content: [{
            type: "text",
            text: `Pixabay API error: ${response.status}`,
          }],
          isError: true,
        };
      }

      const data = await response.json() as {
        totalHits: number;
        hits: Array<{
          id: number;
          tags: string;
          pageURL: string;
          videos: {
            medium?: { url: string; width: number; height: number };
            small?: { url: string; width: number; height: number };
            large?: { url: string; width: number; height: number };
          };
        }>;
      };

      if (!data.hits.length) {
        return {
          content: [{
            type: "text",
            text: `No videos found for: ${query}`,
          }],
        };
      }

      const results = data.hits.map((video) => {
        const file =
          video.videos.medium ??
          video.videos.large ??
          video.videos.small;

        return {
          id: video.id,
          tags: video.tags,
          source_page: video.pageURL,
          video_url: file?.url ?? "",
          width: file?.width ?? 0,
          height: file?.height ?? 0,
        };
      });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            total_found: data.totalHits,
            results,
          }, null, 2),
        }],
      };
    }
  );

  return server;
}

const handler = createMcpHandler(createServer);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
