import { type CommandContext, nonEmpty, trimTrailingSlash } from "./command-utils";
import { loadStoredCliCredential } from "./credential-store";
import {
  BacktestsApi,
  Configuration,
  ConversationsApi,
  DataApi,
  DatasetsApi,
  DeploymentsApi,
  HealthApi,
  KnowledgeApi,
  OrdersApi,
  PortfoliosApi,
  ResearchApi,
  SharedValidationApi,
  StrategiesApi,
  ValidationApi,
} from "./generated/trade-nexus-sdk";

export type PlatformApiClientOptions = {
  requireAuth?: boolean;
};

function resolveAuth(context: CommandContext): { accessToken?: string; apiKey?: string } {
  const envAccessToken =
    nonEmpty(context.env.PLATFORM_API_BEARER_TOKEN) ?? nonEmpty(context.env.PLATFORM_API_TOKEN);
  const storedCredential = envAccessToken
    ? undefined
    : loadStoredCliCredential(context.baseUrl, context.env);
  const accessToken = envAccessToken ?? storedCredential?.accessToken;
  const apiKey = nonEmpty(context.env.PLATFORM_API_KEY);
  return { accessToken, apiKey };
}

function createConfiguration(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): Configuration {
  const { requireAuth = true } = options;
  const auth = resolveAuth(context);

  if (requireAuth && !auth.accessToken && !auth.apiKey) {
    throw new Error(
      "Authentication required: set PLATFORM_API_BEARER_TOKEN (preferred) or PLATFORM_API_KEY.",
    );
  }

  return new Configuration({
    basePath: trimTrailingSlash(context.baseUrl),
    fetchApi: context.fetchImpl,
    accessToken: auth.accessToken,
    apiKey: auth.apiKey,
  });
}

export function createValidationApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): ValidationApi {
  return new ValidationApi(createConfiguration(context, options));
}

export function createResearchApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): ResearchApi {
  return new ResearchApi(createConfiguration(context, options));
}

export function createStrategiesApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): StrategiesApi {
  return new StrategiesApi(createConfiguration(context, options));
}

export function createBacktestsApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): BacktestsApi {
  return new BacktestsApi(createConfiguration(context, options));
}

export function createDeploymentsApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): DeploymentsApi {
  return new DeploymentsApi(createConfiguration(context, options));
}

export function createPortfoliosApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): PortfoliosApi {
  return new PortfoliosApi(createConfiguration(context, options));
}

export function createOrdersApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): OrdersApi {
  return new OrdersApi(createConfiguration(context, options));
}

export function createDatasetsApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): DatasetsApi {
  return new DatasetsApi(createConfiguration(context, options));
}

export function createDataApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): DataApi {
  return new DataApi(createConfiguration(context, options));
}

export function createSharedValidationApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): SharedValidationApi {
  return new SharedValidationApi(createConfiguration(context, options));
}

export function createConversationsApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): ConversationsApi {
  return new ConversationsApi(createConfiguration(context, options));
}

export function createKnowledgeApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): KnowledgeApi {
  return new KnowledgeApi(createConfiguration(context, options));
}

export function createHealthApiClient(
  context: CommandContext,
  options: PlatformApiClientOptions = {},
): HealthApi {
  return new HealthApi(createConfiguration(context, options));
}
