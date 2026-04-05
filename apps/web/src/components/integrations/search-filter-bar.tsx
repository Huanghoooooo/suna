import { cn } from '@/lib/utils';
import React from 'react';
import { Search, X } from 'lucide-react';
import { PipedreamSettingsDialog } from './pipedream-settings-dialog';

export const SearchFilterBar = ({
  searchQuery,
  onSearchChange,
  authFilter,
  onAuthFilterChange,
}: {
  searchQuery: string;
  onSearchChange: (value: string) => void;
  authFilter: 'all' | 'oauth' | 'keys';
  onAuthFilterChange: (filter: 'all' | 'oauth' | 'keys') => void;
}) => {
  return (
    <div className="mb-2">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Add via Pipedream
        </h2>
        <span className="text-xs text-muted-foreground">
          One-click OAuth for 2,000+ apps
        </span>
      </div>
      <div className="flex items-center gap-2 pb-4">
        {/* Search */}
        <div className="flex-1 max-w-md">
          <div className="relative group">
            <input
              type="text"
              name="connector-search"
              autoComplete="off"
              placeholder="Search apps..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-9 w-full rounded-xl border border-input bg-card pl-9 pr-8 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2"
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors">
              <Search className="h-3.5 w-3.5" />
            </div>
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground hover:bg-muted/60 rounded-md p-0.5 transition-colors cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Filter pills */}
        <div className="flex items-center h-9 gap-0.5 rounded-xl border border-border bg-muted/30 px-1">
          {(['oauth', 'keys', 'all'] as const).map((filter) => (
            <button
              key={filter}
              onClick={() => onAuthFilterChange(filter)}
              className={cn('h-7 px-3 text-xs font-medium rounded-lg transition-colors cursor-pointer', 
                authFilter === filter
                  ? 'bg-background text-foreground border border-border/50 shadow-sm'
                  : 'text-muted-foreground hover:text-foreground hover:bg-background/50 border border-transparent'
              )}
            >
              {filter === 'oauth' ? 'OAuth' : filter === 'keys' ? 'API Key' : 'All'}
            </button>
          ))}
        </div>

        {/* Spacer → push gear to far right */}
        <div className="flex-1" />

        {/* Settings */}
        <PipedreamSettingsDialog />
      </div>
    </div>
  );
};
