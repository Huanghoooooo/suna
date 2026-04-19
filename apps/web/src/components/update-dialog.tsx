'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { Check, XCircle, ArrowDownToLine, RotateCw, Sparkles, Bug, Zap, AlertTriangle, Shield, RefreshCw, Terminal, Copy } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
} from '@/components/ui/alert-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { AnimatedCircularProgressBar } from '@/components/ui/animated-circular-progress';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { authenticatedFetch } from '@/lib/auth-token';
import { useServerStore } from '@/stores/server-store';
import { getEnv } from '@/lib/env-config';
import type { UpdatePhase } from '@/hooks/platform/use-sandbox-update';
import type { ChangelogEntry, ChangelogChange } from '@/lib/platform-client';

type DialogStep = 'confirm' | 'updating' | 'done' | 'failed';

// ── Changelog items ──────────────────────────────────────────────────────────

const changeTypeConfig: Record<string, { icon: typeof Sparkles; color: string }> = {
  feature:     { icon: Sparkles,      color: 'text-emerald-500' },
  fix:         { icon: Bug,           color: 'text-red-400' },
  improvement: { icon: Zap,           color: 'text-blue-400' },
  breaking:    { icon: AlertTriangle, color: 'text-amber-500' },
  upstream:    { icon: RefreshCw,     color: 'text-violet-400' },
  security:    { icon: Shield,        color: 'text-rose-400' },
  deprecation: { icon: AlertTriangle, color: 'text-orange-400' },
};

function ChangeItem({ change }: { change: ChangelogChange }) {
  const config = changeTypeConfig[change.type] ?? changeTypeConfig.improvement;
  const Icon = config.icon;
  return (
    <div className="flex items-start gap-2 py-0.5">
      <Icon className={cn('h-3.5 w-3.5 mt-0.5 flex-shrink-0', config.color)} />
      <span className="text-sm text-foreground/80">{change.text}</span>
    </div>
  );
}

// ── Phase labels ─────────────────────────────────────────────────────────────

const PHASE_LABEL: Record<string, string> = {
  idle: 'Preparing...',
  backing_up: 'Creating backup...',
  pulling: 'Downloading update...',
  patching: 'Preparing files...',
  stopping: 'Stopping sandbox...',
  restarting: 'Restarting sandbox...',
  verifying: 'Verifying update...',
  complete: 'Update complete',
  reconnecting: 'Reconnecting...',
  reconnected: 'Connected',
};

// ── Dialog ────────────────────────────────────────────────────────────────────

interface UpdateDialogProps {
  open: boolean;
  phase: UpdatePhase;
  phaseMessage: string;
  phaseProgress: number;
  latestVersion: string | null;
  changelog: ChangelogEntry | null;
  currentVersion: string | null;
  isLocalSelfHosted?: boolean;
  errorMessage: string | null;
  updateResult: { success: boolean; currentVersion: string } | null;
  onClose: () => void;
  onConfirm: () => void;
  onRetry: () => void;
}

function formatVersion(version: string | null | undefined): string {
  if (!version) return 'unknown';
  return version.startsWith('dev-') ? version : `v${version}`;
}

export function UpdateDialog({
  open,
  phase,
  phaseMessage,
  phaseProgress,
  latestVersion,
  changelog,
  currentVersion,
  isLocalSelfHosted,
  errorMessage,
  updateResult,
  onClose,
  onConfirm,
  onRetry,
}: UpdateDialogProps) {
  const [step, setStep] = useState<DialogStep>('confirm');
  const [expanded, setExpanded] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [isReconnected, setIsReconnected] = useState(false);
  const healthPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isFailed = phase === 'failed';
  const isComplete = phase === 'complete';

  useEffect(() => {
    if (!open) return;
    if (phase !== 'idle' && phase !== 'complete' && phase !== 'failed') {
      setStep('updating');
    }
    if (phase === 'failed') {
      setStep('failed');
    }
  }, [phase, open]);

  const pollHealth = useCallback(async () => {
    const state = useServerStore.getState();
    const active = state.servers.find((s) => s.id === state.activeServerId);
    if (!active?.sandboxId) return false;

    const backendUrl = (getEnv().BACKEND_URL || 'http://localhost:8008/v1').replace(/\/+$/, '');
    const url = `${backendUrl}/p/${active.sandboxId}/8000/global/health`;

    try {
      const res = await authenticatedFetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!isComplete || isFailed || step === 'done') return;

    setIsReconnecting(true);
    let attempts = 0;

    const poll = async () => {
      attempts++;
      const healthy = await pollHealth();
      if (healthy) {
        setIsReconnecting(false);
        setIsReconnected(true);
        setTimeout(() => setStep('done'), 1000);
        return;
      }
      if (attempts < 30) {
        healthPollRef.current = setTimeout(poll, 2000);
      } else {
        setIsReconnecting(false);
        setIsReconnected(true);
        setTimeout(() => setStep('done'), 1000);
      }
    };

    healthPollRef.current = setTimeout(poll, 3000);
    return () => { if (healthPollRef.current) clearTimeout(healthPollRef.current); };
  }, [isComplete, isFailed, step, pollHealth]);

  useEffect(() => {
    if (open) {
      setStep('confirm');
      setExpanded(false);
      setIsReconnecting(false);
      setIsReconnected(false);
    } else {
      if (healthPollRef.current) clearTimeout(healthPollRef.current);
    }
  }, [open]);

  useEffect(() => {
    if (step !== 'done') return;
    const timer = setTimeout(onClose, 2500);
    return () => clearTimeout(timer);
  }, [step, onClose]);

  const handleConfirm = () => {
    setStep('updating');
    onConfirm();
  };

  const copyCliCommand = async () => {
    try {
      await navigator.clipboard.writeText('kortix update');
    } catch {
      // no-op
    }
  };

  const changes = changelog?.changes ?? [];
  const visibleChanges = expanded ? changes : changes.slice(0, 4);
  const hasMore = changes.length > 4 && !expanded;

  const circularProgress = isReconnected ? 100 : isReconnecting ? 95 : phaseProgress;
  const activeLabel = isReconnected
    ? PHASE_LABEL.reconnected
    : isReconnecting
      ? PHASE_LABEL.reconnecting
      : PHASE_LABEL[phase] ?? 'Updating...';

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o && (step === 'confirm' || step === 'done' || step === 'failed')) onClose(); }}>
      <AlertDialogContent className="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <ArrowDownToLine className="h-5 w-5 text-primary" />
            Update to {formatVersion(latestVersion)}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {currentVersion
              ? <>Your sandbox is running <span className="font-mono font-medium text-foreground">{formatVersion(currentVersion)}</span>.</>
              : 'A new version is available.'}
            {' '}This will restart your sandbox.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AnimatePresence mode="wait">
          {step === 'confirm' && (
            <motion.div key="confirm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              {isLocalSelfHosted ? (
                <Alert variant="warning" className="mt-4">
                  <Terminal className="h-4 w-4" />
                  <AlertTitle>Self-hosted updates run from the host</AlertTitle>
                  <AlertDescription>
                    <p>
                      If you installed Wutong via the CLI, updates should be run from your terminal so the full stack updates together.
                    </p>
                    <div className="mt-2 rounded-xl bg-muted/40 px-3 py-2 font-mono text-xs text-foreground/80">
                      kortix update
                    </div>
                  </AlertDescription>
                </Alert>
              ) : changes.length > 0 && (
                <div className="rounded-lg border border-border/50 bg-muted/30 mt-4">
                  <div className="max-h-72 overflow-y-auto px-3 py-2.5 space-y-0.5">
                    {visibleChanges.map((change, i) => (
                      <ChangeItem key={i} change={change} />
                    ))}
                  </div>
                  {hasMore && (
                    <Button
                      onClick={() => setExpanded(true)}
                      variant="link"
                      size="sm"
                      className="w-full border-t border-border/30 rounded-none h-auto py-2"
                    >
                      Show {changes.length - 4} more changes
                    </Button>
                  )}
                </div>
              )}

              <AlertDialogFooter className="mt-4">
                <Button variant="outline" onClick={onClose}>Cancel</Button>
                {isLocalSelfHosted ? (
                  <Button onClick={copyCliCommand} className="gap-2">
                    <Copy className="h-4 w-4" />
                    Copy command
                  </Button>
                ) : (
                  <Button onClick={handleConfirm} className="gap-2">
                    <ArrowDownToLine className="h-4 w-4" />
                    Update now
                  </Button>
                )}
              </AlertDialogFooter>
            </motion.div>
          )}

          {/* ── Updating Step ── */}
          {step === 'updating' && (
            <motion.div
              key="updating"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col items-center py-8"
            >
              <AnimatedCircularProgressBar
                value={circularProgress}
                gaugePrimaryColor="var(--color-primary)"
                gaugeSecondaryColor="var(--color-border)"
                className="size-32 text-xl"
              />

              <div className="mt-6 text-center min-h-[3rem]">
                <AnimatePresence mode="wait">
                  <motion.p
                    key={activeLabel}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.3 }}
                    className="text-sm font-medium text-foreground"
                  >
                    {activeLabel}
                  </motion.p>
                </AnimatePresence>
                <p className="text-xs text-muted-foreground mt-1">
                  Updating to {formatVersion(latestVersion)}
                </p>
              </div>
            </motion.div>
          )}

          {/* ── Done Step ── */}
          {step === 'done' && (
            <motion.div
              key="done"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="flex flex-col items-center py-14"
            >
              <div className="relative flex h-16 w-16 items-center justify-center">
                <motion.div
                  className="absolute inset-0 rounded-full bg-emerald-500/20"
                  initial={{ scale: 1 }}
                  animate={{ scale: [1, 1.5, 1] }}
                  transition={{ duration: 1, repeat: 1 }}
                />
                <div className="relative flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/25">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: 'spring', stiffness: 300, damping: 20, delay: 0.1 }}
                  >
                    <Check className="h-7 w-7 text-white" />
                  </motion.div>
                </div>
              </div>

              <motion.div
                className="mt-4 text-center"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.3 }}
              >
                <p className="text-base font-semibold text-foreground">Update Complete</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Now running {formatVersion(updateResult?.currentVersion ?? latestVersion)}
                </p>
              </motion.div>
            </motion.div>
          )}

          {/* ── Failed Step ── */}
          {step === 'failed' && (
            <motion.div key="failed" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
              <div className="flex flex-col items-center py-6">
                <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-500/10 border-2 border-red-500/30">
                  <XCircle className="h-7 w-7 text-red-500" />
                </div>
                <p className="text-base font-semibold text-foreground mt-4">Update Failed</p>
              </div>

              <Alert variant="destructive" className="mt-1">
                <XCircle className="h-4 w-4" />
                <AlertTitle>{phaseMessage || 'Something went wrong during the update.'}</AlertTitle>
                {errorMessage && (
                  <AlertDescription>
                    <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl bg-muted/40 px-3 py-2 font-mono text-xs text-foreground/80">
                      {errorMessage}
                    </div>
                  </AlertDescription>
                )}
              </Alert>

              <AlertDialogFooter>
                <Button variant="outline" onClick={onClose}>Close</Button>
                <Button onClick={() => { setStep('updating'); onRetry(); }} className="gap-2">
                  <RotateCw className="h-4 w-4" />
                  Retry
                </Button>
              </AlertDialogFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </AlertDialogContent>
    </AlertDialog>
  );
}
