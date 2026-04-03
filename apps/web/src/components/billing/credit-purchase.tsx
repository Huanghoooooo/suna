'use client';

import { useState, useEffect } from 'react';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { AlertCircle, CheckCircle2, Loader2, Zap } from 'lucide-react';
import { billingApi, getAutoTopupSettings, configureAutoTopup, getAutoTopupSetupStatus, type AutoTopupConfig } from '@/lib/api/billing';
import { toast } from '@/lib/toast';
import { formatCredits } from '@kortix/shared';
import { useUserCurrency } from '@/hooks/use-user-currency';
import { formatPrice } from '@/lib/utils/currency';
import { cn } from '@/lib/utils';
import { useQuery, useQueryClient } from '@tanstack/react-query';

// ─── Credit packages ────────────────────────────────────────────────────────

interface CreditPackage {
    credits: number;
    price: number;
}

const CREDIT_PACKAGES: CreditPackage[] = [
    { credits: 1000, price: 10 },
    { credits: 2500, price: 25 },
    { credits: 5000, price: 50 },
    { credits: 10000, price: 100 },
    { credits: 25000, price: 250 },
    { credits: 50000, price: 500 },
];

// ─── Credit Purchase Modal ──────────────────────────────────────────────────

interface CreditPurchaseProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    currentBalance?: number;
    canPurchase: boolean;
    onPurchaseComplete?: () => void;
}

export function CreditPurchaseModal({
    open,
    onOpenChange,
    currentBalance = 0,
    canPurchase,
    onPurchaseComplete,
}: CreditPurchaseProps) {
    const { currency } = useUserCurrency();
    const [selectedPackage, setSelectedPackage] = useState<CreditPackage | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handlePurchase = async (pkg: CreditPackage) => {
        setIsProcessing(true);
        setError(null);
        try {
            const response = await billingApi.purchaseCredits({
                amount: pkg.price,
                success_url: `${window.location.origin}/instances?credit_purchase=success`,
                cancel_url: window.location.href,
            });
            if (response.checkout_url) {
                window.location.href = response.checkout_url;
            } else {
                throw new Error('No checkout URL received');
            }
        } catch (err: any) {
            const msg = err.details?.detail || err.message || 'Failed to create checkout session';
            setError(msg);
            toast.error(msg);
        } finally {
            setIsProcessing(false);
        }
    };

    if (!canPurchase) {
        return (
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                        <DialogTitle>Credits Not Available</DialogTitle>
                        <DialogDescription>
                            Credit purchases require an active subscription.
                        </DialogDescription>
                    </DialogHeader>
                    <div className="flex justify-end">
                        <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
                    </div>
                </DialogContent>
            </Dialog>
        );
    }

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>Buy Credits</DialogTitle>
                    <DialogDescription>
                        Purchase credits for LLM usage.
                    </DialogDescription>
                </DialogHeader>

                {currentBalance > 0 && (
                    <div className="text-sm text-muted-foreground">
                        Current balance: <span className="font-medium text-foreground">${(currentBalance / 100).toFixed(2)}</span>
                    </div>
                )}

                {/* Buy credits */}
                <div>
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">Buy credits</p>
                    <div className="grid grid-cols-3 gap-2">
                        {CREDIT_PACKAGES.map((pkg) => (
                            <button
                                key={pkg.price}
                                type="button"
                                onClick={() => setSelectedPackage(pkg)}
                                disabled={isProcessing}
                                className={cn(
                                    'rounded-xl border p-3 text-center transition-all cursor-pointer',
                                    selectedPackage?.price === pkg.price
                                        ? 'border-foreground bg-foreground/5'
                                        : 'border-border hover:border-foreground/20',
                                )}
                            >
                                <p className="text-lg font-semibold tabular-nums">${pkg.price}</p>
                                <p className="text-xs text-muted-foreground">{formatCredits(pkg.credits)} credits</p>
                            </button>
                        ))}
                    </div>
                </div>

                {error && (
                    <Alert variant="destructive">
                        <AlertCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <Button
                    onClick={() => selectedPackage && handlePurchase(selectedPackage)}
                    disabled={isProcessing || !selectedPackage}
                    className="w-full"
                >
                    {isProcessing ? (
                        <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Processing...</>
                    ) : selectedPackage ? (
                        `Buy $${selectedPackage.price} in credits`
                    ) : (
                        'Select a package'
                    )}
                </Button>
            </DialogContent>
        </Dialog>
    );
}

// ─── Auto Top-up Modal ──────────────────────────────────────────────────────

export function AutoTopupModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const queryClient = useQueryClient();
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [saveResult, setSaveResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    const { data: config, isLoading } = useQuery({
        queryKey: ['auto-topup-settings'],
        queryFn: getAutoTopupSettings,
        retry: 1,
        enabled: open,
    });

    const { data: setupStatus } = useQuery({
        queryKey: ['auto-topup-setup-status'],
        queryFn: getAutoTopupSetupStatus,
        retry: 1,
        enabled: open,
    });

    const [enabled, setEnabled] = useState(false);
    const [threshold, setThreshold] = useState('1000');
    const [amount, setAmount] = useState('2500');

    useEffect(() => {
        if (!config) return;
        setEnabled(config.enabled);
        setThreshold(String(config.threshold));
        setAmount(String(config.amount));
        setDirty(false);
        setSaveResult(null);
    }, [config]);

    const handleSave = async () => {
        const thresholdNum = Math.max(0, parseInt(threshold, 10) || 0);
        const amountNum = Math.max(1, parseInt(amount, 10) || 1);
        setSaving(true);
        setSaveResult(null);
        try {
            await configureAutoTopup({ enabled, threshold: thresholdNum, amount: amountNum });
            queryClient.invalidateQueries({ queryKey: ['auto-topup-settings'] });
            queryClient.invalidateQueries({ queryKey: ['accountState'] });
            queryClient.invalidateQueries({ queryKey: ['auto-topup-setup-status'] });
            setDirty(false);
            setSaveResult({ type: 'success', message: 'Auto top-up settings saved.' });
            toast.success('Auto top-up settings saved');
        } catch (err: any) {
            const message = err?.message || 'Failed to update auto-topup';
            setSaveResult({ type: 'error', message });
            toast.error(message);
        } finally {
            setSaving(false);
        }
    };

    const handleEnabledChange = (value: boolean) => {
        setEnabled(value);
        setDirty(true);
        setSaveResult(null);
    };

    const showMissingCardWarning = enabled && setupStatus && !setupStatus.has_default_payment_method;

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Auto Top-up</DialogTitle>
                    <DialogDescription>
                        Automatically purchase credits when your balance gets low.
                    </DialogDescription>
                </DialogHeader>

                {isLoading ? (
                    <div className="flex items-center justify-center py-6">
                        <Loader2 className="size-5 animate-spin text-muted-foreground" />
                    </div>
                ) : (
                    <div className="space-y-4">
                        {/* Toggle */}
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Zap className="size-4 text-muted-foreground" />
                                <span className="text-sm font-medium">Enable auto top-up</span>
                            </div>
                            <Switch checked={enabled} onCheckedChange={handleEnabledChange} />
                        </div>

                        {showMissingCardWarning && (
                            <Alert variant="warning">
                                <AlertCircle className="size-4" />
                                <AlertDescription>
                                    No default payment method found. Add a default card in Billing before enabling auto top-up.
                                </AlertDescription>
                            </Alert>
                        )}

                        {enabled && (
                            <div className="space-y-4 animate-in fade-in slide-in-from-top-1 duration-150">
                                {/* Threshold */}
                                <div>
                                    <label className="text-sm text-muted-foreground block mb-1.5">When balance drops below</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                                        <input
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={threshold}
                                            onChange={(e) => { setThreshold(e.target.value); setDirty(true); setSaveResult(null); }}
                                            className="w-full h-10 rounded-lg border border-border bg-background pl-7 pr-3 text-sm tabular-nums text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
                                            placeholder="5"
                                        />
                                    </div>
                                </div>

                                {/* Amount */}
                                <div>
                                    <label className="text-sm text-muted-foreground block mb-1.5">Automatically purchase</label>
                                    <div className="relative">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                                        <input
                                            type="number"
                                            min={1}
                                            step={1}
                                            value={amount}
                                            onChange={(e) => { setAmount(e.target.value); setDirty(true); setSaveResult(null); }}
                                            className="w-full h-10 rounded-lg border border-border bg-background pl-7 pr-3 text-sm tabular-nums text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-foreground transition-colors"
                                            placeholder="20"
                                        />
                                    </div>
                                </div>
                            </div>
                        )}

                        {saveResult && (
                            <Alert
                                variant={saveResult.type === 'error' ? 'destructive' : 'default'}
                                className={saveResult.type === 'success' ? 'border-emerald-500/40 text-emerald-700 dark:text-emerald-400 [&>svg]:text-emerald-600 dark:[&>svg]:text-emerald-400' : undefined}
                            >
                                {saveResult.type === 'success' ? <CheckCircle2 className="size-4" /> : <AlertCircle className="size-4" />}
                                <AlertDescription className={saveResult.type === 'success' ? 'text-emerald-700/90 dark:text-emerald-400/90' : undefined}>
                                    {saveResult.message}
                                </AlertDescription>
                            </Alert>
                        )}

                        {/* Save */}
                        <Button
                            className="w-full"
                            disabled={saving || !dirty}
                            onClick={handleSave}
                        >
                            {saving ? <><Loader2 className="size-4 animate-spin mr-2" /> Saving...</> : 'Save'}
                        </Button>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    );
}

// ─── Credit Balance Display ─────────────────────────────────────────────────

export function CreditBalanceDisplay({ balance, canPurchase, onPurchaseClick }: {
    balance: number;
    canPurchase: boolean;
    onPurchaseClick?: () => void;
}) {
    return (
        <Card>
            <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium flex items-center justify-between">
                    <span>Credit Balance</span>
                    {canPurchase && onPurchaseClick && (
                        <Button size="sm" variant="outline" onClick={onPurchaseClick}>
                            Add Credits
                        </Button>
                    )}
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="text-2xl font-medium">
                    {formatCredits(balance)}
                </div>
            </CardContent>
        </Card>
    );
}
