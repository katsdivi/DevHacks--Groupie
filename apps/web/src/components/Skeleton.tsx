export function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-shimmer rounded-full bg-line ${className}`} />;
}

export function HomeSkeleton() {
  return (
    <div className="px-5 pt-5" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 animate-shimmer rounded-full bg-line" />
        <div className="space-y-2">
          <Bar className="h-3 w-24" />
          <Bar className="h-3 w-36" />
        </div>
      </div>
      <Bar className="mt-10 h-8 w-40" />
      <Bar className="mt-3 h-8 w-64" />
      <div className="mt-8 h-28 animate-shimmer rounded-3xl border border-dashed border-line" />
    </div>
  );
}
