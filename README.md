# AI Neuron Agent

**AI Neuron Agent** is the AI agent of the **AI-Driven Governance & Security for ICP** suite. It fetches proposals from the NNS, infers the target repository and commit range, audits the Git diff with an LLM, and stores a structured report on-chain in the AI Neuron canister.

> Part of the [**AI-Driven Governance & Security for ICP**](https://github.com/CrossChainLabs-ICP/ai-neuron) project.

---

## What it does

1. **Fetch proposals** via the [Eliza NNS plugin](https://github.com/CrossChainLabs-ICP/plugin-icp-nns).
2. **Extract repo + commit range** from the proposal summary using an LLM.
3. **Download and diff** the code between the two commits from GitHub.
4. **Audit the diff** in 4k‑token slices: detect issues with severity, file, and line.
5. **Persist the report on‑chain** via `saveReport(proposalID, base64Title, base64Report)`.
6. **Downstream consumption**: the web app reads & shows these reports; OC Bot posts summaries.

---

## Key capabilities

- Integrates the **Eliza** framework and an LLM.
- Uses **@crosschainlabs/plugin-icp-nns** to fetch proposals and filter by topic/status.
- Builds a structured **audit JSON** (issues with `low|medium|high` severity).
- Stores the audit report to the **AI Neuron backend canister** (Motoko).

---

## Prerequisites

- **Node.js** 24+ (recommended with **Bun** runtime)
- **OpenAI API key** (for `@elizaos/plugin-openai`)
- **ICP identity (Secp256k1)** PEM file for canister calls
- **Governance canister ID** (NNS) in env (used by the NNS plugin)
- **AI Neuron backend canister ID** in env (used to store audit reports)

---

## Quickstart

### 1) Install dependencies
```bash
bun install
```

### 2) Environment
Copy `.env.example` → `.env` and set at least:
```bash
OPENAI_API_KEY=<sk-...>
IDENTITY_PEM_FILE=<PEM file for canister calls>
GOVERNANCE_CANISTER_ID=<nns_governance_canister_id>
AI_NEURON_CANISTER_ID=<ai_neuron_canister_id>
ICP_HOST=<icp_host_url>
LOOP_INTERVAL=<loop_interval_seconds>
```

### 3) Build & run
```bash
bun run build
bun run dev      # starts the agent loop (elizaos dev)
```

---

## How it works (code-level)

### Fetch proposals (Eliza NNS plugin)
The agent invokes the NNS provider with a command like:
```ts
content: { text: `!proposals 10 topic ${topic}` }
```
The provider calls **NNS Governance** (`list_proposals` + `get_proposal_info`) and returns:
```ts
{ proposals: [{ id, title, summary, topic, status, timestamp }, ...] }
```

### Extract repo & commit range
The agent prompts the LLM to parse the proposal summary and return strict JSON:
```json
{
  "repository": "...",
  "latestCommit": "...",
  "previousCommit": "..."
}
```
It normalizes typical model glitches using helpers:
- `stripJsonFences()` – removes ```json code fences
- `fixJson()` – quotes keys, converts single quotes, etc.

### Fetch diff & audit in chunks
- Builds a GitHub **compare** URL and fetches raw **diff** (`Accept: application/vnd.github.v3.diff`).
- Splits by file, filters to code extensions, tokenizes per ~4k tokens, and prompts the LLM for findings:
```json
{
  "issues": [
    { "line": 123, "severity": "medium", "file": "src/x.ts", "issue": "..." }
  ]
}
```
- Aggregates all chunk outputs into a single `audit` object.

### Persist on‑chain

The on-chain **ReportItem** stored by the AI Neuron canister (consumed by the web app & OC Bot):

```ts
type ReportItem = {
  proposalID: string;
  proposalTitle: string; // base64-encoded (often a JSON string)
  report: string;        // base64-encoded JSON { id, title, summary, …, audit }
}
```

> The agent encodes both title and report as **base64 UTF‑8 JSON**.

---

## License

AGPL-3.0 — see [LICENSE](./LICENSE).

---

