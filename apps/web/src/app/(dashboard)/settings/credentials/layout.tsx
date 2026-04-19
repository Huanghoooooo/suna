import { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Secrets Manager | Wutong',
  description: 'Manage environment variables and API keys',
};

export default async function CredentialsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
