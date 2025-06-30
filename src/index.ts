import { logger, type IAgentRuntime, type Project, type ProjectAgent, type Memory } from '@elizaos/core';
import openAIPlugin from "@elizaos/plugin-openai";
import { Actor, HttpAgent } from '@dfinity/agent';
import { nnsPlugin } from '@crosschainlabs/plugin-icp-nns';

import starterPlugin from './plugin.ts';
import { character } from './character.ts';
import { v4 as uuidv4 } from 'uuid';
import { idlFactory } from './ai-neuron-canister/ai-neuron-backend/';

const IcOsVersionElection = 13;
const ProtocolCanisterManagement = 17;
const ProposalStatusOpen = 1;

async function createStorageActor() {
  const agent = await HttpAgent.create({ host: 'http://127.0.0.1:4943' });
  //const agent = await HttpAgent.create({ host: 'https://ic0.app' });
  const canisterId = 'uxrrr-q7777-77774-qaaaq-cai';
  return Actor.createActor(idlFactory, { agent, canisterId });
}

async function saveReport(proposalID: String, report: String) {
  const storageActor = await createStorageActor();
  let response = undefined;

  try {
    response = await storageActor.saveReport(proposalID, report);
    
  } catch (error) {
    
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
  // ^```json\s*      → opening fence at start plus optional whitespace/newline
  // ([\s\S]*?)       → capture everything (including newlines), non-greedy
  // \s*```$          → optional whitespace/newline then closing fence at end
  const fencePattern = /^```json\s*([\s\S]*?)\s*```$/;

  const match = fencePattern.exec(input);
  return match ? match[1] : input;
}

function reportToBase64(obj: unknown): string {
  const json = JSON.stringify(obj);
  return Buffer.from(json, 'utf8').toString('base64');
}

/**
 * The ProjectAgent runs without a UI and triggers the nnsPlugin provider on a timer.
 */
export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => {
    // Character initialization
    await initCharacter({ runtime });


    const intervalMs = 10_000;
    const timerId = setInterval(async () => {
            try {

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

            // 1) Prompt the model and ask for strict JSON output
            const raw = await runtime.useModel(
              'TEXT_LARGE',
              {
                prompt: `
                From the following proposal summary, extract the repository, the latest commit hash and the previous commit hash, and return them as JSON with keys "repository", "latestCommit" and "previousCommit":\n\n${proposal.summary}\n\nRespond with ONLY the JSON object, but exclude formating \`\`\`json .`
              });

            // 2) Parse the JSON response
            const { repository, latestCommit, previousCommit } = JSON.parse(raw);

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
            const rawAudit = await runtime.useModel('TEXT_LARGE', { prompt: auditPrompt });

            logger.info(`Analysis complete.`);


            const audit = JSON.parse(stripJsonFences(rawAudit));

            logger.info(audit);

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

            const saveResult = await saveReport(proposal.id, reportToBase64(report));

            logger.info(`Report saved.`, saveResult);
          } catch (e) {
            logger.error(
              `Error for proposal "${proposal.id}"`, e
            );
          }

          break;
        }

      } catch (err) {
        logger.error('Error :', err);
      }
    }, intervalMs);
  },
  plugins: [nnsPlugin, openAIPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

export { testSuites } from './__tests__/e2e';
export { character } from './character.ts';
export default project;
