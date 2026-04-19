'use client';

import * as React from 'react';
import { useReferralCode, useReferralStats } from '@/hooks/referrals/use-referrals';
import { ReferralCodeSection } from './referral-code-section';
import { ReferralStatsCards } from './referral-stats-cards';
import { KortixLogo } from '@/components/sidebar/kortix-logo';
import { ReferralEmailInvitation } from './referral-email-invitation';

interface ReferralsTabProps {
  isActive?: boolean;
}

export function ReferralsTab({ isActive = true }: ReferralsTabProps) {
  // Only fetch when tab is actually visible to avoid unnecessary API calls
  const { data: referralCode, isLoading: codeLoading } = useReferralCode({ enabled: isActive });
  const { data: stats, isLoading: statsLoading } = useReferralStats({ enabled: isActive });

  return (
    <div className="p-4 sm:p-6 space-y-6 overflow-y-auto max-h-[85vh] sm:max-h-none">
      {/* Header */}
      <div className="flex flex-col items-center text-center mb-4 sm:mb-6">
        <div className="mb-2 sm:mb-4 p-2 sm:p-3 rounded-xl sm:rounded-2xl bg-muted/50">
          <KortixLogo size={24} variant="symbol" className="sm:hidden" />
          <KortixLogo size={32} variant="symbol" className="hidden sm:block" />
        </div>
        <h2 className="text-lg sm:text-xl font-semibold text-foreground">
          {'推荐计划'}
        </h2>
        <p className="text-xs sm:text-sm text-muted-foreground mt-1 sm:mt-2">
          {'与朋友分享您的推荐链接。当他们注册并创建账户时，您将获得'} <span className="font-semibold text-foreground">{'100个永久积分'}</span>
        </p>
      </div>

      {/* Credit Info */}
      <div className="bg-muted/30 rounded-lg sm:rounded-xl p-3 sm:p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-muted-foreground mb-1">{'您获得'}</p>
            <p className="text-xl font-semibold">{'100个永久积分'}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground mb-1">{'您的朋友获得'}</p>
            <p className="text-xl font-semibold">{'100个永久积分'}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border">
          {'通过推荐最多可获得：'} <span className="font-semibold text-foreground">{'$100积分'}</span>
        </p>
      </div>

      {/* Share Section */}
      <div>
        <h3 className="text-sm font-medium mb-3">{'分享您的推荐链接'}</h3>
        <ReferralCodeSection referralCode={referralCode} isLoading={codeLoading} />
      </div>

      <div>
        <ReferralEmailInvitation />
      </div>

      {/* Stats Section */}
      <div>
        <h3 className="text-sm font-medium mb-3">{'您的统计'}</h3>
        <ReferralStatsCards stats={stats} isLoading={statsLoading} />
      </div>
    </div>
  );
}
