import Link from 'next/link';

export default function Home() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16 }}>
      <div style={{ maxWidth: 560, textAlign: 'center' }}>
        <h1 style={{ fontSize: 'clamp(40px, 10vw, 88px)', letterSpacing: '0.2em', margin: 0, color: 'var(--bone)' }}>
          OSSUARY
        </h1>
        <p style={{ color: 'var(--dim)', lineHeight: 1.6 }}>
          Everyone descends the same level each day. Every death leaves a grave on Avalanche,
          and the next player can loot what you were carrying.
        </p>
        <Link
          href="/play"
          style={{
            display: 'inline-block',
            marginTop: 24,
            padding: '12px 32px',
            border: '2px solid var(--blood)',
            color: 'var(--fg)',
            textDecoration: 'none',
            letterSpacing: '0.3em',
          }}
        >
          DESCEND
        </Link>
      </div>
    </main>
  );
}
