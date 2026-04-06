'use client';

import { cn } from '@/lib/utils';
import { ReactNode } from 'react';

interface StepWrapperProps {
  children: ReactNode;
  className?: string;
}

export const StepWrapper = ({ children, className = "" }: StepWrapperProps) => {
  return (
    <div className={cn('w-full', className)}>
      {children}
    </div>
  );
};

