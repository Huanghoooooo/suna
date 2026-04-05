import React from 'react';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterBar, FilterBarItem } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
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
            <Input
              type="text"
              name="connector-search"
              autoComplete="off"
              placeholder="Search apps..."
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-9 rounded-xl pl-9 pr-8"
            />
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground group-focus-within:text-primary transition-colors">
              <Search className="h-3.5 w-3.5" />
            </div>
            {searchQuery && (
              <Button
                onClick={() => onSearchChange('')}
                variant="ghost"
                size="icon-xs"
                className="absolute right-2.5 top-1/2 -translate-y-1/2"
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        {/* Filter pills */}
        <FilterBar>
          {(['oauth', 'keys', 'all'] as const).map((filter) => (
            <FilterBarItem
              key={filter}
              onClick={() => onAuthFilterChange(filter)}
              data-state={authFilter === filter ? 'active' : 'inactive'}
            >
              {filter === 'oauth' ? 'OAuth' : filter === 'keys' ? 'API Key' : 'All'}
            </FilterBarItem>
          ))}
        </FilterBar>

        {/* Spacer → push gear to far right */}
        <div className="flex-1" />

        {/* Settings */}
        <PipedreamSettingsDialog />
      </div>
    </div>
  );
};
