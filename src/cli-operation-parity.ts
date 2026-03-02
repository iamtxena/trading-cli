export type CliOperationParity = {
  command: string;
  operationIds: readonly string[];
};

export const CONTRACT_RECONCILIATION_PATH = "B" as const;

// Path B: commands are limited to operations present in the authoritative OpenAPI spec.
export const CLI_OPERATION_PARITY: readonly CliOperationParity[] = [
  { command: "research scan", operationIds: ["postMarketScanV1", "postMarketScanV2"] },
  { command: "strategy create", operationIds: ["createStrategyV1"] },
  { command: "strategy get", operationIds: ["getStrategyV1"] },
  { command: "strategy list", operationIds: ["listStrategiesV1"] },
  { command: "strategy update", operationIds: ["updateStrategyV1"] },
  { command: "backtest create", operationIds: ["createBacktestV1"] },
  { command: "backtest get", operationIds: ["getBacktestV1"] },
  { command: "deploy create", operationIds: ["createDeploymentV1"] },
  { command: "deploy get", operationIds: ["getDeploymentV1"] },
  { command: "deploy list", operationIds: ["listDeploymentsV1"] },
  { command: "deploy stop", operationIds: ["stopDeploymentV1"] },
  { command: "portfolio list", operationIds: ["listPortfoliosV1"] },
  { command: "portfolio get", operationIds: ["getPortfolioV1"] },
  { command: "order create", operationIds: ["createOrderV1"] },
  { command: "order get", operationIds: ["getOrderV1"] },
  { command: "order list", operationIds: ["listOrdersV1"] },
  { command: "order cancel", operationIds: ["cancelOrderV1"] },
  { command: "dataset upload init", operationIds: ["initDatasetUploadV1"] },
  { command: "dataset upload complete", operationIds: ["completeDatasetUploadV1"] },
  { command: "dataset validate", operationIds: ["validateDatasetV1"] },
  { command: "dataset transform", operationIds: ["transformDatasetCandlesV1"] },
  { command: "dataset publish", operationIds: ["publishDatasetLonaV1"] },
  { command: "dataset get", operationIds: ["getDatasetV1"] },
  { command: "dataset status", operationIds: ["getDatasetV1"] },
  { command: "dataset list", operationIds: ["listDatasetsV1"] },
  { command: "conversation session create", operationIds: ["createConversationSessionV2"] },
  { command: "conversation session get", operationIds: ["getConversationSessionV2"] },
  { command: "conversation turn create", operationIds: ["createConversationTurnV2"] },
] as const;
