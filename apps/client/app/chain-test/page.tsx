'use client';

import dynamic from 'next/dynamic';

const ChainTest = dynamic(() => import('./ChainTest'), { ssr: false });

export default function Page() {
  return <ChainTest />;
}
