import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const source = loader({
  baseUrl: '/docs',
  source: {
    files: docs.toFumadocsSource().files as any,
  },
} as any);
