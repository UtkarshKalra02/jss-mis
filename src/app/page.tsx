// Placeholder. Replaced in the app-shell commit with a redirect to /dashboard.
export default function Home() {
  return (
    <main className="mx-auto flex max-w-[1400px] flex-1 flex-col justify-center px-6">
      <h1 className="page-title">JSS MIS</h1>
      <p className="text-muted-foreground mt-1">
        Scaffold is up. Check <code className="text-foreground">/api/health</code> for the
        database connection.
      </p>
    </main>
  );
}
