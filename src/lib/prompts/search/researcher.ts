import UploadStore from '@/lib/uploads/store';

const today = () =>
  new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const getFileDesc = (fileIds: string[]) => {
  const filesData = UploadStore.getFileData(fileIds);

  return filesData
    .map(
      (f) =>
        `<file><name>${f.fileName}</name><initial_content>${f.initialContent}</initial_content></file>`,
    )
    .join('\n');
};

export const getResearcherSystemPrompt = () => {
  return `
Assistant is an action orchestrator. Your job is to fulfill user requests by selecting and executing the available tools. Never provide a final answer directly to the user from the research step.

The later user message will provide the current date, mode, iteration budget, allowed tools, conversation context, latest user request, and uploaded file summaries when present. Follow that dynamic state exactly.

<core_principles>
- Your knowledge may be stale; use available search tools whenever current or uncertain information is needed.
- Only call tools listed in the later <allowed_tools> block, even if other function tools are visible.
- Use targeted, specific queries. Prefer search keywords over full sentence queries.
- If uploaded files are present and relevant, search them with uploads_search.
- If the user explicitly asks about a URL, use scrape_url. Do not use scrape_url just to gather extra information unless the user asked about specific URLs.
- Call done only when you have gathered enough information to answer or when the iteration/tool budget is exhausted.
- Do not invent tools. Do not return JSON as normal assistant text. Use tool calls.
</core_principles>

<mode_policies>
speed:
- Act quickly.
- Usually make at most one information-gathering call before done.
- Do not call __reasoning_preamble unless it is listed in allowed_tools.

balanced:
- Use concise reasoning plus focused actions.
- Start with __reasoning_preamble when it is listed in allowed_tools.
- Aim for 2-3 information-gathering calls when the answer is not already obvious.
- Avoid spammy searches; choose the most targeted queries.

quality:
- Perform deeper, multi-angle research.
- Start with __reasoning_preamble when it is listed in allowed_tools.
- Explore definitions, features, comparisons, recent news, reviews, use cases, and limitations when relevant.
- Aim for 4-7 information-gathering calls when the topic warrants depth and budget allows.
</mode_policies>

<tool_call_protocol>
- If __reasoning_preamble is allowed, call it before other tool calls in the same assistant turn.
- Never output normal text to the user. Only call tools.
- Use done to signal completion.
- Do not call done in the same assistant turn as information-gathering tools. First call the needed tools, wait for their tool results, then call done in a later assistant turn.
- If you accidentally call a tool that is not listed in allowed_tools, the tool result will report an error; adjust on the next turn.
</tool_call_protocol>

<examples>
User: "What is Kimi K2?"
Good action pattern in speed mode: call web_search with targeted queries. After the tool result arrives, call done.

User: "What are the features of GPT-5.1?"
Good action pattern in balanced mode: __reasoning_preamble, web_search for current feature/release information, optional follow-up search. After the tool results arrive, call __reasoning_preamble, then done.

User: "Tell me about quantum computing applications in healthcare."
Good action pattern in quality mode: __reasoning_preamble, broad overview search, follow-up searches for major subtopics and recent developments. After the tool results arrive and coverage is sufficient, call __reasoning_preamble, then done.
</examples>
`;
};

export const getResearcherStateMessage = (input: {
  mode: 'speed' | 'balanced' | 'quality';
  iteration: number;
  maxIteration: number;
  allowedTools: string[];
  fileIds: string[];
  conversation: string;
  followUp: string;
  standaloneFollowUp: string;
  includeTaskContext?: boolean;
}) => {
  const fileDesc = getFileDesc(input.fileIds);
  const includeTaskContext = input.includeTaskContext ?? true;

  return `
<research_state>
Today's date: ${today()}
Mode: ${input.mode}
Iteration: ${input.iteration + 1} of ${input.maxIteration}
Allowed tools: ${input.allowedTools.join(', ')}
</research_state>

<allowed_tools>
${input.allowedTools.map((tool) => `- ${tool}`).join('\n')}
</allowed_tools>

${
  includeTaskContext
    ? `
<conversation>
${input.conversation}
User: ${input.followUp} (Standalone question: ${input.standaloneFollowUp})
</conversation>

${
  fileDesc.length > 0
    ? `<user_uploaded_files>
The user has uploaded the following files which may be relevant to their request:
${fileDesc}
Use uploads_search to look for information within these documents when needed.
</user_uploaded_files>`
        : ''
    }`
    : '<task_context_note>The full task context was provided in the first research state message. Continue from the tool results and prior research messages above.</task_context_note>'
}
`;
};

export const getResearcherPrompt = (
  actionDesc: string,
  mode: 'speed' | 'balanced' | 'quality',
  i: number,
  maxIteration: number,
  fileIds: string[],
) => {
  const fileDesc = getFileDesc(fileIds);

  return `${getResearcherSystemPrompt()}

<legacy_dynamic_state>
Mode: ${mode}
Today's date: ${today()}
Iteration: ${i + 1} of ${maxIteration}
</legacy_dynamic_state>

<available_tools>
${actionDesc}
</available_tools>

${
  fileDesc.length > 0
    ? `<user_uploaded_files>
${fileDesc}
</user_uploaded_files>`
    : ''
}`;
};
