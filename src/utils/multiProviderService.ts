import Groq from 'groq-sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';

// ==================== TYPES ====================
export type ProviderName = 'groq' | 'gemini' | 'openrouter' | 'mistral';

interface Provider {
  name: ProviderName;
  call: (prompt: string, systemPrompt: string) => Promise<string>;
  isAvailable: () => boolean;
  markQuotaExceeded: () => void;
}

const QUOTA_COOLDOWN_MS = 5 * 60 * 1000; // 5 phút

// ==================== PROVIDER FACTORY ====================

function makeGroqProvider(apiKey: string): Provider {
  const client = new Groq({ apiKey });
  let quotaUntil: number | null = null;

  return {
    name: 'groq',
    isAvailable: () => !quotaUntil || Date.now() > quotaUntil,
    markQuotaExceeded: () => { quotaUntil = Date.now() + QUOTA_COOLDOWN_MS; },
    call: async (prompt, systemPrompt) => {
      const res = await client.chat.completions.create({
        model: 'llama-3.3-70b-versatile', // Model tốt nhất, miễn phí
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        max_tokens: 512,
        temperature: 0.7,
      });
      return res.choices[0]?.message?.content ?? '';
    },
  };
}

function makeGeminiProvider(apiKey: string): Provider {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
  let quotaUntil: number | null = null;

  return {
    name: 'gemini',
    isAvailable: () => !quotaUntil || Date.now() > quotaUntil,
    markQuotaExceeded: () => { quotaUntil = Date.now() + QUOTA_COOLDOWN_MS; },
    call: async (prompt) => {
      const result = await model.generateContent(prompt);
      return result.response.text();
    },
  };
}

function makeOpenRouterProvider(apiKey: string): Provider {
  let quotaUntil: number | null = null;

  return {
    name: 'openrouter',
    isAvailable: () => !quotaUntil || Date.now() > quotaUntil,
    markQuotaExceeded: () => { quotaUntil = Date.now() + QUOTA_COOLDOWN_MS; },
    call: async (prompt, systemPrompt) => {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          // Models miễn phí trên OpenRouter:
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          max_tokens: 512,
        }),
      });
      const data = await res.json();
      return data.choices[0]?.message?.content ?? '';
    },
  };
}

function makeMistralProvider(apiKey: string): Provider {
  let quotaUntil: number | null = null;

  return {
    name: 'mistral',
    isAvailable: () => !quotaUntil || Date.now() > quotaUntil,
    markQuotaExceeded: () => { quotaUntil = Date.now() + QUOTA_COOLDOWN_MS; },
    call: async (prompt, systemPrompt) => {
      const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'mistral-small-latest', // Miễn phí
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: prompt },
          ],
          max_tokens: 512,
        }),
      });
      const data = await res.json();
      return data.choices[0]?.message?.content ?? '';
    },
  };
}

// ==================== MULTI-PROVIDER SERVICE ====================

export class MultiProviderAI {
  private providers: Provider[] = [];
  private currentIndex = 0; // Round-robin giữa các providers

  constructor(keys: {
    groq?: string;
    gemini?: string;
    openrouter?: string;
    mistral?: string;
  }) {
    // Thêm provider nào có API key
    if (keys.groq) this.providers.push(makeGroqProvider(keys.groq));
    if (keys.gemini) this.providers.push(makeGeminiProvider(keys.gemini));
    if (keys.openrouter) this.providers.push(makeOpenRouterProvider(keys.openrouter));
    if (keys.mistral) this.providers.push(makeMistralProvider(keys.mistral));

    if (this.providers.length === 0) {
      throw new Error('Cần ít nhất 1 API key');
    }

    console.info(`✅ MultiProviderAI khởi tạo với ${this.providers.length} provider(s): ${
      this.providers.map(p => p.name).join(', ')
    }`);
  }

  /**
   * Tự động thử từng provider theo thứ tự.
   * Nếu provider hiện tại bị quota/lỗi → chuyển sang provider tiếp theo.
   */
  async generate(prompt: string, systemPrompt: string): Promise<{
    text: string;
    provider: ProviderName;
    usedFallback: boolean;
  }> {
    const primaryIndex = this.currentIndex % this.providers.length;

    // Thử tất cả providers bắt đầu từ currentIndex (round-robin)
    for (let i = 0; i < this.providers.length; i++) {
      const idx = (primaryIndex + i) % this.providers.length;
      const provider = this.providers[idx];

      if (!provider.isAvailable()) {
        console.info(`⏭️ Bỏ qua ${provider.name} — đang trong cooldown`);
        continue;
      }

      try {
        console.info(`🤖 Đang dùng provider: ${provider.name}`);
        const text = await provider.call(prompt, systemPrompt);

        // Thành công → advance round-robin
        this.currentIndex = (idx + 1) % this.providers.length;

        return {
          text,
          provider: provider.name,
          usedFallback: i > 0, // i > 0 nghĩa là đã phải fallback
        };
      } catch (error: any) {
        const isQuota =
          error?.status === 429 ||
          error?.message?.toLowerCase().includes('quota') ||
          error?.message?.toLowerCase().includes('rate limit') ||
          error?.message?.toLowerCase().includes('too many');

        if (isQuota) {
          provider.markQuotaExceeded();
          console.warn(`⚠️ ${provider.name} quota exceeded → thử provider tiếp theo`);
        } else {
          console.error(`❌ ${provider.name} lỗi không xác định:`, error?.message);
        }
      }
    }

    throw new Error('Tất cả AI providers đều không khả dụng');
  }

  getStatus(): Record<ProviderName, boolean> {
    return Object.fromEntries(
      this.providers.map(p => [p.name, p.isAvailable()])
    ) as Record<ProviderName, boolean>;
  }
}