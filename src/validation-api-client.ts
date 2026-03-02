import type { CommandContext } from "./command-utils";
import { type PlatformApiClientOptions, createValidationApiClient as createValidationApi } from "./platform-api-sdk";

type ValidationApiClientOptions = {
  requireAuth?: boolean;
};

export function createValidationApiClient(
  context: CommandContext,
  options: ValidationApiClientOptions = {},
) {
  return createValidationApi(context, options as PlatformApiClientOptions);
}
