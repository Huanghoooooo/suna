'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Code2,
  Search,
  GitBranch,
  ListTodo,
  TestTube2,
  Bug,
  Rocket,
  Terminal,
  BookOpen,
  Sparkles,
  FileText,
  Shield,
  Zap,
  Calendar,
  Presentation,
  ArrowRight,
  Brain,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getActiveOpenCodeUrl } from '@/stores/server-store';
import { authenticatedFetch } from '@/lib/auth-token';

// ============================================================================
// Types
// ============================================================================

interface Suggestion {
  text: string;
  category: string;
  icon: string;
}

interface PersonalisedSuggestionsProps {
  onSuggestionClick: (text: string) => void;
}

interface SuggestionsResponse {
  suggestions: Suggestion[];
  personalized: boolean;
  cached: boolean;
}

// ============================================================================
// Icon map
// ============================================================================

const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  code: Code2,
  search: Search,
  git: GitBranch,
  list: ListTodo,
  test: TestTube2,
  bug: Bug,
  rocket: Rocket,
  terminal: Terminal,
  book: BookOpen,
  sparkles: Sparkles,
  file: FileText,
  shield: Shield,
  zap: Zap,
  calendar: Calendar,
  presentation: Presentation,
  brain: Brain,
};

// ============================================================================
// Default suggestions pool
// ============================================================================

const defaultSuggestions: Suggestion[] = [
  { text: 'Explore this codebase', category: 'explore', icon: 'search' },
  { text: 'Find and fix TODOs', category: 'code', icon: 'list' },
  { text: 'Review recent git changes', category: 'explore', icon: 'git' },
  { text: 'Write tests for untested code', category: 'code', icon: 'test' },
  { text: 'Help me debug an issue', category: 'code', icon: 'bug' },
  { text: 'Build a new feature', category: 'create', icon: 'sparkles' },
  { text: 'Create a script to automate a task', category: 'automate', icon: 'terminal' },
  { text: 'Research best practices', category: 'research', icon: 'book' },
  { text: 'Audit for security issues', category: 'explore', icon: 'shield' },
  { text: 'Optimise performance', category: 'code', icon: 'zap' },
];

function pickDeterministic<T>(arr: T[], n: number, seed: number): T[] {
  const copy = [...arr];
  const result: T[] = [];
  let state = seed >>> 0;
  const next = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(next() * copy.length);
    result.push(copy.splice(idx, 1)[0]);
  }
  return result;
}

const DEFAULT_FALLBACK_SEED = 0x4b3158;

// ============================================================================
// Component
// ============================================================================

export function PersonalisedSuggestions({ onSuggestionClick }: PersonalisedSuggestionsProps) {
  const [mounted, setMounted] = useState(false);
  const { data: suggestions, isLoading } = useQuery<Suggestion[]>({
    queryKey: ['opencode', 'sessions', 'suggestions'],
    queryFn: async () => {
      const baseUrl = getActiveOpenCodeUrl();
      if (!baseUrl) return [];
      const res = await authenticatedFetch(`${baseUrl}/sessions/suggestions`);
      if (!res.ok) return [];
      const data: SuggestionsResponse = await res.json();
      return data.suggestions || [];
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    retry: 1,
  });

  const greeting = useMemo(() => {
    if (!mounted) return 'Welcome back';
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }, [mounted]);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fallbackSuggestions = useMemo(
    () => pickDeterministic(defaultSuggestions, 4, DEFAULT_FALLBACK_SEED),
    [],
  );

  const items = suggestions && suggestions.length > 0 ? suggestions : fallbackSuggestions;

  return (
    <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
      <div className="w-full max-w-[540px] px-6 pointer-events-auto">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex flex-col items-center"
            >
              <p className="text-sm text-muted-foreground/40">{greeting}</p>
            </motion.div>
          ) : (
            <motion.div
              key="content"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25 }}
              className="flex flex-col items-center gap-5"
            >
              {/* Greeting */}
              <motion.h2
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="text-base font-medium text-foreground/50 tracking-tight"
              >
                {greeting}
              </motion.h2>

              {/* Suggestions */}
              <div className="flex flex-col items-center gap-2 w-full">
                {items.map((item, i) => {
                  const Icon = iconMap[item.icon] || Sparkles;
                  return (
                    <motion.button
                      key={`${item.text}-${i}`}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{
                        duration: 0.3,
                        delay: i * 0.05,
                        ease: [0.25, 0.1, 0.25, 1],
                      }}
                      onClick={() => onSuggestionClick(item.text)}
                      className={cn(
                        'group flex items-center gap-3 w-full px-4 py-2.5 rounded-xl',
                        'text-[13px] leading-normal text-left',
                        'bg-background/60 backdrop-blur-md',
                        'border border-border/40',
                        'transition-colors duration-200',
                        'hover:bg-background/80 hover:border-border/70',
                        'active:scale-[0.98]',
                        'cursor-pointer select-none',
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:text-muted-foreground/70 transition-colors duration-200" />
                      <span className="flex-1 text-muted-foreground group-hover:text-foreground/80 transition-colors duration-200 truncate">
                        {item.text}
                      </span>
                      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/0 group-hover:text-muted-foreground/30 translate-x-[-4px] group-hover:translate-x-0 transition-colors duration-200" />
                    </motion.button>
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
