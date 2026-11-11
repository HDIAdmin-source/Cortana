import type { Initiative } from "@cortana/shared";
import { publicClient } from "@/lib/supabase";

// Always read fresh from the database; the real site is built in Phase 4.
export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = publicClient();

  if (!supabase) {
    return (
      <main>
        <h1>HDI Cortana</h1>
        <p>
          The website is running, but it isn&apos;t connected to a database yet. Copy{" "}
          <code>apps/web/.env.example</code> to <code>apps/web/.env.local</code> and fill it in (see the README).
        </p>
      </main>
    );
  }

  const { data, error } = await supabase
    .from("initiatives")
    .select("*")
    .order("sort_order")
    .returns<Initiative[]>();

  return (
    <main>
      <h1>HDI Cortana</h1>
      <p>Phase 1 check: these initiatives are read live from the database.</p>
      {error && <p style={{ color: "crimson" }}>Could not load initiatives: {error.message}</p>}
      <ul>
        {(data ?? []).map((i) => (
          <li key={i.id}>
            <strong>{i.name}</strong>: {i.motto_en}
            <br />
            <em lang="grc">{i.motto_greek}</em>
          </li>
        ))}
      </ul>
    </main>
  );
}
