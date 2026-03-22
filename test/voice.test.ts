import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetImportHook,
  _setDecodeHook,
  _setImportHook,
  getAvailableBackends,
  transcribeAudio,
} from "../src/voice.js";

describe("voice transcription", () => {
  const originalOpenAIKey = process.env.OPENAI_API_KEY;
  let tempDir: string;
  let audioPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), "telepi-voice-"));
    audioPath = path.join(tempDir, "sample.ogg");
    writeFileSync(audioPath, Buffer.from("audio"));
    delete process.env.OPENAI_API_KEY;
    _resetImportHook();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    _resetImportHook();
    vi.unstubAllGlobals();
    rmSync(tempDir, { recursive: true, force: true });
    if (originalOpenAIKey === undefined) {
      delete process.env.OPENAI_API_KEY;
    } else {
      process.env.OPENAI_API_KEY = originalOpenAIKey;
    }
  });

  it("uses parakeet when available", async () => {
    _setDecodeHook(async () => new Float32Array(100));
    _setImportHook(async (specifier) => {
      if (specifier === "parakeet-coreml") {
        return {
          ParakeetAsrEngine: class {
            async initialize(): Promise<void> {}
            async transcribe(samples: Float32Array): Promise<{ text: string; durationMs: number }> {
              expect(samples).toBeInstanceOf(Float32Array);
              expect(samples.length).toBe(100);
              return { text: "hello world", durationMs: 5 };
            }
          },
        };
      }
      throw new Error(`unexpected import: ${specifier}`);
    });

    const result = await transcribeAudio(audioPath);

    expect(result.text).toBe("hello world");
    expect(result.backend).toBe("parakeet");
    expect(result.durationMs).toBe(5);
  });

  it("falls back to OpenAI when parakeet is unavailable", async () => {
    _setImportHook(async () => {
      const error = new Error("Cannot find package 'parakeet-coreml'") as Error & { code?: string };
      error.code = "ERR_MODULE_NOT_FOUND";
      throw error;
    });
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ text: "cloud transcript" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await transcribeAudio(audioPath);

    expect(result).toMatchObject({
      text: "cloud transcript",
      backend: "openai",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/audio/transcriptions",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer sk-test" },
        body: expect.any(FormData),
      }),
    );
  });

  it("throws a helpful error when no backend is available", async () => {
    _setImportHook(async () => {
      const error = new Error("Cannot find package 'parakeet-coreml'") as Error & { code?: string };
      error.code = "ERR_MODULE_NOT_FOUND";
      throw error;
    });

    await expect(transcribeAudio(audioPath)).rejects.toThrow("Voice messages require a transcription backend.");
    await expect(transcribeAudio(audioPath)).rejects.toThrow("npm install parakeet-coreml");
    await expect(transcribeAudio(audioPath)).rejects.toThrow("brew install ffmpeg");
    await expect(transcribeAudio(audioPath)).rejects.toThrow("OPENAI_API_KEY=sk-");
  });

  it("surfaces OpenAI API errors", async () => {
    _setImportHook(async () => {
      const error = new Error("Cannot find package 'parakeet-coreml'") as Error & { code?: string };
      error.code = "ERR_MODULE_NOT_FOUND";
      throw error;
    });
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
        text: async () => "server exploded",
      }),
    );

    await expect(transcribeAudio(audioPath)).rejects.toThrow(
      "OpenAI transcription failed (500): server exploded",
    );
  });

  it("rethrows parakeet runtime errors instead of falling through", async () => {
    _setDecodeHook(async () => new Float32Array(100));
    _setImportHook(async () => ({
      ParakeetAsrEngine: class {
        async initialize(): Promise<void> {}
        async transcribe(): Promise<never> {
          throw new Error("GPU failure");
        }
      },
    }));
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudio(audioPath)).rejects.toThrow("GPU failure");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports available backends", async () => {
    _setImportHook(async (specifier) => {
      if (specifier === "parakeet-coreml") {
        return {
          ParakeetAsrEngine: class {
            async initialize(): Promise<void> {}
            async transcribe(): Promise<{ text: string; durationMs: number }> {
              return { text: "ignored", durationMs: 5 };
            }
          },
        };
      }
      throw new Error(`unexpected import: ${specifier}`);
    });
    process.env.OPENAI_API_KEY = "sk-test";

    await expect(getAvailableBackends()).resolves.toEqual(["parakeet", "openai"]);

    _setImportHook(async () => {
      const error = new Error("Cannot find package 'parakeet-coreml'") as Error & { code?: string };
      error.code = "ERR_MODULE_NOT_FOUND";
      throw error;
    });
    delete process.env.OPENAI_API_KEY;

    await expect(getAvailableBackends()).resolves.toEqual([]);
  });

  it("allows empty transcripts without throwing", async () => {
    _setDecodeHook(async () => new Float32Array(100));
    _setImportHook(async () => ({
      ParakeetAsrEngine: class {
        async initialize(): Promise<void> {}
        async transcribe(): Promise<{ text: string; durationMs: number }> {
          return { text: "", durationMs: 5 };
        }
      },
    }));

    const result = await transcribeAudio(audioPath);

    expect(result).toMatchObject({
      text: "",
      backend: "parakeet",
      durationMs: 5,
    });
  });

  it("falls back to elapsed duration when parakeet omits durationMs", async () => {
    _setDecodeHook(async () => new Float32Array(100));
    _setImportHook(async () => ({
      ParakeetAsrEngine: class {
        async initialize(): Promise<void> {}
        async transcribe(): Promise<{ text: string }> {
          return { text: "default duration transcript" };
        }
      },
    }));

    const result = await transcribeAudio(audioPath);

    expect(result.text).toBe("default duration transcript");
    expect(result.backend).toBe("parakeet");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("throws when OpenAI response is missing text field", async () => {
    _setImportHook(async () => {
      const error = new Error("Cannot find package 'parakeet-coreml'") as Error & { code?: string };
      error.code = "ERR_MODULE_NOT_FOUND";
      throw error;
    });
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ result: "ok" }),
      }),
    );

    await expect(transcribeAudio(audioPath)).rejects.toThrow(
      "OpenAI transcription response did not include a text field",
    );
  });

  it("throws when fetch rejects entirely (network failure)", async () => {
    _setImportHook(async () => {
      const error = new Error("Cannot find package 'parakeet-coreml'") as Error & { code?: string };
      error.code = "ERR_MODULE_NOT_FOUND";
      throw error;
    });
    process.env.OPENAI_API_KEY = "sk-test";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network unreachable")),
    );

    await expect(transcribeAudio(audioPath)).rejects.toThrow("network unreachable");
  });

  it("surfaces broken parakeet transitive dependency instead of falling through", async () => {
    _setImportHook(async () => {
      const error = new Error("Cannot find module '/usr/lib/node_modules/napi-bindings/build/Release/binding.node'") as Error & { code?: string };
      error.code = "MODULE_NOT_FOUND";
      throw error;
    });
    process.env.OPENAI_API_KEY = "sk-test";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(transcribeAudio(audioPath)).rejects.toThrow("binding.node");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a helpful error when ffmpeg is missing", async () => {
    _setImportHook(async () => ({
      ParakeetAsrEngine: class {
        async initialize(): Promise<void> {}
        async transcribe(): Promise<{ text: string; durationMs: number }> {
          return { text: "unused", durationMs: 5 };
        }
      },
    }));
    _setDecodeHook(async () => {
      throw new Error("ffmpeg not found. Install it with: brew install ffmpeg");
    });

    await expect(transcribeAudio(audioPath)).rejects.toThrow("brew install ffmpeg");
  });

  it("propagates parakeet engine initialization failures", async () => {
    _setDecodeHook(async () => new Float32Array(100));
    _setImportHook(async () => ({
      ParakeetAsrEngine: class {
        async initialize(): Promise<void> {
          throw new Error("model download failed");
        }
        async transcribe(): Promise<{ text: string; durationMs: number }> {
          return { text: "unused", durationMs: 5 };
        }
      },
    }));

    await expect(transcribeAudio(audioPath)).rejects.toThrow("model download failed");
  });

  it("throws when parakeet-coreml does not expose ParakeetAsrEngine", async () => {
    _setDecodeHook(async () => new Float32Array(100));
    _setImportHook(async () => ({}));

    await expect(transcribeAudio(audioPath)).rejects.toThrow("does not expose a ParakeetAsrEngine class");
  });

  it("throws when the parakeet engine does not expose transcribe", async () => {
    _setDecodeHook(async () => new Float32Array(100));
    _setImportHook(async () => ({
      ParakeetAsrEngine: class {
        async initialize(): Promise<void> {}
      },
    }));

    await expect(transcribeAudio(audioPath)).rejects.toThrow("does not expose transcribe(samples)");
  });

  it("throws when parakeet returns an unsupported transcription result", async () => {
    _setDecodeHook(async () => new Float32Array(100));
    _setImportHook(async () => ({
      ParakeetAsrEngine: class {
        async initialize(): Promise<void> {}
        async transcribe(): Promise<{ segments: [] }> {
          return { segments: [] };
        }
      },
    }));

    await expect(transcribeAudio(audioPath)).rejects.toThrow("unsupported transcription result");
  });

  it("resolves ParakeetAsrEngine from parakeet-coreml default export", async () => {
    _setDecodeHook(async () => new Float32Array(100));
    _setImportHook(async () => ({
      default: {
        ParakeetAsrEngine: class {
          async initialize(): Promise<void> {}
          async transcribe(): Promise<{ text: string; durationMs: number }> {
            return { text: "default export transcript", durationMs: 3 };
          }
        },
      },
    }));

    const result = await transcribeAudio(audioPath);

    expect(result.text).toBe("default export transcript");
    expect(result.backend).toBe("parakeet");
    expect(result.durationMs).toBe(3);
  });
});
