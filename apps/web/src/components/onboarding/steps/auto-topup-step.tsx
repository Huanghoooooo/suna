'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import { CreditCard, ShieldCheck, Settings } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { StepWrapper } from '../shared/step-wrapper';
import { updateUserContext, userContext } from '../shared/context';

export const AutoTopupStep = () => {
  const [enabled, setEnabled] = useState(userContext.autoTopupEnabled ?? false);

  const handleToggle = (value: boolean) => {
    setEnabled(value);
    updateUserContext({ autoTopupEnabled: value });
  };

  return (
    <StepWrapper>
      <div className="space-y-6 max-w-md mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center space-y-2"
        >
          <h2 className="text-xl font-semibold">Auto Top-up</h2>
          <p className="text-sm text-muted-foreground">
            Keep your workspace running without interruption
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-xl border bg-card p-5 space-y-4"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <CreditCard className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium text-sm">Enable Auto Top-up</p>
                <p className="text-xs text-muted-foreground">
                  Add $20 when credits drop below $5
                </p>
              </div>
            </div>
            <Switch checked={enabled} onCheckedChange={handleToggle} />
          </div>

          {enabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="space-y-3 pt-2 border-t"
            >
              <div className="flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 text-emerald-500 mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Your card will only be charged when credits run low. You can change the amount or disable this anytime in Settings.
                </p>
              </div>
            </motion.div>
          )}

          {!enabled && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="pt-2 border-t"
            >
              <div className="flex items-start gap-2">
                <Settings className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  You can enable auto top-up later in Settings &gt; Billing. Without it, your workspace will pause when credits run out.
                </p>
              </div>
            </motion.div>
          )}
        </motion.div>
      </div>
    </StepWrapper>
  );
};
