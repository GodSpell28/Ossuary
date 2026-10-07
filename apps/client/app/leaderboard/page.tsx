'use client';

import dynamic from 'next/dynamic';

const Leaderboard = dynamic(() => import('./Leaderboard'), { ssr: false });

export default function Page() {
  return <Leaderboard />;
}
