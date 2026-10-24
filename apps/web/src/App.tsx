import { MEMBER_COLORS } from '@groupie/shared';

export default function App() {
  return (
    <main className="flex min-h-full items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-3xl border border-dashed border-line p-8 text-center">
        <div className="mb-6 flex justify-center gap-2">
          {MEMBER_COLORS.map((c) => (
            <span key={c.name} className="h-3 w-3 rounded-full" style={{ background: c.hex }} />
          ))}
        </div>
        <h1 className="text-4xl font-bold tracking-tight">Groupie</h1>
        <p className="mt-3 text-muted">Your group project's biggest fan.</p>
        <p className="mt-8 text-xs uppercase tracking-widest text-muted">Warming up</p>
      </div>
    </main>
  );
}
