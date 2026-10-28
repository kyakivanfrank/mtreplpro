import React from 'react';
import SearchIcon from '@/components/icons/Search';

/** Read-only: the whole bar is a button that opens the symbol picker. */
export default function QuotesSearchBar({ onOpen }: { onOpen: () => void }) {
  return (
    <div
      onClick={onOpen}
      className="bg-surface rounded-lg flex items-center px-3 py-1.5 mb-2 mt-1"
    >
      <SearchIcon className="w-4 h-4 text-muted mr-2" />
      <input
        type="text"
        readOnly
        placeholder="enter symbol for search"
        className="bg-transparent text-white w-full outline-none text-[15px] placeholder-muted cursor-pointer"
      />
    </div>
  );
}
