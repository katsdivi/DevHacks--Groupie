export function Soon({ nickname }: { nickname: string }) {
  return (
    <div className="px-5 pt-16 text-center">
      <h1 className="text-[28px] font-bold tracking-tight">Almost ready</h1>
      <p className="mt-2 text-muted">{nickname} is still warming up this screen. Check back soon.</p>
    </div>
  );
}
