'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type Badge =
  | { status: 'loading' }
  | { status: 'ok'; credentials: number; devs: number }
  | { status: 'down' };

/** Live API health + issued-credential count for the footer network strip. */
export function LiveNetworkBadge() {
  const [badge, setBadge] = useState<Badge>({ status: 'loading' });

  useEffect(() => {
    let alive = true;
    api
      .stats()
      .then((s) => alive && setBadge({ status: 'ok', credentials: s.credentialsIssued, devs: s.developers }))
      .catch(() => alive && setBadge({ status: 'down' }));
    return () => {
      alive = false;
    };
  }, []);

  if (badge.status === 'down') return <span className="text-error font-label-mono-tag">API OFFLINE</span>;
  if (badge.status === 'loading') return <span className="text-text-muted font-label-mono-tag">API …</span>;
  return (
    <span className="text-text-muted font-label-mono-tag">
      API LIVE · {badge.credentials} CREDS · {badge.devs} DEVS
    </span>
  );
}