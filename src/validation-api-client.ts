import { type CommandContext, nonEmpty, trimTrailingSlash } from "./command-utils";
import { Configuration, ValidationApi } from "./generated/trade-nexus-sdk";

type ValidationApiClientOptions = {
  requireAuth?: boolean;
};

function resolveAuth(env: NodeJS.ProcessEnv): { accessToken?: string; apiKey?: string } {
  const accessToken = nonEmpty(env.PLATFORM_API_BEARER_TOKEN) ?? nonEmpty(env.PLATFORM_API_TOKEN);
  const apiKey = nonEmpty(env.PLATFORM_API_KEY);
  return { accessToken, apiKey };
}

export function createValidationApiClient(
  context: CommandContext,
  options: ValidationApiClientOptions = {},
): ValidationApi {
  const { requireAuth = true } = options;
  const auth = resolveAuth(context.env);

  if (requireAuth && !auth.accessToken && !auth.apiKey) {
    throw new Error(
      "Authentication required: set PLATFORM_API_BEARER_TOKEN (preferred) or PLATFORM_API_KEY.",
    );
  }

  const configuration = new Configuration({
    basePath: trimTrailingSlash(context.baseUrl),
    fetchApi: context.fetchImpl,
    accessToken: auth.accessToken,
    apiKey: auth.apiKey,
  });

  return new ValidationApi(configuration);
}
