import { GoogleGenerativeAI } from '@google/generative-ai';
import logger from '../utils/logger.js';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash-latest';
const DEFAULT_MAX_TOKENS = parseInt(process.env.GEMINI_MAX_OUTPUT_TOKENS || '1024', 10);
const DEFAULT_TEMPERATURE = parseFloat(process.env.GEMINI_TEMPERATURE || '0.35');

class GeminiService {
  constructor() {
    this.client = null;
  }

  ensureClient() {
    if (!process.env.GEMINI_API_KEY) {
      const error = new Error('Gemini API key missing');
      error.statusCode = 503;
      throw error;
    }

    if (!this.client) {
      this.client = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
  }

  buildSystemPrompt(user, contextBlocks) {
    const safeRole = user?.role || 'member';
    const safeName = user?.name || 'Learner';
    const contextSummary = contextBlocks.length
      ? contextBlocks.map((block) => {
          const preview = typeof block.data === 'string'
            ? block.data
            : JSON.stringify(block.data, null, 2);
          return `# ${block.label || block.key}\n${preview}`.slice(0, 2000);
        }).join('\n\n')
      : 'No structured context was provided. Respond using platform knowledge only.';

    return `
You are Gemini AI, an academic assistant embedded inside the AI LMS Platform.
- Always respect role-based security: never expose data outside of the provided context blocks.
- User details:
  - Name: ${safeName}
  - Role: ${safeRole}
- Respond with concise, actionable insights. Use bullets or tables when it improves readability.
- Provide next best actions whenever possible.

Context blocks:
${contextSummary}
`.trim();
  }

  normalizeHistory(history = []) {
    return history.slice(-10).map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: message.content.slice(0, 4000) }]
    }));
  }

  normalizeContext(contextBlocks = []) {
    return contextBlocks.slice(0, 3).map((block) => ({
      key: block.key,
      label: block.label || block.key,
      data: block.data
    }));
  }

  async generateResponse({ user, message, history = [], contextBlocks = [], options = {} }) {
    this.ensureClient();

    const safeMessage = (message || '').trim();
    if (!safeMessage) {
      const error = new Error('Message is required');
      error.statusCode = 400;
      throw error;
    }

    const normalizedHistory = this.normalizeHistory(history);
    const normalizedContext = this.normalizeContext(contextBlocks);
    const systemInstruction = this.buildSystemPrompt(user, normalizedContext);
    const modelName = options.model || DEFAULT_MODEL;

    try {
      const model = this.client.getGenerativeModel({
        model: modelName,
        systemInstruction
      });

      const result = await model.generateContent({
        contents: [
          ...normalizedHistory,
          {
            role: 'user',
            parts: [{ text: safeMessage }]
          }
        ],
        generationConfig: {
          temperature: options.temperature ?? DEFAULT_TEMPERATURE,
          topP: options.topP ?? 0.95,
          topK: options.topK ?? 32,
          maxOutputTokens: options.maxOutputTokens ?? DEFAULT_MAX_TOKENS
        }
      });

      const response = result?.response;
      const text = response?.text() || 'I could not generate a response.';

      return {
        text,
        metadata: {
          model: modelName,
          usage: response?.usageMetadata,
          safetyRatings: response?.safetyRatings,
          contextBlocks: normalizedContext.map((block) => block.key)
        }
      };
    } catch (error) {
      logger.error('Gemini API error', {
        message: error.message,
        code: error.status,
        details: error.response?.data
      });

      if (error.statusCode) {
        throw error;
      }

      const friendlyError = new Error('Gemini service is unavailable. Please try again later.');
      friendlyError.statusCode = 502;
      throw friendlyError;
    }
  }
}

export default new GeminiService();

