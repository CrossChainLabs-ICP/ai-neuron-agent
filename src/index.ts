import { logger, type IAgentRuntime, type Project, type ProjectAgent, type Memory } from '@elizaos/core';
import openAIPlugin from "@elizaos/plugin-openai";
import { Actor, HttpAgent } from '@dfinity/agent';
import { nnsPlugin } from '@crosschainlabs/plugin-icp-nns';

import { character } from './character.ts';
import { v4 as uuidv4 } from 'uuid';
import { idlFactory } from './ai-neuron-canister/ai-neuron-backend/';
import { encoding_for_model, TiktokenModel } from '@dqbd/tiktoken';

import { Secp256k1KeyIdentity } from "@dfinity/identity-secp256k1";
import pemfile from 'pem-file';
import fs from 'fs';
import path from 'path';

const IcOsVersionElection = 13;
const ProtocolCanisterManagement = 17;
const ProposalStatusOpen = 1;

const getSecp256k1Identity = () => {
  //let filePath = '~/.config/dfx/identity/ai-neuron/identity.pem';
  //const rawKey = fs.readFileSync(path.resolve(filePath.replace(/^~(?=$|\/|\\)/, process.env.HOME || process.env.USERPROFILE))).toString();

  const filePath = "~/.config/dfx/identity/ai-neuron/identity.pem";

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

  const agent = await HttpAgent.create({ identity: identity, host: 'http://127.0.0.1:4943' });

  //const agent = await HttpAgent.create({ host: 'https://ic0.app' });
  const canisterId = 'uxrrr-q7777-77774-qaaaq-cai';
  return Actor.createActor(idlFactory, { agent, canisterId });
}

async function saveReport(proposalID: String, report: String) {
  const storageActor = await createStorageActor();
  let response = undefined;

  try {
    const status = await storageActor.autoscale();
    if (status == 0) {
        logger.info(`autoscale succesful`);
        response = await storageActor.saveReport(proposalID, report);
    } else {
        logger.error(`autoscale failed, error code: ${status}`);
    }
  } catch (error) {
    logger.error(`saveReport failed, error : ${error}`);
  }

  return response;
}


/**
 * Initialize the character in a headless (no-UI) environment.
 */
const initCharacter = async ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing character (headless mode)');
  logger.info(`Name: ${character.name}`);
};

function stripJsonFences(input: string): string {
  // Matches ```json or ```json\r?\n, captures everything up to the next ```
  const fencePattern = /```json(?:\r?\n)?([\s\S]*?)```/;
  const match = input.match(fencePattern);
  return match ? match[1].trim() : input;
}

function fixJson(text: string): string {
  return text
    // Quote un‐quoted severity values
    .replace(/"severity"\s*:\s*(low|medium|high)/g, '"severity":"$1"')
    // Ensure file and issue keys are quoted
    .replace(/\bfile\s*:/g, '"file":')
    .replace(/\bissue\s*:/g, '"issue":')
    // Catch patterns like `", foo", :` → `"foo":`
    .replace(/"\s*,\s*([a-zA-Z_][a-zA-Z0-9_]*)"\s*,\s*:/g, '"$1":');
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
    ): Promise<{ issues: Array<any> }> => {
      const encoder = encoding_for_model(modelName);
      const tokens = encoder.encode(diffText);
      const maxChunk = 4000;
      const allIssues: any[] = [];

      for (let pos = 0; pos < tokens.length; pos += maxChunk) {
        const slice = tokens.slice(pos, pos + maxChunk);
        const chunk = encoder.decode(Uint32Array.from(slice));

        const prompt = `Please review the following git diff chunk for security, performance, or other code-quality issues. Respond only with valid JSON strictly following this schema (no markdown fences, no extra text):
{
  "issues": [
    { "line": number, "severity": "low|medium|high", "file": "<path>", "issue": "<description>" },
    ...
  ]
}
---
${chunk}`;

        const raw = await callWithRetry('TEXT_LARGE', { prompt });
        logger.info('raw', raw);
        const strip = fixJson(stripJsonFences(raw));
        logger.info('strip', strip);
        const parsed = JSON.parse(strip);
        logger.info('parsed', parsed);
        if (parsed.issues && Array.isArray(parsed.issues)) {
          allIssues.push(...parsed.issues);
        }
        await sleep(2000);
      }

      return { issues: allIssues };
    };

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

        logger.info(`Fetched ${proposals.length} proposals.`);

        for (const proposal of proposals) {
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

            // 2) Parse the JSON response
            const { repository, latestCommit, previousCommit } = JSON.parse(stripJsonFences(raw));

            if (repository && latestCommit && previousCommit) {
              /*
              const repository = "https://github.com/dfinity/cycles-ledger.git";
              const latestCommit = "93f5c0f5779e31673786c83aa50ff2bbf9650162";
              const previousCommit = "01236e4d60738fc2277d47d16b95f28cff564370";
              */

              // 3) Now you can log or use them however you like
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

              logger.info(`Fetched diff (${diffText.length} chars)`);

              logger.info(`Analyze code.`);

              // 3) Audit the diff with OpenAI
              const auditPrompt = `
            Please review the following git diff for security, performance, 
            or other code‐quality issues. Without comments or notes.
            Respond only with this strict JSON schema:
            {
              "issues": [
                {
                  "line": <number>,
                  "severity": <low|medium|high>
                  "file": "<path/to/file>",
                  "issue": "<description>"
                },
                ...
              ]
            }
            ---
            ${diffText}
            `;
              //const rawAudit = await runtime.useModel('TEXT_LARGE', { prompt: auditPrompt });
              const rawAudit = await auditDiffInChunks(diffText);

              logger.info(`Analysis complete.`);

              //const audit = JSON.parse(stripJsonFences(rawAudit));
              const audit = rawAudit;

              logger.info(rawAudit);

              const report = {
                id: proposal.id,
                title: proposal.title,
                summary: proposal.summary,
                topic: proposal.topic,
                status: proposal.status,
                timestamp: proposal.timestamp.toString(),
                audit,
              };

              logger.info(`Save report on-chain.`);

              const base64Report = objectToBase64(report);

              console.log({
                id: proposal.id,
                base64Title: objectToBase64(proposal.title),
                base64Report: base64Report
              });

              const saveResult = await saveReport(proposal.id, base64Report);

              logger.info(`Report saved.`, saveResult);
            } else {
              logger.info(`Skip proposal ${proposal.id} : Unable to extract proposal details from summary`);
            }
          } catch (e) {
            logger.error(
              `Error for proposal "${proposal.id}"`, e
            );
          }

          //break;
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

export { testSuites } from './__tests__/e2e';
export { character } from './character.ts';
export default project;
