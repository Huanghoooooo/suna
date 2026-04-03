"use client";

import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowRight,
  ArrowLeft,
  ExternalLink,
  Loader2,
  Check,
  Copy,
  Globe,
  AlertCircle,
  Terminal,
  ChevronDown,
  ChevronUp,
  Play,
} from 'lucide-react';
import { useGenerateManifest } from '@/hooks/channels';
import { useNgrokStatus, useNgrokStart } from '@/hooks/channels';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { authenticatedFetch } from '@/lib/auth-token';
import { getActiveOpenCodeUrl, useServerStore } from '@/stores/server-store';
import { backendApi } from '@/lib/api-client';
import { ensureSandbox } from '@/lib/platform-client';
import { useQueryClient } from '@tanstack/react-query';
import { DEFAULT_CHANNEL_AGENT, buildDefaultChannelInstructions } from './channel-defaults';

interface SlackSetupWizardProps {
  onCreated: () => void;
  onBack: () => void;
  sandboxId?: string | null;
}

type WizardStep = 1 | 2 | 3;

function StepIndicator({ current }: { current: WizardStep }) {
  const steps = [
    { num: 1 as const, label: 'Public URL' },
    { num: 2 as const, label: 'Create App' },
    { num: 3 as const, label: 'Credentials' },
  ];

  return (
    <div className="flex items-center justify-center gap-0 px-6 py-4">
      {steps.map((s, i) => (
        <React.Fragment key={s.num}>
          <div className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center justify-center w-7 h-7 rounded-full text-xs font-medium transition-colors',
                current === s.num
                  ? 'bg-primary text-primary-foreground'
                  : current > s.num
                    ? 'bg-primary/20 text-primary'
                    : 'bg-muted text-muted-foreground',
              )}
            >
              {current > s.num ? <Check className="h-3.5 w-3.5" /> : s.num}
            </div>
            <span
              className={cn(
                'text-xs font-medium hidden sm:inline',
                current === s.num ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {s.label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div
              className={cn(
                'w-8 h-px mx-2',
                current > s.num ? 'bg-primary/40' : 'bg-border',
              )}
            />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

export function SlackSetupWizard({ onCreated, onBack, sandboxId: explicitSandboxId }: SlackSetupWizardProps) {
  const [step, setStep] = useState<WizardStep>(1);
  const queryClient = useQueryClient();

  // Step 1 state
  const SLACK_PORT = 8008;
  const ngrokQuery = useNgrokStatus(SLACK_PORT);
  const ngrokStart = useNgrokStart();
  const [publicUrl, setPublicUrl] = useState('');
  const [showLocalDev, setShowLocalDev] = useState(false);

  // Step 2 state
  const [botName, setBotName] = useState('Kortix Agent');
  const generateMutation = useGenerateManifest();
  const [manifestJson, setManifestJson] = useState('');
  const [copied, setCopied] = useState(false);

  // Step 3 state — Bot Token + Signing Secret (what the adapter actually needs)
  const [botToken, setBotToken] = useState('');
  const [signingSecret, setSigningSecret] = useState('');
  const [connecting, setConnecting] = useState(false);

  // Auto-fill URL when ngrok detected
  useEffect(() => {
    if (ngrokQuery.data?.detected && ngrokQuery.data.url && !publicUrl) {
      setPublicUrl(ngrokQuery.data.url);
    }
  }, [ngrokQuery.data, publicUrl]);

  const handleStartNgrok = async () => {
    try {
      const result = await ngrokStart.mutateAsync({ port: SLACK_PORT });
      if (result.url) {
        setPublicUrl(result.url);
        toast.success('ngrok tunnel started');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start ngrok');
    }
  };

  const handleStep1Next = () => {
    if (!publicUrl.trim()) {
      toast.error('Please enter a public URL');
      return;
    }
    setStep(2);
  };

  const handleGenerateManifest = async () => {
    try {
      const result = await generateMutation.mutateAsync({
        publicUrl: publicUrl.trim(),
        botName: botName.trim() || undefined,
      });
      setManifestJson(JSON.stringify(result.manifest, null, 2));
    } catch {
      toast.error('Failed to generate manifest');
    }
  };

  const handleCopyManifest = async () => {
    try {
      await navigator.clipboard.writeText(manifestJson);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy to clipboard');
    }
  };

  const credsValid = botToken.trim().startsWith('xoxb-') && signingSecret.trim().length >= 10;

  const handleConnect = async () => {
    if (!credsValid) return;
    setConnecting(true);

    try {
      const baseUrl = getActiveOpenCodeUrl();
      if (!baseUrl) throw new Error('No active instance found');

      // 1. Push env vars to sandbox
      for (const [key, value] of Object.entries({
        SLACK_BOT_TOKEN: botToken.trim(),
        SLACK_SIGNING_SECRET: signingSecret.trim(),
      })) {
        const res = await authenticatedFetch(`${baseUrl}/env/${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        });
        if (!res.ok) {
          const err = await res.text().catch(() => 'unknown');
          throw new Error(`Failed to set ${key}: ${err}`);
        }
      }

      // 2. Reload opencode-channels with new credentials
      const reloadRes = await authenticatedFetch(`${baseUrl}/channels/reload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          credentials: {
            slack: { botToken: botToken.trim(), signingSecret: signingSecret.trim() },
          },
        }),
      });
      if (!reloadRes.ok) {
        const err = await reloadRes.text().catch(() => 'unknown');
        throw new Error(`Failed to reload channels: ${err}`);
      }

      // 3. Create channel config DB record
      let sandboxId: string | null = explicitSandboxId || null;
      if (!sandboxId) {
        try {
          const result = await ensureSandbox();
          sandboxId = result.sandbox.sandbox_id;
        } catch {
          const store = useServerStore.getState();
          for (const s of store.servers) {
            if (s.sandboxId) { sandboxId = s.sandboxId; break; }
          }
        }
      }

      try {
        await backendApi.post('/channels', {
          sandbox_id: sandboxId,
          channel_type: 'slack',
          name: botName.trim() || 'Slack Bot',
          enabled: true,
          platform_config: {
            webhook_url: `${publicUrl.replace(/\/$/, '')}/webhooks/slack/events`,
            bot_name: botName.trim() || 'Kortix Agent',
          },
          agent_name: DEFAULT_CHANNEL_AGENT,
          instructions: buildDefaultChannelInstructions('slack', botName.trim() || 'Slack Bot'),
          metadata: {},
        });
      } catch (err) {
        console.warn('[slack-wizard] Failed to create channel config (may already exist):', err);
      }

      queryClient.invalidateQueries({ queryKey: ['channels'] });
      toast.success('Slack bot connected!');
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect Slack');
    } finally {
      setConnecting(false);
    }
  };

  const ngrokInstalled = ngrokQuery.data?.ngrokInstalled ?? false;

  return (
    <div>
      <StepIndicator current={step} />

      {/* ── Step 1: Public URL ──────────────────────────────────────────────── */}
      {step === 1 && (
        <div className="space-y-4 px-6 pb-6">
          <p className="text-sm text-muted-foreground">
            Enter the public URL where Slack will send webhook events.
            This should point to <span className="font-mono font-medium text-foreground">kortix-api</span> (port {SLACK_PORT}).
          </p>

          <div className="space-y-2">
            <Label htmlFor="public-url">Public URL</Label>
            <div className="relative">
              <Globe className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="public-url"
                value={publicUrl}
                onChange={(e) => setPublicUrl(e.target.value)}
                placeholder="https://yourdomain.com"
                className="pl-9 rounded-xl focus:ring-2 focus:ring-primary/50"
              />
            </div>
          </div>

          <button
            onClick={() => setShowLocalDev(!showLocalDev)}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <Terminal className="h-3 w-3" />
            <span>Local development (ngrok)</span>
            {showLocalDev ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>

          {showLocalDev && (
            <div className="rounded-xl border bg-muted/30 p-4 space-y-3 text-xs">
              <p className="text-muted-foreground">
                If you&apos;re running locally, use{' '}
                <a href="https://ngrok.com" target="_blank" rel="noopener noreferrer" className="underline text-foreground">ngrok</a>{' '}
                to create a tunnel to kortix-api.
              </p>
              <div className="rounded-lg border p-2.5">
                {ngrokQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Detecting tunnel...</span>
                  </div>
                ) : ngrokQuery.data?.detected ? (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500/15">
                      <Check className="h-2.5 w-2.5 text-emerald-600" />
                    </div>
                    <span className="text-emerald-600 font-medium">Tunnel detected</span>
                    {ngrokQuery.data.portMatches === false && (
                      <span className="text-amber-600 ml-1">(port {ngrokQuery.data.forwardPort} — expected {SLACK_PORT})</span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/15">
                        <AlertCircle className="h-2.5 w-2.5 text-amber-600" />
                      </div>
                      <span className="text-amber-600 font-medium">No tunnel running</span>
                    </div>
                    {ngrokInstalled && (
                      <Button variant="outline" size="sm" onClick={handleStartNgrok} disabled={ngrokStart.isPending} className="rounded-lg text-[11px] h-6 px-2">
                        {ngrokStart.isPending ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Starting...</> : <><Play className="h-3 w-3 mr-1" />Start on port {SLACK_PORT}</>}
                      </Button>
                    )}
                  </div>
                )}
              </div>
              <div className="space-y-1.5 text-muted-foreground">
                <p className="font-medium text-foreground">Manual setup:</p>
                <pre className="bg-background rounded-lg p-2 font-mono text-[11px] overflow-x-auto">ngrok http {SLACK_PORT}</pre>
              </div>
            </div>
          )}

          <div className="flex justify-between items-center gap-2 pt-2">
            <Button variant="outline" onClick={onBack} className="rounded-xl">
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
            <div className="flex items-center gap-3">
              <button onClick={() => setStep(3)} className="text-xs text-muted-foreground hover:text-foreground underline transition-colors">
                Skip — enter credentials manually
              </button>
              <Button onClick={handleStep1Next} disabled={!publicUrl.trim()} className="rounded-xl">
                Next<ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Step 2: Create App from Manifest ────────────────────────────────── */}
      {step === 2 && (
        <div className="space-y-4 px-6 pb-6">
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="bot-name">Bot Name</Label>
              <Input id="bot-name" value={botName} onChange={(e) => setBotName(e.target.value)} placeholder="Kortix Agent" className="rounded-xl focus:ring-2 focus:ring-primary/50" />
            </div>

            {!manifestJson ? (
              <Button onClick={handleGenerateManifest} disabled={generateMutation.isPending} className="w-full rounded-xl">
                {generateMutation.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating...</> : 'Generate Manifest'}
              </Button>
            ) : (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">App Manifest</span>
                    <Button variant="outline" size="sm" onClick={handleCopyManifest} className="h-7 rounded-lg text-xs">
                      {copied ? <><Check className="h-3 w-3 mr-1" />Copied</> : <><Copy className="h-3 w-3 mr-1" />Copy</>}
                    </Button>
                  </div>
                </div>

                <div className="rounded-xl border bg-muted/30 p-4 space-y-2">
                  <p className="text-sm font-medium">Create your Slack app:</p>
                  <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                    <li>Open{' '}
                      <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5 text-foreground">
                        api.slack.com/apps<ExternalLink className="h-3 w-3" />
                      </a>
                    </li>
                    <li>Click <strong>&quot;Create New App&quot;</strong> then <strong>&quot;From a manifest&quot;</strong></li>
                    <li>Select your workspace, click Next</li>
                    <li>Switch to the <strong>JSON</strong> tab, paste the manifest above</li>
                    <li>Click <strong>Next</strong>, review, then <strong>Create</strong></li>
                    <li>Go to <strong>&quot;Install App&quot;</strong> and install to your workspace</li>
                  </ol>
                </div>
              </>
            )}
          </div>

          <div className="flex justify-between gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep(1)} className="rounded-xl">
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
            <Button onClick={() => setStep(3)} disabled={!manifestJson} className="rounded-xl">
              Next<ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* ── Step 3: Paste Credentials & Connect ─────────────────────────────── */}
      {step === 3 && (
        <div className="space-y-4 px-6 pb-6">
          <p className="text-sm text-muted-foreground">
            After installing the app to your workspace, copy these from your{' '}
            <a href="https://api.slack.com/apps" target="_blank" rel="noopener noreferrer" className="underline inline-flex items-center gap-0.5">
              Slack App settings<ExternalLink className="h-3 w-3" />
            </a>
          </p>

          <div className="space-y-2">
            <Label htmlFor="wiz-bot-token">Bot User OAuth Token</Label>
            <Input
              id="wiz-bot-token"
              type="password"
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="xoxb-your-bot-token-here"
              className="rounded-xl focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-muted-foreground">
              Found under <strong>OAuth &amp; Permissions</strong> → Bot User OAuth Token
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="wiz-signing-secret">Signing Secret</Label>
            <Input
              id="wiz-signing-secret"
              type="password"
              value={signingSecret}
              onChange={(e) => setSigningSecret(e.target.value)}
              placeholder="abcdef1234567890abcdef1234567890"
              className="rounded-xl focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-muted-foreground">
              Found under <strong>Basic Information</strong> → App Credentials → Signing Secret
            </p>
          </div>

          <div className="flex justify-between gap-2 pt-2">
            <Button variant="outline" onClick={() => setStep(2)} className="rounded-xl">
              <ArrowLeft className="h-4 w-4 mr-2" />Back
            </Button>
            <Button onClick={handleConnect} disabled={!credsValid || connecting} className="rounded-xl">
              {connecting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Connecting...</> : <>Save &amp; Connect<ArrowRight className="h-4 w-4 ml-2" /></>}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
