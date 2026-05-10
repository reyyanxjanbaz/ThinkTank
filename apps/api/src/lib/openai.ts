import OpenAI from "openai";

const openRouterApiKey = (process.env.OPENROUTER_API_KEY ?? "").trim();
const openAIApiKey = (process.env.OPENAI_API_KEY ?? "").trim();
const configuredBaseUrl = (process.env.OPENAI_BASE_URL ?? "").trim();
const usingOpenRouterBaseUrl = configuredBaseUrl.includes("openrouter.ai");

const apiKey = openRouterApiKey || openAIApiKey;
const isOpenRouter = Boolean(openRouterApiKey || usingOpenRouterBaseUrl);

const baseURL =
  configuredBaseUrl || (isOpenRouter ? "https://openrouter.ai/api/v1" : "");

const defaultHeaders: Record<string, string> = {};
if (isOpenRouter) {
  const siteUrl = (process.env.OPENROUTER_SITE_URL ?? "").trim();
  const appName = (process.env.OPENROUTER_APP_NAME ?? "Think Tank").trim();

  if (siteUrl) {
    defaultHeaders["HTTP-Referer"] = siteUrl;
  }

  if (appName) {
    defaultHeaders["X-OpenRouter-Title"] = appName;
    defaultHeaders["X-Title"] = appName;
  }
}

export const hasOpenAIConfig = Boolean(apiKey);
export const openaiProvider = isOpenRouter ? "openrouter" : "openai";
export const openaiBaseUrl = baseURL || "https://api.openai.com/v1";

export const openai = hasOpenAIConfig
  ? new OpenAI({
      apiKey,
      ...(baseURL ? { baseURL } : {}),
      ...(Object.keys(defaultHeaders).length > 0
        ? { defaultHeaders }
        : {})
    })
  : null;

const configuredModel = (process.env.OPENAI_MODEL ?? "").trim();
const defaultModel = isOpenRouter ? "openai/gpt-4o-mini" : "gpt-4o-mini";
const normalizedModel = (configuredModel || defaultModel).replace(
  /^openai\//,
  isOpenRouter ? "openai/" : ""
);

export const openaiModel = normalizedModel;

const temperatureRaw = Number.parseFloat(process.env.OPENAI_TEMPERATURE ?? "0.7");

export const openaiTemperature = Number.isFinite(temperatureRaw)
  ? Math.max(0, Math.min(2, temperatureRaw))
  : 0.7;
