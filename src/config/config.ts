import dotenv from 'dotenv';
dotenv.config();
export const config = {
  geminiApiKey:    process.env.GEMINI_API_KEY    ?? '',
  groqApiKey:      process.env.GROQ_API_KEY      ?? '', // ← thêm ?? ''
  openrouterApiKey: process.env.OPENROUTER_API_KEY ?? '',
  mistralApiKey:   process.env.MISTRAL_API_KEY   ?? '',
};