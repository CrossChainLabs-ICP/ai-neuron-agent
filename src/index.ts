import { logger, type IAgentRuntime, type Project, type ProjectAgent, type Memory } from '@elizaos/core';
import starterPlugin from './plugin.ts';
import { character } from './character.ts';
import { nnsPlugin } from '@crosschainlabs/plugin-icp-nns';
import { v4 as uuidv4 } from 'uuid';

const IcOsVersionElection = 13;
const ProtocolCanisterManagement = 17;
const ProposalStatusOpen = 1;

/**
 * Initialize the character in a headless (no-UI) environment.
 */
const initCharacter = async ({ runtime }: { runtime: IAgentRuntime }) => {
  logger.info('Initializing character (headless mode)');
  logger.info(`Name: ${character.name}`);
};

/**
 * The ProjectAgent runs without a UI and triggers the starterPlugin provider on a timer.
 */
export const projectAgent: ProjectAgent = {
  character,
  init: async (runtime: IAgentRuntime) => {
    // Character initialization
    await initCharacter({ runtime });

    // Schedule HELLO_WORLD_PROVIDER to run every minute (60000ms)
    const intervalMs = 10_000;
    setInterval(async () => {
      logger.info('Timer: invoking HELLO_WORLD_PROVIDER');
      try {
        // Locate the provider from starterPlugin
        const provider = starterPlugin.providers?.find(
          (p) => p.name === 'HELLO_WORLD_PROVIDER'
        );
        if (!provider) throw new Error('HELLO_WORLD_PROVIDER not found');


        // Locate the provider from starterPlugin
        const nnsProvider = nnsPlugin.providers?.find(
          (p) => p.name === 'GOVERNANCE_PROVIDER'
        );
        if (!nnsProvider) throw new Error('GOVERNANCE_PROVIDER not found');

        // Generate a valid paced UUID for Memory fields
        const newId = uuidv4() as `${string}-${string}-${string}-${string}-${string}`;
        const newEntityId = uuidv4() as `${string}-${string}-${string}-${string}-${string}`;
        const newRoomId = uuidv4() as `${string}-${string}-${string}-${string}-${string}`;

                // Create a dummy Memory for the timer trigger
        // Cast through unknown to satisfy Memory interface
        const timerMessage = {
          id: newId,
          entityId: newEntityId,
          roomId: newRoomId,
          content: { text: '', source: 'timer' },
        } as unknown as Memory;

        // Invoke the provider with the real runtime and empty state
        const result = await provider.get(runtime, timerMessage, {} as any);
        logger.info('Provider result:', result);


        const nnsMessage = {
          id: newId,
          entityId: newEntityId,
          roomId: newRoomId,
          content: { text: `!proposals 10 topic ${IcOsVersionElection}`, source: 'test' },
        } as unknown as Memory;
        // Invoke the provider with the real runtime and empty state
        const resultNNS = await nnsProvider.get(runtime, nnsMessage, {} as any);
        logger.info('NNS Provider result:', resultNNS);
      } catch (err) {
        logger.error('Error running HELLO_WORLD_PROVIDER:', err);
      }
    }, intervalMs);
  },
  plugins: [starterPlugin, nnsPlugin],
};

const project: Project = {
  agents: [projectAgent],
};

export { testSuites } from './__tests__/e2e';
export { character } from './character.ts';
export default project;
