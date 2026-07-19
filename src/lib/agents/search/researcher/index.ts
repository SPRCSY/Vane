import { ActionOutput, ResearcherInput, ResearcherOutput } from '../types';
import { ActionRegistry } from './actions';
import {
  getResearcherStateMessage,
  getResearcherSystemPrompt,
} from '@/lib/prompts/search/researcher';
import SessionManager from '@/lib/session';
import { Message, ReasoningResearchBlock } from '@/lib/types';
import formatChatHistoryAsString from '@/lib/utils/formatHistory';
import { ToolCall } from '@/lib/models/types';

class Researcher {
  async research(
    session: SessionManager,
    input: ResearcherInput,
  ): Promise<ResearcherOutput> {
    let actionOutput: ActionOutput[] = [];
    let maxIteration =
      input.config.mode === 'speed'
        ? 2
        : input.config.mode === 'balanced'
          ? 6
          : 25;

    const allTools = ActionRegistry.getAllActionTools({
      mode: input.config.mode,
    });

    const availableToolNames = ActionRegistry.getAvailableActionNames({
      classification: input.classification,
      fileIds: input.config.fileIds,
      mode: input.config.mode,
      sources: input.config.sources,
    });
    const availableToolNameSet = new Set(availableToolNames);

    const researchBlockId = crypto.randomUUID();

    session.emitBlock({
      id: researchBlockId,
      type: 'research',
      data: {
        subSteps: [],
      },
    });

    const researcherSystemPrompt = getResearcherSystemPrompt();
    const conversation = formatChatHistoryAsString(
      input.chatHistory.slice(-10),
    );
    const agentMessageHistory: Message[] = [];

    for (let i = 0; i < maxIteration; i++) {
      const researcherStateMessage = getResearcherStateMessage({
        mode: input.config.mode,
        iteration: i,
        maxIteration,
        allowedTools: availableToolNames,
        fileIds: input.config.fileIds,
        conversation,
        followUp: input.followUp,
        standaloneFollowUp: input.classification.standaloneFollowUp,
        includeTaskContext: i === 0,
      });
      agentMessageHistory.push({
        role: 'user',
        content: researcherStateMessage,
      });

      const actionStream = input.config.llm.streamText({
        messages: [
          {
            role: 'system',
            content: researcherSystemPrompt,
          },
          ...agentMessageHistory,
        ],
        tools: allTools,
      });

      const block = session.getBlock(researchBlockId);

      let reasoningEmitted = false;
      let reasoningId = crypto.randomUUID();

      let finalToolCalls: ToolCall[] = [];

      for await (const partialRes of actionStream) {
        if (partialRes.toolCallChunk.length > 0) {
          partialRes.toolCallChunk.forEach((tc) => {
            if (
              tc.name === '__reasoning_preamble' &&
              availableToolNameSet.has('__reasoning_preamble') &&
              tc.arguments['plan'] &&
              !reasoningEmitted &&
              block &&
              block.type === 'research'
            ) {
              reasoningEmitted = true;

              block.data.subSteps.push({
                id: reasoningId,
                type: 'reasoning',
                reasoning: tc.arguments['plan'],
              });

              session.updateBlock(researchBlockId, [
                {
                  op: 'replace',
                  path: '/data/subSteps',
                  value: block.data.subSteps,
                },
              ]);
            } else if (
              tc.name === '__reasoning_preamble' &&
              availableToolNameSet.has('__reasoning_preamble') &&
              tc.arguments['plan'] &&
              reasoningEmitted &&
              block &&
              block.type === 'research'
            ) {
              const subStepIndex = block.data.subSteps.findIndex(
                (step: any) => step.id === reasoningId,
              );

              if (subStepIndex !== -1) {
                const subStep = block.data.subSteps[
                  subStepIndex
                ] as ReasoningResearchBlock;
                subStep.reasoning = tc.arguments['plan'];
                session.updateBlock(researchBlockId, [
                  {
                    op: 'replace',
                    path: '/data/subSteps',
                    value: block.data.subSteps,
                  },
                ]);
              }
            }

            const existingIndex = finalToolCalls.findIndex(
              (ftc) => ftc.id === tc.id,
            );

            if (existingIndex !== -1) {
              finalToolCalls[existingIndex].arguments = tc.arguments;
            } else {
              finalToolCalls.push(tc);
            }
          });
        }
      }

      if (finalToolCalls.length === 0) {
        break;
      }

      if (finalToolCalls[finalToolCalls.length - 1].name === 'done') {
        break;
      }

      agentMessageHistory.push({
        role: 'assistant',
        content: '',
        tool_calls: finalToolCalls,
      });

      const actionResults = await Promise.all(
        finalToolCalls.map(async (toolCall) => {
          if (!availableToolNameSet.has(toolCall.name)) {
            return {
              type: 'tool_error',
              error: `Tool "${toolCall.name}" is not allowed in the current research state. Allowed tools: ${availableToolNames.join(', ')}`,
            } as ActionOutput;
          }

          return ActionRegistry.execute(toolCall.name, toolCall.arguments, {
            llm: input.config.llm,
            embedding: input.config.embedding,
            session: session,
            researchBlockId: researchBlockId,
            fileIds: input.config.fileIds,
            mode: input.config.mode,
          });
        }),
      );

      actionOutput.push(...actionResults);

      actionResults.forEach((action, i) => {
        agentMessageHistory.push({
          role: 'tool',
          id: finalToolCalls[i].id,
          name: finalToolCalls[i].name,
          content: JSON.stringify(action),
        });
      });
    }

    const searchResults = actionOutput
      .filter((a) => a.type === 'search_results')
      .flatMap((a) => a.results);

    const seenUrls = new Map<string, number>();

    const filteredSearchResults = searchResults
      .map((result, index) => {
        if (result.metadata.url && !seenUrls.has(result.metadata.url)) {
          seenUrls.set(result.metadata.url, index);
          return result;
        } else if (result.metadata.url && seenUrls.has(result.metadata.url)) {
          const existingIndex = seenUrls.get(result.metadata.url)!;

          const existingResult = searchResults[existingIndex];

          existingResult.content += `\n\n${result.content}`;

          return undefined;
        }

        return result;
      })
      .filter((r) => r !== undefined);

    session.emitBlock({
      id: crypto.randomUUID(),
      type: 'source',
      data: filteredSearchResults,
    });

    return {
      findings: actionOutput,
      searchFindings: filteredSearchResults,
    };
  }
}

export default Researcher;
