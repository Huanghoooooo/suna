'use client';

import * as React from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

import { cn } from '@/lib/utils';

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  );
}

function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'bg-foreground/[0.05] text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-full p-0.5 gap-0.5',
        className,
      )}
      {...props}
    />
  );
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "cursor-pointer inline-flex h-[calc(100%-2px)] flex-1 items-center justify-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors duration-150",
        "text-muted-foreground/60 hover:text-foreground/80",
        "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-foreground/[0.06]",
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring focus-visible:ring-[3px] focus-visible:outline-1",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className,
      )}
      {...props}
    />
  );
}

/** Compact Radix TabsList — use inside <Tabs> root for smaller contexts. */
function TabsListCompact({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      className={cn(
        'bg-foreground/[0.05] text-muted-foreground inline-flex h-7 w-fit items-center justify-center rounded-full p-0.5 gap-0.5',
        className,
      )}
      {...props}
    />
  );
}

/** Compact Radix TabsTrigger — use inside <Tabs> root for smaller contexts. */
function TabsTriggerCompact({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "cursor-pointer inline-flex h-[calc(100%-2px)] flex-1 items-center justify-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150",
        "text-muted-foreground/60 hover:text-foreground/80",
        "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-foreground/[0.06]",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

/** Standalone filter pill bar — works WITHOUT a <Tabs> root. Use for filter bars, mode toggles. */
function FilterBar({
  className,
  ...props
}: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="filter-bar"
      role="tablist"
      className={cn(
        'bg-foreground/[0.05] text-muted-foreground inline-flex h-7 w-fit items-center justify-center rounded-full p-0.5 gap-0.5',
        className,
      )}
      {...props}
    />
  );
}

/** Standalone filter pill — works WITHOUT a <Tabs> root. Pair with FilterBar. */
function FilterBarItem({
  className,
  ...props
}: React.ComponentProps<'button'>) {
  return (
    <button
      data-slot="filter-bar-item"
      role="tab"
      type="button"
      className={cn(
        "cursor-pointer inline-flex h-[calc(100%-2px)] flex-1 items-center justify-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-colors duration-150",
        "text-muted-foreground/60 hover:text-foreground/80",
        "data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm data-[state=active]:ring-1 data-[state=active]:ring-foreground/[0.06]",
        "disabled:pointer-events-none disabled:opacity-50",
        "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsListCompact, TabsTriggerCompact, TabsContent, FilterBar, FilterBarItem };
