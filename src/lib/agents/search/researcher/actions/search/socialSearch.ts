import z from 'zod';
import { ResearchAction } from '../../../types';
import { Chunk, ResearchBlock } from '@/lib/types';
import { executeSearch } from './baseSearch';

const schema = z.object({
  queries: z.array(z.string()).describe('List of social search queries'),
});

const socialSearchDescription = `
Use this tool to search Reddit, Bilibili, Zhihu, and Xiaohongshu for relevant posts, videos, discussions, and trends related to the user's query. Provide a list of concise search queries that will help gather comprehensive social media information on the topic at hand. Vane selects and targets the supported platforms automatically, so do not add site: operators to the queries.
You can provide up to 3 queries at a time. Make sure the queries are specific and relevant to the user's needs.

For example, if the user is interested in public opinion on electric vehicles, your queries could be:
1. "Electric vehicles public opinion 2024"
2. "Social media discussions on EV adoption"
3. "Trends in electric vehicle usage"

If this tool is present and no other tools are more relevant, you MUST use this tool to get the needed social media information.
`;

const isFromDomain = (result: Chunk, domain: string) => {
  try {
    const hostname = new URL(result.metadata.url).hostname.toLowerCase();
    return hostname === domain || hostname.endsWith(`.${domain}`);
  } catch {
    return false;
  }
};

const mergeResults = (groups: Chunk[][], limit: number) => {
  const results: Chunk[] = [];
  const seenUrls = new Set<string>();
  const maxGroupLength = Math.max(0, ...groups.map((group) => group.length));

  for (let i = 0; i < maxGroupLength && results.length < limit; i++) {
    for (const group of groups) {
      const result = group[i];
      const url = result?.metadata.url;

      if (!result || !url || seenUrls.has(url)) continue;

      seenUrls.add(url);
      results.push(result);

      if (results.length === limit) break;
    }
  }

  return results;
};

const socialSearchAction: ResearchAction<typeof schema> = {
  name: 'social_search',
  schema: schema,
  getDescription: () => socialSearchDescription,
  getToolDescription: () =>
    "Use this tool to search Reddit, Bilibili, Zhihu, and Xiaohongshu for relevant posts, videos, discussions, and trends related to the user's query. Provide concise queries without site: operators; Vane targets the supported platforms automatically.",
  enabled: (config) =>
    config.sources.includes('discussions') &&
    config.classification.classification.skipSearch === false &&
    config.classification.classification.discussionSearch === true,
  execute: async (input, additionalConfig) => {
    input.queries = (
      Array.isArray(input.queries) ? input.queries : [input.queries]
    ).slice(0, 3);

    const researchBlock = additionalConfig.session.getBlock(
      additionalConfig.researchBlockId,
    ) as ResearchBlock | undefined;

    if (!researchBlock) throw new Error('Failed to retrieve research block');

    const search = (
      queries: string[],
      searchConfig?: { engines: string[] },
    ) =>
      executeSearch({
        llm: additionalConfig.llm,
        embedding: additionalConfig.embedding,
        mode: additionalConfig.mode,
        queries,
        researchBlock: researchBlock,
        session: additionalConfig.session,
        searchConfig,
      });

    const searchSafely = async (
      platform: string,
      queries: string[],
      searchConfig?: { engines: string[] },
    ) => {
      try {
        return await search(queries, searchConfig);
      } catch (err) {
        console.error(`Failed to search ${platform}:`, err);
        return [];
      }
    };

    const [redditResults, bilibiliResults, zhihuResults, xiaohongshuResults] =
      await Promise.all([
        searchSafely('Reddit', input.queries, { engines: ['reddit'] }),
        searchSafely('Bilibili', input.queries, { engines: ['bilibili'] }),
        searchSafely(
          'Zhihu',
          input.queries.map((query) => `site:zhihu.com ${query}`),
        ),
        searchSafely(
          'Xiaohongshu',
          input.queries.map((query) => `site:xiaohongshu.com ${query}`),
        ),
      ]);

    const results = mergeResults(
      [
        redditResults,
        bilibiliResults,
        zhihuResults.filter((result) => isFromDomain(result, 'zhihu.com')),
        xiaohongshuResults.filter((result) =>
          isFromDomain(result, 'xiaohongshu.com'),
        ),
      ],
      20,
    );

    return {
      type: 'search_results',
      results: results,
    };
  },
};

export default socialSearchAction;
