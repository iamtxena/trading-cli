# Command Reference

## Contract reconciliation path

- Path selected: **B (de-scope commands not present in authoritative OpenAPI)**.
- De-scoped groups: `review-run`, `validation run`, `register`, `key`, `bot`, `shared-validation`, `invite`.
- Active command surface is limited to operations present in the authoritative contract.

## Core Commands

1. `trading-cli research scan`
   - Routes to `postMarketScanV1` or `postMarketScanV2` (select with `--version`).

2. `trading-cli strategy <create|get|list|update>`
   - Uses `createStrategyV1`, `getStrategyV1`, `listStrategiesV1`, `updateStrategyV1`.

3. `trading-cli backtest <create|get>`
   - Uses `createBacktestV1`, `getBacktestV1`.

4. `trading-cli deploy <create|get|list|stop>`
   - Uses `createDeploymentV1`, `getDeploymentV1`, `listDeploymentsV1`, `stopDeploymentV1`.

5. `trading-cli portfolio <list|get>`
   - Uses `listPortfoliosV1`, `getPortfolioV1`.

6. `trading-cli order <create|get|list|cancel>`
   - Uses `createOrderV1`, `getOrderV1`, `listOrdersV1`, `cancelOrderV1`.

## Dataset Commands

1. `trading-cli dataset upload init`
   - Uses `initDatasetUploadV1`.

2. `trading-cli dataset upload complete`
   - Uses `completeDatasetUploadV1`.

3. `trading-cli dataset validate`
   - Uses `validateDatasetV1`.

4. `trading-cli dataset transform`
   - Uses `transformDatasetCandlesV1`.

5. `trading-cli dataset publish`
   - Uses `publishDatasetLonaV1`.

6. `trading-cli dataset get|status`
   - Uses `getDatasetV1`.

7. `trading-cli dataset list`
   - Uses `listDatasetsV1`.

## Conversation Commands

1. `trading-cli conversation session create`
   - Uses `createConversationSessionV2`.

2. `trading-cli conversation session get`
   - Uses `getConversationSessionV2`.

3. `trading-cli conversation turn create`
   - Uses `createConversationTurnV2`.

## Examples

```bash
trading-cli research scan --asset-classes crypto,stocks --capital 50000 --version v2

trading-cli strategy list --status tested

trading-cli deploy create --strategy-id strat-001 --mode paper --capital 10000

trading-cli dataset upload init --filename btc-1h.csv --content-type text/csv --size-bytes 1024

trading-cli dataset status --dataset-id dataset-001

trading-cli conversation session create --channel cli --topic "market prep"
```

## Output Policy

- JSON output is canonical for automation and cross-tool integration.
- Errors are emitted as structured JSON objects with HTTP/request metadata when available.
- Table output remains deterministic when `--output table` is selected.
