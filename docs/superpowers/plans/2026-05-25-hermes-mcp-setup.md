# Hermes MCP Setup

## Connect WDG Bank Agent to Hermes

Run the following command to add the WDG Bank Agent as an MCP server in Hermes:

```bash
hermes mcp add wdg-bank-agent \
  --url http://localhost:4100/api/mcp \
  --name "WDG 银行流水审批"
```

## Available Tools

Once connected, the following tools are available:

| Tool | Description |
|------|-------------|
| `upload_bank_txn_file` | Upload a bank statement Excel file, trigger import pipeline |
| `get_unclassified_transactions` | Get list of unclassified bank transactions |
| `get_transaction_detail` | Get detailed info for a specific transaction |
| `get_candidates` | Get keyword candidates for a transaction |
| `get_existing_rules` | Get existing classification rules |
| `submit_approval_proposal` | Submit LLM-generated classification proposals |
| `query_approval_status` | Poll approval status of submitted proposals |

## Testing the Connection

```bash
# Test MCP server responds
curl http://localhost:4100/api/mcp
# Expected: JSON with name, version, tools list

# List tools via JSON-RPC
curl -X POST http://localhost:4100/api/mcp \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'
```

## Disconnect

```bash
hermes mcp remove wdg-bank-agent
```