

// config/config.ts
export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || 'AIzaSyAAtChJbB_StHpsjBQrFMLwISyD43aSBls',
  
  // Các config khác
  server: {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development'
  },
  
  // Thêm các API keys backup
  apiKeys: {
    gemini: [
      process.env.GEMINI_API_KEY,
      process.env.GEMINI_API_KEY_2,
      process.env.GEMINI_API_KEY_3
    ].filter(Boolean)
  }
};