import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { z } from "zod";

interface Env {
  PIXABAY_API_KEY: string;
}

function createServer(env: Env) {
  const server = new McpServer({
    name: "Pixabay Video Search",
    version: "1.0.0",
  });

  server.registerTool(
    "search_pixabay_videos",
    {
      description:
        "Search Pixabay for free stock videos. Use this tool to find real video footage for video editing, reels, and motion graphics. Search with English keywords when possible.",
      inputSchema: z.object({
        query: z.string().min(1).max(100).describe(
          "Video search keywords, preferably in English"
        ),
      }),
    },
    async ({ query }) => {
      if (!env.PIXABAY_API_KEY) {
        return {
          content: [
            {
              type: "text",
              text: "Pixabay API key is missing. Add PIXABAY_API_KEY in Cloudflare Worker Secrets.",
            },
          ],
          isError: true,
        };
      }

      const url = new URL("https://pixabay.com/api/videos/");
      url.searchParams.set("key", env.PIXABAY_API_KEY);
      url.searchParams.set("q", query);
      url.searchParams.set("per_page", "5");
      url.searchParams.set("safesearch", "true");
      url.searchParams.set("order", "popular");

      const response = await fetch(url.toString());

      if (!response.ok) {
        return {
          content: [
            {
              type: "text",
              text: `Pixabay API error: ${response.status}`,
            },
          ],
          isError: true,
        };
      }

      const data = (await response.json()) as {
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
          content: [
            {
              type: "text",
              text: `No Pixabay videos found for: ${query}`,
            },
          ],
        };
      }

      const results = data.hits.map((video) => ({
        id: video.id,
        tags: video.tags,
        source_page: video.pageURL,
        video_url:
          video.videos.medium?.url ??
          video.videos.small?.url ??
          video.videos.large?.url ??
          "",
        width:
          video.videos.medium?.width ??
          video.videos.small?.width ??
          video.videos.large?.width ??
          0,
        height:
          video.videos.medium?.height ??
          video.videos.small?.height ??
          video.videos.large?.height ??
          0,
      }));

      return {
        content: [
          {
            type: "text",
            text:
              `Found ${data.totalHits} videos. Here are 5 results:\n` +
              JSON.stringify(results, null, 2) +
              "\nPlease credit Pixabay and the video contributor when presenting results.",
          },
        ],
      };
    }
  );

  return server;
}

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const handler = createMcpHandler(() => createServer(env));
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
