'use client';

import dynamic from 'next/dynamic';

/**
 * Client-side lazy live report: the hero + pipeline above it paint first,
 * and the dashboard telemetry (which hits the API on mount) loads after.
 */
export const LazyLiveReport = dynamic(() => import('./LiveReport').then((m) => m.LiveReport), {
  ssr: false
});