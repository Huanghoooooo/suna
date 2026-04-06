import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';

const mdxSource = docs.toFumadocsSource();

export const source = loader({
  baseUrl: '/docs',
  source: {
    // fumadocs-mdx v11 returns files as a function, but fumadocs-core v15 expects an array
    files: typeof mdxSource.files === 'function' ? mdxSource.files() : mdxSource.files,
  },
});
