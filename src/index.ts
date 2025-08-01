import { logger, type IAgentRuntime, type Project, type ProjectAgent, type Memory } from '@elizaos/core';
import openAIPlugin from "@elizaos/plugin-openai";
import { HttpAgent } from '@dfinity/agent';
import { nnsPlugin } from '@crosschainlabs/plugin-icp-nns';

import { character } from './character.ts';
import { v4 as uuidv4 } from 'uuid';
import { createActor } from './declarations/ai-neuron-backend/';
import { createActor as createWorkerActor} from "./declarations/ai-neuron-backend-worker/";

import { encoding_for_model, TiktokenModel } from '@dqbd/tiktoken';

import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import pemfile from 'pem-file';
import fs from 'fs';
import path from 'path';
import fetch from "isomorphic-fetch";

const IcOsVersionElection = 13;
const ProtocolCanisterManagement = 17;
const ProposalStatusOpen = 1;
const MAX_STEPS = 2;

const getSecp256k1Identity = () => {

  const filePath = "~/CCL/CrossChainLabs-ICP/identity/identity.pem";

  const homeDir = process.env.HOME ?? process.env.USERPROFILE;
  if (!homeDir) {
    throw new Error("Cannot resolve HOME or USERPROFILE for expanding '~'");
  }

  const expanded = filePath.replace(
    /^~(?=$|\/|\\)/,
    homeDir
  );

  const absolute = path.resolve(expanded);
  const rawKey = fs.readFileSync(absolute, "utf-8");

  return Secp256k1KeyIdentity.fromSecretKey(
    pemfile.decode(rawKey.replace(/(\n)\s+/g, '$1'),).slice(7, 39),);
};

async function createStorageActor() {
  const identity = getSecp256k1Identity();

  const agent = await HttpAgent.create({ identity: identity, host: 'http://127.0.0.1:4943', fetch });

  //const agent = await HttpAgent.create({ host: 'https://ic0.app' });
  const canisterId = 'uxrrr-q7777-77774-qaaaq-cai';
  return createActor(canisterId, { agent });
}

async function saveReport(proposalID: string, base64Title: string, base64Report: string) {
  const storageActor = await createStorageActor();
  let response = undefined;

  try {
    const status = await storageActor.autoscale();
    if (status == 0n) {
      logger.info(`autoscale succesful`);
      response = await storageActor.saveReport(proposalID, base64Title, base64Report);
    } else {
      logger.error(`autoscale failed, error code: ${status}`);
    }
  } catch (error) {
    logger.error(`saveReport failed, error : ${error}`);
  }

  return response;
}

async function haveReport(proposalID: string) : Promise<boolean> {
  const identity = getSecp256k1Identity();
  const storageActor = await createStorageActor();

  let haveReport = false;

  const agent = await HttpAgent.create({identity: identity, host: 'http://127.0.0.1:4943', fetch });
  //const agent = await HttpAgent.create({identity: identity, host: 'https://ic0.app', fetch });


  try {
    let workers = [];

    const workers_list = await storageActor.get_workers();

    if (workers_list?.length > 0) {
      for (const w of workers_list) {
        workers.push(createWorkerActor(w, { agent }));
      }
    }

    for (const worker of workers) {
      const report = await worker.get_report(proposalID);

      if (report?.proposalID == proposalID) {
        haveReport = true;
      }
    }
  } catch (error) {
    //console.log(`haveReport failed, error : ${error}`);
  }

  return haveReport;
}


/**
 * Initialize the character in a headless (no-UI) environment.
 */
const initCharacter = async ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing character (headless mode)');
  logger.info(`Name: ${character.name}`);
};

/**
 * If the model wrapped the JSON in ```json…```, extract only that block.
 */
function stripJsonFences(input: string): string {
  const fencePattern = /```json(?:\r?\n)?([\s\S]*?)```/;
  const match = input.match(fencePattern);
  return match ? match[1].trim() : input;
}

/**
 * Normalize common JSON glitches so we can reliably JSON.parse.
 */
function fixJson(text: string): string {
  return text
    // 1) Convert single-quoted values to double-quoted
    .replace(/:\s*'([^']*)'/g, ':"$1"')
    // 2) Quote unquoted keys (start of object/array or comma)
    .replace(/([\{\[,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":')
    // 3) Wrap unquoted word values (e.g., severity: high)
    .replace(/:\s*([a-zA-Z_][a-zA-Z0-9_-]*)\s*(,|\}|\])/g, ':"$1"$2')
    // 4) Remove ellipses placeholders
    .replace(/\.\.\./g, '')
    // 5) Strip trailing commas before ] or }
    .replace(/,(\s*[\]}])/g, '$1')
    // 6) Convert null severity to empty string
    .replace(/"severity"\s*:\s*null/g, '"severity":""')
    .trim();
}

function objectToBase64(obj: unknown): string {
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8').toString('base64');
}


/**
 * The ProjectAgent runs without a UI and triggers the nnsPlugin provider on a timer.
 */
export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => {
    // Inline utility functions to capture `runtime`
    const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

    const callWithRetry = async (
      model: string,
      opts: { prompt: string },
      maxRetries = 5
    ): Promise<string> => {
      let attempt = 0;
      while (true) {
        try {
          return await runtime.useModel(model, opts);
        } catch (err: any) {
          const msg = err.message || '';
          const match = msg.match(/Please try again in ([0-9.]+)s/);
          if (match && attempt < maxRetries) {
            const waitSec = parseFloat(match[1]);
            attempt++;
            logger.warn(`Rate limited (attempt ${attempt}). Backing off for ${waitSec}s`);
            await sleep(waitSec * 1000);
            continue;
          }
          throw err;
        }
      }
    };

    const auditDiffInChunks = async (
      diffText: string,
      modelName: TiktokenModel = 'gpt-4o'
    ): Promise<{
      issues: Array<{ line: number; severity: 'low' | 'medium' | 'high'; file: string; issue: string }>;
    }> => {
      // Define allowed code file extensions
      const allowedExt = [
        '.ts', '.js', '.jsx', '.tsx', '.java', '.py', '.go', '.rs', '.cpp', '.c', '.cs'
      ];

      // Split the diff into per-file chunks
      const fileDiffs = diffText.split(/(?=^diff --git )/m);

      // Filter chunks to only include allowed code file types
      const filteredDiffs = fileDiffs.filter(chunk => {
        const match = chunk.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
        if (!match) return false;
        const filePath = match[1];
        return allowedExt.some(ext => filePath.endsWith(ext));
      });

      // Rejoin filtered diff text
      const filteredText = filteredDiffs.join('\n');

      // Prepare tokenizer
      const encoder = encoding_for_model(modelName);
      const tokens = encoder.encode(filteredText);
      const maxChunk = 4000;
      const allIssues: Array<any> = [];

      // Process in token-sized slices
      let step = 0;
      
      for (let pos = 0; pos < tokens.length; pos += maxChunk) {
        const slice = tokens.slice(pos, pos + maxChunk);
        const chunk = encoder.decode(Uint32Array.from(slice));

        step++;
        logger.info(`Analize chunk ${step} `);

        const prompt = `You are a code review assistant. Analyze the following git diff chunk and identify any security, performance, or code-quality issues. Use "high" severity only for exceptional or critical cases.
` +
          `Return ONLY one JSON object (no markdown, no comments) that strictly follows this schema:
` +
          `{
` +
          `  "issues": [
` +
          `    {
` +
          `      "line": <number>,        // the line number in the diff
` +
          `      "severity": "low" | "medium" | "high",
` +
          `      "file": "<relative path>",  // path to the file where issue was found
` +
          `      "issue": "<concise description>"
` +
          `    }
` +
          `  ]
` +
          `}
---
` +
          `${chunk}`;

        let raw = '';

        const sanitizeJson = (text: string): string => text.trim();

        try {
          raw = await callWithRetry('TEXT_LARGE', { prompt });
          const stripped = stripJsonFences(raw);
          const cleaned = sanitizeJson(stripped);
          const fixed = fixJson(cleaned);
          const parsed = JSON.parse(fixed);

          if (parsed.issues && Array.isArray(parsed.issues)) {
            const validIssues = (parsed.issues as {
              line: number;
              severity: 'low' | 'medium' | 'high';
              file: string;
              issue: string;
            }[])
              .filter((issue): issue is {
                line: number;
                severity: 'low' | 'medium' | 'high';
                file: string;
                issue: string;
              } =>
                issue.file !== '/dev/null' &&
                issue.file !== '<relative path>'
              )
              .map((issue) => ({
                ...issue,
                file: issue.file.replace(/^(?:a\/|b\/)/, '')
              }));
            allIssues.push(...validIssues);
          }

        } catch (error) {
          console.log(raw);
          console.log(error);
        }

        // Throttle between chunks
        await sleep(2000);

        if (step >= MAX_STEPS) {
          break;
        }

      };

      return { issues: allIssues };
    }

    // Character initialization
    await initCharacter({ runtime });

    const intervalMs = 10_000;
    let runningLoop = false;
    const timerId = setInterval(async () => {
      try {

        if (runningLoop) {
          return;
        }

        runningLoop = true;

        // Locate the provider from nnsPlugin
        const nnsProvider = nnsPlugin.providers?.find(
          (p) => p.name === 'GOVERNANCE_PROVIDER'
        );
        if (!nnsProvider) throw new Error('NNS GOVERNANCE_PROVIDER not found');

        // Generate a valid paced UUID for Memory fields
        const newId = uuidv4() as `${string}-${string}-${string}-${string}-${string}`;
        const newEntityId = uuidv4() as `${string}-${string}-${string}-${string}-${string}`;
        const newRoomId = uuidv4() as `${string}-${string}-${string}-${string}-${string}`;

        logger.info('Start fetching proposals from NNS.');

        const nnsMessage = {
          id: newId,
          entityId: newEntityId,
          roomId: newRoomId,
          content: { text: `!proposals 10 topic ${ProtocolCanisterManagement}`, source: 'test' },
        } as unknown as Memory;
        // Invoke the provider with the real runtime and empty state
        const resultNNS = await nnsProvider.get(runtime, nnsMessage, {} as any);
        //logger.info('NNS Provider result:', resultNNS);

        interface Proposal {
          id: string;
          title: string;
          summary: string;
          topic: string;
          status: string;
          timestamp: bigint;
        }

        const proposals = (resultNNS.data as { proposals: Proposal[] }).proposals;
        proposals.reverse();

        logger.info(`Fetched ${proposals.length} proposals.`);

        for (const proposal of proposals) {
          //check if we already have the report
          const haveReportWithID = await haveReport(proposal.id);
          if (haveReportWithID)  {
            logger.info(`Report already exists for proposal ${proposal.id}`);
            continue;
          }

          if (!proposal.summary) continue;

          logger.info(`Analize proposal ${proposal.id} ${proposal.title}`);

          try {

            await sleep(1000); // throttle summary extraction
            // 1) Prompt the model and ask for strict JSON output
            const raw = await callWithRetry(
              'TEXT_LARGE',
              {
                prompt: `
                From the following proposal summary, 
                extract the repository, 
                the latest commit hash and the previous commit hash, 
                and return them as JSON with keys "repository", "latestCommit" and "previousCommit":\n\n${proposal.summary}\n\n 
                Respond only with this strict JSON schema:
                {
                  "repository":,
                  "latestCommit":
                  "previousCommit":,
                }`
              });

            //Parse the JSON response
            const { repository, latestCommit, previousCommit } = JSON.parse(stripJsonFences(raw));

            if (repository && latestCommit && previousCommit) {

              logger.info(
                `Repo: ${repository}, latestCommit=${latestCommit}, previousCommit=${previousCommit}`
              );


              logger.info(`Download code from GitHub.`);

              //Download Changes between previousCommit and latestCommit
              // 1) Compute GitHub API compare URL
              const apiRepo = repository
                .replace('https://github.com/', 'https://api.github.com/repos/')
                .replace(/\.git$/, '');
              const compareUrl = `${apiRepo}/compare/${previousCommit}...${latestCommit}`;

              // 2) Fetch the raw diff
              const diffResp = await fetch(compareUrl, {
                headers: { Accept: 'application/vnd.github.v3.diff' },
              });
              if (!diffResp.ok) {
                throw new Error(`Failed to fetch diff: ${diffResp.status} ${diffResp.statusText}`);
              }
              const diffText = await diffResp.text();

              logger.info(`Download complete.`);

              logger.info(`Fetched diff (${diffText.length} chars).`);

              logger.info(`Analyze code.`);

              // 3) Audit the diff with OpenAI
              const rawAudit = await auditDiffInChunks(diffText);

              logger.info(`Analysis complete.`);

              const audit = rawAudit;

              const report = {
                id: proposal.id,
                title: proposal.title,
                summary: proposal.summary,
                topic: proposal.topic,
                status: proposal.status,
                timestamp: proposal.timestamp.toString(),
                repository: repository,
                latestCommit: latestCommit, 
                previousCommit: previousCommit,
                audit,
              };

              logger.info(`Save report on-chain.`);

              const base64Report = objectToBase64(report);
              const base64Title = objectToBase64(proposal.title);
              const saveResult = await saveReport(proposal.id, base64Title, base64Report);

              logger.info(`Report saved.`, saveResult);
            } else {
              logger.info(`Skip proposal ${proposal.id} : Unable to extract proposal details from summary`);
            }
          } catch (e) {
            logger.error(
              `Error for proposal "${proposal.id}"`, e
            );
          }
        }

      } catch (err) {
        logger.error('Error :', err);
      }

      runningLoop = false;
    }, intervalMs);
  },
  plugins: [openAIPlugin, nnsPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

//export { testSuites } from './__tests__/e2e';
export { character } from './character.ts';
export default project;
