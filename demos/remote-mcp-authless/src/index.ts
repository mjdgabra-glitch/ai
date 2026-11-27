
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler } from "agents/mcp/server";
import { env } from "cloudflare:workers";
import { z } from "zod";

interface Env {
  PIXABAY_API_KEY: string;
  ELEVENLABS_API_KEY: string;
}

// تحويل بيانات الصوت إلى Base64 لإرسالها عبر MCP
function audioToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

// إنشاء استجابة صوتية موحدة
function audioResponse(bytes: Uint8Array) {
  return {
    content: [
      {
        type: "audio" as const,
        data: audioToBase64(bytes),
        mimeType: "audio/mpeg",
      },
    ],
  };
}

// إنشاء استجابة أخطاء موحدة
function errorResponse(message: string) {
  return {
    content: [
      {
        type: "text" as const,
        text: message,
      },
    ],
    isError: true,
  };
}

function createServer() {
  const server = new McpServer({
    name: "AI Media Tools",
    version: "2.0.0",
  });

  // ==========================================
  // 1. PIXABAY VIDEO SEARCH
  // ==========================================

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
        return errorResponse(
          "PIXABAY_API_KEY is missing from Cloudflare Worker environment."
        );
      }

      const url = new URL("https://pixabay.com/api/videos/");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("q", query);
      url.searchParams.set("per_page", "5");
      url.searchParams.set("safesearch", "true");
      url.searchParams.set("order", "popular");

      try {
        const response = await fetch(url.toString());

        if (!response.ok) {
          return errorResponse(
            `Pixabay API error: ${response.status}`
          );
        }

        const data = await response.json() as {
          totalHits: number;
          hits: Array<{
            id: number;
            tags: string;
            pageURL: string;
            videos: {
              medium?: {
                url: string;
                width: number;
                height: number;
              };
              small?: {
                url: string;
                width: number;
                height: number;
              };
              large?: {
                url: string;
                width: number;
                height: number;
              };
            };
          }>;
        };

        if (!data.hits.length) {
          return {
            content: [{
              type: "text" as const,
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
            type: "text" as const,
            text: JSON.stringify({
              total_found: data.totalHits,
              results,
            }, null, 2),
          }],
        };
      } catch (error) {
        return errorResponse(
          `Pixabay request failed: ${String(error)}`
        );
      }
    }
  );

  // ==========================================
  // 2. ELEVENLABS - LIST VOICES
  // ==========================================

  server.registerTool(
    "elevenlabs_list_voices",
    {
      description:
        "List available voices in the ElevenLabs account. Returns voice names, IDs and categories.",
      inputSchema: z.object({}),
    },
    async () => {
      const apiKey = env.ELEVENLABS_API_KEY;

      if (!apiKey) {
        return errorResponse(
          "ELEVENLABS_API_KEY is missing from Cloudflare Worker environment."
        );
      }

      try {
        const response = await fetch(
          "https://api.elevenlabs.io/v1/voices",
          {
            headers: {
              "xi-api-key": apiKey,
            },
          }
        );

        if (!response.ok) {
          return errorResponse(
            `ElevenLabs voices error: ${response.status} - ${await response.text()}`
          );
        }

        const data = await response.json() as {
          voices: Array<{
            name: string;
            voice_id: string;
            category?: string;
            labels?: Record<string, string>;
            description?: string;
          }>;
        };

        const voices = data.voices.map((voice) => ({
          name: voice.name,
          voice_id: voice.voice_id,
          category: voice.category,
          labels: voice.labels,
          description: voice.description,
        }));

        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              total_voices: voices.length,
              voices,
            }, null, 2),
          }],
        };
      } catch (error) {
        return errorResponse(
          `ElevenLabs request failed: ${String(error)}`
        );
      }
    }
  );

  // ==========================================
  // 3. ELEVENLABS - TEXT TO SPEECH
  // ==========================================

  server.registerTool(
    "elevenlabs_text_to_speech",
    {
      description:
        "Convert text into high-quality speech using an ElevenLabs voice. Returns generated MP3 audio.",
      inputSchema: z.object({
        text: z.string().min(1).max(5000),
        voice_id: z.string().min(1),
        model_id: z.string().optional(),
        stability: z.number().min(0).max(1).optional(),
        similarity_boost: z.number().min(0).max(1).optional(),
        style: z.number().min(0).max(1).optional(),
        speed: z.number().min(0.7).max(1.2).optional(),
      }),
    },
    async ({
      text,
      voice_id,
      model_id,
      stability,
      similarity_boost,
      style,
      speed,
    }) => {
      const apiKey = env.ELEVENLABS_API_KEY;

      if (!apiKey) {
        return errorResponse(
          "ELEVENLABS_API_KEY is missing from Cloudflare Worker environment."
        );
      }

      try {
        const url = new URL(
          `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice_id)}`
        );

        url.searchParams.set(
          "output_format",
          "mp3_44100_128"
        );

        const body: Record<string, unknown> = {
          text,
          model_id: model_id || "eleven_multilingual_v2",
        };

        if (
          stability !== undefined ||
          similarity_boost !== undefined ||
          style !== undefined ||
          speed !== undefined
        ) {
          body.voice_settings = {
            ...(stability !== undefined
              ? { stability }
              : {}),
            ...(similarity_boost !== undefined
              ? { similarity_boost }
              : {}),
            ...(style !== undefined
              ? { style }
              : {}),
            ...(speed !== undefined
              ? { speed }
              : {}),
          };
        }

        const response = await fetch(url.toString(), {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          return errorResponse(
            `ElevenLabs TTS error: ${response.status} - ${await response.text()}`
          );
        }

        const audio = new Uint8Array(
          await response.arrayBuffer()
        );

        if (audio.length === 0) {
          return errorResponse(
            "ElevenLabs returned an empty audio file."
          );
        }

        return audioResponse(audio);
      } catch (error) {
        return errorResponse(
          `Speech generation failed: ${String(error)}`
        );
      }
    }
  );

  // ==========================================
  // 4. ELEVENLABS - SOUND EFFECTS
  // ==========================================

  server.registerTool(
    "elevenlabs_sound_effects",
    {
      description:
        "Generate sound effects from text descriptions for videos, films and media projects. Returns MP3 audio.",
      inputSchema: z.object({
        prompt: z.string().min(1).max(1000),
        duration_seconds: z.number().min(0.5).max(30).optional(),
        prompt_influence: z.number().min(0).max(1).optional(),
        loop: z.boolean().optional(),
      }),
    },
    async ({
      prompt,
      duration_seconds,
      prompt_influence,
      loop,
    }) => {
      const apiKey = env.ELEVENLABS_API_KEY;

      if (!apiKey) {
        return errorResponse(
          "ELEVENLABS_API_KEY is missing from Cloudflare Worker environment."
        );
      }

      try {
        const url = new URL(
          "https://api.elevenlabs.io/v1/sound-generation"
        );

        url.searchParams.set(
          "output_format",
          "mp3_44100_128"
        );

        const body: Record<string, unknown> = {
          text: prompt,
          model_id: "eleven_text_to_sound_v2",
        };

        if (duration_seconds !== undefined) {
          body.duration_seconds = duration_seconds;
        }

        if (prompt_influence !== undefined) {
          body.prompt_influence = prompt_influence;
        }

        if (loop !== undefined) {
          body.loop = loop;
        }

        const response = await fetch(url.toString(), {
          method: "POST",
          headers: {
            "xi-api-key": apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          return errorResponse(
            `ElevenLabs sound generation error: ${response.status} - ${await response.text()}`
          );
        }

        const audio = new Uint8Array(
          await response.arrayBuffer()
        );

        if (audio.length === 0) {
          return errorResponse(
            "ElevenLabs returned an empty sound file."
          );
        }

        return audioResponse(audio);
      } catch (error) {
        return errorResponse(
          `Sound generation failed: ${String(error)}`
        );
      }
    }
  );

  return server;
}

// ==========================================
// CLOUDFLARE WORKER MCP HANDLER
// ==========================================

const handler = createMcpHandler(createServer);

export default {
  fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) {
    return handler(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
