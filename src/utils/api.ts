import { AIProvider } from '@/stores/settingsStore';

export const BRIEF_ANSWER_SYSTEM_PROMPT = '直接给出答案，省略分析和推理过程，只输出关键结论';

export interface MultiAIResult {
  providerId: string;
  providerName: string;
  content: string;
  error?: string;
}

export interface MultiAIStreamCallbacks {
  onProviderChunk?: (providerId: string, fullText: string) => void;
  onProviderDone?: (providerId: string, result: MultiAIResult) => void;
}

interface AICallOptions {
  provider: AIProvider;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  imageBase64?: string;
  userText?: string;
  maxTokens?: number;
  onChunk?: (text: string) => void;
  signal?: AbortSignal;
  systemPrompt?: string;
}

// ---------------------------------------------------------------------------
// Image compression
// ---------------------------------------------------------------------------

/** Compress base64 image: resize to max 1280px wide, convert to JPEG */
export function compressImage(base64: string, quality = 0.7, maxWidth = 1280): Promise<string> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, width, height);
      const jpegBase64 = canvas.toDataURL('image/jpeg', quality).replace(/^data:image\/\w+;base64,/, '');
      resolve(jpegBase64);
    };
    img.onerror = () => resolve(base64); // fallback to original
    img.src = `data:image/png;base64,${base64}`;
  });
}

// ---------------------------------------------------------------------------
// Shared request builder (extracted from duplicated code in callAIStream / callAI)
// ---------------------------------------------------------------------------

function buildMessages(
  imageBase64: string | undefined,
  userText: string,
  messages: AICallOptions['messages'],
  systemPrompt?: string,
) {
  const parts: any[] = [];
  if (systemPrompt) {
    parts.push({ role: 'system', content: systemPrompt });
  }
  if (imageBase64) {
    const text = userText || '请分析这张截图';
    parts.push(
      ...messages.map(m => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content: [
          { type: 'text', text },
          { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${imageBase64}` } },
        ],
      },
    );
    return parts;
  }
  parts.push(...messages.map(m => ({ role: m.role, content: m.content })));
  return parts;
}

function parseHttpError(status: number, detail: string): string {
  const base = status === 401 ? 'API Key 无效或未授权'
    : status === 403 ? 'API 访问被拒绝'
    : status === 429 ? 'API 请求频率过高，请稍后重试'
    : status >= 500 ? 'API 服务器错误'
    : `API 请求失败 (${status})`;
  return detail ? `${base}: ${detail}` : base;
}

interface FetchRequestOptions {
  provider: AIProvider;
  formattedMessages: any[];
  stream: boolean;
  maxTokens: number;
  signal?: AbortSignal;
}

/**
 * Shared fetch helper: validates provider, builds the request, returns the
 * Response.  Used by callAIStream, callAI, and testProviderConnection.
 */
async function makeRequest(opts: FetchRequestOptions): Promise<Response> {
  const { provider, formattedMessages, stream, maxTokens, signal } = opts;

  if (!provider.apiKey) throw new Error('请先在设置中配置 API Key');
  if (!provider.baseUrl) throw new Error('请先在设置中配置 API 地址');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  if (signal) {
    signal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify({
        model: provider.model,
        messages: formattedMessages,
        stream,
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
      signal: controller.signal,
    });

    return response;
  } catch (error: any) {
    if (error.name === 'AbortError') throw new Error('请求超时，请检查网络连接');
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ---------------------------------------------------------------------------
// Streaming AI call
// ---------------------------------------------------------------------------

export async function callAIStream(options: AICallOptions): Promise<string> {
  const { provider, messages, imageBase64, userText, maxTokens = 2048, onChunk, signal, systemPrompt } = options;
  const formattedMessages = buildMessages(imageBase64, userText || '', messages, systemPrompt);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true });

  let response: Response;
  try {
    response = await makeRequest({ provider, formattedMessages, stream: true, maxTokens, signal: controller.signal });
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }

  if (!response.ok) {
    clearTimeout(timeoutId);
    let detail = '';
    try { detail = (await response.json()).error?.message || ''; } catch {}
    throw new Error(parseHttpError(response.status, detail));
  }

  const reader = response.body?.getReader();
  if (!reader) { clearTimeout(timeoutId); throw new Error('无法读取响应流'); }

  // Timeout only guards first-byte; streaming runs to completion (fix #11)
  clearTimeout(timeoutId);

  const decoder = new TextDecoder();
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data);
        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          fullText += delta;
          onChunk?.(fullText);
        }
      } catch {}
    }
  }

  if (!fullText) throw new Error('AI 没有返回有效内容');
  return fullText;
}

// ---------------------------------------------------------------------------
// Multiple-provider streaming (parallel)
// ---------------------------------------------------------------------------

/** Call multiple AI providers in parallel, streaming results per provider. */
export async function callMultiAIStream(
  providers: AIProvider[],
  commonOptions: Omit<AICallOptions, 'provider' | 'onChunk'> & { signal?: AbortSignal },
  callbacks: MultiAIStreamCallbacks,
): Promise<MultiAIResult[]> {
  const results: MultiAIResult[] = [];

  const promises = providers.map(async (provider) => {
    try {
      const content = await callAIStream({
        ...commonOptions,
        provider,
        onChunk: (text) => callbacks.onProviderChunk?.(provider.id, text),
      });
      const result: MultiAIResult = { providerId: provider.id, providerName: provider.name, content };
      callbacks.onProviderDone?.(provider.id, result);
      return result;
    } catch (err: any) {
      const result: MultiAIResult = { providerId: provider.id, providerName: provider.name, content: '', error: err.message || '请求失败' };
      callbacks.onProviderDone?.(provider.id, result);
      return result;
    }
  });

  const settled = await Promise.allSettled(promises);
  for (const s of settled) {
    if (s.status === 'fulfilled') results.push(s.value);
  }
  return results;
}

// ---------------------------------------------------------------------------
// Connectivity test
// ---------------------------------------------------------------------------

export async function testProviderConnection(provider: AIProvider): Promise<{ ok: boolean; message: string }> {
  if (!provider.apiKey) return { ok: false, message: '请先填写 API Key' };
  if (!provider.baseUrl) return { ok: false, message: '请先填写 API 地址' };

  try {
    const response = await makeRequest({
      provider,
      formattedMessages: [{ role: 'user', content: 'Hi' }],
      stream: false,
      maxTokens: 5,
    });

    if (response.ok) return { ok: true, message: '连接成功' };
    let detail = '';
    try { detail = (await response.json()).error?.message || ''; } catch {}
    return { ok: false, message: parseHttpError(response.status, detail) };
  } catch (error: any) {
    return { ok: false, message: error.message || '网络错误' };
  }
}
