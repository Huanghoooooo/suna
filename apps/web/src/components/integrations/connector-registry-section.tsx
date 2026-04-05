"use client";

import { cn } from '@/lib/utils';
import React, { useState } from 'react';
import { Terminal, KeyRound, Plug, Globe, FileText, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { useKortixConnectors, type KortixConnector } from '@/hooks/kortix/use-kortix-connectors';
import type { IntegrationConnection } from '@/hooks/integrations';

const SOURCE_CONFIG: Record<string, { icon: typeof Plug; label: string; color: string }> = {
  pipedream: { icon: Plug,      label: 'Pipedream', color: 'text-emerald-500' },
  cli:       { icon: Terminal,  label: 'CLI',       color: 'text-blue-500' },
  'api-key': { icon: KeyRound,  label: 'API Key',   color: 'text-amber-500' },
  mcp:       { icon: Globe,     label: 'MCP',       color: 'text-purple-500' },
  custom:    { icon: FileText,  label: 'Custom',    color: 'text-muted-foreground' },
};

function ConnectorCard({ connector, pipedreamConnections }: { connector: KortixConnector; pipedreamConnections: IntegrationConnection[] }) {
  const [expanded, setExpanded] = useState(false);
  const source = connector.source || 'custom';
  const cfg = SOURCE_CONFIG[source] || SOURCE_CONFIG.custom!;
  const Icon = cfg.icon;
  const slug = connector.pipedream_slug || connector.name;
  const liveConnection = pipedreamConnections.find(c => c.app === slug || c.app === connector.name);
  const isLive = !!liveConnection;

  return (
    <div className="rounded-xl border border-border/50 bg-card transition-colors hover:border-border overflow-hidden cursor-pointer" onClick={() => setExpanded(!expanded)}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border/30 bg-muted/50', cfg.color)}>
          <Icon className="h-3.5 w-3.5" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{connector.name}</span>
            {isLive && <span className="flex h-2 w-2 rounded-full bg-emerald-500 shrink-0" title="Live" />}
          </div>
          {connector.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{connector.description}</p>}
        </div>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal shrink-0">{cfg.label}</Badge>
        {expanded ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
      </div>
      {expanded && (
        <div className="px-4 pb-3 pt-0 border-t border-border/30 space-y-1.5">
          {connector.pipedream_slug && <div className="text-xs pt-2"><span className="text-muted-foreground">pipedream:</span> <span className="font-mono">{connector.pipedream_slug}</span></div>}
          {connector.env_keys && connector.env_keys.length > 0 && <div className="text-xs"><span className="text-muted-foreground">env:</span> <span className="font-mono">{connector.env_keys.join(', ')}</span></div>}
          {connector.notes && <p className="text-xs text-muted-foreground pt-1">{connector.notes}</p>}
          {isLive && liveConnection && (
            <div className="flex items-center gap-2 pt-1">
              <span className="flex h-2 w-2 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-xs text-emerald-600">Live as <span className="font-mono">{liveConnection.app}</span></span>
            </div>
          )}
          <div className="text-[10px] text-muted-foreground/50 pt-1">{connector.auto_generated ? 'Auto-created · ' : ''}{new Date(connector.updated_at).toLocaleDateString()}</div>
        </div>
      )}
    </div>
  );
}

export function ConnectorRegistrySection({ pipedreamConnections }: { pipedreamConnections: IntegrationConnection[] }) {
  const { data: connectors, isLoading } = useKortixConnectors();
  if (isLoading || !connectors || connectors.length === 0) return null;

  const sorted = [...connectors].sort((a, b) => {
    const aLive = pipedreamConnections.some(c => c.app === (a.pipedream_slug || a.name));
    const bLive = pipedreamConnections.some(c => c.app === (b.pipedream_slug || b.name));
    if (aLive !== bLive) return aLive ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  const liveCount = sorted.filter(c => pipedreamConnections.some(pc => pc.app === (c.pipedream_slug || c.name))).length;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Your Connectors</h2>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-normal">{liveCount} live · {connectors.length} total</Badge>
      </div>
      <p className="text-xs text-muted-foreground mb-4">Click to expand details.</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {sorted.map(c => <ConnectorCard key={c.id} connector={c} pipedreamConnections={pipedreamConnections} />)}
      </div>
    </div>
  );
}
