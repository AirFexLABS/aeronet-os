export function EmptyState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 text-secondary">
      <div
        className="w-12 h-12 rounded-full bg-surface border border-white/10
                    flex items-center justify-center text-2xl"
      >
        —
      </div>
      <p className="text-sm">{message}</p>
    </div>
  );
}
