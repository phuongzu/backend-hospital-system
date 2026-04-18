import dotenv from 'dotenv';
dotenv.config();
export const config = {
  groqApiKey:      process.env.GROQ_API_KEY      ?? '', 
};