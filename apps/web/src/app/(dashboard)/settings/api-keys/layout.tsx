import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'API Keys | Wutong',
  description: 'Manage your API keys for programmatic access to Wutong',
  openGraph: {
    title: 'API Keys | Wutong',
    description: 'Manage your API keys for programmatic access to Wutong',
    type: 'website',
  },
};

export default async function APIKeysLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
