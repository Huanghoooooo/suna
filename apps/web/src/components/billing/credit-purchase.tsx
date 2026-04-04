'use client';

import { useState } from 'react';
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
import { AlertCircle, Loader2 } from 'lucide-react';
import { billingApi } from '@/lib/api/billing';
import { AutoTopupCard } from '@/components/billing/auto-topup-card';
import { toast } from '@/lib/toast';
import { formatCredits } from '@kortix/shared';
import { useUserCurrency } from '@/hooks/use-user-currency';
import { formatPrice } from '@/lib/utils/currency';
import { cn } from '@/lib/utils';

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
    if (!open) return null;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Auto Top-up</DialogTitle>
                    <DialogDescription>
                        Automatically purchase credits when your balance gets low.
                    </DialogDescription>
                </DialogHeader>
                <AutoTopupCard fetchSettings showSaveButton />
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
