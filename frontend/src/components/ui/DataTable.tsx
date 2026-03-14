import { useState } from "react";

interface Column<T> {
  key: keyof T | string;
  label: string;
  render?: (row: T) => React.ReactNode;
  sortable?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  filterKeys?: (keyof T)[];
}

export function DataTable<T extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  onRowClick,
  filterKeys = [],
}: DataTableProps<T>) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const filtered = rows.filter(
    (row) =>
      !query ||
      filterKeys.some((k) =>
        String(row[k] ?? "")
          .toLowerCase()
          .includes(query.toLowerCase())
      )
  );

  const sorted = sortBy
    ? [...filtered].sort((a, b) => {
        const av = String(a[sortBy] ?? "");
        const bv = String(b[sortBy] ?? "");
        return sortDir === "asc"
          ? av.localeCompare(bv)
          : bv.localeCompare(av);
      })
    : filtered;

  const toggleSort = (key: string) => {
    if (sortBy === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortBy(key);
      setSortDir("asc");
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {filterKeys.length > 0 && (
        <input
          className="w-full max-w-xs px-3 py-1.5 text-sm rounded-lg
                     bg-surface border border-white/10 text-primary
                     placeholder:text-secondary focus:outline-none
                     focus:border-primary/60"
          placeholder="Filter..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-surface">
              {columns.map((col) => (
                <th
                  key={String(col.key)}
                  className={`px-4 py-3 text-left text-xs font-medium
                    text-secondary uppercase tracking-wider
                    ${col.sortable ? "cursor-pointer select-none hover:text-primary" : ""}
                  `}
                  onClick={() => col.sortable && toggleSort(String(col.key))}
                >
                  {col.label}
                  {sortBy === String(col.key) && (
                    <span className="ml-1">
                      {sortDir === "asc" ? "\u2191" : "\u2193"}
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr>
                <td
                  colSpan={columns.length}
                  className="px-4 py-8 text-center text-secondary text-sm"
                >
                  No results
                </td>
              </tr>
            )}
            {sorted.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={() => onRowClick?.(row)}
                className={`border-b border-white/5 transition-colors
                  ${onRowClick ? "cursor-pointer hover:bg-white/5" : ""}
                `}
              >
                {columns.map((col) => (
                  <td
                    key={String(col.key)}
                    className="px-4 py-3 text-primary"
                  >
                    {col.render
                      ? col.render(row)
                      : String(row[col.key as keyof T] ?? "\u2014")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-secondary">
        {sorted.length} of {rows.length} records
      </p>
    </div>
  );
}
