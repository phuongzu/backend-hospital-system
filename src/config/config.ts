export const config = {
  geminiApiKey: process.env.GEMINI_API_KEY || 'AIzaSyAAtChJbB_StHpsjBQrFMLwISyD43aSBls',
  aiService: {
    maxHistoryLength: 10,
    timeout: 30000
  }
};