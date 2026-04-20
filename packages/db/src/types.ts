import { sandboxes, deployments, kortixApiKeys, integrationCredentials, integrations, sandboxIntegrations, serverEntries, accounts, accountMembers, creditAccounts, tunnelConnections, tunnelPermissions, tunnelPermissionRequests, tunnelAuditLogs, auditLogs } from './schema/kortix';
import { apiKeys, accountUser } from './schema/public';

// Select types (what you get back from queries)
export type Account = typeof accounts.$inferSelect;
export type AccountMember = typeof accountMembers.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;
export type NewAccountMember = typeof accountMembers.$inferInsert;
export type Sandbox = typeof sandboxes.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type CreditAccount = typeof creditAccounts.$inferSelect;
/** @deprecated Use AccountMember instead — basejump.account_user is being migrated to kortix.account_members */
export type AccountUser = typeof accountUser.$inferSelect;
export type KortixApiKey = typeof kortixApiKeys.$inferSelect;

// Insert types (what you pass to inserts)
export type NewSandbox = typeof sandboxes.$inferInsert;
export type Deployment = typeof deployments.$inferSelect;
export type NewDeployment = typeof deployments.$inferInsert;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type NewKortixApiKey = typeof kortixApiKeys.$inferInsert;
export type IntegrationCredential = typeof integrationCredentials.$inferSelect;
export type NewIntegrationCredential = typeof integrationCredentials.$inferInsert;
export type Integration = typeof integrations.$inferSelect;
export type NewIntegration = typeof integrations.$inferInsert;
export type SandboxIntegration = typeof sandboxIntegrations.$inferSelect;
export type NewSandboxIntegration = typeof sandboxIntegrations.$inferInsert;
export type ServerEntry = typeof serverEntries.$inferSelect;
export type NewServerEntry = typeof serverEntries.$inferInsert;

// Tunnel
export type TunnelConnection = typeof tunnelConnections.$inferSelect;
export type NewTunnelConnection = typeof tunnelConnections.$inferInsert;
export type TunnelPermission = typeof tunnelPermissions.$inferSelect;
export type NewTunnelPermission = typeof tunnelPermissions.$inferInsert;
export type TunnelPermissionRequest = typeof tunnelPermissionRequests.$inferSelect;
export type NewTunnelPermissionRequest = typeof tunnelPermissionRequests.$inferInsert;
export type TunnelAuditLog = typeof tunnelAuditLogs.$inferSelect;
export type NewTunnelAuditLog = typeof tunnelAuditLogs.$inferInsert;

export type AuditLog = typeof auditLogs.$inferSelect;
export type NewAuditLog = typeof auditLogs.$inferInsert;

// Aliases
export type SandboxSelect = Sandbox;
export type DeploymentSelect = Deployment;
