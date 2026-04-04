'use client';

/**
 * SetupWizard — 5-step onboarding shown between boot overlay and the dashboard.
 *
 * Step 1: LLM Providers
 * Step 2: Default Model — pick which model to use by default
 * Step 3: Tool API Keys (opt-in configure modal, cloud pre-configured)
 * Step 4: Pipedream Integrations (opt-in configure modal, cloud pre-configured)
 * Step 5: Get Started — launches the onboarding chat session
 */

import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Settings2,
  Check,
  Sparkles,
  Search,
  Flame,
  Image as ImageIcon,
  Mic,
  BookOpen,
  ExternalLink,
  Loader2,
  Link,
  ChevronRight,
  ArrowLeft,
  Zap,
  MessageSquare,
  Wrench,
  X,
  Bot,
  CreditCard,
  ShieldCheck,
} from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { KortixLoader } from '@/components/ui/kortix-loader';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { useProviderModalStore } from '@/stores/provider-modal-store';
import { useOpenCodeProviders } from '@/hooks/opencode/use-opencode-sessions';
import { ProviderLogo, PROVIDER_LABELS } from '@/components/providers/provider-branding';
import { flattenModels } from '@/components/session/session-chat-input';
import type { FlatModel } from '@/components/session/session-chat-input';
import { useModelStore } from '@/hooks/opencode/use-model-store';
import { getActiveOpenCodeUrl } from '@/stores/server-store';
import { authenticatedFetch } from '@/lib/auth-token';
import { isBillingEnabled } from '@/lib/config';
import { cn } from '@/lib/utils';
import { backendApi } from '@/lib/api-client';

// ─── Step definitions ───────────────────────────────────────────────────────

const STEPS = [
  { label: 'Auto Top-up', icon: CreditCard },
  { label: 'Providers', icon: Sparkles },
  { label: 'Default Model', icon: Bot },
  { label: 'Tools', icon: Wrench },
  { label: 'Integrations', icon: Link },
  { label: 'Get Started', icon: MessageSquare },
];

// ─── Step indicator (dots + label) ──────────────────────────────────────────

function StepIndicator({ current }: { current: number }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="flex items-center justify-center gap-1.5">
        {STEPS.map((_, i) => (
          <motion.div
            key={i}
            layout
            className={cn(
              'rounded-full transition-colors duration-300',
              i === current
                ? 'w-6 h-1.5 bg-foreground'
                : i < current
                  ? 'w-1.5 h-1.5 bg-foreground/40'
                  : 'w-1.5 h-1.5 bg-foreground/15',
            )}
          />
        ))}
      </div>
      <p className="text-[11px] font-medium text-muted-foreground/40 uppercase tracking-wider">
        {STEPS[current].label}
      </p>
    </div>
  );
}

// ─── Overlay modal (for configure forms) ────────────────────────────────────

function ConfigureModal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm cursor-pointer"
        onClick={onClose}
      />
      {/* Panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 8 }}
        transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md mx-4 bg-background rounded-2xl border shadow-xl max-h-[80vh] flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <h3 className="text-sm font-medium text-foreground/90">{title}</h3>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-foreground/5 text-foreground/40 hover:text-foreground/70 transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 pb-5">
          {children}
        </div>
      </motion.div>
    </div>
  );
}

// ─── Cloud badge ────────────────────────────────────────────────────────────

function CloudBadge({ text }: { text?: string }) {
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[11px] font-medium mx-auto w-fit">
      <Zap className="h-3 w-3" />
      {text || 'Already configured on Kortix Cloud'}
    </div>
  );
}

/// ─── Step 0: Auto Top-up ────────────────────────────────────────────────────

function AutoTopupPane({ onNext }: { onNext: () => void }) {
  const [enabled, setEnabled] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleContinue = async () => {
    setSaving(true);
    try {
      await backendApi.post('/billing/auto-topup/configure', { enabled, threshold: 5, amount: 20 });
    } catch {
      // Non-fatal — preference saved on next Settings visit
    }
    setSaving(false);
    onNext();
  };

  return (
    <div className="flex flex-col items-center text-center gap-6">
      <div
        className={cn(
          'h-12 w-12 rounded-full flex items-center justify-center',
          'bg-muted/60',
        )}
      >
        <CreditCard className="h-5 w-5 text-muted-foreground/50" />
      </div>

      <div className="space-y-1.5">
        <h2 className="text-lg font-medium text-foreground/90">Auto Top-up</h2>
        <p className="text-sm text-muted-foreground/50 leading-relaxed max-w-xs mx-auto">
          Automatically add credits when your balance runs low so your workspace never pauses.
        </p>
      </div>

      <div className="w-full rounded-xl border bg-card/50 p-4">
        <div className="flex items-center justify-between">
          <div className="text-left">
            <p className="text-sm font-medium">Enable Auto Top-up</p>
            <p className="text-xs text-muted-foreground">Add $20 when balance drops below $5</p>
          </div>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>

        {enabled && (
          <div className="mt-3 pt-3 border-t flex items-start gap-2">
            <ShieldCheck className="h-4 w-4 text-green-500 mt-0.5 shrink-0" />
            <p className="text-xs text-muted-foreground text-left">
              Your card will only be charged when credits run low. Change or disable anytime in Settings.
            </p>
          </div>
        )}
      </div>

      <Button onClick={handleContinue} disabled={saving} className="w-full gap-2">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Continue
        <ChevronRight className="h-4 w-4" />
      </Button>

      <button
        onClick={onNext}
        className="text-xs text-muted-foreground/40 hover:text-muted-foreground transition-colors"
      >
        Skip for now
      </button>
    </div>
  );
}

function ProvidersPane({ onNext }: { onNext: () => void }) {
  const { data: providersData, isLoading } = useOpenCodeProviders();
  const openProviderModal = useProviderModalStore((s) => s.openProviderModal);

  const connectedProviders = useMemo(() => {
    if (!providersData) return [];
    const ids = new Set(providersData.connected ?? []);
    return (providersData.all ?? []).filter((p) => ids.has(p.id));
  }, [providersData]);

  const hasLLM = connectedProviders.some((p) =>
    ['anthropic', 'openai', 'openrouter', 'google', 'groq', 'xai'].includes(p.id),
  );

  if (isLoading) {
    return (
      <div className="flex flex-col items-center py-16 space-y-4">
        <KortixLoader size="small" />
        <p className="text-[12px] text-muted-foreground/40">Checking providers…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm space-y-6 mx-auto">
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center">
          <div
            className={cn(
              'h-12 w-12 rounded-full flex items-center justify-center',
              hasLLM ? 'bg-emerald-500/10' : 'bg-muted/60',
            )}
          >
            {hasLLM ? (
              <Check className="h-5 w-5 text-emerald-500" />
            ) : (
              <Sparkles className="h-5 w-5 text-muted-foreground/50" />
            )}
          </div>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-medium text-foreground/90">
            {hasLLM ? 'Providers Connected' : 'LLM Providers'}
          </h2>
          <p className="text-sm text-muted-foreground/50 leading-relaxed max-w-xs mx-auto">
            {hasLLM
              ? 'Your agent is ready to use these models.'
              : 'Configure which AI models to use with your Kortix agent. Connect OpenAI, Anthropic, Google, or any supported provider.'}
          </p>
        </div>
      </div>

      {/* Connected providers list */}
      {hasLLM && connectedProviders.length > 0 && (
        <div className="space-y-1.5">
          {connectedProviders.map((p) => (
            <div
              key={p.id}
              className="flex items-center gap-3 px-3 py-2 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02]"
            >
              <ProviderLogo providerID={p.id} name={p.name} size="small" />
              <span className="text-[13px] font-medium text-foreground/80">
                {PROVIDER_LABELS[p.id] || p.name || p.id}
              </span>
              <Check className="h-3.5 w-3.5 text-emerald-500 ml-auto" />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-2">
        <Button
          onClick={() => openProviderModal('providers')}
          variant={hasLLM ? 'outline' : 'default'}
          className="w-full h-11 text-sm rounded-xl shadow-none gap-2"
        >
          <Settings2 className="h-4 w-4" />
          {hasLLM ? 'Add or manage providers' : 'Connect Provider'}
        </Button>

        <Button
          onClick={onNext}
          variant={hasLLM ? 'default' : 'ghost'}
          className={cn(
            'w-full h-11 text-sm rounded-xl shadow-none gap-2',
            !hasLLM && 'text-muted-foreground/60',
          )}
        >
          {hasLLM ? (
            <>
              Continue <ChevronRight className="h-4 w-4" />
            </>
          ) : (
            'Skip for now'
          )}
        </Button>
      </div>
    </div>
  );
}

// ─── Step 2: Default Model ──────────────────────────────────────────────────

function DefaultModelPane({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const { data: providersData, isLoading } = useOpenCodeProviders();
  const allModels = useMemo(() => flattenModels(providersData), [providersData]);
  const modelStore = useModelStore(allModels);

  // Resolve initial selection from global default or recent list
  const initialModel = useMemo(() => {
    if (modelStore.globalDefault) return modelStore.globalDefault;
    if (modelStore.recent.length > 0) return modelStore.recent[0];
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [selected, setSelected] = useState<{ providerID: string; modelID: string } | null>(
    initialModel ?? null,
  );

  // Group visible models by provider
  const grouped = useMemo(() => {
    const visible = allModels.filter((m) => modelStore.isVisible(m));
    const groups = new Map<string, FlatModel[]>();
    for (const m of visible) {
      const list = groups.get(m.providerID) || [];
      list.push(m);
      groups.set(m.providerID, list);
    }
    return Array.from(groups.entries()).sort((a, b) => {
      const la = PROVIDER_LABELS[a[0]] || a[0];
      const lb = PROVIDER_LABELS[b[0]] || b[0];
      return la.localeCompare(lb);
    });
  }, [allModels, modelStore]);

  const handleSelect = useCallback(
    (model: FlatModel) => {
      const key = { providerID: model.providerID, modelID: model.modelID };
      setSelected(key);

      // Set as global default — checked in useOpenCodeLocal BEFORE agent.model,
      // so it wins over server-configured agent defaults. Persisted in localStorage.
      modelStore.setGlobalDefault(key);
      // Also push to recent as a secondary signal
      modelStore.pushRecent(key);
    },
    [modelStore],
  );

  const handleContinue = useCallback(() => {
    onNext();
  }, [onNext]);

  if (isLoading) {
    return (
      <div className="flex flex-col items-center py-16 space-y-4">
        <KortixLoader size="small" />
        <p className="text-[12px] text-muted-foreground/40">Loading models…</p>
      </div>
    );
  }

  const hasModels = grouped.length > 0;

  return (
    <div className="w-full max-w-sm space-y-5 mx-auto">
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center">
          <div className="h-12 w-12 rounded-full flex items-center justify-center bg-muted/60">
            <Bot className="h-5 w-5 text-muted-foreground/50" />
          </div>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-medium text-foreground/90">Default Model</h2>
          <p className="text-sm text-muted-foreground/50 leading-relaxed max-w-xs mx-auto">
            {hasModels
              ? 'Choose which model your agent uses by default. You can switch models anytime in chat.'
              : 'Connect a provider first to see available models.'}
          </p>
        </div>
      </div>

      {/* Model list */}
      {hasModels && (
        <div className="space-y-3 max-h-[280px] overflow-y-auto pr-1 -mr-1">
          {grouped.map(([providerID, models]) => (
            <div key={providerID} className="space-y-1">
              <div className="flex items-center gap-2 px-1 pb-1">
                <ProviderLogo providerID={providerID} name={models[0]?.providerName} size="small" />
                <span className="text-[11px] font-medium text-foreground/40 uppercase tracking-wider">
                  {PROVIDER_LABELS[providerID] || providerID}
                </span>
              </div>
              {models.map((model) => {
                const isSelected =
                  selected?.providerID === model.providerID &&
                  selected?.modelID === model.modelID;
                return (
                  <button
                    key={`${model.providerID}:${model.modelID}`}
                    onClick={() => handleSelect(model)}
                    className={cn(
                      'w-full flex items-center gap-3 px-3 py-2 rounded-xl border text-left transition-all cursor-pointer',
                      isSelected
                        ? 'border-foreground/20 bg-foreground/[0.04]'
                        : 'border-foreground/[0.06] bg-foreground/[0.01] hover:bg-foreground/[0.03]',
                    )}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-[13px] font-medium text-foreground/80 truncate">
                        {model.modelName}
                      </div>
                      <div className="text-[11px] text-foreground/30 truncate">{model.modelID}</div>
                    </div>
                    {isSelected && (
                      <Check className="h-4 w-4 text-emerald-500 shrink-0" />
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="space-y-2">
        <Button
          onClick={handleContinue}
          className="w-full h-11 text-sm rounded-xl shadow-none gap-2"
        >
          {selected ? 'Continue' : 'Skip for now'} <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="flex justify-center pt-1">
          <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-pointer">
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Step 3: Tool secrets ───────────────────────────────────────────────────

const TOOL_SECRETS = [
  { key: 'TAVILY_API_KEY', label: 'Tavily', description: 'Web search', icon: Search, url: 'https://tavily.com' },
  { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl', description: 'Web scraping', icon: Flame, url: 'https://firecrawl.dev' },
  { key: 'SERPER_API_KEY', label: 'Serper', description: 'Image search', icon: ImageIcon, url: 'https://serper.dev' },
  { key: 'REPLICATE_API_TOKEN', label: 'Replicate', description: 'AI media generation', icon: ImageIcon, url: 'https://replicate.com' },
  { key: 'CONTEXT7_API_KEY', label: 'Context7', description: 'Library docs search', icon: BookOpen, url: 'https://context7.com' },
  { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs', description: 'Voice generation', icon: Mic, url: 'https://elevenlabs.io' },
] as const;

function ToolKeysPane({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const isCloud = isBillingEnabled();
  const [modalOpen, setModalOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const filled = Object.values(values).filter((v) => v.trim()).length;

  const handleSave = useCallback(async () => {
    const toSave = Object.entries(values).filter(([, v]) => v.trim());
    if (toSave.length === 0) { setModalOpen(false); return; }

    setSaving(true);
    const base = getActiveOpenCodeUrl();
    try {
      for (const [key, value] of toSave) {
        await authenticatedFetch(`${base}/env/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value: value.trim() }),
        }).catch(() => {});
      }
    } catch { /* continue */ }
    setSaving(false);
    setSaved(true);
    setModalOpen(false);
  }, [values]);

  return (
    <>
      <div className="w-full max-w-sm space-y-5 mx-auto">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center">
            <div className="h-12 w-12 rounded-full flex items-center justify-center bg-muted/60">
              <Wrench className="h-5 w-5 text-muted-foreground/50" />
            </div>
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-medium text-foreground/90">Tool API Keys</h2>
            <p className="text-sm text-muted-foreground/50 leading-relaxed max-w-xs mx-auto">
              Your agent uses tools like web search, scraping, and image generation to complete tasks.
            </p>
          </div>
          {isCloud && <CloudBadge text="Included with your Kortix Cloud plan" />}
        </div>

        {/* Info box */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3.5 text-[12.5px] text-muted-foreground/60 leading-relaxed">
          {isCloud ? (
            <>
              All tool keys are <span className="text-foreground/80 font-medium">pre-configured</span> and
              usage is billed through your credits. You can optionally use your own API keys if you prefer.
            </>
          ) : (
            <>
              Add API keys to enable agent capabilities like web search, image generation, and more.
              All keys are optional — you can add them later in Settings.
            </>
          )}
        </div>

        {/* Saved confirmation */}
        {saved && (
          <div className="flex items-center justify-center gap-2 text-[12.5px] text-emerald-600 dark:text-emerald-400 font-medium">
            <Check className="h-3.5 w-3.5" />
            {filled} key{filled > 1 ? 's' : ''} saved
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={() => setModalOpen(true)}
            className="w-full h-11 text-sm rounded-xl shadow-none gap-2 text-muted-foreground"
          >
            <Settings2 className="h-4 w-4" />
            {isCloud ? 'Use my own API keys' : 'Configure tool keys'}
          </Button>

          <Button
            onClick={onNext}
            className="w-full h-11 text-sm rounded-xl shadow-none gap-2"
          >
            Continue <ChevronRight className="h-4 w-4" />
          </Button>

          <div className="flex justify-center pt-1">
            <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-pointer">
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
          </div>
        </div>
      </div>

      {/* Configure modal */}
      <ConfigureModal open={modalOpen} onClose={() => setModalOpen(false)} title="Tool API Keys">
        <div className="space-y-4">
          <p className="text-[12px] text-muted-foreground/50 leading-relaxed">
            {isCloud
              ? 'These keys will override the default Kortix-managed keys for these tools.'
              : 'Paste your API keys below. All fields are optional.'}
          </p>
          <div className="space-y-2">
            {TOOL_SECRETS.map((s) => {
              const Icon = s.icon;
              return (
                <div
                  key={s.key}
                  className="flex items-start gap-3 p-2.5 rounded-xl border border-foreground/[0.06] bg-foreground/[0.02]"
                >
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-foreground/[0.05]">
                    <Icon className="h-3.5 w-3.5 text-foreground/40" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-foreground/80">{s.label}</span>
                      <span className="text-[11px] text-foreground/30">{s.description}</span>
                      <a
                        href={s.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-foreground/20 hover:text-foreground/50 transition-colors"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                    <Input
                      type="password"
                      placeholder={s.key}
                      value={values[s.key] || ''}
                      onChange={(e) => setValues((p) => ({ ...p, [s.key]: e.target.value }))}
                      className="h-8 text-xs font-mono shadow-none bg-foreground/[0.04] border-foreground/[0.08] rounded-lg"
                      autoComplete="off"
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModalOpen(false)} className="flex-1 h-10 text-sm rounded-xl shadow-none">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1 h-10 text-sm rounded-xl shadow-none">
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              ) : filled > 0 ? (
                `Save ${filled} key${filled > 1 ? 's' : ''}`
              ) : (
                'Done'
              )}
            </Button>
          </div>
        </div>
      </ConfigureModal>
    </>
  );
}

// ─── Step 4: Pipedream ──────────────────────────────────────────────────────

const PD_KEYS = [
  { key: 'PIPEDREAM_CLIENT_ID', label: 'Client ID', placeholder: 'e.g. z8PKSGuQdorPj4UErE…', secret: false },
  { key: 'PIPEDREAM_CLIENT_SECRET', label: 'Client Secret', placeholder: 'e.g. UeZCz2PeNdOeHJfw…', secret: true },
  { key: 'PIPEDREAM_PROJECT_ID', label: 'Project ID', placeholder: 'e.g. proj_x9s97z5', secret: false },
] as const;

function PipedreamPane({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const isCloud = isBillingEnabled();
  const [modalOpen, setModalOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const allFilled = PD_KEYS.every((k) => (values[k.key] || '').trim());

  const handleSave = useCallback(async () => {
    if (!allFilled) { setModalOpen(false); return; }

    setSaving(true);
    const base = getActiveOpenCodeUrl();
    try {
      const entries = [
        ...PD_KEYS.map((k) => [k.key, (values[k.key] || '').trim()] as const),
        ['PIPEDREAM_ENVIRONMENT', 'production'] as const,
      ];
      for (const [key, value] of entries) {
        if (!value) continue;
        await authenticatedFetch(`${base}/env/${encodeURIComponent(key)}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ value }),
        }).catch(() => {});
      }
    } catch { /* continue */ }
    setSaving(false);
    setSaved(true);
    setModalOpen(false);
  }, [values, allFilled]);

  return (
    <>
      <div className="w-full max-w-sm space-y-5 mx-auto">
        {/* Header */}
        <div className="text-center space-y-3">
          <div className="flex items-center justify-center">
            <div className="h-12 w-12 rounded-full flex items-center justify-center bg-muted/60">
              <Link className="h-5 w-5 text-muted-foreground/50" />
            </div>
          </div>
          <div className="space-y-1.5">
            <h2 className="text-lg font-medium text-foreground/90">Third-Party Integrations</h2>
            <p className="text-sm text-muted-foreground/50 leading-relaxed max-w-xs mx-auto">
              Connect your agent to Gmail, Slack, Notion, and 3,000+ other apps via{' '}
              <a href="https://pipedream.com/connect" target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground/70">
                Pipedream Connect
              </a>.
            </p>
          </div>
          {isCloud && <CloudBadge text="Included with your Kortix Cloud plan" />}
        </div>

        {/* Info box */}
        <div className="rounded-xl border border-foreground/[0.06] bg-foreground/[0.02] p-3.5 text-[12.5px] text-muted-foreground/60 leading-relaxed">
          {isCloud ? (
            <>
              Pipedream integrations are <span className="text-foreground/80 font-medium">pre-configured</span> on
              your plan. You can optionally bring your own Pipedream project credentials if you prefer full control.
            </>
          ) : (
            <>
              Add your Pipedream Connect credentials to enable 3,000+ app integrations.
              This is optional — you can set it up later in Settings.
            </>
          )}
        </div>

        {/* Saved confirmation */}
        {saved && (
          <div className="flex items-center justify-center gap-2 text-[12.5px] text-emerald-600 dark:text-emerald-400 font-medium">
            <Check className="h-3.5 w-3.5" />
            Pipedream configured
          </div>
        )}

        {/* Actions */}
        <div className="space-y-2">
          <Button
            variant="outline"
            onClick={() => setModalOpen(true)}
            className="w-full h-11 text-sm rounded-xl shadow-none gap-2 text-muted-foreground"
          >
            <Settings2 className="h-4 w-4" />
            {isCloud ? 'Use my own Pipedream credentials' : 'Configure Pipedream'}
          </Button>

          <Button
            onClick={onNext}
            className="w-full h-11 text-sm rounded-xl shadow-none gap-2"
          >
            Continue <ChevronRight className="h-4 w-4" />
          </Button>

          <div className="flex justify-center pt-1">
            <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-pointer">
              <ArrowLeft className="h-3 w-3" /> Back
            </button>
          </div>
        </div>
      </div>

      {/* Configure modal */}
      <ConfigureModal open={modalOpen} onClose={() => setModalOpen(false)} title="Pipedream Credentials">
        <div className="space-y-4">
          <p className="text-[12px] text-muted-foreground/50 leading-relaxed">
            Enter your Pipedream Connect project credentials. Get them at{' '}
            <a href="https://pipedream.com/connect" target="_blank" rel="noopener noreferrer" className="underline hover:text-muted-foreground/70">
              pipedream.com/connect
            </a>.
          </p>
          <div className="space-y-3">
            {PD_KEYS.map((f) => (
              <div key={f.key} className="space-y-1">
                <label className="text-[12px] font-medium text-foreground/60">{f.label}</label>
                <Input
                  type={f.secret ? 'password' : 'text'}
                  placeholder={f.placeholder}
                  value={values[f.key] || ''}
                  onChange={(e) => setValues((p) => ({ ...p, [f.key]: e.target.value }))}
                  className="h-9 text-xs font-mono shadow-none bg-foreground/[0.04] border-foreground/[0.08] rounded-lg"
                  autoComplete="off"
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2 pt-1">
            <Button variant="ghost" onClick={() => setModalOpen(false)} className="flex-1 h-10 text-sm rounded-xl shadow-none">
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving} className="flex-1 h-10 text-sm rounded-xl shadow-none">
              {saving ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>
              ) : allFilled ? (
                'Save credentials'
              ) : (
                'Done'
              )}
            </Button>
          </div>
        </div>
      </ConfigureModal>
    </>
  );
}

// ─── Step 5: Get Started ────────────────────────────────────────────────────

function GetStartedPane({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return (
    <div className="w-full max-w-sm space-y-6 mx-auto">
      <div className="text-center space-y-3">
        <div className="flex items-center justify-center">
          <div className="h-12 w-12 rounded-full flex items-center justify-center bg-primary/10">
            <MessageSquare className="h-5 w-5 text-primary" />
          </div>
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-medium text-foreground/90">You&apos;re all set</h2>
          <p className="text-sm text-muted-foreground/50 leading-relaxed max-w-xs mx-auto">
            Your Kortix agent is configured and ready. We&apos;ll walk you through the basics in a quick guided conversation.
          </p>
        </div>
      </div>

      <div className="space-y-2">
        <Button
          onClick={onNext}
          className="w-full h-11 text-sm rounded-xl shadow-none gap-2"
        >
          Start onboarding <ChevronRight className="h-4 w-4" />
        </Button>

        <div className="flex justify-center pt-1">
          <button onClick={onBack} className="flex items-center gap-1 text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors cursor-pointer">
            <ArrowLeft className="h-3 w-3" /> Back
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main wizard ────────────────────────────────────────────────────────────

const TOTAL_STEPS = 6;

export function SetupWizard({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0);

  const next = useCallback(() => {
    if (step < TOTAL_STEPS - 1) setStep((s) => s + 1);
    else onComplete();
  }, [step, onComplete]);

  const back = useCallback(() => {
    if (step > 0) setStep((s) => s - 1);
  }, [step]);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col items-center justify-center bg-background">
      {/* Header: Logo + stepper */}
      <div className="absolute top-0 inset-x-0 flex flex-col items-center pt-8 gap-6">
        <KortixLogo size={20} />
        <StepIndicator current={step} />
      </div>

      {/* Step content */}
      <div className="w-full max-w-md px-6">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
          >
            {step === 0 && <AutoTopupPane onNext={next} />}
            {step === 1 && <ProvidersPane onNext={next} />}
            {step === 2 && <DefaultModelPane onNext={next} onBack={back} />}
            {step === 3 && <ToolKeysPane onNext={next} onBack={back} />}
            {step === 4 && <PipedreamPane onNext={next} onBack={back} />}
            {step === 5 && <GetStartedPane onNext={next} onBack={back} />}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Footer */}
      <p className="absolute bottom-6 text-[11px] text-foreground/20">
        You can change all of this later in Settings.
      </p>
    </div>
  );
}
