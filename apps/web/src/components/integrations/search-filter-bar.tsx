import React from 'react';
import { FilterBar, FilterBarItem } from '@/components/ui/tabs';
import { PageSearchBar } from '@/components/ui/page-search-bar';
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
        <PageSearchBar
          value={searchQuery}
          onChange={onSearchChange}
          placeholder="Search apps..."
          className="max-w-md"
        />

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

        <div className="flex-1" />

        <PipedreamSettingsDialog />
      </div>
    </div>
  );
};
